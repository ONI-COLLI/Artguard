import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExchangeRates, parseRateJson, parseCryptoRates, parseFiatRates } from '../server/exchange';
import { createApp } from '../server/app';
const start = Date.parse('2026-10-21T17:00:00Z');
const fiat = [
  { base: 'USD', quote: 'KZT', rate: '450.38', date: '2026-10-21' },
  { base: 'USD', quote: 'EUR', rate: '0.89', date: '2026-10-21' },
  { base: 'USD', quote: 'JPY', rate: '150', date: '2026-10-21' },
];
const crypto = (now: number, price = '2500') => ({
  bitcoin: { usd: '100000', last_updated_at: String(now / 1000) },
  ethereum: { usd: price, last_updated_at: String(now / 1000) },
});
test('provider JSON decimal tokens are preserved exactly before any arithmetic', () => {
  const raw = parseRateJson(
    '{"bitcoin":{"usd":100000,"last_updated_at":1792602000},"ethereum":{"usd":2500.1234567890123456789,"last_updated_at":1792602000}}',
  );
  assert.equal((raw as any).ethereum.usd, '2500.1234567890123456789');
  const rates = parseCryptoRates(raw, start);
  assert.equal(rates.ETH.denominator, '25001234567890123456789');
  assert.equal(rates.ETH.numerator, '10000000000000000000');
  assert.equal(rates.ETH.observedAt, '2026-10-21T17:00:00.000Z');
});
test('validates provider responses, keeps dated fiat metadata and rejects missing or invalid prices', () => {
  const rates = parseFiatRates(fiat, [{ iso_code: 'KZT', name: 'Kazakhstani Tenge' }]);
  assert.equal(rates.KZT.observedAt, '2026-10-21');
  assert.equal(rates.KZT.numerator, '45038');
  assert.equal(rates.JPY.decimals, 0);
  assert.throws(() => parseFiatRates([], []));
  assert.throws(() => parseCryptoRates({}, start));
  assert.throws(() =>
    parseCryptoRates({ ethereum: { usd: '0', last_updated_at: String(start / 1000) } }, start),
  );
});
test('coalesces requests, refreshes crypto separately, preserves dated cache on failure and reloads it after restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'artguard-exchange-'));
  try {
    let now = start,
      offline = false,
      price = '2500';
    const calls: string[] = [],
      file = join(dir, 'rates.json');
    const fetcher = (async (url: string) => {
      calls.push(String(url));
      if (offline) throw new Error('offline');
      return new Response(
        JSON.stringify(
          url.includes('coingecko') ? crypto(now, price) : url.endsWith('/currencies') ? [] : fiat,
        ),
      );
    }) as typeof fetch;
    const service = new ExchangeRates(file, fetcher, () => now);
    const snapshots = await Promise.all(Array.from({ length: 8 }, () => service.get()));
    assert.equal(calls.length, 3);
    assert.equal(snapshots[0].rates.ETH.denominator, '2500');
    now += 30000;
    await service.get();
    assert.equal(calls.length, 3);
    now += 31000;
    price = '2600';
    const refreshed = await service.get();
    assert.equal(calls.length, 4);
    assert.equal(refreshed.rates.ETH.denominator, '2600');
    const originalDate = refreshed.rates.ETH.observedAt;
    now += 61000;
    offline = true;
    const stale = await service.get();
    assert.equal(stale.rates.ETH.observedAt, originalDate);
    assert.equal(stale.providers.find((p) => p.source === 'CoinGecko')?.status, 'cached');
    assert.equal(stale.providers.find((p) => p.source === 'Frankfurter')?.status, 'current');
    assert.match(stale.providers.find((p) => p.source === 'CoinGecko')!.error!, /last saved rates/);
    const before = calls.length;
    await service.get();
    assert.equal(calls.length, before);
    assert.equal(JSON.parse(await readFile(file, 'utf8')).version, 1);
    const restarted = await new ExchangeRates(file, fetcher, () => now).get();
    assert.equal(restarted.rates.ETH.observedAt, originalDate);
    assert.equal(restarted.rates.KZT.numerator, '45038');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('does not invent fallback rates when the cache and external sources are unavailable', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'artguard-exchange-'));
  try {
    const file = join(dir, 'rates.json');
    await writeFile(file, 'not json');
    const snapshot = await new ExchangeRates(
      file,
      (async () => {
        throw new Error('offline');
      }) as typeof fetch,
      () => start,
    ).get();
    assert.deepEqual(snapshot.rates, {});
    assert.ok(snapshot.providers.every((p) => p.status === 'unavailable' && p.fetchedAt === null));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('serves public rate metadata without forwarding account data or user-selected URLs to providers', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'artguard-exchange-api-'));
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  try {
    const calls: string[] = [];
    const exchange = new ExchangeRates(
      join(dir, 'cache.json'),
      (async (url: string, init: RequestInit) => {
        calls.push(String(url));
        assert.deepEqual(init.headers, { Accept: 'application/json' });
        return new Response(
          JSON.stringify(
            url.includes('coingecko') ? crypto(start) : url.endsWith('/currencies') ? [] : fiat,
          ),
        );
      }) as typeof fetch,
      () => start,
    );
    app = await createApp({ dataDir: dir, serveClient: false, exchange });
    await new Promise<void>((resolve) => app!.server.listen(0, '127.0.0.1', resolve));
    const address = app.server.address() as { port: number };
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/exchange-rates?url=http://malicious.invalid`,
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.rates.KZT.numerator, '45038');
    assert.equal(body.rates.ETH.source, 'CoinGecko');
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(calls.length, 3);
    assert.ok(
      calls.every(
        (u) =>
          u.startsWith('https://api.frankfurter.dev/') ||
          u.startsWith('https://api.coingecko.com/'),
      ),
    );
  } finally {
    await app?.close();
    await rm(dir, { recursive: true, force: true });
  }
});
