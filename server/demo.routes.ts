import { Router } from 'express';
import { createHash } from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import {
  createWalletClient,
  encodeFunctionData,
  hashTypedData,
  hexToString,
  http,
  type Address,
  type Hex,
} from 'viem';
import { localChain, registryAbi } from '../shared/blockchain.js';
import { contractQuote, marketplaceAbi, marketAbi } from '../shared/marketplace.js';
import { decodeFunctionData } from 'viem';
import { escrowAbi } from '../shared/escrow.js';
import { escrowRow } from './escrow-records.js';
import { publicDemo } from './hosting.js';
import { consentTypes, subscriptionAbi, subscriptionMessage } from '../shared/platform.js';
import { demoProfiles } from '../shared/demo.js';
import { requireUser, cookieToken, tokenHash } from './auth.js';
import { requireVerified } from './security.js';
import { consentRequest } from './consents.js';
import { serializeCheckout, type CheckoutRow } from './chain-checkouts.js';
import type { RegistrationRow } from './chain-records.js';
import { quote as subscriptionQuote, type OrderRow } from './billing.routes.js';
import type { Repository } from './repository.js';
import type { LocalBlockchain } from './blockchain.js';
import { HttpError } from './errors.js';
import { promotionAbi, promotionMessage } from '../shared/promotions.js';
import { promotionQuote, type PromotionRow } from './promotion.routes.js';

const same = (a?: string | null, b?: string | null) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();
const denied = () =>
  new HttpError(
    403,
    'The demo wallet only signs your current ArtGuard requests on the local test chain.',
  );

// Enabled only by the explicit provisioning CLI, bound to the saved node instance and account.
export function demoIdentity(repo: Repository, userId: string) {
  if (publicDemo()) {
    const assigned = repo.one<{ value: Address }>(
      'SELECT value FROM platform_meta WHERE key=?',
      'public_wallet:' + userId,
    )?.value;
    if (assigned && same(assigned, repo.wallet(userId)?.address)) return assigned;
  }
  for (const p of demoProfiles) {
    if (
      repo.one<{ value: string }>(
        'SELECT value FROM platform_meta WHERE key=?',
        'demo_account:' + p.key,
      )?.value !== userId
    )
      continue;
    const address = repo.one<{ value: Address }>(
      'SELECT value FROM platform_meta WHERE key=?',
      'demo_wallet:' + p.key,
    )?.value;
    if (address && same(address, repo.wallet(userId)?.address)) return address;
  }
  return null;
}

