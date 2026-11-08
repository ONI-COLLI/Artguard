import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { decodeFunctionData, parseEventLogs, type Hex } from 'viem';
import { escrowAbi, escrowStates } from '../shared/escrow.js';
import type { EscrowProof } from '../shared/escrow-proof.js';
import type { LocalBlockchain } from './blockchain.js';
const same = (a?: string | null, b?: string | null) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();
// Read-only proof: no Repository, account or SQLite data is used.
export async function escrowProof(chain: LocalBlockchain, hash?: Hex): Promise<EscrowProof> {
  const result: EscrowProof = {
    status: 'unavailable',
    checkedAt: new Date().toISOString(),
    source: 'anvil_rpc',
    message: 'The live escrow check could not finish. Check the local node.',
    checks: [],
    orders: [],
  };
  const check = (label: string, passed: boolean) => {
    result.checks.push({ label, passed });
    if (!passed) {
      result.status = 'failed';
      result.message = 'The transaction does not match a verified escrow payment.';
      throw new Error('Proof mismatch');
    }
  };
  try {
    const status = await chain.marketplaceStatus(),
      contracts = (status.contracts || []).filter((c) => c.version === 4);
    if (!contracts.length) {
      result.status = 'not_found';
      result.message = 'No escrow contract is configured on this local node.';
      return result;
    }
    const head = await chain.client.getBlockNumber({ cacheTime: 0 });
    const from = head > 5000n ? head - 5000n : 0n;
    if (!hash) {
      const events = (
        await Promise.all(
          contracts.map((c) =>
            chain.client.getContractEvents({
              address: c.address,
              abi: escrowAbi,
              eventName: 'EscrowFunded',
              fromBlock: from,
              toBlock: head,
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
    }
    if (!hash) {
      result.status = 'not_found';
      result.message =
        'No escrow deposit was found in the last 5,000 blocks. Make a test purchase or enter an older deposit transaction hash.';
      return result;
    }
    const [tx, receipt] = await Promise.all([
      chain.client.getTransaction({ hash }),
      chain.client.getTransactionReceipt({ hash }),
    ]);
    const market = contracts.find((c) => same(c.address, tx.to));
    check(
      'Deposit succeeded at a configured escrow contract',
      !!market &&
        receipt.status === 'success' &&
        same(receipt.to, tx.to) &&
        same(receipt.from, tx.from) &&
        same(receipt.transactionHash, tx.hash),
    );
    if (!market || !tx.to) throw new Error('Missing contract');
    await chain.requireMarketplace(market.address);
    const [block, canonical, code] = await Promise.all([
      chain.client.getBlock({ blockHash: receipt.blockHash }),
      chain.client.getBlock({ blockNumber: receipt.blockNumber }),
      chain.client.getCode({ address: market.address }),
    ]);
    check(
      'Deposit belongs to the canonical block and deployed contract code',
      same(block.hash, canonical.hash) &&
        block.transactions.some((h) => same(h, hash)) &&
        !!code &&
        code !== '0x',
    );
    const call = decodeFunctionData({ abi: escrowAbi, data: tx.input });
    check('Transaction calls buyLicenses to fund escrow', call.functionName === 'buyLicenses');
    if (call.functionName !== 'buyLicenses') {
      result.message = 'Enter the deposit transaction hash, not a release or refund hash.';
      return result;
    }
    const quotes = call.args[0];
    check(
      'Transferred amount equals the signed order total',
      quotes.length > 0 && quotes.reduce((s, q) => s + q.amount, 0n) === tx.value,
    );
    const funded = parseEventLogs({
      abi: escrowAbi,
      eventName: 'EscrowFunded',
      logs: receipt.logs.filter((l) => same(l.address, market.address)),
    });
    check(
      'EscrowFunded events match buyer, seller, file, terms, price and period',
      funded.length === quotes.length &&
        quotes.every((q) =>
          funded.some(
            ({ args: e }) =>
              same(q.buyer, tx.from) &&
              e.quoteId === q.id &&
              same(e.buyer, q.buyer) &&
              same(e.seller, q.seller) &&
              e.fileHash === q.fileHash &&
              e.licenseType === q.licenseType &&
              e.termsHash === q.termsHash &&
              e.amount === q.amount &&
              e.fee === (q.amount * BigInt(q.feeBps)) / 10000n &&
              e.durationSeconds === q.durationSeconds &&
              e.deliveryDeadline === block.timestamp + 72n * 3600n,
          ),
        ),
    );
    for (const q of quotes) {
      const e = await chain.client.readContract({
        address: market.address,
        abi: escrowAbi,
        functionName: 'getEscrow',
        args: [q.id],
      });
      const used = await chain.client.readContract({
        address: market.address,
        abi: escrowAbi,
        functionName: 'usedQuotes',
        args: [q.id],
      });
      check(
        'Contract storage and consumed quote match order ' + q.id.slice(0, 10),
        used &&
          same(e.buyer, q.buyer) &&
          same(e.seller, q.seller) &&
          e.fileHash === q.fileHash &&
          e.amount === q.amount &&
          e.licenseType === q.licenseType &&
          e.durationSeconds === q.durationSeconds &&
          e.state > 0 &&
          e.state <= 5,
      );
      let releaseHash: Hex | null = null,
        refundHash: Hex | null = null;
      const allocations: { wallet: string; amountWei: string }[] = [],
        withdrawals: { wallet: string; amountWei: string; hash: string }[] = [];
      if (e.state === 4 || e.state === 5) {
        const events =
          e.state === 4
            ? await chain.client.getContractEvents({
                address: market.address,
                abi: escrowAbi,
                eventName: 'EscrowReleased',
                args: { quoteId: q.id },
                fromBlock: receipt.blockNumber,
                toBlock: head,
              })
            : await chain.client.getContractEvents({
                address: market.address,
                abi: escrowAbi,
                eventName: 'EscrowRefunded',
                args: { quoteId: q.id },
                fromBlock: receipt.blockNumber,
                toBlock: head,
              });
        check(
          'A unique on-chain settlement event exists',
          events.length === 1 && !!events[0].transactionHash,
        );
        const settlement = await chain.client.getTransactionReceipt({
          hash: events[0].transactionHash!,
        });
        check(
          'Settlement transaction succeeded at the escrow contract',
          settlement.status === 'success' && same(settlement.to, market.address),
        );
        const logs = settlement.logs.filter((l) => same(l.address, market.address));
        if (e.state === 5) {
          refundHash = settlement.transactionHash;
          check(
            'Refund event returns the full deposited amount',
            parseEventLogs({ abi: escrowAbi, eventName: 'EscrowRefunded', logs }).some(
              ({ args: a }) =>
                a.quoteId === q.id && same(a.buyer, q.buyer) && a.amount === q.amount,
            ),
          );
          const transfers = await chain.client.getContractEvents({
            address: market.address,
            abi: escrowAbi,
            eventName: 'RefundWithdrawn',
            args: { buyer: q.buyer },
            fromBlock: from > settlement.blockNumber ? from : settlement.blockNumber,
            toBlock: head,
          });
          for (const transfer of transfers.slice(-20)) {
            const r = await chain.client.getTransactionReceipt({ hash: transfer.transactionHash! });
            if (
              r.status === 'success' &&
              same(r.to, market.address) &&
              same(r.from, q.buyer) &&
              parseEventLogs({
                abi: escrowAbi,
                eventName: 'RefundWithdrawn',
                logs: r.logs.filter((l) => same(l.address, market.address)),
              }).some((x) => same(x.args.buyer, q.buyer) && x.args.amount === transfer.args.amount)
            )
              withdrawals.push({
                wallet: q.buyer,
                amountWei: String(transfer.args.amount),
                hash: transfer.transactionHash!,
              });
          }
        } else {
          releaseHash = settlement.transactionHash;
          const sale = parseEventLogs({ abi: escrowAbi, eventName: 'LicensePurchased', logs }).find(
            (a) => a.args.quoteId === q.id,
          )?.args;
          const period = parseEventLogs({
            abi: escrowAbi,
            eventName: 'LicenseValidity',
            logs,
          }).find((a) => a.args.quoteId === q.id)?.args;
          check(
            'License and period were issued on release, not deposit',
            !!sale &&
              !!period &&
              same(sale.buyer, q.buyer) &&
              same(sale.seller, q.seller) &&
              sale.fileHash === q.fileHash &&
              sale.licenseType === q.licenseType &&
              sale.termsHash === q.termsHash &&
              sale.amount === q.amount &&
              sale.fee === e.fee &&
              period.validFrom === sale.purchasedAt &&
              period.validUntil ===
                (q.durationSeconds ? period.validFrom + q.durationSeconds : 18446744073709551615n),
          );
          const actual = parseEventLogs({
            abi: escrowAbi,
            eventName: 'RevenueAllocated',
            logs,
          }).filter((a) => a.args.quoteId === q.id);
          const net = q.amount - e.fee;
          let assigned = 0n;
          const expected = q.recipients.map((wallet, i) => {
            const amount = (net * BigInt(q.shares[i])) / 10000n;
            assigned += amount;
            return { wallet, amount, share: q.shares[i] };
          });
          expected.push({
            wallet: q.seller,
            amount: net - assigned,
            share: 10000 - q.shares.reduce((sum, n) => sum + n, 0),
          });
          check(
            'All creator and co-author allocations match the signed split',
            actual.length === expected.length &&
              expected.every((x) =>
                actual.some(
                  ({ args: a }) =>
                    same(a.recipient, x.wallet) && a.amount === x.amount && a.shareBps === x.share,
                ),
              ),
          );
          const treasury = await chain.client.readContract({
            address: market.address,
            abi: escrowAbi,
            functionName: 'treasury',
          });
          allocations.push(
            { wallet: treasury, amountWei: String(e.fee) },
            ...expected.map((x) => ({ wallet: x.wallet, amountWei: String(x.amount) })),
          );
          const transfers = await chain.client.getContractEvents({
            address: market.address,
            abi: escrowAbi,
            eventName: 'ProceedsWithdrawn',
            fromBlock: from > settlement.blockNumber ? from : settlement.blockNumber,
            toBlock: head,
          });
          for (const transfer of transfers.slice(-20)) {
            if (
              !transfer.args.recipient ||
              !expected.some((a) => same(a.wallet, transfer.args.recipient))
            )
              continue;
            const r = await chain.client.getTransactionReceipt({ hash: transfer.transactionHash! });
            if (r.status === 'success' && same(r.to, market.address))
              withdrawals.push({
                wallet: transfer.args.recipient,
                amountWei: String(transfer.args.amount),
                hash: transfer.transactionHash!,
              });
          }
        }
      }
      const active = await chain.client.readContract({
        address: market.address,
        abi: escrowAbi,
        functionName: 'hasLicense',
        args: [q.buyer, q.fileHash, q.licenseType],
      });
      const refundBalance = await chain.client.readContract({
        address: market.address,
        abi: escrowAbi,
        functionName: 'refundBalances',
        args: [q.buyer],
      });
      result.orders.push({
        id: q.id,
        state: escrowStates[e.state],
        buyer: q.buyer,
        seller: q.seller,
        amountWei: String(q.amount),
        heldWei: e.state <= 3 ? String(q.amount) : '0',
        depositHash: hash,
        block: String(receipt.blockNumber),
        deliveryDeadline: Number(e.deliveryDeadline),
        reviewDeadline: Number(e.reviewDeadline),
        disputeDeadline: Number(e.disputeDeadline),
        releaseHash,
        refundHash,
        licenseActive: active,
        refundBalanceWei: String(refundBalance),
        allocations,
        withdrawals,
      });
    }
    result.status = 'verified';
    result.message =
      'The local node confirms this deposit and the current escrow state. Allocations and withdrawals are separate transactions.';
  } catch {
    result.orders = [];
  } finally {
    result.checkedAt = new Date().toISOString();
  }
  return result;
}
export function escrowProofRoutes(chain: LocalBlockchain) {
  const r = Router();
  r.get(
    '/blockchain/escrow-proof',
    rateLimit({ windowMs: 60000, limit: 60, legacyHeaders: false }),
    async (req, res) => {
      const { transactionHash } = z
        .object({
          transactionHash: z
            .string()
            .regex(/^0x[\da-fA-F]{64}$/)
            .optional(),
        })
        .parse(req.query);
      res.json(await escrowProof(chain, transactionHash as Hex | undefined));
    },
  );
  return r;
}
