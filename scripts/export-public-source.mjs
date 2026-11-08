import { resolve, join, relative, sep } from 'node:path';
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  lstatSync,
  existsSync,
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { sourceZip } from './source-archive.mjs';
const root = process.cwd(),
  data = resolve(process.env.ARTGUARD_DATA_DIR || 'runtime/public-demo');
if (data === resolve('data') || !data.startsWith(resolve('runtime') + sep))
  throw new Error('Export source only into the isolated public runtime directory.');
const output = join(data, 'source-' + randomUUID());
mkdirSync(output, { recursive: true });
const roots = ['src', 'server', 'shared', 'contracts', 'scripts', 'tests', 'docs', '.github'];
const rootFiles = [
  'package.json',
  'package-lock.json',
  'index.html',
  'README.md',
  'CONTRIBUTING.md',
  'LICENSE',
  'THIRD_PARTY_NOTICES.md',
  '.env.example',
  '.gitignore',
  '.gitattributes',
  'vite.config.ts',
  'vitest.config.ts',
  'tsconfig.json',
  'tsconfig.server.json',
  'Dockerfile',
  '.dockerignore',
  'compose.public.yaml',
];
const allowed = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.css',
  '.json',
  '.html',
  '.md',
  '.sol',
  '.yaml',
  '.yml',
  '.txt',
]);
const files = [];
function add(path) {
  const info = lstatSync(path);
  if (info.isSymbolicLink())
    throw new Error('Symlinks are not allowed in the public source snapshot.');
  if (info.isDirectory()) {
    for (const name of readdirSync(path)) add(join(path, name));
    return;
  }
  const name = relative(root, path).replaceAll('\\', '/');
  if (!roots.some((r) => name.startsWith(r + '/')) && !rootFiles.includes(name)) return;
  if (
    /(^|\/)(node_modules|data|runtime|artifacts|dist|\.git)(\/|$)|\.private\.|\.sqlite|\.(png|jpg|jpeg|webp|zip|exe|glb|obj)$/i.test(
      name,
    )
  )
    throw new Error('Runtime or binary data must not enter the public source archive: ' + name);
  if (!rootFiles.includes(name) && !allowed.has(name.slice(name.lastIndexOf('.')))) return;
  const bytes = readFileSync(path);
  if (
    /(?:^|\n)-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\r?\n[A-Za-z0-9+/=]{20,}/.test(
      bytes.toString('utf8'),
    )
  )
    throw new Error('A private key was detected in source: ' + name);
  const target = join(output, name);
  mkdirSync(resolve(target, '..'), { recursive: true });
  writeFileSync(target, bytes);
  files.push({ path: name, bytes, sha256: createHash('sha256').update(bytes).digest('hex') });
}
for (const name of roots) if (existsSync(join(root, name))) add(join(root, name));
for (const name of rootFiles) if (existsSync(join(root, name))) add(join(root, name));
files.sort((a, b) => a.path.localeCompare(b.path));
const archive = sourceZip(files),
  zipPath = join(output, 'artguard-source.zip');
writeFileSync(zipPath, archive);
const revision = createHash('sha256')
  .update(files.map((f) => f.path + '\0' + f.sha256).join('\n'))
  .digest('hex');
const manifest = {
  directory: output,
  archive: zipPath,
  revision,
  createdAt: new Date().toISOString(),
  archiveSha256: createHash('sha256').update(archive).digest('hex'),
  files: files.map((f) => ({ path: f.path, sha256: f.sha256, size: f.bytes.length })),
  scope:
    'ArtGuard application, smart contracts, tests and deployment instructions. Runtime data and unrelated 3D demo assets are excluded.',
};
const file = join(data, 'source-manifest.private.json');
writeFileSync(file, JSON.stringify(manifest, null, 2));
console.log(
  JSON.stringify({ files: files.length, revision, archiveBytes: archive.length, manifest: file }),
);
