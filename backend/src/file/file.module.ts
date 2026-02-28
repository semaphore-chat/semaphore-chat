import { Module } from '@nestjs/common';
import { FileService } from './file.service';
import { FileController } from './file.controller';
import { SignedUrlService } from './signed-url.service';
import { FileAuthGuard } from './file-auth.guard';
import { DatabaseModule } from '@/database/database.module';
import { StorageModule } from '@/storage/storage.module';
import { MembershipModule } from '@/membership/membership.module';
import { ChannelMembershipModule } from '@/channel-membership/channel-membership.module';
import { FileAccessGuard } from '@/file/file-access/file-access.guard';
import {
  PublicAccessStrategy,
  CommunityMembershipStrategy,
  MessageAttachmentStrategy,
} from '@/file/file-access/strategies';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';

@Module({
  controllers: [FileController],
  providers: [
    FileService,
    SignedUrlService,
    FileAuthGuard,
    JwtAuthGuard,
    FileAccessGuard,
    PublicAccessStrategy,
    CommunityMembershipStrategy,
    MessageAttachmentStrategy,
  ],
  imports: [
    DatabaseModule,
    StorageModule,
    MembershipModule,
    ChannelMembershipModule,
  ],
  exports: [FileService],
})
export class FileModule {}
