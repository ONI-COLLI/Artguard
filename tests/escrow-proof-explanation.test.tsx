import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EscrowProof } from '../src/components/escrow-proof';
import { explainEscrowCheck } from '../src/lib/escrow-proof-explainer';
const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('../src/lib/api', () => ({ api: mocks.api }));
beforeEach(() => {
  vi.clearAllMocks();
});
it('explains RPC comparisons, preserves failed results and links to the storage walkthrough', async () => {
  mocks.api.mockResolvedValue({
    status: 'failed',
    checkedAt: '2026-11-10T10:00:00Z',
    message: 'Verification failed.',
    orders: [],
    checks: [
      { label: 'Deposit succeeded at a configured escrow contract', passed: false },
      { label: 'Contract storage and consumed quote match order 0x12345678', passed: true },
    ],
  });
  const onExplain = vi.fn();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}
    >
      <EscrowProof onExplain={onExplain} />
    </QueryClientProvider>,
  );
  expect(await screen.findByText('Verification failed.')).toBeVisible();
  expect(screen.getByText('1 / 2')).toBeVisible();
  await userEvent.click(screen.getByText('Payment succeeded at the escrow contract'));
  expect(screen.getByText(/The receipt status must be success, not reverted/)).toBeVisible();
  expect(screen.getByText('Payment succeeded at the escrow contract').closest('li')).toHaveClass(
    'failed',
  );
  await userEvent.click(screen.getByRole('button', { name: 'RU' }));
  expect(screen.getByText('Оплата успешно дошла до escrow-контракта')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Где хранятся данные' }));
  expect(onExplain).toHaveBeenCalledWith('storage');
  expect(
    mocks.api.mock.calls.every(
      ([path, options]) => path === '/blockchain/escrow-proof' && !options?.method,
    ),
  ).toBe(true);
});
it('recognizes per-order labels and does not invent an explanation for unknown evidence', () => {
  expect(
    explainEscrowCheck('Contract storage and consumed quote match order 0xabcd')?.title[1],
  ).toContain('хранит этот заказ');
  expect(explainEscrowCheck('Future node check')).toBeUndefined();
});
