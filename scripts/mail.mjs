import { DatabaseSync } from 'node:sqlite';
import { resolve, join } from 'node:path';
const position = process.argv.indexOf('--email'),
  email = position >= 0 ? process.argv[position + 1] : null;
if (!email || email.startsWith('--'))
  throw new Error('Usage: npm run mail -- --email you@example.com');
const db = new DatabaseSync(
  join(resolve(process.env.ARTGUARD_DATA_DIR || 'data'), 'artguard.sqlite'),
  { readOnly: true },
);
try {
  const messages = db
    .prepare(
      'SELECT subject,body,created_at FROM local_mail WHERE email=? COLLATE NOCASE ORDER BY created_at DESC LIMIT 10',
    )
    .all(email);
  if (!messages.length) console.log('No local messages for this address.');
  for (const message of messages)
    console.log(`\n${message.created_at} — ${message.subject}\n${message.body}\n`);
} finally {
  db.close();
}
