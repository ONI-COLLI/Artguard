import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { randomBytes, createHash } from 'node:crypto';
import { z } from 'zod';
import {
  parseEventLogs,
  parseEther,
  TransactionReceiptNotFoundError,
  type Address,
  type Hex,
} from 'viem';
import {
  subscriptionAbi,
  subscriptionPeriod,
  paidPlanNumber,
  type SubscriptionOrder,
  type SubscriptionQuote,
} from '../shared/platform.js';
import { planRules } from '../shared/schemas.js';
import { testWeiPerCent } from '../shared/marketplace.js';
import { requireUser } from './auth.js';
import { requireVerified } from './security.js';
import { HttpError } from './errors.js';
import type { Repository } from './repository.js';
import type { LocalBlockchain } from './blockchain.js';
import { recordSubscription } from './accounting-records.js';
export interface OrderRow {
  id: Hex;
  user_id: string;
  buyer_wallet: Address;
  account_hash: Hex;
  plan: 'premium' | 'business';
  contract_address: Address;
  instance_id: Hex;
  amount_wei: string;
  expires_at: number;
  expected_until: number;
  signature: Hex;
  status: SubscriptionOrder['status'];
  tx_hash: Hex | null;
  valid_until: number | null;
  error: string | null;
}
export const quote = (r: OrderRow): SubscriptionQuote => ({
  id: r.id,
  accountId: r.account_hash,
  buyer: r.buyer_wallet,
  plan: paidPlanNumber[r.plan],
  amount: r.amount_wei,
  expiresAt: r.expires_at,
  expectedUntil: r.expected_until,
  instanceId: r.instance_id,
});
const dto = (r: OrderRow): SubscriptionOrder => ({
  id: r.id,
  plan: r.plan,
  contractAddress: r.contract_address,
  quote: quote(r),
  signature: r.signature,
  status: r.status,
  transactionHash: r.tx_hash,
  validUntil: r.valid_until,
  error: r.error,
});
export function billingRoutes(repo: Repository, chain: LocalBlockchain) {
  const r = Router(),
    limit = rateLimit({
      windowMs: 60000,
      limit: 60,
      legacyHeaders: false,
      message: { error: 'Too many billing requests. Try again shortly.' },
    });
  const get = (id: string, userId: string) => {
    const row = repo.one<OrderRow>(
      'SELECT * FROM subscription_orders WHERE id=? AND user_id=?',
      id,
      userId,
    );
    if (!row) throw new HttpError(404, 'Subscription order not found.');
    return row;
  };
  const result = (userId: string) => ({
    subscription: repo.subscription(userId),
    orders: repo
      .all<OrderRow>(
        'SELECT * FROM subscription_orders WHERE user_id=? ORDER BY created_at DESC LIMIT 30',
        userId,
      )
      .map(dto),
  });
  r.get('/billing', (req, res) => res.json(result(requireUser(req).id)));
  r.post('/billing/cancel', limit, (req, res) => {
    const user = requireUser(req);
    repo.run(
      'UPDATE subscriptions SET cancel_at_end=1,updated_at=? WHERE user_id=?',
      new Date().toISOString(),
      user.id,
    );
    res.json(result(user.id));
  });
  r.post('/billing/resume', limit, (req, res) => {
    const user = requireUser(req);
    repo.run(
      'UPDATE subscriptions SET cancel_at_end=0,updated_at=? WHERE user_id=?',
      new Date().toISOString(),
      user.id,
    );
    res.json(result(user.id));
  });
  r.post('/billing/orders', limit, async (req, res) => {
    const user = requireVerified(repo, requireUser(req)),
      { plan } = z.object({ plan: z.enum(['premium', 'business']) }).parse(req.body),
      wallet = repo.wallet(user.id);
    if (!wallet) throw new HttpError(400, 'Link a wallet before purchasing a test subscription.');
    if (repo.subscription(user.id).cancelAtEnd && repo.subscription(user.id).plan !== 'free')
      throw new HttpError(409, 'Resume your subscription before preparing a renewal.');
    const deployment = await chain.subscriptionDeployment();
    const previous = repo.all<OrderRow>(
      "SELECT * FROM subscription_orders WHERE user_id=? AND instance_id=? AND (status='pending' OR (status='prepared' AND expires_at>=?)) ORDER BY created_at DESC",
      user.id,
      deployment.instanceId,
      Math.floor(Date.now() / 1000),
    );
    if (previous.length) {
      const row = previous[0];
      if (row.plan === plan && row.buyer_wallet.toLowerCase() === wallet.address.toLowerCase())
        return res.json({ order: dto(row) });
      throw new HttpError(
        409,
        'Finish or recover your existing subscription order before opening another.',
      );
    }
    const accountHash = ('0x' + createHash('sha256').update(user.id).digest('hex')) as Hex;
    const [onchainPlan, until] = await chain.client.readContract({
      address: deployment.address,
      abi: subscriptionAbi,
      functionName: 'subscriptions',
      args: [accountHash],
    });
    const block = await chain.client.getBlock();
    if (until > block.timestamp && onchainPlan !== paidPlanNumber[plan])
      throw new HttpError(
        409,
        'Your current prepaid plan is still active. Renew the same plan, or choose a different plan after it expires.',
      );
    if (Number(until) > (repo.subscription(user.id).validUntil || 0))
      throw new HttpError(
        409,
        'A subscription payment exists on the chain. Recover and verify its order before paying again.',
      );
    const q: SubscriptionQuote = {
      id: `0x${randomBytes(32).toString('hex')}`,
      accountId: accountHash,
      buyer: wallet.address,
      plan: paidPlanNumber[plan],
      amount: String(BigInt(planRules[plan].price * 100) * testWeiPerCent),
      expiresAt: Math.floor(Date.now() / 1000) + 600,
      expectedUntil: Number(until),
      instanceId: deployment.instanceId,
    };
    const signature = await chain.signSubscription(deployment, q);
    repo.run(
      "INSERT INTO subscription_orders(id,user_id,buyer_wallet,account_hash,plan,contract_address,instance_id,amount_wei,expires_at,expected_until,signature,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,'prepared',?)",
      q.id,
      user.id,
      wallet.address,
      q.accountId,
      plan,
      deployment.address,
      q.instanceId,
      q.amount,
      q.expiresAt,
      q.expectedUntil,
      signature,
      new Date().toISOString(),
    );
    res.status(201).json({ order: dto(get(q.id, user.id)) });
  });
  r.post('/billing/orders/:id/fund', limit, async (req, res) => {
    const user = requireUser(req),
      row = get(String(req.params.id), user.id),
      wallet = repo.wallet(user.id),
      market = await chain.subscriptionDeployment();
    if (
      row.status !== 'prepared' ||
      row.expires_at < Math.floor(Date.now() / 1000) ||
      row.instance_id !== market.instanceId ||
      row.contract_address.toLowerCase() !== market.address.toLowerCase() ||
      wallet?.address.toLowerCase() !== row.buyer_wallet.toLowerCase()
    )
      throw new HttpError(
        409,
        'Prepare a current order and connect its buyer wallet before requesting test funds.',
      );
    res.json({
      transactionHash: await chain.fund(
        wallet.address,
        BigInt(row.amount_wei) + parseEther('0.01'),
      ),
    });
  });
  r.post('/billing/orders/:id/recover', limit, async (req, res) => {
    const row = get(String(req.params.id), requireUser(req).id),
      market = await chain.subscriptionDeployment();
    if (
      market.instanceId !== row.instance_id ||
      market.address.toLowerCase() !== row.contract_address.toLowerCase()
    )
      throw new HttpError(
        409,
        'Restore the original local subscription contract to recover this order.',
      );
    if (row.tx_hash) return res.json({ transactionHash: row.tx_hash });
    const events = await chain.client.getContractEvents({
      address: row.contract_address,
      abi: subscriptionAbi,
      eventName: 'SubscriptionPurchased',
      args: { quoteId: row.id },
      fromBlock: 0n,
      toBlock: 'latest',
    });
    res.json({ transactionHash: events[0]?.transactionHash || null });
  });
  r.post('/billing/orders/:id/confirm', limit, async (req, res) => {
    const user = requireUser(req),
      row = get(String(req.params.id), user.id),
      { transactionHash } = z
        .object({
          transactionHash: z
            .string()
            .regex(/^0x[\da-fA-F]{64}$/)
            .transform((v) => v.toLowerCase() as Hex),
        })
        .parse(req.body);
    if (row.tx_hash && row.tx_hash.toLowerCase() !== transactionHash)
      throw new HttpError(409, 'This order already has a different transaction.');
    if (row.status === 'confirmed') return res.json({ order: dto(row), ...result(user.id) });
    if (row.status === 'failed')
      throw new HttpError(422, row.error || 'This payment failed. Prepare another order.');
    const deployment = await chain.subscriptionDeployment();
    if (
      row.instance_id !== deployment.instanceId ||
      row.contract_address.toLowerCase() !== deployment.address.toLowerCase()
    )
      throw new HttpError(
        409,
        'Restore the original local subscription contract before verifying this payment.',
      );
    const saved = repo.run(
      "UPDATE subscription_orders SET status='pending',tx_hash=? WHERE id=? AND status IN ('prepared','pending') AND (tx_hash IS NULL OR lower(tx_hash)=?)",
      transactionHash,
      row.id,
      transactionHash,
    );
    if (!saved.changes) {
      const latest = get(row.id, user.id);
      if (latest.status === 'confirmed' && latest.tx_hash?.toLowerCase() === transactionHash)
        return res.json({ order: dto(latest), ...result(user.id) });
      throw new HttpError(409, 'This order changed. Refresh before retrying.');
    }
    let receipt;
    try {
      receipt = await chain.client.getTransactionReceipt({ hash: transactionHash });
    } catch (e) {
      if (e instanceof TransactionReceiptNotFoundError)
        return res.status(202).json({ order: dto(get(row.id, user.id)) });
      throw new HttpError(
        503,
        'Verification is unavailable. The transaction is saved; retry verification before paying again.',
      );
    }
    const events = parseEventLogs({
      abi: subscriptionAbi,
      eventName: 'SubscriptionPurchased',
      logs: receipt.logs.filter(
        (l) => l.address.toLowerCase() === row.contract_address.toLowerCase(),
      ),
    });
    const block = await chain.client.getBlock({ blockNumber: receipt.blockNumber }),
      event = events[0]?.args;
    const valid =
      receipt.status === 'success' &&
      receipt.to?.toLowerCase() === row.contract_address.toLowerCase() &&
      receipt.from.toLowerCase() === row.buyer_wallet.toLowerCase() &&
      events.length === 1 &&
      event?.quoteId === row.id &&
      event.accountId === row.account_hash &&
      event.buyer.toLowerCase() === row.buyer_wallet.toLowerCase() &&
      event.plan === paidPlanNumber[row.plan] &&
      String(event.amount) === row.amount_wei &&
      event.validUntil ===
        BigInt(Math.max(row.expected_until, Number(block.timestamp)) + subscriptionPeriod);
    if (!valid) {
      const error =
        receipt.status === 'reverted'
          ? 'Subscription payment reverted. No subscription was activated.'
          : 'This transaction does not match the subscription order.';
      repo.run("UPDATE subscription_orders SET status='failed',error=? WHERE id=?", error, row.id);
      throw new HttpError(422, error);
    }
    repo.db.exec('BEGIN IMMEDIATE');
    try {
      const current = get(row.id, user.id);
      if (current.status !== 'confirmed') {
        repo.run(
          "UPDATE subscription_orders SET status='confirmed',valid_until=?,error=NULL WHERE id=?",
          Number(event.validUntil),
          row.id,
        );
        repo.run(
          'INSERT INTO subscriptions VALUES(?,?,?,0,?) ON CONFLICT(user_id) DO UPDATE SET plan=excluded.plan,valid_until=excluded.valid_until,cancel_at_end=0,updated_at=excluded.updated_at WHERE excluded.valid_until>subscriptions.valid_until',
          user.id,
          row.plan,
          Number(event.validUntil),
          new Date().toISOString(),
        );
        recordSubscription(repo, row.id, new Date(Number(block.timestamp) * 1000).toISOString());
      }
      repo.db.exec('COMMIT');
    } catch (e) {
      repo.db.exec('ROLLBACK');
      throw e;
    }
    res.json({ order: dto(get(row.id, user.id)), ...result(user.id) });
  });
  return r;
}
