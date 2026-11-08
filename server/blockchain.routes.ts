import { Router } from 'express';
import { trackWallet } from './accounting-records.js';
import { randomBytes, randomUUID } from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import {
  getAddress,
  parseEventLogs,
  TransactionReceiptNotFoundError,
  type Address,
  type Hex,
} from 'viem';
import { createSiweMessage } from 'viem/siwe';
import {
  registryAbi,
  termsSnapshot,
  termsFingerprint,
  type RegistrationState,
} from '../shared/blockchain.js';
import { serializeRegistration, type RegistrationRow } from './chain-records.js';
import { requireUser, cookieToken, tokenHash } from './auth.js';
import type { Repository } from './repository.js';
import { LocalBlockchain } from './blockchain.js';
import { HttpError } from './errors.js';
import { publicDemo } from './hosting.js';
import { sharedDemoAccount } from './public-demo.js';

const hashSchema = z.string().regex(/^0x[\da-fA-F]{64}$/, 'Enter a valid transaction hash.');
const walletSchema = z
  .string()
  .regex(/^0x[\da-fA-F]{40}$/, 'Enter a valid wallet address.')
  .transform((v) => getAddress(v));
export const safeRpc = new Set([
  'eth_chainId',
  'net_version',
  'eth_blockNumber',
  'eth_call',
  'eth_getCode',
  'eth_getBalance',
  'eth_getTransactionCount',
  'eth_estimateGas',
  'eth_gasPrice',
  'eth_maxPriorityFeePerGas',
  'eth_feeHistory',
  'eth_getTransactionReceipt',
  'eth_getTransactionByHash',
  'eth_getBlockByNumber',
]);

