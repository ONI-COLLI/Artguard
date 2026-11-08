import { beforeEach, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EscrowOrders } from '../src/components/escrow-orders';
const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  write: vi.fn(),
  wait: vi.fn(),
  manager: false,
  connected: true,
  state: 'funded',
  buyer: true,
}));
const id = '0x' + 'a'.repeat(64),
  buyer = '0x' + '1'.repeat(40),
  seller = '0x' + '2'.repeat(40),
  contract = '0x' + '3'.repeat(40);
vi.mock('../src/lib/api', () => ({ api: mocks.api }));
vi.mock('../src/lib/blockchain', () => ({ walletError: (error: Error) => error.message }));
vi.mock('../src/lib/workspace', () => ({
  useData: () => ({ user: { id: 'test', emailVerified: true, isManager: mocks.manager } }),
  useDownload: () => ({ run: vi.fn(), pending: false }),
  workspaceKey: ['workspace'],
}));
vi.mock('../src/components/dialogs', () => ({ useDialog: () => ({ open: vi.fn() }) }));
vi.mock('../src/components/wallet', () => ({ WalletPanel: () => null }));
vi.mock('../src/components/currency', () => ({ ChainAmount: ({ wei }) => <span>{wei} wei</span> }));
vi.mock('wagmi', () => ({
  useConnection: () => ({ address: mocks.connected ? buyer : null, chainId: 31337 }),
  useWriteContract: () => ({ writeContractAsync: mocks.write }),
  usePublicClient: () => ({ waitForTransactionReceipt: mocks.wait }),
}));
function order() {
  return {
    id,
    checkoutId: 'checkout',
    title: 'Collaborative project',
    artworkId: 'project',
    contractAddress: contract,
    state: mocks.state,
    buyer,
    seller,
    amountWei: '12000000000000000',
    deliveryDeadline: Math.floor(Date.now() / 1000) + 7200,
    reviewDeadline: Math.floor(Date.now() / 1000) + 3600,
    disputeDeadline: Math.floor(Date.now() / 1000) + 86400,
    fundingHash: '0xdeposit',
    releaseHash: null,
    refundHash: null,
    refundBalanceWei: mocks.state === 'refunded' ? '12000000000000000' : '0',
    buyerAccount: mocks.buyer,
    sellerAccount: false,
    manager: mocks.manager,
    checkedAt: Math.floor(Date.now() / 1000),
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.manager = false;
  mocks.connected = true;
  mocks.state = 'funded';
  mocks.buyer = true;
  mocks.write.mockResolvedValue('0xtransaction');
  mocks.wait.mockResolvedValue({ status: 'success' });
  mocks.api.mockImplementation(async (path) =>
    path.startsWith('/escrow/orders') ? { orders: [order()] } : { order: order() },
  );
});
function setup(manager = false) {
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
        })
      }
    >
      <MemoryRouter>
        <EscrowOrders manager={manager} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
it('shows a held payment without offering buyer acceptance before delivery', async () => {
  setup();
  await screen.findByText('Payment held in escrow');
  expect(screen.getByText(/license has not started/)).toBeVisible();
  expect(
    screen.queryByRole('button', { name: 'Accept & release payment' }),
  ).not.toBeInTheDocument();
  expect(mocks.write).not.toHaveBeenCalled();
});
it('requires the connected buyer wallet, then waits for an actual release receipt before syncing', async () => {
  mocks.state = 'delivered';
  mocks.connected = false;
  setup();
  const button = await screen.findByRole('button', { name: 'Accept & release payment' });
  expect(button).toBeDisabled();
});
it('accepts delivery with a release transaction and verifies its receipt', async () => {
  mocks.state = 'delivered';
  setup();
  await userEvent.click(await screen.findByRole('button', { name: 'Accept & release payment' }));
  await waitFor(() =>
    expect(mocks.wait).toHaveBeenCalledWith({ hash: '0xtransaction', pollingInterval: 500 }),
  );
  expect(mocks.write).toHaveBeenCalledWith(
    expect.objectContaining({ address: contract, functionName: 'release', args: [id] }),
  );
  await waitFor(() =>
    expect(mocks.api).toHaveBeenCalledWith('/escrow/' + id + '/sync', { method: 'POST', data: {} }),
  );
});
it('lets a manager resolve a dispute only after entering a reason', async () => {
  mocks.manager = true;
  mocks.buyer = false;
  mocks.state = 'disputed';
  setup(true);
  const refund = await screen.findByRole('button', { name: 'Resolve: full refund' });
  expect(refund).toBeDisabled();
  await userEvent.type(
    screen.getByRole('textbox', { name: 'Decision reason' }),
    'The delivered file is incorrect.',
  );
  await userEvent.click(refund);
  await waitFor(() =>
    expect(mocks.api).toHaveBeenCalledWith('/escrow/' + id + '/resolve', {
      method: 'POST',
      data: { refund: true, reason: 'The delivered file is incorrect.' },
    }),
  );
  expect(mocks.write).not.toHaveBeenCalled();
});
it('exposes a separate withdrawal for an approved refund', async () => {
  mocks.state = 'refunded';
  setup();
  await userEvent.click(await screen.findByRole('button', { name: /Withdraw available refund/ }));
  await waitFor(() =>
    expect(mocks.write).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: 'withdrawRefund' }),
    ),
  );
  expect(screen.getByText(/No license was issued/)).toBeVisible();
});
it('shows RPC or API errors instead of inventing a live order status', async () => {
  mocks.api.mockRejectedValue(new Error('Local node unavailable'));
  setup();
  expect(await screen.findByRole('alert')).toHaveTextContent('Local node unavailable');
  expect(screen.queryByText('Payment held in escrow')).not.toBeInTheDocument();
});

it('keeps a reverted release visible as an error without claiming settlement', async () => {
  mocks.state = 'delivered';
  mocks.wait.mockResolvedValue({ status: 'reverted' });
  setup();
  await userEvent.click(await screen.findByRole('button', { name: 'Accept & release payment' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('reverted');
  expect(mocks.api.mock.calls.some(([path]) => path.endsWith('/sync'))).toBe(false);
});
