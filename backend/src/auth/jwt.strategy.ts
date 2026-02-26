import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '@/database/database.service';
import { TokenBlacklistService } from './token-blacklist.service';
import { Request } from 'express';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly databaseService: DatabaseService,
    private readonly tokenBlacklistService: TokenBlacklistService,
  ) {
    const jwtSecret = configService.get<string>('JWT_SECRET');
    if (!jwtSecret) {
      throw new Error('JWT_SECRET not set');
    }

    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        // Primary: Authorization header
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        // Fallback 1: Query parameter — ONLY for file-serving routes
        // This allows URLs like /api/file/123?token=<jwt> for embedded <img>/<video> tags
        // Restricted to file routes to prevent token leakage via browser history, logs, and Referer headers
        // Must check both /file/ and /api/file/ because req.path varies by client:
        //   - Web (via Vite proxy): req.path = /file/...  (proxy strips /api prefix)
        //   - Electron (direct):    req.path = /api/file/... (full path)
        // Must run BEFORE cookie extractor so an explicit ?token= always takes precedence
        // over a potentially stale httpOnly access_token cookie the browser can't clear
        (req: Request): string | null => {
          const path = req?.path || '';
          const isFileRoute =
            path.startsWith('/file/') || path.startsWith('/api/file/');
          if (!isFileRoute) {
            return null;
          }
          const token = req?.query?.token;
          if (typeof token === 'string' && token.length > 0) {
            return token;
          }
          return null;
        },
        // Fallback 2: Cookie (for same-origin browser requests)
        (req: Request): string | null => {
          const cookies = req?.cookies as Record<string, string> | undefined;
          return cookies?.access_token || null;
        },
      ]),
      ignoreExpiration: false,
      secretOrKey: jwtSecret,
    });
  }

  async validate(payload: { sub: string; username: string; jti?: string }) {
    // Check if the access token has been revoked (e.g., after logout)
    if (payload.jti) {
      const isBlacklisted = await this.tokenBlacklistService.isBlacklisted(
        payload.jti,
      );
      if (isBlacklisted) {
        throw new UnauthorizedException('Token has been revoked');
      }
    }

    const user = await this.databaseService.user.findUniqueOrThrow({
      where: { id: payload.sub },
    });

    if (user.banned) {
      throw new UnauthorizedException('Account has been banned');
    }

    return user;
  }
}
