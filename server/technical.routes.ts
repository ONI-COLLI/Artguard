import { Router } from 'express';
import { z } from 'zod';
import { requireUser } from './auth.js';
import { requireVerified } from './security.js';
import { HttpError } from './errors.js';
import type { Repository } from './repository.js';
import type { LocalBlockchain } from './blockchain.js';

export function siteSettings(repo: Repository) {
  const get = (key: string) =>
    repo.one<{ value: string }>('SELECT value FROM site_settings WHERE key=?', key)?.value;
  return {
    registrationEnabled: get('registrationEnabled') !== 'false',
    uploadsEnabled: get('uploadsEnabled') !== 'false',
  };
}
export function technicalRoutes(repo: Repository, chain: LocalBlockchain) {
  const router = Router();
  router.use('/admin/technical', (req, _res, next) => {
    const user = requireVerified(repo, requireUser(req));
    if (!repo.isAdmin(user.id))
      throw new HttpError(403, 'Technical administrator access is required.');
    next();
  });
  router.get('/admin/technical', async (_req, res) => {
    const network = await chain.status();
    res.json({
      checkedAt: new Date().toISOString(),
      runtime: {
        node: process.versions.node,
        uptimeSeconds: Math.floor(process.uptime()),
        database: 'SQLite',
        schema: repo.one<{ user_version: number }>('PRAGMA user_version')!.user_version,
      },
      network,
      settings: siteSettings(repo),
      pending: {
        registrations: repo.one<{ n: number }>(
          "SELECT count(*) n FROM chain_registrations WHERE status='pending'",
        )!.n,
        checkouts: repo.one<{ n: number }>(
          "SELECT count(*) n FROM chain_checkouts WHERE status='pending'",
        )!.n,
      },
      staff: repo.all<{ id: string; name: string; email: string; isManager: number }>(
        'SELECT u.id,u.name,u.email,EXISTS(SELECT 1 FROM manager_accounts m WHERE m.user_id=u.id) AS isManager FROM users u WHERE u.password_hash<>? ORDER BY u.name LIMIT 250',
        'disabled',
      ),
    });
  });
  router.patch('/admin/technical/settings', (req, res) => {
    const values = z
      .object({ registrationEnabled: z.boolean(), uploadsEnabled: z.boolean() })
      .parse(req.body);
    repo.db.exec('BEGIN IMMEDIATE');
    try {
      for (const [key, value] of Object.entries(values))
        repo.run(
          'INSERT INTO site_settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
          key,
          String(value),
        );
      repo.db.exec('COMMIT');
    } catch (error) {
      repo.db.exec('ROLLBACK');
      throw error;
    }
    res.json({ settings: siteSettings(repo) });
  });
  router.patch('/admin/technical/managers/:id', (req, res) => {
    const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body),
      id = String(req.params.id);
    const user = repo.user(id);
    if (!user || user.password_hash === 'disabled') throw new HttpError(404, 'Account not found.');
    if (enabled) {
      requireVerified(repo, user);
      repo.run('INSERT OR IGNORE INTO manager_accounts VALUES(?,?)', id, new Date().toISOString());
    } else repo.run('DELETE FROM manager_accounts WHERE user_id=?', id);
    res.json({ ok: true });
  });
  return router;
}