export function demoRoutes(repo: Repository, chain: LocalBlockchain) {
  const r = Router();
  const inFlight = new Set<string>();
  const walletClient = createWalletClient({
    chain: localChain,
    transport: http(chain.rpcUrl, { retryCount: 0 }),
  });
  const instance = () =>
    repo.one<{ value: string }>("SELECT value FROM platform_meta WHERE key='demo_chain_instance'")
      ?.value;
  r.get('/demo/profiles', async (_req, res) => {
    const status = await chain.status();
    const current = status.ready && status.deployment?.instanceId === instance();
    const projectId = repo.one<{ value: string }>(
      "SELECT value FROM platform_meta WHERE key='demo_project'",
    )?.value;
    const project = projectId ? repo.artwork(projectId) : null;
    res.json({
      project:
        project && repo.canView(project, null) ? { id: project.id, title: project.title } : null,
      profiles: await Promise.all(
        demoProfiles
          .filter((p) => !publicDemo() || !['admin', 'manager'].includes(p.key))
          .map(async ({ password: _password, ...p }) => {
            const userId = repo.one<{ value: string }>(
              'SELECT value FROM platform_meta WHERE key=?',
              'demo_account:' + p.key,
            )?.value;
            const wallet = userId ? demoIdentity(repo, userId) : null;
            const balance =
              current && wallet
                ? await chain.client.getBalance({ address: wallet }).catch(() => null)
                : null;
            return {
              ...p,
              wallet,
              ready:
                p.key === 'manager'
                  ? !!userId && repo.emailVerified(userId) && repo.isManager(userId)
                  : !!current && !!wallet,
              balanceWei: balance === null ? null : String(balance),
            };
          }),
      ),
      message: current
        ? 'Local demo wallets ready. Transactions use test ETH.'
        : 'Run npm run demo:setup with the local chain running.',
    });
  });
  r.get('/demo/wallet', (req, res) => {
    const address = req.user ? demoIdentity(repo, req.user.id) : null;
    res.json(address ? { available: true, address } : { available: false });
  });
  r.post(
    '/demo/wallet/rpc',
    rateLimit({ windowMs: 60000, limit: 90, legacyHeaders: false }),
    async (req, res) => {
      const user = requireVerified(repo, requireUser(req));
      const address = demoIdentity(repo, user.id);
      if (!address) throw denied();
      const deployment = await chain.requireReady();
      if (deployment.instanceId !== instance())
        throw new HttpError(409, 'The test chain changed. Run npm run demo:setup again.');
      if (!(await walletClient.getAddresses()).some((a) => same(a, address))) throw denied();
      const { method, params } = z
        .object({ method: z.string(), params: z.array(z.unknown()).max(2) })
        .parse(req.body);
      if (inFlight.has(address))
        throw new HttpError(
          409,
          'A demo wallet operation is in progress. Wait for its result before retrying.',
        );
      inFlight.add(address);
      try {
        if (method === 'personal_sign') {
          const [raw, from] = z
            .tuple([z.string().regex(/^0x[\da-fA-F]+$/), z.string()])
            .parse(params);
          const message = hexToString(raw as Hex);
          if (
            !same(from, address) ||
            !repo.one(
              'SELECT 1 FROM wallet_challenges WHERE user_id=? AND session_hash=? AND lower(address)=? AND message=? AND expires_at>?',
              user.id,
              tokenHash(cookieToken(req)),
              address.toLowerCase(),
              message,
              Date.now(),
            )
          )
            throw denied();
          return res.json({
            result: await walletClient.signMessage({ account: address, message }),
          });
        }
        if (method === 'eth_signTypedData_v4') {
          const [from, json] = z.tuple([z.string(), z.string()]).parse(params);
          if (!same(from, address)) throw denied();
          let typed: Record<string, any>;
          try {
            typed = JSON.parse(json);
          } catch {
            throw denied();
          }
          if (typed.primaryType !== 'RevenueConsent') throw denied();
          const version = repo
            .all<{ id: string; artwork_id: string }>('SELECT id,artwork_id FROM share_versions')
            .find(
              (v) =>
                '0x' + createHash('sha256').update(v.id).digest('hex') === typed.message?.revision,
            );
          if (!version) throw denied();
          const request = consentRequest(repo, version.artwork_id, address);
          const expected = {
            ...request,
            types: consentTypes,
            primaryType: 'RevenueConsent' as const,
          };
          if (
            request.versionId !== version.id ||
            hashTypedData(expected) !== hashTypedData(typed as Parameters<typeof hashTypedData>[0])
          )
            throw denied();
          return res.json({
            result: await walletClient.signTypedData({
              account: address,
              domain: request.domain,
              types: consentTypes,
              primaryType: 'RevenueConsent',
              message: request.message,
            }),
          });
        }
        if (method !== 'eth_sendTransaction') throw denied();
        const [tx] = z
          .tuple([
            z.object({
              from: z.string(),
              to: z.string(),
              data: z.string().regex(/^0x[\da-fA-F]*$/),
              value: z
                .string()
                .regex(/^0x[\da-fA-F]+$/)
                .optional(),
              chainId: z.union([z.string(), z.number()]).optional(),
            }),
          ])
          .parse(params);
        if (!same(tx.from, address) || (tx.chainId !== undefined && BigInt(tx.chainId) !== 31337n))
          throw denied();
        const value = BigInt(tx.value || '0x0');
        let intent: { table: string; id: string; hash: Hex | null } | undefined;
        if (same(tx.to, deployment.address) && value === 0n) {
          const row = repo
            .all<RegistrationRow>(
              "SELECT * FROM chain_registrations WHERE user_id=? AND instance_id=? AND status IN ('prepared','pending','confirmed')",
              user.id,
              deployment.instanceId,
            )
            .find(
              (v) =>
                same(v.registrant, address) &&
                same(v.contract_address, tx.to) &&
                same(
                  encodeFunctionData({
                    abi: registryAbi,
                    functionName: 'registerArtwork',
                    args: [v.file_hash, v.terms_hash],
                  }),
                  tx.data,
                ),
            );
          if (row) intent = { table: 'chain_registrations', id: row.id, hash: row.tx_hash };
        }
        if (!intent) {
          for (const row of repo.all<CheckoutRow>(
            "SELECT * FROM chain_checkouts WHERE buyer_id=? AND instance_id=? AND status IN ('prepared','pending','confirmed')",
            user.id,
            deployment.instanceId,
          )) {
            if (
              !same(row.buyer_wallet, address) ||
              !same(row.contract_address, tx.to) ||
              BigInt(row.total_wei) !== value
            )
              continue;
            const checkout = serializeCheckout(repo, row);
            const data = encodeFunctionData({
              abi: marketAbi(checkout.marketVersion),
              functionName: 'buyLicenses',
              args: [
                checkout.items.map((i) => contractQuote(i.quote)),
                checkout.items.map((i) => i.signature),
              ],
            });
            if (!same(data, tx.data)) continue;
            await chain.requireMarketplace(row.contract_address);
            if (!row.tx_hash && row.expires_at < Date.now() / 1000)
              throw new HttpError(409, 'This checkout expired. Prepare a new quote.');
            intent = { table: 'chain_checkouts', id: row.id, hash: row.tx_hash };
            break;
          }
        }
        if (!intent) {
          for (const row of repo.all<OrderRow>(
            "SELECT * FROM subscription_orders WHERE user_id=? AND instance_id=? AND status IN ('prepared','pending','confirmed')",
            user.id,
            deployment.instanceId,
          )) {
            if (
              !same(row.buyer_wallet, address) ||
              !same(row.contract_address, tx.to) ||
              BigInt(row.amount_wei) !== value
            )
              continue;
            if (
              !same(
                encodeFunctionData({
                  abi: subscriptionAbi,
                  functionName: 'purchase',
                  args: [subscriptionMessage(subscriptionQuote(row)), row.signature],
                }),
                tx.data,
              )
            )
              continue;
            const subscription = await chain.subscriptionDeployment();
            if (!same(subscription.address, row.contract_address)) throw denied();
            if (!row.tx_hash && row.expires_at < Date.now() / 1000)
              throw new HttpError(409, 'This subscription order expired. Prepare a new order.');
            intent = { table: 'subscription_orders', id: row.id, hash: row.tx_hash };
            break;
          }
        }
        if (!intent) {
          for (const row of repo.all<PromotionRow>(
            "SELECT * FROM promotion_orders WHERE user_id=? AND instance_id=? AND status IN ('prepared','pending','confirmed')",
            user.id,
            deployment.instanceId,
          )) {
            if (
              !same(row.buyer_wallet, address) ||
              !same(row.contract_address, tx.to) ||
              BigInt(row.amount_wei) !== value ||
              !same(
                encodeFunctionData({
                  abi: promotionAbi,
                  functionName: 'purchase',
                  args: [promotionMessage(promotionQuote(row)), row.signature],
                }),
                tx.data,
              )
            )
              continue;
            const promotion = await chain.promotionDeployment();
            if (!same(promotion.address, row.contract_address)) throw denied();
            if (!row.tx_hash && row.expires_at < Date.now() / 1000)
              throw new HttpError(409, 'This promotion quote expired. Prepare a new quote.');
            intent = { table: 'promotion_orders', id: row.id, hash: row.tx_hash };
            break;
          }
        }
        if (intent?.hash) return res.json({ result: intent.hash });
        if (!intent) {
          if (value !== 0n) throw denied();
          const call = (() => {
            try {
              return decodeFunctionData({ abi: escrowAbi, data: tx.data as Hex });
            } catch {
              throw denied();
            }
          })();
          if (
            ![
              'withdraw',
              'withdrawRefund',
              'markDelivered',
              'dispute',
              'release',
              'refund',
            ].includes(call.functionName)
          )
            throw denied();
          const market = await chain.requireMarketplace(tx.to as Address);
          if (!same(market.address, tx.to)) throw denied();
          if (
            !same(tx.data, encodeFunctionData({ abi: marketplaceAbi, functionName: 'withdraw' }))
          ) {
            if (market.version !== 4) throw denied();
            if (call.functionName === 'withdrawRefund') {
              if (
                !same(
                  tx.data,
                  encodeFunctionData({ abi: escrowAbi, functionName: 'withdrawRefund' }),
                )
              )
                throw denied();
              if (
                !(await chain.client.readContract({
                  address: market.address,
                  abi: escrowAbi,
                  functionName: 'refundBalances',
                  args: [address],
                }))
              )
                throw new HttpError(409, 'No refund is available to withdraw.');
            } else if (
              call.functionName === 'markDelivered' ||
              call.functionName === 'dispute' ||
              call.functionName === 'release' ||
              call.functionName === 'refund'
            ) {
              const row = escrowRow(repo, String(call.args[0]));
              if (
                !same(row.contract_address, market.address) ||
                !same(row.instance_id, deployment.instanceId) ||
                !(row.buyer_id === user.id || row.seller_id === user.id)
              )
                throw denied();
              if (call.functionName === 'markDelivered' && !same(row.seller_wallet, address))
                throw denied();
              if (call.functionName === 'dispute' && !same(row.buyer_wallet, address))
                throw denied();
              if (
                !same(
                  tx.data,
                  encodeFunctionData({
                    abi: escrowAbi,
                    functionName: call.functionName,
                    args: [row.quote_id],
                  }),
                )
              )
                throw denied();
            } else throw denied();
          } else {
            const balance = await chain.client.readContract({
              address: market.address,
              abi: marketplaceAbi,
              functionName: 'balances',
              args: [address],
            });
            if (!balance) throw new HttpError(409, 'No test earnings are available to withdraw.');
          }
        }
        const hash = await walletClient.sendTransaction({
          account: address,
          to: tx.to as Address,
          data: tx.data as Hex,
          value,
        });
        // Save the real hash before responding; a lost HTTP response can be recovered without paying twice.
        if (intent)
          repo.run(
            `UPDATE ${intent.table} SET tx_hash=?,status='pending' WHERE id=?`,
            hash,
            intent.id,
          );
        res.json({ result: hash });
      } finally {
        inFlight.delete(address);
      }
    },
  );
  return r;
}
