import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { openDatabase } from '../server/database.ts';
import { Repository } from '../server/repository.ts';
import { backfillAccounting } from '../server/accounting-records.ts';
import { accountingExport } from '../server/accounting.ts';
import { syncAccountingBalances } from '../server/accounting-balances.ts';
import { LocalBlockchain } from '../server/blockchain.ts';
const directory = resolve(process.env.ARTGUARD_DATA_DIR || 'data'),
  db = openDatabase(directory),
  repo = new Repository(db);
try {
  backfillAccounting(repo);
  if (process.argv.includes('--sync'))
    await syncAccountingBalances(repo, new LocalBlockchain(directory));
  const data = accountingExport(repo),
    position = process.argv.indexOf('--output');
  if (position >= 0 && (!process.argv[position + 1] || process.argv[position + 1].startsWith('--')))
    throw new Error('Provide a new file path after --output.');
  const file = resolve(
    position >= 0
      ? process.argv[position + 1]
      : 'artifacts/accounting-export-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json',
  );
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
  console.log(`Accounting export saved: ${file}`);
  console.log(
    `${data.counts.users} users; ${data.counts.products} products; ${data.counts.sales} license records. Amounts are separated by currency.`,
  );
} finally {
  db.close();
}
