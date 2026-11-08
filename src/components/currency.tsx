import { createContext, useContext, useId, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { testEth } from '../../shared/marketplace';
import type { ExchangeSnapshot, RateTable } from '../../shared/exchange';
import { decimalString } from '../../shared/exchange';
import { api } from '../lib/api';
import { Select, type SelectOption } from './select';
import {
  canConvert,
  convertInput,
  currencyOptions,
  formatUsd,
  formatWei,
  formatMarketWei,
  isDisplayCurrency,
  rateIsOld,
} from '../lib/currency';

const key = 'artguard:display-currency:v2';
const CurrencyContext = createContext<{
  currency: string;
  setCurrency: (currency: string) => void;
  rates: RateTable;
  snapshot?: ExchangeSnapshot;
  loading: boolean;
  failed: boolean;
}>({
  currency: 'USD',
  setCurrency: () => {},
  rates: {},
  loading: false,
  failed: false,
});

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [currency, update] = useState(() => {
    try {
      const current = sessionStorage.getItem(key),
        legacy = sessionStorage.getItem('artguard:display-currency');
      const saved = current || (legacy === 'ETH' ? 'TEST_ETH' : legacy);
      return isDisplayCurrency(saved) ? saved : 'KZT';
    } catch {
      return 'KZT';
    }
  });
  const query = useQuery({
    queryKey: ['exchange-rates'],
    queryFn: ({ signal }) => api<ExchangeSnapshot>('/exchange-rates', { signal }),
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: 1,
  });
  return (
    <CurrencyContext
      value={{
        currency,
        rates: query.data?.rates || {},
        snapshot: query.data,
        loading: query.isFetching,
        failed: query.isError,
        setCurrency: (next) => {
          update(next);
          try {
            sessionStorage.setItem(key, next);
          } catch {
            /* Keep the preference in memory. */
          }
        },
      }}
    >
      {children}
    </CurrencyContext>
  );
}
export function useDisplayCurrency() {
  const context = useContext(CurrencyContext);
  return {
    ...context,
    available: canConvert(context.currency, context.rates),
    money: (usd: number, whole = false) => formatUsd(usd, context.currency, whole, context.rates),
    fromUsd: (usd: string) => convertInput(usd, 'USD', context.currency, context.rates),
    toUsd: (value: string) => convertInput(value, context.currency, 'USD', context.rates),
  };
}
export function CurrencyPicker({ compact = false }: { compact?: boolean }) {
  const { currency, setCurrency, rates } = useDisplayCurrency(),
    id = useId(),
    options = currencyOptions(rates),
    popular = ['USD', 'KZT', 'EUR', 'GBP', 'BTC', 'ETH', 'USDT', 'USDC', 'SOL'];
  const groups = [
    {
      name: 'Popular',
      entries: options
        .filter((o) => popular.includes(o.code))
        .sort((a, b) => popular.indexOf(a.code) - popular.indexOf(b.code)),
    },
    {
      name: 'Currencies',
      entries: options.filter((o) => o.kind === 'fiat' && !popular.includes(o.code)),
    },
    {
      name: 'Cryptocurrencies',
      entries: options.filter((o) => o.kind === 'crypto' && !popular.includes(o.code)),
    },
    { name: 'Local test network', entries: options.filter((o) => o.kind === 'test') },
  ];
  const entries: SelectOption[] = groups.flatMap(({ name, entries }) =>
    entries.map((o) => ({
      value: o.code,
      label: `${o.code === 'TEST_ETH' ? 'test ETH' : o.code} · ${o.name}`,
      shortLabel: compact ? (o.code === 'TEST_ETH' ? 'test ETH' : o.code) : undefined,
      group: name,
    })),
  );
  if (!options.some((o) => o.code === currency))
    entries.unshift({
      value: currency,
      label: `${currency} · rate unavailable`,
      shortLabel: compact ? currency : undefined,
    });
  return (
    <div className={`currency-picker${compact ? ' compact' : ''}`}>
      <label className={compact ? 'sr-only' : undefined} htmlFor={id}>
        Display currency
      </label>
      <Select id={id} value={currency} onChange={setCurrency} options={entries} searchable />
    </div>
  );
}
export function ChainAmount({
  wei,
  basis = 'catalog',
}: {
  wei: bigint | string;
  basis?: 'catalog' | 'market';
}) {
  const { currency, rates } = useDisplayCurrency(),
    value =
      basis === 'market' ? formatMarketWei(wei, currency, rates) : formatWei(wei, currency, rates),
    converted = currency !== 'TEST_ETH' && value;
  return (
    <span className={`chain-amount${basis === 'market' ? ' market-comparison' : ''}`}>
      {basis === 'market' && (
        <span title={testEth(wei)} aria-label={testEth(wei)}>
          {decimalString({ n: BigInt(wei), d: 10n ** 18n }, 6)} test ETH
        </span>
      )}
      {converted && (
        <span
          className="converted-amount"
          title={
            basis === 'market'
              ? 'Hypothetical value of the same amount of real ETH. Test ETH has no monetary value.'
              : 'Catalog reference converted with the selected published rate. The local quote is paid in test ETH.'
          }
        >
          ≈ {value}
        </span>
      )}
      {basis !== 'market' && (
        <span className={converted ? 'native-amount' : undefined}>{testEth(wei)}</span>
      )}
    </span>
  );
}
export function RateInfo({ code }: { code: string }) {
  const { rates, snapshot, loading } = useDisplayCurrency(),
    rate = rates[code];
  if (code === 'USD') return <span>USD base currency</span>;
  if (code === 'TEST_ETH') return <span>Local test unit · no market value</span>;
  if (!rate)
    return (
      <span className="rate-warning">
        {loading ? `Loading ${code} rate…` : `${code} rate unavailable`}
      </span>
    );
  const provider = snapshot?.providers.find((p) => p.source === rate.source),
    old = rateIsOld(rate);
  return (
    <span className={old || provider?.status !== 'current' ? 'rate-warning' : undefined}>
      {rate.source} ·{' '}
      {rate.kind === 'fiat'
        ? 'reference date ' + rate.observedAt
        : 'price ' +
          new Date(rate.observedAt).toLocaleString('en-GB', {
            timeZone: 'Asia/Qyzylorda',
            year: 'numeric',
            month: 'short',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          }) +
          ' (UTC+5)'}
      {(old || provider?.status !== 'current') && ' · cached / outdated'}
    </span>
  );
}
export function CurrencyNote() {
  const { currency, failed } = useDisplayCurrency();
  if (currency === 'USD' || currency === 'TEST_ETH') return null;
  return (
    <div className="currency-note">
      <RateInfo code={currency} />
      {failed && <span className="rate-warning"> · Unable to refresh rates.</span>}
    </div>
  );
}
