import type { Request, Response, NextFunction } from 'express';
import { HttpError } from './errors.js';
export const publicDemo = () => process.env.ARTGUARD_PUBLIC_DEMO === 'true';
export function publicOrigin() {
  const value = process.env.PUBLIC_ORIGIN;
  if (!value) return null;
  const url = new URL(value);
  if (url.origin !== value || url.protocol !== 'https:')
    throw new Error('PUBLIC_ORIGIN must be an exact HTTPS origin.');
  return url;
}
export function hostingGuard() {
  const origin = publicOrigin();
  return (req: Request, res: Response, next: NextFunction) => {
    res.set('Cache-Control', 'no-store');
    const host = req.headers.host || '';
    const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
    if (!local && host !== origin?.host)
      return next(new HttpError(403, 'This hostname is not configured for ArtGuard.'));
    // Public RPC uses signed transactions rather than cookie authority. Other writes stay same-origin.
    if (['POST', 'PATCH', 'DELETE'].includes(req.method) && !(origin && req.path === '/rpc')) {
      const requestOrigin = req.headers.origin;
      const valid =
        requestOrigin === origin?.origin ||
        requestOrigin === `http://${host}` ||
        requestOrigin === `https://${host}`;
      if ((requestOrigin && !valid) || req.headers['sec-fetch-site'] === 'cross-site')
        return next(new HttpError(403, 'Cross-site requests are not allowed.'));
    }
    next();
  };
}
