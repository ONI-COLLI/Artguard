// Trusted setup for feature tests. Public verification, billing, and consent routes are exercised
// separately; no fixture bypass is exposed by the application.
import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { Repository } from '../server/repository.ts';
import { shareStatus } from '../server/consents.ts';
import { LEGAL_VERSION } from '../shared/legal.ts';
export function withLegalFixture(data: any) {
  return data &&
    typeof data === 'object' &&
    (('name' in data && 'password' in data) || 'link' in data)
    ? { legalAccepted: true, legalVersion: LEGAL_VERSION, ...data }
    : data;
}
export function verifiedFixture(db: DatabaseSync, user: { id: string; email: string }) {
  db.prepare(
    'INSERT INTO email_verifications VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET email=excluded.email,verified_at=excluded.verified_at',
  ).run(user.id, user.email, new Date().toISOString());
}
export function planFixture(db: DatabaseSync, userId: string, plan: string) {
  if (plan === 'free') db.prepare('DELETE FROM subscriptions WHERE user_id=?').run(userId);
  else
    db.prepare(
      'INSERT INTO subscriptions VALUES(?,?,?,0,?) ON CONFLICT(user_id) DO UPDATE SET plan=excluded.plan,valid_until=excluded.valid_until,cancel_at_end=0',
    ).run(userId, plan, Math.floor(Date.now() / 1000) + 30 * 86400, new Date().toISOString());
}
export function approvedProjectFixture(db: DatabaseSync, id: string) {
  const repo = new Repository(db),
    artwork = repo.artwork(id)!;
  const wallet = (text: string) =>
    '0x' + createHash('sha256').update(text).digest('hex').slice(0, 40);
  if (!repo.wallet(artwork.owner_id))
    repo.run(
      'INSERT INTO wallets VALUES(?,?,?)',
      artwork.owner_id,
      wallet(artwork.owner_id),
      new Date().toISOString(),
    );
  repo.setArtworkRecipients(
    id,
    repo.artworkRecipients(id).map((r, i) => ({ ...r, wallet: r.wallet || wallet(id + ':' + i) })),
  );
  const status = shareStatus(repo, id);
  for (const recipient of status.recipients)
    repo.run(
      "INSERT OR REPLACE INTO share_approvals VALUES(?,?,'approved',?,?)",
      status.versionId!,
      recipient.wallet!,
      '0x' + '00'.repeat(65),
      new Date().toISOString(),
    );
  repo.run("UPDATE artworks SET status='published' WHERE id=?", id);
}
