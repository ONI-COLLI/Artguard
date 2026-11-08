import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useConnection, useSignTypedData } from 'wagmi';
import type { Artwork } from '../../shared/types';
import { consentTypes, type ShareStatus, type ConsentRequest } from '../../shared/platform';
import { shortAddress } from '../../shared/blockchain';
import { useData, useFeedback, workspaceKey } from '../lib/workspace';
import { api } from '../lib/api';
import { walletError } from '../lib/blockchain';
import { PageHeading, Button, Empty } from '../components/ui';
import { AccessPanel } from '../components/dialogs';
import { WalletPanel } from '../components/wallet';
export function ShareStatusCard({ artwork }: { artwork: Artwork }) {
  const status = artwork.shareApproval;
  if (!status?.recipients.length) return null;
  return (
    <section className="panel wallet-settings">
      <h3>Co-author approvals</h3>
      <p className="muted small-text">
        {status.ready
          ? 'All co-authors approved this split. You can publish the project.'
          : 'Save changes, then ask each co-author to link their wallet and open Co-author approvals. The project stays a draft until every recipient approves.'}
      </p>
      {!status.ownerWallet && (
        <p className="form-error">Link the creator wallet before requesting approvals.</p>
      )}
      {status.recipients.map((r, i) => (
        <div className="recipient" key={r.wallet || i}>
          <span>
            {r.name}
            <small className="split-wallet muted">
              {r.wallet ? shortAddress(r.wallet) : 'Wallet required'} · {r.percent}%
            </small>
          </span>
          <strong>{r.status}</strong>
        </div>
      ))}
      <Link to="/coauthors">Open co-author inbox</Link>
    </section>
  );
}
function Invitation({
  artwork,
  status,
  onUpdate,
}: {
  artwork: Artwork;
  status: ShareStatus;
  onUpdate: () => void;
}) {
  const { user } = useData(),
    connection = useConnection(),
    sign = useSignTypedData(),
    { notify } = useFeedback(),
    [accepted, setAccepted] = useState(false);
  const own = status.recipients.find(
    (r) => r.wallet?.toLowerCase() === user?.wallet?.address.toLowerCase(),
  );
  const action = useMutation({
    mutationFn: async (approve: boolean) => {
      if (!approve)
        return api(`/coauthors/${artwork.id}/decline`, {
          method: 'POST',
          data: { versionId: status.versionId },
        });
      if (
        !accepted ||
        connection.chainId !== 31337 ||
        connection.address?.toLowerCase() !== user?.wallet?.address.toLowerCase()
      )
        throw new Error('Review the split and connect your linked wallet on ArtGuard Local.');
      const request = await api<ConsentRequest>(`/coauthors/${artwork.id}/request`);
      if (request.versionId !== status.versionId) {
        onUpdate();
        throw new Error('The split changed. Review the new version before signing.');
      }
      const signature = await sign.mutateAsync({
        domain: request.domain,
        types: consentTypes,
        primaryType: 'RevenueConsent',
        message: request.message,
      });
      return api(`/coauthors/${artwork.id}/approve`, {
        method: 'POST',
        data: { versionId: request.versionId, signature },
      });
    },
    onSuccess: (_, approve) => {
      onUpdate();
      notify({
        title: approve ? 'Co-author split approved' : 'Invitation declined',
        detail: approve
          ? 'Your signature is saved for this version. No payment was sent.'
          : 'The creator must update the split or you can approve it later.',
      });
    },
  });
  return (
    <article className="panel form-panel">
      <h2>{artwork.title}</h2>
      <p>
        Creator: {artwork.author} · Your share: <strong>{own?.percent}% of net proceeds</strong>
      </p>
      <Link to={`/artwork/${artwork.id}`}>Review project preview</Link>
      <p className="small-text muted">
        File SHA-256: <code>{artwork.hash}</code>
      </p>
      <p className="small-text muted">
        Approval covers this file and revenue split after the applicable platform fee. Prices and
        license offers may change. This signature authorizes no payment. A changed split requires
        another approval.
      </p>
      <div className="recipient">
        <span>Creator</span>
        <strong>{100 - status.recipients.reduce((s, r) => s + r.percent, 0)}%</strong>
      </div>
      {status.recipients.map((r, i) => (
        <div className="recipient" key={r.wallet || i}>
          <span>
            {r.name}
            <small className="split-wallet muted">{r.wallet || 'Wallet missing'}</small>
          </span>
          <strong>
            {r.percent}% · {r.status}
          </strong>
        </div>
      ))}
      <p role="status">Your response: {own?.status}</p>
      {own?.status !== 'approved' && (
        <>
          <label className="check-label">
            <input
              type="checkbox"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
            />
            <span>I reviewed the project and the full distribution above.</span>
          </label>
          <div className="actions">
            <Button
              className="primary"
              busy={action.isPending}
              disabled={!accepted || !status.ownerWallet || !user?.emailVerified}
              onClick={() => action.mutate(true)}
            >
              Sign and approve shares
            </Button>
            <Button busy={action.isPending} onClick={() => action.mutate(false)}>
              Decline invitation
            </Button>
          </div>
        </>
      )}
      {action.error && (
        <p className="form-error" role="alert">
          {walletError(action.error)}
        </p>
      )}
    </article>
  );
}
export default function Coauthors() {
  const { user } = useData(),
    client = useQueryClient();
  const query = useQuery({
    queryKey: ['coauthors', user?.id, user?.wallet?.address],
    queryFn: () => api<{ invitations: { artwork: Artwork; status: ShareStatus }[] }>('/coauthors'),
    enabled: !!user,
    refetchInterval: 15000,
  });
  const update = () => {
    void query.refetch();
    void client.invalidateQueries({ queryKey: workspaceKey });
  };
  return (
    <div className="platform-page">
      <PageHeading
        kicker="Working together"
        title="Review your co-author shares."
        description="Approve a specific project and version using your own wallet."
      />
      {!user ? (
        <AccessPanel />
      ) : (
        <>
          <WalletPanel showEarnings={false} />
          {!user.emailVerified && (
            <p className="local-note">
              <Link to="/security">Verify your email</Link> before approving.
            </p>
          )}
          {query.error && <p className="form-error">{query.error.message}</p>}
          {query.isPending ? (
            <p role="status">Loading invitations…</p>
          ) : query.data?.invitations.length ? (
            query.data.invitations.map((i) => (
              <Invitation key={`${i.artwork.id}:${i.status.versionId}`} {...i} onUpdate={update} />
            ))
          ) : (
            <Empty
              title="No co-author invitations yet."
              description="Link the wallet listed by the creator to see your invitations here."
            />
          )}
        </>
      )}
    </div>
  );
}
