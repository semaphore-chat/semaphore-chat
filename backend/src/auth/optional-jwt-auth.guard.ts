import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Optional JWT authentication guard.
 *
 * Extends AuthGuard('jwt') directly (not JwtAuthGuard) so it always
 * attempts JWT validation regardless of @Public() metadata. If a valid
 * JWT is present, req.user is populated. If not, the request proceeds
 * with req.user unset (null) instead of throwing UnauthorizedException.
 *
 * Non-authentication errors (e.g. strategy/DB failures) are rethrown
 * so they aren't silently swallowed.
 *
 * Use this before guards that accept multiple auth methods (e.g. FileAuthGuard)
 * so they can check req.user without coupling to JwtAuthGuard.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest(err: any, user: any): any {
    if (err && !(err instanceof UnauthorizedException)) {
      throw err;
    }
    return user || null;
  }
}
