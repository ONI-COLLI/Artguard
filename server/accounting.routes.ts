import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { requireUser } from './auth.js';
import { requireVerified } from './security.js';
import { HttpError } from './errors.js';
import type { Repository } from './repository.js';
import type { LocalBlockchain } from './blockchain.js';
import { accountingData, accountingExport } from './accounting.js';
import { syncAccountingBalances } from './accounting-balances.js';
export function accountingRoutes(repo: Repository, chain: LocalBlockchain) {
  const r = Router();
  r.use((req, _res, next) => {
    req.url = req.url.replace(/^\/manager\/accounting/, '/admin/accounting');
    next();
  });
  r.use('/admin/accounting', (req, _res, next) => {
    const user = requireVerified(repo, requireUser(req));
    if (!repo.isManager(user.id))
      throw new HttpError(
        403,
        'Manager access is required for financial records. Technical administrator access does not grant financial access.',
      );
    next();
  });
  r.get('/admin/accounting', (req, res) => {
    const v = z
      .object({
        view: z.enum(['summary', 'users', 'products', 'events']).default('summary'),
        page: z.coerce.number().int().min(1).max(100000).default(1),
        q: z.string().max(200).default(''),
        userId: z.string().max(100).default(''),
        status: z.string().max(30).default('all'),
        currency: z.enum(['all', 'local_usd', 'test_eth']).default('all'),
      })
      .parse(req.query);
    const data = accountingData(repo),
      { users, products, events, ...summary } = data;
    if (v.view === 'summary') return res.json(summary);
    const q = v.q.toLowerCase();
    let rows: unknown[];
    if (v.view === 'users')
      rows = users.filter((u) =>
        JSON.stringify([u.id, u.name, u.email, u.wallet, u.walletHistory])
          .toLowerCase()
          .includes(q),
      );
    else if (v.view === 'products')
      rows = products.filter(
        (p) =>
          (!v.userId || p.ownerId === v.userId) &&
          (v.status === 'all' || (v.status === 'sold' ? p.sales > 0 : p.status === v.status)) &&
          JSON.stringify([p.id, p.ownerId, p.owner, p.title, p.hash]).toLowerCase().includes(q),
      );
    else
      rows = events.filter(
        (e) =>
          (!v.userId ||
            e.buyerId === v.userId ||
            e.sellerId === v.userId ||
            e.allocations.some((a) => a.userId === v.userId)) &&
          (v.currency === 'all' || e.currency === v.currency) &&
          JSON.stringify(e).toLowerCase().includes(q),
      );
    const pageSize = 25;
    res.json({
      items: rows.slice((v.page - 1) * pageSize, v.page * pageSize),
      total: rows.length,
      page: v.page,
      pageSize,
    });
  });
  r.get('/admin/accounting/export', (req, res) => {
    res
      .type('application/json')
      .attachment('artguard-accounting.json')
      .send(JSON.stringify(accountingExport(repo), null, 2));
  });
  let pending: Promise<unknown> | null = null;
  r.post(
    '/admin/accounting/sync',
    rateLimit({
      windowMs: 60000,
      limit: 5,
      legacyHeaders: false,
      message: { error: 'Wait a moment before synchronizing balances again.' },
    }),
    async (_req, res) => {
      if (!pending)
        pending = syncAccountingBalances(repo, chain).finally(() => {
          pending = null;
        });
      try {
        res.json({ snapshot: await pending });
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(
          503,
          'Balance synchronization is unavailable. Previous snapshots are retained; retry when the local chain is ready.',
        );
      }
    },
  );
  return r;
}
