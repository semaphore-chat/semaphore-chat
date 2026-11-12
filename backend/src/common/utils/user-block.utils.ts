import { ForbiddenException } from '@nestjs/common';
import { ErrorCode } from '@semaphore-chat/shared';

/** Minimal Prisma-client surface, so a transaction client works too. */
interface UserBlockDb {
  userBlock: {
    findFirst(args: {
      where: {
        OR: (
          | { blockerId: string; blockedId: { in: string[] } }
          | { blockerId: { in: string[] }; blockedId: string }
        )[];
      };
      select: { id: true };
    }): Promise<{ id: string } | null>;
  };
}

interface DmBlockDb extends UserBlockDb {
  directMessageGroup: {
    findUnique(args: {
      where: { id: string };
      select: { isGroup: true; members: { select: { userId: true } } };
    }): Promise<{ isGroup: boolean; members: { userId: string }[] } | null>;
  };
}

/** Whether a block exists, in either direction, between a user and any of others. */
export async function isBlockedWithAny(
  db: UserBlockDb,
  userId: string,
  others: string[],
): Promise<boolean> {
  if (others.length === 0) return false;
  const block = await db.userBlock.findFirst({
    where: {
      OR: [
        { blockerId: userId, blockedId: { in: others } },
        { blockerId: { in: others }, blockedId: userId },
      ],
    },
    select: { id: true },
  });
  return !!block;
}

/**
 * Refuses new activity in a 1:1 DM when either side has blocked the other. The
 * history stays readable, and a group DM keeps working for everyone in it:
 * there the block only stops notifications (see NotificationsService).
 */
export async function assertNotBlockedInDm(
  db: DmBlockDb,
  userId: string,
  groupId: string,
): Promise<void> {
  const group = await db.directMessageGroup.findUnique({
    where: { id: groupId },
    select: { isGroup: true, members: { select: { userId: true } } },
  });
  if (!group || group.isGroup) return;

  const others = group.members
    .map((member) => member.userId)
    .filter((id) => id !== userId);
  if (await isBlockedWithAny(db, userId, others)) {
    throw new ForbiddenException('You cannot message this user', {
      description: 'Forbidden',
      errorCode: ErrorCode.DM_BLOCKED,
    });
  }
}
