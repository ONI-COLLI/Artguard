import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Wallet, Users } from 'lucide-react';
import { ChainAmount, CurrencyNote } from '../components/currency';
import type { DemoProfileState } from '../../shared/demo';
import { api } from '../lib/api';
import { useData } from '../lib/workspace';
import { PageHeading, Button } from '../components/ui';
import { Link } from 'react-router-dom';

export default function DemoStudio() {
  const { user } = useData();
  const q = useQuery({
    queryKey: ['demo', 'profiles'],
    queryFn: () =>
      api<{
        profiles: DemoProfileState[];
        message: string;
        project: { id: string; title: string } | null;
      }>('/demo/profiles'),
    refetchInterval: 15000,
  });
  function openProfile(p: DemoProfileState) {
    const url = new URL(window.location.href);
    url.search = new URLSearchParams({
      window: p.key + '-' + crypto.randomUUID().slice(0, 8),
      demo: p.key,
    }).toString();
    url.hash = p.route;
    window.open(url.toString(), '_blank', 'noopener,noreferrer');
  }
  return (
    <>
      <PageHeading
        kicker="Local prototype · chain 31337"
        title="Demo studio"
        description="Open each role in its own window. Accounts stay signed in independently, even in the same browser."
        action={
          <div className="actions">
            <Link className="button" to="/defense">Live defense demo</Link>
            <Link className="button primary" to="/presentation">
              Guided demo
            </Link>
            <Button busy={q.isFetching} onClick={() => void q.refetch()}>
              Refresh balances
            </Button>
          </div>
        }
      />
      <div className="panel wallet-settings demo-session-note">
        <Users size={22} />
        <div>
          <h3>{user ? user.name : 'Choose a demo role'}</h3>
          <p className="muted">
            Every tab has its own sign-in. Switching accounts, refreshing or signing out here keeps
            other tabs signed in. All four wallets use local test ETH. No wallet extension is
            required.
          </p>
        </div>
      </div>
      {q.error && (
        <p className="form-error" role="alert">
          {q.error.message}
        </p>
      )}
      {q.isPending && <p role="status">Loading demo accounts and wallet balances…</p>}
      <div className="demo-grid">
        {q.data?.profiles.map((p) => (
          <section className="panel wallet-settings demo-card" key={p.key}>
            <span className="eyebrow">{p.key} account</span>
            <h2>{p.name}</h2>
            <p className="muted">{p.description}</p>
            <p>{p.email}</p>
            <div className="demo-wallet">
              <Wallet size={17} />
              <strong>
                {p.balanceWei === null ? 'Wallet not ready' : <ChainAmount wei={p.balanceWei} />}
              </strong>
            </div>
            <code className="demo-address">{p.wallet || 'Run npm run demo:setup'}</code>
            <Button className="primary full" disabled={!p.ready} onClick={() => openProfile(p)}>
              Open {p.name.toLowerCase()} window <ExternalLink size={15} />
            </Button>
          </section>
        ))}
      </div>
      <section className="panel wallet-settings">
        <h3>Try a complete sale</h3>
        <CurrencyNote />
        {q.data?.project && (
          <p className="local-note demo-project-note">
            Ready to buy: <Link to={'/artwork/' + q.data.project.id}>{q.data.project.title}</Link>.
            The co-author has approved a 25% share. Open it in the buyer window to purchase your
            first license.
          </p>
        )}
        <ol className="demo-steps">
          <li>Creator: upload a project and assign a share to the co-author wallet.</li>
          <li>Co-author: open Co-author approvals and sign the current split.</li>
          <li>Creator: publish the project and register its file on the local chain.</li>
          <li>Buyer: purchase a license with the connected demo wallet.</li>
          <li>
            Creator and co-author: open Wallet, then withdraw available earnings. Manager: check
            site statistics. Administrator: open the technical blockchain lab.
          </li>
        </ol>
        <p className="muted small-text">
          Free accounts pay a 10% platform fee. The remaining amount is split between the creator
          and co-authors. Catalog $1 = 0.001 test ETH; gas is additional.
        </p>
        <p className="muted small-text">{q.data?.message}</p>
      </section>
    </>
  );
}
