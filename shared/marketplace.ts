import { parseAbi, type Address, type Hex, formatEther } from 'viem';
import type { LicenseId } from './types.js';
export const legacyMarketplaceAbi = parseAbi([
  'struct Quote { bytes32 id; address buyer; address seller; bytes32 fileHash; uint8 licenseType; bytes32 termsHash; uint256 amount; uint16 feeBps; uint64 expiresAt; bytes32 instanceId; }',
  'function buyLicenses(Quote[] quotes, bytes[] signatures) payable',
  'function instanceId() view returns (bytes32)',
  'function registry() view returns (address)',
  'function quoteSigner() view returns (address)',
  'function treasury() view returns (address)',
  'function balances(address) view returns (uint256)',
  'function usedQuotes(bytes32) view returns (bool)',
  'function hasLicense(address buyer, bytes32 fileHash, uint8 licenseType) view returns (bool)',
  'function withdraw()',
  'event LicensePurchased(bytes32 indexed quoteId, address indexed buyer, address indexed seller, bytes32 fileHash, uint8 licenseType, bytes32 termsHash, uint256 amount, uint256 fee, uint64 purchasedAt)',
  'event ProceedsWithdrawn(address indexed recipient, uint256 amount)',
  'error InvalidQuote()',
  'error InvalidPayment()',
  'error AlreadyLicensed()',
  'error NothingToWithdraw()',
  'error WithdrawalFailed()',
]);
export const marketplaceAbi = [
  ...parseAbi([
    'struct Quote { bytes32 id; address buyer; address seller; bytes32 fileHash; uint8 licenseType; bytes32 termsHash; uint256 amount; uint16 feeBps; uint64 expiresAt; bytes32 instanceId; address[] recipients; uint16[] shares; }',
    'function buyLicenses(Quote[] quotes, bytes[] signatures) payable',
    'function version() view returns (uint256)',
    'function previousMarketplace() view returns (address)',
    'event RevenueAllocated(bytes32 indexed quoteId, address indexed recipient, uint256 amount, uint16 shareBps)',
    'error InvalidShares()',
  ]),
  ...legacyMarketplaceAbi.filter(
    (entry) => entry.type !== 'function' || entry.name !== 'buyLicenses',
  ),
] as const;
export const legacyQuoteTypes = {
  Quote: [
    { name: 'id', type: 'bytes32' },
    { name: 'buyer', type: 'address' },
    { name: 'seller', type: 'address' },
    { name: 'fileHash', type: 'bytes32' },
    { name: 'licenseType', type: 'uint8' },
    { name: 'termsHash', type: 'bytes32' },
    { name: 'amount', type: 'uint256' },
    { name: 'feeBps', type: 'uint16' },
    { name: 'expiresAt', type: 'uint64' },
    { name: 'instanceId', type: 'bytes32' },
  ],
} as const;
export const quoteTypes = {
  Quote: [
    ...legacyQuoteTypes.Quote,
    { name: 'recipients', type: 'address[]' },
    { name: 'shares', type: 'uint16[]' },
  ],
} as const;
export const termQuoteTypes = {
  Quote: [...quoteTypes.Quote, { name: 'durationSeconds', type: 'uint64' }],
} as const;
export const termMarketplaceAbi = [
  ...marketplaceAbi.filter((e) => e.type !== 'function' || e.name !== 'buyLicenses'),
  ...parseAbi([
    'struct Quote { bytes32 id; address buyer; address seller; bytes32 fileHash; uint8 licenseType; bytes32 termsHash; uint256 amount; uint16 feeBps; uint64 expiresAt; bytes32 instanceId; address[] recipients; uint16[] shares; uint64 durationSeconds; }',
    'function buyLicenses(Quote[] quotes, bytes[] signatures) payable',
    'function licenseExpiry(address buyer, bytes32 fileHash, uint8 licenseType) view returns (uint64)',
    'event LicenseValidity(bytes32 indexed quoteId, uint64 validFrom, uint64 validUntil)',
  ]),
] as const;
export const escrowAbi = [
  ...termMarketplaceAbi,
  ...parseAbi([
    'struct Escrow { address buyer; address seller; bytes32 fileHash; uint8 licenseType; uint256 amount; uint256 fee; uint64 durationSeconds; uint8 state; uint64 deliveryDeadline; uint64 reviewDeadline; uint64 disputeDeadline; }',
    'function getEscrow(bytes32 id) view returns (Escrow)',
    'function pendingLicenses(bytes32) view returns (bytes32)',
    'function arbiter() view returns (address)',
    'function deliveryPeriod() view returns (uint64)',
    'function reviewPeriod() view returns (uint64)',
    'function disputePeriod() view returns (uint64)',
    'function refundBalances(address) view returns (uint256)',
    'function markDelivered(bytes32 id)',
    'function dispute(bytes32 id)',
    'function release(bytes32 id)',
    'function refund(bytes32 id)',
    'function resolveDispute(bytes32 id,bool refundBuyer)',
    'function withdrawRefund()',
    'event EscrowFunded(bytes32 indexed quoteId,address indexed buyer,address indexed seller,bytes32 fileHash,uint8 licenseType,bytes32 termsHash,uint256 amount,uint256 fee,uint64 durationSeconds,uint64 deliveryDeadline)',
    'event EscrowDelivered(bytes32 indexed quoteId,uint64 reviewDeadline)',
    'event EscrowDisputed(bytes32 indexed quoteId,uint64 disputeDeadline)',
    'event EscrowReleased(bytes32 indexed quoteId,uint64 releasedAt)',
    'event EscrowRefunded(bytes32 indexed quoteId,address indexed buyer,uint256 amount)',
    'event RefundWithdrawn(address indexed buyer,uint256 amount)',
    'event DisputeResolved(bytes32 indexed quoteId,bool refunded)',
    'error InvalidState()',
    'error Unauthorized()',
    'error TooEarly()',
  ]),
] as const;

