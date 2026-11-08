import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  parseTransaction,
  recoverTransactionAddress,
  type Hex,
  type TransactionSerialized,
} from 'viem';
import { safeRpc } from './blockchain.routes.js';
import type { Repository } from './repository.js';
import type { LocalBlockchain } from './blockchain.js';
import { publicOrigin } from './hosting.js';
import { HttpError } from './errors.js';
export function publicRpcRoutes(repo: Repository, chain: LocalBlockchain) {
  const r = Router();
  r.use('/rpc', (req, res, next) => {
    if (!publicOrigin()) throw new HttpError(404, 'Hosted RPC is not enabled.');
    res.set({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });
  r.post(
    '/rpc',
    rateLimit({ windowMs: 60000, limit: 300, legacyHeaders: false }),
    async (req, res) => {
      const calls = Array.isArray(req.body) ? req.body : [req.body];
      if (
        !calls.length ||
        calls.length > 20 ||
        calls.some((c) => !c || (!safeRpc.has(c.method) && c.method !== 'eth_sendRawTransaction'))
      )
        throw new HttpError(
          403,
          'Only read calls and signed marketplace transactions are available.',
        );
      for (const call of calls) {
        if (call.method !== 'eth_sendRawTransaction') continue;
        const raw = call.params?.[0];
        if (typeof raw !== 'string' || !/^0x[\da-f]+$/i.test(raw) || raw.length > 64000)
          throw new HttpError(400, 'Invalid signed transaction.');
        let tx: ReturnType<typeof parseTransaction>, sender: Hex;
        try {
          tx = parseTransaction(raw as Hex);
          sender = await recoverTransactionAddress({
            serializedTransaction: raw as TransactionSerialized,
          });
        } catch {
          throw new HttpError(400, 'Invalid signed transaction.');
        }
        if (tx.chainId !== 31337 || !tx.to || !tx.data)
          throw new HttpError(
            403,
            'Only transactions to the ArtGuard test contracts are supported.',
          );
        const linked = repo.one<{ user_id: string }>(
          'SELECT user_id FROM wallets WHERE address=? COLLATE NOCASE',
          sender,
        );
        if (!linked || !repo.emailVerified(linked.user_id))
          throw new HttpError(403, 'Link this wallet to a verified demo account first.');
        const registry = await chain.requireReady(),
          market = await chain.marketplaceStatus();
        const addresses = [registry.address, ...(market.contracts || []).map((c) => c.address)];
        try {
          addresses.push((await chain.subscriptionDeployment()).address);
        } catch {}
        try {
          addresses.push((await chain.promotionDeployment()).address);
        } catch {}
        if (!addresses.some((a) => a.toLowerCase() === tx.to!.toLowerCase()))
          throw new HttpError(403, 'The transaction must target an ArtGuard test contract.');
      }
      const response = await fetch(chain.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body),
        signal: AbortSignal.timeout(15000),
      });
      res.json(await response.json());
    },
  );
  return r;
}
