import { randomUUID, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolve } from 'node:path';
import { openDatabase } from '../server/database.ts';
import { Repository } from '../server/repository.ts';
import { hashPassword, verifyPassword } from '../server/auth.ts';
import { acceptLegal } from '../server/privacy.ts';

// Explicit, local-only fixtures. Application startup never creates these logins.
const accounts = [
  {
    key: 'admin',
    name: 'Demo Administrator',
    email: 'admin@artguard.test',
    password: 'DemoAdmin!2026',
    role: 'Creator and buyer',
    admin: true,
  },
  {
    key: 'creator',
    name: 'Demo Creator',
    email: 'creator@artguard.test',
    password: 'DemoCreator!2026',
    role: 'Creator',
    admin: false,
  },
  {
    key: 'buyer',
    name: 'Demo Buyer',
    email: 'buyer@artguard.test',
    password: 'DemoBuyer!2026',
    role: 'Buyer',
    admin: false,
  },
  {
    key: 'coauthor',
    name: 'Demo Coauthor',
    email: 'coauthor@artguard.test',
    password: 'DemoCoauthor!2026',
    role: 'Creator',
    admin: false,
  },
  {
    key: 'manager',
    name: 'Demo Manager',
    email: 'manager@artguard.test',
    password: 'DemoManager!2026',
    role: 'Creator and buyer',
    admin: false,
  },
];

const db = openDatabase(resolve(process.env.ARTGUARD_DATA_DIR || 'data'));
const repo = new Repository(db);
try {
  const prepared = [];
  for (const account of accounts) {
    const marker = 'demo_account:' + account.key;
    const saved = repo.one<{ value: string }>(
      'SELECT value FROM platform_meta WHERE key=?',
      marker,
    );
    const existing = repo.one<{ id: string; email: string; password_hash: string }>(
      'SELECT id,email,password_hash FROM users WHERE email=?',
      account.email,
    );
    if (saved && (!existing || existing.id !== saved.value))
      throw new Error(
        `The ${account.key} demo account was edited. Existing accounts have been kept.`,
      );
    if (existing && !saved)
      throw new Error(
        `${account.email} already belongs to another account. No password or permissions were changed.`,
      );
    const privatePassword =
      process.env.ARTGUARD_PUBLIC_DEMO === 'true' &&
      !existing &&
      (account.admin || account.key === 'manager')
        ? randomBytes(24).toString('base64url')
        : null;
    prepared.push({
      privatePassword,
      ...account,
      marker,
      id: existing?.id || randomUUID(),
      existing: !!existing,
      hash: existing?.password_hash || (await hashPassword(privatePassword || account.password)),
    });
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    for (const account of prepared) {
      if (account.existing) continue;
      const time = new Date().toISOString();
      repo.run(
        'INSERT INTO users(id,name,email,password_hash,role,created_at) VALUES(?,?,?,?,?,?)',
        account.id,
        account.name,
        account.email,
        account.hash,
        account.role,
        time,
      );
      repo.run('INSERT INTO email_verifications VALUES(?,?,?)', account.id, account.email, time);
      repo.run('INSERT INTO platform_meta VALUES(?,?)', account.marker, account.id);
      if (account.admin) repo.run('INSERT INTO admin_accounts VALUES(?,?)', account.id, time);
      if (account.key === 'manager')
        repo.run('INSERT INTO manager_accounts VALUES(?,?)', account.id, time);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  const privateAccounts = prepared
    .filter((a) => a.privatePassword)
    .map((a) => ({ email: a.email, password: a.privatePassword }));
  if (privateAccounts.length) {
    const file = join(
      resolve(process.env.ARTGUARD_DATA_DIR || 'data'),
      'staff-credentials.private.json',
    );
    const existing = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
    writeFileSync(file, JSON.stringify([...existing, ...privateAccounts], null, 2), {
      mode: 0o600,
    });
  }
  const result = [];
  for (const account of prepared) {
    acceptLegal(repo, account.id, 'fictional-demo-fixture');
    repo.run('INSERT OR IGNORE INTO public_profiles VALUES(?,?)', account.id, account.name);
  }
  for (const account of prepared)
    result.push({
      email: account.email,
      password: (await verifyPassword(account.password, account.hash))
        ? account.password
        : '(custom password kept)',
      access: repo.isAdmin(account.id)
        ? 'Technical administrator + moderation'
        : repo.isManager(account.id)
          ? 'Manager: turnover and reporting'
          : 'Buy and publish projects',
      status: account.existing ? 'Existing account kept' : 'Created; email verified; Free plan',
    });
  console.table(result);
  console.log(
    'Demo logins ready. Run npm run demo:setup to provision or refresh their local wallets.',
  );
} finally {
  db.close();
}
