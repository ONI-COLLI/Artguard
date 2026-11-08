import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import {
  decodeFunctionData,
  numberToHex,
  parseEventLogs,
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
  type Hex,
} from 'viem';
import type { PublicChainProof } from '../shared/public-chain-proof.js';
import { marketplaceAbi, termMarketplaceAbi, marketAbi } from '../shared/marketplace.js';
import type { LocalBlockchain } from './blockchain.js';

const same = (a?: string | null, b?: string | null) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();
const scanBlocks = 5000n;

// This verifier deliberately has no Repository/database dependency. Only public
// EVM data and locally configured contract addresses are used.
export async function publicChainProof(
  chain: LocalBlockchain,
  requestedHash?: Hex,
): Promise<PublicChainProof> {
  const result: PublicChainProof = {
    checkedAt: new Date().toISOString(),
    source: 'anvil_rpc',
    rpcUrl: chain.publicRpcUrl || chain.rpcUrl,
    chainId: null,
    headBlock: null,
    status: 'unavailable',
    message: 'The local node is unavailable. No live verification is available.',
    checks: [],
    transaction: null,
  };
  const check = (id: string, label: string, passed: boolean) => {
    result.checks.push({ id, label, passed });
    if (!passed) {
      result.status = 'failed';
      result.message = `Verification failed: ${label}.`;
      throw new ProofMismatch();
    }
  };
  try {
    const [chainId, head, market] = await Promise.all([
      chain.client.getChainId(),
      // A refresh immediately after a withdrawal must include its new block,
      // rather than reuse the client's briefly cached pre-withdrawal tip.
      chain.client.getBlockNumber({ cacheTime: 0 }),
      chain.marketplaceStatus(),
    ]);
    result.chainId = chainId;
    result.headBlock = String(head);
    check('network', 'Local EVM network · chain 31337', chainId === 31337);
    if (!market.ready || !market.deployment) {
      result.message =
        'The local license contracts could not be verified. Check the node and refresh.';
      return result;
    }
    const contracts = (market.contracts || [market.deployment]).filter(
      (entry) => entry.version === 2 || entry.version === 3,
    );
    let hash = requestedHash;
    if (!hash) {
      const fromBlock = head > scanBlocks ? head - scanBlocks : 0n;
      const events = (
        await Promise.all(
          contracts.map((entry) =>
            chain.client.getContractEvents({
              address: entry.address,
              abi: marketplaceAbi,
              eventName: 'LicensePurchased',
              fromBlock,
              toBlock: head,
              strict: true,
            }),
          ),
        )
      )
        .flat()
        .sort((a, b) =>
          a.blockNumber === b.blockNumber
            ? b.logIndex - a.logIndex
            : a.blockNumber > b.blockNumber
              ? -1
              : 1,
        );
      hash = events[0]?.transactionHash || undefined;
      if (!hash) {
        result.status = 'not_found';
        result.message =
          'No license purchase was found in the last 5,000 blocks. Paste an older transaction hash to check it.';
        return result;
      }
    }
    const [tx, receipt] = await Promise.all([
      chain.client.getTransaction({ hash }),
      chain.client.getTransactionReceipt({ hash }),
    ]);
    check('success', 'Transaction completed successfully', receipt.status === 'success');
    check(
      'receipt',
      'Transaction matches its receipt',
      same(tx.hash, receipt.transactionHash) &&
        same(tx.blockHash, receipt.blockHash) &&
        same(tx.from, receipt.from) &&
        same(tx.to, receipt.to),
    );
    const contract = contracts.find((entry) => same(entry.address, tx.to));
    check('destination', 'Payment reached an ArtGuard license contract', !!contract && !!tx.to);
    if (!contract || !tx.to) throw new ProofMismatch();
    const snapshotBlock = head > receipt.blockNumber ? head : receipt.blockNumber;
    result.headBlock = String(snapshotBlock);
    const [block, canonical, code, instance] = await Promise.all([
      chain.client.getBlock({ blockHash: receipt.blockHash }),
      chain.client.getBlock({ blockNumber: receipt.blockNumber }),
      chain.client.getCode({ address: tx.to, blockNumber: snapshotBlock }),
      chain.client.readContract({
        address: tx.to,
        abi: marketplaceAbi,
        functionName: 'instanceId',
        blockNumber: snapshotBlock,
      }),
    ]);
    check(
      'block',
      'Transaction is included in the canonical block',
      same(block.hash, canonical.hash) &&
        block.number === receipt.blockNumber &&
        block.transactions.some((entry) => same(entry, hash)),
    );
    check(
      'code',
      'Smart-contract code is deployed on the node',
      !!code && code !== '0x' && same(instance, contract.instanceId),
    );
    const decoded = decodeFunctionData({
      abi: contract.version === 3 ? termMarketplaceAbi : marketplaceAbi,
      data: tx.input,
    });
    check(
      'call',
      'buyLicenses call and exact payment match',
      decoded.functionName === 'buyLicenses',
    );
    if (decoded.functionName !== 'buyLicenses') throw new ProofMismatch();
    const quotes = decoded.args[0];
    check(
      'value',
      'Transferred amount equals the quoted license prices',
      quotes.length > 0 &&
        quotes.length <= 50 &&
        quotes.reduce((sum, q) => sum + q.amount, 0n) === tx.value,
    );
    const logs = receipt.logs.filter((log) => same(log.address, tx.to));
    const purchases = parseEventLogs({ abi: marketplaceAbi, eventName: 'LicensePurchased', logs });
    const periods = parseEventLogs({ abi: termMarketplaceAbi, eventName: 'LicenseValidity', logs });
    if (contract.version === 3)
      check(
        'period',
        'License periods match the signed offers',
        periods.length === quotes.length &&
          quotes.every((q) => {
            const p = periods.find((e) => same(e.args.quoteId, q.id))?.args;
            const duration =
              'durationSeconds' in q && typeof q.durationSeconds === 'bigint'
                ? q.durationSeconds
                : 0n;
            return (
              !!p &&
              p.validFrom === block.timestamp &&
              p.validUntil === (duration ? p.validFrom + duration : 18446744073709551615n)
            );
          }),
      );
    const allocations = parseEventLogs({
      abi: marketplaceAbi,
      eventName: 'RevenueAllocated',
      logs,
    });
    check(
      'purchase',
      'LicensePurchased events match the payment',
      purchases.length === quotes.length &&
        quotes.every((q) => {
          const event = purchases.find((entry) => same(entry.args.quoteId, q.id))?.args;
          return (
            !!event &&
            same(q.buyer, tx.from) &&
            same(event.buyer, q.buyer) &&
            same(event.seller, q.seller) &&
            same(event.fileHash, q.fileHash) &&
            same(event.termsHash, q.termsHash) &&
            event.licenseType === q.licenseType &&
            event.amount === q.amount &&
            event.fee === (q.amount * BigInt(q.feeBps)) / 10000n &&
            same(q.instanceId, instance)
          );
        }),
    );
    const treasury = await chain.client.readContract({
      address: tx.to,
      abi: marketplaceAbi,
      functionName: 'treasury',
      blockNumber: snapshotBlock,
    });
    const expected = quotes.flatMap((q) => {
      const net = q.amount - (q.amount * BigInt(q.feeBps)) / 10000n;
      let allocated = 0n;
      const rows = q.recipients.map((wallet, index) => {
        const amount = (net * BigInt(q.shares[index])) / 10000n;
        allocated += amount;
        return { quoteId: q.id, wallet, amount, share: q.shares[index], creator: false };
      });
      rows.push({
        quoteId: q.id,
        wallet: q.seller,
        amount: net - allocated,
        share: 10000 - q.shares.reduce((sum, share) => sum + share, 0),
        creator: true,
      });
      return rows;
    });
    check(
      'allocations',
      'RevenueAllocated events match every recipient',
      allocations.length === expected.length &&
        expected.every((entry) =>
          allocations.some(
            (event) =>
              same(event.args.quoteId, entry.quoteId) &&
              same(event.args.recipient, entry.wallet) &&
              event.args.amount === entry.amount &&
              event.args.shareBps === entry.share,
          ),
        ),
    );
    const stateTime =
      contract.version === 3
        ? (await chain.client.getBlock({ blockNumber: snapshotBlock })).timestamp
        : 0n;
    const licenses = await Promise.all(
      quotes.map(async (q) => {
        const [owned, quoteUsed] = await Promise.all([
          chain.client.readContract({
            address: tx.to!,
            abi: marketplaceAbi,
            functionName: 'hasLicense',
            args: [q.buyer, q.fileHash, q.licenseType],
            blockNumber: snapshotBlock,
          }),
          chain.client.readContract({
            address: tx.to!,
            abi: marketplaceAbi,
            functionName: 'usedQuotes',
            args: [q.id],
            blockNumber: snapshotBlock,
          }),
        ]);
        const period = periods.find((e) => same(e.args.quoteId, q.id))?.args;
        const expiry =
          contract.version === 3
            ? await chain.client.readContract({
                address: tx.to!,
                abi: termMarketplaceAbi,
                functionName: 'licenseExpiry',
                args: [q.buyer, q.fileHash, q.licenseType],
                blockNumber: snapshotBlock,
              })
            : null;
        return {
          quoteId: q.id,
          fileHash: q.fileHash,
          licenseType: q.licenseType,
          seller: q.seller,
          owned,
          quoteUsed,
          stateConsistent:
            expiry === null
              ? owned
              : !!period && expiry >= period.validUntil && owned === expiry > stateTime,
          validUntil:
            periods.find((e) => same(e.args.quoteId, q.id))?.args.validUntil ===
            18446744073709551615n
              ? null
              : (() => {
                  const p = periods.find((e) => same(e.args.quoteId, q.id));
                  return p ? new Date(Number(p.args.validUntil) * 1000).toISOString() : null;
                })(),
        };
      }),
    );
    check(
      'ownership',
      'Consumed quotes and current license state match the purchase history',
      licenses.every((entry) => entry.stateConsistent && entry.quoteUsed),
    );
    const fee = purchases.reduce((sum, event) => sum + event.args.fee, 0n);
    const distribution: NonNullable<PublicChainProof['transaction']>['allocations'] = [
      { role: 'Platform', wallet: treasury, amountWei: String(fee) },
    ];
    for (const entry of expected) {
      const role = entry.creator ? 'Creator' : 'Co-author';
      const existing = distribution.find(
        (row) => row.role === role && same(row.wallet, entry.wallet),
      );
      if (existing) existing.amountWei = String(BigInt(existing.amountWei) + entry.amount);
      else distribution.push({ role, wallet: entry.wallet, amountWei: String(entry.amount) });
    }
    const wallets = [...new Set(distribution.map((row) => row.wallet.toLowerCase()))];
    const credits = await Promise.all(
      wallets.map(async (wallet) => ({
        wallet,
        amountWei: await chain.client
          .readContract({
            address: tx.to!,
            abi: marketplaceAbi,
            functionName: 'balances',
            args: [wallet as Hex],
            blockNumber: snapshotBlock,
          })
          .then(String)
          .catch(() => null),
      })),
    );
    const withdrawals: NonNullable<PublicChainProof['transaction']>['withdrawals'] = [];
    const withdrawalsFromBlock =
      snapshotBlock - receipt.blockNumber > scanBlocks
        ? snapshotBlock - scanBlocks
        : receipt.blockNumber;
    let withdrawalScan: 'complete' | 'recent' | 'unavailable' =
      withdrawalsFromBlock === receipt.blockNumber ? 'complete' : 'recent';
    try {
      const withdrawn = await chain.client.getContractEvents({
        address: tx.to,
        abi: marketplaceAbi,
        eventName: 'ProceedsWithdrawn',
        fromBlock: withdrawalsFromBlock,
        toBlock: snapshotBlock,
        strict: true,
      });
      const relevant = withdrawn.filter((event) =>
        wallets.includes(event.args.recipient.toLowerCase()),
      );
      if (relevant.length > 20) withdrawalScan = 'recent';
      // Each event is tied to a successful withdrawal receipt at this contract.
      for (const event of relevant.slice(-20)) {
        const withdrawalReceipt = await chain.client.getTransactionReceipt({
          hash: event.transactionHash,
        });
        const withdrawalEvents = parseEventLogs({
          abi: marketplaceAbi,
          eventName: 'ProceedsWithdrawn',
          logs: withdrawalReceipt.logs.filter((log) => same(log.address, tx.to)),
        });
        if (
          withdrawalReceipt.status !== 'success' ||
          !same(withdrawalReceipt.to, tx.to) ||
          !same(withdrawalReceipt.from, event.args.recipient) ||
          !same(withdrawalReceipt.blockHash, event.blockHash) ||
          withdrawalReceipt.blockNumber !== event.blockNumber ||
          !withdrawalEvents.some(
            (entry) =>
              same(entry.args.recipient, event.args.recipient) &&
              entry.args.amount === event.args.amount,
          )
        )
          throw new Error('Withdrawal receipt mismatch');
        withdrawals.push({
          wallet: event.args.recipient,
          amountWei: String(event.args.amount),
          transactionHash: event.transactionHash,
          blockNumber: String(event.blockNumber),
        });
      }
    } catch {
      withdrawalScan = 'unavailable';
      withdrawals.length = 0;
    }
    result.transaction = {
      hash: tx.hash,
      blockNumber: String(receipt.blockNumber),
      blockHash: receipt.blockHash,
      buyer: tx.from,
      contract: tx.to,
      amountWei: String(tx.value),
      feeWei: String(fee),
      gasWei: String(receipt.gasUsed * receipt.effectiveGasPrice),
      licenses,
      allocations: distribution,
      credits,
      withdrawals,
      withdrawalScan,
      withdrawalsFromBlock: String(withdrawalsFromBlock),
      receipt: {
        status: receipt.status === 'success' ? '0x1' : '0x0',
        transactionHash: receipt.transactionHash,
        from: receipt.from,
        to: receipt.to,
        blockHash: receipt.blockHash,
        blockNumber: numberToHex(receipt.blockNumber),
        logs: logs.map((log) => ({ address: log.address, topics: log.topics, data: log.data })),
      },
    };
    result.status = 'verified';
    result.message =
      'The local node confirms this purchase, its block, license ownership and revenue allocations.';
  } catch (error) {
    if (error instanceof ProofMismatch) return result;
    if (
      error instanceof TransactionNotFoundError ||
      error instanceof TransactionReceiptNotFoundError
    ) {
      result.status = 'not_found';
      result.message =
        'This transaction has not been mined on the current local network. Check the hash and try again.';
    } else {
      result.status = 'unavailable';
      result.message =
        'The live blockchain check could not be completed. Check the local node and try again.';
    }
  } finally {
    result.checkedAt = new Date().toISOString();
  }
  return result;
}
class ProofMismatch extends Error {}

export function publicChainProofRoutes(chain: LocalBlockchain) {
  const router = Router();
  router.get(
    '/blockchain/demo-proof',
    rateLimit({
      windowMs: 60_000,
      limit: 60,
      legacyHeaders: false,
      standardHeaders: 'draft-8',
      message: { error: 'Wait a moment before checking the blockchain again.' },
    }),
    async (req, res) => {
      const input = z
        .object({
          transactionHash: z
            .string()
            .regex(/^0x[\da-fA-F]{64}$/, 'Enter a valid transaction hash.')
            .optional(),
        })
        .parse(req.query);
      res.json(await publicChainProof(chain, input.transactionHash as Hex | undefined));
    },
  );
  return router;
}
