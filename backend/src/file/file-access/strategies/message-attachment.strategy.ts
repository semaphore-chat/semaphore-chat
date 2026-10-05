import {
  Injectable,
  Logger,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '@/database/database.service';
import { ChannelAccessService } from '@/roles/channel-access.service';
import { IFileAccessStrategy } from './file-access-strategy.interface';

/**
 * Strategy for message attachment files
 * Checks access based on message context (channel or DM group)
 */
@Injectable()
export class MessageAttachmentStrategy implements IFileAccessStrategy {
  private readonly logger = new Logger(MessageAttachmentStrategy.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly channelAccessService: ChannelAccessService,
  ) {}

  async checkAccess(
    userId: string,
    messageId: string,
    fileId: string,
  ): Promise<boolean> {
    // Fetch the message to determine if it's in a channel or DM
    const message = await this.databaseService.message.findUnique({
      where: { id: messageId },
      select: {
        id: true,
        channelId: true,
        directMessageGroupId: true,
      },
    });

    if (!message) {
      this.logger.debug(`Message ${messageId} not found for file ${fileId}`);
      throw new NotFoundException('Message not found');
    }

    // Check channel message access
    if (message.channelId) {
      return this.checkChannelMessageAccess(userId, message.channelId, fileId);
    }

    // Check DM group message access
    if (message.directMessageGroupId) {
      return this.checkDmGroupMessageAccess(
        userId,
        message.directMessageGroupId,
        fileId,
      );
    }

    // Message has no channel or DM group
    this.logger.warn(
      `Message ${messageId} has no channel or DM group for file ${fileId}`,
    );
    throw new ForbiddenException('Access denied');
  }

  private async checkChannelMessageAccess(
    userId: string,
    channelId: string,
    fileId: string,
  ): Promise<boolean> {
    const channel = await this.databaseService.channel.findUnique({
      where: { id: channelId },
      select: { id: true },
    });

    if (!channel) {
      this.logger.debug(`Channel ${channelId} not found for file ${fileId}`);
      throw new NotFoundException('Channel not found');
    }

    // Only users who can see the channel get its files (ChannelAccessService)
    if (!(await this.channelAccessService.canViewChannel(userId, channelId))) {
      this.logger.debug(
        `User ${userId} can't view channel ${channelId}, denying access to file ${fileId}`,
      );
      throw new ForbiddenException(
        'You must be able to view this channel to access this file',
      );
    }

    return true;
  }

  private async checkDmGroupMessageAccess(
    userId: string,
    dmGroupId: string,
    fileId: string,
  ): Promise<boolean> {
    // Check if user is a member of the DM group
    const membership =
      await this.databaseService.directMessageGroupMember.findUnique({
        where: {
          groupId_userId: {
            groupId: dmGroupId,
            userId: userId,
          },
        },
      });

    if (!membership) {
      this.logger.debug(
        `User ${userId} is not a member of DM group ${dmGroupId}, denying access to file ${fileId}`,
      );
      throw new ForbiddenException(
        'You must be a member of this conversation to access this file',
      );
    }

    this.logger.debug(
      `User ${userId} is a member of DM group ${dmGroupId}, allowing access to file ${fileId}`,
    );
    return true;
  }
}
