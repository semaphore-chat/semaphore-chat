import { File, FileType, ResourceType, StorageType } from '@prisma/client';

export class FileFactory {
  private static counter = 0;

  static build(overrides: Partial<File> = {}): File {
    const id = overrides.id || this.generateId();
    const filename = overrides.filename || `file-${this.counter++}.txt`;

    return {
      id,
      filename,
      mimeType: overrides.mimeType || 'text/plain',
      fileType: overrides.fileType || FileType.DOCUMENT,
      size: overrides.size || 1024,
      checksum: overrides.checksum || this.generateChecksum(),
      uploadedById: overrides.uploadedById || this.generateId(),
      uploadedAt: overrides.uploadedAt || new Date(),
      deletedAt: overrides.deletedAt || null,
      resourceType: overrides.resourceType || ResourceType.MESSAGE_ATTACHMENT,
      fileUserId: overrides.fileUserId ?? null,
      fileCommunityId: overrides.fileCommunityId ?? null,
      fileMessageId: overrides.fileMessageId ?? null,
      storageType: overrides.storageType || StorageType.LOCAL,
      storagePath: overrides.storagePath || `/uploads/${filename}`,
      thumbnailPath: ('thumbnailPath' in overrides
        ? overrides.thumbnailPath
        : null) as string | null,
      ...overrides,
    } as File;
  }

  static buildImage(overrides: Partial<File> = {}): File {
    return this.build({
      filename: 'image.png',
      mimeType: 'image/png',
      fileType: FileType.IMAGE,
      ...overrides,
    });
  }

  static buildAvatar(userId: string, overrides: Partial<File> = {}): File {
    return this.build({
      filename: 'avatar.png',
      mimeType: 'image/png',
      fileType: FileType.IMAGE,
      resourceType: ResourceType.USER_AVATAR,
      fileUserId: userId,
      ...overrides,
    });
  }

  static buildMessageAttachment(
    messageId: string,
    overrides: Partial<File> = {},
  ): File {
    return this.build({
      resourceType: ResourceType.MESSAGE_ATTACHMENT,
      fileMessageId: messageId,
      ...overrides,
    });
  }

  static buildDeleted(overrides: Partial<File> = {}): File {
    return this.build({
      deletedAt: new Date(),
      ...overrides,
    });
  }

  static buildMany(count: number, overrides: Partial<File> = {}): File[] {
    return Array.from({ length: count }, () => this.build(overrides));
  }

  private static generateId(): string {
    return (
      Math.random().toString(36).substring(2, 15) +
      Math.random().toString(36).substring(2, 15)
    );
  }

  private static generateChecksum(): string {
    return Array.from({ length: 64 }, () =>
      Math.floor(Math.random() * 16).toString(16),
    ).join('');
  }

  static resetCounter(): void {
    this.counter = 0;
  }
}
