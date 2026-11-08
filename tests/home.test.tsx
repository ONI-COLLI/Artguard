import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Home from '../src/pages/overview';
import { planRules } from '../shared/schemas';
import { CurrencyProvider, CurrencyPicker } from '../src/components/currency';
import { fixtureSnapshot } from './exchange-fixture';

const mocks = vi.hoisted(() => ({ api: vi.fn(), auth: vi.fn() }));
vi.mock('../src/lib/api', () => ({ api: mocks.api }));
vi.mock('../src/lib/workspace', () => ({
  useData: () => ({ user: null, plans: planRules }),
}));
vi.mock('../src/components/dialogs', () => ({ useDialog: () => ({ auth: mocks.auth }) }));
const summary = {
  updatedAt: '2026-10-21T12:00:00.000Z',
  completedTransactions: 7,
  licensesIssued: 9,
  projectsAvailable: 12,
  licenseVolumeWei: '12000000000000000',
  featured: {
    id: 'public',
    title: 'Shared Horizons',
    author: 'Creator',
    category: 'Illustration',
    image: '/media/public',
  },
};
function setup(withCurrency = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        {withCurrency ? (
          <CurrencyProvider>
            <CurrencyPicker />
            <Home />
          </CurrencyProvider>
        ) : (
          <Home />
        )}
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}
beforeEach(() => {
  sessionStorage.setItem('artguard:display-currency:v2', 'USD');
  sessionStorage.clear();
  sessionStorage.setItem('artguard:display-currency:v2', 'USD');
  vi.clearAllMocks();
  mocks.api.mockImplementation(async (path) =>
    path === '/exchange-rates' ? fixtureSnapshot : summary,
  );
});
it('explains the service and displays public transaction statistics with working destinations', async () => {
  setup();
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
    'Original work.Clear licenses.',
  );
  const stats = screen.getByRole('region', { name: 'ArtGuard in numbers' });
  expect(await within(stats).findByText('7')).toBeVisible();
  expect(within(stats).getByText('9')).toBeVisible();
  expect(within(stats).getByText('12')).toBeVisible();
  expect(within(stats).getByText('$12.00')).toBeVisible();
  expect(screen.getByRole('link', { name: /Explore marketplace/ })).toHaveAttribute(
    'href',
    '/marketplace',
  );
  expect(screen.getByRole('link', { name: /Publish your work/ })).toHaveAttribute(
    'href',
    '/upload',
  );
  expect(screen.getByRole('link', { name: /Explore project: Shared Horizons/ })).toHaveAttribute(
    'href',
    '/artwork/public',
  );
  expect(screen.getByText(/Test ETH has no monetary value/)).toBeVisible();
  const plans = within(screen.getByRole('region', { name: 'Simple plans. Clear commissions.' }));
  for (const [name, price, commission] of [
    ['Free', '$0', '10%'],
    ['Premium', '$10', '5%'],
    ['Business', '$50', '0%'],
  ]) {
    const card = within(plans.getByRole('article', { name: name + ' plan' }));
    expect(card.getByText(price)).toBeVisible();
    expect(card.getByText('/ month')).toBeVisible();
    expect(card.getByText(commission)).toBeVisible();
  }
  await userEvent.click(plans.getByRole('button', { name: 'Choose Premium' }));
  expect(mocks.auth).toHaveBeenCalledWith('login', expect.any(Function));
});
it('updates all monthly plan prices and the currency label from the global picker, retaining commissions', async () => {
  setup(true);
  const plans = within(screen.getByRole('region', { name: 'Simple plans. Clear commissions.' }));
  for (const [code, option, prices] of [
    ['KZT', 'KZT · Kazakhstani Tenge', ['0 ₸', '4,503.80 ₸', '22,519 ₸']],
    ['BTC', 'BTC · Bitcoin', ['0 BTC', '0.0001 BTC', '0.0005 BTC']],
    ['USD', 'USD · US Dollar', ['$0', '$10', '$50']],
  ] as const) {
    await userEvent.click(screen.getByRole('combobox', { name: 'Display currency' }));
    await userEvent.click(await screen.findByRole('option', { name: option }));
    expect(plans.getByText('Monthly pricing · ' + code)).toBeVisible();
    for (const [index, name] of ['Free', 'Premium', 'Business'].entries()) {
      const card = within(plans.getByRole('article', { name: name + ' plan' }));
      expect(card.getByText(prices[index])).toBeVisible();
      expect(card.getByText(['10%', '5%', '0%'][index])).toBeVisible();
    }
  }
  expect(plans.getByText('Recommended')).toBeVisible();
});
it('updates sales volume from the global currency picker and retains the full amount on hover', async () => {
  setup(true);
  const stats = within(screen.getByRole('region', { name: 'ArtGuard in numbers' }));
  expect(await stats.findByText('$12.00')).toHaveAttribute('title', '$12.00 · 0.012 test ETH');
  for (const [option, amount, full] of [
    ['KZT · Kazakhstani Tenge', '5.4K ₸', '5,404.56 ₸ · 0.012 test ETH'],
    ['BTC · Bitcoin', '0.00012 BTC', '0.00012 BTC · 0.012 test ETH'],
    ['test ETH · Local test ETH', '0.012 test ETH', '0.012 test ETH'],
    ['USD · US Dollar', '$12.00', '$12.00 · 0.012 test ETH'],
  ]) {
    await userEvent.click(screen.getByRole('combobox', { name: 'Display currency' }));
    await userEvent.click(await screen.findByRole('option', { name: option }));
    expect(stats.getByText(amount)).toHaveAttribute('title', full);
  }
});
it('keeps billion-scale sales volume compact and does not invent a conversion if the selected rate is missing', async () => {
  sessionStorage.setItem('artguard:display-currency:v2', 'KZT');
  mocks.api.mockImplementation(async (path) =>
    path === '/exchange-rates'
      ? {
          ...fixtureSnapshot,
          rates: {
            ...fixtureSnapshot.rates,
            KZT: { ...fixtureSnapshot.rates.KZT, numerator: '500', denominator: '1' },
          },
        }
      : { ...summary, licenseVolumeWei: String(280000000n * 10n ** 15n) },
  );
  const client = setup(true);
  const stats = within(screen.getByRole('region', { name: 'ArtGuard in numbers' }));
  expect(await stats.findByText('140B ₸')).toHaveAttribute(
    'title',
    '140,000,000,000.00 ₸ · 280000 test ETH',
  );
  client.setQueryData(['exchange-rates'], { ...fixtureSnapshot, rates: {} });
  expect(await stats.findByText('KZT rate unavailable')).toBeVisible();
  expect(stats.getByText('—')).toBeVisible();
});
it('keeps missing statistics unavailable instead of inventing zeros, and supports retry', async () => {
  mocks.api.mockRejectedValue(new Error('Offline'));
  setup();
  // The component permits one retry; wait for its explicit unavailable state.
  expect(
    await screen.findByText('Statistics could not be refreshed.', {}, { timeout: 4000 }),
  ).toBeVisible();
  const stats = screen.getByRole('region', { name: 'ArtGuard in numbers' });
  expect(within(stats).getAllByText('—')).toHaveLength(4);
  mocks.api.mockResolvedValue({ ...summary, completedTransactions: 0 });
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await within(stats).findByText('0')).toBeVisible();
});
it('retains the last saved counts and marks them unrefreshed when an update fails', async () => {
  const client = setup();
  expect(await screen.findByText('7')).toBeVisible();
  mocks.api.mockRejectedValue(new Error('Offline'));
  await client.invalidateQueries({ queryKey: ['home-summary'] });
  await waitFor(
    () => expect(screen.getByText('Statistics could not be refreshed.')).toBeVisible(),
    { timeout: 4000 },
  );
  expect(screen.getByText('7')).toBeVisible();
});
