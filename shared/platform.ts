import { parseAbi, type Address, type Hex } from 'viem';
import type { PlanId, Recipient } from './types.js';
export const subscriptionPeriod = 30 * 86400;
export const paidPlanNumber = { premium: 1, business: 2 } as const;
export const subscriptionAbi = parseAbi([
  'struct Quote { bytes32 id; bytes32 accountId; address buyer; uint8 plan; uint256 amount; uint64 expiresAt; uint64 expectedUntil; bytes32 instanceId; }',
  'function purchase(Quote quote, bytes signature) payable',
  'function instanceId() view returns (bytes32)',
  'function quoteSigner() view returns (address)',
  'function treasury() view returns (address)',
  'function subscriptions(bytes32) view returns (uint8 plan, uint64 validUntil)',
  'function usedQuotes(bytes32) view returns (bool)',
  'function withdraw()',
  'function balances(address) view returns (uint256)',
  'event SubscriptionPurchased(bytes32 indexed quoteId, bytes32 indexed accountId, address indexed buyer, uint8 plan, uint256 amount, uint64 validUntil)',
  'error InvalidQuote()',
  'error InvalidPayment()',
  'error ActivePlan()',
  'error NothingToWithdraw()',
]);
export const subscriptionTypes = {
  Quote: [
    { name: 'id', type: 'bytes32' },
    { name: 'accountId', type: 'bytes32' },
    { name: 'buyer', type: 'address' },
    { name: 'plan', type: 'uint8' },
    { name: 'amount', type: 'uint256' },
    { name: 'expiresAt', type: 'uint64' },
    { name: 'expectedUntil', type: 'uint64' },
    { name: 'instanceId', type: 'bytes32' },
  ],
} as const;
export const subscriptionDomain = (address: Address) =>
  ({
    name: 'ArtGuardSubscriptions',
    version: '1',
    chainId: 31337,
    verifyingContract: address,
  }) as const;
export interface SubscriptionQuote {
  id: Hex;
  accountId: Hex;
  buyer: Address;
  plan: number;
  amount: string;
  expiresAt: number;
  expectedUntil: number;
  instanceId: Hex;
}
export const subscriptionMessage = (q: SubscriptionQuote) => ({
  ...q,
  amount: BigInt(q.amount),
  expiresAt: BigInt(q.expiresAt),
  expectedUntil: BigInt(q.expectedUntil),
});
export interface SubscriptionOrder {
  id: string;
  plan: 'premium' | 'business';
  contractAddress: Address;
  quote: SubscriptionQuote;
  signature: Hex;
  status: 'prepared' | 'pending' | 'confirmed' | 'failed';
  transactionHash: Hex | null;
  validUntil: number | null;
  error: string | null;
}
export interface SubscriptionState {
  plan: PlanId;
  validUntil: number | null;
  cancelAtEnd: boolean;
}
export interface ShareStatus {
  versionId: string | null;
  ready: boolean;
  ownerWallet: string | null;
  recipients: (Recipient & { status: 'pending' | 'approved' | 'declined' })[];
}
export const consentTypes = {
  RevenueConsent: [
    { name: 'revision', type: 'bytes32' },
    { name: 'project', type: 'string' },
    { name: 'fileHash', type: 'bytes32' },
    { name: 'creator', type: 'address' },
    { name: 'allocationHash', type: 'bytes32' },
    { name: 'recipient', type: 'address' },
    { name: 'shareBps', type: 'uint16' },
    { name: 'statement', type: 'string' },
  ],
} as const;
export const consentDomain = (salt: Hex) =>
  ({ name: 'ArtGuardRevenueConsent', version: '1', chainId: 31337, salt }) as const;
export interface ConsentRequest {
  versionId: string;
  domain: ReturnType<typeof consentDomain>;
  message: {
    revision: Hex;
    project: string;
    fileHash: Hex;
    creator: Address;
    allocationHash: Hex;
    recipient: Address;
    shareBps: number;
    statement: string;
  };
}
