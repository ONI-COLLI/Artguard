import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useConnection, useWriteContract, useBalance } from 'wagmi';
import type { Hex } from 'viem';
import {
  subscriptionAbi,
  subscriptionMessage,
  type SubscriptionOrder,
  type SubscriptionState,
} from '../../shared/platform';
import { testEth } from '../../shared/marketplace';
import { api, ApiError } from '../lib/api';
import { useData, useFeedback, workspaceKey } from '../lib/workspace';
import { walletError } from '../lib/blockchain';
import { PageHeading, Button } from '../components/ui';
import { AccessPanel } from '../components/dialogs';
import { WalletPanel } from '../components/wallet';
import { PlanCards } from '../components/plan-cards';
import { ChainAmount, CurrencyNote } from '../components/currency';
type Data = { subscription: SubscriptionState; orders: SubscriptionOrder[] };
type Saved = { id: string; hash: Hex };
function load(key: string): Saved | null {
  try {
    const v = JSON.parse(localStorage.getItem(key) || 'null');
    return v && /^0x[\da-f]{64}$/.test(v.id) && /^0x[\da-fA-F]{64}$/.test(v.hash) ? v : null;
  } catch {
    return null;
  }
}
export default function Billing() {
  const { user, plans } = useData(),
    client = useQueryClient(),
    { notify } = useFeedback(),
    connection = useConnection(),
    write = useWriteContract(),
    [params] = useSearchParams();
  const key = `artguard:subscription:${user?.id}`;
  const [saved, setSaved] = useState<Saved | null>(() => load(key)),
    [selected, setSelected] = useState<string | null>(saved?.id || null),
    [order, setOrder] = useState<SubscriptionOrder | null>(null),
    [accepted, setAccepted] = useState(false),
    [error, setError] = useState(''),
    [phase, setPhase] = useState(''),
    [now, setNow] = useState(Date.now());
  const notified = useRef('');
  useEffect(() => {
    const value = load(key);
    setSaved(value);
    setSelected(value?.id || null);
    setOrder(null);
    setAccepted(false);
    setError('');
    setPhase('');
    notified.current = '';
  }, [key]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const query = useQuery({
    queryKey: ['billing', user?.id],
    queryFn: () => api<Data>('/billing'),
    enabled: !!user,
    refetchInterval: 10000,
    retry: false,
  });
  const serverOrder = query.data?.orders.find((o) => o.id === selected);
  const current =
    serverOrder && (serverOrder.status === 'confirmed' || serverOrder.status === 'failed')
      ? serverOrder
      : order || serverOrder || query.data?.orders.find((o) => o.status === 'pending') || null;
  const hash =
    current?.status === 'confirmed' || current?.status === 'failed'
      ? null
      : saved?.id === current?.id
        ? saved?.hash
        : current?.transactionHash;
  const matching =
    !!user?.wallet &&
    connection.chainId === 31337 &&
    connection.address?.toLowerCase() === user.wallet.address.toLowerCase();
  const balance = useBalance({
    address: connection.address,
    chainId: 31337,
    query: { enabled: !!connection.address, retry: false },
  });
  const refresh = () => {
    void query.refetch();
    void client.invalidateQueries({ queryKey: workspaceKey });
  };
  const prepare = useMutation({
    mutationFn: (plan: 'premium' | 'business') =>
      api<{ order: SubscriptionOrder }>('/billing/orders', { method: 'POST', data: { plan } }),
    onSuccess: (data) => {
      setOrder(data.order);
      setSelected(data.order.id);
      setAccepted(false);
      setError('');
      void query.refetch();
    },
    onError: (e) => setError(walletError(e)),
  });
  const manage = useMutation({
    mutationFn: (resume: boolean) =>
      api(`/billing/${resume ? 'resume' : 'cancel'}`, { method: 'POST', data: {} }),
    onSuccess: (_, resume) => {
      refresh();
      notify({
        title: resume ? 'Manual renewals enabled' : 'Subscription ends at expiry',
        detail: 'Prepaid access stays active until its paid end date. No automatic wallet charges.',
      });
    },
    onError: (e) => setError(walletError(e)),
  });
  const fund = useMutation({
    mutationFn: () => api(`/billing/orders/${current!.id}/fund`, { method: 'POST', data: {} }),
    onSuccess: () => {
      void balance.refetch();
      notify({ title: 'Test wallet funded' });
    },
    onError: (e) => setError(walletError(e)),
  });
  const confirm = useQuery({
    queryKey: ['billing', 'confirm', current?.id, hash],
    enabled: !!current && !!hash,
    queryFn: () =>
      api<{ order: SubscriptionOrder }>(`/billing/orders/${current!.id}/confirm`, {
        method: 'POST',
        data: { transactionHash: hash },
      }),
    refetchInterval: (q) =>
      q.state.error || q.state.data?.order.status === 'confirmed' ? false : 3000,
    retry: false,
  });
  useEffect(() => {
    const next =
      confirm.data?.order?.status === 'confirmed'
        ? confirm.data.order
        : current?.status === 'confirmed' && saved?.id === current.id
          ? current
          : null;
    if (!next || notified.current === next.id) return;
    notified.current = next.id;
    setOrder(next);
    setSaved(null);
    setPhase('');
    try {
      localStorage.removeItem(key);
    } catch {}
    refresh();
    notify({
      title: 'Subscription payment verified',
      detail: `${plans[next.plan].name} access is active until ${new Date(next.validUntil! * 1000).toLocaleString()}.`,
    });
  }, [confirm.data, current?.id, current?.status]);
  useEffect(() => {
    if (!(confirm.error instanceof ApiError) || confirm.error.status !== 422 || !current) return;
    setOrder({ ...current, status: 'failed', error: confirm.error.message });
    setSaved(null);
    setPhase('');
    try {
      localStorage.removeItem(key);
    } catch {}
  }, [confirm.error]);
  const recover = useMutation({
    mutationFn: () =>
      api<{ transactionHash: Hex | null }>(`/billing/orders/${current!.id}/recover`, {
        method: 'POST',
        data: {},
      }),
    onSuccess: (result) => {
      if (!result.transactionHash) {
        setError('No mined payment found yet. Check your wallet before paying again.');
        return;
      }
      const value = { id: current!.id, hash: result.transactionHash };
      setSaved(value);
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {}
      setError('');
    },
    onError: (e) => setError(walletError(e)),
  });
  const pay = useMutation({
    mutationFn: async () => {
      if (
        !current ||
        !accepted ||
        !matching ||
        current.quote.buyer.toLowerCase() !== connection.address?.toLowerCase()
      )
        throw new Error('Review the order and connect its buyer wallet on ArtGuard Local.');
      if (current.quote.expiresAt * 1000 < Date.now())
        throw new Error('This quote expired. Recover an existing payment or prepare a new quote.');
      setError('');
      setPhase('Confirm the test subscription payment in your wallet…');
      const transactionHash = await write.mutateAsync({
        address: current.contractAddress,
        abi: subscriptionAbi,
        functionName: 'purchase',
        args: [subscriptionMessage(current.quote), current.signature],
        value: BigInt(current.quote.amount),
        chainId: 31337,
        account: connection.address,
      });
      const value = { id: current.id, hash: transactionHash };
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {}
      setSaved(value);
      setPhase('Payment submitted. Waiting for verification…');
    },
    onError: (e) => {
      setError(walletError(e));
      setPhase('');
    },
  });
  const subscription = query.data?.subscription || user?.subscription,
    expired = !!current && current.quote.expiresAt * 1000 < now,
    preferred = params.get('plan');
  return (
    <div className="platform-page">
      <PageHeading
        kicker="Plans and payments"
        title="Your subscription, on your terms."
        description="Prepaid 30-day plans on ArtGuard Local. Test ETH only; renewals require another wallet approval."
      />
      {!user ? (
        <AccessPanel />
      ) : (
        <>
          {!user.emailVerified && (
            <p className="local-note">
              <Link to="/security">Verify your email</Link> before purchasing.
            </p>
          )}
          <div className="panel form-panel">
            <h2>{plans[subscription?.plan || 'free'].name}</h2>
            <p>
              {subscription?.validUntil
                ? `Paid access ${subscription.plan === 'free' ? 'expired' : 'ends'} ${new Date(subscription.validUntil * 1000).toLocaleString()}.`
                : 'No paid subscription is active.'}
            </p>
            <p className="muted small-text">
              An expired plan returns to Free automatically. Existing artworks and purchased
              licenses are kept. Changing to a different paid plan is available after the current
              prepaid period expires.
            </p>
            {subscription?.plan !== 'free' && (
              <Button
                busy={manage.isPending}
                onClick={() => manage.mutate(!!subscription?.cancelAtEnd)}
              >
                {subscription?.cancelAtEnd
                  ? 'Resume manual renewals'
                  : 'End subscription at expiry'}
              </Button>
            )}
            <p>
              {subscription?.cancelAtEnd
                ? 'Marked to end at expiry. Manual renewals are disabled until resumed.'
                : 'Manual payments only. Your wallet is never charged automatically.'}
            </p>
          </div>
          <PlanCards
            onChoose={(plan) => prepare.mutate(plan)}
            onFree={() => manage.mutate(false)}
            disabled={
              !user.emailVerified ||
              !user.wallet ||
              !!hash ||
              pay.isPending ||
              prepare.isPending ||
              manage.isPending
            }
            busy={prepare.isPending}
            selected={prepare.variables || preferred}
          />
          {current && (
            <section className="panel form-panel">
              <h2>{plans[current.plan].name} subscription order</h2>
              <CurrencyNote />
              <p>
                <ChainAmount wei={current.quote.amount} /> · 30 days · {current.status}
              </p>
              <p className="small-text muted">
                Buyer {current.quote.buyer} · Contract {current.contractAddress}
              </p>
              {current.status === 'confirmed' ? (
                <p role="status">
                  Payment verified. Access ends{' '}
                  {new Date(current.validUntil! * 1000).toLocaleString()}.
                </p>
              ) : hash ? (
                <>
                  <p role="status">Payment submitted. Verifying receipt…</p>
                  <code>{hash}</code>
                  <Button busy={confirm.isFetching} onClick={() => void confirm.refetch()}>
                    Check payment
                  </Button>
                </>
              ) : current.status === 'failed' ? (
                <p className="form-error">{current.error} Prepare a new quote to retry.</p>
              ) : (
                <>
                  <p>
                    {expired
                      ? 'Quote expired.'
                      : 'Quote valid for ' +
                        Math.max(0, Math.ceil((current.quote.expiresAt * 1000 - now) / 60000)) +
                        ' min.'}
                  </p>
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={accepted}
                      onChange={(e) => setAccepted(e.target.checked)}
                    />
                    <span>
                      I reviewed the plan, 30-day period, and test ETH amount. This is a manual
                      prepaid payment.
                    </span>
                  </label>
                  <div className="actions">
                    <Button
                      busy={fund.isPending}
                      disabled={!matching || expired}
                      onClick={() => fund.mutate()}
                    >
                      Get test ETH
                    </Button>
                    <Button
                      className="primary"
                      busy={pay.isPending}
                      disabled={!accepted || !matching || expired || fund.isPending}
                      onClick={() => pay.mutate()}
                    >
                      Pay {testEth(current.quote.amount)}
                    </Button>
                    <Button busy={recover.isPending} onClick={() => recover.mutate()}>
                      Recover wallet payment
                    </Button>
                  </div>
                </>
              )}
              {phase && <p role="status">{phase}</p>}
            </section>
          )}
          {(error || confirm.error || query.error) && (
            <p role="alert" className="form-error">
              {error || walletError(confirm.error || query.error)}
            </p>
          )}
          <details className="panel form-panel" open={!matching}>
            <summary>Wallet connection and local network</summary>
            <WalletPanel showEarnings={false} />
          </details>
          <section className="panel form-panel">
            <h2>Payment history and recovery</h2>
            {query.data?.orders.length ? (
              query.data.orders.map((o) => (
                <div className="checkout-row" key={o.id}>
                  <span>
                    {plans[o.plan].name} · <ChainAmount wei={o.quote.amount} /> · {o.status}
                  </span>
                  <Button
                    className="small"
                    onClick={() => {
                      setOrder(o);
                      setSelected(o.id);
                      setAccepted(false);
                      setError('');
                    }}
                  >
                    Open order
                  </Button>
                </div>
              ))
            ) : (
              <p className="muted">No subscription payments yet.</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
