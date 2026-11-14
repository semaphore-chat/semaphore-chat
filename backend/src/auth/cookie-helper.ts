import { CookieOptions, Request, Response } from 'express';

export const REFRESH_TOKEN_COOKIE_NAME = 'refresh_token';

/**
 * The auth cookies' Secure flag, from COOKIE_SECURE:
 *   - auto (default): Secure when the request arrived over HTTPS
 *     (`req.secure`, which reads X-Forwarded-Proto from proxies trusted by
 *     TRUST_PROXY). A plain-HTTP LAN install keeps working, and a client
 *     that fakes the header only changes the flag on its own cookie.
 *   - true / false: always / never.
 */
export function isSecureCookieRequest(req: Request | undefined): boolean {
  const mode = process.env.COOKIE_SECURE?.toLowerCase();
  if (mode === 'true') return true;
  if (mode === 'false') return false;
  return req?.secure === true;
}

export const cookieConfig = {
  accessToken: {
    name: 'access_token',
    options: {
      path: '/',
      httpOnly: true,
      sameSite: 'lax' as const, // 'lax' allows cookies for same-site navigation and CORS GET requests
      maxAge: 1000 * 60 * 60, // 1 hour; must match Access JWT expiration.
    },
  },
  refreshToken: {
    name: REFRESH_TOKEN_COOKIE_NAME,
    options: {
      path: '/',
      httpOnly: true,
      sameSite: 'strict' as const,
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    },
  },
};

type AuthCookie = keyof typeof cookieConfig;

/** A cookie's attributes for this response's request, without maxAge. */
function attributes(res: Response, cookie: AuthCookie): CookieOptions {
  const { path, httpOnly, sameSite } = cookieConfig[cookie].options;
  return { path, httpOnly, sameSite, secure: isSecureCookieRequest(res.req) };
}

function setAuthCookie(res: Response, cookie: AuthCookie, value: string) {
  res.cookie(cookieConfig[cookie].name, value, {
    ...attributes(res, cookie),
    maxAge: cookieConfig[cookie].options.maxAge,
  });
}

/** Cleared with the attributes it was set with, so browsers match it. */
function clearAuthCookie(res: Response, cookie: AuthCookie) {
  res.clearCookie(cookieConfig[cookie].name, attributes(res, cookie));
}

export const setAccessTokenCookie = (res: Response, token: string) =>
  setAuthCookie(res, 'accessToken', token);

export const clearAccessTokenCookie = (res: Response) =>
  clearAuthCookie(res, 'accessToken');

export const setRefreshTokenCookie = (res: Response, token: string) =>
  setAuthCookie(res, 'refreshToken', token);

export const clearRefreshTokenCookie = (res: Response) =>
  clearAuthCookie(res, 'refreshToken');
