import { Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '@/database/database.service';
import {
  AccessTokenClaims,
  TokenBlacklistService,
} from './token-blacklist.service';
import { PUBLIC_USER_SELECT } from '@/common/constants/user-select.constant';
import { extractAccessToken } from './access-token-extractor';

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
      jwtFromRequest: extractAccessToken,
      ignoreExpiration: false,
      secretOrKey: jwtSecret,
    });
  }

  async validate(payload: AccessTokenClaims & { username: string }) {
    // Check if the access token has been revoked (logout, revoked session,
    // password reset)
    if (await this.tokenBlacklistService.isRevoked(payload)) {
      throw new UnauthorizedException('Token has been revoked');
    }

    const user = await this.databaseService.user.findUniqueOrThrow({
      where: { id: payload.sub },
      select: { ...PUBLIC_USER_SELECT, banned: true },
    });

    if (user.banned) {
      throw new UnauthorizedException('Account has been banned');
    }

    return user;
  }
}
