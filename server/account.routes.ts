import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Repository, UserRow } from './repository.js';
import {
  loginSchema,
  registerSchema,
  profileSchema,
  planSchema,
  recipientsSchema,
  teamSchema,
  planRules,
} from '../shared/schemas.js';
import {
  sessionCookieName,
  cookieOptions,
  cookieToken,
  hashPassword,
  requireUser,
  startSession,
  startWindowSession,
  windowCookieName,
  tokenHash,
  verifyPassword,
} from './auth.js';
import { HttpError } from './errors.js';
import { issueAccountToken } from './security.js';
import { publicDemo } from './hosting.js';
import { sharedDemoAccount } from './public-demo.js';
import { acceptLegal } from './privacy.js';
export function accountRoutes(repo: Repository) {
  const r = Router();
  const limit = rateLimit({
    windowMs: 5 * 60000,
    limit: 30,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many sign-in attempts. Try again in a few minutes.' },
  });
  // Copy an existing login to a fresh tab cookie; the source session stays valid.
  r.post('/auth/window', limit, (req, res) => {
    const { context } = z
      .object({ context: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/) })
      .parse(req.body);
    const name = windowCookieName(context);
    if (req.headers.cookie?.split(';').some((c) => c.trim().startsWith(name + '=')))
      throw new HttpError(409, 'This window session is already in use. Open a new tab.');
    if (req.user) startWindowSession(repo, res, req.user.id, context);
    res.json({ ok: true });
  });
  r.post('/auth/register', limit, async (req, res) => {
    const v = registerSchema.parse(req.body);
    if (repo.one('SELECT id FROM users WHERE email=?', v.email))
      throw new HttpError(409, 'An account with this email already exists.');
    const hash = await hashPassword(v.password),
      id = randomUUID();
    repo.db.exec('BEGIN IMMEDIATE');
    try {
      repo.run(
        'INSERT INTO users(id,name,email,password_hash,created_at) VALUES(?,?,?,?,?)',
        id,
        v.name,
        v.email,
        hash,
        new Date().toISOString(),
      );
      startSession(repo, res, id, req);
      acceptLegal(repo, id);
      issueAccountToken(repo, repo.user(id), 'verify');
      repo.db.exec('COMMIT');
    } catch (error) {
      repo.db.exec('ROLLBACK');
      throw error;
    }
    res.status(201).json(repo.snapshot(repo.user(id)));
  });
  r.post('/auth/login', limit, async (req, res) => {
    const v = loginSchema.parse(req.body);
    const user = repo.one<UserRow>('SELECT * FROM users WHERE email=?', v.email);
    const valid = await verifyPassword(v.password, user?.password_hash || 'disabled');
    if (!user || !valid) throw new HttpError(401, 'Invalid email or password.');
    startSession(repo, res, user.id, req);
    res.json(repo.snapshot(user));
  });
  r.post('/auth/logout', (req, res) => {
    repo.run('DELETE FROM sessions WHERE token_hash=?', tokenHash(cookieToken(req)));
    res.clearCookie(sessionCookieName(req), cookieOptions).json({ ok: true });
  });
  r.patch('/profile', (req, res) => {
    const u = requireUser(req),
      v = profileSchema.parse(req.body);
    if (publicDemo() && sharedDemoAccount(repo, u.id))
      throw new HttpError(
        403,
        'Shared demo identities are fixed. Register your own demo account to edit its profile.',
      );
    if (repo.one('SELECT id FROM users WHERE email=? AND id<>?', v.email, u.id))
      throw new HttpError(409, 'This email is already in use.');
    repo.run('UPDATE users SET name=?,email=?,role=? WHERE id=?', v.name, v.email, v.role, u.id);
    if (v.email.toLowerCase() !== u.email.toLowerCase()) {
      repo.run('DELETE FROM email_verifications WHERE user_id=?', u.id);
      repo.run('DELETE FROM account_tokens WHERE user_id=?', u.id);
      issueAccountToken(repo, repo.user(u.id), 'verify');
    }
    res.json(repo.snapshot(repo.user(u.id)));
  });
  r.patch('/plan', (req, res) => {
    requireUser(req);
    planSchema.parse(req.body);
    throw new HttpError(
      402,
      'Paid plans require a verified subscription payment. Open Billing to purchase or manage a subscription.',
    );
  });
  r.patch('/recipients', (req, res) => {
    const u = requireUser(req),
      v = recipientsSchema.parse(req.body);
    const creatorWallet = repo.wallet(u.id)?.address.toLowerCase();
    if (v.recipients.some((r) => r.wallet?.toLowerCase() === creatorWallet && creatorWallet))
      throw new HttpError(
        400,
        'The creator keeps the remaining share. Use a different wallet for each co-author.',
      );
    repo.run('UPDATE users SET recipients=? WHERE id=?', JSON.stringify(v.recipients), u.id);
    res.json(repo.snapshot(repo.user(u.id)));
  });
  r.post('/team', (req, res) => {
    const u = requireUser(req);
    if (u.plan !== 'business') throw new HttpError(403, 'Team management requires Business.');
    const v = teamSchema.parse(req.body);
    if (repo.one('SELECT 1 FROM team WHERE owner_id=? AND email=?', u.id, v.email))
      throw new HttpError(409, 'This member is already on the team.');
    repo.run('INSERT INTO team VALUES(?,?,?,?)', randomUUID(), u.id, v.name, v.email);
    res.status(201).json(repo.snapshot(u));
  });
  r.delete('/team/:id', (req, res) => {
    const u = requireUser(req);
    repo.run('DELETE FROM team WHERE id=? AND owner_id=?', String(req.params.id), u.id);
    res.json(repo.snapshot(u));
  });
  return r;
}