export const marketAbi = (version?: number) =>
  version === 4
    ? escrowAbi
    : version === 3
      ? termMarketplaceAbi
      : version === 1
        ? legacyMarketplaceAbi
        : marketplaceAbi;
export const licensePeriodLabel = (days?: number) =>
  days ? `${days} days from activation` : 'Perpetual license';
export const licenseNumber: Record<LicenseId, number> = { personal: 1, commercial: 2, extended: 3 };
// A fixed local demonstration rule, not an exchange rate: $1 catalog price = 0.001 test ETH.
export const testWeiPerCent = 10_000_000_000_000n;
export const testEth = (wei: string | bigint) => `${formatEther(BigInt(wei))} test ETH`;
export interface MarketDeployment {
  version: 1 | 2 | 3 | 4;
  chainId: 31337;
  address: Address;
  instanceId: Hex;
  registryAddress: Address;
  quoteSigner: Address;
  treasury: Address;
  transactionHash: Hex;
}
export interface MarketStatus {
  ready: boolean;
  deployment: MarketDeployment | null;
  message: string;
  contracts?: MarketDeployment[];
}
export interface LicenseQuote {
  durationSeconds?: number;
  id: Hex;
  buyer: Address;
  seller: Address;
  fileHash: Hex;
  licenseType: number;
  termsHash: Hex;
  amount: string;
  feeBps: number;
  expiresAt: number;
  instanceId: Hex;
  recipients?: Address[];
  shares?: number[];
}
export const contractQuote = (quote: LicenseQuote) => ({
  ...quote,
  amount: BigInt(quote.amount),
  expiresAt: BigInt(quote.expiresAt),
  recipients: quote.recipients || [],
  shares: quote.shares || [],
  durationSeconds: BigInt(quote.durationSeconds || 0),
});
export const quoteDomain = (address: Address, version = 2) =>
  ({
    name: 'ArtGuardLicenses',
    version: String(version),
    chainId: 31337,
    verifyingContract: address,
  }) as const;
export interface RevenueAllocation {
  name: string;
  wallet: Address;
  percent: number;
  amountWei: string;
  creator: boolean;
}
export interface ChainCheckoutItem {
  artworkId: string;
  title: string;
  license: LicenseId;
  quote: LicenseQuote;
  signature: Hex;
  terms: string;
  referenceAmount: number;
  feeWei: string;
  allocations?: RevenueAllocation[];
}
export interface ChainCheckout {
  marketVersion?: 1 | 2 | 3 | 4;
  id: string;
  buyerWallet: Address;
  instanceId: Hex;
  contractAddress: Address;
  status: 'prepared' | 'pending' | 'confirmed' | 'failed';
  expiresAt: number;
  transactionHash: Hex | null;
  totalWei: string;
  items: ChainCheckoutItem[];
  purchaseIds: string[];
  error: string | null;
}
export interface BlockchainPayment {
  escrow?: { fundingTransactionHash: Hex; releaseTransactionHash: Hex };
  allocations?: RevenueAllocation[];
  chainId: number;
  contractAddress: Address;
  instanceId: Hex;
  transactionHash: Hex;
  quoteId: Hex;
  buyerWallet: Address;
  sellerWallet: Address;
  amountWei: string;
  feeWei: string;
  termsHash: Hex;
}
