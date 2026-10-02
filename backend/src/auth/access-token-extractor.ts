import { ExtractJwt } from 'passport-jwt';
import type { Request } from 'express';

const fromBearerHeader = ExtractJwt.fromAuthHeaderAsBearerToken();

/**
 * Where a REST request's access token comes from, in order: the
 * Authorization header, then the `access_token` cookie (same-origin browser
 * requests). JwtStrategy authenticates with it, and code that needs a claim
 * JwtStrategy doesn't put on `req.user` (e.g. the session id, `sid`) reads
 * the same token with it.
 */
export function extractAccessToken(req: Request): string | null {
  const cookies = req?.cookies as Record<string, string> | undefined;
  return fromBearerHeader(req) || cookies?.access_token || null;
}
