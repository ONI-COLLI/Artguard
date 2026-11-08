import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { z } from 'zod';
import type { LocalBlockchain } from './blockchain.js';
import type { PresentationEvidence } from '../shared/presentation.js';

// These are historical command results, never an executable public test runner.
export async function recordedPresentationRuns(directory = resolve('artifacts/demo-video')) {
  const runs: PresentationEvidence['runs'] = [];
  const number = z.number().int().nonnegative();
  const schema = z.object({
    command: z.string().max(180),
    exitCode: z.number().int(),
    passed: number,
    failed: number.optional(),
  });
  for (const kind of ['unit', 'blockchain'] as const) {
    try {
      const unit = kind === 'unit';
      const raw = JSON.parse(
        await readFile(join(directory, unit ? 'evidence.json' : 'blockchain-results.json'), 'utf8'),
      );
      const summary = schema.parse(unit ? raw.tests : raw);
      const command = unit
        ? 'npm run test:unit -- --maxWorkers=1 --no-file-parallelism'
        : 'npm run test:blockchain';
      if (summary.command !== command) continue;
      const log = await readFile(
        join(directory, unit ? 'unit-tests.log' : 'blockchain-tests.log'),
        'utf8',
      );
      const plain = log.replace(/\x1b\[[0-9;]*m/g, '');
      const passed = Number(
        plain.match(unit ? /Tests\s+(\d+)\s+passed/ : /(?:#|ℹ) pass\s+(\d+)/)?.[1],
      );
      const failed = unit
        ? Number(plain.match(/Tests[^\n]*?(\d+) failed/)?.[1] || 0)
        : Number(plain.match(/(?:#|ℹ) fail\s+(\d+)/)?.[1]);
      if (
        !Number.isFinite(passed) ||
        !Number.isFinite(failed) ||
        passed !== summary.passed ||
        (summary.failed !== undefined && failed !== summary.failed)
      )
        continue;
      let completedAt = raw.completedAt;
      if (unit) {
        const events = (await readFile(join(directory, 'execution.ndjson'), 'utf8'))
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line));
        completedAt = events
          .reverse()
          .find(
            (e) =>
              e.type === 'tests-complete' && e.exitCode === summary.exitCode && e.passed === passed,
          )?.at;
      }
      if (typeof completedAt !== 'string' || !Number.isFinite(Date.parse(completedAt))) continue;
      if (summary.exitCode === 0 && failed > 0) continue;
      runs.push({
        label: unit ? 'Application unit tests' : 'Smart contract / EVM tests',
        command,
        completedAt,
        passed,
        failed,
        exitCode: summary.exitCode,
        logSha256: createHash('sha256').update(log).digest('hex'),
      });
    } catch {
      /* Missing or inconsistent artifacts are shown as unavailable. */
    }
  }
  return runs;
}

export async function presentationEvidence(chain: LocalBlockchain): Promise<PresentationEvidence> {
  const result: PresentationEvidence = {
    checkedAt: new Date().toISOString(),
    chainId: 31337,
    online: false,
    message: 'The local EVM could not be verified. No deployment is confirmed.',
    contracts: [],
    runs: await recordedPresentationRuns(),
  };
  try {
    const registry = await chain.status();
    if (!registry.ready || !registry.deployment) return result;
    const market = await chain.marketplaceStatus();
    const escrow = market.contracts?.find((c) => c.version === 4);
    for (const item of [
      { name: 'Artwork registry', ...registry.deployment },
      ...(escrow ? [{ name: 'Escrow marketplace v4', ...escrow }] : []),
    ]) {
      const entry: PresentationEvidence['contracts'][number] = {
        name: item.name,
        address: item.address,
        transactionHash: item.transactionHash,
        verified: false,
        block: null,
        bytecodeBytes: 0,
      };
      try {
        const [receipt, code] = await Promise.all([
          chain.client.getTransactionReceipt({ hash: item.transactionHash }),
          chain.client.getCode({ address: item.address }),
        ]);
        const block = await chain.client.getBlock({ blockNumber: receipt.blockNumber });
        entry.block = String(receipt.blockNumber);
        entry.bytecodeBytes = code ? (code.length - 2) / 2 : 0;
        entry.verified =
          receipt.status === 'success' &&
          receipt.transactionHash.toLowerCase() === item.transactionHash.toLowerCase() &&
          receipt.to === null &&
          receipt.contractAddress?.toLowerCase() === item.address.toLowerCase() &&
          block.hash === receipt.blockHash &&
          entry.bytecodeBytes > 0;
      } catch {
        /* Keep the unverified state; never substitute a recorded receipt. */
      }
      result.contracts.push(entry);
    }
    result.online = result.contracts.length === 2 && result.contracts.every((c) => c.verified);
    result.message = result.online
      ? 'Deployment receipts, canonical blocks and deployed bytecode verified from the current local EVM.'
      : 'The node responded, but not every current deployment could be confirmed.';
  } catch {
    /* Return an honest offline result. */
  }
  result.checkedAt = new Date().toISOString();
  return result;
}

export function presentationRoutes(chain: LocalBlockchain) {
  const router = Router();
  router.get(
    '/blockchain/presentation',
    rateLimit({ windowMs: 60000, limit: 30, legacyHeaders: false }),
    async (_req, res) => res.json(await presentationEvidence(chain)),
  );
  return router;
}
