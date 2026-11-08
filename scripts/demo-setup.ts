import './demo-accounts.ts';
import { backup } from 'node:sqlite';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createWalletClient, formatEther, getAddress, http, parseEther } from 'viem';
import { createSiweMessage } from 'viem/siwe';
import { localChain } from '../shared/blockchain.ts';
import { demoProfiles } from '../shared/demo.ts';
import { openDatabase } from '../server/database.ts';
import { Repository } from '../server/repository.ts';
import { LocalBlockchain } from '../server/blockchain.ts';
import { trackWallet } from '../server/accounting-records.ts';
import { syncAccountingBalances } from '../server/accounting-balances.ts';
import { prepareDemoProject } from './demo-project.ts';

const directory = resolve(process.env.ARTGUARD_DATA_DIR || 'data');
const db = openDatabase(directory),
  repo = new Repository(db),
  chain = new LocalBlockchain(directory);
try {
  const deployment = await chain.requireReady();
  const wallet = createWalletClient({
    chain: localChain,
    transport: http(chain.rpcUrl, { retryCount: 0 }),
  });
  const addresses = await wallet.getAddresses();
  if (addresses.length < demoProfiles.length + 1)
    throw new Error('Start an Anvil node with at least six unlocked test accounts.');
  const prepared = demoProfiles.map((profile, index) => {
    const id = repo.one<{ value: string }>(
      'SELECT value FROM platform_meta WHERE key=?',
      'demo_account:' + profile.key,
    )?.value;
    if (!id) throw new Error('Create the demo accounts first.');
    const address = getAddress(addresses[index + 1]);
    const current = repo.wallet(id);
    const other = repo.one<{ user_id: string }>(
      'SELECT user_id FROM wallets WHERE address=? COLLATE NOCASE',
      address,
    );
    if (
      (current && current.address.toLowerCase() !== address.toLowerCase()) ||
      (other && other.user_id !== id)
    )
      throw new Error(
        `The ${profile.key} wallet was changed or is in use. Existing wallets have been kept.`,
      );
    return { ...profile, id, address };
  });
  await mkdir(resolve('artifacts'), { recursive: true });
  await backup(db, resolve('artifacts', `artguard-before-demo-wallets-${Date.now()}.sqlite`));
  for (const p of prepared) {
    // Prove control of the unlocked node account before saving its association.
    const nonce = randomBytes(16).toString('hex');
    const message = createSiweMessage({
      address: p.address,
      chainId: 31337,
      domain: 'localhost',
      uri: 'http://localhost/',
      version: '1',
      nonce,
      issuedAt: new Date(),
      statement: 'Provision this local ArtGuard demo wallet.',
    });
    const signature = await wallet.signMessage({ account: p.address, message });
    if (
      !(await chain.client.verifySiweMessage({
        address: p.address,
        message,
        signature,
        domain: 'localhost',
        nonce,
      }))
    )
      throw new Error('Demo wallet ownership verification failed.');
    if ((await chain.client.getBalance({ address: p.address })) < parseEther('10'))
      await chain.fund(p.address, parseEther('10'));
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const p of prepared) {
      repo.run(
        'INSERT OR IGNORE INTO wallets VALUES(?,?,?)',
        p.id,
        p.address,
        new Date().toISOString(),
      );
      trackWallet(repo, p.id);
      repo.run(
        'INSERT INTO platform_meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
        'demo_wallet:' + p.key,
        p.address,
      );
    }
    repo.run(
      'INSERT INTO platform_meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      'demo_chain_instance',
      deployment.instanceId,
    );
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  await prepareDemoProject(directory);
  await syncAccountingBalances(repo, chain);
  console.table(
    await Promise.all(
      prepared.map(async (p) => ({
        role: p.key,
        email: p.email,
        wallet: p.address,
        testETH: formatEther(await chain.client.getBalance({ address: p.address })),
      })),
    ),
  );
  console.log('Demo studio: http://localhost:3000/#/demo');
  console.log(
    'Existing balances are preserved; every demo wallet has at least 10 test ETH. No real funds are used; private keys are never exported.',
  );
} finally {
  db.close();
}
