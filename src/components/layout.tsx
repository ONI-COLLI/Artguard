import { Link, Outlet, useLocation } from 'react-router-dom';
import { ShieldCheck, Search, Bell, ChevronDown } from 'lucide-react';
import { useData, useWorkspace, useBusy, useFeedback } from '../lib/workspace';
import { useDialog } from './dialogs';
import { Button, date } from './ui';
import { AccountMenu } from './account-menu';
import { LegalNotice } from './legal-consent';
import { CurrencyPicker } from './currency';
import { isProfilePath, MainNavigation, ProfileNavigation } from './navigation';
export function Layout() {
  const data = useData(),
    query = useWorkspace(),
    busy = useBusy(),
    { open, auth } = useDialog(),
    { history } = useFeedback(),
    u = data.user,
    { pathname } = useLocation(),
    profileArea = !!u && isProfilePath(pathname);
  function showProfile() {
    if (!u) {
      auth();
      return;
    }
    open('Your account', <AccountMenu />);
  }
  return (
    <>
      {data.publicDemo && (
        <div className="public-demo-banner">
          <span>Shared public test server · fictional data and test ETH only</span>
          <nav aria-label="Public project resources">
            <a href="/code">Source code</a>
            <a href="/docs/report.md">Architecture & report guide</a>
            <a href="/downloads/artguard-source.zip">Download source ZIP</a>
          </nav>
        </div>
      )}
      <a
        className="skip-link"
        href="#main-content"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById('main-content')?.focus();
        }}
      >
        Skip to content
      </a>
      {busy && <div className="request-progress" aria-hidden="true" />}
      {query.isError && (
        <div className="connection-notice" role="status">
          <span>Local server unavailable. Your form has been kept.</span>
          <Button busy={query.isFetching} onClick={() => void query.refetch()}>
            Retry connection
          </Button>
        </div>
      )}
      <div className="workspace">
        <header className="header">
          <Link className="brand" to="/home">
            <span className="brand-mark">
              <ShieldCheck size={25} />
            </span>
            artguard<span className="brand-dot">.</span>
          </Link>
          <MainNavigation />
          <div className="header-tools">
            <CurrencyPicker compact />
            {u && (
              <Link className="icon-button" to="/marketplace" aria-label="Search marketplace">
                <Search size={18} />
              </Link>
            )}
            <button
              className="icon-button"
              aria-label="Notifications"
              onClick={() =>
                open(
                  'Workspace updates',
                  <>
                    {history.length ? (
                      history.map((n) => (
                        <article className="feedback-history-item" key={n.id}>
                          <div>
                            <strong>{n.title}</strong>
                            <p>{n.detail}</p>
                            <small>{n.time.toLocaleTimeString()}</small>
                          </div>
                        </article>
                      ))
                    ) : (
                      <p className="muted">All caught up. Your recent actions will appear here.</p>
                    )}
                    {data.sales.map((s) => (
                      <p key={s.id}>
                        {s.title} · {date(s.date)}
                      </p>
                    ))}
                  </>,
                )
              }
            >
              <Bell size={18} />
            </button>
            <button className="profile-button" onClick={showProfile}>
              <span className="avatar">{u?.name[0] || 'G'}</span>
              <span>
                <strong>{u?.name || 'Guest workspace'}</strong>
                <small>
                  {u ? `${data.plans[u.plan].name} workspace` : 'Sign in to get started'}
                </small>
              </span>
              <ChevronDown size={12} />
            </button>
          </div>
        </header>
        <main id="main-content" tabIndex={-1}>
          <LegalNotice />
          {u && !u.emailVerified && (
            <div className="local-note" role="status">
              Verify your email to publish, purchase, or approve shares.{' '}
              <Link to="/security">Open account security</Link>
            </div>
          )}
          <div className={profileArea ? 'profile-layout' : undefined}>
            {profileArea && <ProfileNavigation />}
            <div className={profileArea ? 'profile-main' : undefined}>
              <Outlet />
            </div>
          </div>
        </main>
        <footer>
          <span>
            <span className="online-dot" />
            {query.isError
              ? 'Server connection unavailable'
              : busy
                ? 'Working on your request…'
                : data.publicDemo
                  ? 'Shared test server connected'
                  : 'Local server connected'}{' '}
            <span className="footer-divider">/</span> Local blockchain · test mode
          </span>
          <div>
            <Link to="/verify">Registry</Link>
            <Link to="/demo">Demo studio</Link>
            <Link to="/blockchain-demo">Blockchain demo</Link>
            <Link to="/presentation">Guided demo</Link>
            <Link to="/pricing">Plans & pricing</Link>
            <Link to="/legal/terms">Terms</Link>
            <Link to="/legal/privacy">Privacy</Link>
            <Link to="/legal/refunds">Refunds</Link>
            <Link to="/profile">Profile</Link>
          </div>
          <span>ArtGuard © 2026</span>
        </footer>
      </div>
    </>
  );
}
