import { useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import {
  House,
  Store,
  UserRound,
  Images,
  FileCheck2,
  Wallet,
  ChartNoAxesCombined,
  UsersRound,
  CreditCard,
  ShieldCheck,
  Flag,
  PanelLeft,
  ChevronDown,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { useData } from '../lib/workspace';

const profilePaths = [
  '/profile',
  '/settings',
  '/works',
  '/licenses',
  '/escrow',
  '/analytics',
  '/billing',
  '/security',
  '/privacy',
  '/reports',
  '/coauthors',
  '/pricing',
  '/upload',
  '/edit',
  '/admin',
  '/manager',
  '/moderation',
];
export const isProfilePath = (path: string) =>
  profilePaths.some((p) => path === p || path.startsWith(p + '/'));

export function MainNavigation() {
  const { user } = useData();
  const { pathname } = useLocation();
  const selected = isProfilePath(pathname)
    ? '/profile'
    : pathname.startsWith('/marketplace') || pathname.startsWith('/artwork/')
      ? '/marketplace'
      : '/home';
  return (
    <nav id="main-nav" aria-label="Main navigation">
      {[
        { to: '/home', label: 'Home', Icon: House },
        { to: '/marketplace', label: 'Marketplace', Icon: Store },
        { to: '/profile', label: 'Profile', Icon: UserRound },
      ]
        .filter((item) => !!user || item.to === '/home')
        .map(({ to, label, Icon }) => (
          <Link to={to} key={to} aria-current={selected === to ? 'page' : undefined}>
            <Icon size={18} aria-hidden="true" strokeWidth={1.8} />
            {label}
          </Link>
        ))}
    </nav>
  );
}
export function ProfileNavigation() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname } = useLocation(),
    { user, artworks } = useData();
  if (!user || !isProfilePath(pathname)) return null;
  const creator = true;
  const coauthor = artworks.some((a) =>
    a.shareApproval?.recipients.some(
      (r) => !!user.wallet && r.wallet?.toLowerCase() === user.wallet.address.toLowerCase(),
    ),
  );
  type Section = [string, string, LucideIcon];
  const sections: Section[] = [
    ['/profile', 'Profile', UserRound],
    ...(creator ? ([['/works', 'My artwork', Images]] satisfies Section[]) : []),
    ['/licenses', 'Licenses', FileCheck2],
    ['/escrow', 'Orders & escrow', ShieldCheck],
    ...(creator || coauthor
      ? ([
          ['/analytics', 'Earnings', ChartNoAxesCombined],
          ['/coauthors', 'Co-authors', UsersRound],
        ] satisfies Section[])
      : []),
    ['/billing', 'Billing', CreditCard],
    ['/security', 'Security', ShieldCheck],
    ['/privacy', 'Privacy & support', ShieldCheck],
    ['/reports', 'Reports', Flag],
    ...(user.isAdmin
      ? ([
          ['/admin/technical', 'Technical administration', ShieldCheck],
          ['/admin/privacy', 'Privacy requests', ShieldCheck],
          ['/admin/blockchain-demo', 'Blockchain lab', Workflow],
        ] satisfies Section[])
      : []),
    ...(user.isManager
      ? ([
          ['/manager/accounting', 'Site statistics', ChartNoAxesCombined],
          ['/manager/escrow', 'Escrow disputes', ShieldCheck],
        ] satisfies Section[])
      : []),
    ['/profile/wallet', 'Wallet', Wallet],
  ];
  return (
    <aside className="profile-sidebar" aria-label="Profile navigation">
      <span className="profile-sidebar-title">Your workspace</span>
      <button
        className="profile-menu-toggle"
        aria-expanded={menuOpen}
        aria-controls="profile-sections"
        onClick={() => setMenuOpen(!menuOpen)}
      >
        <PanelLeft size={17} aria-hidden="true" />
        Profile menu
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      <nav
        id="profile-sections"
        className={`profile-sections${menuOpen ? ' is-open' : ''}`}
        aria-label="Profile sections"
      >
        {sections.map(([to, label, Icon]) => (
          <NavLink
            end
            to={to}
            key={to}
            className={to === '/profile/wallet' ? 'profile-wallet-link' : undefined}
            onClick={() => setMenuOpen(false)}
          >
            <Icon size={17} aria-hidden="true" />
            {label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
