import type { Address } from 'viem';
import type { Recipient } from './types.js';
import type { RevenueAllocation, BlockchainPayment } from './marketplace.js';

// Shares apply to net proceeds. Rounding dust belongs to the registering creator.
export function revenueAllocations(
  name: string,
  wallet: Address,
  recipients: Recipient[],
  net: bigint,
): RevenueAllocation[] {
  const others: RevenueAllocation[] = recipients.map((r) => ({
    name: r.name,
    wallet: r.wallet as Address,
    percent: r.percent,
    amountWei: String((net * BigInt(r.percent * 100)) / 10000n),
    creator: false,
  }));
  return [
    {
      name,
      wallet,
      percent: 100 - recipients.reduce((sum, r) => sum + r.percent, 0),
      amountWei: String(net - others.reduce((sum, r) => sum + BigInt(r.amountWei), 0n)),
      creator: true,
    },
    ...others,
  ];
}
export function creatorCredit(payment: BlockchainPayment): bigint {
  return payment.allocations
    ? payment.allocations.filter((a) => a.creator).reduce((sum, a) => sum + BigInt(a.amountWei), 0n)
    : BigInt(payment.amountWei) - BigInt(payment.feeWei);
}
