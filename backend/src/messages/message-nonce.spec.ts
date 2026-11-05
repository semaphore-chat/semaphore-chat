import {
  BadRequestException,
  ConflictException,
  GoneException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { createMockDatabase } from '@/test-utils';
import { findSentMessage, isNonceCollision } from './message-nonce';

describe('findSentMessage', () => {
  let db: ReturnType<typeof createMockDatabase> & {
    messageNonceTombstone: { findUnique: jest.Mock };
  };
  const nonce = randomUUID();
  const target = { channelId: 'channel-1' };
  const row = {
    id: 'msg-1',
    channelId: 'channel-1',
    directMessageGroupId: null,
    parentMessageId: null,
    deletedAt: null,
  };
  const find = (clientNonce: string | null | undefined = nonce, to = target) =>
    findSentMessage(db as never, 'user-1', clientNonce, to);

  beforeEach(() => {
    db = createMockDatabase() as typeof db;
    db.messageNonceTombstone = {
      findUnique: jest.fn().mockResolvedValue(null),
    };
    db.message.findUnique.mockResolvedValue(row);
  });

  it.each([null, ''])('skips the lookup without a nonce (%j)', async (n) => {
    await expect(find(n)).resolves.toBeNull();
    expect(db.message.findUnique).not.toHaveBeenCalled();
  });

  it('rejects a nonce that is not a UUID', async () => {
    await expect(find('nope')).rejects.toThrow(BadRequestException);
  });

  it('returns the earlier message, scoped to its author', async () => {
    await expect(find()).resolves.toBe(row);
    expect(db.message.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          authorId_clientNonce: { authorId: 'user-1', clientNonce: nonce },
        },
      }),
    );
  });

  it('reads the message before the tombstone', async () => {
    await find();

    const messageRead =
      db.message.findUnique.mock.invocationCallOrder[0] as number;
    const tombstoneRead = (
      db.messageNonceTombstone.findUnique.mock.invocationCallOrder[0] as number
    );
    expect(messageRead).toBeLessThan(tombstoneRead);
  });

  it('refuses a retry whose send was deleted between the two reads', async () => {
    // The delete commits right after the first read: whatever that read was,
    // the next one sees the row gone. Reading the message first is what makes
    // the later tombstone read catch it; the other order finds neither and
    // lets the caller create the message again.
    let committed = false;
    const read = <T>(before: T, after: T) => {
      const value = committed ? after : before;
      committed = true;
      return Promise.resolve(value);
    };
    db.message.findUnique.mockImplementation(() => read(row, null));
    db.messageNonceTombstone.findUnique.mockImplementation(() =>
      read(null, { authorId: 'user-1', clientNonce: nonce }),
    );

    await expect(find()).rejects.toThrow(GoneException);
  });

  it('finds nothing for a new nonce', async () => {
    db.message.findUnique.mockResolvedValue(null);
    await expect(find()).resolves.toBeNull();
  });

  it('refuses a message whose row was deleted', async () => {
    db.messageNonceTombstone.findUnique.mockResolvedValue({});
    await expect(find()).rejects.toThrow(GoneException);
  });

  it('refuses a message removed by moderation', async () => {
    db.message.findUnique.mockResolvedValue({
      ...row,
      deletedAt: new Date(),
    });
    await expect(find()).rejects.toThrow(GoneException);
  });

  it.each([
    ['another channel', { channelId: 'channel-2' }],
    ['a DM group', { directMessageGroupId: 'group-1' }],
    ['a thread', { channelId: 'channel-1', parentMessageId: 'parent-1' }],
  ])('refuses a nonce reused for %s', async (_label, to) => {
    await expect(find(nonce, to as never)).rejects.toThrow(ConflictException);
  });
});

describe('isNonceCollision', () => {
  const p2002 = (target: unknown) =>
    new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target },
    });

  it('recognises the nonce index, in either target shape', () => {
    expect(isNonceCollision(p2002(['authorId', 'clientNonce']))).toBe(true);
    expect(isNonceCollision(p2002('Message_authorId_clientNonce_key'))).toBe(
      true,
    );
  });

  it('ignores other unique indexes and other errors', () => {
    expect(isNonceCollision(p2002(['messageId', 'fileId']))).toBe(false);
    expect(isNonceCollision(new Error('clientNonce'))).toBe(false);
  });
});
