export interface EscrowProof {
  status: 'verified' | 'unavailable' | 'not_found' | 'failed';
  checkedAt: string;
  source: 'anvil_rpc';
  message: string;
  checks: { label: string; passed: boolean }[];
  orders: {
    id: string;
    state: string;
    buyer: string;
    seller: string;
    amountWei: string;
    heldWei: string;
    depositHash: string;
    block: string;
    deliveryDeadline: number;
    reviewDeadline: number;
    disputeDeadline: number;
    releaseHash: string | null;
    refundHash: string | null;
    licenseActive: boolean;
    refundBalanceWei: string;
    allocations: { wallet: string; amountWei: string }[];
    withdrawals: { wallet: string; amountWei: string; hash: string }[];
  }[];
}
