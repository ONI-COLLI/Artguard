import type { Address, Hex } from 'viem';
import type {
  ChainCheckout,
  ChainCheckoutItem,
  BlockchainPayment,
  LicenseQuote,
  RevenueAllocation,
} from '../shared/marketplace.js';
import { licenseNumber } from '../shared/marketplace.js';
import type { LicenseId } from '../shared/types.js';
import type { Repository } from './repository.js';
export interface CheckoutRow {
  id: string;
  buyer_id: string;
  buyer_wallet: Address;
  instance_id: Hex;
  contract_address: Address;
  status: ChainCheckout['status'];
  expires_at: number;
  tx_hash: Hex | null;
  block_number: string | null;
  confirmed_at: string | null;
  total_wei: string;
  error: string | null;
}
export interface CheckoutItemRow {
  duration_seconds?: number;
  quote_id: Hex;
  checkout_id: string;
  artwork_id: string;
  seller_id: string;
  title: string;
  license: LicenseId;
  seller_wallet: Address;
  file_hash: Hex;
  terms_hash: Hex;
  terms_json: string;
  amount: number;
  commission: number;
  amount_wei: string;
  fee_wei: string;
  fee_bps: number;
  signature: Hex;
  purchase_id: string | null;
}
export function allocationsFor(repo: Repository, item: CheckoutItemRow): RevenueAllocation[] {
  const saved = repo.one<{ allocations_json: string }>(
    'SELECT allocations_json FROM chain_revenue_splits WHERE quote_id=?',
    item.quote_id,
  );
  return saved
    ? JSON.parse(saved.allocations_json)
    : [
        {
          name: repo.user(item.seller_id).name,
          wallet: item.seller_wallet,
          percent: 100,
          amountWei: String(BigInt(item.amount_wei) - BigInt(item.fee_wei)),
          creator: true,
        },
      ];
}
export function quoteFor(
  checkout: CheckoutRow,
  item: CheckoutItemRow,
  allocations: RevenueAllocation[] = [],
): LicenseQuote {
  return {
    durationSeconds: item.duration_seconds || 0,
    id: item.quote_id,
    buyer: checkout.buyer_wallet,
    seller: item.seller_wallet,
    fileHash: item.file_hash,
    licenseType: licenseNumber[item.license],
    termsHash: item.terms_hash,
    amount: item.amount_wei,
    feeBps: item.fee_bps,
    expiresAt: checkout.expires_at,
    instanceId: checkout.instance_id,
    recipients: allocations.filter((a) => !a.creator).map((a) => a.wallet),
    shares: allocations.filter((a) => !a.creator).map((a) => a.percent * 100),
  };
}
export function serializeCheckout(repo: Repository, row: CheckoutRow): ChainCheckout {
  const items = repo.all<CheckoutItemRow>(
    'SELECT i.*,coalesce(i.purchase_id,l.purchase_id) AS purchase_id,p.duration_seconds FROM chain_checkout_items i LEFT JOIN chain_purchase_links l ON l.quote_id=i.quote_id LEFT JOIN chain_license_periods p ON p.quote_id=i.quote_id WHERE checkout_id=? ORDER BY i.quote_id',
    row.id,
  );
  return {
    marketVersion:
      repo.one<{ market_version: 1 | 2 | 3 | 4 }>(
        'SELECT market_version FROM chain_checkout_versions WHERE checkout_id=?',
        row.id,
      )?.market_version || 1,
    id: row.id,
    buyerWallet: row.buyer_wallet,
    instanceId: row.instance_id,
    contractAddress: row.contract_address,
    status: row.status,
    expiresAt: row.expires_at,
    transactionHash: row.tx_hash,
    totalWei: row.total_wei,
    error: row.error,
    purchaseIds: items.flatMap((i) => (i.purchase_id ? [i.purchase_id] : [])),
    items: items.map((item): ChainCheckoutItem => ({
      artworkId: item.artwork_id,
      title: item.title,
      license: item.license,
      quote: quoteFor(row, item, allocationsFor(repo, item)),
      allocations: allocationsFor(repo, item),
      signature: item.signature,
      terms: item.terms_json,
      referenceAmount: item.amount / 100,
      feeWei: item.fee_wei,
    })),
  };
}
export function paymentFor(
  repo: Repository,
  purchaseId: string,
  quoteId?: string,
): BlockchainPayment | null {
  const row = repo.one<CheckoutItemRow & CheckoutRow & { funding_tx?: Hex; release_tx?: Hex }>(
    "SELECT i.*,c.buyer_wallet,c.instance_id,c.contract_address,e.funding_tx,e.release_tx,coalesce(e.release_tx,c.tx_hash) tx_hash FROM chain_checkout_items i JOIN chain_checkouts c ON c.id=i.checkout_id LEFT JOIN chain_purchase_links l ON l.quote_id=i.quote_id LEFT JOIN escrow_records e ON e.quote_id=i.quote_id WHERE coalesce(i.purchase_id,l.purchase_id)=? AND c.status='confirmed' AND (e.quote_id IS NULL OR e.state='released') AND (? IS NULL OR i.quote_id=?) ORDER BY coalesce(e.settled_at,c.confirmed_at) DESC,c.rowid DESC LIMIT 1",
    purchaseId,
    quoteId || null,
    quoteId || null,
  );
  if (!row?.tx_hash) return null;
  return {
    chainId: 31337,
    contractAddress: row.contract_address,
    instanceId: row.instance_id,
    transactionHash: row.tx_hash,
    quoteId: row.quote_id,
    buyerWallet: row.buyer_wallet,
    sellerWallet: row.seller_wallet,
    amountWei: row.amount_wei,
    feeWei: row.fee_wei,
    termsHash: row.terms_hash,
    allocations: allocationsFor(repo, row),
    ...(row.funding_tx && row.release_tx
      ? {
          escrow: {
            fundingTransactionHash: row.funding_tx,
            releaseTransactionHash: row.release_tx,
          },
        }
      : {}),
  };
}
