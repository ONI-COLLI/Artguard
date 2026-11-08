import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { readFileSync, writeFileSync, mkdirSync, createWriteStream } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { createPublicClient, http } from 'viem';
import { foundry } from 'viem/chains';

// A fresh, isolated teaching instance. Never touches data/, the public runtime or ports 3300/8555.
const output = resolve('artifacts/demo-video');
mkdirSync(output, { recursive: true });
const data = resolve('runtime', 'video-demo-' + Date.now());
mkdirSync(data, { recursive: true });
const events = [],
  children = [];
const started = Date.now();
function event(type, text, extra = {}) {
  const e = { at: new Date().toISOString(), elapsedMs: Date.now() - started, type, text, ...extra };
  events.push(e);
  writeFileSync(
    join(output, 'execution.ndjson'),
    events.map((v) => JSON.stringify(v)).join('\n') + '\n',
  );
  console.log(text);
}
const environment = {
  ...process.env,
  ARTGUARD_DATA_DIR: data,
  ARTGUARD_RPC_URL: 'http://127.0.0.1:8565',
  ARTGUARD_PUBLIC_DEMO: 'true',
  ARTGUARD_NODE_ACCOUNTS: '20',
  PORT: '3400',
  COOKIE_SECURE: 'false',
};
delete environment.PUBLIC_ORIGIN;
delete environment.OAUTH_BASE_URL;
delete environment.ARTGUARD_SOURCE_MANIFEST;
const npm =
  process.env.npm_execpath || join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
function launch(args, label, logEvents = false) {
  const stream = createWriteStream(join(output, label + '.log'));
  const child = spawn(process.execPath, args, {
    env: environment,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  let text = '';
  for (const s of [child.stdout, child.stderr])
    s.on('data', (chunk) => {
      stream.write(chunk);
      text += chunk;
      if (logEvents) event(label + '-output', String(chunk));
    });
  child.once('exit', () => stream.end());
  child.once('error', (e) => event('error', e.message));
  return { child, text: () => text };
}
async function freePort(port) {
  const s = createServer();
  await new Promise((done, reject) => s.once('error', reject).listen(port, '127.0.0.1', done));
  await new Promise((done) => s.close(done));
}
async function until(check, label) {
  for (let i = 0; i < 240; i++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('Timed out: ' + label);
}
async function stop() {
  for (const child of [...children].reverse()) {
    if (child.exitCode !== null) continue;
    if (process.platform === 'win32')
      await new Promise((done) => {
        const p = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
          stdio: 'ignore',
          windowsHide: true,
        });
        p.once('exit', done);
        p.once('error', done);
      });
    else child.kill('SIGTERM');
  }
  process.exit();
}
process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());
try {
  await freePort(8565);
  await freePort(3400);
  event('command', 'node scripts/video-demo.mjs');
  event('deployment-start', 'Starting a fresh local Anvil EVM: chain 31337, RPC 127.0.0.1:8565');
  const node = launch(['scripts/local-chain.mjs'], 'deploy', true);
  await until(async () => {
    if (node.child.exitCode !== null) throw new Error('Anvil deployment failed');
    return node.text().includes('Paid 7-day placements ready.');
  }, 'deployment');
  const client = createPublicClient({
      chain: foundry,
      transport: http(environment.ARTGUARD_RPC_URL),
    }),
    deployments = [];
  for (const [label, file] of [
    ['ArtworkRegistry', 'registry.json'],
    ['LicenseMarketplace v2', 'marketplace.json'],
    ['Timed licenses v3', 'term-marketplace.json'],
    ['EscrowLicenseMarketplace v4', 'escrow-marketplace.json'],
    ['SubscriptionPayments', 'subscriptions.json'],
    ['PromotionPayments', 'promotions.json'],
  ]) {
    let saved;
    try {
      saved = JSON.parse(readFileSync(join(data, 'chain', file), 'utf8'));
    } catch {
      continue;
    }
    const receipt = await client.getTransactionReceipt({ hash: saved.transactionHash }),
      code = await client.getCode({ address: saved.address });
    if (receipt.status !== 'success' || !code || code === '0x')
      throw new Error('Deployment proof failed: ' + label);
    const record = {
      name: label,
      address: saved.address,
      transactionHash: saved.transactionHash,
      blockNumber: String(receipt.blockNumber),
      status: receipt.status,
      bytecodeBytes: (code.length - 2) / 2,
    };
    deployments.push(record);
    event('deployment-confirmed', label + ' deployed at ' + saved.address, record);
  }
  event(
    'setup-start',
    'Provisioning fictional demo identities, wallets and a registered collaborative project.',
  );
  const setup = launch(['--import', 'tsx', 'scripts/demo-setup.ts'], 'setup');
  const exit = await new Promise((done) => setup.child.once('exit', done));
  if (exit !== 0) throw new Error('Demo fixture setup failed. See setup.log');
  const app = launch(['dist/server/server/index.js'], 'app');
  await until(async () => {
    if (app.child.exitCode !== null) throw new Error('App stopped');
    try {
      return (await fetch('http://127.0.0.1:3400/api/health')).ok;
    } catch {
      return false;
    }
  }, 'app');
  const profiles = await fetch('http://127.0.0.1:3400/api/demo/profiles').then((r) => r.json());
  const manifest = {
    createdAt: new Date().toISOString(),
    localUrl: 'http://127.0.0.1:3400',
    rpc: 'http://127.0.0.1:8565',
    data,
    deployments,
    project: profiles.project,
    profiles: profiles.profiles.map(({ key, wallet }) => ({ key, wallet })),
  };
  writeFileSync(join(output, 'evidence.json'), JSON.stringify(manifest, null, 2));
  event('app-ready', 'ArtGuard ready at http://127.0.0.1:3400');
  event('tests-command', 'npm run test:unit -- --maxWorkers=1 --no-file-parallelism');
  const tests = launch(
    [npm, 'run', 'test:unit', '--', '--maxWorkers=1', '--no-file-parallelism'],
    'unit-tests',
    true,
  );
  const code = await new Promise((done) => tests.child.once('exit', done));
  const plain = tests.text().replace(/\x1b\[[0-9;]*m/g, '');
  const match = plain.match(/Tests\s+(\d+)\s+passed/);
  event('tests-complete', code === 0 ? 'Unit tests passed' : 'Unit tests failed', {
    exitCode: code,
    passed: match ? Number(match[1]) : null,
  });
  manifest.tests = {
    command: 'npm run test:unit -- --maxWorkers=1 --no-file-parallelism',
    exitCode: code,
    passed: match ? Number(match[1]) : null,
  };
  writeFileSync(join(output, 'evidence.json'), JSON.stringify(manifest, null, 2));
  if (code !== 0) throw new Error('Unit tests did not pass.');
  event(
    'ready',
    'Recording instance stays running; its local URL and contracts are saved in evidence.json.',
  );
} catch (error) {
  event('error', error.message);
  await stop();
}
