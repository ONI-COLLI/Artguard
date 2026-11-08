import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import Presentation, { chapters } from '../src/pages/presentation';

const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('../src/lib/api', () => ({ api: mocks.api }));
const hash = '0x' + 'a'.repeat(64);
const proof = {
  status: 'verified',
  checkedAt: '2026-11-08T10:00:00Z',
  checks: [{ label: 'Canonical block verified', passed: true }],
  orders: [
    {
      id: 'order',
      state: 'released',
      buyer: '0x' + 'b'.repeat(40),
      amountWei: '12000000000000000',
      heldWei: '0',
      depositHash: hash,
      block: '8',
      releaseHash: hash,
      licenseActive: true,
      withdrawals: [],
    },
  ],
};
function setup() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}
    >
      <MemoryRouter>
        <Presentation />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  mocks.api.mockReset();
  mocks.api.mockImplementation(async (path: string) =>
    path.startsWith('/blockchain/escrow-proof')
      ? proof
      : {
          checkedAt: '2026-11-08T10:00:00Z',
          online: false,
          contracts: [],
          runs: [],
          message: 'No current deployment verified.',
        },
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
it('provides a public native walkthrough, rejects a changed illustrated payment, and sends no mutations', async () => {
  setup();
  const nav = within(screen.getByRole('navigation', { name: 'Guided demo chapters' }));
  await userEvent.click(nav.getByRole('button', { name: /Checkout/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Try changing the signed price' }));
  expect(screen.getByRole('alert')).toHaveTextContent('No transaction was sent');
  expect(screen.getByRole('button', { name: 'Show escrow deposit' })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Restore the signed price' }));
  await userEvent.click(screen.getByRole('button', { name: 'Show escrow deposit' }));
  expect(
    screen.getByRole('heading', { name: 'Payment is held until delivery and review.' }),
  ).toBeVisible();
  await userEvent.click(nav.getByRole('button', { name: /Withdrawal/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Simulate withdrawal' }));
  expect(screen.getByRole('status')).toHaveTextContent('Share transferred');
  expect(
    mocks.api.mock.calls.every(
      ([path, options]) =>
        ['/blockchain/presentation', '/blockchain/escrow-proof'].includes(path) && !options?.method,
    ),
  ).toBe(true);
});
it('advances and pauses autoplay, supports keyboard navigation and exits focus mode with Escape', async () => {
  setup();
  await act(async () => {});
  vi.useFakeTimers();
  vi.spyOn(performance, 'now').mockImplementation(() => Date.now());
  fireEvent.click(screen.getByRole('button', { name: 'Play presentation' }));
  await act(async () => {
    vi.advanceTimersByTime(10050);
  });
  expect(
    screen.getByRole('heading', { name: 'The contract is already on the EVM.' }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Pause presentation' }));
  await act(async () => {
    vi.advanceTimersByTime(60000);
  });
  expect(
    screen.getByRole('heading', { name: 'The contract is already on the EVM.' }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Focus view' }));
  fireEvent.keyDown(window, { key: 'ArrowRight' });
  expect(
    screen.getByRole('heading', { name: 'A fingerprint connects the file to its record.' }),
  ).toBeVisible();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.getByRole('button', { name: 'Focus view' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  expect(chapters.reduce((sum, c) => sum + c.seconds, 0)).toBeLessThan(180);
});
it('validates proof input, removes stale verification on failure and permits recovery without logging in', async () => {
  setup();
  await userEvent.click(screen.getByRole('button', { name: /Live proof/ }));
  expect(await screen.findByText('Verified directly on the local EVM')).toBeVisible();
  const input = screen.getByLabelText(/Deposit transaction hash/);
  await userEvent.type(input, 'invalid');
  const count = mocks.api.mock.calls.length;
  await userEvent.click(screen.getByRole('button', { name: 'Verify on-chain' }));
  expect(screen.getByRole('alert')).toHaveTextContent('64 hexadecimal');
  expect(mocks.api).toHaveBeenCalledTimes(count);
  await userEvent.clear(input);
  mocks.api.mockRejectedValueOnce(new Error('Node disconnected'));
  await userEvent.click(screen.getByRole('button', { name: 'Verify on-chain' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Node disconnected');
  expect(screen.queryByText('Verified directly on the local EVM')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Verify on-chain' }));
  expect(await screen.findByText('Verified directly on the local EVM')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: /Tests/ }));
  expect(screen.getByRole('status')).toHaveTextContent('No valid recorded test results');
});
