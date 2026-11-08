import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useBalance, useConnection, useWriteContract } from 'wagmi';
import { ChevronLeft, ChevronRight, Megaphone, Check } from 'lucide-react';
import type { Hex } from 'viem';
import type { Artwork } from '../../shared/types';
import {
  promotionAbi,
  promotionMessage,
  promotionPriceWei,
  type PromotionOrder,
  type PromotionState,
} from '../../shared/promotions';
import { testEth } from '../../shared/marketplace';
import { api, ApiError } from '../lib/api';
import { useData, useFeedback } from '../lib/workspace';
import { walletError } from '../lib/blockchain';
import { useDialog } from './dialogs';
import { WalletPanel } from './wallet';
import { Button } from './ui';
import { PaymentReceipt } from './payment-receipt';
import { sessionUrl } from '../lib/session';
import { ChainAmount, CurrencyNote, useDisplayCurrency } from './currency';

export function PromoteButton({ artwork }: { artwork: Artwork }) {
  const { open } = useDialog();
  return (
    <Button
      className="small promote-button"
      disabled={
        artwork.status !== 'published' ||
        artwork.shareApproval?.ready === false ||
        artwork.moderation?.hidden
      }
      onClick={() =>
        open('Promote your artwork', <PromotionCheckout key={artwork.id} artwork={artwork} />)
      }
    >
      <Megaphone size={14} /> Promote
    </Button>
  );
}
type PromotionData = {
  ready: boolean;
  message: string;
  active: PromotionState | null;
  orders: PromotionOrder[];
};
type Saved = { id: string; hash: Hex };
const savedPayment = (key: string): Saved | null => {
  try {
    const v = JSON.parse(localStorage.getItem(key) || 'null');
    return v && /^0x[\da-fA-F]{64}$/.test(v.id) && /^0x[\da-fA-F]{64}$/.test(v.hash) ? v : null;
  } catch {
    return null;
  }
};
export function PromotionCheckout({ artwork: a }: { artwork: Artwork }) {
  const { money } = useDisplayCurrency();
  const { user } = useData(),
    { notify } = useFeedback(),
    dialog = useDialog(),
    client = useQueryClient(),
    connection = useConnection(),
    write = useWriteContract();
  const key = `artguard:promotion:${user?.id}:${a.id}`;
  const [saved, setSaved] = useState<Saved | null>(() => savedPayment(key)),
    [order, setOrder] = useState<PromotionOrder | null>(null),
    [accepted, setAccepted] = useState(false),
    [error, setError] = useState(''),
    [phase, setPhase] = useState(''),
    [now, setNow] = useState(Date.now());
  const notified = useRef('');
  useEffect(() => {
    setSaved(savedPayment(key));
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
    queryKey: ['promotions', 'owner', user?.id, a.id],
    queryFn: () => api<PromotionData>('/promotions?' + new URLSearchParams({ artworkId: a.id })),
    enabled: !!user,
    refetchInterval: 10000,
    retry: false,
  });
  const updated =
    order &&
    query.data?.orders.find(
      (o) => o.id === order.id && (o.status === 'confirmed' || o.status === 'failed'),
    );
  const current =
    updated ||
    order ||
    query.data?.orders.find((o) => o.id === saved?.id) ||
    query.data?.orders.find(
      (o) => o.status === 'pending' || (o.status === 'prepared' && o.quote.expiresAt * 1000 >= now),
    ) ||
    null;
  const hash =
    current && current.status !== 'confirmed' && current.status !== 'failed'
      ? saved?.id === current.id
        ? saved.hash
        : current.transactionHash
      : null;
  const matching =
    !!current &&
    connection.chainId === 31337 &&
    connection.address?.toLowerCase() === current.quote.buyer.toLowerCase();
  const balance = useBalance({
    address: connection.address,
    chainId: 31337,
    query: { enabled: !!connection.address, retry: false },
  });
  const remember = (id: string, hash: Hex) => {
    const value = { id, hash };
    setSaved(value);
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  };
  const refresh = () => {
    void query.refetch();
    void client.invalidateQueries({ queryKey: ['promotions', 'featured'] });
    void client.invalidateQueries({ queryKey: ['accounting'] });
    void balance.refetch();
  };
  const prepare = useMutation({
    mutationFn: () =>
      api<{ order: PromotionOrder }>('/promotions/orders', {
        method: 'POST',
        data: { artworkId: a.id },
      }),
    onSuccess: (r) => {
      setOrder(r.order);
      setAccepted(false);
      setError('');
      setPhase('');
      void query.refetch();
    },
    onError: (e) => setError(walletError(e)),
  });
  const confirm = useQuery({
    queryKey: ['promotions', 'confirm', current?.id, hash],
    enabled: !!current && !!hash,
    queryFn: () =>
      api<{ order: PromotionOrder }>(`/promotions/orders/${current!.id}/confirm`, {
        method: 'POST',
        data: { transactionHash: hash },
      }),
    refetchInterval: (q) =>
      q.state.error || q.state.data?.order.status === 'confirmed' ? false : 2000,
    retry: false,
  });
  useEffect(() => {
    const next =
      confirm.data?.order.status === 'confirmed'
        ? confirm.data.order
        : current?.status === 'confirmed' && saved?.id === current.id
          ? current
          : null;
    if (!next || notified.current === next.id) return;
    notified.current = next.id;
    setOrder(next);
    setSaved(null);
    setPhase('');
    setError('');
    try {
      localStorage.removeItem(key);
    } catch {}
    refresh();
    notify({
      title: 'Promotion payment verified',
      detail: `Your project is promoted until ${new Date(next.validUntil! * 1000).toLocaleDateString()}.`,
      href: '/marketplace',
      label: 'View catalog',
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
      api<{ transactionHash: Hex | null }>(`/promotions/orders/${current!.id}/recover`, {
        method: 'POST',
        data: {},
      }),
    onSuccess: (r) => {
      if (r.transactionHash) {
        remember(current!.id, r.transactionHash);
        setError('');
      } else
        setError(
          'No confirmed payment was found yet. Check your wallet activity before paying again.',
        );
    },
    onError: (e) => setError(walletError(e)),
  });
  const fund = useMutation({
    mutationFn: () => api(`/promotions/orders/${current!.id}/fund`, { method: 'POST', data: {} }),
    onSuccess: () => {
      void balance.refetch();
      notify({ title: 'Test wallet funded' });
    },
    onError: (e) => setError(walletError(e)),
  });
  const pay = useMutation({
    mutationFn: async () => {
      if (!current || !accepted || !matching || !query.data?.ready)
        throw new Error('Review the order and connect its wallet on ArtGuard Local.');
      if (current.quote.expiresAt * 1000 < Date.now())
        throw new Error('The quote expired. Recover an existing payment or refresh the quote.');
      setError('');
      setPhase('Confirm the promotion payment in your wallet…');
      const hash = await write.mutateAsync({
        address: current.contractAddress,
        abi: promotionAbi,
        functionName: 'purchase',
        args: [promotionMessage(current.quote), current.signature],
        value: BigInt(current.quote.amount),
        chainId: 31337,
        account: connection.address,
      });
      remember(current.id, hash);
      setPhase('Payment submitted. Waiting for verification…');
    },
    onError: (e) => {
      setError(walletError(e));
      setPhase('');
    },
  });
  const active = query.data?.active,
    complete = current?.status === 'confirmed',
    expired = !!current && current.quote.expiresAt * 1000 < now;
  const history =
    query.data?.orders
      .filter((o) => o.status === 'confirmed' && o.id !== current?.id)
      .slice(0, 5) || [];
  return (
    <div className="promotion-checkout">
      <div className="checkout-art">
        <img src={sessionUrl(a.image)} alt="" />
        <div>
          <h3>{a.title}</h3>
          <p className="muted small-text">Promoted · Paid catalog placement</p>
        </div>
      </div>
      <div className="promotion-offer">
        <div>
          <strong>{money(5, true)} / 7 days</strong>
          <span>{testEth(promotionPriceWei)} · gas additional</span>
        </div>
        <Megaphone size={22} />
      </div>
      <p className="small-text muted">
        Feature this project in the horizontal Promoted shelf. Renewals add 7 days to the current
        paid period. No automatic charges.
      </p>
      {active && (
        <p className="promotion-active" role="status">
          <Check size={15} /> Promoted until{' '}
          {new Date(active.validUntil * 1000).toLocaleDateString()}
        </p>
      )}
      {query.isPending && (
        <p className="small-text muted" role="status">
          Loading promotion status…
        </p>
      )}
      {!user?.wallet && (
        <Button onClick={() => dialog.open('Your blockchain wallet', <WalletPanel />)}>
          Connect your wallet
        </Button>
      )}
      {complete ? (
        <>
          <p className="promotion-active" role="status">
            <Check size={15} /> Payment verified · 7 days added
          </p>
          <PaymentReceipt
            transactionHash={current.transactionHash!}
            buyerWallet={current.quote.buyer}
            chainId={31337}
          />
          <Link className="button primary full" to="/marketplace" onClick={dialog.close}>
            View promoted catalog
          </Link>
          <Button
            className="text-button"
            onClick={() => {
              setOrder(null);
              setAccepted(false);
            }}
          >
            Add another 7 days
          </Button>
        </>
      ) : hash ? (
        <div className="transaction-state" role="status">
          <strong>Payment submitted · awaiting verification</strong>
          <p className="small-text">Your promotion starts after the payment is verified.</p>
          <Button busy={confirm.isFetching} onClick={() => void confirm.refetch()}>
            Check payment
          </Button>
        </div>
      ) : !current || current.status === 'failed' || expired ? (
        <Button
          className="primary full"
          busy={prepare.isPending}
          disabled={!user?.wallet || !user.emailVerified || !query.data?.ready}
          onClick={() => prepare.mutate()}
        >
          {expired
            ? 'Refresh payment quote'
            : active
              ? 'Extend promotion · 7 days'
              : 'Prepare promotion payment'}
        </Button>
      ) : (
        <>
          <div className="promotion-payment-total">
            <span>Total · 7 days</span>
            <strong>
              <ChainAmount wei={current.quote.amount} />
            </strong>
          </div>
          {!matching && (
            <Button onClick={() => dialog.open('Your blockchain wallet', <WalletPanel />)}>
              Connect the paying wallet
            </Button>
          )}
          <label className="check-label">
            <input
              type="checkbox"
              checked={accepted}
              disabled={pay.isPending}
              onChange={(e) => setAccepted(e.target.checked)}
            />
            <span>Promote this project for 7 days at the price shown.</span>
          </label>
          {matching &&
            balance.data &&
            balance.data.value < BigInt(current.quote.amount) + 1000000000000000n && (
              <Button busy={fund.isPending} onClick={() => fund.mutate()}>
                Get test ETH
              </Button>
            )}
          <Button
            className="primary full"
            busy={pay.isPending}
            disabled={!accepted || !matching || !query.data?.ready || fund.isPending}
            onClick={() => pay.mutate()}
          >
            Pay {testEth(current.quote.amount)}
          </Button>
        </>
      )}
      {current && !complete && (
        <Button className="text-button" busy={recover.isPending} onClick={() => recover.mutate()}>
          Recover an existing payment
        </Button>
      )}
      {phase && !complete && (
        <p className="form-request-status" role="status">
          {phase}
        </p>
      )}
      {(error || query.error || confirm.error || current?.error) && (
        <p className="form-error" role="alert">
          {error || walletError(query.error || confirm.error || new Error(current?.error || ''))}
        </p>
      )}
      {query.data && !query.data.ready && <p className="local-note">{query.data.message}</p>}
      <p className="checkout-footnote">
        ArtGuard Local · test ETH only. Only published, approved projects are shown. Unpublishing
        pauses visibility; the paid period continues.
      </p>
      <CurrencyNote />
      {!!history.length && (
        <details className="promotion-history">
          <summary>Previous payments ({history.length})</summary>
          {history.map((o) => (
            <div key={o.id}>
              <p className="small-text">
                7 days · <ChainAmount wei={o.quote.amount} /> · until{' '}
                {new Date(o.validUntil! * 1000).toLocaleDateString()}
              </p>
              <PaymentReceipt
                transactionHash={o.transactionHash!}
                buyerWallet={o.quote.buyer}
                chainId={31337}
              />
            </div>
          ))}
        </details>
      )}
    </div>
  );
}

export function PromotedShelf({ artworks }: { artworks: Artwork[] }) {
  const { money } = useDisplayCurrency();
  const { user, artworks: allArtworks } = useData(),
    track = useRef<HTMLDivElement>(null),
    [back, setBack] = useState(false),
    [forward, setForward] = useState(false);
  const query = useQuery({
    queryKey: ['promotions', 'featured'],
    queryFn: () =>
      api<{ featured: { artworkId: string; validUntil: number }[] }>('/promotions/featured'),
    refetchInterval: 15000,
    retry: false,
  });
  const featured = (query.data?.featured || [])
    .map((p) => artworks.find((a) => a.id === p.artworkId))
    .filter((a): a is Artwork => !!a);
  const sync = () => {
    const t = track.current;
    if (t) {
      setBack(t.scrollLeft > 1);
      setForward(t.scrollLeft + t.clientWidth < t.scrollWidth - 2);
    }
  };
  useEffect(() => {
    sync();
    const t = track.current;
    if (!t) return;
    const observer = new ResizeObserver(sync);
    observer.observe(t);
    return () => observer.disconnect();
  }, [featured.map((a) => a.id).join(',')]);
  const canPromote = !!user && allArtworks.some((a) => a.own);
  if (!featured.length && !canPromote) return null;
  return (
    <section className="promoted-section" aria-label="Promoted projects">
      <div className="promoted-heading">
        <div>
          <h2>
            <Megaphone size={17} /> Promoted
          </h2>
          <span>Paid placements</span>
        </div>
        <div className="promoted-controls">
          {canPromote && (
            <Link to="/works" className="promoted-manage">
              Promote your work
            </Link>
          )}
          {(back || forward) && (
            <>
              <Button
                className="icon-button small"
                aria-label="Previous promoted projects"
                disabled={!back}
                onClick={() => track.current?.scrollBy({ left: -300, behavior: 'smooth' })}
              >
                <ChevronLeft size={17} />
              </Button>
              <Button
                className="icon-button small"
                aria-label="Next promoted projects"
                disabled={!forward}
                onClick={() => track.current?.scrollBy({ left: 300, behavior: 'smooth' })}
              >
                <ChevronRight size={17} />
              </Button>
            </>
          )}
        </div>
      </div>
      {featured.length ? (
        <div
          className="promoted-track"
          ref={track}
          onScroll={sync}
          tabIndex={0}
          aria-label="Scroll promoted projects horizontally"
        >
          {featured.map((a) => (
            <article className="promoted-card" key={a.id}>
              <Link
                className="promoted-cover"
                to={'/artwork/' + a.id}
                aria-label={'View promoted artwork: ' + a.title}
              >
                <img src={sessionUrl(a.image)} alt={a.title} loading="lazy" />
              </Link>
              <div className="promoted-info">
                <Link className="art-title" to={'/artwork/' + a.id}>
                  {a.title}
                </Link>
                <div className="art-card-bottom">
                  <span>{a.author}</span>
                  <strong>from {money(a.price)}</strong>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="promoted-empty">
          Give your project a place in this shelf.{' '}
          <Link to="/works">Promote for {money(5, true)} / 7 days →</Link>
        </div>
      )}
    </section>
  );
}
