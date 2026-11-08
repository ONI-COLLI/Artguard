import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Accounting, { accountingAmount } from '../src/pages/accounting';
const mocks = vi.hoisted(() => ({ api: vi.fn(), notify: vi.fn(), allowed: true }));
vi.mock('../src/lib/api', async (original) => ({ ...(await original()), api: mocks.api }));
vi.mock('../src/components/dialogs', () => ({ AccessPanel: () => null }));
vi.mock('../src/lib/workspace', () => ({
  useData: () => ({
    user: { id: 'admin', isAdmin: false, isManager: mocks.allowed, emailVerified: true },
  }),
  useFeedback: () => ({ notify: mocks.notify }),
  useDownload: () => ({ pending: false, run: vi.fn() }),
}));
const totals = {
  sales: 0,
  gross: '0',
  commission: '0',
  creatorNet: '0',
  coauthorNet: '0',
  subscriptions: '0',
  promotions: '0',
  platformRevenue: '0',
};
const summary = {
  counts: {
    activeAccounts: 2,
    sampleAccounts: 6,
    listed: 8,
    products: 8,
    deleted: 0,
    soldProducts: 1,
    sales: 1,
    drafts: 0,
    hidden: 0,
    awaitingApproval: 0,
  },
  catalogValueCents: '24000',
  totals: {
    test_eth: totals,
    local_usd: {
      ...totals,
      sales: 1,
      gross: '1200',
      commission: '120',
      creatorNet: '1080',
      platformRevenue: '120',
    },
  },
  balanceSnapshot: {
    id: 'snapshot-one',
    instanceId: '0x' + 'a'.repeat(64),
    blockNumber: '15',
    observedAt: '2026-10-21T12:00:00Z',
    platform: {
      marketplaceWei: '0',
      subscriptionWei: '0',
      availableWei: '0',
      nativeWei: '10000000000000000000000',
      treasuries: [],
    },
  },
};
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Accounting />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.allowed = true;
  mocks.api.mockImplementation(async (path) => {
    if (path.startsWith('/manager/finance?'))
      return {
        period: { from: '2026-11-01', to: '2026-11-30', timezone: 'UTC+5' },
        basis: 'Reference management model',
        cashRevenueCents: '0',
        earnedRevenueCents: '0',
        deferredServiceCents: '0',
        operatingCostsCents: '0',
        profitCents: '0',
        salesVolumeCents: '0',
        salesCount: 0,
        recordedEscrowWei: '0',
        refundsInPeriodWei: '0',
        breakdown: { commission: '0', subscriptions: '0', promotions: '0' },
        expenses: [],
      };
    if (path === '/manager/accounting/sync')
      throw new Error('Local chain is offline. Previous snapshots are retained.');
    return summary;
  });
});
it('formats wei and integer cents without losing precision', () => {
  expect(accountingAmount('9007199254740993')).toBe('0.009007199254740993 test ETH');
  expect(accountingAmount('900719925474099399', 'local_usd')).toBe('$9,007,199,254,740,993.99');
});
it('does not request private financial records for a non-manager', async () => {
  mocks.allowed = false;
  setup();
  expect(screen.getByText(/Manager access is required/)).toBeInTheDocument();
  expect(mocks.api).not.toHaveBeenCalled();
});
it('retains the last snapshot after a failed synchronization and labels simulated orders separately', async () => {
  setup();
  await screen.findByText('Confirmed test ETH payments');
  expect(screen.getByText('Simulated local orders')).toBeInTheDocument();
  expect(screen.getByText(/These records do not represent money received/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Sync blockchain balances' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Local chain is offline');
  expect(screen.getByText('snapshot-one')).toBeInTheDocument();
  expect(screen.getByText('10000 test ETH')).toBeInTheDocument();
  expect(mocks.notify).not.toHaveBeenCalled();
});
