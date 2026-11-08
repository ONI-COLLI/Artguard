import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { startSession, startWindowSession, tokenHash, requireUser } from './auth.js';
import { HttpError } from './errors.js';
import type { Repository } from './repository.js';
import { siteSettings } from './technical.routes.js';
import { issueAccountToken } from './security.js';
import { acceptLegal } from './privacy.js';
import { LEGAL_VERSION } from '../shared/legal.js';

const providerSchema = z.enum(['google', 'facebook', 'github']);
type Provider = z.infer<typeof providerSchema>;
type Config = {
  provider: Provider;
  clientId: string;
  secret: string;
  origin: string;
  authorize: string;
  token: string;
  profile: string;
  scope: string;
  enabled: boolean;
};
export type OAuthTransport = typeof fetch;
export function oauthConfig(provider: Provider): Config {
  const prefix = provider.toUpperCase(),
    clientId = process.env[prefix + '_CLIENT_ID'] || '',
    secret = process.env[prefix + '_CLIENT_SECRET'] || '';
  const origin = process.env.OAUTH_BASE_URL || process.env.PUBLIC_ORIGIN || 'http://localhost:3000';
  const parsed = new URL(origin);
  if (
    parsed.origin !== origin ||
    !(
      parsed.protocol === 'https:' ||
      (parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname))
    )
  )
    throw new Error('OAUTH_BASE_URL must be an HTTPS origin or local HTTP origin.');
  const version = process.env.FACEBOOK_GRAPH_VERSION || '';
  const endpoints = {
    google: {
      authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
      token: 'https://oauth2.googleapis.com/token',
      profile: 'https://openidconnect.googleapis.com/v1/userinfo',
      scope: 'openid email profile',
    },
    facebook: {
      authorize: `https://www.facebook.com/${version}/dialog/oauth`,
      token: `https://graph.facebook.com/${version}/oauth/access_token`,
      profile: `https://graph.facebook.com/${version}/me`,
      scope: 'email,public_profile',
    },
    github: {
      authorize: 'https://github.com/login/oauth/authorize',
      token: 'https://github.com/login/oauth/access_token',
      profile: 'https://api.github.com/user',
      scope: 'read:user user:email',
    },
  };
  return {
    provider,
    clientId,
    secret,
    origin,
    ...endpoints[provider],
    enabled: !!clientId && !!secret && (provider !== 'facebook' || /^v\d{1,2}\.\d$/.test(version)),
  };
}
const callback = (config: Config) =>
  config.origin + '/api/auth/oauth/' + config.provider + '/callback';
const flowCookie = (state: string) => 'artguard_oauth_' + state.slice(0, 16);
const cookie = (req: { headers: { cookie?: string } }, name: string) =>
  req.headers.cookie
    ?.split(';')
    .map((v) => v.trim())
    .find((v) => v.startsWith(name + '='))
    ?.slice(name.length + 1) || '';
