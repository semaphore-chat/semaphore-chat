import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { UserModule } from '../user/user.module';
import { LocalStrategy } from './local.strategy';
import { AuthController } from './auth.controller';
import { JwtModule } from '@nestjs/jwt';
import { JwtStrategy } from './jwt.strategy';
import { ACCESS_TOKEN_TTL_SECONDS } from './token-blacklist.service';
import { TokenRevocationModule } from './token-revocation.module';
import { WsAuthService } from './ws-auth.service';
import { PasswordResetService } from './password-reset.service';
import { RolesModule } from '@/roles/roles.module';
import { DatabaseModule } from '@/database/database.module';
import { RedisModule } from '@/redis/redis.module';
import { MailerModule } from '@/mailer/mailer.module';
import { RbacGuard } from './rbac.guard';
import { WsJwtAuthGuard } from './ws-jwt-auth.guard';

@Module({
  imports: [
    UserModule,
    RolesModule,
    PassportModule,
    DatabaseModule,
    RedisModule,
    MailerModule,
    TokenRevocationModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: ACCESS_TOKEN_TTL_SECONDS },
      }),
    }),
  ],
  providers: [
    AuthService,
    LocalStrategy,
    JwtStrategy,
    PasswordResetService,
    RbacGuard,
    WsAuthService,
    WsJwtAuthGuard,
  ],
  exports: [
    AuthService,
    JwtStrategy,
    JwtModule,
    TokenRevocationModule,
    RbacGuard,
    WsAuthService,
    WsJwtAuthGuard,
  ],
  controllers: [AuthController],
})
export class AuthModule {}
