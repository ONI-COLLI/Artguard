import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useConnection, useWriteContract, useBalance } from 'wagmi';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Wallet, ShieldCheck, ChevronDown } from 'lucide-react';
import type { Hex } from 'viem';
import type { LicenseId } from '../../shared/types';
import {
  marketplaceAbi,
  legacyMarketplaceAbi,
  marketAbi,
  licensePeriodLabel,
  contractQuote,
  testEth,
  type ChainCheckout,
} from '../../shared/marketplace';
import { licenseTypes } from '../../shared/schemas';
import { api, ApiError } from '../lib/api';
import { useData, useFeedback, workspaceKey } from '../lib/workspace';
import { useMarketStatus, walletError } from '../lib/blockchain';
import { useDialog } from './dialogs';
import { WalletPanel } from './wallet';
import { Button } from './ui';
import { CopyValue } from './payment-receipt';
import { licenseUsageTerms } from '../../shared/license-terms';
import { ChainAmount, CurrencyNote, useDisplayCurrency } from './currency';

type Item = { artworkId: string; license: LicenseId };
type Recovery = { id: string; transactionHash: Hex };
function load(key: string): Recovery | null {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null');
    return value &&
      typeof value.id === 'string' &&
      /^0x[a-fA-F0-9]{64}$/.test(value.transactionHash)
      ? value
      : null;
  } catch {
    return null;
  }
}
export function BlockchainCheckout({
  items,
  initial,
  showItemSummary = false,
}: {
  items: Item[];
  initial?: ChainCheckout;
  showItemSummary?: boolean;
}) {
  const { money } = useDisplayCurrency();
  const { user, artworks } = useData(),
    market = useMarketStatus(),
    connection = useConnection(),
    write = useWriteContract(),
    client = useQueryClient(),
    { notify } = useFeedback(),
    dialog = useDialog(),
    navigate = useNavigate();
  const selection = items
    .map((i) => `${i.artworkId}:${i.license}`)
    .sort()
    .join('|');
  const storageKey = `artguard:checkout:${user?.id}:${selection}`;
  const [saved, setSaved] = useState<Recovery | null>(() => load(storageKey)),
    [order, setOrder] = useState<ChainCheckout | null>(initial || null),
    [accepted, setAccepted] = useState(false),
    [error, setError] = useState(''),
    [phase, setPhase] = useState(''),
    [now, setNow] = useState(Date.now());
  const notified = useRef('');
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const restored = useQuery({
    queryKey: ['blockchain', 'checkout', saved?.id, user?.id],
    queryFn: () => api<{ checkout: ChainCheckout }>(`/blockchain/checkouts/${saved!.id}`),
    enabled: !!saved,
    retry: false,
  });
  const current = order || restored.data?.checkout || null;
  const balance = useBalance({
    address: connection.address,
    chainId: 31337,
    query: {
      enabled: !!connection.address && !!market.data?.ready,
      refetchInterval: 15000,
      retry: false,
    },
  });
  const fund = useMutation({
    mutationFn: () =>
      api(`/blockchain/checkouts/${current!.id}/fund`, { method: 'POST', data: {} }),
    onSuccess: () => {
      void balance.refetch();
      notify({
        title: 'Test wallet funded',
        detail: 'The local faucet provided test ETH for this quote and network gas.',
      });
    },
    onError: (e) => setError(walletError(e)),
  });
  const hash =
    current?.status === 'failed' || current?.status === 'confirmed'
      ? null
      : saved?.transactionHash || current?.transactionHash;
  const confirmation = useQuery({
    queryKey: ['blockchain', 'payment-confirmation', current?.id, hash, user?.id],
    enabled:
      !!current &&
      !!hash &&
      !!market.data?.ready &&
      current.status !== 'confirmed' &&
      current.status !== 'failed',
    queryFn: () =>
      api<{ checkout: ChainCheckout }>(`/blockchain/checkouts/${current!.id}/confirm`, {
        method: 'POST',
        data: { transactionHash: hash },
      }),
    retry: false,
    refetchInterval: (q) =>
      q.state.error || q.state.data?.checkout.status === 'confirmed' ? false : 4000,
  });
  useEffect(() => {
    const next = confirmation.data?.checkout;
    if (!next || next.status !== 'confirmed' || notified.current === next.id) return;
    notified.current = next.id;
    setOrder(next);
    setSaved(null);
    setPhase('');
    try {
      localStorage.removeItem(storageKey);
    } catch {}
    void client.invalidateQueries({ queryKey: workspaceKey });
    void client.invalidateQueries({ queryKey: ['blockchain', 'checkouts'] });
    void client.invalidateQueries({ queryKey: ['blockchain', 'proceeds'] });
    void client.invalidateQueries({ queryKey: ['escrow-orders'] });
    notify({
      title: 'Blockchain payment verified',
      detail:
        next.marketVersion === 4
          ? 'Payment is held in escrow. The seller must confirm delivery before you review and accept it.'
          : `${next.items.length} license${next.items.length === 1 ? '' : 's'} issued after confirmation.`,
      href: next.marketVersion === 4 ? '/escrow' : '/licenses',
      label: next.marketVersion === 4 ? 'Open escrow orders' : 'Open My licenses',
    });
  }, [confirmation.data]);
  useEffect(() => {
    if (!(confirmation.error instanceof ApiError) || confirmation.error.status !== 422 || !current)
      return;
    setOrder({ ...current, status: 'failed', error: confirmation.error.message });
    setSaved(null);
    setError(confirmation.error.message);
    setPhase('');
    try {
      localStorage.removeItem(storageKey);
    } catch {}
    void client.invalidateQueries({ queryKey: ['blockchain', 'checkouts'] });
  }, [confirmation.error]);
  const prepare = useMutation({
    mutationFn: () =>
      api<{ checkout: ChainCheckout }>('/blockchain/checkouts', {
        method: 'POST',
        data: { items },
      }),
    onSuccess: (data) => {
      setOrder(data.checkout);
      setAccepted(false);
      setError('');
      setPhase('');
      void client.invalidateQueries({ queryKey: ['blockchain', 'checkouts'] });
    },
    onError: (e) => setError(walletError(e)),
  });
  const pay = useMutation({
    mutationFn: async () => {
      if (!current || !accepted)
        throw new Error('Review and confirm the quoted license terms before paying.');
      if (
        !connection.address ||
        connection.address.toLowerCase() !== current.buyerWallet.toLowerCase() ||
        connection.chainId !== 31337
      )
        throw new Error('Connect the quoted buyer wallet on ArtGuard Local before paying.');
      if (
        current.instanceId !== market.data?.deployment?.instanceId ||
        !(market.data?.contracts || (market.data?.deployment ? [market.data.deployment] : [])).some(
          (m) => m.address.toLowerCase() === current.contractAddress.toLowerCase(),
        )
      )
        throw new Error(
          'This quote belongs to a different local marketplace. Restore that network to continue.',
        );
      if (current.expiresAt * 1000 < Date.now())
        throw new Error('The quote expired. Refresh it before paying.');
      setError('');
      setPhase('Confirm the test ETH payment in your wallet…');
      const transactionHash = await write.mutateAsync({
        address: current.contractAddress,
        abi: marketAbi(current.marketVersion),
        functionName: 'buyLicenses',
        args: [
          current.items.map((i) => contractQuote(i.quote)),
          current.items.map((i) => i.signature),
        ],
        value: BigInt(current.totalWei),
        chainId: 31337,
        account: connection.address,
      });
      const recovery = { id: current.id, transactionHash };
      try {
        localStorage.setItem(storageKey, JSON.stringify(recovery));
      } catch {}
      setSaved(recovery);
      setPhase('Payment submitted. Waiting for server verification…');
    },
    onError: (e) => {
      setPhase('');
      setError(walletError(e));
    },
  });
  const recover = useMutation({
    mutationFn: () =>
      api<{ transactionHash: Hex | null }>(`/blockchain/checkouts/${current!.id}/recover`, {
        method: 'POST',
        data: {},
      }),
    onSuccess: ({ transactionHash }) => {
      if (!transactionHash) {
        setError(
          'No confirmed payment for this quote was found yet. Check your wallet activity before retrying.',
        );
        return;
      }
      const recovery = { id: current!.id, transactionHash };
      try {
        localStorage.setItem(storageKey, JSON.stringify(recovery));
      } catch {}
      setSaved(recovery);
      setError('');
    },
    onError: (e) => setError(walletError(e)),
  });
  const matching =
    !!connection.address &&
    connection.chainId === 31337 &&
    connection.address.toLowerCase() ===
      (current?.buyerWallet || user?.wallet?.address)?.toLowerCase();
  const expired = !!current && current.expiresAt * 1000 < now;
  const missing = items.some((i) => {
    const a = artworks.find((a) => a.id === i.artworkId);
    return !a?.blockchain || a.seeded;
  });
  const complete = current?.status === 'confirmed';
  const referenceTotal = items.reduce((sum, item) => {
    const artwork = artworks.find((a) => a.id === item.artworkId);
    return sum + (artwork?.price ?? 0) * licenseTypes[item.license].factor;
  }, 0);
  const insufficient =
    !!current &&
    matching &&
    !!balance.data &&
    balance.data.value < BigInt(current.totalWei) + 1000000000000000n;
  const transactionHash = current?.transactionHash || hash;
  return (
    <section className="blockchain-checkout">
      <ol className="checkout-steps" aria-label="Purchase steps">
        {['Connect wallet', 'Pay into escrow', 'Review & accept', 'Get license'].map((label, i) => (
          <li
            key={label}
            aria-current={
              i === (!matching ? 0 : complete ? (current?.marketVersion === 4 ? 2 : 3) : 1)
                ? 'step'
                : undefined
            }
          >
            <b>{i + 1}</b>
            <span>{label}</span>
          </li>
        ))}
      </ol>
      {(current?.marketVersion === 4 ||
        (!current && market.data?.contracts?.some((c) => c.version === 4))) && (
        <div className="local-note">
          <strong>Escrow protection</strong>
          <p>
            Your payment stays in the contract. The seller has 72 hours to deliver, then you have 24
            hours to accept or open a dispute. You inspect a watermarked preview; the original and
            license unlock when payment is released.
          </p>
          <p className="small-text">
            A manager has 7 days to resolve a dispute. Missed delivery or dispute deadlines allow a
            full refund; network gas is separate.
          </p>
        </div>
      )}
      {(current || referenceTotal > 0) && (
        <div className="checkout-row checkout-total">
          <span>{current ? 'Total payment' : 'License price'}</span>
          <strong>
            {current ? <ChainAmount wei={current.totalWei} /> : money(referenceTotal)}
          </strong>
        </div>
      )}
      {current ? (
        <>
          {current.items.map((i) => (
            <div className="chain-order-item" key={i.quote.id}>
              <span className="muted small-text">
                {licensePeriodLabel((i.quote.durationSeconds || 0) / 86400)}
              </span>
              {(showItemSummary || current.items.length > 1) && <strong>{i.title}</strong>}
              {(showItemSummary || current.items.length > 1) && (
                <span>
                  {licenseTypes[i.license].title} · <ChainAmount wei={i.quote.amount} />
                </span>
              )}
              <details className="checkout-usage-terms">
                <summary>Usage terms</summary>
                <p>{licenseUsageTerms(i.terms, i.license)}</p>
              </details>
            </div>
          ))}
        </>
      ) : null}
      {complete ? (
        <div className="transaction-state" role="status">
          <strong>
            <ShieldCheck size={16} />{' '}
            {current?.marketVersion === 4
              ? 'Payment verified · held in escrow'
              : 'Payment verified · licenses issued'}
          </strong>
          <Button
            className="primary full"
            onClick={() => {
              dialog.close();
              navigate(current?.marketVersion === 4 ? '/escrow' : '/licenses');
            }}
          >
            {current?.marketVersion === 4 ? 'Open escrow orders' : 'Open My licenses'}
          </Button>
        </div>
      ) : hash ? (
        <div className="transaction-state" role="status">
          <strong>Payment submitted · awaiting verification</strong>
          <p>
            {current?.marketVersion === 4
              ? 'The verified payment will be held until the order is completed.'
              : 'Your license becomes available after the server verifies this transaction.'}
          </p>
          <Button busy={confirmation.isFetching} onClick={() => void confirmation.refetch()}>
            Check payment
          </Button>
        </div>
      ) : saved && !current ? (
        <Button busy={restored.isFetching} onClick={() => void restored.refetch()}>
          Restore saved checkout
        </Button>
      ) : (
        <>
          {user && (!user.wallet || !matching) && (
            <Button
              className="full"
              onClick={() => dialog.open('Your blockchain wallet', <WalletPanel />)}
            >
              <Wallet size={16} /> Connect wallet
            </Button>
          )}
          {!current || current.status === 'failed' || expired ? (
            <>
              {missing && (
                <p className="small-text muted">
                  Test ETH payments are not available for this artwork. Choose Local order.
                </p>
              )}
              {expired && (
                <p className="small-text muted">This price has expired. Refresh it to continue.</p>
              )}
              <Button
                className="primary full"
                busy={prepare.isPending}
                disabled={!user?.wallet || !market.data?.ready || !!missing || !items.length}
                onClick={() => prepare.mutate()}
              >
                {current ? 'Refresh price' : 'Continue to payment'}
              </Button>
            </>
          ) : (
            <>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={accepted}
                  disabled={pay.isPending}
                  onChange={(e) => setAccepted(e.target.checked)}
                />
                <span>I have reviewed the quoted usage terms and test ETH payment.</span>
              </label>
              {insufficient && (
                <>
                  <p className="small-text muted">
                    Add test ETH to cover this payment and network gas.
                  </p>
                  <Button className="full" busy={fund.isPending} onClick={() => fund.mutate()}>
                    Get test ETH
                  </Button>
                </>
              )}
              <Button
                className="primary full"
                busy={pay.isPending}
                disabled={!accepted || !matching || !market.data?.ready || fund.isPending}
                onClick={() => pay.mutate()}
              >
                Pay {testEth(current.totalWei)}
              </Button>
            </>
          )}
        </>
      )}
      {phase && !hash && (
        <p className="form-request-status" role="status">
          <span className="spinner tiny" />
          {phase}
        </p>
      )}
      {(error || confirmation.error || restored.error) && (
        <p className="form-error" role="alert">
          {error || walletError(confirmation.error || restored.error)}
        </p>
      )}
      {!market.data?.ready && (
        <p className="small-text muted">
          {market.data?.message || 'Checking the local license marketplace…'}
        </p>
      )}
      <p className="checkout-footnote">Test ETH only · network gas is additional.</p>
      <details className="checkout-more-info">
        <summary>
          Additional information <ChevronDown size={16} aria-hidden="true" />
        </summary>
        <div className="checkout-more-content">
          <div className="checkout-network">ArtGuard Local · Chain 31337</div>
          {current && (
            <dl className="checkout-technical-facts">
              <div>
                <dt>Buyer wallet</dt>
                <dd>
                  <CopyValue value={current.buyerWallet} label="Wallet address" />
                </dd>
              </div>
              <div>
                <dt>Payment contract</dt>
                <dd>
                  <CopyValue value={current.contractAddress} label="Contract address" />
                </dd>
              </div>
              {!complete && (
                <div>
                  <dt>Price validity</dt>
                  <dd>
                    {expired
                      ? 'Expired'
                      : `${Math.max(0, Math.ceil((current.expiresAt * 1000 - now) / 60000))} min remaining`}
                  </dd>
                </div>
              )}
            </dl>
          )}
          {balance.data && (
            <p className="small-text muted">
              Wallet balance: <ChainAmount wei={balance.data.value} />
            </p>
          )}
          {transactionHash && (
            <div className="checkout-transaction">
              <span>Transaction</span>
              <CopyValue value={transactionHash} label="Transaction hash" />
            </div>
          )}
          {current && !complete && current.status !== 'failed' && !hash && (
            <Button
              className="text-button"
              busy={recover.isPending}
              onClick={() => recover.mutate()}
            >
              Recover an existing payment
            </Button>
          )}
          <CurrencyNote />
        </div>
      </details>
    </section>
  );
}

