import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { InstanceRole, RbacActions } from '@prisma/client';
import { Request } from 'express';
import { DatabaseService } from '@/database/database.service';
import { assertNotBlockedInDm } from '@/common/utils/user-block.utils';
import { MessagesService } from '@/messages/messages.service';
import { PermissionsService } from '@/roles/permissions.service';
import { UserEntity } from '@/user/dto/user-response.dto';
import { RbacResourceType } from './rbac-resource.decorator';

/**
 * Guards message mutation routes (`/messages/:id...`).
 *
 * - The author may always delete. Editing and adding attachments reach everyone
 *   else like a new message does, so they take what sending takes today: see
 *   assertMayStillWrite.
 * - A non-author may only DELETE, and only with DELETE_ANY_MESSAGE for the
 *   message's channel/community. DM messages are author-only.
 * - Everything else is denied. This guard never delegates to RbacGuard: with
 *   no @RequiredActions that guard allows everyone.
 * - A missing message propagates the service's NotFoundException (404).
 */
@Injectable()
export class MessageOwnershipGuard implements CanActivate {
  private readonly logger = new Logger(MessageOwnershipGuard.name);

  constructor(
    private readonly messagesService: MessagesService,
    private readonly permissionsService: PermissionsService,
    private readonly databaseService: DatabaseService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request: Request & { user?: UserEntity } = context
      .switchToHttp()
      .getRequest();
    const user = request.user;
    const messageId = request.params?.id as string | undefined;

    if (!user || !messageId) {
      return false;
    }

    // Throws NotFoundException for a missing message.
    const message = await this.messagesService.findOne(messageId);

    if (message.authorId === user.id) {
      if (request.method !== 'DELETE') {
        await this.assertMayStillWrite(user.id, message);
      }
      return true;
    }

    if (request.method !== 'DELETE') {
      throw new ForbiddenException('Only the author can modify this message');
    }

    // DM messages: author only.
    if (message.directMessageGroupId) {
      throw new ForbiddenException('Only the author can delete this message');
    }

    const allowed =
      user.role === InstanceRole.OWNER ||
      (await this.permissionsService.verifyActionsForUserAndResource(
        user.id,
        messageId,
        RbacResourceType.MESSAGE,
        [RbacActions.DELETE_ANY_MESSAGE],
      ));

    if (!allowed) {
      this.logger.debug(`User ${user.id} denied deleting message ${messageId}`);
      throw new ForbiddenException('Missing permission to delete this message');
    }
    return true;
  }

  /**
   * Having written a message doesn't outlast losing the room it's in. In a
   * channel: CREATE_MESSAGE now, which covers access (view gate) and timeouts
   * (mask), with the owner bypass sending has. In a DM: membership now, no
   * bypass, and no block in a 1:1. A message a moderator removed stays removed.
   */
  private async assertMayStillWrite(
    userId: string,
    message: {
      channelId: string | null;
      directMessageGroupId: string | null;
      deletedAt: Date | null;
    },
  ): Promise<void> {
    if (message.deletedAt) {
      throw new ForbiddenException('This message was removed');
    }

    const { channelId, directMessageGroupId: groupId } = message;
    if (groupId) {
      const member =
        await this.databaseService.directMessageGroupMember.findFirst({
          where: { groupId, userId },
          select: { id: true },
        });
      if (!member) {
        throw new ForbiddenException('You are not a member of this DM group');
      }
      await assertNotBlockedInDm(this.databaseService, userId, groupId);
      return;
    }

    if (
      !channelId ||
      !(await this.permissionsService.userHasChannelActions(userId, channelId, [
        RbacActions.CREATE_MESSAGE,
      ]))
    ) {
      throw new ForbiddenException(
        "You can't send messages here, so you can't edit this one",
      );
    }
  }
}
