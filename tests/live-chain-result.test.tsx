import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LiveChainResult } from '../src/components/live-chain-result';
const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('../src/lib/api', () => ({ api: mocks.api }));
beforeEach(() => vi.clearAllMocks());
function setup() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}
    >
      <LiveChainResult language="en" />
    </QueryClientProvider>,
  );
}
const proof = {
  status: 'verified',
  checkedAt: '2026-11-10T12:00:00Z',
  message: 'RPC verified.',
  checks: [{ label: 'Deposit succeeded at a configured escrow contract', passed: true }],
  orders: [
    {
      id: 'order',
      state: 'released',
      amountWei: '12000000000000000',
      heldWei: '0',
      block: '12',
      depositHash: '0xdeposit',
      releaseHash: '0xrelease',
      refundHash: null,
      buyer: '0xbuyer',
      licenseActive: true,
      refundBalanceWei: '0',
      allocations: [{ wallet: '0xauthor', amountWei: '8100000000000000' }],
      withdrawals: [],
    },
  ],
};
it('shows real node evidence and credits immediately, without claiming a withdrawal', async () => {
  mocks.api.mockResolvedValue(proof);
  const view = setup();
  expect(await screen.findByText('0xdeposit')).toBeVisible();
  expect(screen.getByText('0xrelease')).toBeVisible();
  expect(screen.getByText('0xauthor')).toBeVisible();
  expect(screen.getByText('No withdrawals found in the scanned 5,000-block window.')).toBeVisible();
  expect(view.container.querySelectorAll('details,summary')).toHaveLength(0);
});
it('validates a deposit hash and only makes read-only verification requests', async () => {
  mocks.api.mockResolvedValue(proof);
  setup();
  await screen.findByText('0xdeposit');
  await userEvent.type(screen.getByRole('textbox'), 'invalid');
  await userEvent.click(screen.getByRole('button', { name: 'Verify' }));
  expect(screen.getByRole('alert')).toHaveTextContent('64 hexadecimal');
  expect(mocks.api).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('0xdeposit')).not.toBeInTheDocument();
  const hash = '0x' + 'a'.repeat(64);
  await userEvent.clear(screen.getByRole('textbox'));
  await userEvent.type(screen.getByRole('textbox'), hash);
  await userEvent.click(screen.getByRole('button', { name: 'Verify' }));
  await screen.findByText('0xdeposit');
  expect(
    mocks.api.mock.calls.some(
      ([path]) => path === '/blockchain/escrow-proof?transactionHash=' + hash,
    ),
  ).toBe(true);
  expect(mocks.api.mock.calls.every(([, options]) => !options?.method)).toBe(true);
});
it('does not present failed node reads as a confirmed payment', async () => {
  mocks.api.mockRejectedValue(new Error('Node offline'));
  setup();
  expect(await screen.findByRole('alert')).toHaveTextContent('Node offline');
  expect(screen.queryByText('Confirmed by the node')).not.toBeInTheDocument();
});
