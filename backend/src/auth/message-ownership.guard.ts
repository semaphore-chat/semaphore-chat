import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { InstanceRole, RbacActions } from '@prisma/client';
import { Request } from 'express';
import { MessagesService } from '@/messages/messages.service';
import { PermissionsService } from '@/roles/permissions.service';
import { UserEntity } from '@/user/dto/user-response.dto';
import { RbacResourceType } from './rbac-resource.decorator';

/**
 * Guards message mutation routes (`/messages/:id...`).
 *
 * - The author may always edit, delete and add attachments.
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
}
