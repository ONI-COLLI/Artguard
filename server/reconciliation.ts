import type { Address, Hex } from 'viem';
import { escrowAbi } from '../shared/escrow.js';
import type { Repository } from './repository.js';
import type { LocalBlockchain } from './blockchain.js';
import { HttpError } from './errors.js';
export async function reconcileEscrow(repo: Repository, chain: LocalBlockchain) {
  const deployment = await chain.requireReady(),
    market = await chain.marketplaceStatus(),
    block = await chain.client.getBlock();
  const addresses = new Set<string>();
  for (const row of repo.all<{ address: string }>(
    'SELECT address FROM wallets UNION SELECT address FROM wallet_history UNION SELECT buyer_wallet AS address FROM chain_checkouts UNION SELECT seller_wallet AS address FROM chain_checkout_items',
  ))
    if (row.address) addresses.add(row.address.toLowerCase());
  for (const row of repo.all<{ allocations_json: string }>(
    'SELECT allocations_json FROM chain_revenue_splits',
  ))
    for (const allocation of JSON.parse(row.allocations_json))
      if (allocation.wallet) addresses.add(allocation.wallet.toLowerCase());
  const results = [];
  for (const manifest of (market.contracts || []).filter((c) => c.version === 4)) {
    addresses.add(manifest.treasury.toLowerCase());
    let credits = 0n,
      refunds = 0n,
      locked = 0n;
    for (const wallet of addresses) {
      const [credit, refund] = await Promise.all([
        chain.client.readContract({
          address: manifest.address,
          abi: escrowAbi,
          functionName: 'balances',
          args: [wallet as Address],
          blockNumber: block.number,
        }),
        chain.client.readContract({
          address: manifest.address,
          abi: escrowAbi,
          functionName: 'refundBalances',
          args: [wallet as Address],
          blockNumber: block.number,
        }),
      ]);
      credits += credit;
      refunds += refund;
    }
    const quotes = repo.all<{ quote_id: Hex }>(
      'SELECT i.quote_id FROM chain_checkout_items i JOIN chain_checkouts c ON c.id=i.checkout_id WHERE lower(c.contract_address)=? AND c.instance_id=?',
      manifest.address.toLowerCase(),
      deployment.instanceId,
    );
    for (const row of quotes) {
      const escrow = await chain.client.readContract({
        address: manifest.address,
        abi: escrowAbi,
        functionName: 'getEscrow',
        args: [row.quote_id],
        blockNumber: block.number,
      });
      if ([1, 2, 3].includes(escrow.state)) locked += escrow.amount;
    }
    const assets = await chain.client.getBalance({
        address: manifest.address,
        blockNumber: block.number,
      }),
      liabilities = credits + refunds + locked,
      difference = assets - liabilities;
    results.push({
      address: manifest.address,
      assetsWei: String(assets),
      recipientCreditsWei: String(credits),
      refundCreditsWei: String(refunds),
      lockedEscrowWei: String(locked),
      knownLiabilitiesWei: String(liabilities),
      differenceWei: String(difference),
      status: difference === 0n ? 'matched' : difference > 0n ? 'surplus' : 'deficit',
      walletsChecked: addresses.size,
      quotesChecked: quotes.length,
    });
  }
  if (
    (await chain.client.getBlock({ blockNumber: block.number })).hash !== block.hash ||
    (await chain.requireReady()).instanceId !== deployment.instanceId
  )
    throw new HttpError(409, 'The network changed during reconciliation. Retry.');
  return {
    checkedAt: new Date().toISOString(),
    blockNumber: String(block.number),
    blockHash: block.hash,
    scope:
      'Version-4 contracts; all wallets and quotes known to this application. A surplus is unattributed contract funds, not platform profit. Old chain instances are excluded.',
    contracts: results,
  };
}
