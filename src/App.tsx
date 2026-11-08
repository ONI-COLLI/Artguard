import { lazy, Suspense, useEffect, Component, type ReactNode, type ErrorInfo } from 'react';
import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Layout } from './components/layout';
import { DialogProvider } from './components/dialogs';
import { FeedbackProvider, useWorkspace } from './lib/workspace';
import { Empty, Button } from './components/ui';
import { DemoSession } from './components/demo-session';
import { AccessPanel } from './components/dialogs';
import { OAuthResult } from './components/social-auth';
const Demo = lazy(() => import('./pages/demo'));
const Privacy = lazy(() =>
  import('./components/legal').then((m) => ({ default: m.PrivacyCenter })),
);
const Legal = lazy(() => import('./components/legal').then((m) => ({ default: m.LegalPage })));
const PrivacyAdmin = lazy(() =>
  import('./components/legal').then((m) => ({ default: m.PrivacyAdmin })),
);
const Overview = lazy(() => import('./pages/overview'));
const Marketplace = lazy(() => import('./pages/marketplace'));
const Detail = lazy(() =>
  import('./pages/marketplace').then((m) => ({ default: m.ArtworkDetail })),
);
const Editor = lazy(() => import('./pages/editor'));
const Registry = lazy(() => import('./pages/registry'));
const Works = lazy(() => import('./pages/account').then((m) => ({ default: m.Works })));
const Licenses = lazy(() => import('./pages/account').then((m) => ({ default: m.Licenses })));
const Analytics = lazy(() => import('./pages/account').then((m) => ({ default: m.Analytics })));
const Pricing = lazy(() => import('./pages/account').then((m) => ({ default: m.Pricing })));
const Profile = lazy(() => import('./pages/account').then((m) => ({ default: m.Profile })));
const ProfileWallet = lazy(() =>
  import('./pages/account').then((m) => ({ default: m.ProfileWallet })),
);
const Billing = lazy(() => import('./pages/billing'));
const Accounting = lazy(() => import('./pages/accounting'));
const Technical = lazy(() => import('./pages/technical'));
const Escrow = lazy(() => import('./pages/escrow'));
const BlockchainDemo = lazy(() => import('./pages/blockchain-demo'));
const Presentation = lazy(() => import('./pages/presentation'));
const Defense = lazy(() => import('./pages/defense'));
const Coauthors = lazy(() => import('./pages/coauthors'));
const Moderation = lazy(() => import('./pages/moderation'));
const MyReports = lazy(() => import('./pages/moderation').then((m) => ({ default: m.MyReports })));
const Security = lazy(() =>
  import('./components/account-security').then((m) => ({ default: m.AccountSecurity })),
);
const EmailAction = lazy(() =>
  import('./components/account-security').then((m) => ({ default: m.EmailAction })),
);
function Loading() {
  return (
    <div className="workspace-loading" role="status">
      <span className="spinner" />
      <h2>Opening your workspace…</h2>
      <p>Loading artwork, licenses, and account details.</p>
    </div>
  );
}
function ScrollReset() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
    document.title = `${pathname === '/blockchain-demo' || pathname === '/admin/blockchain-demo' ? 'Blockchain demonstration' : pathname === '/profile/wallet' ? 'Wallet' : pathname.split('/')[1]?.replace(/^./, (v) => v.toUpperCase()) || 'Home'} — ArtGuard`;
    document.querySelector<HTMLElement>('#main-content')?.focus({ preventScroll: true });
  }, [pathname]);
  return null;
}
function WorkspaceApp() {
  const q = useWorkspace();
  if (q.isPending) return <Loading />;
  if (!q.data)
    return (
      <div className="workspace empty-state">
        <h1>Your workspace is offline.</h1>
        <p>{q.error?.message}</p>
        <Button busy={q.isFetching} onClick={() => void q.refetch()}>
          Try again
        </Button>
      </div>
    );
  return (
    <DialogProvider>
      <ScrollReset />
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/defense" element={<Defense />} />
          <Route element={<Layout />}>
            <Route path="/" element={<Navigate to="/home" replace />} />
            <Route path="/home" element={<Overview />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/legal/:kind" element={<Legal />} />
            <Route path="/admin/privacy" element={<PrivacyAdmin />} />
            <Route path="/overview" element={<Navigate to="/home" replace />} />
            <Route path="/demo" element={<Demo />} />
            <Route path="/oauth-result" element={<OAuthResult />} />
            <Route path="/catalog" element={<Navigate to="/marketplace" replace />} />
            <Route path="/marketplace" element={q.data.user ? <Marketplace /> : <AccessPanel />} />
            <Route path="/artwork/:id" element={q.data.user ? <Detail /> : <AccessPanel />} />
            <Route path="/upload" element={<Editor />} />
            <Route path="/edit/:id" element={<Editor />} />
            <Route path="/works" element={<Works />} />
            <Route path="/licenses" element={<Licenses />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/pricing" element={<Pricing />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/profile/wallet" element={<ProfileWallet />} />
            <Route path="/settings" element={<Navigate to="/profile" replace />} />
            <Route path="/billing" element={<Billing />} />
            <Route
              path="/admin/accounting"
              element={<Navigate to="/manager/accounting" replace />}
            />
            <Route path="/manager/accounting" element={<Accounting />} />
            <Route path="/escrow" element={<Escrow />} />
            <Route path="/manager/escrow" element={<Escrow manager />} />
            <Route path="/admin/technical" element={<Technical />} />
            <Route path="/blockchain-demo" element={<BlockchainDemo />} />
            <Route path="/presentation" element={<Presentation />} />
            <Route
              path="/admin/blockchain-demo"
              element={
                q.data.user?.isAdmin && q.data.user.emailVerified ? (
                  <BlockchainDemo />
                ) : (
                  <AccessPanel />
                )
              }
            />
            <Route path="/coauthors" element={<Coauthors />} />
            <Route path="/moderation" element={<Moderation />} />
            <Route path="/reports" element={<MyReports />} />
            <Route path="/security" element={<Security />} />
            <Route path="/verify-email" element={<EmailAction key="verify" mode="verify" />} />
            <Route path="/reset-password" element={<EmailAction key="reset" mode="reset" />} />
            <Route path="/verify/:id?" element={<Registry />} />
            <Route
              path="*"
              element={
                <Empty
                  title="Page not found"
                  description="Let us take you back to your studio."
                  to="/home"
                  label="Back to home"
                />
              }
            />
          </Route>
        </Routes>
      </Suspense>
    </DialogProvider>
  );
}
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info);
  }
  render() {
    return this.state.error ? (
      <div className="workspace empty-state">
        <h1>Something interrupted your workspace.</h1>
        <p>Your saved artwork and account are still on the server.</p>
        <button onClick={() => window.location.reload()}>Reload workspace</button>
      </div>
    ) : (
      this.props.children
    );
  }
}
export default function App() {
  return (
    <ErrorBoundary>
      <HashRouter>
        <FeedbackProvider>
          <DemoSession />
          <WorkspaceApp />
        </FeedbackProvider>
      </HashRouter>
    </ErrorBoundary>
  );
}
