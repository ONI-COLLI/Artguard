import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, access, rename } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { resolve, join, dirname } from 'node:path';

// One supervisor owns only its own children. Local ports 3000/8545 and data/ are never used.
const directory = resolve('runtime/public-demo'),
  tools = resolve('artifacts/tools');
await mkdir(directory, { recursive: true });
await mkdir(tools, { recursive: true });
const children = [];
let stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of [...children].reverse()) {
    if (child.exitCode !== null) continue;
    if (process.platform === 'win32')
      await new Promise((done) => {
        const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        });
        killer.once('exit', done);
        killer.once('error', done);
      });
    else child.kill('SIGTERM');
  }
  process.exit(code);
}
process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());
function launch(command, args, label, collect = false) {
  const log = createWriteStream(join(directory, label + '.log'), { flags: 'a' });
  const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  let output = '';
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (chunk) => {
      log.write(chunk);
      if (collect) output = (output + chunk).slice(-50000);
    });
  child.on('error', (error) => {
    console.error(label + ': ' + error.message);
    void stop(1);
  });
  return { child, output: () => output };
}
async function runNode(args, label) {
  const { child } = launch(process.execPath, args, label);
  const code = await new Promise((done) => child.once('exit', done));
  if (code !== 0) throw new Error(label + ' failed. See ' + join(directory, label + '.log'));
}
async function waitFor(check, label) {
  for (let n = 0; n < 240; n++) {
    if (stopping) throw new Error('Stopped.');
    if (await check()) return;
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error('Timed out waiting for ' + label);
}
async function freePort(port) {
  const server = createServer();
  await new Promise((done, reject) => server.once('error', reject).listen(port, '127.0.0.1', done));
  await new Promise((done) => server.close(done));
}
async function cloudflared() {
  if (process.platform !== 'win32')
    throw new Error(
      'This PC launcher currently targets Windows. See docs/PUBLIC_HOSTING.md for manual hosting.',
    );
  const file = join(tools, 'cloudflared.exe'),
    metadata = join(tools, 'cloudflared-release.json');
  try {
    await access(file);
    const meta = JSON.parse(await readFile(metadata, 'utf8'));
    const actual = createHash('sha256')
      .update(await readFile(file))
      .digest('hex');
    if ((meta.sha256 || meta.digest?.replace('sha256:', '')) !== actual)
      throw new Error('Cloudflared checksum does not match its release metadata.');
    return file;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const response = await fetch(
    'https://api.github.com/repos/cloudflare/cloudflared/releases/latest',
    { headers: { 'User-Agent': 'ArtGuard-public-test-server' } },
  );
  if (!response.ok) throw new Error('Cannot obtain the official cloudflared release.');
  const release = await response.json(),
    asset = release.assets.find((a) => a.name === 'cloudflared-windows-amd64.exe');
  if (!asset?.digest?.startsWith('sha256:'))
    throw new Error('The official release did not provide a SHA-256 digest.');
  const download = await fetch(asset.browser_download_url);
  if (!download.ok) throw new Error('Cloudflared download failed.');
  const bytes = Buffer.from(await download.arrayBuffer()),
    sha256 = createHash('sha256').update(bytes).digest('hex');
  if ('sha256:' + sha256 !== asset.digest)
    throw new Error('Downloaded cloudflared checksum is invalid.');
  await writeFile(file + '.download', bytes);
  await rename(file + '.download', file);
  await writeFile(
    metadata,
    JSON.stringify({ version: release.tag_name, url: asset.browser_download_url, sha256 }, null, 2),
  );
  return file;
}
try {
  await freePort(3300);
  await freePort(8555);
  const executable = await cloudflared();
  const npm =
    process.env.npm_execpath || join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  console.log('Building ArtGuard and exporting the public source snapshot…');
  await runNode([npm, 'run', 'build'], 'build');
  await runNode(['scripts/export-public-source.mjs'], 'source-export');
  const chain = launch(
    process.execPath,
    ['--import', 'tsx', 'scripts/run-public.mjs', 'chain'],
    'chain',
    true,
  );
  await waitFor(async () => {
    if (chain.child.exitCode !== null)
      throw new Error('Public chain failed. Read runtime/public-demo/chain.log');
    return (
      chain.output().includes('Paid 7-day placements ready.') ||
      chain.output().includes('Paid 7-day placements') ||
      chain.output().includes('Paid 7-day')
    );
  }, 'contract deployment');
  await runNode(['--import', 'tsx', 'scripts/run-public.mjs', 'setup'], 'setup');
  const tunnel = launch(
    executable,
    ['--no-autoupdate', 'tunnel', '--url', 'http://127.0.0.1:3300', '--protocol', 'http2'],
    'tunnel',
    true,
  );
  let publicOrigin;
  await waitFor(async () => {
    if (tunnel.child.exitCode !== null)
      throw new Error('HTTPS tunnel failed. Read runtime/public-demo/tunnel.log');
    publicOrigin = tunnel.output().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)?.[0];
    return !!publicOrigin;
  }, 'public HTTPS address');
  await writeFile(
    join(directory, 'runtime.json'),
    JSON.stringify(
      { publicOrigin, appPort: 3300, rpcPort: 8555, createdAt: new Date().toISOString() },
      null,
      2,
    ),
  );
  const app = launch(process.execPath, ['--import', 'tsx', 'scripts/run-public.mjs', 'app'], 'app');
  await waitFor(async () => {
    if (app.child.exitCode !== null)
      throw new Error('Public app failed. Read runtime/public-demo/app.log');
    try {
      return (await fetch('http://127.0.0.1:3300/api/health')).ok;
    } catch {
      return false;
    }
  }, 'web server');
  console.log(
    'Public ArtGuard: ' +
      publicOrigin +
      '\nCode: ' +
      publicOrigin +
      '/code\nStop: Ctrl+C. This temporary URL works while this process and PC remain running.',
  );
  for (const { child, label } of [
    { child: chain.child, label: 'chain' },
    { child: tunnel.child, label: 'tunnel' },
    { child: app.child, label: 'app' },
  ])
    child.once('exit', (code) => {
      if (!stopping) {
        console.error(label + ' stopped (' + code + '). Stopping the public stack.');
        void stop(1);
      }
    });
} catch (error) {
  console.error(error.message);
  await stop(1);
}
