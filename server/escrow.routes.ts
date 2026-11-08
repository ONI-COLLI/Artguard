import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createWalletClient, http } from 'viem';
import { localChain } from '../shared/blockchain.js';
import { escrowAbi } from '../shared/escrow.js';
import type { Repository } from './repository.js';
import type { LocalBlockchain } from './blockchain.js';
import { requireUser } from './auth.js';
import { requireVerified } from './security.js';
import { HttpError } from './errors.js';
import { protectedPreview } from './previews.js';
import { escrowRow, syncEscrow, serializeEscrow, type EscrowRow } from './escrow-records.js';
async function checkedFile(repo: Repository, uploads: string, row: EscrowRow) {
  const artwork = repo.artwork(row.artwork_id);
  if (!artwork?.file_name)
    throw new HttpError(
      409,
      'The original file is unavailable. Ask the seller for a refund or open a dispute.',
    );
  let bytes: Buffer;
  try {
    bytes = await readFile(join(uploads, artwork.file_name));
  } catch {
    throw new HttpError(409, 'The original file is unavailable.');
  }
  if ('0x' + createHash('sha256').update(bytes).digest('hex') !== row.file_hash)
    throw new HttpError(409, 'The delivered file does not match the registered fingerprint.');
  return { artwork, bytes };
}
export function escrowRoutes(repo: Repository, chain: LocalBlockchain, uploads: string) {
  const r = Router(),
    limit = rateLimit({ windowMs: 60000, limit: 90, legacyHeaders: false });
  function authorized(req: Parameters<typeof requireUser>[0], id: string) {
    const user = requireVerified(repo, requireUser(req)),
      row = escrowRow(repo, id);
    if (row.buyer_id !== user.id && row.seller_id !== user.id && !repo.isManager(user.id))
      throw new HttpError(404, 'Escrow order not found.');
    return { user, row };
  }
  r.get('/escrow/orders', limit, async (req, res) => {
    const user = requireVerified(repo, requireUser(req));
    const manager = req.query.scope === 'manager';
    if (manager && !repo.isManager(user.id)) throw new HttpError(403, 'Manager access required.');
    const rows = repo.all<{ quote_id: string }>(
      "SELECT e.quote_id FROM escrow_records e JOIN chain_checkout_items i ON i.quote_id=e.quote_id JOIN chain_checkouts c ON c.id=i.checkout_id WHERE (?=1 OR c.buyer_id=? OR i.seller_id=?) ORDER BY (e.state IN ('released','refunded')),c.created_at DESC LIMIT 50",
      manager ? 1 : 0,
      user.id,
      user.id,
    );
    const orders = await Promise.all(
      rows.map(async ({ quote_id }) => {
        const original = escrowRow(repo, quote_id);
        try {
          const { row, chainTime } = await syncEscrow(repo, chain, original);
          return await serializeEscrow(repo, chain, row, user.id, chainTime);
        } catch (error) {
          return {
            id: quote_id,
            title: original.title,
            state: original.state,
            error: error instanceof Error ? error.message : 'Live verification unavailable',
          };
        }
      }),
    );
    res.json({ orders, limit: 50 });
  });
  r.post('/escrow/:id/sync', limit, async (req, res) => {
    const { user, row: before } = authorized(req, String(req.params.id));
    const { row, chainTime } = await syncEscrow(repo, chain, before);
    res.json({ order: await serializeEscrow(repo, chain, row, user.id, chainTime) });
  });
  r.post('/escrow/:id/delivery-check', limit, async (req, res) => {
    const { user, row } = authorized(req, String(req.params.id));
    if (row.seller_id !== user.id)
      throw new HttpError(403, 'Only the seller can confirm delivery.');
    await checkedFile(repo, uploads, row);
    res.json({ verified: true });
  });
  r.get('/escrow/:id/preview', async (req, res) => {
    const { user, row: before } = authorized(req, String(req.params.id));
    if (before.buyer_id !== user.id) throw new HttpError(403, 'This preview is for the buyer.');
    const { row } = await syncEscrow(repo, chain, before);
    if (!['delivered', 'disputed', 'released'].includes(row.state))
      throw new HttpError(403, 'The seller has not delivered this order or it was refunded.');
    const { artwork, bytes } = await checkedFile(repo, uploads, row);
    res
      .type('image/webp')
      .attachment('escrow-review-' + row.quote_id.slice(2, 12) + '.' + 'webp')
      .set('X-ArtGuard-Preview', 'watermarked; original available after release')
      .send(await protectedPreview(bytes));
  });
  r.post('/escrow/:id/resolve', limit, async (req, res) => {
    const { user, row: before } = authorized(req, String(req.params.id));
    if (!repo.isManager(user.id))
      throw new HttpError(403, 'Only a verified manager can resolve a dispute.');
    const { refund, reason } = z
      .object({ refund: z.boolean(), reason: z.string().trim().min(10).max(1000) })
      .parse(req.body);
    const { row, chainTime } = await syncEscrow(repo, chain, before);
    if (row.state !== 'disputed') throw new HttpError(409, 'This order has no unresolved dispute.');
    if (chainTime >= row.dispute_deadline)
      throw new HttpError(409, 'The dispute deadline passed. A full refund can now be claimed.');
    if (!refund) await checkedFile(repo, uploads, row);
    const market = await chain.requireMarketplace(row.contract_address);
    const wallet = createWalletClient({ chain: localChain, transport: http(chain.rpcUrl) });
    const arbiter = await chain.client.readContract({
      address: market.address,
      abi: escrowAbi,
      functionName: 'arbiter',
    });
    const decisionId = randomUUID();
    repo.run(
      'INSERT INTO escrow_decisions VALUES(?,?,?,?,?,?,?)',
      decisionId,
      row.quote_id,
      user.id,
      refund ? 1 : 0,
      reason,
      null,
      new Date().toISOString(),
    );
    const hash = await wallet.writeContract({
      account: arbiter,
      address: market.address,
      abi: escrowAbi,
      functionName: 'resolveDispute',
      args: [row.quote_id, refund],
    });
    repo.run('UPDATE escrow_decisions SET tx_hash=? WHERE id=?', hash, decisionId);
    const receipt = await chain.client.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success')
      throw new HttpError(
        422,
        'The arbitration transaction reverted. Refresh the order before trying again.',
      );
    const result = await syncEscrow(repo, chain, row);
    res.json({
      transactionHash: hash,
      order: await serializeEscrow(repo, chain, result.row, user.id, result.chainTime),
    });
  });
  return r;
}
