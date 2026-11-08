import { useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatEther } from 'viem';
import type {
  AccountingData,
  AccountingUser,
  AccountingProduct,
  AccountingEvent,
  AccountingCurrency,
  FinancialTotals,
} from '../../shared/accounting';
import { api } from '../lib/api';
import { useData, useDownload, useFeedback } from '../lib/workspace';
import { PageHeading, Button } from '../components/ui';
import { AccessPanel } from '../components/dialogs';
import { ChainAmount, useDisplayCurrency } from '../components/currency';
import { formatCents } from '../lib/currency';
import { Select } from '../components/select';
import { PeriodFinance } from '../components/finance';
type Summary = Omit<AccountingData, 'users' | 'products' | 'events'>;
type Row = AccountingUser | AccountingProduct | AccountingEvent;
type View = 'summary' | 'users' | 'products' | 'events';
export function accountingAmount(value: string, currency: AccountingCurrency = 'test_eth') {
  if (currency === 'test_eth') return formatEther(BigInt(value)) + ' test ETH';
  const amount = BigInt(value);
  return (
    '$' +
    new Intl.NumberFormat('en-US').format(amount / 100n) +
    '.' +
    String(amount % 100n).padStart(2, '0')
  );
}
function Id({ label, value }: { label?: string; value: string | null | undefined }) {
  return value ? (
    <small className="accounting-id">
      {label && <span>{label}: </span>}
      <code>{value}</code>
    </small>
  ) : null;
}
function useAccountingAmount() {
  const { currency: displayCurrency, rates } = useDisplayCurrency();
  return (value: string, currency: AccountingCurrency = 'test_eth') =>
    currency === 'test_eth' ? (
      <ChainAmount wei={value} />
    ) : (
      formatCents(BigInt(value), displayCurrency, false, rates)
    );
}
function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="panel accounting-stat">
      <span>{label}</span>
      <strong>{value}</strong>
      {hint && <small>{hint}</small>}
    </div>
  );
}
function Totals({ totals, currency }: { totals: FinancialTotals; currency: AccountingCurrency }) {
  const displayAmount = useAccountingAmount(),
    amount = (v: string) => displayAmount(v, currency);
  return (
    <section className="panel form-panel">
      <h2>{currency === 'test_eth' ? 'Confirmed test ETH payments' : 'Simulated local orders'}</h2>
      <p className="muted small-text">
        {currency === 'test_eth'
          ? 'Lifetime verified payments across saved local chain instances. Network gas is excluded.'
          : 'Reference USD values from free local orders. These records do not represent money received.'}
      </p>
      <div className="accounting-stats">
        <Stat
          label="Gross license sales"
          value={amount(totals.gross)}
          hint={`${totals.sales} licenses`}
        />
        <Stat label="Platform sales commission" value={amount(totals.commission)} />
        <Stat
          label="Net sales after commission"
          value={amount(String(BigInt(totals.gross) - BigInt(totals.commission)))}
          hint={`Creator credits: ${accountingAmount(totals.creatorNet, currency)}; co-author credits are included in net sales`}
        />
        <Stat label="Co-author credits" value={amount(totals.coauthorNet)} />
        <Stat label="Subscription payments" value={amount(totals.subscriptions)} />
        <Stat label="Promotion payments" value={amount(totals.promotions || '0')} />
        <Stat
          label="Platform revenue: commission + services"
          value={amount(totals.platformRevenue)}
          hint="Before operating costs; separate from the wallet balance"
        />
      </div>
    </section>
  );
}
export default function Accounting() {
  const accountingAmount = useAccountingAmount();
  const { user } = useData(),
    client = useQueryClient(),
    { notify } = useFeedback(),
    download = useDownload(),
    [params, setParams] = useSearchParams(),
    [search, setSearch] = useState(params.get('q') || '');
  const raw = params.get('view'),
    view: View = raw === 'users' || raw === 'products' || raw === 'events' ? raw : 'summary',
    page = Number(params.get('page') || 1),
    q = params.get('q') || '',
    userId = params.get('userId') || '',
    status = params.get('status') || 'all',
    currency = params.get('currency') || 'all';
  const allowed = !!user?.isManager && user.emailVerified;
  const summary = useQuery({
    queryKey: ['accounting', user?.id, 'summary'],
    queryFn: () => api<Summary>('/manager/accounting'),
    enabled: allowed,
    retry: false,
  });
  const table = useQuery({
    queryKey: ['accounting', user?.id, view, page, q, userId, status, currency],
    queryFn: () =>
      api<{ items: Row[]; total: number; page: number; pageSize: number }>(
        '/manager/accounting?' +
          new URLSearchParams({ view, page: String(page), q, userId, status, currency }),
      ),
    enabled: allowed && view !== 'summary',
    retry: false,
  });
  const refresh = () => void client.invalidateQueries({ queryKey: ['accounting', user?.id] });
  const sync = useMutation({
    mutationFn: () => api('/manager/accounting/sync', { method: 'POST', data: {} }),
    onSuccess: () => {
      refresh();
      notify({
        title: 'Balances recorded',
        detail: 'Wallet and contract balances were saved at one local blockchain block.',
      });
    },
  });
  function navigate(next: Record<string, string>) {
    setParams(next);
    setSearch(next.q || '');
  }
  function filter(next: Record<string, string>) {
    const p = Object.fromEntries(params);
    delete p.page;
    navigate({ ...p, ...next, view });
  }
  const data = summary.data;
  return (
    <div className="platform-page accounting-page">
      <PageHeading
        kicker="Manager workspace"
        title="Users, wallets and every sale."
        description="Persistent records with stable IDs, immutable payment history and saved blockchain balance snapshots."
        action={
          allowed ? (
            <div className="actions">
              <Button
                busy={summary.isFetching || (view !== 'summary' && table.isFetching)}
                onClick={() => refresh()}
              >
                Reload records
              </Button>
              <Button busy={sync.isPending} onClick={() => sync.mutate()}>
                Sync blockchain balances
              </Button>
              <Button
                busy={download.pending}
                onClick={() => void download.run('/api/manager/accounting/export')}
              >
                Export all records (JSON)
              </Button>
            </div>
          ) : undefined
        }
      />
      {!user ? (
        <AccessPanel />
      ) : !user.isManager ? (
        <p className="local-note">
          Manager access is required. After registering, the workspace owner can grant access in
          Technical administration → Manager access.
        </p>
      ) : !user.emailVerified ? (
        <p className="local-note">
          <Link to="/security">Verify your email</Link> before opening financial records.
        </p>
      ) : (
        <>
          {(summary.error || sync.error) && (
            <p role="alert" className="form-error">
              {(summary.error || sync.error)?.message}{' '}
              <Button onClick={() => refresh()}>Reload records</Button>
            </p>
          )}
          <nav className="accounting-tabs" aria-label="Accounting sections">
            {(['summary', 'users', 'products', 'events'] as const).map((v) => (
              <Button
                key={v}
                aria-pressed={view === v}
                className={view === v ? 'primary' : ''}
                onClick={() => navigate({ view: v })}
              >
                {
                  {
                    summary: 'Overview',
                    users: 'Users & wallets',
                    products: 'Products',
                    events: 'Transactions',
                  }[v]
                }
              </Button>
            ))}
          </nav>
          {summary.isPending ? (
            <p role="status">Loading accounting records…</p>
          ) : (
            data && (
              <>
                {view === 'summary' ? (
                  <>
                    <PeriodFinance />
                    <details className="finance-lifetime">
                      <summary>All-time totals, inventory & wallet snapshots</summary>
                      <div className="accounting-stats">
                        <Stat
                          label="Registered accounts"
                          value={data.counts.activeAccounts}
                          hint={`${data.counts.sampleAccounts} disabled sample accounts listed separately`}
                        />
                        <Stat
                          label="Listed projects"
                          value={data.counts.listed}
                          hint={`${data.counts.products} projects saved · ${data.counts.deleted} archived deletions`}
                        />
                        <Stat
                          label="Projects with successful license orders"
                          value={data.counts.soldProducts}
                          hint={`${data.counts.sales} license records, including local simulations`}
                        />
                        <Stat
                          label="Listed catalog value"
                          value={accountingAmount(data.catalogValueCents, 'local_usd')}
                          hint="One base license price per listed project; this is not revenue"
                        />
                      </div>
                      <Totals totals={data.totals.test_eth} currency="test_eth" />
                      <Totals totals={data.totals.local_usd} currency="local_usd" />
                      <section className="panel form-panel">
                        <h2>Platform funds at the last recorded block</h2>
                        {data.balanceSnapshot ? (
                          <>
                            <p>
                              Recorded {new Date(data.balanceSnapshot.observedAt).toLocaleString()}{' '}
                              · Block {data.balanceSnapshot.blockNumber}
                            </p>
                            <Id label="Snapshot ID" value={data.balanceSnapshot.id} />
                            <Id
                              label="Local chain instance"
                              value={data.balanceSnapshot.instanceId}
                            />
                            <div className="accounting-stats">
                              <Stat
                                label="Marketplace treasury credit"
                                value={accountingAmount(
                                  data.balanceSnapshot.platform.marketplaceWei,
                                )}
                                hint="Includes any creator or co-author payouts to the treasury wallet; earned sales fees are reported separately above"
                              />
                              <Stat
                                label="Available subscription receipts"
                                value={accountingAmount(
                                  data.balanceSnapshot.platform.subscriptionWei,
                                )}
                              />
                              <Stat
                                label="Total platform contract credit"
                                value={accountingAmount(data.balanceSnapshot.platform.availableWei)}
                              />
                              <Stat
                                label="Available promotion receipts"
                                value={accountingAmount(
                                  data.balanceSnapshot.platform.promotionWei || '0',
                                )}
                              />
                              <Stat
                                label="Treasury wallets: native test ETH"
                                value={accountingAmount(data.balanceSnapshot.platform.nativeWei)}
                                hint="Includes faucet funding, gas and prior withdrawals; not platform income"
                              />
                            </div>
                            {data.balanceSnapshot.platform.treasuries.map((a) => (
                              <Id key={a} label="Treasury wallet" value={a} />
                            ))}
                          </>
                        ) : (
                          <p className="local-note">
                            No blockchain balances recorded yet. Use Sync blockchain balances.
                            Unavailable balances are not treated as zero.
                          </p>
                        )}
                        <p className="muted small-text">
                          Snapshots are historical. Synchronize again after payments or withdrawals.
                          Lifetime revenue stays recorded after funds are withdrawn.
                        </p>
                      </section>
                      <div className="local-note">
                        Inventory: {data.counts.drafts} drafts · {data.counts.hidden} hidden ·{' '}
                        {data.counts.awaitingApproval} awaiting approvals. A project may stay listed
                        after selling licenses.
                      </div>
                    </details>
                  </>
                ) : (
                  <>
                    <form
                      className="accounting-filters"
                      onSubmit={(e) => {
                        e.preventDefault();
                        filter({ q: search });
                      }}
                    >
                      <label>
                        Search names, IDs, wallets or transactions
                        <input
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                          placeholder="Search saved records"
                        />
                      </label>
                      <Button type="submit">Search</Button>
                      {view === 'products' && (
                        <div className="accounting-filter">
                          <label htmlFor="accounting-status">Project status</label>
                          <Select
                            id="accounting-status"
                            value={status}
                            onChange={(value) => filter({ status: value })}
                            options={[
                              'all',
                              'listed',
                              'sold',
                              'draft',
                              'hidden',
                              'approval_required',
                              'deleted',
                            ].map((s) => ({ value: s, label: s.replace('_', ' ') }))}
                          />
                        </div>
                      )}
                      {view === 'events' && (
                        <div className="accounting-filter">
                          <label htmlFor="accounting-currency">Currency</label>
                          <Select
                            id="accounting-currency"
                            value={currency}
                            onChange={(value) => filter({ currency: value })}
                            options={[
                              { value: 'all', label: 'All currencies' },
                              { value: 'test_eth', label: 'Test ETH payments' },
                              { value: 'local_usd', label: 'Simulated USD orders' },
                            ]}
                          />
                        </div>
                      )}
                    </form>
                    {userId && (
                      <p className="local-note">
                        Filtered by user <code>{userId}</code>{' '}
                        <Button className="small" onClick={() => filter({ userId: '' })}>
                          Clear user filter
                        </Button>
                      </p>
                    )}
                    {table.isPending ? (
                      <p role="status">Loading records…</p>
                    ) : table.error ? (
                      <p role="alert" className="form-error">
                        {table.error.message}
                      </p>
                    ) : (
                      <>
                        <p className="small-text muted">
                          {table.data?.total || 0} matching records ·{' '}
                          {data.balanceSnapshot
                            ? `Balances recorded ${new Date(data.balanceSnapshot.observedAt).toLocaleString()}`
                            : 'Balances have not been synchronized'}
                        </p>
                        <div className="panel accounting-table-scroll">
                          <table className="accounting-table">
                            <thead>
                              <tr>
                                {(view === 'users'
                                  ? [
                                      'User identity',
                                      'Wallet & recorded balance',
                                      'Projects / sales',
                                      'Allocated earnings',
                                      'Records',
                                    ]
                                  : view === 'products'
                                    ? [
                                        'Project identity',
                                        'Creator',
                                        'Status',
                                        'Catalog base price',
                                        'Successful licenses',
                                      ]
                                    : [
                                        'Operation identity',
                                        'Buyer / creator IDs',
                                        'Gross / commission / net',
                                        'Distribution',
                                      ]
                                ).map((h) => (
                                  <th key={h}>{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {table.data?.items.map((row) =>
                                view === 'users'
                                  ? (() => {
                                      const u = row as AccountingUser;
                                      return (
                                        <tr key={u.id}>
                                          <td>
                                            <strong>{u.name}</strong>
                                            <p>{u.email}</p>
                                            <Id value={u.id} />
                                            <small>
                                              {u.disabled
                                                ? 'Disabled sample account'
                                                : u.plan +
                                                  ' · ' +
                                                  (u.emailVerified
                                                    ? 'verified'
                                                    : 'email unverified')}
                                              {u.isAdmin ? ' · administrator' : ''}
                                            </small>
                                            <details>
                                              <summary>
                                                Wallet link history ({u.walletHistory.length})
                                              </summary>
                                              {u.walletHistory.map((w) => (
                                                <div key={w.id}>
                                                  <Id value={w.address} />
                                                  <small>
                                                    {w.linkedAt} → {w.unlinkedAt || 'still linked'}
                                                  </small>
                                                  <Id label="Link ID" value={w.id} />
                                                </div>
                                              ))}
                                            </details>
                                          </td>
                                          <td>
                                            {u.wallet ? (
                                              <>
                                                <Id value={u.wallet} />
                                                {u.balance ? (
                                                  <>
                                                    <p>
                                                      Wallet:{' '}
                                                      {accountingAmount(u.balance.nativeWei)}
                                                    </p>
                                                    <p>
                                                      Contract credit:{' '}
                                                      {accountingAmount(
                                                        String(
                                                          BigInt(u.balance.marketplaceWei) +
                                                            BigInt(u.balance.subscriptionWei) +
                                                            BigInt(u.balance.promotionWei || '0'),
                                                        ),
                                                      )}
                                                    </p>
                                                  </>
                                                ) : (
                                                  <p>Not synchronized</p>
                                                )}
                                              </>
                                            ) : (
                                              <span className="muted">No linked wallet</span>
                                            )}
                                          </td>
                                          <td>
                                            {u.listed} listed / {u.products} saved
                                            <p>
                                              {u.soldProducts} projects sold · {u.sales} licenses
                                            </p>
                                          </td>
                                          <td>
                                            {accountingAmount(u.earned.test_eth)}
                                            <p>
                                              {accountingAmount(u.earned.local_usd, 'local_usd')}{' '}
                                              simulated
                                            </p>
                                            <small>
                                              Historical credits, not an available cash balance
                                            </small>
                                          </td>
                                          <td>
                                            <div className="accounting-row-actions">
                                              <Button
                                                className="small"
                                                onClick={() =>
                                                  navigate({ view: 'products', userId: u.id })
                                                }
                                              >
                                                View projects
                                              </Button>
                                              <Button
                                                className="small"
                                                onClick={() =>
                                                  navigate({ view: 'events', userId: u.id })
                                                }
                                              >
                                                View transactions
                                              </Button>
                                            </div>
                                          </td>
                                        </tr>
                                      );
                                    })()
                                  : view === 'products'
                                    ? (() => {
                                        const p = row as AccountingProduct;
                                        return (
                                          <tr key={p.id}>
                                            <td>
                                              {p.status === 'deleted' ? (
                                                <strong>{p.title}</strong>
                                              ) : (
                                                <Link to={`/artwork/${p.id}`}>{p.title}</Link>
                                              )}
                                              <Id value={p.id} />
                                              <details>
                                                <summary>Fingerprint & dates</summary>
                                                <Id label="SHA-256" value={p.hash} />
                                                <small>
                                                  Created {p.createdAt}
                                                  <br />
                                                  Updated {p.updatedAt}
                                                  {p.deletedAt && (
                                                    <>
                                                      <br />
                                                      Deleted {p.deletedAt}
                                                    </>
                                                  )}
                                                </small>
                                              </details>
                                            </td>
                                            <td>
                                              {p.owner}
                                              <Id value={p.ownerId} />
                                            </td>
                                            <td>{p.status.replace('_', ' ')}</td>
                                            <td>
                                              {accountingAmount(String(p.priceCents), 'local_usd')}
                                            </td>
                                            <td>
                                              {p.chainSales} blockchain
                                              <p>{p.localSales} local simulated</p>
                                            </td>
                                          </tr>
                                        );
                                      })()
                                    : (() => {
                                        const e = row as AccountingEvent;
                                        return (
                                          <tr
                                            key={e.id}
                                            className={
                                              e.supersededBy ? 'accounting-superseded' : ''
                                            }
                                          >
                                            <td>
                                              <strong>{e.title}</strong>
                                              <p>
                                                {e.kind} ·{' '}
                                                {e.currency === 'test_eth'
                                                  ? 'confirmed test ETH'
                                                  : 'local simulation'}
                                              </p>
                                              <Id label="Event ID" value={e.id} />
                                              <small>{e.occurredAt}</small>
                                              <details>
                                                <summary>All linked IDs and payment proof</summary>
                                                <Id label="Source" value={e.sourceKey} />
                                                <Id label="Project" value={e.artworkId} />
                                                <Id label="Purchase" value={e.purchaseId} />
                                                <Id label="Transaction" value={e.transactionHash} />
                                                <Id label="Contract" value={e.contractAddress} />
                                                <Id label="Instance" value={e.instanceId} />
                                                <Id label="Buyer wallet" value={e.buyerWallet} />
                                                <Id label="Creator wallet" value={e.sellerWallet} />
                                                <Id label="Superseded by" value={e.supersededBy} />
                                              </details>
                                              {e.supersededBy && (
                                                <p>
                                                  Replaced by a verified blockchain payment;
                                                  excluded from totals.
                                                </p>
                                              )}
                                            </td>
                                            <td>
                                              <Id label="Buyer" value={e.buyerId} />
                                              <Id label="Creator" value={e.sellerId} />
                                            </td>
                                            <td>
                                              {accountingAmount(e.gross, e.currency)}
                                              <p>
                                                Commission: {accountingAmount(e.fee, e.currency)}
                                              </p>
                                              <p>Net: {accountingAmount(e.net, e.currency)}</p>
                                            </td>
                                            <td>
                                              {e.allocations.length
                                                ? e.allocations.map((a) => (
                                                    <details key={a.id}>
                                                      <summary>
                                                        {a.name}:{' '}
                                                        {accountingAmount(a.amount, e.currency)}
                                                      </summary>
                                                      <Id label="Allocation ID" value={a.id} />
                                                      <Id label="User" value={a.userId} />
                                                      <Id label="Wallet" value={a.wallet} />
                                                      {!a.userId && (
                                                        <small>
                                                          No verified account attribution at payment
                                                          time
                                                        </small>
                                                      )}
                                                    </details>
                                                  ))
                                                : e.kind === 'promotion'
                                                  ? 'Platform promotion receipt'
                                                  : 'Platform subscription receipt'}
                                            </td>
                                          </tr>
                                        );
                                      })(),
                              )}
                              {!table.data?.items.length && (
                                <tr>
                                  <td colSpan={view === 'events' ? 4 : 5}>No matching records.</td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                        <div className="accounting-pagination">
                          <Button
                            disabled={page <= 1}
                            onClick={() =>
                              setParams({ ...Object.fromEntries(params), page: String(page - 1) })
                            }
                          >
                            Previous
                          </Button>
                          <span>
                            Page {page} of {Math.max(1, Math.ceil((table.data?.total || 0) / 25))}
                          </span>
                          <Button
                            disabled={page * 25 >= (table.data?.total || 0)}
                            onClick={() =>
                              setParams({ ...Object.fromEntries(params), page: String(page + 1) })
                            }
                          >
                            Next
                          </Button>
                        </div>
                      </>
                    )}
                  </>
                )}
              </>
            )
          )}
        </>
      )}
    </div>
  );
}
