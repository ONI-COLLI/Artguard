import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { verifyTypedData, type Hex } from 'viem';
import type { Repository } from './repository.js';
import { requireUser, tokenHash, hashPassword, cookieOptions, sessionCookieName } from './auth.js';
import { HttpError } from './errors.js';
import { issueAccountToken, requireVerified } from './security.js';
import { consentRequest, shareStatus } from './consents.js';
import { consentTypes } from '../shared/platform.js';

export function platformRoutes(repo: Repository) {
  const r = Router(),
    email = z
      .email()
      .max(254)
      .transform((v) => v.toLowerCase()),
    token = z.string().regex(/^[a-f0-9]{64}$/);
  const authLimit = rateLimit({
    windowMs: 15 * 60000,
    limit: 15,
    legacyHeaders: false,
    message: { error: 'Too many account requests. Try again later.' },
  });
  const actionLimit = rateLimit({
    windowMs: 60000,
    limit: 60,
    legacyHeaders: false,
    message: { error: 'Too many requests. Try again shortly.' },
  });
  r.post('/auth/verify-email', authLimit, (req, res) => {
    const v = z.object({ token }).parse(req.body);
    const row = repo.one<{ user_id: string; email: string }>(
      "SELECT t.user_id,t.email FROM account_tokens t JOIN users u ON u.id=t.user_id WHERE token_hash=? AND purpose='verify' AND expires_at>? AND t.email=u.email COLLATE NOCASE",
      tokenHash(v.token),
      Date.now(),
    );
    if (!row)
      throw new HttpError(400, 'Verification link expired or already used. Request a new one.');
    repo.db.exec('BEGIN IMMEDIATE');
    try {
      const used = repo.run(
        "DELETE FROM account_tokens WHERE token_hash=? AND purpose='verify' AND expires_at>?",
        tokenHash(v.token),
        Date.now(),
      );
      if (!used.changes) throw new HttpError(400, 'This verification link is no longer valid.');
      repo.run(
        'INSERT INTO email_verifications VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET email=excluded.email,verified_at=excluded.verified_at',
        row.user_id,
        row.email,
        new Date().toISOString(),
      );
      repo.db.exec('COMMIT');
    } catch (e) {
      repo.db.exec('ROLLBACK');
      throw e;
    }
    res.json({ ok: true });
  });
  r.post('/auth/resend-verification', authLimit, (req, res) => {
    const user = requireUser(req);
    if (!repo.emailVerified(user.id)) issueAccountToken(repo, user, 'verify');
    res.json({
      ok: true,
      message: 'A verification message is available in the local mail outbox.',
    });
  });
  r.post('/auth/forgot-password', authLimit, (req, res) => {
    const v = z.object({ email }).parse(req.body),
      user = repo.one<{ id: string; password_hash: string }>(
        'SELECT id,password_hash FROM users WHERE email=?',
        v.email,
      );
    if (user && user.password_hash !== 'disabled')
      issueAccountToken(repo, repo.user(user.id), 'reset');
    res.json({
      ok: true,
      message: 'If this account exists, a reset message has been saved to the local mail outbox.',
    });
  });
  r.post('/auth/reset-password', authLimit, async (req, res) => {
    const v = z.object({ token, password: z.string().min(8).max(128) }).parse(req.body);
    const find = () =>
      repo.one<{ user_id: string }>(
        "SELECT t.user_id FROM account_tokens t JOIN users u ON u.id=t.user_id WHERE token_hash=? AND purpose='reset' AND expires_at>? AND t.email=u.email COLLATE NOCASE",
        tokenHash(v.token),
        Date.now(),
      );
    if (!find()) throw new HttpError(400, 'Reset link expired or already used. Request a new one.');
    const password = await hashPassword(v.password);
    repo.db.exec('BEGIN IMMEDIATE');
    try {
      const current = find();
      if (!current)
        throw new HttpError(400, 'Reset link expired or already used. Request a new one.');
      repo.run('UPDATE users SET password_hash=? WHERE id=?', password, current.user_id);
      repo.run('DELETE FROM account_tokens WHERE user_id=?', current.user_id);
      repo.run('DELETE FROM sessions WHERE user_id=?', current.user_id);
      repo.run('DELETE FROM wallet_challenges WHERE user_id=?', current.user_id);
      repo.db.exec('COMMIT');
    } catch (e) {
      repo.db.exec('ROLLBACK');
      throw e;
    }
    res.clearCookie(sessionCookieName(req), cookieOptions).json({ ok: true });
  });
  r.get('/coauthors', (req, res) => {
    const user = requireUser(req),
      wallet = repo.wallet(user.id);
    const invitations = wallet
      ? repo
          .all<{ id: string }>('SELECT id FROM artworks ORDER BY created_at DESC')
          .filter((a) => repo.isCoauthor(a.id, user))
          .map((a) => ({
            artwork: repo.serialize(repo.artwork(a.id)!, user),
            status: shareStatus(repo, a.id),
          }))
      : [];
    res.json({ invitations });
  });
  r.get('/coauthors/:id/request', (req, res) => {
    const user = requireVerified(repo, requireUser(req)),
      wallet = repo.wallet(user.id);
    if (!wallet) throw new HttpError(400, 'Link your co-author wallet first.');
    res.json(consentRequest(repo, String(req.params.id), wallet.address));
  });
  r.post('/coauthors/:id/approve', actionLimit, async (req, res) => {
    const user = requireVerified(repo, requireUser(req)),
      wallet = repo.wallet(user.id);
    if (!wallet) throw new HttpError(400, 'Link your co-author wallet first.');
    const v = z
        .object({ versionId: z.uuid(), signature: z.string().regex(/^0x[\da-fA-F]{130}$/) })
        .parse(req.body),
      id = String(req.params.id);
    const request = consentRequest(repo, id, wallet.address);
    if (request.versionId !== v.versionId)
      throw new HttpError(409, 'The split changed. Review the latest version.');
    let valid = false;
    try {
      valid = await verifyTypedData({
        address: wallet.address,
        domain: request.domain,
        types: consentTypes,
        primaryType: 'RevenueConsent',
        message: request.message,
        signature: v.signature as Hex,
      });
    } catch {}
    if (!valid) throw new HttpError(400, 'The co-author signature could not be verified.');
    if (
      repo.wallet(user.id)?.address.toLowerCase() !== wallet.address.toLowerCase() ||
      consentRequest(repo, id, wallet.address).versionId !== v.versionId
    )
      throw new HttpError(409, 'The wallet or split changed. Review it again.');
    repo.run(
      "INSERT INTO share_approvals VALUES(?,?,'approved',?,?) ON CONFLICT(version_id,wallet) DO UPDATE SET status='approved',signature=excluded.signature,updated_at=excluded.updated_at",
      v.versionId,
      wallet.address,
      v.signature,
      new Date().toISOString(),
    );
    res.json(repo.snapshot(repo.user(user.id)));
  });
  r.post('/coauthors/:id/decline', actionLimit, (req, res) => {
    const user = requireVerified(repo, requireUser(req)),
      wallet = repo.wallet(user.id);
    if (!wallet) throw new HttpError(400, 'Link your co-author wallet first.');
    const v = z.object({ versionId: z.uuid() }).parse(req.body),
      request = consentRequest(repo, String(req.params.id), wallet.address);
    if (request.versionId !== v.versionId)
      throw new HttpError(409, 'The split changed. Review the latest version.');
    const approved = repo.one<{ status: string }>(
      'SELECT status FROM share_approvals WHERE version_id=? AND wallet=?',
      v.versionId,
      wallet.address,
    );
    if (approved?.status === 'approved')
      throw new HttpError(
        409,
        'This version is already approved. Ask the creator to prepare a new split; existing signed orders remain valid.',
      );
    repo.run(
      "INSERT INTO share_approvals VALUES(?,?,'declined',NULL,?) ON CONFLICT(version_id,wallet) DO UPDATE SET status='declined',updated_at=excluded.updated_at",
      v.versionId,
      wallet.address,
      new Date().toISOString(),
    );
    res.json(repo.snapshot(user));
  });
  r.post('/reports', actionLimit, (req, res) => {
    const user = requireVerified(repo, requireUser(req)),
      v = z
        .object({
          artworkId: z.string().min(1).max(100),
          category: z.enum(['copyright', 'inappropriate', 'fraud', 'other']),
          details: z.string().trim().min(10).max(2000),
        })
        .parse(req.body),
      artwork = repo.artwork(v.artworkId);
    if (!repo.canView(artwork, user)) throw new HttpError(404, 'Project not found.');
    if (artwork.owner_id === user.id)
      throw new HttpError(400, 'You can unpublish your own project in its editor.');
    if (
      repo.one(
        "SELECT 1 FROM artwork_reports WHERE artwork_id=? AND reporter_id=? AND status='open'",
        artwork.id,
        user.id,
      )
    )
      throw new HttpError(409, 'Your report for this project is already open.');
    if (
      repo.one<{ n: number }>(
        'SELECT count(*) n FROM artwork_reports WHERE reporter_id=? AND created_at>?',
        user.id,
        new Date(Date.now() - 3600000).toISOString(),
      )!.n >= 5
    )
      throw new HttpError(429, 'You can submit up to five reports per hour.');
    repo.run(
      'INSERT INTO artwork_reports(id,artwork_id,reporter_id,category,details,created_at) VALUES(?,?,?,?,?,?)',
      randomUUID(),
      artwork.id,
      user.id,
      v.category,
      v.details,
      new Date().toISOString(),
    );
    res.status(201).json({ ok: true });
  });
  r.get('/reports', (req, res) =>
    res.json({
      reports: repo.all(
        'SELECT r.id,r.artwork_id AS artworkId,a.title,r.category,r.details,r.status,r.review_note AS reviewNote,r.created_at AS createdAt FROM artwork_reports r JOIN artworks a ON a.id=r.artwork_id WHERE r.reporter_id=? ORDER BY r.created_at DESC',
        requireUser(req).id,
      ),
    }),
  );
  const admin = (req: Parameters<typeof requireUser>[0]) => {
    const user = requireVerified(repo, requireUser(req));
    if (!repo.isAdmin(user.id)) throw new HttpError(403, 'Moderator access is required.');
    return user;
  };
  r.get('/admin/moderation', (req, res) => {
    admin(req);
    res.json({
      reports: repo.all(
        'SELECT r.*,a.title,u.name AS reporter FROM artwork_reports r JOIN artworks a ON a.id=r.artwork_id JOIN users u ON u.id=r.reporter_id ORDER BY r.created_at DESC LIMIT 200',
      ),
      artworks: repo.all(
        "SELECT a.id,a.title,a.status,u.name AS creator,coalesce(m.hidden,0) AS hidden,coalesce(m.reason,'') AS reason FROM artworks a JOIN users u ON u.id=a.owner_id LEFT JOIN artwork_moderation m ON m.artwork_id=a.id ORDER BY a.created_at DESC LIMIT 200",
      ),
      actions: repo.all(
        'SELECT m.*,a.title FROM moderation_actions m JOIN artworks a ON a.id=m.artwork_id ORDER BY m.created_at DESC LIMIT 100',
      ),
    });
  });
  r.post('/admin/artworks/:id/moderation', actionLimit, (req, res) => {
    const user = admin(req),
      id = String(req.params.id),
      v = z
        .object({ hidden: z.boolean(), reason: z.string().trim().min(5).max(1000) })
        .parse(req.body);
    if (!repo.artwork(id)) throw new HttpError(404, 'Project not found.');
    repo.db.exec('BEGIN IMMEDIATE');
    try {
      repo.run(
        'INSERT INTO artwork_moderation VALUES(?,?,?,?,?) ON CONFLICT(artwork_id) DO UPDATE SET hidden=excluded.hidden,reason=excluded.reason,updated_by=excluded.updated_by,updated_at=excluded.updated_at',
        id,
        Number(v.hidden),
        v.reason,
        user.id,
        new Date().toISOString(),
      );
      repo.run(
        'INSERT INTO moderation_actions VALUES(?,?,?,?,?,?)',
        randomUUID(),
        id,
        user.id,
        v.hidden ? 'hide' : 'restore',
        v.reason,
        new Date().toISOString(),
      );
      repo.db.exec('COMMIT');
    } catch (e) {
      repo.db.exec('ROLLBACK');
      throw e;
    }
    res.json({ ok: true });
  });
  r.post('/admin/reports/:id/review', actionLimit, (req, res) => {
    const user = admin(req),
      v = z
        .object({
          status: z.enum(['resolved', 'dismissed']),
          note: z.string().trim().min(5).max(1000),
        })
        .parse(req.body);
    const changed = repo.run(
      "UPDATE artwork_reports SET status=?,reviewed_by=?,review_note=?,reviewed_at=? WHERE id=? AND status='open'",
      v.status,
      user.id,
      v.note,
      new Date().toISOString(),
      String(req.params.id),
    );
    if (!changed.changes)
      throw new HttpError(409, 'This report was already reviewed or does not exist.');
    res.json({ ok: true });
  });
  return r;
}
