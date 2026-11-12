import { ForbiddenException } from '@nestjs/common';
import { ErrorCode } from '@semaphore-chat/shared';
import { assertNotBlockedInDm } from './user-block.utils';

describe('assertNotBlockedInDm', () => {
  const db = {
    userBlock: { findFirst: jest.fn() },
    directMessageGroup: { findUnique: jest.fn() },
  };
  const group = (isGroup: boolean, members: string[]) => ({
    isGroup,
    members: members.map((userId) => ({ userId })),
  });

  beforeEach(() => {
    db.userBlock.findFirst.mockReset();
    db.directMessageGroup.findUnique.mockReset();
  });

  it('lets a 1:1 DM through when nobody blocked anyone', async () => {
    db.directMessageGroup.findUnique.mockResolvedValue(
      group(false, ['user-1', 'user-2']),
    );
    db.userBlock.findFirst.mockResolvedValue(null);

    await expect(
      assertNotBlockedInDm(db, 'user-1', 'dm-1'),
    ).resolves.toBeUndefined();
  });

  it('refuses a 1:1 DM with a DM_BLOCKED code', async () => {
    db.directMessageGroup.findUnique.mockResolvedValue(
      group(false, ['user-1', 'user-2']),
    );
    db.userBlock.findFirst.mockResolvedValue({ id: 'block-1' });

    const thrown = assertNotBlockedInDm(db, 'user-1', 'dm-1');

    await expect(thrown).rejects.toBeInstanceOf(ForbiddenException);
    await expect(thrown).rejects.toMatchObject({
      message: 'You cannot message this user',
      response: {
        statusCode: 403,
        message: 'You cannot message this user',
        errorCode: ErrorCode.DM_BLOCKED,
      },
    });
  });

  it('never checks blocks for a group DM', async () => {
    db.directMessageGroup.findUnique.mockResolvedValue(
      group(true, ['user-1', 'user-2', 'user-3']),
    );

    await assertNotBlockedInDm(db, 'user-1', 'dm-1');

    expect(db.userBlock.findFirst).not.toHaveBeenCalled();
  });

  it('ignores a missing group', async () => {
    db.directMessageGroup.findUnique.mockResolvedValue(null);

    await assertNotBlockedInDm(db, 'user-1', 'dm-1');

    expect(db.userBlock.findFirst).not.toHaveBeenCalled();
  });

  it('checks both directions between the caller and the other member', async () => {
    db.directMessageGroup.findUnique.mockResolvedValue(
      group(false, ['user-1', 'user-2']),
    );
    db.userBlock.findFirst.mockResolvedValue(null);

    await assertNotBlockedInDm(db, 'user-1', 'dm-1');

    expect(db.userBlock.findFirst).toHaveBeenCalledWith({
      where: {
        OR: [
          { blockerId: 'user-1', blockedId: { in: ['user-2'] } },
          { blockerId: { in: ['user-2'] }, blockedId: 'user-1' },
        ],
      },
      select: { id: true },
    });
  });
});
