import { Router } from 'express';
import { parseEventLogs, type Hex } from 'viem';
import type { BlockchainDemo } from '../shared/blockchain-demo.js';
import { marketplaceAbi, licenseNumber } from '../shared/marketplace.js';
import type { LocalBlockchain } from './blockchain.js';
import type { Repository } from './repository.js';
import { allocationsFor, type CheckoutItemRow, type CheckoutRow } from './chain-checkouts.js';
import { requireUser } from './auth.js';
import { requireVerified } from './security.js';
import { HttpError } from './errors.js';

const same = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();

export async function blockchainDemonstration(
  repo: Repository,
  chain: LocalBlockchain,
): Promise<BlockchainDemo> {
  const [network, market] = await Promise.all([chain.status(), chain.marketplaceStatus()]);
  const block = network.ready ? await chain.client.getBlockNumber().catch(() => null) : null;
  const row = repo.one<CheckoutItemRow & CheckoutRow & { market_version: 1 | 2 }>(`
    SELECT i.*,c.buyer_wallet,c.instance_id,c.contract_address,c.tx_hash,c.block_number,
      COALESCE(v.market_version,1) AS market_version
    FROM chain_checkout_items i JOIN chain_checkouts c ON c.id=i.checkout_id
    LEFT JOIN chain_checkout_versions v ON v.checkout_id=c.id
    WHERE c.status='confirmed' AND c.tx_hash IS NOT NULL AND i.purchase_id IS NOT NULL
    ORDER BY c.confirmed_at DESC,i.quote_id DESC LIMIT 1
  `);
  let sale: BlockchainDemo['sale'] = null;
  if (row) {
    sale = {
      title: row.title,
      license: row.license,
      transactionHash: row.tx_hash!,
      contractAddress: row.contract_address,
      buyerWallet: row.buyer_wallet,
      blockNumber: row.block_number,
      amountWei: row.amount_wei,
      feeWei: row.fee_wei,
      allocations: allocationsFor(repo, row),
      proof: 'unavailable',
      proofMessage:
        'Saved payment. The local node is unavailable; this receipt has not been checked now.',
    };
    if (network.ready && network.deployment) {
      if (!same(row.instance_id, network.deployment.instanceId)) {
        sale.proof = 'different_instance';
        sale.proofMessage = 'This saved payment belongs to a different local chain instance.';
      } else {
        try {
          const receipt = await chain.client.getTransactionReceipt({ hash: row.tx_hash as Hex });
          const logs = receipt.logs.filter((log) => same(log.address, row.contract_address));
          const payments = parseEventLogs({
            abi: marketplaceAbi,
            eventName: 'LicensePurchased',
            logs,
          }).filter((event) => same(event.args.quoteId, row.quote_id));
          const allocations = parseEventLogs({
            abi: marketplaceAbi,
            eventName: 'RevenueAllocated',
            logs,
          }).filter((event) => same(event.args.quoteId, row.quote_id));
          const payment = payments[0]?.args;
          const valid =
            receipt.status === 'success' &&
            same(receipt.to, row.contract_address) &&
            same(receipt.from, row.buyer_wallet) &&
            payments.length === 1 &&
            same(payment?.buyer, row.buyer_wallet) &&
            same(payment?.seller, row.seller_wallet) &&
            same(payment?.fileHash, row.file_hash) &&
            same(payment?.termsHash, row.terms_hash) &&
            payment?.licenseType === licenseNumber[row.license] &&
            String(payment?.amount) === row.amount_wei &&
            String(payment?.fee) === row.fee_wei &&
            (row.market_version === 1 ||
              (allocations.length === sale.allocations.length &&
                sale.allocations.every((expected) =>
                  allocations.some(
                    (event) =>
                      same(event.args.recipient, expected.wallet) &&
                      String(event.args.amount) === expected.amountWei &&
                      event.args.shareBps === expected.percent * 100,
                  ),
                )));
          sale.proof = valid ? 'verified' : 'mismatch';
          sale.proofMessage = valid
            ? row.market_version === 2
              ? 'The local node confirms the successful transaction, license payment and recorded revenue allocations.'
              : 'The local node confirms this legacy license payment. The legacy contract did not emit co-author allocation events.'
            : 'The live receipt does not match the saved payment. It is not presented as verified.';
          if (valid) sale.blockNumber = String(receipt.blockNumber);
        } catch {
          sale.proofMessage =
            'The saved payment could not be verified on the local node. Refresh proof when the node is available.';
        }
      }
    }
  }
  return {
    checkedAt: new Date().toISOString(),
    network: {
      ready: network.ready && block !== null,
      marketplaceReady: market.ready,
      chainId: network.chainId,
      blockNumber: block === null ? null : String(block),
      registryAddress: network.deployment?.address || null,
      marketplaceAddress: market.deployment?.address || null,
      message:
        network.ready && block !== null
          ? network.message
          : 'The local blockchain is unavailable. The walkthrough still works.',
    },
    sale,
  };
}

export function blockchainDemoRoutes(repo: Repository, chain: LocalBlockchain) {
  const router = Router();
  router.get(['/manager/blockchain-demo', '/admin/blockchain-demo'], async (req, res) => {
    const user = requireVerified(repo, requireUser(req));
    if (!repo.isManager(user.id))
      throw new HttpError(403, 'Manager access is required to view private purchase records.');
    res.json(await blockchainDemonstration(repo, chain));
  });
  return router;
}
