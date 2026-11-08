import type { PlanId } from './types.js';
export type AccountingCurrency = 'local_usd' | 'test_eth';
export interface AccountingAllocation {
  id: string;
  userId: string | null;
  name: string;
  wallet: string | null;
  creator: boolean;
  amount: string;
}
export interface AccountingEvent {
  id: string;
  sourceKey: string;
  kind: 'sale' | 'subscription' | 'promotion';
  currency: AccountingCurrency;
  buyerId: string;
  sellerId: string | null;
  artworkId: string | null;
  title: string;
  license: string | null;
  purchaseId: string | null;
  gross: string;
  fee: string;
  net: string;
  allocations: AccountingAllocation[];
  buyerWallet: string | null;
  sellerWallet: string | null;
  transactionHash: string | null;
  contractAddress: string | null;
  instanceId: string | null;
  occurredAt: string;
  recordedAt: string;
  supersededBy: string | null;
}
export interface FinancialTotals {
  sales: number;
  gross: string;
  commission: string;
  creatorNet: string;
  coauthorNet: string;
  subscriptions: string;
  promotions: string;
  platformRevenue: string;
}
export interface WalletBalance {
  address: string;
  nativeWei: string;
  marketplaceWei: string;
  subscriptionWei: string;
  promotionWei?: string;
  contracts: {
    address: string;
    kind: 'marketplace' | 'subscription' | 'promotion';
    creditWei: string;
  }[];
}
export interface BalanceSnapshot {
  id: string;
  instanceId: string;
  blockNumber: string;
  blockHash: string;
  observedAt: string;
  wallets: WalletBalance[];
  platform: {
    treasuries: string[];
    nativeWei: string;
    marketplaceWei: string;
    subscriptionWei: string;
    promotionWei?: string;
    availableWei: string;
  };
}
export interface AccountingProduct {
  id: string;
  ownerId: string;
  owner: string;
  title: string;
  priceCents: number;
  status: 'listed' | 'draft' | 'hidden' | 'approval_required' | 'deleted';
  published: boolean;
  hash: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  sales: number;
  chainSales: number;
  localSales: number;
}
export interface AccountingUser {
  id: string;
  name: string;
  email: string;
  plan: PlanId;
  disabled: boolean;
  emailVerified: boolean;
  isAdmin: boolean;
  createdAt: string;
  wallet: string | null;
  walletHistory: { id: string; address: string; linkedAt: string; unlinkedAt: string | null }[];
  balance: WalletBalance | null;
  products: number;
  listed: number;
  soldProducts: number;
  sales: number;
  totals: Record<AccountingCurrency, FinancialTotals>;
  earned: Record<AccountingCurrency, string>;
}
export interface AccountingData {
  generatedAt: string;
  counts: {
    users: number;
    activeAccounts: number;
    sampleAccounts: number;
    products: number;
    listed: number;
    drafts: number;
    hidden: number;
    awaitingApproval: number;
    deleted: number;
    soldProducts: number;
    sales: number;
  };
  catalogValueCents: string;
  totals: Record<AccountingCurrency, FinancialTotals>;
  users: AccountingUser[];
  products: AccountingProduct[];
  events: AccountingEvent[];
  balanceSnapshot: BalanceSnapshot | null;
}
