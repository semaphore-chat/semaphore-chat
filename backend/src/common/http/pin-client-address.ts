import type { NextFunction, Request, Response } from 'express';

/**
 * Express middleware that keeps the request's client address (`req.ip`) as
 * it was when the request arrived. Register it before any other middleware.
 *
 * `req.ip` is computed again on every read from the connection's remote
 * address (and X-Forwarded-For, per TRUST_PROXY). Once the connection
 * closes, Node forgets that address unless something read it while the
 * connection was open; a read after the close returns `undefined`. A client
 * can go away while its request is still being handled, e.g. a page reload
 * that aborts the page's token refresh. That refresh still rotated the token
 * and stored its successor with no IP address. When the reloaded page
 * presented the old token again within the grace window, its client didn't
 * match the successor's (an unknown address matches nothing, see
 * isSameClient), so the refresh looked like a stolen token and its session
 * was revoked: the user was signed out (#567).
 */
export function pinClientAddress(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  // An own property shadows Express's getter on the request prototype
  Object.defineProperty(req, 'ip', {
    value: req.ip,
    enumerable: true,
    configurable: true,
  });
  next();
}
