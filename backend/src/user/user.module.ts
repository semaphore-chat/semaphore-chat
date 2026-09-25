import { Module } from '@nestjs/common';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { DatabaseModule } from '../database/database.module';
import { InviteModule } from '../invite/invite.module';
import { ChannelsModule } from '../channels/channels.module';
import { RolesModule } from '../roles/roles.module';
import { TokenRevocationModule } from '@/auth/token-revocation.module';

@Module({
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService],
  imports: [
    DatabaseModule,
    InviteModule,
    ChannelsModule,
    RolesModule,
    TokenRevocationModule,
  ],
})
export class UserModule {}