export function blockchainRoutes(repo: Repository, chain: LocalBlockchain) {
  const r = Router();
  const limit = rateLimit({
    windowMs: 60000,
    limit: 60,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many wallet requests. Try again shortly.' },
  });
  r.get('/blockchain/status', async (_req, res) => res.json(await chain.status()));
  // Only read/simulation RPC methods are exposed; unlocked node accounts cannot be used through this proxy.
  r.post(
    '/blockchain/rpc',
    rateLimit({ windowMs: 60000, limit: 300, legacyHeaders: false }),
    async (req, res) => {
      const calls = Array.isArray(req.body) ? req.body : [req.body];
      if (!calls.length || calls.length > 20 || calls.some((c) => !c || !safeRpc.has(c.method)))
        throw new HttpError(403, 'This RPC method is not available.');
      try {
        const response = await fetch(chain.rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(req.body),
          signal: AbortSignal.timeout(5000),
        });
        res.json(await response.json());
      } catch {
        throw new HttpError(503, 'Local blockchain is offline. Start npm run chain.');
      }
    },
  );
  r.post('/wallet/challenge', limit, (req, res) => {
    const user = requireUser(req),
      { address } = z.object({ address: walletSchema }).parse(req.body);
    const existing = repo.wallet(user.id);
    if (existing && existing.address.toLowerCase() !== address.toLowerCase())
      throw new HttpError(409, 'Unlink your current wallet before linking another one.');
    const nonce = randomBytes(16).toString('hex'),
      origin = req.headers.origin || process.env.PUBLIC_ORIGIN || `http://${req.headers.host}`;
    const expiresAt = Date.now() + 5 * 60000;
    const message = createSiweMessage({
      address,
      chainId: 31337,
      domain: new URL(origin).host,
      uri: origin + '/',
      version: '1',
      nonce,
      issuedAt: new Date(),
      expirationTime: new Date(expiresAt),
      requestId: user.id,
      statement: 'Link this wallet to your ArtGuard account. This does not authorize a payment.',
    });
    repo.run(
      'DELETE FROM wallet_challenges WHERE expires_at<? OR (user_id=? AND session_hash=?)',
      Date.now(),
      user.id,
      tokenHash(cookieToken(req)),
    );
    repo.run(
      'INSERT INTO wallet_challenges VALUES(?,?,?,?,?,?)',
      nonce,
      user.id,
      tokenHash(cookieToken(req)),
      address,
      message,
      expiresAt,
    );
    res.json({ nonce, message, expiresAt });
  });
  r.post('/wallet/link', limit, async (req, res) => {
    const user = requireUser(req),
      v = z
        .object({
          nonce: z.string().regex(/^[\da-f]{32}$/),
          signature: z
            .string()
            .regex(/^0x[\da-fA-F]+$/)
            .max(8192),
        })
        .parse(req.body);
    const challenge = repo.one<{ address: Address; message: string }>(
      'SELECT address,message FROM wallet_challenges WHERE nonce=? AND user_id=? AND session_hash=? AND expires_at>?',
      v.nonce,
      user.id,
      tokenHash(cookieToken(req)),
      Date.now(),
    );
    if (!challenge)
      throw new HttpError(
        400,
        'Wallet request expired or already used. Please sign a new message.',
      );
    // Consume before asynchronous signature verification to prevent concurrent replay.
    repo.run('DELETE FROM wallet_challenges WHERE nonce=?', v.nonce);
    let valid = false;
    try {
      valid = await chain.client.verifySiweMessage({
        address: challenge.address,
        message: challenge.message,
        signature: v.signature as Hex,
        domain: new URL(
          req.headers.origin || process.env.PUBLIC_ORIGIN || `http://${req.headers.host}`,
        ).host,
        nonce: v.nonce,
      });
    } catch {}
    if (!valid)
      throw new HttpError(400, 'The wallet signature could not be verified. Please try again.');
    const other = repo.one<{ user_id: string }>(
      'SELECT user_id FROM wallets WHERE address=? COLLATE NOCASE',
      challenge.address,
    );
    if (other && other.user_id !== user.id)
      throw new HttpError(409, 'This wallet is linked to another account.');
    const existing = repo.wallet(user.id);
    if (existing && existing.address.toLowerCase() !== challenge.address.toLowerCase())
      throw new HttpError(409, 'Unlink your current wallet first.');
    repo.run(
      'INSERT OR IGNORE INTO wallets VALUES(?,?,?)',
      user.id,
      challenge.address,
      new Date().toISOString(),
    );
    trackWallet(repo, user.id);
    res.json(repo.snapshot(user));
  });
  r.delete('/wallet', (req, res) => {
    const user = requireUser(req);
    if (publicDemo() && sharedDemoAccount(repo, user.id))
      throw new HttpError(
        403,
        'Shared demo wallets are fixed. Register your own account for an individual wallet.',
      );
    repo.run('DELETE FROM wallets WHERE user_id=?', user.id);
    trackWallet(repo, user.id);
    repo.run('DELETE FROM wallet_challenges WHERE user_id=?', user.id);
    res.json(repo.snapshot(user));
  });
  r.post('/wallet/fund', limit, async (req, res) => {
    const wallet = repo.wallet(requireUser(req).id);
    if (!wallet) throw new HttpError(400, 'Link a wallet first.');
    res.json({ transactionHash: await chain.fund(wallet.address) });
  });
  r.get('/blockchain/artworks/:id', async (req, res) => {
    const artwork = repo.artwork(String(req.params.id));
    if (!repo.canView(artwork, req.user)) throw new HttpError(404, 'Artwork not found.');
    const row = repo.one<RegistrationRow>(
      "SELECT * FROM chain_registrations WHERE artwork_id=? AND status='confirmed' ORDER BY created_at DESC LIMIT 1",
      artwork.id,
    );
    const pending =
      req.user?.id === artwork.owner_id
        ? repo.one<RegistrationRow>(
            "SELECT * FROM chain_registrations WHERE artwork_id=? AND user_id=? AND status='pending' ORDER BY created_at DESC LIMIT 1",
            artwork.id,
            req.user.id,
          )
        : undefined;
    const status = await chain.status();
    let verified = false;
    if (row && status.ready && row.instance_id === status.deployment?.instanceId) {
      try {
        const [owner, terms] = await chain.client.readContract({
          address: row.contract_address,
          abi: registryAbi,
          functionName: 'records',
          args: [row.file_hash],
        });
        verified = owner.toLowerCase() === row.registrant.toLowerCase() && terms === row.terms_hash;
      } catch {}
    }
    const result: RegistrationState = {
      record: row ? serializeRegistration(row) : null,
      pending:
        pending && pending.instance_id === status.deployment?.instanceId
          ? serializeRegistration(pending)
          : null,
      verified,
      termsChanged:
        !!row &&
        row.terms_hash !== termsFingerprint(termsSnapshot(repo.serialize(artwork, req.user))),
      message: !status.ready
        ? status.message
        : row
          ? verified
            ? 'File registration verified on the local blockchain.'
            : 'This record belongs to an earlier local chain. It is not verified on the current node.'
          : 'This file has not been registered on the local blockchain.',
    };
    res.json(result);
  });
  r.post('/blockchain/artworks/:id/prepare', limit, async (req, res) => {
    const user = requireUser(req),
      artwork = repo.artwork(String(req.params.id));
    if (!artwork || artwork.owner_id !== user.id) throw new HttpError(404, 'Artwork not found.');
    if (!artwork.file_name || !/^[\da-f]{64}$/.test(artwork.hash))
      throw new HttpError(400, 'Upload your own artwork to register a file.');
    if (artwork.status !== 'published')
      throw new HttpError(409, 'Publish this artwork before registering it.');
    const wallet = repo.wallet(user.id);
    if (!wallet) throw new HttpError(400, 'Link your wallet in workspace settings first.');
    const deployment = await chain.requireReady();
    const pending = repo.one(
      "SELECT 1 FROM chain_registrations WHERE artwork_id=? AND instance_id=? AND status='pending'",
      artwork.id,
      deployment.instanceId,
    );
    if (pending)
      throw new HttpError(409, 'A transaction is pending. Check its status before trying again.');
    const fileHash = `0x${artwork.hash}` as Hex;
    const [registrant] = await chain.client.readContract({
      address: deployment.address,
      abi: registryAbi,
      functionName: 'records',
      args: [fileHash],
    });
    if (registrant !== '0x0000000000000000000000000000000000000000')
      throw new HttpError(
        409,
        'This file hash is already registered on this blockchain. Recover the original transaction instead of submitting another one.',
      );
    const terms = termsSnapshot(repo.serialize(artwork, user)),
      id = randomUUID();
    // Keep earlier intents: another tab may already be waiting for a wallet signature.
    repo.run(
      "INSERT INTO chain_registrations(id,artwork_id,user_id,chain_id,contract_address,instance_id,registrant,file_hash,terms_hash,terms_json,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,'prepared',?)",
      id,
      artwork.id,
      user.id,
      31337,
      deployment.address,
      deployment.instanceId,
      wallet.address,
      fileHash,
      termsFingerprint(terms),
      terms,
      new Date().toISOString(),
    );
    res.status(201).json({
      registration: serializeRegistration(
        repo.one<RegistrationRow>('SELECT * FROM chain_registrations WHERE id=?', id)!,
      ),
      deployment,
    });
  });
  r.post('/blockchain/registrations/:id/confirm', limit, async (req, res) => {
    const user = requireUser(req),
      { transactionHash } = z.object({ transactionHash: hashSchema }).parse(req.body);
    const row = repo.one<RegistrationRow>(
      'SELECT * FROM chain_registrations WHERE id=? AND user_id=?',
      String(req.params.id),
      user.id,
    );
    if (!row) throw new HttpError(404, 'Registration request not found.');
    if (row.tx_hash && row.tx_hash.toLowerCase() !== transactionHash.toLowerCase())
      throw new HttpError(409, 'This registration already has a different transaction.');
    const deployment = await chain.requireReady();
    if (
      deployment.instanceId !== row.instance_id ||
      deployment.address.toLowerCase() !== row.contract_address.toLowerCase()
    )
      throw new HttpError(409, 'The local chain changed. Start a new registration.');
    if (row.status === 'confirmed') return res.json({ registration: serializeRegistration(row) });
    if (row.status === 'failed')
      throw new HttpError(409, row.error || 'This transaction failed. Start a new registration.');
    repo.run(
      "UPDATE chain_registrations SET tx_hash=?,status='pending' WHERE id=?",
      transactionHash,
      row.id,
    );
    let receipt;
    try {
      receipt = await chain.client.getTransactionReceipt({ hash: transactionHash as Hex });
    } catch (error) {
      if (error instanceof TransactionReceiptNotFoundError)
        return res.status(202).json({
          registration: serializeRegistration(
            repo.one<RegistrationRow>('SELECT * FROM chain_registrations WHERE id=?', row.id)!,
          ),
        });
      throw new HttpError(
        503,
        'Transaction check unavailable. Your transaction hash is saved; retry the check.',
      );
    }
    const events = parseEventLogs({
      abi: registryAbi,
      eventName: 'ArtworkRegistered',
      logs: receipt.logs.filter(
        (l) => l.address.toLowerCase() === row.contract_address.toLowerCase(),
      ),
    });
    const event = events.find(
      (e) =>
        e.args.fileHash === row.file_hash &&
        e.args.termsHash === row.terms_hash &&
        e.args.registrant.toLowerCase() === row.registrant.toLowerCase(),
    );
    if (
      receipt.status !== 'success' ||
      receipt.to?.toLowerCase() !== row.contract_address.toLowerCase() ||
      receipt.from.toLowerCase() !== row.registrant.toLowerCase() ||
      !event
    ) {
      const message =
        receipt.status === 'reverted'
          ? 'The blockchain transaction reverted. Your file remains saved.'
          : 'This transaction does not register this file, wallet, and terms at the expected contract.';
      repo.run(
        "UPDATE chain_registrations SET status='failed',error=? WHERE id=?",
        message,
        row.id,
      );
      throw new HttpError(422, message);
    }
    repo.run(
      "UPDATE chain_registrations SET status='confirmed',block_number=?,registered_at=?,error=NULL WHERE id=?",
      String(receipt.blockNumber),
      new Date(Number(event.args.registeredAt) * 1000).toISOString(),
      row.id,
    );
    res.json({
      registration: serializeRegistration(
        repo.one<RegistrationRow>('SELECT * FROM chain_registrations WHERE id=?', row.id)!,
      ),
    });
  });
  return r;
}
