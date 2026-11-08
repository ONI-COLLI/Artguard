import type { Repository, ArtworkRow, UserRow } from './repository.js';
import type {
  AccountingData,
  AccountingEvent,
  AccountingProduct,
  AccountingUser,
  FinancialTotals,
  BalanceSnapshot,
} from '../shared/accounting.js';
import { shareStatus } from './consents.js';
const zero = (): FinancialTotals => ({
  sales: 0,
  gross: '0',
  commission: '0',
  creatorNet: '0',
  coauthorNet: '0',
  subscriptions: '0',
  promotions: '0',
  platformRevenue: '0',
});
function add(t: FinancialTotals, e: AccountingEvent) {
  const sum = (key: keyof Omit<FinancialTotals, 'sales'>, v: string) => {
    t[key] = String(BigInt(t[key]) + BigInt(v));
  };
  if (e.kind === 'subscription' || e.kind === 'promotion') {
    sum(e.kind === 'promotion' ? 'promotions' : 'subscriptions', e.gross);
    sum('platformRevenue', e.gross);
    return;
  }
  t.sales++;
  sum('gross', e.gross);
  sum('commission', e.fee);
  sum('platformRevenue', e.fee);
  for (const a of e.allocations) sum(a.creator ? 'creatorNet' : 'coauthorNet', a.amount);
}
export function accountingData(repo: Repository): AccountingData {
  const rows = repo.all<Record<string, unknown>>(
    'SELECT e.*,s.chain_event_id AS superseded_by FROM accounting_events e LEFT JOIN accounting_supersessions s ON s.local_event_id=e.id UNION ALL SELECT e.*,NULL AS superseded_by FROM promotion_accounting_events e ORDER BY occurred_at DESC,id',
  );
  const events: AccountingEvent[] = rows.map((e) => ({
    id: String(e.id),
    sourceKey: String(e.source_key),
    kind: e.kind as AccountingEvent['kind'],
    currency: e.currency as AccountingEvent['currency'],
    buyerId: String(e.buyer_id),
    sellerId: e.seller_id as string | null,
    artworkId: e.artwork_id as string | null,
    title: String(e.title),
    license: e.license as string | null,
    purchaseId: e.purchase_id as string | null,
    gross: String(e.gross),
    fee: String(e.fee),
    net: String(e.net),
    allocations: JSON.parse(String(e.allocations_json)),
    buyerWallet: e.buyer_wallet as string | null,
    sellerWallet: e.seller_wallet as string | null,
    transactionHash: e.transaction_hash as string | null,
    contractAddress: e.contract_address as string | null,
    instanceId: e.instance_id as string | null,
    occurredAt: String(e.occurred_at),
    recordedAt: String(e.recorded_at),
    supersededBy: e.superseded_by as string | null,
  }));
  const active = events.filter((e) => !e.supersededBy),
    sales = active.filter((e) => e.kind === 'sale');
  const totals = { local_usd: zero(), test_eth: zero() };
  for (const e of active) add(totals[e.currency], e);
  const saleCounts = new Map<string, { local: number; chain: number }>();
  for (const e of sales) {
    const c = saleCounts.get(e.artworkId!) || { local: 0, chain: 0 };
    c[e.currency === 'test_eth' ? 'chain' : 'local']++;
    saleCounts.set(e.artworkId!, c);
  }
  const products: AccountingProduct[] = repo
    .all<{
      id: string;
      owner_id: string;
      snapshot_json: string;
      updated_at: string;
      deleted_at: string | null;
    }>('SELECT * FROM product_archive ORDER BY updated_at DESC,id')
    .map((row) => {
      const saved = JSON.parse(row.snapshot_json) as ArtworkRow,
        live = repo.artwork(row.id),
        a = live || saved,
        hidden = !!live && repo.hidden(row.id),
        approved = !live || shareStatus(repo, row.id).ready,
        c = saleCounts.get(row.id) || { local: 0, chain: 0 };
      return {
        id: row.id,
        ownerId: row.owner_id,
        owner: repo.user(row.owner_id).name,
        title: a.title,
        priceCents: a.price,
        status: row.deleted_at
          ? 'deleted'
          : hidden
            ? 'hidden'
            : a.status === 'draft'
              ? 'draft'
              : !approved
                ? 'approval_required'
                : 'listed',
        published: a.status === 'published',
        hash: a.hash,
        createdAt: a.created_at,
        updatedAt: row.updated_at,
        deletedAt: row.deleted_at,
        sales: c.local + c.chain,
        chainSales: c.chain,
        localSales: c.local,
      };
    });
  const snapshotRow = repo.one<{
    id: string;
    instance_id: string;
    block_number: string;
    block_hash: string;
    observed_at: string;
    data_json: string;
  }>('SELECT * FROM accounting_balance_snapshots ORDER BY rowid DESC LIMIT 1');
  const balanceSnapshot: BalanceSnapshot | null = snapshotRow
    ? {
        id: snapshotRow.id,
        instanceId: snapshotRow.instance_id,
        blockNumber: snapshotRow.block_number,
        blockHash: snapshotRow.block_hash,
        observedAt: snapshotRow.observed_at,
        ...JSON.parse(snapshotRow.data_json),
      }
    : null;
  const userMap = new Map<string, AccountingUser>();
  for (const row of repo.all<UserRow>('SELECT * FROM users ORDER BY created_at DESC,id')) {
    const wallet = repo.wallet(row.id)?.address || null;
    userMap.set(row.id, {
      id: row.id,
      name: row.name,
      email: row.email,
      plan: repo.user(row.id).plan,
      disabled: row.password_hash === 'disabled',
      emailVerified: repo.emailVerified(row.id),
      isAdmin: repo.isAdmin(row.id),
      createdAt: row.created_at,
      wallet,
      walletHistory: repo.all(
        'SELECT id,address,linked_at AS linkedAt,unlinked_at AS unlinkedAt FROM wallet_history WHERE user_id=? ORDER BY linked_at DESC',
        row.id,
      ),
      balance: wallet
        ? balanceSnapshot?.wallets.find((w) => w.address.toLowerCase() === wallet.toLowerCase()) ||
          null
        : null,
      products: 0,
      listed: 0,
      soldProducts: 0,
      sales: 0,
      totals: { local_usd: zero(), test_eth: zero() },
      earned: { local_usd: '0', test_eth: '0' },
    });
  }
  for (const p of products) {
    const u = userMap.get(p.ownerId)!;
    if (p.status !== 'deleted') u.products++;
    if (p.status === 'listed') u.listed++;
    if (p.sales) u.soldProducts++;
  }
  for (const e of sales) {
    const seller = userMap.get(e.sellerId!)!;
    seller.sales++;
    add(seller.totals[e.currency], e);
    for (const a of e.allocations) {
      const u = a.userId ? userMap.get(a.userId) : null;
      if (u) u.earned[e.currency] = String(BigInt(u.earned[e.currency]) + BigInt(a.amount));
    }
  }
  const users = [...userMap.values()];
  return {
    generatedAt: new Date().toISOString(),
    counts: {
      users: users.length,
      activeAccounts: users.filter((u) => !u.disabled).length,
      sampleAccounts: users.filter((u) => u.disabled).length,
      products: products.filter((p) => p.status !== 'deleted').length,
      listed: products.filter((p) => p.status === 'listed').length,
      drafts: products.filter((p) => p.status === 'draft').length,
      hidden: products.filter((p) => p.status === 'hidden').length,
      awaitingApproval: products.filter((p) => p.status === 'approval_required').length,
      deleted: products.filter((p) => p.status === 'deleted').length,
      soldProducts: saleCounts.size,
      sales: sales.length,
    },
    catalogValueCents: String(
      products.filter((p) => p.status === 'listed').reduce((n, p) => n + BigInt(p.priceCents), 0n),
    ),
    totals,
    users,
    products,
    events,
    balanceSnapshot,
  };
}
export function accountingExport(repo: Repository) {
  return {
    ...accountingData(repo),
    promotionOrders: repo.all(
      'SELECT id,user_id,artwork_id,title,buyer_wallet,contract_address,instance_id,amount_wei,status,tx_hash,starts_at,valid_until,created_at FROM promotion_orders ORDER BY created_at,id',
    ),
    units: {
      local_usd: 'integer USD cents; simulated orders without payment',
      test_eth: 'integer wei on the local test network',
      catalogValueCents: 'base catalog prices, not received funds',
    },
    productHistory: repo
      .all<{
        id: string;
        artworkId: string;
        ownerId: string;
        action: string;
        snapshot: string;
        createdAt: string;
      }>(
        'SELECT id,artwork_id AS artworkId,owner_id AS ownerId,action,snapshot_json AS snapshot,created_at AS createdAt FROM product_history ORDER BY created_at,id',
      )
      .map((row) => ({ ...row, snapshot: JSON.parse(row.snapshot) })),
    balanceHistory: repo
      .all<{
        id: string;
        instanceId: string;
        blockNumber: string;
        blockHash: string;
        observedAt: string;
        data: string;
      }>(
        'SELECT id,instance_id AS instanceId,block_number AS blockNumber,block_hash AS blockHash,observed_at AS observedAt,data_json AS data FROM accounting_balance_snapshots ORDER BY rowid',
      )
      .map((row) => ({ ...row, data: JSON.parse(row.data) })),
  };
}
