import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { LEGAL_VERSION, demoOperator } from '../shared/legal.js';
import type { Repository } from './repository.js';
import { requireUser } from './auth.js';
import { HttpError } from './errors.js';

export function operatorDetails(repo: Repository) {
  const row = repo.one<{ value: string }>(
    "SELECT value FROM site_settings WHERE key='legalOperator'",
  );
  return row ? JSON.parse(row.value) : demoOperator;
}
export function hasLegalConsent(repo: Repository, id: string) {
  return !!repo.one(
    'SELECT 1 FROM privacy_consents WHERE user_id=? AND version=? AND revoked_at IS NULL',
    id,
    LEGAL_VERSION,
  );
}
export function acceptLegal(repo: Repository, id: string, source = 'interactive') {
  if (!hasLegalConsent(repo, id))
    repo.run(
      'INSERT INTO privacy_consents VALUES(?,?,?,?,?,NULL)',
      randomUUID(),
      id,
      LEGAL_VERSION,
      source,
      new Date().toISOString(),
    );
}
export function privacyRoutes(repo: Repository) {
  const r = Router();
  r.use('/privacy', rateLimit({ windowMs: 60000, limit: 40, legacyHeaders: false }));
  r.get('/legal', (_req, res) =>
    res.json({
      version: LEGAL_VERSION,
      country: 'KZ',
      prototype: true,
      operator: operatorDetails(repo),
      operatorVerified: false,
    }),
  );
  r.get('/privacy', (req, res) => {
    const user = requireUser(req);
    res.json({
      version: LEGAL_VERSION,
      accepted: hasLegalConsent(repo, user.id),
      alias:
        repo.one<{ alias: string }>('SELECT alias FROM public_profiles WHERE user_id=?', user.id)
          ?.alias || '',
      consents: repo.all(
        'SELECT id,version,source,accepted_at,revoked_at FROM privacy_consents WHERE user_id=? ORDER BY accepted_at DESC',
        user.id,
      ),
      requests: repo.all(
        'SELECT id,kind,status,message,response,created_at,updated_at FROM privacy_requests WHERE user_id=? ORDER BY created_at DESC',
        user.id,
      ),
    });
  });
  r.post('/privacy/consents', (req, res) => {
    const u = requireUser(req);
    z.object({ accepted: z.literal(true), version: z.literal(LEGAL_VERSION) }).parse(req.body);
    acceptLegal(repo, u.id);
    res.json(repo.snapshot(u));
  });
  r.post('/privacy/withdraw', (req, res) => {
    const u = requireUser(req);
    z.object({ confirm: z.literal(true) }).parse(req.body);
    repo.run(
      'UPDATE privacy_consents SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL',
      new Date().toISOString(),
      u.id,
    );
    res.json(repo.snapshot(u));
  });
  r.patch('/privacy/profile', (req, res) => {
    const u = requireUser(req),
      v = z.object({ alias: z.string().trim().min(2).max(60) }).parse(req.body);
    repo.run(
      'INSERT INTO public_profiles VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET alias=excluded.alias',
      u.id,
      v.alias,
    );
    res.json(repo.snapshot(u));
  });
  r.post('/privacy/requests', (req, res) => {
    const u = requireUser(req),
      v = z
        .object({
          kind: z.enum(['deletion', 'access', 'support', 'appeal']),
          message: z.string().trim().min(10).max(2000),
        })
        .parse(req.body);
    if (
      repo.one(
        "SELECT 1 FROM privacy_requests WHERE user_id=? AND kind=? AND status IN ('open','reviewing')",
        u.id,
        v.kind,
      )
    )
      throw new HttpError(409, 'An open request of this kind already exists.');
    const id = randomUUID(),
      time = new Date().toISOString();
    repo.run(
      "INSERT INTO privacy_requests VALUES(?,?,?,?,'open','',?,?)",
      id,
      u.id,
      v.kind,
      v.message,
      time,
      time,
    );
    res.status(201).json({
      id,
      message:
        'Request recorded. This does not automatically erase records or reverse a transaction.',
    });
  });
  r.get('/privacy/export', (req, res) => {
    const u = requireUser(req),
      s = repo.snapshot(u);
    res
      .type('application/json')
      .attachment('artguard-my-data.json')
      .send(
        JSON.stringify(
          {
            exportedAt: new Date().toISOString(),
            account: s.user,
            projects: s.artworks.filter((a) => a.own),
            purchases: s.purchases,
            walletHistory: repo.all(
              'SELECT address,linked_at,unlinked_at FROM wallet_history WHERE user_id=?',
              u.id,
            ),
            consents: repo.all(
              'SELECT version,source,accepted_at,revoked_at FROM privacy_consents WHERE user_id=?',
              u.id,
            ),
            requests: repo.all(
              'SELECT kind,message,status,response,created_at,updated_at FROM privacy_requests WHERE user_id=?',
              u.id,
            ),
            notice:
              'Private keys, password hashes, session cookies and account tokens are never exported. Public blockchain history cannot be erased through this export.',
          },
          null,
          2,
        ),
      );
  });
  r.use('/admin/privacy', (req, _res, next) => {
    const u = requireUser(req);
    if (!repo.isAdmin(u.id) || !repo.emailVerified(u.id))
      throw new HttpError(403, 'Verified technical administrator access required.');
    next();
  });
  r.get('/admin/privacy', (_req, res) =>
    res.json({
      requests: repo.all(
        'SELECT r.*,u.email FROM privacy_requests r JOIN users u ON u.id=r.user_id ORDER BY r.created_at DESC LIMIT 200',
      ),
      operator: operatorDetails(repo),
    }),
  );
  r.patch('/admin/privacy/operator', (req, res) => {
    const v = z
      .object({
        name: z.string().trim().min(2).max(160),
        contact: z.email().max(254),
        bin: z.string().regex(/^(\d{12})?$/),
        hosting: z.string().trim().min(5).max(400),
      })
      .parse(req.body);
    repo.run(
      "INSERT INTO site_settings VALUES('legalOperator',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      JSON.stringify(v),
    );
    res.json({ operator: v });
  });
  r.patch('/admin/privacy/requests/:id', (req, res) => {
    const v = z
      .object({
        status: z.enum(['reviewing', 'answered']),
        response: z.string().trim().min(10).max(3000),
      })
      .parse(req.body);
    if (
      !repo.run(
        'UPDATE privacy_requests SET status=?,response=?,updated_at=? WHERE id=?',
        v.status,
        v.response,
        new Date().toISOString(),
        String(req.params.id),
      ).changes
    )
      throw new HttpError(404, 'Request not found.');
    res.json({ ok: true });
  });
  return r;
}