export function PendingBlockchainCheckouts() {
  const { user } = useData(),
    { open } = useDialog();
  const query = useQuery({
    queryKey: ['blockchain', 'checkouts', user?.id],
    queryFn: () => api<{ checkouts: ChainCheckout[] }>('/blockchain/checkouts'),
    enabled: !!user,
    refetchInterval: 15000,
    retry: false,
  });
  if (!query.data?.checkouts.length) return null;
  return (
    <section className="panel pending-checkouts">
      <h3>Blockchain checkouts in progress</h3>
      {query.data.checkouts.map((c) => (
        <div className="checkout-row" key={c.id}>
          <div>
            <strong>{c.items.map((i) => i.title).join(', ')}</strong>
            <p className="small-text muted">
              {c.status === 'pending' ? 'Payment awaiting verification' : 'Quote prepared'} ·{' '}
              <ChainAmount wei={c.totalWei} />
            </p>
          </div>
          <Button
            className="small"
            onClick={() =>
              open(
                'Resume blockchain checkout',
                <BlockchainCheckout
                  key={c.id}
                  initial={c}
                  showItemSummary
                  items={c.items.map((i) => ({ artworkId: i.artworkId, license: i.license }))}
                />,
              )
            }
          >
            Resume checkout
          </Button>
        </div>
      ))}
    </section>
  );
}
