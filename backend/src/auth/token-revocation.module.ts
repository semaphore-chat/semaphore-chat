import { Module } from '@nestjs/common';
import { RedisModule } from '@/redis/redis.module';
import { TokenBlacklistService } from './token-blacklist.service';
import { SessionRevocationService } from './session-revocation.service';

/**
 * Access token revocation, split out of AuthModule so modules that AuthModule
 * depends on (UserModule: ban, delete, password reset) can end sessions too.
 */
@Module({
  imports: [RedisModule],
  providers: [TokenBlacklistService, SessionRevocationService],
  exports: [TokenBlacklistService, SessionRevocationService],
})
export class TokenRevocationModule {}
