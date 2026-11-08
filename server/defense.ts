import { Router, type Request } from 'express';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, createWriteStream } from 'node:fs';
import { resolve, join, dirname, sep } from 'node:path';
import { z } from 'zod';
import type { Repository } from './repository.js';
import type { LocalBlockchain } from './blockchain.js';
import type { DefenseState } from '../shared/defense.js';
import { escrowProof } from './escrow-proof.js';
import { HttpError } from './errors.js';

export function defenseRequestAllowed(req: Pick<Request, 'headers' | 'socket'>, enabled: boolean) {
  const host = req.headers.host || '';
  return (
    enabled &&
    ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress || '') &&
    /^(127\.0\.0\.1|localhost):3600$/.test(host) &&
    req.headers.origin === `http://${host}` &&
    req.headers['x-artguard-defense'] === '1'
  );
}

export function defenseRoutes(repo: Repository, chain: LocalBlockchain, dataDir: string) {
  const router = Router();
  const directory = resolve(dataDir);
  const enabled =
    process.env.ARTGUARD_DEFENSE_MODE === '1' &&
    directory.startsWith(resolve('runtime') + sep + 'defense-') &&
    process.env.PORT === '3600' &&
    chain.rpcUrl === 'http://127.0.0.1:8665' &&
    !process.env.PUBLIC_ORIGIN &&
    process.env.ARTGUARD_PUBLIC_DEMO !== 'true';
  const state: DefenseState = {
    enabled,
    runId: randomUUID(),
    phase: 'idle',
    startedAt: null,
    error: '',
    events: [],
    jobs: {},
    contracts: [],
    project: null,
    depositHash: null,
  };
  const output = resolve('artifacts/defense-video', state.runId);
  const children: ChildProcess[] = [];
  function persist() {
    mkdirSync(output, { recursive: true });
    writeFileSync(join(output, 'run.json'), JSON.stringify(state, null, 2));
  }
  function event(channel: string, text: string) {
    // Commands have fixed arguments. Only safe deployment lines and test output reach the UI.
    state.events.push({ at: new Date().toISOString(), channel, text });
    persist();
  }
  function launch(args: string[], label: string, expose: (line: string) => boolean) {
    const log = createWriteStream(join(output, label + '.log'));
    const child = spawn(process.execPath, args, {
      env: process.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.push(child);
    let text = '',
      pending = '';
    const accept = (line: string) => {
      if (!expose(line)) return;
      const clean = line.replaceAll(process.cwd(), '[project]');
      event(label, clean);
      if (state.jobs[label])
        state.jobs[label].lines = [...state.jobs[label].lines, clean].slice(-120);
    };
    for (const stream of [child.stdout!, child.stderr!])
      stream.on('data', (chunk) => {
        const clean = String(chunk).replace(/\x1b\[[0-9;]*m/g, '');
        text += clean;
        log.write(clean);
        pending += clean;
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() || '';
        for (const line of lines) accept(line);
      });
    const done = new Promise<number>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code) => {
        if (pending) accept(pending);
        log.end();
        resolve(code ?? 1);
      });
    });
    return { child, done, text: () => text };
  }
  async function tests(label: string, script: string, unit: boolean) {
    const command = 'npm run ' + script;
    state.jobs[label] = {
      command,
      status: 'running',
      passed: 0,
      failed: 0,
      exitCode: null,
      lines: [],
    };
    event(label, '$ ' + command);
    const npm = join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
    const job = launch([npm, 'run', script], label, (line) =>
      /^(>|\s*✓|\s*❯|\s*Test Files|\s*Tests|\s*Duration|ok \d|not ok |# (tests|pass|fail|duration_ms)|TAP version|\s*FAIL)/.test(
        line,
      ),
    );
    const exitCode = await job.done;
    const passed = Number(
      job.text().match(unit ? /Tests\s+(\d+)\s+passed/ : /# pass\s+(\d+)/)?.[1] || 0,
    );
    const failed = Number(
      job.text().match(unit ? /Tests[^\n]*?(\d+) failed/ : /# fail\s+(\d+)/)?.[1] || 0,
    );
    Object.assign(state.jobs[label], {
      exitCode,
      passed,
      failed,
      status: exitCode === 0 && passed > 0 && failed === 0 ? 'passed' : 'failed',
    });
    event(label, `${passed} passed · ${failed} failed · process exit ${exitCode}`);
  }
  async function start() {
    state.phase = 'deploying';
    state.startedAt = new Date().toISOString();
    persist();
    event('deploy', '$ npm run chain');
    void tests('unit', 'test:defense:unit', true).catch((e) => {
      state.error = e.message;
      persist();
    });
    void tests('contracts', 'test:defense:contracts', false).catch((e) => {
      state.error = e.message;
      persist();
    });
    const deployment = launch(['scripts/local-chain.mjs'], 'deploy', (line) =>
      /^(ArtGuard local chain ready:|Registry:|License marketplace:|Timed licenses:|Escrow marketplace:|Subscription payments:|Promotion payments:)/.test(
        line,
      ),
    );
    for (let i = 0; i < 240; i++) {
      if (deployment.child.exitCode !== null) throw new Error('Local deployment stopped.');
      if (deployment.text().includes('Paid 7-day placements ready.')) break;
      if (i === 239) throw new Error('Deployment timed out.');
      await new Promise((r) => setTimeout(r, 500));
    }
    for (const [name, file] of [
      ['ArtworkRegistry', 'registry.json'],
      ['Escrow marketplace v4', 'escrow-marketplace.json'],
    ]) {
      const saved = JSON.parse(readFileSync(join(directory, 'chain', file), 'utf8'));
      const receipt = await chain.client.getTransactionReceipt({ hash: saved.transactionHash });
      const block = await chain.client.getBlock({ blockNumber: receipt.blockNumber });
      const code = await chain.client.getCode({ address: saved.address });
      if (
        receipt.status !== 'success' ||
        receipt.to !== null ||
        receipt.contractAddress?.toLowerCase() !== saved.address.toLowerCase() ||
        block.hash !== receipt.blockHash ||
        !code ||
        code === '0x'
      )
        throw new Error('Deployment receipt or bytecode did not verify.');
      state.contracts.push({
        name,
        address: saved.address,
        hash: saved.transactionHash,
        block: String(receipt.blockNumber),
        bytecodeBytes: (code.length - 2) / 2,
      });
      event(
        'deploy',
        `${name} · status success · block ${receipt.blockNumber} · ${code.length / 2 - 1} bytes`,
      );
    }
    state.phase = 'provisioning';
    event(
      'setup',
      'Preparing fictional creator, buyer and co-author wallets; registering Shared Horizons.',
    );
    const setup = launch(
      ['--import', 'tsx', 'scripts/demo-setup.ts'],
      'setup.private',
      () => false,
    );
    if ((await setup.done) !== 0)
      throw new Error('Fixture setup failed. No successful setup is claimed.');
    const id = repo.one<{ value: string }>(
      "SELECT value FROM platform_meta WHERE key='demo_project'",
    )?.value;
    const project = id ? repo.artwork(id) : null;
    if (!project) throw new Error('The registered demo project was not found.');
    state.project = { id: project.id, title: project.title };
    state.phase = 'ready';
    event(
      'setup',
      'Ready. The following clicks use the real ArtGuard pages and signed local EVM transactions.',
    );
  }
  router.get('/defense/state', (req, res) => {
    if (!enabled) return res.json({ ...state, enabled: false });
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress || ''))
      throw new HttpError(404, 'Not found.');
    state.depositHash =
      repo.one<{ tx_hash: string }>(
        'SELECT tx_hash FROM chain_checkouts WHERE tx_hash IS NOT NULL ORDER BY rowid DESC LIMIT 1',
      )?.tx_hash || null;
    res.json(state);
  });
  router.post('/defense/start', (req, res) => {
    if (!defenseRequestAllowed(req, enabled))
      throw new HttpError(403, 'The defense runner is local-only and disabled on shared servers.');
    z.object({}).strict().parse(req.body);
    if (state.phase !== 'idle')
      return res.status(409).json({ error: 'This isolated run has already started.' });
    void start().catch((error) => {
      state.phase = 'failed';
      state.error = error.message;
      event('error', state.error);
    });
    res.status(202).json(state);
  });
  router.post('/defense/evidence', async (req, res) => {
    if (!defenseRequestAllowed(req, enabled))
      throw new HttpError(403, 'Local defense runner required.');
    z.object({}).strict().parse(req.body);
    const proof = await escrowProof(chain);
    if (
      proof.status !== 'verified' ||
      !proof.orders.some((o) => o.licenseActive && o.withdrawals.length > 0) ||
      proof.checks.some((c) => !c.passed)
    )
      throw new HttpError(
        409,
        'The purchase, active license and withdrawal have not all verified.',
      );
    writeFileSync(join(output, 'on-chain-proof.json'), JSON.stringify(proof, null, 2));
    event(
      'proof',
      `Verified ${proof.checks.length} live EVM checks, active license and withdrawal.`,
    );
    res.json({ verified: true, runId: state.runId, proof });
  });
  router.post('/defense/stage', (req, res) => {
    if (!defenseRequestAllowed(req, enabled))
      throw new HttpError(403, 'Local defense runner required.');
    const { name } = z
      .object({ name: z.string().min(1).max(100) })
      .strict()
      .parse(req.body);
    if (!state.startedAt) throw new HttpError(409, 'Start the local run first.');
    event('stage', name);
    res.json({ ok: true });
  });
  return router;
}
