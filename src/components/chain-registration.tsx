import { useEffect, useRef, useState } from 'react';
import { useConnection, useWriteContract } from 'wagmi';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ShieldCheck, Wallet } from 'lucide-react';
import type { Hex } from 'viem';
import type { Artwork } from '../../shared/types';
import {
  registryAbi,
  shortAddress,
  type RegistrationState,
  type RegistrationIntent,
  type ChainRegistration,
} from '../../shared/blockchain';
import { api, ApiError } from '../lib/api';
import { useData, useFeedback, workspaceKey } from '../lib/workspace';
import { useChainStatus, walletError } from '../lib/blockchain';
import { useDialog } from './dialogs';
import { WalletPanel } from './wallet';
import { Button } from './ui';
interface SavedTransaction {
  id: string;
  transactionHash: Hex;
}
function loadTransaction(key: string): SavedTransaction | null {
  try {
    const item = JSON.parse(localStorage.getItem(key) || 'null');
    return item && typeof item.id === 'string' && /^0x[\da-fA-F]{64}$/.test(item.transactionHash)
      ? item
      : null;
  } catch {
    return null;
  }
}
export function ChainRegistrationCard({ artwork }: { artwork: Artwork }) {
  const { user } = useData(),
    chain = useChainStatus(),
    connection = useConnection(),
    write = useWriteContract(),
    client = useQueryClient(),
    { notify } = useFeedback(),
    { open } = useDialog();
  const key = `artguard:registration:${user?.id || 'guest'}:${artwork.id}`;
  const [saved, setSaved] = useState<SavedTransaction | null>(() => loadTransaction(key)),
    [phase, setPhase] = useState(''),
    [error, setError] = useState('');
  const notified = useRef('');
  const state = useQuery({
    queryKey: [
      'blockchain',
      'artwork',
      artwork.id,
      user?.id,
      chain.data?.ready,
      chain.data?.deployment?.instanceId,
    ],
    queryFn: () => api<RegistrationState>(`/blockchain/artworks/${artwork.id}`),
    retry: false,
  });
  const active =
    saved ||
    (state.data?.pending?.transactionHash
      ? { id: state.data.pending.id, transactionHash: state.data.pending.transactionHash }
      : null);
  const confirmation = useQuery({
    queryKey: ['blockchain', 'confirmation', active?.id, active?.transactionHash],
    enabled: !!active && !!chain.data?.ready,
    queryFn: () =>
      api<{ registration: ChainRegistration }>(`/blockchain/registrations/${active!.id}/confirm`, {
        method: 'POST',
        data: { transactionHash: active!.transactionHash },
      }),
    retry: false,
    refetchInterval: (q) =>
      q.state.error || q.state.data?.registration.status === 'confirmed' ? false : 4000,
  });
  useEffect(() => {
    if (
      confirmation.data?.registration.status !== 'confirmed' ||
      !active ||
      notified.current === active.id
    )
      return;
    notified.current = active.id;
    try {
      localStorage.removeItem(key);
    } catch {}
    setSaved(null);
    setPhase('');
    void state.refetch();
    void client.invalidateQueries({ queryKey: workspaceKey });
    notify({
      title: 'Artwork registered on the local blockchain',
      detail: 'The server verified your file hash, wallet, and transaction.',
      href: '/artwork/' + artwork.id,
    });
  }, [confirmation.data]);
  useEffect(() => {
    if (
      !active ||
      !(confirmation.error instanceof ApiError) ||
      ![404, 409, 422].includes(confirmation.error.status)
    )
      return;
    setError(walletError(confirmation.error));
    try {
      localStorage.removeItem(key);
    } catch {}
    setSaved(null);
    setPhase('');
    void state.refetch();
  }, [confirmation.error]);
  const register = useMutation({
    mutationFn: async () => {
      setError('');
      if (
        !connection.address ||
        connection.address.toLowerCase() !== user?.wallet?.address.toLowerCase()
      )
        throw new Error('Connect the wallet linked to your account first.');
      if (connection.chainId !== 31337)
        throw new Error('Switch your wallet to ArtGuard Local first.');
      setPhase('Preparing your registration…');
      const intent = await api<RegistrationIntent>(`/blockchain/artworks/${artwork.id}/prepare`, {
        method: 'POST',
        data: {},
      });
      setPhase('Confirm registration in your wallet…');
      const hash = await write.mutateAsync({
        address: intent.deployment.address,
        abi: registryAbi,
        functionName: 'registerArtwork',
        args: [intent.registration.fileHash, intent.registration.termsHash],
        chainId: 31337,
        account: connection.address,
      });
      const transaction = { id: intent.registration.id, transactionHash: hash };
      try {
        localStorage.setItem(key, JSON.stringify(transaction));
      } catch {}
      setSaved(transaction);
      setPhase('Transaction submitted. Waiting for server verification…');
      return transaction;
    },
    onError: (e) => {
      setPhase('');
      setError(walletError(e));
    },
  });
  const record = state.data?.record || artwork.blockchain;
  const current = !!record && chain.data?.deployment?.instanceId === record.instanceId;
  const verified = !!chain.data?.ready && current && !!state.data?.verified;
  const canRegister =
    artwork.own && !artwork.seeded && artwork.status === 'published' && (!record || !current);
  return (
    <section className="panel blockchain-card">
      <div className="panel-heading">
        <h3>
          <ShieldCheck size={17} /> Blockchain registration
        </h3>
        <span className="chain-tag">Local testnet</span>
      </div>
      {record ? (
        <>
          <span className={`status ${verified ? '' : 'draft'}`}>
            <i />
            {verified ? 'Verified on local chain' : 'Saved blockchain record'}
          </span>
          <p className="small-text muted">
            {!chain.data?.ready
              ? chain.data?.message || 'Checking local network…'
              : state.data?.message || 'Checking this registration against the local node…'}
          </p>
          <dl className="chain-facts">
            <div>
              <dt>Registered by</dt>
              <dd title={record.registrant}>{shortAddress(record.registrant)}</dd>
            </div>
            <div>
              <dt>Block</dt>
              <dd>{record.blockNumber}</dd>
            </div>
            <div>
              <dt>Transaction</dt>
              <dd>
                <code>{record.transactionHash}</code>
              </dd>
            </div>
            <div>
              <dt>Contract</dt>
              <dd>
                <code>{record.contractAddress}</code>
              </dd>
            </div>
          </dl>
          {state.data?.termsChanged && (
            <p className="local-note">
              Licensing terms changed after registration. This record preserves the earlier terms
              snapshot.
            </p>
          )}
          <details className="wallet-help">
            <summary>Registered terms snapshot</summary>
            <pre>{record.terms}</pre>
          </details>
        </>
      ) : (
        <p className="small-text muted">
          {artwork.seeded
            ? 'Sample previews have no blockchain registration. Upload your own file to register its fingerprint.'
            : 'Record this file fingerprint and its current licensing terms using your linked wallet.'}
        </p>
      )}
      {canRegister &&
        !active &&
        (!user?.wallet ||
        !connection.isConnected ||
        connection.address?.toLowerCase() !== user.wallet.address.toLowerCase() ||
        connection.chainId !== 31337 ? (
          <Button className="full" onClick={() => open('Your blockchain wallet', <WalletPanel />)}>
            <Wallet size={15} /> Set up your wallet
          </Button>
        ) : (
          <Button
            className="primary full"
            busy={register.isPending}
            disabled={!chain.data?.ready}
            onClick={() => register.mutate()}
          >
            Register on local blockchain
          </Button>
        ))}
      {active && (
        <div className="transaction-state" role="status">
          <strong>
            {confirmation.data?.registration.status === 'confirmed'
              ? 'Registration confirmed'
              : 'Transaction saved · awaiting verification'}
          </strong>
          <code>{active.transactionHash}</code>
          <Button
            className="small"
            busy={confirmation.isFetching}
            onClick={() => void confirmation.refetch()}
          >
            Check transaction
          </Button>
        </div>
      )}
      {phase && !active && (
        <p className="form-request-status" role="status">
          <span className="spinner tiny" />
          {phase}
        </p>
      )}
      {(error || confirmation.error || state.error) && (
        <p className="form-error" role="alert">
          {error || walletError(confirmation.error || state.error)}
        </p>
      )}
      {!chain.data?.ready && artwork.own && (
        <p className="small-text muted">{chain.data?.message || 'Checking local network…'}</p>
      )}
      {artwork.own && artwork.status === 'draft' && !record && (
        <p className="small-text muted">Publish this artwork to enable blockchain registration.</p>
      )}
      <p className="small-text muted">
        Records identify the registering wallet and file fingerprint. They do not independently
        verify authorship.
      </p>
      {artwork.own && <Link to="/settings">Wallet settings →</Link>}
    </section>
  );
}
