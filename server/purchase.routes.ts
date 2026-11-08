import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { purchaseSchema, licenseTypes, planRules } from '../shared/schemas.js';
import { creatorCredit } from '../shared/revenue.js';
import type { Repository, PurchaseRow } from './repository.js';
import { requireUser } from './auth.js';
import { HttpError } from './errors.js';
import { paymentFor, type CheckoutItemRow } from './chain-checkouts.js';
import { testEth } from '../shared/marketplace.js';
import { requireVerified } from './security.js';
import { requireApprovedShares } from './consents.js';
import { publicDemo } from './hosting.js';
import { recordPurchase } from './accounting-records.js';
export function purchaseRoutes(repo: Repository) {
  const r = Router();
  r.post('/purchases', (req, res) => {
    const u = requireVerified(repo, requireUser(req)),
      { items } = purchaseSchema.parse(req.body);
    if (items.length > 1 && u.plan !== 'business')
      throw new HttpError(403, 'Bulk licensing requires Business.');
    const packageId = items.length > 1 ? randomUUID() : null;
    repo.db.exec('BEGIN IMMEDIATE');
    try {
      for (const item of items) {
        if (
          repo.one(
            "SELECT 1 FROM escrow_records e JOIN chain_checkout_items i ON i.quote_id=e.quote_id JOIN chain_checkouts c ON c.id=i.checkout_id WHERE c.buyer_id=? AND i.artwork_id=? AND i.license=? AND e.state IN ('funded','delivered','disputed')",
            u.id,
            item.artworkId,
            item.license,
          )
        )
          throw new HttpError(
            409,
            'This license has an active escrow order. Complete or refund it in Orders & escrow.',
          );
        if (
          repo.one(
            "SELECT 1 FROM chain_checkout_items i JOIN chain_checkouts c ON c.id=i.checkout_id WHERE c.buyer_id=? AND i.artwork_id=? AND i.license=? AND (c.status='pending' OR (c.status='prepared' AND c.expires_at>=?))",
            u.id,
            item.artworkId,
            item.license,
            Math.floor(Date.now() / 1000),
          )
        )
          throw new HttpError(
            409,
            'A blockchain checkout is open for this license. Resume it in My licenses or wait for its quote to expire.',
          );
        const a = repo.artwork(item.artworkId);
        if (
          !a ||
          a.status !== 'published' ||
          repo.hidden(a.id) ||
          !JSON.parse(a.licenses).includes(item.license)
        )
          throw new HttpError(400, 'This artwork or license is not available.');
        requireApprovedShares(repo, a.id);
        if (publicDemo() && a.file_name)
          throw new HttpError(
            409,
            'Uploaded originals on the shared public server require blockchain escrow checkout. Local simulated orders are limited to sample previews.',
          );
        if (repo.licenseDuration(a.id) > 0)
          throw new HttpError(
            409,
            'Timed licenses require blockchain checkout so that the contract records their expiration.',
          );
        if (a.owner_id === u.id) throw new HttpError(400, 'You cannot purchase your own artwork.');
        if (
          repo.one(
            'SELECT 1 FROM purchases WHERE buyer_id=? AND artwork_id=? AND license=?',
            u.id,
            a.id,
            item.license,
          )
        )
          throw new HttpError(409, 'You already own one of these licenses.');
        const seller = repo.user(a.owner_id),
          amount = Math.round(a.price * licenseTypes[item.license].factor),
          commission = Math.round((amount * planRules[seller.plan].commission) / 100),
          net = amount - commission,
          recipients = repo.artworkRecipients(a.id);
        let assigned = 0;
        const allocations = recipients.map((v) => {
          const share = Math.floor((net * v.percent) / 100);
          assigned += share;
          return { ...v, amount: share / 100 };
        });
        allocations.unshift({
          name: seller.name,
          percent: 100 - recipients.reduce((s, v) => s + v.percent, 0),
          amount: (net - assigned) / 100,
        });
        const purchaseId = randomUUID();
        repo.run(
          'INSERT INTO purchases VALUES(?,?,?,?,?,?,?,?,?)',
          purchaseId,
          u.id,
          a.id,
          item.license,
          amount,
          commission,
          JSON.stringify(allocations),
          packageId,
          new Date().toISOString(),
        );
        recordPurchase(repo, purchaseId);
      }
      repo.db.exec('COMMIT');
    } catch (error) {
      repo.db.exec('ROLLBACK');
      throw error;
    }
    res.status(201).json(repo.snapshot(u));
  });
  r.get('/licenses/:id/document', (req, res) => {
    const u = requireUser(req),
      p = repo.one<PurchaseRow>(
        'SELECT * FROM purchases WHERE id=? AND buyer_id=?',
        String(req.params.id),
        u.id,
      );
    if (!p) throw new HttpError(404, 'License not found.');
    const a = repo.artwork(p.artwork_id)!;
    const payment = paymentFor(repo, p.id);
    const snapshot = payment
      ? repo.one<CheckoutItemRow>(
          'SELECT * FROM chain_checkout_items WHERE quote_id=?',
          payment.quoteId,
        )
      : null;
    const validity = repo.validity(p.id);
    const validityRecord = `Valid from: ${validity.validFrom || p.created_at}\nValid until: ${validity.validUntil || 'Perpetual'}\nStatus: ${validity.expired ? 'Expired' : 'Active'}\n`;
    const paymentRecord =
      validityRecord +
      (payment
        ? `Payment: ArtGuard Local blockchain (test network)\nPaid: ${testEth(payment.amountWei)}\nBuyer wallet: ${payment.buyerWallet}\nChain ID: ${payment.chainId}\nMarketplace: ${payment.contractAddress}\nTransaction: ${payment.transactionHash}\n${payment.escrow ? `Escrow deposit transaction: ${payment.escrow.fundingTransactionHash}\nEscrow release transaction: ${payment.escrow.releaseTransactionHash}\n` : ''}Quote / on-chain license ID: ${payment.quoteId}\nTerms fingerprint: ${payment.termsHash}\nRegistered purchase terms: ${snapshot?.terms_json}\n\nTest ETH has no monetary value. No real payment was processed.\n`
        : 'This is a local development record. No real payment was processed. No blockchain transaction was made.\n');
    res
      .type('text/plain')
      .attachment(`artguard-${p.id}.txt`)
      .send(
        `ARTGUARD — ${payment ? 'BLOCKCHAIN TEST' : 'LOCAL'} LICENSE RECORD\n\nID: ${p.id}\nCreated: ${p.created_at}\nArtwork: ${a.title}\nCreator: ${a.author}\nLicense holder: ${u.name} (${u.email})\nLicense: ${licenseTypes[p.license].title}\n${payment ? '' : `Terms: ${licenseTypes[p.license].description}\n`}Catalog reference amount: $${(p.amount / 100).toFixed(2)} USD\nSHA-256 / sample ID: ${a.hash}\n\n${paymentRecord}`,
      );
  });
  r.get('/sales/export', (req, res) => {
    const u = requireUser(req);
    if (u.plan === 'free') throw new HttpError(403, 'CSV export requires Premium or Business.');
    const cell = (v: unknown) =>
      '"' +
      String(v)
        .replace(/^[=+@\-\t\r]/, "'$&")
        .replaceAll('"', '""') +
      '"';
    const csv = [
      [
        'ID',
        'Artwork',
        'Buyer',
        'License',
        'Date',
        'Currency',
        'Gross',
        'Fee',
        'Net',
        'Transaction',
        'Revenue distribution',
      ],
      ...repo
        .snapshot(u)
        .sales.map((s) => [
          s.id,
          s.title,
          s.buyer,
          s.license,
          s.date,
          s.payment ? 'test ETH' : 'USD (local record)',
          s.payment ? testEth(s.payment.amountWei) : s.amount,
          s.payment ? testEth(s.payment.feeWei) : s.commission,
          s.payment ? testEth(creatorCredit(s.payment)) : s.net,
          s.payment?.transactionHash || '',
          s.payment?.allocations
            ?.map((a) => `${a.name}: ${a.wallet} / ${a.percent}% / ${testEth(a.amountWei)}`)
            .join('; ') || '',
        ]),
    ]
      .map((row) => row.map(cell).join(','))
      .join('\r\n');
    res
      .type('text/csv')
      .attachment('artguard-sales.csv')
      .send('\uFEFF' + csv);
  });
  return r;
}
