import { ForbiddenException } from '@nestjs/common';
import { ResourceType } from '@prisma/client';

/** Avatars, banners, emoji and the like belong to their owner, not a message. */
const ATTACHABLE_RESOURCE_TYPES = [
  ResourceType.MESSAGE_ATTACHMENT,
  ResourceType.REPLAY_CLIP,
];

/** Minimal Prisma-client surface, so a transaction client works too. */
interface AttachableFilesDb {
  file: {
    count(args: {
      where: {
        id: { in: string[] };
        uploadedById: string;
        deletedAt: null;
        resourceType: { in: ResourceType[] };
      };
    }): Promise<number>;
  };
}

/**
 * A message may only carry files its author uploaded. An attachment shows the
 * file's metadata to everyone who can read the message, and removing it can
 * delete the file. A missing file gets the same error, so this can't be used
 * to test whether an id exists.
 */
export async function assertFilesAttachable(
  db: AttachableFilesDb,
  userId: string,
  fileIds: readonly unknown[],
): Promise<void> {
  if (fileIds.length === 0) return;

  const denied = new ForbiddenException(
    'You can only attach files you uploaded',
  );
  // `attachments` is only validated as an array.
  if (fileIds.some((fileId) => typeof fileId !== 'string')) throw denied;

  const unique = [...new Set(fileIds as string[])];
  const attachable = await db.file.count({
    where: {
      id: { in: unique },
      uploadedById: userId,
      deletedAt: null,
      resourceType: { in: ATTACHABLE_RESOURCE_TYPES },
    },
  });
  if (attachable !== unique.length) throw denied;
}
