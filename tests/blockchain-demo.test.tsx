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
function setup() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}
    >
      <MemoryRouter>
        <BlockchainDemo />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
async function setupLegacy() {
  const view = setup();
  await userEvent.click(screen.getByText('Earlier direct-payment purchases'));
  return view;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.allowed = true;
  mocks.verified = true;
  mocks.signedIn = true;
  mocks.api.mockResolvedValue(snapshot);
});
it('keeps legacy proof behind an explicit archive for guests and regular accounts', async () => {
  for (const [signedIn, allowed, verified] of [
    [false, false, false],
    [true, false, true],
    [true, true, false],
  ]) {
    mocks.api.mockClear();
    mocks.signedIn = signedIn;
    mocks.allowed = allowed;
    mocks.verified = verified;
    const view = setup();
    expect(mocks.api.mock.calls.some(([path]) => path === '/blockchain/demo-proof')).toBe(false);
    await userEvent.click(screen.getByText('Earlier direct-payment purchases'));
    expect(await screen.findByText('Verified directly on the local chain')).toBeVisible();
    expect(screen.getByText('0xproof')).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Open accounting' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next step' }));
    expect(screen.getByRole('heading', { name: 'Prepare the purchase' })).toBeVisible();
    expect(
      mocks.api.mock.calls.every(([path]) =>
        ['/blockchain/demo-proof', '/blockchain/escrow-proof'].includes(path),
      ),
    ).toBe(true);
    view.unmount();
  }
});
it('keeps the walkthrough and presentation controls while allowing public proof refresh', async () => {
  await setupLegacy();
  await screen.findByText('Verified directly on the local chain');
  const flow = within(screen.getByRole('navigation', { name: 'Blockchain walkthrough steps' }));
  await userEvent.click(flow.getByRole('button', { name: /Withdraw/ }));
  expect(screen.getByRole('heading', { name: 'Withdraw the earnings' })).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Start again' }));
  expect(screen.getByRole('heading', { name: 'Register the work' })).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Presentation view' }));
  await userEvent.keyboard('{Escape}');
  expect(screen.getByRole('button', { name: 'Presentation view' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  expect(screen.getByText('0.0081 test ETH', { selector: 'strong' })).toBeVisible();
  expect(screen.getByText('0.0027 test ETH')).toBeVisible();
  expect(screen.getByText('0xcontract')).not.toBeVisible();
  await userEvent.click(screen.getByText('RPC receipt, block & contract evidence'));
  expect(screen.getByText('0xcontract')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Refresh proof' }));
  expect(
    mocks.api.mock.calls.every(
      ([path, options]) =>
        ['/blockchain/demo-proof', '/blockchain/escrow-proof'].includes(path) && !options?.method,
    ),
  ).toBe(true);
});
it('shows unavailable or failed refreshes without inventing a purchase or keeping a live verified label', async () => {
  mocks.api.mockResolvedValue({
    ...snapshot,
    status: 'unavailable',
    message: 'Node unavailable. Try again.',
    transaction: null,
    checks: [],
  });
  await setupLegacy();
  expect(await screen.findByText('Node unavailable. Try again.')).toBeVisible();
  expect(screen.queryByText('0.0081 test ETH')).not.toBeInTheDocument();
  expect(screen.queryByText('Verified directly on the local chain')).not.toBeInTheDocument();
  mocks.api.mockRejectedValue(new Error('Disconnected'));
  await userEvent.click(screen.getByRole('button', { name: 'Refresh proof' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Disconnected');
});
it('validates hashes before sending a request and distinguishes unwithdrawn credit from an external payment', async () => {
  await setupLegacy();
  await screen.findByText('Verified directly on the local chain');
  const calls = mocks.api.mock.calls.length;
  await userEvent.type(screen.getByRole('textbox', { name: 'Transaction hash' }), 'invalid');
  await userEvent.click(screen.getByRole('button', { name: 'Verify transaction' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Enter a transaction hash');
  expect(mocks.api).toHaveBeenCalledTimes(calls);
  await userEvent.click(screen.getByText('Wallet credits & confirmed withdrawals'));
  expect(screen.getByText(/No withdrawal was recorded/)).toBeVisible();
  const hash = '0x' + 'a'.repeat(64);
  await userEvent.clear(screen.getByRole('textbox', { name: 'Transaction hash' }));
  await userEvent.type(screen.getByRole('textbox', { name: 'Transaction hash' }), hash);
  await userEvent.click(screen.getByRole('button', { name: 'Verify transaction' }));
  expect(
    mocks.api.mock.calls.some(
      ([path]) => path === '/blockchain/demo-proof?transactionHash=' + hash,
    ),
  ).toBe(true);
});
it('explains escrow delivery and release before showing a wallet license or revenue', async () => {
  setup();
  expect(screen.getByRole('heading', { name: 'The current escrow license flow' })).toBeVisible();
  const flow = within(screen.getByRole('navigation', { name: 'Blockchain walkthrough steps' }));
  await userEvent.click(flow.getByRole('button', { name: /Deposit/ }));
  expect(screen.getByText(/deposit holds the payment without issuing a license/)).toBeVisible();
  await userEvent.click(flow.getByRole('button', { name: /Review/ }));
  expect(screen.getByText(/7 days without a dispute decision/)).toBeVisible();
  await userEvent.click(flow.getByRole('button', { name: /Release/ }));
  expect(screen.getByText(/license period starts on release/)).toBeVisible();
  expect(mocks.api.mock.calls.some(([path]) => path === '/blockchain/demo-proof')).toBe(false);
});
it('opens the wallet and storage code walkthrough from the guest page without authentication', async () => {
  mocks.signedIn = false;
  setup();
  await userEvent.click(screen.getByRole('button', { name: 'Storage map', exact: true }));
  expect(
    await screen.findByRole('heading', { name: '6. Where each type of data is stored' }),
  ).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: /How wallets connect/ }));
  expect(screen.getByRole('heading', { name: /4\. Connect and prove/ })).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'RU', exact: true }));
  expect(
    screen.getByRole('heading', { name: '4. Подключить внешний кошелёк и подтвердить владение' }),
  ).toBeVisible();
  expect(
    mocks.api.mock.calls.every(
      ([path, options]) => path === '/blockchain/escrow-proof' && !options?.method,
    ),
  ).toBe(true);
});
