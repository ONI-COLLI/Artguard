import { parseAbi, type Address, type Hex } from 'viem';

export const promotionPriceCents = 500;
export const promotionPriceWei = '5000000000000000';
export const promotionPeriod = 7 * 86400;
export const promotionAbi = parseAbi([
  'struct Quote { bytes32 id; bytes32 projectId; address buyer; uint256 amount; uint64 expiresAt; uint64 expectedUntil; bytes32 instanceId; }',
  'function purchase(Quote quote, bytes signature) payable',
  'function instanceId() view returns(bytes32)',
  'function quoteSigner() view returns(address)',
  'function treasury() view returns(address)',
  'function promotedUntil(bytes32) view returns(uint64)',
  'function usedQuotes(bytes32) view returns(bool)',
  'function balances(address) view returns(uint256)',
  'function withdraw()',
  'event PromotionPurchased(bytes32 indexed quoteId, bytes32 indexed projectId, address indexed buyer, uint256 amount, uint64 startsAt, uint64 validUntil)',
  'error InvalidQuote()',
  'error InvalidPayment()',
  'error NothingToWithdraw()',
]);
export const promotionTypes = {
  Quote: [
    { name: 'id', type: 'bytes32' },
    { name: 'projectId', type: 'bytes32' },
    { name: 'buyer', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'expiresAt', type: 'uint64' },
    { name: 'expectedUntil', type: 'uint64' },
    { name: 'instanceId', type: 'bytes32' },
  ],
} as const;
export const promotionDomain = (address: Address) =>
  ({
    name: 'ArtGuardPromotions',
    version: '1',
    chainId: 31337,
    verifyingContract: address,
  }) as const;
export interface PromotionQuote {
  id: Hex;
  projectId: Hex;
  buyer: Address;
  amount: string;
  expiresAt: number;
  expectedUntil: number;
  instanceId: Hex;
}
export const promotionMessage = (q: PromotionQuote) => ({
  ...q,
  amount: BigInt(q.amount),
  expiresAt: BigInt(q.expiresAt),
  expectedUntil: BigInt(q.expectedUntil),
});
export interface PromotionOrder {
  id: Hex;
  artworkId: string;
  title: string;
  contractAddress: Address;
  quote: PromotionQuote;
  signature: Hex;
  status: 'prepared' | 'pending' | 'confirmed' | 'failed';
  transactionHash: Hex | null;
  startsAt: number | null;
  validUntil: number | null;
  error: string | null;
}
export interface PromotionState {
  startsAt: number;
  validUntil: number;
}
