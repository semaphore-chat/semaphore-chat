import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Request } from 'express';
import { FileService } from '@/file/file.service';
import { MembershipService } from '@/membership/membership.service';
import { ChannelMembershipService } from '@/channel-membership/channel-membership.service';
import { DatabaseService } from '@/database/database.service';
import { UserEntity } from '@/user/dto/user-response.dto';
import { ResourceType } from '@prisma/client';
import {
  IFileAccessStrategy,
  PublicAccessStrategy,
  CommunityMembershipStrategy,
  MessageAttachmentStrategy,
  ReplayClipAccessStrategy,
} from './strategies';

/**
 * Guard that enforces file access control based on resource type
 * Uses the Strategy pattern to delegate access checks to appropriate handlers
 */
@Injectable()
export class FileAccessGuard implements CanActivate {
  private readonly logger = new Logger(FileAccessGuard.name);
  private readonly strategies: Map<ResourceType, IFileAccessStrategy>;

  constructor(
    private readonly fileService: FileService,
    private readonly membershipService: MembershipService,
    private readonly channelMembershipService: ChannelMembershipService,
    private readonly databaseService: DatabaseService,
  ) {
    this.strategies = this.buildStrategyRegistry();
  }

  /**
   * Build the strategy registry mapping ResourceType to access strategy
   */
  private buildStrategyRegistry(): Map<ResourceType, IFileAccessStrategy> {
    const publicStrategy = new PublicAccessStrategy();
    const communityStrategy = new CommunityMembershipStrategy(
      this.membershipService,
    );
    const messageStrategy = new MessageAttachmentStrategy(
      this.databaseService,
      this.membershipService,
      this.channelMembershipService,
    );
    const replayClipStrategy = new ReplayClipAccessStrategy(
      this.databaseService,
      this.membershipService,
      this.channelMembershipService,
    );

    return new Map<ResourceType, IFileAccessStrategy>([
      [ResourceType.USER_AVATAR, publicStrategy],
      [ResourceType.USER_BANNER, publicStrategy],
      [ResourceType.COMMUNITY_AVATAR, communityStrategy],
      [ResourceType.COMMUNITY_BANNER, communityStrategy],
      [ResourceType.CUSTOM_EMOJI, communityStrategy],
      [ResourceType.MESSAGE_ATTACHMENT, messageStrategy],
      [ResourceType.REPLAY_CLIP, replayClipStrategy],
    ]);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request: Request = context.switchToHttp().getRequest();
    const user = request.user as UserEntity | undefined;
    const fileId = request.params?.id as string | undefined;

    if (!fileId) {
      throw new NotFoundException('File ID not provided');
    }

    try {
      // Fetch file metadata
      const file = await this.fileService.findOne(fileId);

      // Resolve the resource ID from the appropriate typed FK column
      const resourceId =
        file.fileUserId || file.fileCommunityId || file.fileMessageId;

      // Files without a resource FK are only allowed for intentionally-public resource types.
      // This prevents accidental public exposure if a code path creates a file without setting a resource FK.
      if (!resourceId) {
        const publicResourceTypes: ResourceType[] = [
          ResourceType.USER_AVATAR,
          ResourceType.USER_BANNER,
        ];
        if (publicResourceTypes.includes(file.resourceType)) {
          this.logger.debug(
            `File ${fileId} has no resource FK but is public type ${file.resourceType}, allowing access`,
          );
          return true;
        }
        this.logger.warn(
          `File ${fileId} has no resource FK and non-public type ${file.resourceType}, denying access`,
        );
        throw new ForbiddenException('Access denied');
      }

      // User must be authenticated for resource-associated files
      if (!user) {
        this.logger.debug(
          `Unauthenticated user attempted to access file ${fileId}`,
        );
        throw new ForbiddenException('Authentication required');
      }

      // Get the appropriate strategy for this resource type
      const strategy = this.strategies.get(file.resourceType);

      if (!strategy) {
        this.logger.warn(
          `No strategy found for resource type ${file.resourceType} for file ${fileId}`,
        );
        throw new ForbiddenException('Access denied');
      }

      // Delegate access check to the strategy
      return await strategy.checkAccess(user.id, resourceId, fileId);
    } catch (error) {
      if (
        error instanceof ForbiddenException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      this.logger.error(`Error checking file access for file ${fileId}`, error);
      throw new NotFoundException('File not found');
    }
  }
}
