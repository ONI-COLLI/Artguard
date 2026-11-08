import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Router } from 'express';
import {
  cryptoAssets,
  decimalFraction,
  type ExchangeRate,
  type ExchangeSnapshot,
  type RateSource,
  type RateTable,
} from '../shared/exchange.js';

const fiatUrl = 'https://api.frankfurter.dev/v2/rates?base=USD';
const metals = new Set(['XAU', 'XAG', 'XPT', 'XPD']);
const namesUrl = 'https://api.frankfurter.dev/v2/currencies';
const cryptoUrl =
  'https://api.coingecko.com/api/v3/simple/price?' +
  new URLSearchParams({
    ids: cryptoAssets.map((a) => a[2]).join(','),
    vs_currencies: 'usd',
    include_last_updated_at: 'true',
    precision: 'full',
  });
const ttl: Record<RateSource, number> = { Frankfurter: 60 * 60_000, CoinGecko: 60_000 };
type Group = {
  rates: RateTable;
  fetchedAt: string | null;
  attemptedAt: number;
  error: string | null;
};
const blank = (): Group => ({ rates: {}, fetchedAt: null, attemptedAt: 0, error: null });

// Keep decimal JSON tokens intact instead of converting provider prices to binary floats.
export function parseRateJson(text: string): unknown {
  if (text.length > 2_000_000) throw new Error('Rate response is too large.');
  return JSON.parse(text, (_key, value: unknown, context?: { source?: string }) =>
    typeof value === 'number' ? context?.source || String(value) : value,
  );
}
export function parseFiatRates(raw: unknown, names: unknown): RateTable {
  if (!Array.isArray(raw)) throw new Error('Invalid fiat rate response.');
  const metadata = new Map(Array.isArray(names) ? names.map((n) => [n.iso_code, n.name]) : []);
  const displayNames = new Intl.DisplayNames('en', { type: 'currency' }),
    rates: RateTable = {};
  for (const row of raw) {
    if (
      row?.base !== 'USD' ||
      metals.has(row.quote) ||
      !/^[A-Z]{3}$/.test(row.quote) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(row.date)
    )
      continue;
    const value = decimalFraction(String(row.rate));
    if (value.n <= 0n || !Number.isFinite(Date.parse(row.date))) continue;
    const precision = new Intl.NumberFormat('en', {
      style: 'currency',
      currency: row.quote,
    }).resolvedOptions().maximumFractionDigits;
    rates[row.quote] = {
      code: row.quote,
      name: metadata.get(row.quote) || displayNames.of(row.quote) || row.quote,
      kind: 'fiat',
      numerator: String(value.n),
      denominator: String(value.d),
      decimals: precision ?? 2,
      observedAt: row.date,
      source: 'Frankfurter',
    };
  }
  if (!rates.KZT || !rates.EUR || Object.keys(rates).length < 3)
    throw new Error('Incomplete fiat rate response.');
  if (rates.USD && rates.USD.numerator !== rates.USD.denominator)
    throw new Error('Invalid USD base rate.');
  return rates;
}
export function parseCryptoRates(raw: unknown, now: number): RateTable {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('Invalid crypto rate response.');
  const rates: RateTable = {};
  for (const [code, name, id] of cryptoAssets) {
    const row = (raw as Record<string, { usd?: string; last_updated_at?: string }>)[id];
    if (!row?.usd || !row.last_updated_at) continue;
    const price = decimalFraction(String(row.usd)),
      time = Number(row.last_updated_at) * 1000;
    if (
      price.n <= 0n ||
      !Number.isFinite(time) ||
      time < Date.UTC(2009, 0, 1) ||
      time > now + 300_000
    )
      continue;
    rates[code] = {
      code,
      name,
      kind: 'crypto',
      numerator: String(price.d),
      denominator: String(price.n),
      decimals: 8,
      observedAt: new Date(time).toISOString(),
      source: 'CoinGecko',
    };
  }
  if (!rates.BTC || !rates.ETH) throw new Error('Incomplete crypto rate response.');
  return rates;
}
export class ExchangeRates {
  private groups: Record<RateSource, Group> = { Frankfurter: blank(), CoinGecko: blank() };
  private initialized: Promise<void> | null = null;
  private pending: Promise<void> | null = null;
  constructor(
    private cacheFile: string,
    private fetcher: typeof fetch = fetch,
    private clock = Date.now,
  ) {}
  private async load() {
    try {
      const saved = JSON.parse(await readFile(this.cacheFile, 'utf8'));
      if (saved.version !== 1) return;
      for (const source of ['Frankfurter', 'CoinGecko'] as const) {
        const group = saved.groups?.[source];
        if (
          !group?.fetchedAt ||
          !Number.isFinite(Date.parse(group.fetchedAt)) ||
          Date.parse(group.fetchedAt) > this.clock() + 300_000
        )
          continue;
        const entries = Object.values(group.rates || {}) as ExchangeRate[];
        if (
          !entries.length ||
          entries.length > 500 ||
          entries.some(
            (r) =>
              !r ||
              r.source !== source ||
              !/^[A-Z0-9]{2,10}$/.test(r.code) ||
              typeof r.name !== 'string' ||
              !['fiat', 'crypto'].includes(r.kind) ||
              !/^[1-9]\d{0,120}$/.test(r.numerator) ||
              !/^[1-9]\d{0,120}$/.test(r.denominator) ||
              !Number.isInteger(r.decimals) ||
              r.decimals < 0 ||
              r.decimals > 18 ||
              !Number.isFinite(Date.parse(r.observedAt)),
          )
        )
          continue;
        this.groups[source] = {
          rates: Object.fromEntries(
            entries.filter((r) => !metals.has(r.code)).map((r) => [r.code, r]),
          ),
          fetchedAt: group.fetchedAt,
          attemptedAt: 0,
          error: null,
        };
      }
    } catch {
      /* An absent or corrupt cache must never become a made-up exchange rate. */
    }
  }
  private async json(url: string) {
    const response = await this.fetcher(url, {
      signal: AbortSignal.timeout(10_000),
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`Rate provider returned HTTP ${response.status}.`);
    return parseRateJson(await response.text());
  }
  private async refresh(source: RateSource) {
    const group = this.groups[source],
      now = this.clock();
    if (group.fetchedAt && now - Date.parse(group.fetchedAt) < ttl[source] && !group.error) return;
    if (group.attemptedAt && now - group.attemptedAt < 60_000) return;
    group.attemptedAt = now;
    try {
      const rates =
        source === 'Frankfurter'
          ? await Promise.all([this.json(fiatUrl), this.json(namesUrl).catch(() => [])]).then(
              ([raw, names]) => parseFiatRates(raw, names),
            )
          : parseCryptoRates(await this.json(cryptoUrl), now);
      this.groups[source] = {
        rates,
        fetchedAt: new Date(this.clock()).toISOString(),
        attemptedAt: now,
        error: null,
      };
    } catch {
      group.error = `Could not refresh ${source}. ${group.fetchedAt ? 'The last saved rates are shown with their original dates.' : 'Conversion is unavailable.'}`;
    }
  }
  private async update() {
    const previous = [this.groups.Frankfurter.fetchedAt, this.groups.CoinGecko.fetchedAt].join('|');
    await Promise.all([this.refresh('Frankfurter'), this.refresh('CoinGecko')]);
    if (previous === [this.groups.Frankfurter.fetchedAt, this.groups.CoinGecko.fetchedAt].join('|'))
      return;
    try {
      await mkdir(dirname(this.cacheFile), { recursive: true });
      await writeFile(
        this.cacheFile + '.tmp',
        JSON.stringify({ version: 1, groups: this.groups }),
        'utf8',
      );
      await rename(this.cacheFile + '.tmp', this.cacheFile);
    } catch {
      /* Quotes still work in memory if the optional cache cannot be saved. */
    }
  }
  async get(): Promise<ExchangeSnapshot> {
    await (this.initialized ||= this.load());
    if (!this.pending)
      this.pending = this.update().finally(() => {
        this.pending = null;
      });
    await this.pending;
    const providers = (['Frankfurter', 'CoinGecko'] as const).map((source) => {
      const g = this.groups[source];
      return {
        source,
        fetchedAt: g.fetchedAt,
        error: g.error,
        status: (!g.fetchedAt
          ? 'unavailable'
          : g.error || this.clock() - Date.parse(g.fetchedAt) >= ttl[source]
            ? 'cached'
            : 'current') as 'unavailable' | 'cached' | 'current',
      };
    });
    return {
      base: 'USD',
      fetchedAt: new Date(this.clock()).toISOString(),
      rates: { ...this.groups.Frankfurter.rates, ...this.groups.CoinGecko.rates },
      providers,
    };
  }
}
export function exchangeRoutes(service: ExchangeRates) {
  const router = Router();
  router.get('/exchange-rates', async (_req, res) => res.json(await service.get()));
  return router;
}
