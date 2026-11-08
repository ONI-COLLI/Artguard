import { Link } from 'react-router-dom';
import {
  Settings,
  CreditCard,
  Users,
  ShieldCheck,
  ChartNoAxesCombined,
  ChevronRight,
  LogOut,
  ArrowLeftRight,
  Workflow,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useData, useAction, useFeedback } from '../lib/workspace';
import { useDialog } from './dialogs';
import { Button } from './ui';

export function AccountMenu() {
  const { user, plans, artworks } = useData();
  const logout = useAction('/auth/logout'),
    client = useQueryClient();
  const { close, auth } = useDialog(),
    { notify } = useFeedback();
  if (!user) return null;
  const showCollaboration = true;
  return (
    <div className="account-menu">
      <div className="account-menu-identity">
        <span className="avatar">{user.name[0]}</span>
        <div>
          <h3>{user.name}</h3>
          <p>{user.email}</p>
        </div>
        <span className="account-plan-badge">{plans[user.plan].name}</span>
      </div>
      <nav aria-label="Account shortcuts">
        <Link className="account-menu-row" to="/privacy" onClick={close}>
          <ShieldCheck size={18} />
          <span>Privacy & support</span>
          <ChevronRight size={15} />
        </Link>
        <Link className="account-menu-row" to="/profile" onClick={close}>
          <Settings size={18} />
          <span>
            Account settings<small>Profile, wallet and security</small>
          </span>
          <ChevronRight size={15} />
        </Link>
        <Link className="account-menu-row" to="/billing" onClick={close}>
          <CreditCard size={18} />
          <span>Billing & plan</span>
          <ChevronRight size={15} />
        </Link>
        {showCollaboration && (
          <Link className="account-menu-row" to="/coauthors" onClick={close}>
            <Users size={18} />
            <span>Co-author approvals</span>
            <ChevronRight size={15} />
          </Link>
        )}
      </nav>
      {user.isAdmin && (
        <nav className="account-menu-admin" aria-label="Administration">
          <Link className="account-menu-row" to="/admin/privacy" onClick={close}>
            <ShieldCheck size={18} />
            <span>Privacy requests & operator</span>
            <ChevronRight size={15} />
          </Link>
          <span className="account-menu-label">Administration</span>
          <Link className="account-menu-row" to="/admin/blockchain-demo" onClick={close}>
            <Workflow size={18} />
            <span>Blockchain demo</span>
            <ChevronRight size={15} />
          </Link>
          <Link className="account-menu-row" to="/admin/technical" onClick={close}>
            <Settings size={18} />
            <span>Technical administration</span>
            <ChevronRight size={15} />
          </Link>
          <Link className="account-menu-row" to="/moderation" onClick={close}>
            <ShieldCheck size={18} />
            <span>Moderation</span>
            <ChevronRight size={15} />
          </Link>
        </nav>
      )}
      {user.isManager && (
        <nav className="account-menu-admin" aria-label="Management">
          <span className="account-menu-label">Management</span>
          <Link className="account-menu-row" to="/manager/accounting" onClick={close}>
            <ChartNoAxesCombined size={18} />
            <span>Statistics & turnover</span>
            <ChevronRight size={15} />
          </Link>
          <Link className="account-menu-row" to="/manager/escrow" onClick={close}>
            <ShieldCheck size={18} />
            <span>Escrow disputes</span>
            <ChevronRight size={15} />
          </Link>
        </nav>
      )}
      <div className="account-menu-session">
        <Button className="account-session-action" onClick={() => auth('login')}>
          <ArrowLeftRight size={15} /> Switch account
        </Button>
        <Button
          className="account-session-action account-signout"
          busy={logout.isPending}
          onClick={async () => {
            try {
              await logout.mutateAsync({});
              client.removeQueries({ queryKey: ['verify'] });
              close();
              notify({
                title: 'Signed out of this tab',
                detail: 'Your other tabs stay signed in.',
              });
            } catch (error) {
              notify({
                title: 'Sign out failed',
                detail: error instanceof Error ? error.message : 'Please try again.',
                type: 'error',
              });
            }
          }}
        >
          <LogOut size={15} /> Sign out
        </Button>
      </div>
      <div className="account-menu-footnote">
        <span>This tab only</span>
        <Link to="/demo" onClick={close}>
          Demo accounts
        </Link>
      </div>
    </div>
  );
}
