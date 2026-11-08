import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import type { Request, Response, NextFunction } from 'express';
import type { Repository, UserRow } from './repository.js';
import { HttpError } from './errors.js';
const scrypt = promisify(scryptCallback);
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const hash = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${hash.toString('hex')}`;
}
export async function verifyPassword(password: string, stored: string) {
  const [salt, hex] = stored.split(':');
  const valid = !!salt && /^[a-f0-9]{128}$/.test(hex || '');
  const hash = (await scrypt(password, valid ? salt : '0'.repeat(32), 64)) as Buffer;
  return valid && timingSafeEqual(Buffer.from(hex, 'hex'), hash);
}
export const tokenHash = (v: string) => createHash('sha256').update(v).digest('hex');
export function windowCookieName(context: string) {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(context))
    throw new HttpError(400, 'Invalid window session. Open the site in a new tab.');
  return `artguard_session_window_${context}`;
}
export function sessionCookieName(req: Request) {
  const header = req.headers['x-artguard-window'];
  const query = req.query.__window;
  const context = header ?? query;
  if (context === undefined) return 'artguard_session';
  if (
    typeof context !== 'string' ||
    !/^[a-zA-Z0-9_-]{1,64}$/.test(context) ||
    (header !== undefined && query !== undefined && header !== query)
  )
    throw new HttpError(400, 'Invalid test window. Open a new window from Demo studio.');
  return windowCookieName(context);
}
export const cookieToken = (req: Request) => {
  const prefix = sessionCookieName(req) + '=';
  return (
    req.headers.cookie
      ?.split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith(prefix))
      ?.slice(prefix.length) || ''
  );
};
export const cookieOptions = {
  httpOnly: true,
  sameSite: 'strict' as const,
  path: '/',
  maxAge: 7 * 86400000,
  get secure() {
    return process.env.COOKIE_SECURE === 'true';
  },
};
export function sessionUser(repo: Repository, req: Request): UserRow | null {
  const token = cookieToken(req);
  const saved = /^[a-f0-9]{64}$/.test(token)
    ? repo.one<UserRow>(
        'SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>?',
        tokenHash(token),
        Date.now(),
      ) || null
    : null;
  return saved ? repo.user(saved.id) : null;
}
export function startSession(repo: Repository, res: Response, userId: string, req: Request) {
  issueSession(repo, res, userId, sessionCookieName(req));
}
export function startWindowSession(
  repo: Repository,
  res: Response,
  userId: string,
  context: string,
) {
  issueSession(repo, res, userId, windowCookieName(context));
}
function issueSession(repo: Repository, res: Response, userId: string, name: string) {
  const token = randomBytes(32).toString('hex');
  repo.run('DELETE FROM sessions WHERE expires_at<?', Date.now());
  repo.run(
    'INSERT INTO sessions VALUES(?,?,?)',
    tokenHash(token),
    userId,
    Date.now() + 7 * 86400000,
  );
  res.cookie(name, token, cookieOptions);
}
export function requireUser(req: Request, _res?: Response, _next?: NextFunction): UserRow {
  if (!req.user) throw new HttpError(401, 'Sign in to continue.');
  return req.user;
}
declare global {
  namespace Express {
    interface Request {
      user: UserRow | null;
    }
  }
}
