import { randomBytes, randomUUID } from 'node:crypto';
import type { Repository, UserRow } from './repository.js';
import { tokenHash } from './auth.js';
import { HttpError } from './errors.js';
export function issueAccountToken(repo: Repository, user: UserRow, purpose: 'verify' | 'reset') {
  if (
    process.env.ARTGUARD_PUBLIC_DEMO === 'true' &&
    purpose === 'reset' &&
    ['creator', 'buyer', 'coauthor'].some(
      (key) =>
        repo.one<{ value: string }>(
          'SELECT value FROM platform_meta WHERE key=?',
          'demo_account:' + key,
        )?.value === user.id,
    )
  )
    return;
  const recent = repo.one(
    'SELECT 1 FROM account_tokens WHERE user_id=? AND purpose=? AND created_at>?',
    user.id,
    purpose,
    Date.now() - 60000,
  );
  if (recent) return;
  const token = randomBytes(32).toString('hex'),
    expires = Date.now() + (purpose === 'verify' ? 86400000 : 1800000);
  repo.run('DELETE FROM account_tokens WHERE user_id=? AND purpose=?', user.id, purpose);
  repo.run(
    'INSERT INTO account_tokens VALUES(?,?,?,?,?,?)',
    tokenHash(token),
    user.id,
    user.email,
    purpose,
    expires,
    Date.now(),
  );
  const path = purpose === 'verify' ? 'verify-email' : 'reset-password';
  const url = `${process.env.PUBLIC_ORIGIN || `http://localhost:${process.env.PORT || 3000}`}/#/${path}?token=${token}`;
  repo.run(
    'INSERT INTO local_mail VALUES(?,?,?,?,?)',
    randomUUID(),
    user.email,
    purpose === 'verify' ? 'Verify your ArtGuard email' : 'Reset your ArtGuard password',
    `Open this link in your local ArtGuard app:\n${url}\n\nThis link is single-use and expires ${new Date(expires).toISOString()}. If you did not request it, ignore this message.`,
    new Date().toISOString(),
  );
}
export function requireVerified(repo: Repository, user: UserRow) {
  if (!repo.emailVerified(user.id))
    throw new HttpError(
      403,
      'Verify your email address before publishing, purchasing, or approving shares. Open Account security for instructions.',
    );
  return user;
}
