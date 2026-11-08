import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  ChainAmount,
  CurrencyPicker,
  CurrencyProvider,
  useDisplayCurrency,
} from '../src/components/currency';
import {
  convertInput,
  formatCents,
  formatUsd,
  formatWei,
  formatMarketWei,
  rateIsOld,
} from '../src/lib/currency';
import { fixtureRates as rates, fixtureSnapshot } from './exchange-fixture';
const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('../src/lib/api', () => ({ api: mocks.api }));
beforeEach(() => {
  sessionStorage.clear();
  vi.clearAllMocks();
  mocks.api.mockResolvedValue(fixtureSnapshot);
});

it('uses published fiat rates and keeps real crypto separate from the local payment rule', () => {
  expect(formatUsd(12, 'KZT', false, rates)).toBe('5,404.56 ₸');
  expect(formatUsd(12, 'ETH', false, rates)).toBe('0.0048 ETH');
  expect(formatUsd(12, 'TEST_ETH', false, rates)).toBe('0.012 test ETH');
  expect(formatWei('12000000000000000', 'KZT', rates)).toBe('5,404.56 ₸');
  expect(formatMarketWei('1000000000000000000', 'KZT', rates)).toBe('1,125,950.00 ₸');
  expect(formatWei('12000000000000000', 'ETH', rates)).toBe('0.0048 ETH');
});
it('converts exact decimals, including non-dollar crypto crosses and stablecoin market prices', () => {
  expect(convertInput('0.1', 'ETH', 'KZT', rates, true)).toBe('112,595.00 ₸');
  expect(convertInput('1', 'BTC', 'ETH', rates, true)).toBe('40 ETH');
  expect(convertInput('1', 'USD', 'USDT', rates, true)).toBe('1.00050025 USDT');
  expect(convertInput('12', 'USD', 'JPY', rates, true)).toBe('1,800 JPY');
  expect(convertInput('12', 'USD', 'KWD', rates, true)).toBe('3.684 KWD');
  expect(convertInput('4503.80', 'KZT', 'USD', rates)).toBe('10');
  expect(convertInput('0.0048', 'ETH', 'USD', rates)).toBe('12');
});
it('preserves integer precision above Number.MAX_SAFE_INTEGER and rounds only the output', () => {
  expect(formatCents(900719925474099399n, 'KZT', false, rates)).toBe(
    '4,056,662,400,350,248,873.22 ₸',
  );
  expect(formatWei('9007199254740993', 'TEST_ETH', rates)).toBe('0.009007199254740993 test ETH');
  expect(formatCents(1n, 'EUR', false, rates)).toBe('€0.01');
  expect(formatCents(-1n, 'EUR', false, rates)).toBe('-€0.01');
  expect(formatWei(1n, 'TEST_ETH', rates)).toBe('0.000000000000000001 test ETH');
  expect(convertInput('1e999', 'USD', 'KZT', rates)).toBeNull();
});
it('never substitutes invented rates when a source is unavailable and identifies old dates', () => {
  expect(convertInput('10', 'USD', 'KZT', {})).toBeNull();
  expect(formatCents(1000n, 'KZT')).toBe('$10.00 USD');
  expect(formatMarketWei('1000000000000000000', 'KZT', {})).toBeNull();
  expect(rateIsOld(rates.KZT, Date.parse('2026-10-22T00:00:00Z'))).toBe(false);
  expect(rateIsOld(rates.KZT, Date.parse('2026-11-01T00:00:00Z'))).toBe(true);
  expect(rateIsOld(rates.ETH, Date.parse('2026-10-21T17:11:00Z'))).toBe(true);
});
it('shortens large selected-currency totals without losing integer precision or changing regular prices', () => {
  const compact = { compact: true };
  const wei = (usd: bigint) => usd * 10n ** 15n;
  for (const [usd, expected] of [
    [1200n, '$1.2K'],
    [999949n, '$999.9K'],
    [999950n, '$1M'],
    [140000000000n, '$140B'],
    [14000000000000n, '$14T'],
    [-1200n, '-$1.2K'],
  ] as const)
    expect(formatWei(wei(usd), 'USD', rates, compact)).toBe(expected);
  const tengeRates = {
    ...rates,
    KZT: { ...rates.KZT, numerator: '500', denominator: '1' },
  };
  expect(formatWei(wei(280000000n), 'KZT', tengeRates, compact)).toBe('140B ₸');
  expect(formatWei(wei(12n), 'BTC', rates, compact)).toBe('0.00012 BTC');
  expect(formatWei(1200n * 10n ** 18n, 'TEST_ETH', rates, compact)).toBe('1.2K test ETH');
  expect(formatWei(1n, 'TEST_ETH', rates, compact)).toBe('0.000000000000000001 test ETH');
  expect(formatWei(wei(1200n), 'USD', rates)).toBe('$1,200.00');
  expect(formatWei(wei(12n), 'KZT', {}, compact)).toBeNull();
});
function Preview() {
  const { money } = useDisplayCurrency();
  return (
    <>
      <CurrencyPicker />
      <output aria-label="License price">{money(12)}</output>
      <ChainAmount wei="12000000000000000" />
    </>
  );
}
function setup(children = <Preview />) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <CurrencyProvider>{children}</CurrencyProvider>
    </QueryClientProvider>,
  );
}
it('starts new visitors in Kazakhstani tenge while preserving an explicit saved preference', async () => {
  setup();
  expect(screen.getByRole('combobox', { name: 'Display currency' })).toHaveTextContent('KZT');
  expect(await screen.findByLabelText('License price')).toHaveTextContent(/₸|USD/);
});
it('updates catalog references and native receipts together and restores the selected currency', async () => {
  const first = setup();
  await userEvent.click(screen.getByRole('combobox', { name: 'Display currency' }));
  await screen.findByRole('option', { name: 'KZT · Kazakhstani Tenge' });
  await userEvent.click(screen.getByRole('option', { name: 'KZT · Kazakhstani Tenge' }));
  expect(screen.getByLabelText('License price')).toHaveTextContent('5,404.56 ₸');
  expect(screen.getByText('0.012 test ETH')).toBeVisible();
  first.unmount();
  setup();
  expect(screen.getByRole('combobox', { name: 'Display currency' })).toHaveTextContent('KZT');
  await userEvent.click(screen.getByRole('combobox', { name: 'Display currency' }));
  await screen.findByRole('option', { name: 'ETH · Ethereum' });
  await userEvent.click(screen.getByRole('option', { name: 'ETH · Ethereum' }));
  expect(screen.getByLabelText('License price')).toHaveTextContent('0.0048 ETH');
  expect(screen.getByText('0.012 test ETH')).toBeVisible();
});
it('migrates the previous test ETH preference without relabeling it as real Ethereum', async () => {
  sessionStorage.setItem('artguard:display-currency', 'ETH');
  setup();
  expect(screen.getByRole('combobox', { name: 'Display currency' })).toHaveTextContent('test ETH');
  expect(screen.getByLabelText('License price')).toHaveTextContent('0.012 test ETH');
});
