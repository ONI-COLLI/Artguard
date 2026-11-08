export const demoProfiles = [
  {
    key: 'admin',
    name: 'Administrator',
    email: 'admin@artguard.test',
    password: 'DemoAdmin!2026',
    description: 'Technical settings, permissions and blockchain lab',
    route: '/admin/technical',
  },
  {
    key: 'creator',
    name: 'Creator',
    email: 'creator@artguard.test',
    password: 'DemoCreator!2026',
    description: 'Upload projects, set shares and receive revenue',
    route: '/works',
  },
  {
    key: 'buyer',
    name: 'Buyer',
    email: 'buyer@artguard.test',
    password: 'DemoBuyer!2026',
    description: 'Buy licenses with test ETH',
    route: '/marketplace',
  },
  {
    key: 'coauthor',
    name: 'Co-author',
    email: 'coauthor@artguard.test',
    password: 'DemoCoauthor!2026',
    description: 'Approve revenue shares and withdraw earnings',
    route: '/coauthors',
  },
  {
    key: 'manager',
    name: 'Manager',
    email: 'manager@artguard.test',
    password: 'DemoManager!2026',
    description: 'Site turnover, commission and financial reporting',
    route: '/manager/accounting',
  },
] as const;
export interface DemoProfileState {
  key: string;
  name: string;
  email: string;
  description: string;
  route: string;
  ready: boolean;
  wallet: string | null;
  balanceWei: string | null;
}
export interface DemoWalletState {
  available: boolean;
  address?: `0x${string}`;
}
