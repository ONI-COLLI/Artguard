import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import {
  parseEventLogs,
  parseEther,
  TransactionReceiptNotFoundError,
  type Address,
  type Hex,
} from 'viem';
import {
  promotionPeriod,
  promotionPriceWei,
  type PromotionOrder,
  type PromotionQuote,
  promotionAbi,
} from '../shared/promotions.js';
import type { Repository } from './repository.js';
import type { LocalBlockchain } from './blockchain.js';
import { requireUser } from './auth.js';
import { requireVerified } from './security.js';
import { HttpError } from './errors.js';
import { shareStatus } from './consents.js';
import { recordPromotion } from './accounting-records.js';

export interface PromotionRow {
  id: Hex;
  user_id: string;
  artwork_id: string;
  title: string;
  buyer_wallet: Address;
  project_hash: Hex;
  contract_address: Address;
  instance_id: Hex;
  amount_wei: string;
  expires_at: number;
  expected_until: number;
  signature: Hex;
  status: PromotionOrder['status'];
  tx_hash: Hex | null;
  starts_at: number | null;
  valid_until: number | null;
  error: string | null;
}
export const promotionQuote = (r: PromotionRow): PromotionQuote => ({
  id: r.id,
  projectId: r.project_hash,
  buyer: r.buyer_wallet,
  amount: r.amount_wei,
  expiresAt: r.expires_at,
  expectedUntil: r.expected_until,
  instanceId: r.instance_id,
});
export const promotionDto = (r: PromotionRow): PromotionOrder => ({
  id: r.id,
  artworkId: r.artwork_id,
  title: r.title,
  contractAddress: r.contract_address,
  quote: promotionQuote(r),
  signature: r.signature,
  status: r.status,
  transactionHash: r.tx_hash,
  startsAt: r.starts_at,
  validUntil: r.valid_until,
  error: r.error,
});
export function promotionRoutes(repo: Repository, chain: LocalBlockchain) {
  const r = Router(),
    limit = rateLimit({
      windowMs: 60000,
      limit: 60,
      legacyHeaders: false,
      message: { error: 'Too many promotion requests. Try again shortly.' },
    });
  const get = (id: string, userId: string) => {
    const row = repo.one<PromotionRow>(
      'SELECT * FROM promotion_orders WHERE id=? AND user_id=?',
      id,
      userId,
    );
    if (!row) throw new HttpError(404, 'Promotion order not found.');
    return row;
  };
  const project = (id: string, userId: string) => {
    const a = repo.artwork(id);
    if (!a || a.owner_id !== userId) throw new HttpError(404, 'Your project was not found.');
    return a;
  };
  r.get('/promotions/featured', async (_req, res) => {
    let deployment;
    try {
      deployment = await chain.promotionDeployment();
    } catch {
      return res.json({ featured: [] });
    }
    const time = Math.floor(Date.now() / 1000);
    const featured = repo
      .all<{ artwork_id: string; starts_at: number; valid_until: number }>(
        'SELECT * FROM promotions WHERE instance_id=? AND contract_address=? COLLATE NOCASE AND starts_at<=? AND valid_until>? ORDER BY starts_at DESC,artwork_id',
        deployment.instanceId,
        deployment.address,
        time,
        time,
      )
      .filter((p) => {
        const a = repo.artwork(p.artwork_id);
        return (
          a && a.status === 'published' && repo.canView(a, null) && shareStatus(repo, a.id).ready
        );
      })
      .map((p) => ({ artworkId: p.artwork_id, validUntil: p.valid_until }));
    res.json({ featured });
  });
  r.get('/promotions', async (req, res) => {
    const user = requireUser(req),
      { artworkId } = z.object({ artworkId: z.string().min(1).max(100) }).parse(req.query);
    project(artworkId, user.id);
    let deployment = null,
      message = '';
    try {
      deployment = await chain.promotionDeployment();
    } catch (e) {
      message = e instanceof Error ? e.message : 'Promotion payments are unavailable.';
    }
    const active = deployment
      ? repo.one<{ starts_at: number; valid_until: number }>(
          'SELECT starts_at,valid_until FROM promotions WHERE artwork_id=? AND instance_id=? AND contract_address=? COLLATE NOCASE AND valid_until>?',
          artworkId,
          deployment.instanceId,
          deployment.address,
          Math.floor(Date.now() / 1000),
        )
      : null;
    res.json({
      ready: !!deployment,
      message,
      active: active ? { startsAt: active.starts_at, validUntil: active.valid_until } : null,
      orders: repo
        .all<PromotionRow>(
          'SELECT * FROM promotion_orders WHERE user_id=? AND artwork_id=? ORDER BY created_at DESC LIMIT 50',
          user.id,
          artworkId,
        )
        .map(promotionDto),
    });
  });
  r.post('/promotions/orders', limit, async (req, res) => {
    const user = requireVerified(repo, requireUser(req)),
      { artworkId } = z.object({ artworkId: z.string().min(1).max(100) }).parse(req.body);
    const a = project(artworkId, user.id),
      wallet = repo.wallet(user.id);
    if (a.status !== 'published' || repo.hidden(a.id) || !shareStatus(repo, a.id).ready)
      throw new HttpError(409, 'Publish an approved, visible project before promoting it.');
    if (!wallet) throw new HttpError(400, 'Link your wallet before paying for promotion.');
    const deployment = await chain.promotionDeployment(),
      time = Math.floor(Date.now() / 1000);
    const existing = repo.one<PromotionRow>(
      "SELECT * FROM promotion_orders WHERE user_id=? AND artwork_id=? AND instance_id=? AND contract_address=? COLLATE NOCASE AND (status='pending' OR (status='prepared' AND expires_at>=?)) ORDER BY created_at DESC LIMIT 1",
      user.id,
      a.id,
      deployment.instanceId,
      deployment.address,
      time,
    );
    if (existing) {
      if (existing.buyer_wallet.toLowerCase() !== wallet.address.toLowerCase())
        throw new HttpError(409, 'Recover the existing promotion payment before changing wallets.');
      return res.json({ order: promotionDto(existing) });
    }
    const projectHash = ('0x' + createHash('sha256').update(a.id).digest('hex')) as Hex;
    const until = await chain.client.readContract({
      address: deployment.address,
      abi: promotionAbi,
      functionName: 'promotedUntil',
      args: [projectHash],
    });
    const recorded = repo.one<{ valid_until: number }>(
      'SELECT valid_until FROM promotions WHERE artwork_id=? AND instance_id=? AND contract_address=? COLLATE NOCASE',
      a.id,
      deployment.instanceId,
      deployment.address,
    );
    if (Number(until) > (recorded?.valid_until || 0))
      throw new HttpError(
        409,
        'A promotion payment exists on chain. Recover its order before paying again.',
      );
    const q: PromotionQuote = {
      id: `0x${randomBytes(32).toString('hex')}`,
      projectId: projectHash,
      buyer: wallet.address,
      amount: promotionPriceWei,
      expiresAt: time + 600,
      expectedUntil: Number(until),
      instanceId: deployment.instanceId,
    };
    const signature = await chain.signPromotion(deployment, q);
    repo.run(
      "INSERT INTO promotion_orders(id,user_id,artwork_id,title,buyer_wallet,project_hash,contract_address,instance_id,amount_wei,expires_at,expected_until,signature,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'prepared',?)",
      q.id,
      user.id,
      a.id,
      a.title,
      wallet.address,
      projectHash,
      deployment.address,
      deployment.instanceId,
      q.amount,
      q.expiresAt,
      q.expectedUntil,
      signature,
      new Date().toISOString(),
    );
    res.status(201).json({ order: promotionDto(get(q.id, user.id)) });
  });
  const deploymentFor = async (row: PromotionRow) => {
    const current = await chain.promotionDeployment();
    if (
      current.instanceId !== row.instance_id ||
      current.address.toLowerCase() !== row.contract_address.toLowerCase()
    )
      throw new HttpError(
        409,
        'Restore the original local promotion contract to recover or verify this payment.',
      );
    return current;
  };
  r.post('/promotions/orders/:id/fund', limit, async (req, res) => {
    const user = requireUser(req),
      row = get(String(req.params.id), user.id);
    await deploymentFor(row);
    if (
      row.status !== 'prepared' ||
      row.expires_at < Date.now() / 1000 ||
      repo.wallet(user.id)?.address.toLowerCase() !== row.buyer_wallet.toLowerCase()
    )
      throw new HttpError(409, 'Prepare a current promotion order with your linked wallet first.');
    res.json({
      transactionHash: await chain.fund(
        row.buyer_wallet,
        BigInt(row.amount_wei) + parseEther('0.01'),
      ),
    });
  });
  r.post('/promotions/orders/:id/recover', limit, async (req, res) => {
    const row = get(String(req.params.id), requireUser(req).id);
    await deploymentFor(row);
    if (row.tx_hash) return res.json({ transactionHash: row.tx_hash });
    const events = await chain.client.getContractEvents({
      address: row.contract_address,
      abi: promotionAbi,
      eventName: 'PromotionPurchased',
      args: { quoteId: row.id },
      fromBlock: 0n,
      toBlock: 'latest',
    });
    res.json({ transactionHash: events[0]?.transactionHash || null });
  });
  r.post('/promotions/orders/:id/confirm', limit, async (req, res) => {
    const user = requireUser(req),
      row = get(String(req.params.id), user.id);
    const { transactionHash } = z
      .object({
        transactionHash: z
          .string()
          .regex(/^0x[\da-fA-F]{64}$/)
          .transform((v) => v.toLowerCase() as Hex),
      })
      .parse(req.body);
    if (row.tx_hash && row.tx_hash.toLowerCase() !== transactionHash)
      throw new HttpError(409, 'This order already has a different transaction.');
    if (row.status === 'confirmed') return res.json({ order: promotionDto(row) });
    if (row.status === 'failed')
      throw new HttpError(422, row.error || 'This payment failed. Prepare a new order.');
    if (
      repo.one(
        'SELECT 1 FROM promotion_orders WHERE lower(tx_hash)=? AND id<>?',
        transactionHash,
        row.id,
      )
    )
      throw new HttpError(409, 'This transaction is already assigned to another promotion order.');
    await deploymentFor(row);
    const saved = repo.run(
      "UPDATE promotion_orders SET status='pending',tx_hash=? WHERE id=? AND status IN ('prepared','pending') AND (tx_hash IS NULL OR lower(tx_hash)=?)",
      transactionHash,
      row.id,
      transactionHash,
    );
    if (!saved.changes) {
      const latest = get(row.id, user.id);
      if (latest.status === 'confirmed' && latest.tx_hash?.toLowerCase() === transactionHash)
        return res.json({ order: promotionDto(latest) });
      throw new HttpError(409, 'The order changed. Refresh before retrying.');
    }
    let receipt;
    try {
      receipt = await chain.client.getTransactionReceipt({ hash: transactionHash });
    } catch (e) {
      if (e instanceof TransactionReceiptNotFoundError)
        return res.status(202).json({ order: promotionDto(get(row.id, user.id)) });
      throw new HttpError(
        503,
        'Payment verification is unavailable. Your transaction is saved; retry verification before paying again.',
      );
    }
    const events = parseEventLogs({
      abi: promotionAbi,
      eventName: 'PromotionPurchased',
      logs: receipt.logs.filter(
        (l) => l.address.toLowerCase() === row.contract_address.toLowerCase(),
      ),
    });
    const block = await chain.client.getBlock({ blockNumber: receipt.blockNumber }),
      event = events[0]?.args;
    const expectedStart = BigInt(Math.max(Number(block.timestamp), row.expected_until));
    const valid =
      receipt.status === 'success' &&
      receipt.from.toLowerCase() === row.buyer_wallet.toLowerCase() &&
      receipt.to?.toLowerCase() === row.contract_address.toLowerCase() &&
      events.length === 1 &&
      event?.quoteId === row.id &&
      event.projectId === row.project_hash &&
      event.buyer.toLowerCase() === row.buyer_wallet.toLowerCase() &&
      String(event.amount) === row.amount_wei &&
      event.startsAt === expectedStart &&
      event.validUntil === expectedStart + BigInt(promotionPeriod);
    if (!valid) {
      const error =
        receipt.status === 'reverted'
          ? 'Promotion payment reverted. No promotion was activated.'
          : 'This transaction does not match the promotion order.';
      repo.run("UPDATE promotion_orders SET status='failed',error=? WHERE id=?", error, row.id);
      throw new HttpError(422, error);
    }
    repo.db.exec('BEGIN IMMEDIATE');
    try {
      if (get(row.id, user.id).status !== 'confirmed') {
        repo.run(
          "UPDATE promotion_orders SET status='confirmed',starts_at=?,valid_until=?,error=NULL WHERE id=?",
          Number(event.startsAt),
          Number(event.validUntil),
          row.id,
        );
        repo.run(
          `INSERT INTO promotions VALUES(?,?,?,?,?,?) ON CONFLICT(artwork_id) DO UPDATE SET
          order_id=excluded.order_id,instance_id=excluded.instance_id,contract_address=excluded.contract_address,
          starts_at=CASE WHEN promotions.instance_id=excluded.instance_id AND promotions.contract_address=excluded.contract_address COLLATE NOCASE AND promotions.valid_until>=excluded.starts_at THEN MIN(promotions.starts_at,excluded.starts_at) ELSE excluded.starts_at END,
          valid_until=excluded.valid_until WHERE promotions.instance_id<>excluded.instance_id OR promotions.contract_address<>excluded.contract_address COLLATE NOCASE OR excluded.valid_until>promotions.valid_until`,
          row.artwork_id,
          row.id,
          row.instance_id,
          row.contract_address,
          Number(event.startsAt),
          Number(event.validUntil),
        );
        recordPromotion(repo, row.id, new Date(Number(block.timestamp) * 1000).toISOString());
      }
      repo.db.exec('COMMIT');
    } catch (e) {
      repo.db.exec('ROLLBACK');
      throw e;
    }
    res.json({ order: promotionDto(get(row.id, user.id)) });
  });
  return r;
}
