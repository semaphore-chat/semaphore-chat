import {
  BadRequestException,
  ConflictException,
  GoneException,
} from '@nestjs/common';
import { ErrorCode } from '@semaphore-chat/shared';
import { isUUID } from 'class-validator';
import { isPrismaError } from '@/common/utils/prisma.utils';
import { DatabaseService } from '@/database/database.service';
import { MESSAGE_INCLUDE_WITH_REPLY } from './message.mapper';

/** Where a send is going. A nonce only ever refers to one place. */
export interface SendTarget {
  channelId?: string | null;
  directMessageGroupId?: string | null;
  parentMessageId?: string | null;
}

/** True when a write lost the race to another send with the same nonce. */
export function isNonceCollision(error: unknown): boolean {
  if (!isPrismaError(error, 'P2002')) return false;
  const target = error.meta?.target;
  // The shape of `target` depends on the driver, so look for the column in it.
  return JSON.stringify(target ?? error.message).includes('clientNonce');
}

/**
 * The message an earlier send with this nonce created, if there is one, so a
 * retry gets it instead of a second message. Throws when the retry can't be
 * answered with a message: it's gone, or the nonce was used somewhere else.
 *
 * Callers run this after the guards and before anything that depends on the
 * sender's recent activity: slowmode would otherwise reject a retry because of
 * the very message it's retrying.
 */
export async function findSentMessage(
  db: DatabaseService,
  authorId: string,
  clientNonce: string | null | undefined,
  target: SendTarget,
) {
  if (!clientNonce) return null;
  // The REST thread route doesn't validate its body against a DTO.
  if (!isUUID(clientNonce)) {
    throw new BadRequestException('clientNonce must be a UUID', {
      description: 'Bad Request',
      errorCode: ErrorCode.VALIDATION_FAILED,
    });
  }

  const gone = () =>
    new GoneException('This message has been deleted', {
      description: 'Gone',
      errorCode: ErrorCode.MESSAGE_DELETED,
    });

  const tombstone = await db.messageNonceTombstone.findUnique({
    where: { authorId_clientNonce: { authorId, clientNonce } },
  });
  if (tombstone) throw gone();

  const message = await db.message.findUnique({
    where: { authorId_clientNonce: { authorId, clientNonce } },
    include: MESSAGE_INCLUDE_WITH_REPLY,
  });
  if (!message) return null;

  if (
    message.channelId !== (target.channelId ?? null) ||
    message.directMessageGroupId !== (target.directMessageGroupId ?? null) ||
    message.parentMessageId !== (target.parentMessageId ?? null)
  ) {
    throw new ConflictException(
      'This clientNonce was already used for another message',
      { description: 'Conflict', errorCode: ErrorCode.NONCE_CONFLICT },
    );
  }
  if (message.deletedAt) throw gone();

  return message;
}
