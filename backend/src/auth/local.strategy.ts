import { Strategy } from 'passport-local';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { UserEntity } from '@/user/dto/user-response.dto';

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy) {
  constructor(private authService: AuthService) {
    // The request, for the client address the failed sign-in limit is keyed on
    super({ passReqToCallback: true });
  }

  async validate(
    req: Request,
    username: string,
    password: string,
  ): Promise<UserEntity> {
    // req.ip honours TRUST_PROXY (main.ts)
    const user = await this.authService.validateUser(
      username,
      password,
      req.ip,
    );
    if (!user) {
      throw new UnauthorizedException();
    }

    return user;
  }
}
