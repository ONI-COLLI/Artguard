import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { Repository } from './repository.js';
import { requireUser } from './auth.js';
import { HttpError } from './errors.js';
import { accountingData } from './accounting.js';
import { testWeiPerCent } from '../shared/marketplace.js';
import type { Expense, FinanceReport } from '../shared/finance.js';
import type { LocalBlockchain } from './blockchain.js';
import { reconcileEscrow } from './reconciliation.js';
import rateLimit from 'express-rate-limit';
import type { AccountingEvent } from '../shared/accounting.js';
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) => Number.isFinite(Date.parse(v)) && new Date(v).toISOString().startsWith(v),
    'Use an actual calendar date.',
  );
export const financePeriodSchema = z
  .object({ from: day, to: day })
  .refine((v) => v.from <= v.to, 'Start must be before the end date.');
const cents = (e: AccountingEvent, value: string) =>
  e.currency === 'test_eth' ? BigInt(value) / testWeiPerCent : BigInt(value);
export function serviceEarned(
  amount: bigint,
  at: number,
  duration: number,
  start: number,
  end: number,
) {
  const elapsed = (t: number) => BigInt(Math.max(0, Math.min(duration, t - at)));
  return (amount * elapsed(end)) / BigInt(duration) - (amount * elapsed(start)) / BigInt(duration);
}
export function financialReport(
  repo: Repository,
  input: { from: string; to: string },
): FinanceReport {
  const period = financePeriodSchema.parse(input),
    start = Date.parse(period.from + 'T00:00:00+05:00'),
    end = Date.parse(period.to + 'T00:00:00+05:00') + 86400000;
  const all = accountingData(repo).events.filter((e) => !e.supersededBy),
    breakdown = { commission: 0n, subscriptions: 0n, promotions: 0n };
  let cash = 0n,
    volume = 0n,
    sales = 0,
    deferred = 0n;
  for (const e of all) {
    const at = Date.parse(e.occurredAt),
      inside = at >= start && at < end,
      amount = cents(e, e.kind === 'sale' ? e.fee : e.gross);
    if (inside) {
      cash += amount;
      if (e.kind === 'sale') {
        volume += cents(e, e.gross);
        sales++;
      }
    }
    if (e.kind === 'sale') {
      if (inside) breakdown.commission += amount;
      continue;
    }
    const duration = (e.kind === 'subscription' ? 30 : 7) * 86400000;
    const serviceOrder =
      e.transactionHash && e.instanceId
        ? repo.one<{ valid_until: number }>(
            `SELECT valid_until FROM ${e.kind === 'subscription' ? 'subscription_orders' : 'promotion_orders'} WHERE tx_hash=? AND instance_id=? AND status='confirmed'`,
            e.transactionHash,
            e.instanceId,
          )
        : undefined;
    const serviceStart = serviceOrder?.valid_until
      ? serviceOrder.valid_until * 1000 - duration
      : at;
    const earned = at < end ? serviceEarned(amount, serviceStart, duration, start, end) : 0n;
    breakdown[e.kind === 'subscription' ? 'subscriptions' : 'promotions'] += earned;
    if (at < end)
      deferred += amount - serviceEarned(amount, serviceStart, duration, serviceStart, end);
  }
  const expenses = repo.all<Expense>(
      'SELECT id,category,amount_cents,occurred_on,note,created_at,voided_at,void_reason FROM operating_expenses WHERE occurred_on>=? AND occurred_on<=? ORDER BY occurred_on DESC,created_at DESC',
      period.from,
      period.to,
    ),
    costs = expenses.filter((e) => !e.voided_at).reduce((s, e) => s + BigInt(e.amount_cents), 0n),
    earned = breakdown.commission + breakdown.subscriptions + breakdown.promotions;
  const escrow = repo.all<{ state: string; amount_wei: string; settled_at: string | null }>(
    `SELECT e.state,e.settled_at,i.amount_wei FROM escrow_records e JOIN chain_checkout_items i ON i.quote_id=e.quote_id`,
  );
  return {
    period: { ...period, timezone: 'Asia/Qyzylorda (UTC+5)' },
    basis:
      'Educational management model in reference USD cents. Test ETH receipts use the recorded prototype conversion (1 USD = 0.001 test ETH), not market ETH. This is not statutory accounting or actual money. Service revenue is spread across 30/7 days; costs and taxes are entered manually.',
    cashRevenueCents: String(cash),
    earnedRevenueCents: String(earned),
    deferredServiceCents: String(deferred),
    operatingCostsCents: String(costs),
    profitCents: String(earned - costs),
    salesVolumeCents: String(volume),
    salesCount: sales,
    recordedEscrowWei: String(
      escrow
        .filter((e) => ['funded', 'delivered', 'disputed'].includes(e.state))
        .reduce((s, e) => s + BigInt(e.amount_wei), 0n),
    ),
    refundsInPeriodWei: String(
      escrow
        .filter(
          (e) =>
            e.state === 'refunded' &&
            e.settled_at &&
            Date.parse(e.settled_at) >= start &&
            Date.parse(e.settled_at) < end,
        )
        .reduce((s, e) => s + BigInt(e.amount_wei), 0n),
    ),
    breakdown: Object.fromEntries(
      Object.entries(breakdown).map(([key, v]) => [key, String(v)]),
    ) as FinanceReport['breakdown'],
    expenses,
  };
}
export function financeRoutes(repo: Repository, chain: LocalBlockchain) {
  const r = Router();
  r.use('/manager/finance', (req, _res, next) => {
    const u = requireUser(req);
    if (!repo.isManager(u.id) || !repo.emailVerified(u.id))
      throw new HttpError(403, 'Verified manager access required.');
    next();
  });
  r.post(
    '/manager/finance/reconcile',
    rateLimit({ windowMs: 60000, limit: 5, legacyHeaders: false }),
    async (_req, res) => res.json(await reconcileEscrow(repo, chain)),
  );
  r.get('/manager/finance', (req, res) =>
    res.json(financialReport(repo, financePeriodSchema.parse(req.query))),
  );
  r.get('/manager/finance/export', (req, res) =>
    res
      .type('application/json')
      .attachment('artguard-period-finance.json')
      .send(JSON.stringify(financialReport(repo, financePeriodSchema.parse(req.query)), null, 2)),
  );
  r.post('/manager/finance/expenses', (req, res) => {
    const v = z
      .object({
        id: z.uuid(),
        category: z.enum([
          'hosting',
          'storage',
          'support',
          'marketing',
          'network',
          'taxes',
          'other',
        ]),
        amount: z.string().regex(/^(0|[1-9]\d{0,8})(\.\d{1,2})?$/),
        occurredOn: day,
        note: z.string().trim().min(3).max(500),
      })
      .parse(req.body);
    const [whole, fraction = ''] = v.amount.split('.'),
      amount = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
    if (amount <= 0n) throw new HttpError(400, 'Enter a positive expense.');
    const existing = repo.one<Expense>('SELECT * FROM operating_expenses WHERE id=?', v.id);
    if (existing) {
      if (
        existing.amount_cents !== String(amount) ||
        existing.note !== v.note ||
        existing.category !== v.category ||
        existing.occurred_on !== v.occurredOn
      )
        throw new HttpError(409, 'This expense ID was already used for different values.');
      res.json({ id: v.id });
      return;
    }
    repo.run(
      'INSERT INTO operating_expenses VALUES(?,?,?,?,?,?,?,NULL,NULL)',
      v.id,
      requireUser(req).id,
      v.category,
      String(amount),
      v.occurredOn,
      v.note,
      new Date().toISOString(),
    );
    res.status(201).json({ id: v.id });
  });
  r.post('/manager/finance/expenses/:id/void', (req, res) => {
    const { reason } = z.object({ reason: z.string().trim().min(10).max(500) }).parse(req.body);
    if (
      !repo.run(
        'UPDATE operating_expenses SET voided_at=?,void_reason=? WHERE id=? AND voided_at IS NULL',
        new Date().toISOString(),
        reason,
        String(req.params.id),
      ).changes
    )
      throw new HttpError(409, 'Expense not found or already voided.');
    res.json({ ok: true });
  });
  return r;
}
