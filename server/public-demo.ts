import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { createWalletClient, http } from 'viem';
import { createSiweMessage } from 'viem/siwe';
import { randomBytes } from 'node:crypto';
import { localChain } from '../shared/blockchain.js';
import type { Repository } from './repository.js';
import type { LocalBlockchain } from './blockchain.js';
import { requireUser } from './auth.js';
import { requireVerified } from './security.js';
import { publicDemo } from './hosting.js';
import { HttpError } from './errors.js';
import { trackWallet } from './accounting-records.js';
export function sharedDemoAccount(repo: Repository, id: string) {
  return ['creator', 'buyer', 'coauthor'].some(
    (key) =>
      repo.one<{ value: string }>(
        'SELECT value FROM platform_meta WHERE key=?',
        'demo_account:' + key,
      )?.value === id,
  );
}
export function publicDemoRoutes(repo: Repository, chain: LocalBlockchain) {
  const r = Router();
  r.get('/site-info', (_req, res) =>
    res.json({
      publicDemo: publicDemo(),
      sourceAvailable: !!process.env.ARTGUARD_SOURCE_MANIFEST,
      mailMode: 'account-demo-inbox',
      rpcPath: '/rpc',
    }),
  );
  r.get('/auth/demo-mail', (req, res) => {
    if (!publicDemo()) throw new HttpError(404, 'Demo mailbox is not enabled.');
    const user = requireUser(req);
    const messages = repo.all<{ id: string; subject: string; body: string; created_at: string }>(
      'SELECT id,subject,body,created_at FROM local_mail WHERE email=? ORDER BY created_at DESC LIMIT 10',
      user.email,
    );
    res.json({
      messages: messages.map((m) => ({ ...m, links: m.body.match(/https?:\/\/[^\s]+/g) || [] })),
      notice:
        'Private demonstration inbox for this signed-in account. No external email was sent; this does not prove email ownership.',
    });
  });
  r.post(
    '/demo/wallet/provision',
    rateLimit({ windowMs: 60000, limit: 8, legacyHeaders: false }),
    async (req, res) => {
      if (!publicDemo()) throw new HttpError(404, 'Hosted test wallets are not enabled.');
      const user = requireVerified(repo, requireUser(req));
      if (repo.wallet(user.id))
        throw new HttpError(409, 'A wallet is already linked to this account.');
      await chain.requireReady();
      const wallet = createWalletClient({ chain: localChain, transport: http(chain.rpcUrl) }),
        addresses = await wallet.getAddresses();
      // Index zero is always the service signer/treasury. The first five belong to prepared personas.
      const reserved = repo.one<{ value: string }>(
        'SELECT value FROM platform_meta WHERE key=?',
        'public_wallet:' + user.id,
      )?.value;
      const address = addresses
        .slice(6)
        .find(
          (a) =>
            !repo.one('SELECT 1 FROM wallets WHERE address=? COLLATE NOCASE', a) &&
            (a.toLowerCase() === reserved?.toLowerCase() ||
              !repo.one(
                'SELECT 1 FROM platform_meta WHERE key LIKE ? AND value=? COLLATE NOCASE',
                'public_wallet:%',
                a,
              )),
        );
      if (!address)
        throw new HttpError(
          503,
          'All hosted test wallets are allocated. Use a browser wallet or ask the operator to expand the test node.',
        );
      const message = createSiweMessage({
        address,
        chainId: 31337,
        domain: 'localhost',
        uri: 'http://localhost/',
        version: '1',
        nonce: randomBytes(16).toString('hex'),
        issuedAt: new Date(),
        statement: 'Allocate this hosted test wallet to the signed-in ArtGuard demo account.',
      });
      const signature = await wallet.signMessage({ account: address, message });
      if (
        !(await chain.client.verifySiweMessage({
          address,
          message,
          signature,
          domain: 'localhost',
        }))
      )
        throw new HttpError(502, 'Test wallet ownership verification failed.');
      repo.db.exec('BEGIN IMMEDIATE');
      try {
        if (
          repo.wallet(user.id) ||
          repo.one('SELECT 1 FROM wallets WHERE address=? COLLATE NOCASE', address)
        )
          throw new HttpError(409, 'Wallet allocation changed. Retry once.');
        repo.run('INSERT INTO wallets VALUES(?,?,?)', user.id, address, new Date().toISOString());
        repo.run(
          'INSERT INTO platform_meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
          'public_wallet:' + user.id,
          address,
        );
        trackWallet(repo, user.id);
        repo.db.exec('COMMIT');
      } catch (error) {
        repo.db.exec('ROLLBACK');
        throw error;
      }
      res.status(201).json({ ...repo.snapshot(user), publicDemo: true });
    },
  );
  return r;
}
