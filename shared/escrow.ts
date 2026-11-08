import type { Hex } from 'viem';
export { escrowAbi } from './marketplace.js';
export const escrowStates = [
  'none',
  'funded',
  'delivered',
  'disputed',
  'released',
  'refunded',
] as const;
export type EscrowState = (typeof escrowStates)[number];
export interface EscrowOrder {
  id: Hex;
  checkoutId: string;
  title: string;
  artworkId: string;
  contractAddress: Hex;
  state: EscrowState;
  buyer: string;
  seller: string;
  amountWei: string;
  deliveryDeadline: number;
  reviewDeadline: number;
  disputeDeadline: number;
  fundingHash: string;
  releaseHash: string | null;
  refundHash: string | null;
  refundBalanceWei: string;
  buyerAccount: boolean;
  sellerAccount: boolean;
  manager: boolean;
  checkedAt: number;
  error?: string;
}
