import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import BlockchainDemo from '../src/pages/blockchain-demo';

const mocks = vi.hoisted(() => ({ api: vi.fn(), allowed: true, verified: true, signedIn: true }));
vi.mock('../src/lib/api', () => ({ api: mocks.api }));
vi.mock('../src/lib/workspace', () => ({
  useData: () => ({
    user: mocks.signedIn
      ? { id: 'admin', isAdmin: mocks.allowed, emailVerified: mocks.verified }
      : null,
  }),
  useFeedback: () => ({ notify: vi.fn() }),
}));
const snapshot = {
  checkedAt: '2026-10-21T12:00:00Z',
  source: 'anvil_rpc',
  rpcUrl: 'http://127.0.0.1:8545',
  chainId: 31337,
  headBlock: '9',
  status: 'verified',
  message: 'Verified from RPC.',
  checks: [{ id: 'block', label: 'Transaction is included in the canonical block', passed: true }],
  transaction: {
    hash: '0xproof',
    contract: '0xcontract',
    buyer: '0xbuyer',
    blockNumber: '6',
    blockHash: '0xblock',
    amountWei: '12000000000000000',
    feeWei: '1200000000000000',
    gasWei: '1000000000000',
    licenses: [
      {
        quoteId: '0xquote',
        fileHash: '0xfile',
        licenseType: 1,
        seller: '0xcreator',
        owned: true,
        quoteUsed: true,
      },
    ],
    allocations: [
      { role: 'Platform', wallet: '0xplatform', amountWei: '1200000000000000' },
      { role: 'Creator', wallet: '0xcreator', amountWei: '8100000000000000' },
      { role: 'Co-author', wallet: '0xcoauthor', amountWei: '2700000000000000' },
    ],
    credits: [{ wallet: '0xcreator', amountWei: '8100000000000000' }],
    withdrawals: [],
    withdrawalScan: 'complete',
    withdrawalsFromBlock: '6',
    receipt: { status: '0x1', transactionHash: '0xproof', blockNumber: '0x6', logs: [] },
  },
};
function setup(entry = '/blockchain-demo') {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}
    >
      <MemoryRouter initialEntries={[entry]}>
        <BlockchainDemo />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.allowed = true;
  mocks.verified = true;
  mocks.signedIn = true;
  mocks.api.mockImplementation((path: string) =>
    Promise.resolve(
      path.startsWith('/blockchain/demo-proof')
        ? snapshot
        : {
            status: 'verified',
            message: 'RPC verified.',
            checks: [{ label: 'Deposit succeeded at a configured escrow contract', passed: true }],
            orders: [],
            checkedAt: '2026-11-10T10:00:00Z',
          },
    ),
  );
});
it('starts with six concise steps for guests and no automatic proof or admin requests', async () => {
  mocks.signedIn = false;
  setup();
  expect(
    await screen.findByRole('heading', { name: 'Start the app and blockchain' }),
  ).toBeVisible();
  expect(
    within(screen.getByRole('navigation', { name: 'Walkthrough steps' })).getAllByRole('button'),
  ).toHaveLength(6);
  expect(screen.queryByText('Admin tools')).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Live blockchain check' })).not.toBeInTheDocument();
  expect(mocks.api).not.toHaveBeenCalled();
});
it('preserves Russian deep links and reads RPC only when the verification step opens', async () => {
  mocks.signedIn = false;
  setup('/blockchain-demo?view=code&step=deposit&lang=ru');
  expect(await screen.findByRole('heading', { name: 'Оплати через escrow' })).toBeVisible();
  expect(screen.queryByRole('link', { name: 'GitHub' })).not.toBeInTheDocument();
  expect(mocks.api).not.toHaveBeenCalled();
  await userEvent.click(
    within(screen.getByRole('navigation', { name: 'Walkthrough steps' })).getByRole('button', {
      name: /Проверка/,
    }),
  );
  expect(await screen.findByText('1 / 1')).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Проверь оплату на узле' })).toBeVisible();
  expect(screen.getByText('Оплата успешно дошла до escrow-контракта')).not.toBeVisible();
  await userEvent.click(screen.getByText('Технические проверки'));
  expect(screen.getByText('Оплата успешно дошла до escrow-контракта')).toBeVisible();
  expect(
    mocks.api.mock.calls.every(
      ([path, options]) => path === '/blockchain/escrow-proof' && !options?.method,
    ),
  ).toBe(true);
});
it('keeps the older payment archive optional inside verification', async () => {
  setup('/blockchain-demo?step=verify');
  await screen.findByText('1 / 1');
  expect(mocks.api.mock.calls.some(([path]) => path === '/blockchain/demo-proof')).toBe(false);
  await userEvent.click(screen.getByText('Earlier direct payments'));
  expect(await screen.findByText('Verified directly on the local chain')).toBeVisible();
  expect(screen.getByText('0xproof')).toBeVisible();
  expect(mocks.api.mock.calls.every(([, options]) => !options?.method)).toBe(true);
});
it('retains presentation mode and hides admin tools until explicitly expanded', async () => {
  setup();
  await screen.findByRole('heading', { name: 'Start the app and blockchain' });
  expect(screen.getByText('Admin tools')).toBeVisible();
  expect(mocks.api).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Presentation view' }));
  await userEvent.keyboard('{Escape}');
  expect(screen.getByRole('button', { name: 'Presentation view' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
});
