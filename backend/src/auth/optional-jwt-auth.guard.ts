import { Injectable, Optional, UnauthorizedException } from '@nestjs/common';
import { AuthGuard, AuthModuleOptions } from '@nestjs/passport';
import { UserEntity } from '@/user/dto/user-response.dto';

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
  // Nest 12 no longer lets a subclass inherit its parent's @Optional()
  // constructor markers (see the v12 migration guide), so without this
  // constructor Nest would require AuthModuleOptions in every module that
  // provides this guard (FileModule doesn't import PassportModule) and fail
  // to boot. Re-declaring it keeps the v11 behavior on every 12.x release.
  constructor(@Optional() options?: AuthModuleOptions) {
    super(options);
  }

  handleRequest<TUser = UserEntity>(
    err: Error | null,
    user: TUser | false,
  ): TUser | null {
    if (err && !(err instanceof UnauthorizedException)) {
      throw err;
    }
    return user || null;
  }
}
