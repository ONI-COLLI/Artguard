import { useEffect, useState, lazy, Suspense } from 'react';
import {
  useConnection,
  useConnect,
  useConnectors,
  useDisconnect,
  useSwitchChain,
  useSignMessage,
  useBalance,
  type Connector,
} from 'wagmi';
import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, Circle, RefreshCw } from 'lucide-react';
import { localChain } from '../../shared/blockchain';
import { api } from '../lib/api';
import { useData, useAction, useFeedback } from '../lib/workspace';
import { useChainStatus, walletError } from '../lib/blockchain';
import { useDialog } from './dialogs';
import { Button } from './ui';
import { ChainAmount, CurrencyNote, RateInfo } from './currency';
const MarketProceeds = lazy(() =>
  import('./market-proceeds').then((m) => ({ default: m.MarketProceeds })),
);
export function WalletPanel({
  showEarnings = true,
  fullPage = false,
}: { showEarnings?: boolean; fullPage?: boolean } = {}) {
  const { user, publicDemo } = useData(),
    { auth, open } = useDialog(),
    { notify } = useFeedback();
  const connection = useConnection(),
    connectors = useConnectors(),
    connect = useConnect(),
    disconnect = useDisconnect(),
    switchChain = useSwitchChain(),
    sign = useSignMessage();
  const chain = useChainStatus(),
    link = useAction('/wallet/link'),
    unlink = useAction('/wallet', 'DELETE');
  const provision = useAction('/demo/wallet/provision');
  const [available, setAvailable] = useState<Connector[]>([]),
    [checked, setChecked] = useState(false),
    [error, setError] = useState(''),
    [linking, setLinking] = useState(false);
  const connectorIds = connectors.map((c) => c.uid).join(',');
  useEffect(() => {
    let active = true;
    Promise.all(
      connectors.map(async (connector) => ({
        connector,
        provider: await connector.getProvider().catch(() => undefined),
      })),
    ).then((items) => {
      if (active) {
        setAvailable(items.filter((i) => i.provider).map((i) => i.connector));
        setChecked(true);
      }
    });
    return () => {
      active = false;
    };
  }, [connectorIds]);
  const balance = useBalance({
    address: connection.address,
    chainId: 31337,
    query: {
      enabled: !!connection.address && !!chain.data?.ready,
      refetchInterval: 15000,
      retry: false,
    },
  });
  const fund = useMutation({
    mutationFn: () =>
      api<{ transactionHash: string }>('/wallet/fund', { method: 'POST', data: {} }),
    onSuccess: () => {
      void balance.refetch();
      notify({ title: 'Test ETH received', detail: '1 test ETH added on ArtGuard Local.' });
    },
  });
  const busy =
    connect.isPending || linking || switchChain.isPending || unlink.isPending || fund.isPending;
  const matching =
    !!connection.address &&
    connection.address.toLowerCase() === user?.wallet?.address.toLowerCase();
  async function run(action: () => Promise<unknown>) {
    setError('');
    try {
      await action();
    } catch (e) {
      setError(walletError(e));
    }
  }
  async function linkWallet() {
    if (!connection.address || !user) return;
    setLinking(true);
    try {
      const challenge = await api<{ nonce: string; message: string }>('/wallet/challenge', {
        method: 'POST',
        data: { address: connection.address },
      });
      const signature = await sign.mutateAsync({ message: challenge.message });
      await link.mutateAsync({ nonce: challenge.nonce, signature });
      notify({ title: 'Wallet linked', detail: 'Your signature was verified by the server.' });
    } finally {
      setLinking(false);
    }
  }
  return (
    <section className={`wallet-panel${fullPage ? ' wallet-page' : ''}`}>
      <div className="chain-summary">
        <span className={`network-indicator ${chain.data?.ready ? 'ready' : ''}`} />
        <div>
          <strong>ArtGuard Local</strong>
          <p>{chain.data?.ready ? 'Connected · ' : ''}Local test network · Chain 31337</p>
        </div>
        <Button
          className="icon-button small"
          aria-label="Refresh blockchain status"
          busy={chain.isFetching}
          onClick={() => void chain.refetch()}
        >
          <RefreshCw size={15} />
        </Button>
      </div>
      {!chain.data?.ready && (
        <p className="local-note" role="status">
          {chain.data?.message || 'Checking the local blockchain…'}
        </p>
      )}
      <div className={`wallet-main-grid${user?.wallet && showEarnings ? ' has-earnings' : ''}`}>
        <div className="wallet-account-section">
          {publicDemo && user && !user.wallet && (
            <div className="local-note">
              <strong>Your own hosted test wallet</strong>
              <p>
                Allocate a funded wallet for this shared test network. The server signs only this
                account’s permitted demo actions.
              </p>
              <Button
                className="primary full"
                busy={provision.isPending}
                disabled={!user.emailVerified || !chain.data?.ready}
                onClick={() =>
                  void run(async () => {
                    await provision.mutateAsync({});
                    const demo = connectors.find((c) => c.id === 'artguard-demo');
                    if (demo) await connect.mutateAsync({ connector: demo, chainId: 31337 });
                  })
                }
              >
                {user.emailVerified
                  ? 'Create funded test wallet'
                  : 'Verify the account in Account security first'}
              </Button>
            </div>
          )}
          {connection.isConnected && (
            <div className="wallet-balance-card">
              <div className="wallet-balance-heading">
                <h3>Wallet balance</h3>
              </div>
              {balance.data ? (
                <div className="wallet-balance-value">
                  <ChainAmount wei={balance.data.value} basis="market" />
                </div>
              ) : (
                <p role="status">
                  {balance.error
                    ? 'Balance unavailable. Refresh the local connection.'
                    : 'Loading balance…'}
                </p>
              )}
              <p className="currency-note">
                Test funds · market equivalent only.
                <br />
                <RateInfo code="ETH" />
              </p>
              <CurrencyNote />
            </div>
          )}
          {!matching && (
            <ol className="wallet-steps">
              <li className={connection.isConnected ? 'complete' : ''}>
                {connection.isConnected ? <CheckCircle2 size={16} /> : <Circle size={16} />}Connect
                a wallet
              </li>
              <li className={user?.wallet ? 'complete' : ''}>
                {user?.wallet ? <CheckCircle2 size={16} /> : <Circle size={16} />}Verify and link to
                your account
              </li>
            </ol>
          )}
          {user?.wallet && (
            <div className="wallet-address">
              <span className="field-label">Linked wallet</span>
              <code>{user.wallet.address}</code>
            </div>
          )}
          {!connection.isConnected ? (
            <>
              {available.map((connector) => (
                <Button
                  key={connector.uid}
                  className={fullPage ? 'primary full' : 'full'}
                  busy={connect.isPending}
                  disabled={busy}
                  onClick={() => void run(() => connect.mutateAsync({ connector }))}
                >
                  Connect {connector.name}
                </Button>
              ))}
              {checked && !available.length && (
                <div className="wallet-help">
                  <strong>No browser wallet detected</strong>
                  <p>
                    Open this site in a browser with MetaMask or another Ethereum wallet installed,
                    then refresh. Your account and artwork stay saved.
                  </p>
                </div>
              )}
            </>
          ) : (
            <>
              {!matching && (
                <div className="wallet-address">
                  <span className="field-label">Connected in this browser</span>
                  <code>{connection.address}</code>
                </div>
              )}
              {connection.chainId !== 31337 ? (
                <Button
                  className="primary full"
                  busy={switchChain.isPending}
                  onClick={() =>
                    void run(() =>
                      switchChain.mutateAsync({
                        chainId: 31337,
                        addEthereumChainParameter: {
                          chainName: localChain.name,
                          rpcUrls: [localChain.rpcUrls.default.http[0]],
                        },
                      }),
                    )
                  }
                >
                  Switch to ArtGuard Local
                </Button>
              ) : !user ? (
                <Button
                  className="primary full"
                  onClick={() =>
                    auth('login', () => open('Your blockchain wallet', <WalletPanel />))
                  }
                >
                  Sign in to link this wallet
                </Button>
              ) : !user.wallet ? (
                <Button
                  className="primary full"
                  busy={linking}
                  disabled={busy}
                  onClick={() => void run(linkWallet)}
                >
                  {sign.isPending
                    ? 'Confirm the message in your wallet…'
                    : 'Sign message & link wallet'}
                </Button>
              ) : !matching ? (
                <p className="local-note">
                  The connected wallet differs from your linked wallet. Switch accounts in your
                  wallet to register artwork.
                </p>
              ) : (
                <Button
                  className="full"
                  busy={fund.isPending}
                  disabled={!chain.data?.ready || busy}
                  onClick={() => void run(() => fund.mutateAsync())}
                >
                  Get test ETH
                </Button>
              )}
              <Button
                className="text-button"
                disabled={busy}
                onClick={() => void disconnect.mutateAsync()}
              >
                Disconnect from browser
              </Button>
            </>
          )}
        </div>
        {user?.wallet && showEarnings && (
          <section className="wallet-payout-section" aria-label="Your earnings">
            <Suspense fallback={<p className="small-text muted">Loading test earnings…</p>}>
              <MarketProceeds onWithdraw={() => void balance.refetch()} />
            </Suspense>
          </section>
        )}
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="wallet-secondary-actions">
        {user?.wallet && (
          <Button
            className="text-button"
            busy={unlink.isPending}
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await unlink.mutateAsync({});
                notify({
                  title: 'Wallet unlinked',
                  detail: 'Existing blockchain records keep their original wallet address.',
                });
              })
            }
          >
            Unlink wallet from account
          </Button>
        )}
        <details className="wallet-help">
          <summary>Local network setup</summary>
          <p>
            Start <code>npm run chain</code> in the project folder. Add this network in your wallet:
            RPC <code>http://127.0.0.1:8545</code>, chain ID <code>31337</code>, symbol{' '}
            <code>ETH</code>. After linking, use Get test ETH.
          </p>
          <p>This network is stored on this computer. Its test ETH has no monetary value.</p>
        </details>
      </div>
    </section>
  );
}
