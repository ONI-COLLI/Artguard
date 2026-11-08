import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AccountMenu } from '../src/components/account-menu';
const mocks = vi.hoisted(() => ({
  role: 'Buyer',
  admin: false,
  auth: vi.fn(),
  close: vi.fn(),
  logout: vi.fn(),
  notify: vi.fn(),
}));
vi.mock('../src/lib/workspace', () => ({
  useData: () => ({
    user: {
      name: 'Demo Buyer',
      email: 'buyer@artguard.test',
      role: mocks.role,
      isAdmin: mocks.admin,
      plan: 'free',
      wallet: null,
    },
    plans: { free: { name: 'Free' } },
    artworks: [],
  }),
  useAction: () => ({ mutateAsync: mocks.logout }),
  useFeedback: () => ({ notify: mocks.notify }),
}));
vi.mock('../src/components/dialogs', () => ({
  useDialog: () => ({ close: mocks.close, auth: mocks.auth }),
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.role = 'Buyer';
  mocks.admin = false;
  mocks.logout.mockResolvedValue({ ok: true });
});
function setup() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <AccountMenu />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
it('gives every member buying and creator tools, with administration restricted', () => {
  setup();
  expect(screen.getByRole('link', { name: /Account settings/ })).toHaveAttribute(
    'href',
    '/profile',
  );
  expect(screen.getByRole('link', { name: 'Billing & plan' })).toBeVisible();
  expect(screen.getByRole('link', { name: 'Co-author approvals' })).toBeVisible();
  expect(screen.queryByRole('navigation', { name: 'Administration' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Free plan' })).not.toBeInTheDocument();
});
it('opens the account switcher without signing out this or any other session', async () => {
  setup();
  await userEvent.click(screen.getByRole('button', { name: 'Switch account' }));
  expect(mocks.auth).toHaveBeenCalledExactlyOnceWith('login');
  expect(mocks.logout).not.toHaveBeenCalled();
});
it('keeps collaboration for creators and administration behind the admin flag', () => {
  mocks.role = 'Creator';
  mocks.admin = true;
  setup();
  expect(screen.getByRole('link', { name: 'Co-author approvals' })).toBeVisible();
  expect(screen.getByRole('navigation', { name: 'Administration' })).toBeVisible();
  expect(screen.getByRole('link', { name: 'Technical administration' })).toHaveAttribute(
    'href',
    '/admin/technical',
  );
});
