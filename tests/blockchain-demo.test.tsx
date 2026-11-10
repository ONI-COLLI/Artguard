import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import BlockchainDemo from '../src/pages/blockchain-demo';

const mocks = vi.hoisted(() => ({ api: vi.fn(), allowed: true, verified: true, signedIn: true }));
vi.mock('../src/lib/api', () => ({ api: mocks.api }));
vi.mock('../src/components/blockchain-sandbox', () => ({
  BlockchainSandbox: () => <p>Authorized admin sandbox</p>,
}));
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
            status: 'not_found',
            message: 'No deposit.',
            checks: [],
            orders: [],
            checkedAt: '2026-11-10T10:00:00Z',
          },
    ),
  );
});
it('maps old links to the selected fullscreen block and preserves its URL and language', async () => {
  mocks.signedIn = false;
  const view = setup('/blockchain-demo?view=code&step=deposit&lang=ru');
  expect(
    await screen.findByRole('heading', { name: 'Депозит → проверка → лицензия' }),
  ).toBeVisible();
  expect(screen.getByRole('tab', { name: /Escrow и лицензия/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(view.container.querySelectorAll('details,summary')).toHaveLength(0);
  expect(mocks.api).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('tab', { name: /Выплаты и проверка/ }));
  await screen.findByText('No deposit.');
  expect(
    mocks.api.mock.calls.every(
      ([path, options]) => path === '/blockchain/escrow-proof' && !options?.method,
    ),
  ).toBe(true);
});
it('keeps admin tools role-gated on their explicit view', async () => {
  mocks.signedIn = false;
  const guest = setup('/blockchain-demo?tools=1');
  await screen.findByRole('heading', { name: 'Start the local stack' });
  expect(screen.queryByText('Authorized admin sandbox')).not.toBeInTheDocument();
  guest.unmount();
  mocks.signedIn = true;
  setup('/blockchain-demo?tools=1');
  expect(await screen.findByText('Authorized admin sandbox')).toBeVisible();
});
it('preserves the direct-payment verifier on its explicit legacy URL', async () => {
  setup('/blockchain-demo?legacy=1');
  expect(await screen.findByText('Verified directly on the local chain')).toBeVisible();
  expect(screen.getByText('0xproof')).toBeVisible();
  expect(
    mocks.api.mock.calls.every(
      ([path, options]) => path === '/blockchain/demo-proof' && !options?.method,
    ),
  ).toBe(true);
});
