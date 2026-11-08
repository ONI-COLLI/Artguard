import { randomUUID } from 'node:crypto';
import type { Address } from 'viem';
import { marketplaceAbi } from '../shared/marketplace.js';
import { subscriptionAbi } from '../shared/platform.js';
import { promotionAbi } from '../shared/promotions.js';
import type { BalanceSnapshot, WalletBalance } from '../shared/accounting.js';
import type { Repository } from './repository.js';
import type { LocalBlockchain } from './blockchain.js';
import { HttpError } from './errors.js';
export async function syncAccountingBalances(
  repo: Repository,
  chain: LocalBlockchain,
): Promise<BalanceSnapshot> {
  const registry = await chain.requireReady(),
    market = await chain.marketplaceStatus();
  if (!market.ready || !market.deployment) throw new HttpError(503, market.message);
  const subscription = await chain.subscriptionDeployment();
  let promotion = null;
  try {
    promotion = await chain.promotionDeployment();
  } catch (error) {
    // Older installations can still synchronize before promotion payments are deployed.
    if (repo.one('SELECT 1 FROM promotion_orders LIMIT 1')) throw error;
  }
  const contracts = [
    ...(market.contracts || [market.deployment]).map((c) => ({
      address: c.address,
      treasury: c.treasury,
      kind: 'marketplace' as const,
    })),
    {
      address: subscription.address,
      treasury: subscription.treasury,
      kind: 'subscription' as const,
    },
    ...(promotion
      ? [{ address: promotion.address, treasury: promotion.treasury, kind: 'promotion' as const }]
      : []),
  ];
  for (const c of contracts.filter((c) => c.kind === 'marketplace'))
    await chain.requireMarketplace(c.address);
  const addresses = new Map<string, Address>(),
    add = (value: string | null) => {
      if (value && /^0x[\da-fA-F]{40}$/.test(value))
        addresses.set(value.toLowerCase(), value as Address);
    };
  for (const r of repo.all<{ address: string }>(
    'SELECT address FROM wallet_history UNION SELECT address FROM wallets',
  ))
    add(r.address);
  for (const e of repo.all<{
    buyer_wallet: string | null;
    seller_wallet: string | null;
    allocations_json: string;
  }>(
    'SELECT buyer_wallet,seller_wallet,allocations_json FROM accounting_events UNION ALL SELECT buyer_wallet,seller_wallet,allocations_json FROM promotion_accounting_events',
  )) {
    add(e.buyer_wallet);
    add(e.seller_wallet);
    for (const a of JSON.parse(e.allocations_json)) add(a.wallet);
  }
  for (const c of contracts) add(c.treasury);
  const block = await chain.client.getBlock(),
    wallets: WalletBalance[] = [],
    list = [...addresses.values()];
  for (let i = 0; i < list.length; i += 8) {
    const batch = await Promise.all(
      list.slice(i, i + 8).map(async (address) => {
        const [native, credits] = await Promise.all([
          chain.client.getBalance({ address, blockNumber: block.number }),
          Promise.all(
            contracts.map(async (c) => ({
              address: c.address,
              kind: c.kind,
              creditWei: String(
                await chain.client.readContract({
                  address: c.address,
                  abi:
                    c.kind === 'marketplace'
                      ? marketplaceAbi
                      : c.kind === 'promotion'
                        ? promotionAbi
                        : subscriptionAbi,
                  functionName: 'balances',
                  args: [address],
                  blockNumber: block.number,
                }),
              ),
            })),
          ),
        ]);
        const sum = (kind: 'marketplace' | 'subscription' | 'promotion') =>
          String(
            credits.filter((c) => c.kind === kind).reduce((s, c) => s + BigInt(c.creditWei), 0n),
          );
        return {
          address,
          nativeWei: String(native),
          marketplaceWei: sum('marketplace'),
          subscriptionWei: sum('subscription'),
          promotionWei: sum('promotion'),
          contracts: credits,
        };
      }),
    );
    wallets.push(...batch);
  }
  // A reset/reorg during collection must not save a mixed-network snapshot.
  const end = await chain.client.getBlock({ blockNumber: block.number });
  if (end.hash !== block.hash || (await chain.requireReady()).instanceId !== registry.instanceId)
    throw new HttpError(
      409,
      'The local chain changed during synchronization. Retry the balance sync.',
    );
  const treasuries = [...new Set(contracts.map((c) => c.treasury.toLowerCase()))];
  const nativeWei = String(
    wallets
      .filter((w) => treasuries.includes(w.address.toLowerCase()))
      .reduce((s, w) => s + BigInt(w.nativeWei), 0n),
  );
  const credit = (kind: 'marketplace' | 'subscription' | 'promotion') =>
    contracts
      .filter((c) => c.kind === kind)
      .reduce(
        (s, c) =>
          s +
          BigInt(
            wallets
              .find((w) => w.address.toLowerCase() === c.treasury.toLowerCase())!
              .contracts.find((b) => b.address.toLowerCase() === c.address.toLowerCase())!
              .creditWei,
          ),
        0n,
      );
  const snapshot: BalanceSnapshot = {
    id: randomUUID(),
    instanceId: registry.instanceId,
    blockNumber: String(block.number),
    blockHash: block.hash!,
    observedAt: new Date().toISOString(),
    wallets,
    platform: {
      treasuries,
      nativeWei,
      marketplaceWei: String(credit('marketplace')),
      subscriptionWei: String(credit('subscription')),
      promotionWei: String(credit('promotion')),
      availableWei: String(credit('marketplace') + credit('subscription') + credit('promotion')),
    },
  };
  repo.run(
    'INSERT INTO accounting_balance_snapshots VALUES(?,?,?,?,?,?)',
    snapshot.id,
    snapshot.instanceId,
    snapshot.blockNumber,
    snapshot.blockHash,
    snapshot.observedAt,
    JSON.stringify({ wallets: snapshot.wallets, platform: snapshot.platform }),
  );
  return snapshot;
}
