import { formatEther } from 'viem';
import { testWeiPerCent } from '../../shared/marketplace';
import {
  convertFraction,
  decimalFraction,
  decimalString,
  rateFraction,
  roundedUnits,
  type Fraction,
  type RateTable,
} from '../../shared/exchange';
export type { DisplayCurrency } from '../../shared/exchange';

export const isDisplayCurrency = (value: unknown): value is string =>
  typeof value === 'string' && (value === 'TEST_ETH' || /^[A-Z][A-Z0-9]{1,9}$/.test(value));
export function currencyOptions(rates: RateTable, includeTest = true) {
  const options = Object.values(rates).filter((r) => r.code !== 'USD');
  const usd = { code: 'USD', name: 'US Dollar', kind: 'fiat' as const };
  return [
    usd,
    ...options.sort((a, b) => a.name.localeCompare(b.name)),
    ...(includeTest ? [{ code: 'TEST_ETH', name: 'Local test ETH', kind: 'test' as const }] : []),
  ];
}
function targetFraction(usd: Fraction, currency: string, rates: RateTable) {
  if (currency === 'TEST_ETH') return { n: usd.n, d: usd.d * 1000n };
  return convertFraction(usd, 'USD', currency, rates);
}
function currencyLabel(amount: string, currency: string) {
  const symbol: Record<string, string> = { USD: '$', EUR: '€', GBP: '£' };
  const sign = amount.startsWith('-') ? '-' : '';
  return symbol[currency]
    ? sign + symbol[currency] + amount.slice(sign.length)
    : amount + ' ' + (currency === 'KZT' ? '₸' : currency === 'TEST_ETH' ? 'test ETH' : currency);
}
function compactAmount(value: Fraction, currency: string) {
  const absolute = value.n < 0n ? -value.n : value.n;
  if (absolute < value.d * 1000n) return null;
  const suffixes = ['K', 'M', 'B', 'T'];
  let index = 0,
    scale = 1000n;
  while (index < suffixes.length - 1 && absolute >= value.d * scale * 1000n) {
    scale *= 1000n;
    index++;
  }
  // Promote rounded boundaries too: 999,999 becomes 1M, rather than 1000K.
  if (
    index < suffixes.length - 1 &&
    roundedUnits({ n: absolute, d: value.d * scale }, 1) >= 10000n
  ) {
    scale *= 1000n;
    index++;
  }
  return currencyLabel(
    decimalString({ n: value.n, d: value.d * scale }, 1) + suffixes[index],
    currency,
  );
}
function formatAmount(
  value: Fraction,
  currency: string,
  rates: RateTable,
  whole = false,
  compact = false,
) {
  if (compact) {
    const shortened = compactAmount(value, currency);
    if (shortened) return shortened;
  }
  const crypto = currency === 'TEST_ETH' || rates[currency]?.kind === 'crypto',
    decimals = crypto ? 8 : (rates[currency]?.decimals ?? 2),
    units = roundedUnits(value, decimals),
    abs = units < 0n ? -units : units,
    scale = 10n ** BigInt(decimals),
    sign = units < 0n ? '-' : '',
    major = new Intl.NumberFormat('en-US').format(abs / scale);
  let tail = decimals ? String(abs % scale).padStart(decimals, '0') : '';
  if (crypto) tail = tail.replace(/0+$/, '');
  else if (whole && abs % scale === 0n) tail = '';
  const amount = sign + major + (tail ? '.' + tail : '');
  if (value.n !== 0n && units === 0n) {
    const minimum = decimals ? '0.' + '0'.repeat(decimals - 1) + '1' : '1';
    return `${value.n < 0n ? '>-' : '<'}${minimum} ${currency === 'TEST_ETH' ? 'test ETH' : currency}`;
  }
  return currencyLabel(amount, currency);
}
export function formatCents(cents: bigint, currency: string, whole = false, rates: RateTable = {}) {
  const usd = { n: cents, d: 100n },
    value = targetFraction(usd, currency, rates);
  return value
    ? formatAmount(value, currency, rates, whole)
    : formatAmount(usd, 'USD', rates, whole) + ' USD';
}
export function formatUsd(usd: number, currency: string, whole = false, rates: RateTable = {}) {
  return formatCents(BigInt(Math.round(usd * 100)), currency, whole, rates);
}
// Local quotes retain their catalog reference, which is not a market value for test ETH.
export function formatWei(
  wei: bigint | string,
  currency: string,
  rates: RateTable = {},
  { compact = false }: { compact?: boolean } = {},
) {
  if (currency === 'TEST_ETH')
    return (
      (compact && compactAmount({ n: BigInt(wei), d: 10n ** 18n }, currency)) ||
      `${formatEther(BigInt(wei))} test ETH`
    );
  const usd = { n: BigInt(wei), d: testWeiPerCent * 100n },
    value = targetFraction(usd, currency, rates);
  return value ? formatAmount(value, currency, rates, false, compact) : null;
}
export function formatMarketWei(wei: bigint | string, currency: string, rates: RateTable) {
  if (currency === 'TEST_ETH') return null;
  const value = convertFraction({ n: BigInt(wei), d: 10n ** 18n }, 'ETH', currency, rates);
  return value ? formatAmount(value, currency, rates) : null;
}
export function convertInput(
  input: string,
  from: string,
  to: string,
  rates: RateTable,
  formatted = false,
) {
  try {
    const amount = decimalFraction(input);
    const extended =
      from === 'TEST_ETH' || to === 'TEST_ETH'
        ? {
            ...rates,
            TEST_ETH: {
              code: 'TEST_ETH',
              name: 'Local test ETH',
              kind: 'crypto' as const,
              numerator: '1',
              denominator: '1000',
              decimals: 8,
              observedAt: '',
              source: 'CoinGecko' as const,
            },
          }
        : rates;
    const value = convertFraction(amount, from, to, extended);
    return value ? (formatted ? formatAmount(value, to, rates) : decimalString(value, 24)) : null;
  } catch {
    return null;
  }
}
export function rateIsOld(rate: RateTable[string], now = Date.now()) {
  return now - Date.parse(rate.observedAt) > (rate.kind === 'crypto' ? 10 * 60_000 : 4 * 86400_000);
}
export const canConvert = (currency: string, rates: RateTable) =>
  currency === 'TEST_ETH' || !!rateFraction(currency, rates);
