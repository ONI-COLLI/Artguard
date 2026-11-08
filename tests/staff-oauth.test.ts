import { withLegalFixture } from './fixtures.ts';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { createApp } from '../server/app.ts';
import { Repository } from '../server/repository.ts';
import { verifiedFixture } from './fixtures.ts';

let app,
  repo,
  base,
  directory,
  profile = {
    sub: 'google-one',
    name: 'Google Member',
    email: 'google@oauth.test',
    email_verified: true,
  },
  calls = [];
const jar = new Map<string, string>();
async function request(
  path: string,
  data?: unknown,
  context?: string,
  method = data === undefined ? 'GET' : 'POST',
  cookies = jar,
) {
  const response = await fetch(base + '/api' + path, {
    method,
    redirect: 'manual',
    headers: {
      Cookie: [...cookies].map(([k, v]) => k + '=' + v).join('; '),
      ...(context ? { 'X-ArtGuard-Window': context } : {}),
      ...(data === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: data === undefined ? undefined : JSON.stringify(withLegalFixture(data)),
  });
  for (const c of response.headers.getSetCookie()) {
    const [pair] = c.split(';'),
      [key, ...rest] = pair.split('=');
    cookies.set(key, rest.join('='));
  }
  return {
    status: response.status,
    location: response.headers.get('location'),
    data: response.headers.get('content-type')?.includes('json')
      ? await response.json()
      : await response.text(),
  };
}
async function start(provider = 'google', context = 'oauth-window', link = false) {
  const r = await request('/auth/oauth/' + provider + '/start', { link }, context);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return new URL(r.data.url);
}
async function callback(url: URL, provider = 'google', cookies = jar) {
  return request(
    '/auth/oauth/' +
      provider +
      '/callback?state=' +
      url.searchParams.get('state') +
      '&code=synthetic-code',
    undefined,
    undefined,
    'GET',
    cookies,
  );
}
before(async () => {
  await mkdir(resolve('artifacts'), { recursive: true });
  directory = await mkdtemp(resolve('artifacts', 'staff-oauth-test-'));
  Object.assign(process.env, {
    OAUTH_BASE_URL: 'http://localhost:3000',
    GOOGLE_CLIENT_ID: 'google-client',
    GOOGLE_CLIENT_SECRET: 'local-google-secret',
    GITHUB_CLIENT_ID: 'github-client',
    GITHUB_CLIENT_SECRET: 'local-github-secret',
    FACEBOOK_CLIENT_ID: 'facebook-client',
    FACEBOOK_CLIENT_SECRET: 'local-facebook-secret',
    FACEBOOK_GRAPH_VERSION: 'v99.0',
  });
  const transport = async (url, options) => {
    calls.push({ url: String(url), options });
    const target = String(url);
    if (target.includes('access_token') || target.includes('/token'))
      return Response.json({ access_token: 'synthetic-access-token' });
    if (target.endsWith('/user/emails'))
      return Response.json([{ email: 'github@oauth.test', verified: true, primary: true }]);
    return Response.json(profile);
  };
  const chain: any = {
    status: async () => ({
      ready: false,
      chainId: 31337,
      message: 'Node offline',
      deployment: null,
    }),
  };
  app = await createApp({
    dataDir: directory,
    serveClient: false,
    oauthTransport: transport,
    blockchain: chain,
  });
  repo = new Repository(app.db);
  await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + app.server.address().port;
});
after(async () => {
  await app?.close();
  assert.ok(resolve(directory).startsWith(resolve('artifacts') + sep));
  await rm(directory, { recursive: true, force: true });
});
test('guests have no catalog and provider discovery exposes no credentials', async () => {
  assert.deepEqual((await request('/state')).data.artworks, []);
  assert.equal((await request('/home')).data.featured, null);
  const p = await request('/auth/providers');
  assert.equal(p.data.providers.length, 3);
  assert.equal(
    p.data.providers.every((p) => p.enabled),
    true,
  );
  assert.equal(JSON.stringify(p).includes('secret'), false);
  assert.equal(calls.length, 0);
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.GOOGLE_CLIENT_SECRET;
  assert.equal((await request('/auth/providers')).data.providers[0].enabled, false);
  assert.equal((await request('/auth/oauth/google/start', {})).status, 503);
  process.env.GOOGLE_CLIENT_SECRET = secret;
});
test('OAuth state requires its browser cookie, is single use, and PKCE binds the exchange', async () => {
  const url = await start(),
    state = url.searchParams.get('state')!;
  assert.equal(url.origin, 'https://accounts.google.com');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal((await callback(url, 'google', new Map())).status, 400);
  assert.equal(calls.length, 0);
  const result = await callback(url);
  assert.equal(result.status, 303);
  assert.ok(result.location.includes('window=oauth-window'));
  assert.ok(result.location.endsWith('success=1'));
  const tokenCall = calls.find((c) => c.url.includes('/token')),
    body = tokenCall.options.body;
  assert.equal(
    createHash('sha256').update(body.get('code_verifier')).digest('base64url'),
    url.searchParams.get('code_challenge'),
  );
  assert.equal(body.get('client_secret'), 'local-google-secret');
  assert.equal(body.get('redirect_uri'), 'http://localhost:3000/api/auth/oauth/google/callback');
  assert.equal((await callback(url)).status, 400);
  const user = (await request('/state', undefined, 'oauth-window')).data.user;
  assert.equal(user.emailVerified, true);
  assert.equal(user.wallet, null);
  assert.equal(user.isAdmin, false);
  assert.equal(user.isManager, false);
  assert.equal(user.role, 'Creator and buyer');
  assert.equal((await request('/state', undefined, 'another-window')).data.user, null);
  assert.equal(repo.one('SELECT count(*) n FROM oauth_states').n, 0);
  assert.equal(
    repo.one('SELECT subject FROM oauth_identities WHERE user_id=?', user.id).subject,
    profile.sub,
  );
  assert.equal(
    [...jar.keys()].some((k) => k === 'artguard_session_window_oauth-window'),
    true,
  );
});
test('email collisions never merge accounts, explicit linking preserves the original account', async () => {
  profile = { ...profile, sub: 'google-second' };
  const collision = await callback(await start());
  assert.ok(collision.location.endsWith('error=existing'));
  const id = (await request('/state', undefined, 'oauth-window')).data.user.id;
  assert.equal(
    (await request('/auth/oauth/google/start', { link: true }, 'anonymous-window')).status,
    401,
  );
  const cannotLinkSecond = await callback(await start('google', 'oauth-window', true));
  assert.ok(cannotLinkSecond.location.endsWith('error=linked'));
  profile = { id: 881, name: 'GitHub Member', login: 'member', email: null } as any;
  const linked = await callback(await start('github', 'oauth-window', true), 'github');
  assert.ok(linked.location.endsWith('success=1'));
  assert.equal((await request('/state', undefined, 'oauth-window')).data.user.id, id);
  assert.equal(
    (await request('/auth/providers', undefined, 'oauth-window')).data.providers.find(
      (p) => p.id === 'github',
    ).connected,
    true,
  );
});
test('Facebook email is unverified locally and receives a verification message', async () => {
  profile = { id: 'facebook-1', name: 'Facebook Member', email: 'facebook@oauth.test' } as any;
  const result = await callback(await start('facebook', 'fb-window'), 'facebook');
  assert.ok(result.location.endsWith('success=1'));
  const user = (await request('/state', undefined, 'fb-window')).data.user;
  assert.equal(user.emailVerified, false);
  assert.equal(repo.one('SELECT count(*) n FROM local_mail WHERE email=?', user.email).n, 1);
  const call = calls.find((c) => c.url.includes('graph.facebook.com') && c.url.includes('/me?'));
  assert.ok(new URL(call.url).searchParams.get('appsecret_proof'));
  assert.equal(call.options.headers.Authorization, 'Bearer synthetic-access-token');
});
test('manager finances and technical administration require separate verified permissions', async () => {
  for (const name of ['tech', 'manager', 'member']) {
    const r = await request(
      '/auth/register',
      { name, email: name + '@staff.test', password: 'StaffFixture!2026' },
      name,
    );
    assert.equal(r.status, 201);
    verifiedFixture(app.db, r.data.user);
    if (name === 'tech')
      repo.run('INSERT INTO admin_accounts VALUES(?,?)', r.data.user.id, new Date().toISOString());
    if (name === 'manager')
      repo.run(
        'INSERT INTO manager_accounts VALUES(?,?)',
        r.data.user.id,
        new Date().toISOString(),
      );
  }
  for (const path of [
    '/manager/accounting',
    '/admin/accounting',
    '/manager/accounting/export',
    '/admin/blockchain-demo',
  ]) {
    assert.equal((await request(path, undefined, 'tech')).status, 403, path);
    assert.equal((await request(path, undefined, 'member')).status, 403, path);
    assert.equal((await request(path, undefined, 'anonymous-window')).status, 401, path);
  }
  assert.equal((await request('/manager/accounting', undefined, 'manager')).status, 200);
  assert.equal((await request('/admin/technical', undefined, 'manager')).status, 403);
  const technical = await request('/admin/technical', undefined, 'tech');
  assert.equal(technical.status, 200);
  assert.equal(technical.data.totals, undefined);
  assert.equal(technical.data.staff.length >= 3, true);
  const member = (await request('/state', undefined, 'member')).data.user;
  assert.equal(
    (await request('/admin/technical/managers/' + member.id, { enabled: true }, 'manager', 'PATCH'))
      .status,
    403,
  );
  assert.equal(
    (await request('/admin/technical/managers/' + member.id, { enabled: true }, 'tech', 'PATCH'))
      .status,
    200,
  );
  assert.equal((await request('/state', undefined, 'member')).data.user.isManager, true);
  assert.equal(
    (await request('/admin/technical/managers/' + member.id, { enabled: false }, 'tech', 'PATCH'))
      .status,
    200,
  );
  assert.equal((await request('/manager/accounting', undefined, 'member')).status, 403);
});
test('technical toggles affect new registrations and uploads; existing users still sign in', async () => {
  const settings = { registrationEnabled: false, uploadsEnabled: false };
  assert.equal(
    (await request('/admin/technical/settings', settings, 'manager', 'PATCH')).status,
    403,
  );
  assert.equal((await request('/admin/technical/settings', settings, 'tech', 'PATCH')).status, 200);
  assert.equal(
    (
      await request(
        '/auth/register',
        { name: 'Paused', email: 'paused@staff.test', password: 'StaffFixture!2026' },
        'paused',
      )
    ).status,
    503,
  );
  assert.equal((await request('/artworks', {}, 'member')).status, 503);
  profile = {
    sub: 'paused-google',
    name: 'Paused',
    email: 'paused@oauth.test',
    email_verified: true,
  };
  assert.ok(
    (await callback(await start('google', 'paused'))).location.endsWith('error=registration'),
  );
  assert.equal(
    (
      await request(
        '/auth/login',
        { email: 'member@staff.test', password: 'StaffFixture!2026' },
        'member',
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await request(
        '/admin/technical/settings',
        { registrationEnabled: true, uploadsEnabled: true },
        'tech',
        'PATCH',
      )
    ).status,
    200,
  );
});
