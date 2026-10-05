import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
import { DatabaseService } from '@/database/database.service';
import { ChannelAccessService } from '@/roles/channel-access.service';
import { IFileAccessStrategy } from './file-access-strategy.interface';

/**
 * Strategy for replay clip files
 * Checks access based on:
 * 1. User is the clip owner
 * 2. Clip is public (shown on profile)
 * 3. User has access to any message containing this file
 */
@Injectable()
export class ReplayClipAccessStrategy implements IFileAccessStrategy {
  private readonly logger = new Logger(ReplayClipAccessStrategy.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly channelAccessService: ChannelAccessService,
  ) {}

  async checkAccess(
    userId: string,
    clipOwnerId: string,
    fileId: string,
  ): Promise<boolean> {
    // Check 1: User is the owner of the clip
    if (userId === clipOwnerId) {
      this.logger.debug(
        `User ${userId} is the owner of clip, allowing access to file ${fileId}`,
      );
      return true;
    }

    // Check 2: Clip is public (visible on profile)
    const clip = await this.databaseService.replayClip.findFirst({
      where: { fileId },
      select: { isPublic: true },
    });

    if (clip?.isPublic) {
      this.logger.debug(
        `Clip for file ${fileId} is public, allowing access for user ${userId}`,
      );
      return true;
    }

    // Check 3: User has access to any message containing this file
    const messagesWithFile = await this.databaseService.message.findMany({
      where: { attachments: { some: { fileId } } },
      select: {
        id: true,
        channelId: true,
        directMessageGroupId: true,
      },
    });

    if (messagesWithFile.length === 0) {
      this.logger.debug(
        `No messages contain file ${fileId}, denying access for user ${userId}`,
      );
      throw new ForbiddenException('Access denied');
    }

    // Check if user has access to any of these messages
    for (const message of messagesWithFile) {
      try {
        if (message.channelId) {
          const hasAccess = await this.checkChannelAccess(
            userId,
            message.channelId,
          );
          if (hasAccess) {
            this.logger.debug(
              `User ${userId} has access to channel ${message.channelId} containing file ${fileId}`,
            );
            return true;
          }
        }

        if (message.directMessageGroupId) {
          const hasAccess = await this.checkDmGroupAccess(
            userId,
            message.directMessageGroupId,
          );
          if (hasAccess) {
            this.logger.debug(
              `User ${userId} has access to DM group ${message.directMessageGroupId} containing file ${fileId}`,
            );
            return true;
          }
        }
      } catch {
        // Continue checking other messages
      }
    }

    this.logger.debug(
      `User ${userId} does not have access to any message containing file ${fileId}`,
    );
    throw new ForbiddenException('Access denied');
  }

  private async checkChannelAccess(
    userId: string,
    channelId: string,
  ): Promise<boolean> {
    // Only users who can see the channel (ChannelAccessService)
    return this.channelAccessService.canViewChannel(userId, channelId);
  }

  private async checkDmGroupAccess(
    userId: string,
    dmGroupId: string,
  ): Promise<boolean> {
    const membership =
      await this.databaseService.directMessageGroupMember.findUnique({
        where: {
          groupId_userId: {
            groupId: dmGroupId,
            userId: userId,
          },
        },
      });

    return !!membership;
  }
}
