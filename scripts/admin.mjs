import { DatabaseSync } from 'node:sqlite';
import { resolve, join } from 'node:path';
const position = process.argv.indexOf('--email'),
  email = position >= 0 ? process.argv[position + 1] : null;
if (!email || email.startsWith('--'))
  throw new Error('Usage: npm run admin -- --email you@example.com [--revoke]');
const db = new DatabaseSync(
  join(resolve(process.env.ARTGUARD_DATA_DIR || 'data'), 'artguard.sqlite'),
);
try {
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  const user = db
    .prepare('SELECT id,password_hash FROM users WHERE email=? COLLATE NOCASE')
    .get(email);
  if (!user || user.password_hash === 'disabled')
    throw new Error(
      'Create a regular account in ArtGuard first. Sample accounts cannot be moderators.',
    );
  if (process.argv.includes('--revoke'))
    db.prepare('DELETE FROM admin_accounts WHERE user_id=?').run(user.id);
  else
    db.prepare('INSERT OR IGNORE INTO admin_accounts VALUES(?,?)').run(
      user.id,
      new Date().toISOString(),
    );
  console.log(
    process.argv.includes('--revoke')
      ? 'Technical administrator and moderation access removed.'
      : 'Technical administrator access granted. Verify the account email, then open /#/admin/technical. Manager reporting is a separate permission.',
  );
} finally {
  db.close();
}
