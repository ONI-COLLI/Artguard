import { confirmEscrowFunding } from './escrow-records.js';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { parseEventLogs, parseEther, TransactionReceiptNotFoundError, type Hex } from 'viem';
import { purchaseSchema, licenseTypes, planRules, recipientsSchema } from '../shared/schemas.js';
import { revenueAllocations } from '../shared/revenue.js';
import { termsSnapshot, termsFingerprint, registryAbi } from '../shared/blockchain.js';
import {
  marketplaceAbi,
  termMarketplaceAbi,
  licenseNumber,
  testWeiPerCent,
  type LicenseQuote,
  type RevenueAllocation,
} from '../shared/marketplace.js';
import type { Repository, PurchaseRow } from './repository.js';
import { LocalBlockchain } from './blockchain.js';
import { requireVerified } from './security.js';
import { requireApprovedShares } from './consents.js';
import { requireUser } from './auth.js';
import { HttpError } from './errors.js';
import { recordPurchase } from './accounting-records.js';
import {
  serializeCheckout,
  paymentFor,
  allocationsFor,
  type CheckoutRow,
  type CheckoutItemRow,
} from './chain-checkouts.js';

export function chainPurchaseRoutes(repo: Repository, chain: LocalBlockchain) {
  const r = Router();
  const limit = rateLimit({
    windowMs: 60000,
    limit: 60,
    legacyHeaders: false,
    message: { error: 'Too many checkout requests. Try again shortly.' },
  });
  const checkout = (id: string, userId: string) => {
    const row = repo.one<CheckoutRow>(
      'SELECT * FROM chain_checkouts WHERE id=? AND buyer_id=?',
      id,
      userId,
    );
    if (!row) throw new HttpError(404, 'Blockchain checkout not found.');
    return row;
  };
  r.get('/blockchain/marketplace', async (_req, res) => res.json(await chain.marketplaceStatus()));
  r.get('/blockchain/proceeds', async (req, res) => {
    const wallet = repo.wallet(requireUser(req).id);
    if (!wallet) throw new HttpError(400, 'Link a wallet to view test earnings.');
    const status = await chain.marketplaceStatus();
    if (!status.ready || !status.deployment) throw new HttpError(503, status.message);
    const balances = await Promise.all(
      (status.contracts || [status.deployment]).map(async (manifest) => {
        const market = await chain.requireMarketplace(manifest.address);
        const amount = await chain.client.readContract({
          address: market.address,
          abi: marketplaceAbi,
          functionName: 'balances',
          args: [wallet.address],
        });
        return {
          amountWei: String(amount),
          contractAddress: market.address,
          version: market.version,
        };
      }),
    );
    const earnings = repo
      .all<CheckoutItemRow & { contract_address: string; tx_hash: string; confirmed_at: string }>(
        "SELECT i.*,c.contract_address,coalesce(e.release_tx,c.tx_hash) tx_hash,coalesce(e.settled_at,c.confirmed_at) confirmed_at FROM chain_checkout_items i JOIN chain_checkouts c ON c.id=i.checkout_id LEFT JOIN escrow_records e ON e.quote_id=i.quote_id WHERE c.status='confirmed' AND c.instance_id=? AND NOT EXISTS(SELECT 1 FROM escrow_records e WHERE e.quote_id=i.quote_id AND e.state<>'released') ORDER BY c.confirmed_at DESC",
        status.deployment.instanceId,
      )
      .flatMap((item) =>
        allocationsFor(repo, item)
          .filter((a) => a.wallet.toLowerCase() === wallet.address.toLowerCase())
          .map((allocation) => ({
            ...allocation,
            quoteId: item.quote_id,
            title: item.title,
            date: item.confirmed_at,
            transactionHash: item.tx_hash,
            contractAddress: item.contract_address,
          })),
      );
    res.json({
      amountWei: String(balances.reduce((sum, b) => sum + BigInt(b.amountWei), 0n)),
      balances,
      earnings,
      wallet: wallet.address,
      contractAddress: status.deployment.address,
      instanceId: status.deployment.instanceId,
    });
  });
  r.get('/blockchain/checkouts', (req, res) => {
    const user = requireUser(req);
    const rows = repo.all<CheckoutRow>(
      "SELECT * FROM chain_checkouts WHERE buyer_id=? AND (status='pending' OR (status='prepared' AND expires_at>=?)) ORDER BY created_at DESC LIMIT 20",
      user.id,
      Math.floor(Date.now() / 1000),
    );
    res.json({ checkouts: rows.map((row) => serializeCheckout(repo, row)) });
  });
  r.get('/blockchain/checkouts/:id', (req, res) =>
    res.json({
      checkout: serializeCheckout(repo, checkout(String(req.params.id), requireUser(req).id)),
    }),
  );
  r.post('/blockchain/checkouts', limit, async (req, res) => {
    const user = requireVerified(repo, requireUser(req)),
      { items } = purchaseSchema.parse(req.body),
      buyer = repo.wallet(user.id);
    if (!buyer)
      throw new HttpError(400, 'Connect and link your wallet before paying with test ETH.');
    if (items.length > 1 && user.plan !== 'business')
      throw new HttpError(403, 'Bulk licensing requires Business.');
    const keys = items.map((i) => `${i.artworkId}:${i.license}`).sort();
    if (new Set(keys).size !== keys.length)
      throw new HttpError(400, 'Each artwork and license can appear only once in a package.');
    let market = await chain.requireMarketplace();
    const status = await chain.marketplaceStatus(),
      term =
        status.contracts?.find((m) => m.version === 4) ||
        status.contracts?.find((m) => m.version === 3);
    if (term) market = await chain.requireMarketplace(term.address);
    else if (items.some((item) => repo.licenseDuration(item.artworkId) > 0))
      throw new HttpError(
        503,
        'Timed license payments are not deployed yet. Run npm run chain:licenses on the existing local node.',
      );
    if (market.version < 2)
      throw new HttpError(503, 'Restart npm run chain to enable co-author revenue sharing.');
    const existing = repo.all<CheckoutRow>(
      "SELECT * FROM chain_checkouts WHERE buyer_id=? AND instance_id=? AND (status='pending' OR (status='prepared' AND expires_at>=?)) ORDER BY created_at DESC",
      user.id,
      market.instanceId,
      Math.floor(Date.now() / 1000),
    );
    for (const row of existing) {
      const previous = serializeCheckout(repo, row),
        previousKeys = previous.items.map((i) => `${i.artworkId}:${i.license}`).sort();
      if (
        JSON.stringify(previousKeys) === JSON.stringify(keys) &&
        previous.buyerWallet.toLowerCase() === buyer.address.toLowerCase()
      )
        return res.json({ checkout: previous });
      if (previousKeys.some((key) => keys.includes(key)))
        throw new HttpError(
          409,
          'A checkout for this license is already open. Resume it in My licenses or wait for its quote to expire.',
        );
    }
    const expiresAt = Math.floor(Date.now() / 1000) + 600;
    const prepared: (CheckoutItemRow & { allocations: RevenueAllocation[] })[] = [];
    const id = randomUUID();
    for (const item of items) {
      const artwork = repo.artwork(item.artworkId);
      if (
        !artwork ||
        artwork.status !== 'published' ||
        repo.hidden(artwork.id) ||
        !JSON.parse(artwork.licenses).includes(item.license)
      )
        throw new HttpError(400, 'This artwork or license is unavailable.');
      requireApprovedShares(repo, artwork.id);
      if (
        repo.one(
          "SELECT 1 FROM escrow_records e JOIN chain_checkout_items i ON i.quote_id=e.quote_id JOIN chain_checkouts c ON c.id=i.checkout_id WHERE c.buyer_id=? AND i.artwork_id=? AND i.license=? AND e.state IN ('funded','delivered','disputed')",
          user.id,
          artwork.id,
          item.license,
        )
      )
        throw new HttpError(
          409,
          'An escrow order for this license is already in progress. Open My licenses.',
        );
      if (artwork.owner_id === user.id)
        throw new HttpError(400, 'You cannot purchase your own artwork.');
      const existingPurchase = repo.one<{ id: string }>(
        'SELECT id FROM purchases WHERE buyer_id=? AND artwork_id=? AND license=?',
        user.id,
        artwork.id,
        item.license,
      );
      if (existingPurchase && !repo.validity(existingPurchase.id).expired)
        throw new HttpError(409, 'You already own this license.');
      const seller = repo.wallet(artwork.owner_id),
        registered = repo.one<{ registrant: string }>(
          "SELECT registrant FROM chain_registrations WHERE artwork_id=? AND instance_id=? AND status='confirmed' ORDER BY created_at DESC LIMIT 1",
          artwork.id,
          market.instanceId,
        );
      if (
        !seller ||
        !registered ||
        !artwork.file_name ||
        !/^[a-f0-9]{64}$/.test(artwork.hash) ||
        seller.address.toLowerCase() !== registered.registrant.toLowerCase()
      )
        throw new HttpError(
          409,
          `The creator must link their registering wallet and register “${artwork.title}” on the current local chain before blockchain checkout is available.`,
        );
      if (seller.address.toLowerCase() === buyer.address.toLowerCase())
        throw new HttpError(400, 'Buyer and creator wallets must differ.');
      const fileHash = `0x${artwork.hash}` as Hex;
      const [owner] = await chain.client.readContract({
        address: market.registryAddress,
        abi: registryAbi,
        functionName: 'records',
        args: [fileHash],
      });
      if (owner.toLowerCase() !== seller.address.toLowerCase())
        throw new HttpError(
          409,
          'The file registration could not be verified on the current chain.',
        );
      if (
        await chain.client.readContract({
          address: market.address,
          abi: marketplaceAbi,
          functionName: 'hasLicense',
          args: [buyer.address, fileHash, licenseNumber[item.license]],
        })
      )
        throw new HttpError(
          409,
          'This wallet already owns this license on the local blockchain. Check its original account or pending orders.',
        );
      const amount = Math.round(artwork.price * licenseTypes[item.license].factor),
        feeBps = planRules[repo.user(artwork.owner_id).plan].commission * 100;
      const amountWei = BigInt(amount) * testWeiPerCent,
        feeWei = (amountWei * BigInt(feeBps)) / 10000n;
      const creator = repo.user(artwork.owner_id);
      const { recipients } = recipientsSchema.parse({
        recipients: repo.artworkRecipients(artwork.id),
      });
      if (
        recipients.some((r) => !r.wallet || r.wallet.toLowerCase() === seller.address.toLowerCase())
      )
        throw new HttpError(
          409,
          `The creator must add a different valid wallet for every co-author of “${artwork.title}” in its project editor before blockchain checkout.`,
        );
      const allocations = revenueAllocations(
        creator.name,
        seller.address,
        recipients,
        amountWei - feeWei,
      );
      const terms = termsSnapshot(repo.serialize(artwork, user)),
        quoteId = `0x${randomBytes(32).toString('hex')}` as Hex;
      const quote: LicenseQuote = {
        id: quoteId,
        buyer: buyer.address,
        seller: seller.address,
        fileHash,
        licenseType: licenseNumber[item.license],
        termsHash: termsFingerprint(terms),
        amount: String(amountWei),
        feeBps,
        expiresAt,
        instanceId: market.instanceId,
        recipients: allocations.filter((a) => !a.creator).map((a) => a.wallet),
        shares: allocations.filter((a) => !a.creator).map((a) => a.percent * 100),
        durationSeconds: repo.licenseDuration(artwork.id) * 86400,
      };
      const signature = await chain.signQuote(market, quote);
      prepared.push({
        quote_id: quoteId,
        checkout_id: id,
        artwork_id: artwork.id,
        seller_id: artwork.owner_id,
        title: artwork.title,
        license: item.license,
        seller_wallet: seller.address,
        file_hash: fileHash,
        terms_hash: quote.termsHash,
        terms_json: terms,
        amount,
        commission: Math.round((amount * feeBps) / 10000),
        amount_wei: String(amountWei),
        fee_wei: String(feeWei),
        fee_bps: feeBps,
        signature,
        purchase_id: null,
        allocations,
        duration_seconds: quote.durationSeconds,
      });
    }
    repo.db.exec('BEGIN IMMEDIATE');
    try {
      for (const item of prepared) {
        const owned = repo.one<{ id: string }>(
          'SELECT id FROM purchases WHERE buyer_id=? AND artwork_id=? AND license=?',
          user.id,
          item.artwork_id,
          item.license,
        );
        if (owned && !repo.validity(owned.id).expired)
          throw new HttpError(
            409,
            'A license was purchased while preparing this quote. Refresh your collection.',
          );
      }
      repo.run(
        "INSERT INTO chain_checkouts(id,buyer_id,buyer_wallet,instance_id,contract_address,status,expires_at,total_wei,created_at) VALUES(?,?,?,?,?,'prepared',?,?,?)",
        id,
        user.id,
        buyer.address,
        market.instanceId,
        market.address,
        expiresAt,
        String(prepared.reduce((sum, i) => sum + BigInt(i.amount_wei), 0n)),
        new Date().toISOString(),
      );
      repo.run('INSERT INTO chain_checkout_versions VALUES(?,?)', id, market.version);
      for (const i of prepared) {
        repo.run(
          'INSERT INTO chain_checkout_items(quote_id,checkout_id,artwork_id,seller_id,title,license,seller_wallet,file_hash,terms_hash,terms_json,amount,commission,amount_wei,fee_wei,fee_bps,signature) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          i.quote_id,
          id,
          i.artwork_id,
          i.seller_id,
          i.title,
          i.license,
          i.seller_wallet,
          i.file_hash,
          i.terms_hash,
          i.terms_json,
          i.amount,
          i.commission,
          i.amount_wei,
          i.fee_wei,
          i.fee_bps,
          i.signature,
        );
        if (market.version >= 3)
          repo.run(
            'INSERT INTO chain_license_periods(quote_id,duration_seconds) VALUES(?,?)',
            i.quote_id,
            i.duration_seconds || 0,
          );
        repo.run(
          'INSERT INTO chain_revenue_splits VALUES(?,?)',
          i.quote_id,
          JSON.stringify(i.allocations),
        );
      }
      repo.db.exec('COMMIT');
    } catch (error) {
      repo.db.exec('ROLLBACK');
      throw error;
    }
    res.status(201).json({ checkout: serializeCheckout(repo, checkout(id, user.id)) });
  });
  r.post('/blockchain/checkouts/:id/fund', limit, async (req, res) => {
    const user = requireUser(req),
      row = checkout(String(req.params.id), user.id),
      wallet = repo.wallet(user.id),
      market = await chain.requireMarketplace(row.contract_address);
    if (!wallet || wallet.address.toLowerCase() !== row.buyer_wallet.toLowerCase())
      throw new HttpError(400, 'Link the quoted buyer wallet first.');
    if (
      row.status !== 'prepared' ||
      row.expires_at < Math.floor(Date.now() / 1000) ||
      row.instance_id !== market.instanceId ||
      row.contract_address.toLowerCase() !== market.address.toLowerCase()
    )
      throw new HttpError(409, 'Prepare a current quote before requesting test funds.');
    res.json({
      transactionHash: await chain.fund(wallet.address, BigInt(row.total_wei) + parseEther('0.01')),
    });
  });
  r.post('/blockchain/checkouts/:id/recover', limit, async (req, res) => {
    const row = checkout(String(req.params.id), requireUser(req).id),
      market = await chain.requireMarketplace(row.contract_address);
    if (
      row.instance_id !== market.instanceId ||
      row.contract_address.toLowerCase() !== market.address.toLowerCase()
    )
      throw new HttpError(409, 'Restore the original local marketplace to recover this payment.');
    if (row.tx_hash) return res.json({ transactionHash: row.tx_hash });
    const item = repo.one<CheckoutItemRow>(
      'SELECT * FROM chain_checkout_items WHERE checkout_id=? LIMIT 1',
      row.id,
    )!;
    const events = await chain.client.getContractEvents({
      address: row.contract_address,
      abi: marketplaceAbi,
      eventName: 'LicensePurchased',
      args: { quoteId: item.quote_id },
      fromBlock: 0n,
      toBlock: 'latest',
    });
    res.json({ transactionHash: events[0]?.transactionHash || null });
  });
  r.post('/blockchain/checkouts/:id/confirm', limit, async (req, res) => {
    const user = requireUser(req),
      row = checkout(String(req.params.id), user.id),
      { transactionHash } = z
        .object({
          transactionHash: z
            .string()
            .regex(/^0x[a-fA-F0-9]{64}$/)
            .transform((s) => s.toLowerCase() as Hex),
        })
        .parse(req.body);
    if (row.tx_hash && row.tx_hash.toLowerCase() !== transactionHash)
      throw new HttpError(409, 'This checkout already has a different transaction.');
    const market = await chain.requireMarketplace(row.contract_address);
    if (
      market.instanceId !== row.instance_id ||
      market.address.toLowerCase() !== row.contract_address.toLowerCase()
    )
      throw new HttpError(409, 'This checkout belongs to a different local chain or marketplace.');
    if (row.status === 'confirmed') return res.json({ checkout: serializeCheckout(repo, row) });
    if (row.status === 'failed')
      throw new HttpError(422, row.error || 'This transaction failed. Prepare a new checkout.');
    const saved = repo.run(
      "UPDATE chain_checkouts SET status='pending',tx_hash=? WHERE id=? AND status IN ('prepared','pending') AND (tx_hash IS NULL OR lower(tx_hash)=?)",
      transactionHash,
      row.id,
      transactionHash,
    );
    if (!saved.changes) {
      const latest = checkout(row.id, user.id);
      if (latest.tx_hash?.toLowerCase() !== transactionHash)
        throw new HttpError(409, 'This checkout already has a different transaction.');
      if (latest.status === 'confirmed')
        return res.json({ checkout: serializeCheckout(repo, latest) });
      if (latest.status === 'failed')
        throw new HttpError(422, latest.error || 'This payment failed.');
    }
    let receipt;
    try {
      receipt = await chain.client.getTransactionReceipt({ hash: transactionHash });
    } catch (error) {
      if (error instanceof TransactionReceiptNotFoundError)
        return res
          .status(202)
          .json({ checkout: serializeCheckout(repo, checkout(row.id, user.id)) });
      throw new HttpError(
        503,
        'Transaction check unavailable. The hash is saved; retry verification before sending another payment.',
      );
    }
    const items = repo.all<CheckoutItemRow>(
      'SELECT i.*,p.duration_seconds FROM chain_checkout_items i LEFT JOIN chain_license_periods p ON p.quote_id=i.quote_id WHERE checkout_id=?',
      row.id,
    );
    if (market.version === 4)
      return res.json({ checkout: await confirmEscrowFunding(repo, chain, row, receipt, items) });
    const events = parseEventLogs({
      abi: marketplaceAbi,
      eventName: 'LicensePurchased',
      logs: receipt.logs.filter(
        (l) => l.address.toLowerCase() === row.contract_address.toLowerCase(),
      ),
    });
    const payoutEvents = parseEventLogs({
      abi: marketplaceAbi,
      eventName: 'RevenueAllocated',
      logs: receipt.logs.filter(
        (l) => l.address.toLowerCase() === row.contract_address.toLowerCase(),
      ),
    });
    const validityEvents = parseEventLogs({
      abi: termMarketplaceAbi,
      eventName: 'LicenseValidity',
      logs: receipt.logs.filter(
        (l) => l.address.toLowerCase() === row.contract_address.toLowerCase(),
      ),
    });
    const periodsValid =
      market.version !== 3 ||
      (validityEvents.length === items.length &&
        items.every((item) => {
          const period = validityEvents.find((e) => e.args.quoteId === item.quote_id),
            sale = events.find((e) => e.args.quoteId === item.quote_id);
          return (
            period &&
            sale &&
            period.args.validFrom === sale.args.purchasedAt &&
            period.args.validUntil ===
              (item.duration_seconds
                ? period.args.validFrom + BigInt(item.duration_seconds)
                : 18446744073709551615n)
          );
        }));
    const expectedAllocations = items.flatMap((item) =>
      allocationsFor(repo, item).map((a) => ({ ...a, quoteId: item.quote_id })),
    );
    const splitsValid =
      market.version === 1 ||
      (payoutEvents.length === expectedAllocations.length &&
        expectedAllocations.every((a) =>
          payoutEvents.some(
            (e) =>
              e.args.quoteId === a.quoteId &&
              e.args.recipient.toLowerCase() === a.wallet.toLowerCase() &&
              String(e.args.amount) === a.amountWei &&
              e.args.shareBps === a.percent * 100,
          ),
        ));
    const valid =
      splitsValid &&
      periodsValid &&
      receipt.status === 'success' &&
      receipt.to?.toLowerCase() === row.contract_address.toLowerCase() &&
      receipt.from.toLowerCase() === row.buyer_wallet.toLowerCase() &&
      events.length === items.length &&
      items.every((i) =>
        events.some(
          (e) =>
            e.args.quoteId === i.quote_id &&
            e.args.buyer.toLowerCase() === row.buyer_wallet.toLowerCase() &&
            e.args.seller.toLowerCase() === i.seller_wallet.toLowerCase() &&
            e.args.fileHash === i.file_hash &&
            e.args.licenseType === licenseNumber[i.license] &&
            e.args.termsHash === i.terms_hash &&
            String(e.args.amount) === i.amount_wei &&
            String(e.args.fee) === i.fee_wei,
        ),
      );
    if (!valid) {
      const message =
        receipt.status === 'reverted'
          ? 'Payment transaction reverted. No licenses were issued and the contract did not retain the payment.'
          : 'This transaction does not pay for the quoted licenses, wallet, and terms at the expected contract.';
      repo.run("UPDATE chain_checkouts SET status='failed',error=? WHERE id=?", message, row.id);
      throw new HttpError(422, message);
    }
    const purchasedAt = new Date(Number(events[0].args.purchasedAt) * 1000).toISOString();
    repo.db.exec('BEGIN IMMEDIATE');
    try {
      // Recheck inside the transaction: simultaneous verification must issue each license only once.
      const latest = checkout(row.id, user.id);
      if (latest.status !== 'confirmed') {
        for (const i of items) {
          const existing = repo.one<PurchaseRow>(
            'SELECT * FROM purchases WHERE buyer_id=? AND artwork_id=? AND license=?',
            user.id,
            i.artwork_id,
            i.license,
          );
          const purchaseId = existing?.id || randomUUID();
          const latestPeriod =
            !existing || Date.parse(purchasedAt) >= Date.parse(existing.created_at);
          const allocations = allocationsFor(repo, i).map((a) => ({
            ...a,
            amount: (((i.amount - i.commission) / 100) * a.percent) / 100,
          }));
          if (existing) {
            // A free local order may have been created after the quote expired but before a mined payment was recovered.
            // Preserve that original record while attaching the actual verified blockchain payment to the same license.
            if (paymentFor(repo, existing.id) && market.version !== 3)
              throw new HttpError(
                409,
                'This license already has a different blockchain payment record.',
              );
            if (!paymentFor(repo, existing.id))
              repo.run(
                'UPDATE chain_checkout_items SET previous_local_record=? WHERE quote_id=?',
                JSON.stringify(existing),
                i.quote_id,
              );
            if (latestPeriod)
              repo.run(
                'UPDATE purchases SET amount=?,commission=?,allocations=?,package_id=?,created_at=? WHERE id=?',
                i.amount,
                i.commission,
                JSON.stringify(allocations),
                items.length > 1 ? row.id : null,
                purchasedAt,
                purchaseId,
              );
          } else
            repo.run(
              'INSERT INTO purchases VALUES(?,?,?,?,?,?,?,?,?)',
              purchaseId,
              user.id,
              i.artwork_id,
              i.license,
              i.amount,
              i.commission,
              JSON.stringify(allocations),
              items.length > 1 ? row.id : null,
              purchasedAt,
            );
          if (existing && paymentFor(repo, existing.id))
            repo.run('INSERT INTO chain_purchase_links VALUES(?,?)', i.quote_id, purchaseId);
          else
            repo.run(
              'UPDATE chain_checkout_items SET purchase_id=? WHERE quote_id=?',
              purchaseId,
              i.quote_id,
            );
          const period = validityEvents.find((e) => e.args.quoteId === i.quote_id);
          if (period) {
            const until =
              period.args.validUntil === 18446744073709551615n
                ? null
                : Number(period.args.validUntil);
            repo.run(
              'UPDATE chain_license_periods SET valid_from=?,valid_until=? WHERE quote_id=?',
              Number(period.args.validFrom),
              until,
              i.quote_id,
            );
            if (latestPeriod)
              repo.run(
                'INSERT INTO license_validity VALUES(?,?,?) ON CONFLICT(purchase_id) DO UPDATE SET valid_from=excluded.valid_from,valid_until=excluded.valid_until',
                purchaseId,
                Number(period.args.validFrom),
                until,
              );
          }
          repo.run(
            "UPDATE chain_checkouts SET status='failed',error='A license in this quote was issued through another checkout. Prepare a new quote for the remaining licenses.' WHERE id<>? AND buyer_id=? AND status='prepared' AND expires_at>=? AND id IN (SELECT checkout_id FROM chain_checkout_items WHERE artwork_id=? AND license=?)",
            row.id,
            user.id,
            Math.floor(Date.now() / 1000),
            i.artwork_id,
            i.license,
          );
        }
        repo.run(
          "UPDATE chain_checkouts SET status='confirmed',block_number=?,confirmed_at=?,error=NULL WHERE id=?",
          String(receipt.blockNumber),
          purchasedAt,
          row.id,
        );
        for (const item of repo.all<{ purchase_id: string; quote_id: string }>(
          'SELECT coalesce(i.purchase_id,l.purchase_id) purchase_id,i.quote_id FROM chain_checkout_items i LEFT JOIN chain_purchase_links l ON l.quote_id=i.quote_id WHERE i.checkout_id=?',
          row.id,
        ))
          recordPurchase(repo, item.purchase_id, item.quote_id);
      }
      repo.db.exec('COMMIT');
    } catch (error) {
      repo.db.exec('ROLLBACK');
      throw error;
    }
    res.json({ checkout: serializeCheckout(repo, checkout(row.id, user.id)) });
  });
  return r;
}
