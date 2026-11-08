import { withLegalFixture } from './fixtures.ts';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { createApp } from '../server/app.ts';
import { verifiedFixture, planFixture } from './fixtures.ts';

let app: Awaited<ReturnType<typeof createApp>>, base: string, directory: string;
const image = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1MAAAAASUVORK5CYII=',
  'base64',
);
function client() {
  let cookie = '';
  return async (route: string, method = 'GET', data?: unknown) => {
    const response = await fetch(base + route, {
      method,
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(data !== undefined && !(data instanceof FormData)
          ? { 'Content-Type': 'application/json' }
          : {}),
      },
      body:
        data === undefined
          ? undefined
          : data instanceof FormData
            ? data
            : JSON.stringify(withLegalFixture(data)),
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    return response;
  };
}
const owner = client(),
  stranger = client(),
  guest = client();
async function start() {
  app = await createApp({ dataDir: directory, serveClient: false });
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
}
before(async () => {
  directory = await mkdtemp(path.resolve('artifacts/gallery-test-'));
  await start();
  for (const [actor, email] of [
    [owner, 'gallery-owner@example.test'],
    [stranger, 'gallery-stranger@example.test'],
  ] as const) {
    const response = await actor('/api/auth/register', 'POST', {
      name: 'Gallery tester',
      email,
      password: 'GalleryTest!2026',
    });
    assert.equal(response.status, 201);
    const state = await response.json();
    verifiedFixture(app.db, state.user);
    planFixture(app.db, state.user.id, 'premium');
  }
});
after(async () => {
  await app?.close();
  if (directory && path.resolve(directory).startsWith(path.resolve('artifacts') + path.sep))
    await rm(directory, { recursive: true, force: true });
});
function upload(count = 2, status = 'published') {
  const form = new FormData();
  form.append(
    'file',
    new Blob([Buffer.concat([image, Buffer.from(randomUUID())])], { type: 'image/png' }),
    'original.png',
  );
  form.append('title', 'Gallery project');
  form.append('description', 'Detailed photos of an original artwork.');
  form.append('category', 'Illustration');
  form.append('price', '12');
  form.append('licenses', 'personal');
  form.append('rights', 'true');
  form.append('status', status);
  for (let i = 0; i < count; i++)
    form.append('gallery', new Blob([image], { type: 'image/png' }), `detail-${i}.png`);
  return form;
}
async function create(count = 2, status = 'published') {
  const response = await owner('/api/artworks', 'POST', upload(count, status));
  const state = await response.json();
  assert.equal(response.status, 201, JSON.stringify(state));
  return state.artwork;
}
test('saves photos at upload and keeps the original fingerprint and gallery across edits and restart', async () => {
  const artwork = await create();
  assert.equal(artwork.gallery.length, 2);
  for (const photo of artwork.gallery) {
    const response = await guest(photo.url);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/webp');
    assert.notDeepEqual(Buffer.from(await response.arrayBuffer()), image);
  }
  assert.equal(
    (await owner(`/api/artworks/${artwork.id}`, 'PATCH', { title: 'Updated gallery title' }))
      .status,
    200,
  );
  await app.close();
  await start();
  const state = await (await owner('/api/state')).json(),
    saved = state.artworks.find((item) => item.id === artwork.id);
  assert.deepEqual(saved.gallery, artwork.gallery);
  assert.equal(saved.hash, artwork.hash);
  assert.equal(saved.title, 'Updated gallery title');
  assert.equal((await owner(`/api/artworks/${artwork.id}/download`)).status, 200);
});
test('edits gallery photos atomically without replacing the licensed original', async () => {
  const artwork = await create(),
    original = Buffer.from(await (await owner(artwork.image)).arrayBuffer());
  const form = new FormData();
  form.append('retainedGallery', JSON.stringify([artwork.gallery[1].id]));
  form.append('gallery', new Blob([image], { type: 'image/png' }), 'new-detail.png');
  const response = await owner(`/api/artworks/${artwork.id}`, 'PATCH', form);
  assert.equal(response.status, 200);
  const state = await response.json(),
    updated = state.artworks.find((item) => item.id === artwork.id);
  assert.equal(updated.gallery.length, 2);
  assert.equal(updated.gallery[0].id, artwork.gallery[1].id);
  assert.notEqual(updated.gallery[1].id, artwork.gallery[0].id);
  assert.equal(updated.hash, artwork.hash);
  assert.deepEqual(Buffer.from(await (await owner(artwork.image)).arrayBuffer()), original);
  assert.equal((await guest(artwork.gallery[0].url)).status, 404);
  assert.equal(
    (await owner(`/api/artworks/${artwork.id}`, 'PATCH', { retainedGallery: [] })).status,
    200,
  );
  for (const photo of updated.gallery) assert.equal((await owner(photo.url)).status, 404);
});
test('rejects malformed files and foreign gallery IDs without partial metadata or disk changes', async () => {
  const first = await create(),
    other = await create();
  const before = (await readdir(path.join(directory, 'uploads'))).sort();
  const invalid = upload(1);
  invalid.append('gallery', new Blob(['not an image'], { type: 'image/png' }), 'fake.png');
  assert.equal((await owner('/api/artworks', 'POST', invalid)).status, 400);
  assert.deepEqual((await readdir(path.join(directory, 'uploads'))).sort(), before);
  const patch = new FormData();
  patch.append('title', 'Should not be saved');
  patch.append('retainedGallery', JSON.stringify([other.gallery[0].id]));
  patch.append('gallery', new Blob([image], { type: 'image/png' }), 'extra.png');
  assert.equal((await owner(`/api/artworks/${first.id}`, 'PATCH', patch)).status, 400);
  assert.equal(
    app.db.prepare('SELECT title FROM artworks WHERE id=?').get(first.id)?.title,
    first.title,
  );
  assert.deepEqual((await readdir(path.join(directory, 'uploads'))).sort(), before);
});
test('enforces seven additional photos and the per-photo size limit', async () => {
  const before = (await readdir(path.join(directory, 'uploads'))).sort();
  assert.equal((await owner('/api/artworks', 'POST', upload(8))).status, 400);
  const oversized = upload(0);
  const bytes = Buffer.alloc(10 * 1024 * 1024 + 1);
  image.copy(bytes);
  oversized.append('gallery', new Blob([bytes], { type: 'image/png' }), 'oversized.png');
  assert.equal((await owner('/api/artworks', 'POST', oversized)).status, 400);
  assert.deepEqual((await readdir(path.join(directory, 'uploads'))).sort(), before);
  const artwork = await create(7),
    patch = new FormData();
  patch.append('gallery', new Blob([image], { type: 'image/png' }), 'eighth.png');
  assert.equal((await owner(`/api/artworks/${artwork.id}`, 'PATCH', patch)).status, 400);
  assert.equal(
    (await (await owner('/api/state')).json()).artworks.find((item) => item.id === artwork.id)
      .gallery.length,
    7,
  );
});
test('protects private gallery photos and removes associated files on project deletion', async () => {
  const artwork = await create(2, 'draft'),
    other = await create(0);
  assert.equal((await owner(artwork.gallery[0].url)).status, 200);
  assert.equal((await guest(artwork.gallery[0].url)).status, 404);
  assert.equal((await stranger(artwork.gallery[0].url)).status, 404);
  assert.equal((await owner(`/media/${other.id}/gallery/${artwork.gallery[0].id}`)).status, 404);
  assert.equal(
    (await stranger(`/api/artworks/${artwork.id}`, 'PATCH', { retainedGallery: [] })).status,
    404,
  );
  const rows = app.db
    .prepare('SELECT file_name FROM artwork_images WHERE artwork_id=?')
    .all(artwork.id);
  assert.equal((await owner(`/api/artworks/${artwork.id}`, 'DELETE')).status, 200);
  assert.equal(
    app.db.prepare('SELECT count(*) AS n FROM artwork_images WHERE artwork_id=?').get(artwork.id)
      ?.n,
    0,
  );
  const files = await readdir(path.join(directory, 'uploads'));
  for (const row of rows) assert.equal(files.includes(String(row.file_name)), false);
});
