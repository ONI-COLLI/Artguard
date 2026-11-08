import { randomUUID } from 'node:crypto';
import type { Repository, PurchaseRow } from './repository.js';
import { paymentFor } from './chain-checkouts.js';
import type { AccountingAllocation, AccountingEvent } from '../shared/accounting.js';
const now = () => new Date().toISOString();
export function trackWallet(repo: Repository, userId: string) {
  const current = repo.wallet(userId),
    time = now();
  repo.run(
    'UPDATE wallet_history SET unlinked_at=? WHERE user_id=? AND unlinked_at IS NULL AND (address<>? COLLATE NOCASE OR linked_at<>?)',
    time,
    userId,
    current?.address || '',
    current?.linkedAt || '',
  );
  if (current)
    repo.run(
      'INSERT OR IGNORE INTO wallet_history VALUES(?,?,?,?,NULL)',
      randomUUID(),
      userId,
      current.address,
      current.linkedAt,
    );
}
export function archiveProduct(
  repo: Repository,
  id: string,
  action: 'created' | 'updated' | 'deleted' | 'imported',
) {
  const artwork = repo.artwork(id);
  if (!artwork) return;
  const snapshot = JSON.stringify({ ...artwork, recipients: repo.artworkRecipients(id) }),
    time = now();
  if (action === 'imported' && repo.one('SELECT 1 FROM product_archive WHERE id=?', id)) return;
  repo.run(
    'INSERT INTO product_archive VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET snapshot_json=excluded.snapshot_json,updated_at=excluded.updated_at,deleted_at=excluded.deleted_at',
    id,
    artwork.owner_id,
    snapshot,
    time,
    action === 'deleted' ? time : null,
  );
  repo.run(
    'INSERT INTO product_history VALUES(?,?,?,?,?,?)',
    randomUUID(),
    id,
    artwork.owner_id,
    action,
    snapshot,
    time,
  );
}
function recipientUser(repo: Repository, wallet: string | undefined, time: string) {
  if (!wallet) return null;
  // EVM timestamps have second precision. If a wallet changed accounts in that
  // second, retain the wallet credit without guessing which account owned it.
  const upper = time.endsWith('.000Z') ? new Date(Date.parse(time) + 999).toISOString() : time;
  const matches = repo.all<{ user_id: string }>(
    'SELECT DISTINCT user_id FROM wallet_history WHERE address=? COLLATE NOCASE AND linked_at<=? AND (unlinked_at IS NULL OR unlinked_at>?)',
    wallet,
    upper,
    time,
  );
  return matches.length === 1 ? matches[0].user_id : null;
}
function insert(
  repo: Repository,
  event: Omit<AccountingEvent, 'id' | 'recordedAt' | 'supersededBy'>,
) {
  const table = event.kind === 'promotion' ? 'promotion_accounting_events' : 'accounting_events';
  const existing = repo.one<{ id: string }>(
    `SELECT id FROM ${table} WHERE source_key=?`,
    event.sourceKey,
  );
  if (existing) return existing.id;
  const id = randomUUID();
  repo.run(
    `INSERT INTO ${table} VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id,
    event.sourceKey,
    event.kind,
    event.currency,
    event.buyerId,
    event.sellerId,
    event.artworkId,
    event.title,
    event.license,
    event.purchaseId,
    event.gross,
    event.fee,
    event.net,
    JSON.stringify(event.allocations),
    event.buyerWallet,
    event.sellerWallet,
    event.transactionHash,
    event.contractAddress,
    event.instanceId,
    event.occurredAt,
    now(),
  );
  return id;
}
export function recordLocalSale(repo: Repository, p: PurchaseRow) {
  const a = repo.artwork(p.artwork_id)!;
  const raw = JSON.parse(p.allocations) as {
    name: string;
    wallet?: string;
    percent: number;
    amount: number;
  }[];
  const allocations: AccountingAllocation[] = raw.map((r, i) => ({
    id: randomUUID(),
    userId: i === 0 ? a.owner_id : recipientUser(repo, r.wallet, p.created_at),
    name: r.name,
    wallet: r.wallet || (i === 0 ? repo.wallet(a.owner_id)?.address : null) || null,
    creator: i === 0,
    amount: String(Math.round(r.amount * 100)),
  }));
  return insert(repo, {
    sourceKey: 'local:' + p.id,
    kind: 'sale',
    currency: 'local_usd',
    buyerId: p.buyer_id,
    sellerId: a.owner_id,
    artworkId: a.id,
    title: a.title,
    license: p.license,
    purchaseId: p.id,
    gross: String(p.amount),
    fee: String(p.commission),
    net: String(p.amount - p.commission),
    allocations,
    buyerWallet: null,
    sellerWallet: allocations[0]?.wallet || null,
    transactionHash: null,
    contractAddress: null,
    instanceId: null,
    occurredAt: p.created_at,
  });
}
export function recordPurchase(repo: Repository, purchaseId: string, quoteId?: string) {
  const p = repo.one<PurchaseRow>('SELECT * FROM purchases WHERE id=?', purchaseId)!;
  const payment = paymentFor(repo, p.id, quoteId);
  if (!payment) return recordLocalSale(repo, p);
  const item = repo.one<{ title: string; seller_id: string; previous_local_record: string | null }>(
    'SELECT title,seller_id,previous_local_record FROM chain_checkout_items WHERE quote_id=?',
    payment.quoteId,
  )!;
  const occurredAt = repo.one<{ confirmed_at: string }>(
    'SELECT coalesce(e.settled_at,c.confirmed_at) confirmed_at FROM chain_checkouts c JOIN chain_checkout_items i ON i.checkout_id=c.id LEFT JOIN escrow_records e ON e.quote_id=i.quote_id WHERE i.quote_id=?',
    payment.quoteId,
  )!.confirmed_at;
  const allocations: AccountingAllocation[] = payment.allocations!.map((r) => ({
    id: randomUUID(),
    userId: r.creator ? item.seller_id : recipientUser(repo, r.wallet, occurredAt),
    name: r.name,
    wallet: r.wallet,
    creator: r.creator,
    amount: r.amountWei,
  }));
  const id = insert(repo, {
    sourceKey: 'chain:' + payment.quoteId,
    kind: 'sale',
    currency: 'test_eth',
    buyerId: p.buyer_id,
    sellerId: item.seller_id,
    artworkId: p.artwork_id,
    title: item.title,
    license: p.license,
    purchaseId: p.id,
    gross: payment.amountWei,
    fee: payment.feeWei,
    net: String(BigInt(payment.amountWei) - BigInt(payment.feeWei)),
    allocations,
    buyerWallet: payment.buyerWallet,
    sellerWallet: payment.sellerWallet,
    transactionHash: payment.transactionHash,
    contractAddress: payment.contractAddress,
    instanceId: payment.instanceId,
    occurredAt,
  });
  if (item.previous_local_record) {
    const local = recordLocalSale(repo, JSON.parse(item.previous_local_record));
    repo.run('INSERT OR IGNORE INTO accounting_supersessions VALUES(?,?)', local, id);
  }
  return id;
}
export function recordSubscription(repo: Repository, orderId: string, occurredAt?: string) {
  const row = repo.one<{
    id: string;
    user_id: string;
    plan: string;
    amount_wei: string;
    buyer_wallet: string;
    contract_address: string;
    instance_id: string;
    tx_hash: string;
    created_at: string;
  }>("SELECT * FROM subscription_orders WHERE id=? AND status='confirmed'", orderId);
  if (!row) return;
  insert(repo, {
    sourceKey: 'subscription:' + row.id,
    kind: 'subscription',
    currency: 'test_eth',
    buyerId: row.user_id,
    sellerId: null,
    artworkId: null,
    title: row.plan + ' · 30 days',
    license: null,
    purchaseId: null,
    gross: row.amount_wei,
    fee: '0',
    net: row.amount_wei,
    allocations: [],
    buyerWallet: row.buyer_wallet,
    sellerWallet: null,
    transactionHash: row.tx_hash,
    contractAddress: row.contract_address,
    instanceId: row.instance_id,
    occurredAt: occurredAt || row.created_at,
  });
}
export function backfillAccounting(repo: Repository) {
  repo.db.exec('BEGIN IMMEDIATE');
  try {
    for (const { id } of repo.all<{ id: string }>('SELECT id FROM users')) trackWallet(repo, id);
    for (const { id } of repo.all<{ id: string }>('SELECT id FROM artworks'))
      archiveProduct(repo, id, 'imported');
    for (const { id } of repo.all<{ id: string }>('SELECT id FROM purchases'))
      recordPurchase(repo, id);
    for (const { id } of repo.all<{ id: string }>(
      "SELECT id FROM subscription_orders WHERE status='confirmed'",
    ))
      recordSubscription(repo, id);
    for (const { id } of repo.all<{ id: string }>(
      "SELECT id FROM promotion_orders WHERE status='confirmed'",
    ))
      recordPromotion(repo, id);
    repo.db.exec('COMMIT');
  } catch (error) {
    repo.db.exec('ROLLBACK');
    throw error;
  }
}
export function recordPromotion(repo: Repository, orderId: string, occurredAt?: string) {
  const row = repo.one<{
    id: string;
    user_id: string;
    artwork_id: string;
    title: string;
    buyer_wallet: string;
    amount_wei: string;
    contract_address: string;
    instance_id: string;
    tx_hash: string;
    starts_at: number;
  }>("SELECT * FROM promotion_orders WHERE id=? AND status='confirmed'", orderId);
  if (!row) return;
  return insert(repo, {
    sourceKey: 'promotion:' + row.id,
    kind: 'promotion',
    currency: 'test_eth',
    buyerId: row.user_id,
    sellerId: null,
    artworkId: row.artwork_id,
    title: row.title + ' · 7-day promotion',
    license: null,
    purchaseId: null,
    gross: row.amount_wei,
    fee: '0',
    net: row.amount_wei,
    allocations: [],
    buyerWallet: row.buyer_wallet,
    sellerWallet: null,
    transactionHash: row.tx_hash,
    contractAddress: row.contract_address,
    instanceId: row.instance_id,
    occurredAt: occurredAt || new Date(row.starts_at * 1000).toISOString(),
  });
}
