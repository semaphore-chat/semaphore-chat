import { ForbiddenException } from '@nestjs/common';
import { ResourceType } from '@prisma/client';
import { assertFilesAttachable } from './attachable-files.utils';

describe('assertFilesAttachable', () => {
  const db = { file: { count: jest.fn() } };

  beforeEach(() => {
    db.file.count.mockReset();
  });

  it('asks nothing when there are no files', async () => {
    await assertFilesAttachable(db, 'user-1', []);
    expect(db.file.count).not.toHaveBeenCalled();
  });

  it('accepts files the user uploaded, counting repeats once', async () => {
    db.file.count.mockResolvedValue(2);

    await assertFilesAttachable(db, 'user-1', ['a', 'b', 'a']);

    expect(db.file.count).toHaveBeenCalledWith({
      where: {
        id: { in: ['a', 'b'] },
        uploadedById: 'user-1',
        deletedAt: null,
        resourceType: {
          in: [ResourceType.MESSAGE_ATTACHMENT, ResourceType.REPLAY_CLIP],
        },
      },
    });
  });

  it('rejects the whole set when any file is not attachable', async () => {
    db.file.count.mockResolvedValue(1);

    await expect(
      assertFilesAttachable(db, 'user-1', ['mine', 'other']),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects ids that are not strings without querying', async () => {
    await expect(
      assertFilesAttachable(db, 'user-1', [{ not: 'x' }]),
    ).rejects.toThrow(ForbiddenException);
    expect(db.file.count).not.toHaveBeenCalled();
  });
});
