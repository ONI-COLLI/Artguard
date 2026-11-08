import { randomUUID } from 'node:crypto';
import { parseEventLogs, type TransactionReceipt, type Hex } from 'viem';
import { escrowAbi, escrowStates, type EscrowOrder, type EscrowState } from '../shared/escrow.js';
import { licenseNumber } from '../shared/marketplace.js';
import {
  allocationsFor,
  serializeCheckout,
  paymentFor,
  type CheckoutItemRow,
  type CheckoutRow,
} from './chain-checkouts.js';
import type { Repository, PurchaseRow } from './repository.js';
import type { LocalBlockchain } from './blockchain.js';
import { HttpError } from './errors.js';
import { recordPurchase } from './accounting-records.js';
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export interface EscrowRow extends CheckoutItemRow {
  buyer_id: string;
  buyer_wallet: Hex;
  contract_address: Hex;
  instance_id: Hex;
  state: EscrowState;
  delivery_deadline: number;
  review_deadline: number;
  dispute_deadline: number;
  funding_tx: Hex;
  funding_block: string;
  release_tx: Hex | null;
  refund_tx: Hex | null;
  settled_at: string | null;
}
export function escrowRow(repo: Repository, id: string) {
  const row = repo.one<EscrowRow>(
    'SELECT i.*,p.duration_seconds,c.buyer_id,c.buyer_wallet,c.contract_address,c.instance_id,e.* FROM escrow_records e JOIN chain_checkout_items i ON i.quote_id=e.quote_id JOIN chain_checkouts c ON c.id=i.checkout_id LEFT JOIN chain_license_periods p ON p.quote_id=i.quote_id WHERE e.quote_id=?',
    id,
  );
  if (!row) throw new HttpError(404, 'Escrow order not found.');
  return row;
}
export async function confirmEscrowFunding(
  repo: Repository,
  chain: LocalBlockchain,
  row: CheckoutRow,
  receipt: TransactionReceipt,
  items: CheckoutItemRow[],
) {
  const logs = receipt.logs.filter((l) => same(l.address, row.contract_address));
  const events = parseEventLogs({ abi: escrowAbi, eventName: 'EscrowFunded', logs });
  const block = await chain.client.getBlock({ blockHash: receipt.blockHash });
  if (
    receipt.status !== 'success' ||
    !receipt.to ||
    !same(receipt.to, row.contract_address) ||
    !same(receipt.from, row.buyer_wallet) ||
    events.length !== items.length ||
    !items.every((i) =>
      events.some(
        ({ args: e }) =>
          e.quoteId === i.quote_id &&
          same(e.buyer, row.buyer_wallet) &&
          same(e.seller, i.seller_wallet) &&
          e.fileHash === i.file_hash &&
          e.licenseType === licenseNumber[i.license] &&
          e.termsHash === i.terms_hash &&
          String(e.amount) === i.amount_wei &&
          String(e.fee) === i.fee_wei &&
          Number(e.durationSeconds) === (i.duration_seconds || 0) &&
          e.deliveryDeadline === block.timestamp + 72n * 3600n,
      ),
    )
  ) {
    repo.run(
      "UPDATE chain_checkouts SET status='failed',error=? WHERE id=?",
      'This transaction does not fund the quoted escrow orders.',
      row.id,
    );
    throw new HttpError(422, 'This transaction does not fund the quoted escrow orders.');
  }
  repo.db.exec('BEGIN IMMEDIATE');
  try {
    for (const { args: e } of events)
      repo.run(
        "INSERT OR IGNORE INTO escrow_records(quote_id,state,delivery_deadline,funding_tx,funding_block,updated_at) VALUES(?,'funded',?,?,?,?)",
        e.quoteId,
        Number(e.deliveryDeadline),
        receipt.transactionHash,
        String(receipt.blockNumber),
        new Date().toISOString(),
      );
    repo.run(
      "UPDATE chain_checkouts SET status='confirmed',block_number=?,confirmed_at=?,error=NULL WHERE id=?",
      String(receipt.blockNumber),
      new Date(Number(block.timestamp) * 1000).toISOString(),
      row.id,
    );
    repo.db.exec('COMMIT');
  } catch (error) {
    repo.db.exec('ROLLBACK');
    throw error;
  }
  return serializeCheckout(
    repo,
    repo.one<CheckoutRow>('SELECT * FROM chain_checkouts WHERE id=?', row.id)!,
  );
}
export async function syncEscrow(repo: Repository, chain: LocalBlockchain, row: EscrowRow) {
  const market = await chain.requireMarketplace(row.contract_address);
  if (market.version !== 4 || market.instanceId !== row.instance_id)
    throw new HttpError(503, 'Restore the original escrow contract and local chain.');
  const block = await chain.client.getBlock({ blockTag: 'latest' });
  const e = await chain.client.readContract({
    address: row.contract_address,
    abi: escrowAbi,
    functionName: 'getEscrow',
    args: [row.quote_id],
    blockNumber: block.number,
  });
  if (
    !same(e.buyer, row.buyer_wallet) ||
    !same(e.seller, row.seller_wallet) ||
    e.fileHash !== row.file_hash ||
    e.licenseType !== licenseNumber[row.license] ||
    String(e.amount) !== row.amount_wei ||
    String(e.fee) !== row.fee_wei
  )
    throw new HttpError(502, 'On-chain escrow data does not match this order.');
  const state = escrowStates[e.state];
  if (!state || state === 'none')
    throw new HttpError(502, 'Escrow is not present on the current node.');
  let receipt: TransactionReceipt | undefined;
  if ((state === 'released' || state === 'refunded') && row.state !== state) {
    const events =
      state === 'released'
        ? await chain.client.getContractEvents({
            address: row.contract_address,
            abi: escrowAbi,
            eventName: 'EscrowReleased',
            args: { quoteId: row.quote_id },
            fromBlock: BigInt(row.funding_block),
            toBlock: block.number,
          })
        : await chain.client.getContractEvents({
            address: row.contract_address,
            abi: escrowAbi,
            eventName: 'EscrowRefunded',
            args: { quoteId: row.quote_id },
            fromBlock: BigInt(row.funding_block),
            toBlock: block.number,
          });
    if (events.length !== 1 || !events[0].transactionHash)
      throw new HttpError(502, 'Settlement event is unavailable.');
    receipt = await chain.client.getTransactionReceipt({ hash: events[0].transactionHash });
    if (receipt.status !== 'success' || !receipt.to || !same(receipt.to, row.contract_address))
      throw new HttpError(502, 'Settlement receipt could not be verified.');
  }
  if (state === 'released' && receipt) finalizeRelease(repo, row, receipt);
  else if (state === 'refunded' && receipt) {
    const events = parseEventLogs({
      abi: escrowAbi,
      eventName: 'EscrowRefunded',
      logs: receipt.logs.filter((l) => same(l.address, row.contract_address)),
    });
    if (
      !events.some(
        ({ args: a }) =>
          a.quoteId === row.quote_id &&
          same(a.buyer, row.buyer_wallet) &&
          String(a.amount) === row.amount_wei,
      )
    )
      throw new HttpError(502, 'Refund event does not match the full deposit.');
    repo.run(
      "UPDATE escrow_records SET state='refunded',refund_tx=?,updated_at=? WHERE quote_id=?",
      receipt.transactionHash,
      new Date().toISOString(),
      row.quote_id,
    );
  }
  // A stale read must not roll back a settlement committed by another request.
  repo.run(
    "UPDATE escrow_records SET state=?,review_deadline=?,dispute_deadline=?,updated_at=? WHERE quote_id=? AND state NOT IN ('released','refunded')",
    state,
    Number(e.reviewDeadline),
    Number(e.disputeDeadline),
    new Date().toISOString(),
    row.quote_id,
  );
  return { row: escrowRow(repo, row.quote_id), chainTime: Number(block.timestamp) };
}
function finalizeRelease(repo: Repository, row: EscrowRow, receipt: TransactionReceipt) {
  const logs = receipt.logs.filter((l) => same(l.address, row.contract_address));
  const sale = parseEventLogs({ abi: escrowAbi, eventName: 'LicensePurchased', logs }).find(
    (x) => x.args.quoteId === row.quote_id,
  )?.args;
  const period = parseEventLogs({ abi: escrowAbi, eventName: 'LicenseValidity', logs }).find(
    (x) => x.args.quoteId === row.quote_id,
  )?.args;
  const payouts = parseEventLogs({ abi: escrowAbi, eventName: 'RevenueAllocated', logs }).filter(
    (x) => x.args.quoteId === row.quote_id,
  );
  const allocations = allocationsFor(repo, row);
  if (
    !sale ||
    !period ||
    !same(sale.buyer, row.buyer_wallet) ||
    !same(sale.seller, row.seller_wallet) ||
    sale.fileHash !== row.file_hash ||
    sale.termsHash !== row.terms_hash ||
    sale.licenseType !== licenseNumber[row.license] ||
    String(sale.amount) !== row.amount_wei ||
    String(sale.fee) !== row.fee_wei ||
    period.validFrom !== sale.purchasedAt ||
    period.validUntil !==
      (row.duration_seconds
        ? period.validFrom + BigInt(row.duration_seconds)
        : 18446744073709551615n) ||
    payouts.length !== allocations.length ||
    !allocations.every((a) =>
      payouts.some(
        ({ args: p }) =>
          same(p.recipient, a.wallet) &&
          String(p.amount) === a.amountWei &&
          p.shareBps === a.percent * 100,
      ),
    )
  )
    throw new HttpError(502, 'Release events do not match the license, period and revenue split.');
  const date = new Date(Number(sale.purchasedAt) * 1000).toISOString();
  repo.db.exec('BEGIN IMMEDIATE');
  try {
    if (escrowRow(repo, row.quote_id).state === 'released') {
      repo.db.exec('COMMIT');
      return;
    }
    const existing = repo.one<PurchaseRow>(
      'SELECT * FROM purchases WHERE buyer_id=? AND artwork_id=? AND license=?',
      row.buyer_id,
      row.artwork_id,
      row.license,
    );
    const purchaseId = existing?.id || randomUUID(),
      latest = !existing || Date.parse(date) >= Date.parse(existing.created_at);
    if (existing && !paymentFor(repo, existing.id))
      repo.run(
        'UPDATE chain_checkout_items SET previous_local_record=? WHERE quote_id=?',
        JSON.stringify(existing),
        row.quote_id,
      );
    const referenceAllocations = allocations.map((a) => ({
      ...a,
      amount: ((row.amount - row.commission) * a.percent) / 10000,
    }));
    if (!existing)
      repo.run(
        'INSERT INTO purchases VALUES(?,?,?,?,?,?,?,?,?)',
        purchaseId,
        row.buyer_id,
        row.artwork_id,
        row.license,
        row.amount,
        row.commission,
        JSON.stringify(referenceAllocations),
        null,
        date,
      );
    else if (latest)
      repo.run(
        'UPDATE purchases SET amount=?,commission=?,allocations=?,created_at=? WHERE id=?',
        row.amount,
        row.commission,
        JSON.stringify(referenceAllocations),
        date,
        purchaseId,
      );
    repo.run('INSERT OR IGNORE INTO chain_purchase_links VALUES(?,?)', row.quote_id, purchaseId);
    const until = period.validUntil === 18446744073709551615n ? null : Number(period.validUntil);
    repo.run(
      'UPDATE chain_license_periods SET valid_from=?,valid_until=? WHERE quote_id=?',
      Number(period.validFrom),
      until,
      row.quote_id,
    );
    if (latest)
      repo.run(
        'INSERT INTO license_validity VALUES(?,?,?) ON CONFLICT(purchase_id) DO UPDATE SET valid_from=excluded.valid_from,valid_until=excluded.valid_until',
        purchaseId,
        Number(period.validFrom),
        until,
      );
    repo.run(
      "UPDATE escrow_records SET state='released',release_tx=?,settled_at=?,updated_at=? WHERE quote_id=?",
      receipt.transactionHash,
      date,
      new Date().toISOString(),
      row.quote_id,
    );
    recordPurchase(repo, purchaseId, row.quote_id);
    repo.db.exec('COMMIT');
  } catch (error) {
    repo.db.exec('ROLLBACK');
    throw error;
  }
}
export async function serializeEscrow(
  repo: Repository,
  chain: LocalBlockchain,
  row: EscrowRow,
  userId: string,
  chainTime: number,
): Promise<EscrowOrder> {
  const refund = await chain.client.readContract({
    address: row.contract_address,
    abi: escrowAbi,
    functionName: 'refundBalances',
    args: [row.buyer_wallet],
  });
  return {
    id: row.quote_id,
    checkoutId: row.checkout_id,
    title: row.title,
    artworkId: row.artwork_id,
    contractAddress: row.contract_address,
    state: row.state,
    buyer: row.buyer_wallet,
    seller: row.seller_wallet,
    amountWei: row.amount_wei,
    deliveryDeadline: row.delivery_deadline,
    reviewDeadline: row.review_deadline,
    disputeDeadline: row.dispute_deadline,
    fundingHash: row.funding_tx,
    releaseHash: row.release_tx,
    refundHash: row.refund_tx,
    refundBalanceWei: String(refund),
    buyerAccount: row.buyer_id === userId,
    sellerAccount: row.seller_id === userId,
    manager: repo.isManager(userId),
    checkedAt: chainTime,
  };
}
