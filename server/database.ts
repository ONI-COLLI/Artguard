import { migrate } from './migrations.js';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { initialArtworks } from './seed.js';
import { planRules } from '../shared/schemas.js';
export { planRules };

export function openDatabase(directory: string) {
  mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(join(directory, 'artguard.sqlite'));
  migrate(db);
  const userInsert = db.prepare(
    'INSERT OR IGNORE INTO users(id,name,email,password_hash,created_at) VALUES(?,?,?,?,?)',
  );
  const artInsert = db.prepare(
    'INSERT OR IGNORE INTO artworks(id,owner_id,title,description,category,price,licenses,mime,hash,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
  );
  for (const a of initialArtworks) {
    const owner = `sample-${a.author.toLowerCase().replace(/[^a-z]+/g, '-')}`;
    userInsert.run(
      owner,
      a.author,
      `${owner}@example.invalid`,
      'disabled',
      `${a.date}T12:00:00.000Z`,
    );
    artInsert.run(
      a.id,
      owner,
      a.title,
      a.description,
      a.category,
      Math.round(a.price * 100),
      JSON.stringify(a.licenses),
      'image/svg+xml',
      a.hash,
      `${a.date}T12:00:00.000Z`,
    );
  }
  return db;
}