const options = {
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/api/auth/oauth',
  maxAge: 600000,
  secure: process.env.COOKIE_SECURE === 'true',
};
export function oauthRoutes(repo: Repository, transport: OAuthTransport = fetch) {
  const router = Router(),
    limit = rateLimit({
      windowMs: 15 * 60000,
      limit: 25,
      legacyHeaders: false,
      message: { error: 'Too many sign-in requests. Try again shortly.' },
    });
  router.get('/auth/providers', (req, res) =>
    res.json({
      providers: providerSchema.options.map((id) => {
        const config = oauthConfig(id);
        return {
          id,
          name: id === 'github' ? 'GitHub' : id[0].toUpperCase() + id.slice(1),
          enabled: config.enabled,
          connected:
            !!req.user &&
            !!repo.one(
              'SELECT 1 FROM oauth_identities WHERE provider=? AND user_id=?',
              id,
              req.user.id,
            ),
        };
      }),
    }),
  );
  router.post('/auth/oauth/:provider/start', limit, (req, res) => {
    const provider = providerSchema.parse(req.params.provider),
      config = oauthConfig(provider),
      { link } = z.object({ link: z.boolean().default(false) }).parse(req.body || {});
    if (!config.enabled)
      throw new HttpError(
        503,
        `${provider} sign-in is not configured. Ask the site owner to add the OAuth credentials.`,
      );
    const linkUser = link ? requireUser(req) : null;
    if (!linkUser && !req.user)
      z.object({ legalAccepted: z.literal(true), legalVersion: z.literal(LEGAL_VERSION) }).parse(
        req.body,
      );
    const context = req.headers['x-artguard-window'] ?? req.query.__window;
    if (
      context !== undefined &&
      (typeof context !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(context))
    )
      throw new HttpError(400, 'Invalid window context.');
    const state = randomBytes(32).toString('hex'),
      browser = randomBytes(32).toString('hex'),
      verifier = randomBytes(48).toString('base64url');
    repo.run('DELETE FROM oauth_states WHERE expires_at<?', Date.now());
    repo.run(
      'INSERT INTO oauth_states VALUES(?,?,?,?,?,?,?)',
      tokenHash(state),
      tokenHash(browser),
      provider,
      context || null,
      verifier,
      linkUser?.id || null,
      Date.now() + 600000,
    );
    res.cookie(flowCookie(state), browser, options);
    const url = new URL(config.authorize);
    for (const [key, value] of Object.entries({
      client_id: config.clientId,
      redirect_uri: callback(config),
      response_type: 'code',
      scope: config.scope,
      state,
    }))
      url.searchParams.set(key, value);
    if (provider !== 'facebook') {
      url.searchParams.set(
        'code_challenge',
        createHash('sha256').update(verifier).digest('base64url'),
      );
      url.searchParams.set('code_challenge_method', 'S256');
    }
    if (provider === 'google') url.searchParams.set('prompt', 'select_account');
    res.json({ url: url.toString() });
  });
  router.get('/auth/oauth/:provider/callback', limit, async (req, res) => {
    const provider = providerSchema.parse(req.params.provider),
      config = oauthConfig(provider);
    const state =
      typeof req.query.state === 'string' && /^[a-f0-9]{64}$/.test(req.query.state)
        ? req.query.state
        : '';
    const row = state
      ? repo.one<{
          browser_hash: string;
          provider: Provider;
          window_context: string | null;
          verifier: string;
          link_user_id: string | null;
          expires_at: number;
        }>('SELECT * FROM oauth_states WHERE state_hash=?', tokenHash(state))
      : undefined;
    const browser = cookie(req, flowCookie(state));
    if (
      !row ||
      row.provider !== provider ||
      row.expires_at < Date.now() ||
      !browser ||
      tokenHash(browser) !== row.browser_hash
    )
      throw new HttpError(
        400,
        'This sign-in request expired or belongs to another browser. Start again.',
      );
    repo.run('DELETE FROM oauth_states WHERE state_hash=?', tokenHash(state));
    res.clearCookie(flowCookie(state), options);
    const destination = new URL(config.origin + '/');
    if (row.window_context) destination.searchParams.set('window', row.window_context);
    const finish = (error?: string) => {
      destination.hash = '/oauth-result' + (error ? '?error=' + error : '?success=1');
      res.redirect(303, destination.toString());
    };
    if (req.query.error) return finish('cancelled');
    if (!config.enabled || typeof req.query.code !== 'string' || req.query.code.length > 4096)
      return finish('invalid');
    try {
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code: req.query.code,
        client_id: config.clientId,
        client_secret: config.secret,
        redirect_uri: callback(config),
      });
      if (provider !== 'facebook') body.set('code_verifier', row.verifier);
      const tokenResponse = await transport(config.token, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body,
        signal: AbortSignal.timeout(10000),
      });
      if (!tokenResponse.ok) return finish('provider');
      const token = (await tokenResponse.json()) as { access_token?: string };
      if (!token.access_token || token.access_token.length > 8192) return finish('provider');
      const profileUrl = new URL(config.profile);
      if (provider === 'facebook') {
        profileUrl.searchParams.set('fields', 'id,name,email');
        profileUrl.searchParams.set(
          'appsecret_proof',
          createHmac('sha256', config.secret).update(token.access_token).digest('hex'),
        );
      }
      const headers = {
        Authorization: 'Bearer ' + token.access_token,
        Accept: 'application/json',
        'User-Agent': 'ArtGuard-Local',
      };
      const response = await transport(profileUrl, { headers, signal: AbortSignal.timeout(10000) });
      if (!response.ok) return finish('provider');
      const profile = (await response.json()) as {
        id?: string | number;
        sub?: string;
        name?: string;
        login?: string;
        email?: string;
        email_verified?: boolean;
      };
      const subject = String(provider === 'google' ? profile.sub || '' : profile.id || '');
      if (!subject || subject.length > 256) return finish('provider');
      let email = profile.email;
      let trusted = provider === 'google' && profile.email_verified === true;
      if (provider === 'github') {
        const emails = await transport('https://api.github.com/user/emails', {
          headers,
          signal: AbortSignal.timeout(10000),
        });
        if (!emails.ok) return finish('email');
        const list = (await emails.json()) as {
          email: string;
          verified: boolean;
          primary: boolean;
        }[];
        email = list.find((e) => e.primary && e.verified)?.email;
        trusted = !!email;
      }
      const identity = repo.one<{ user_id: string }>(
        'SELECT user_id FROM oauth_identities WHERE provider=? AND subject=?',
        provider,
        subject,
      );
      let userId = identity?.user_id;
      if (row.link_user_id) {
        if (identity && identity.user_id !== row.link_user_id) return finish('linked');
        if (!repo.user(row.link_user_id)) return finish('invalid');
        if (
          repo.one(
            'SELECT 1 FROM oauth_identities WHERE provider=? AND user_id=? AND subject<>?',
            provider,
            row.link_user_id,
            subject,
          )
        )
          return finish('linked');
        userId = row.link_user_id;
      } else if (!identity) {
        if (!siteSettings(repo).registrationEnabled) return finish('registration');
        const parsed = z.email().safeParse(email);
        if (!parsed.success) return finish('email');
        email = parsed.data.toLowerCase();
        // Never merge an existing account solely because a provider reports the same email.
        if (repo.one('SELECT 1 FROM users WHERE email=?', email)) return finish('existing');
        userId = randomUUID();
      }
      if (!userId) return finish('invalid');
      repo.db.exec('BEGIN IMMEDIATE');
      try {
        if (!identity && !row.link_user_id) {
          const name =
            String(profile.name || profile.login || 'ArtGuard member')
              .trim()
              .slice(0, 80) || 'ArtGuard member';
          repo.run(
            'INSERT INTO users(id,name,email,password_hash,created_at) VALUES(?,?,?,?,?)',
            userId,
            name,
            email!,
            'oauth-only',
            new Date().toISOString(),
          );
          if (trusted) acceptLegal(repo, userId);
          if (trusted)
            repo.run(
              'INSERT INTO email_verifications VALUES(?,?,?)',
              userId,
              email!,
              new Date().toISOString(),
            );
        }
        repo.run(
          'INSERT OR IGNORE INTO oauth_identities VALUES(?,?,?,?)',
          provider,
          subject,
          userId,
          new Date().toISOString(),
        );
        repo.db.exec('COMMIT');
      } catch (error) {
        repo.db.exec('ROLLBACK');
        throw error;
      }
      if (!identity && !row.link_user_id && !trusted)
        issueAccountToken(repo, repo.user(userId), 'verify');
      if (row.window_context) startWindowSession(repo, res, userId, row.window_context);
      else startSession(repo, res, userId, req);
      finish();
    } catch {
      return finish('provider');
    }
  });
  return router;
}
