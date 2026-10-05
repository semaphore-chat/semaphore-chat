import { Module } from '@nestjs/common';
import { FileService } from './file.service';
import { FileController } from './file.controller';
import { SignedUrlService } from './signed-url.service';
import { FileAuthGuard } from './file-auth.guard';
import { DatabaseModule } from '@/database/database.module';
import { StorageModule } from '@/storage/storage.module';
import { MembershipModule } from '@/membership/membership.module';
import { RolesModule } from '@/roles/roles.module';
import { FileAccessGuard } from '@/file/file-access/file-access.guard';
import {
  PublicAccessStrategy,
  CommunityMembershipStrategy,
  MessageAttachmentStrategy,
} from '@/file/file-access/strategies';
import { OptionalJwtAuthGuard } from '@/auth/optional-jwt-auth.guard';

@Module({
  controllers: [FileController],
  providers: [
    FileService,
    SignedUrlService,
    FileAuthGuard,
    OptionalJwtAuthGuard,
    FileAccessGuard,
    PublicAccessStrategy,
    CommunityMembershipStrategy,
    MessageAttachmentStrategy,
  ],
  imports: [DatabaseModule, StorageModule, MembershipModule, RolesModule],
  exports: [FileService],
})
export class FileModule {}
