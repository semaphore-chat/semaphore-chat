import {
  Injectable,
  UnprocessableEntityException,
  PayloadTooLargeException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { CreateFileUploadDto } from './dto/create-file-upload.dto';
import { DatabaseService } from '@/database/database.service';
import { FileType, ResourceType, StorageType } from '@prisma/client';
import { createHash } from 'crypto';
import { StorageService } from '@/storage/storage.service';
import { StorageQuotaService } from '@/storage-quota/storage-quota.service';
import { ThumbnailService } from '@/file/thumbnail.service';
import { ResourceTypeFileValidator } from './validators';
import { UserEntity } from '@/user/dto/user-response.dto';

@Injectable()
export class FileUploadService {
  private readonly logger = new Logger(FileUploadService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly storageService: StorageService,
    private readonly storageQuotaService: StorageQuotaService,
    private readonly thumbnailService: ThumbnailService,
  ) {}

  async uploadFile(
    file: Express.Multer.File,
    createFileUploadDto: CreateFileUploadDto,
    user: UserEntity,
  ) {
    try {
      // Check storage quota before processing
      const quotaCheck = await this.storageQuotaService.canUploadFile(
        user.id,
        file.size,
      );

      if (!quotaCheck.canUpload) {
        // Delete file from disk before throwing error
        await this.cleanupFile(file.path);
        throw new PayloadTooLargeException(
          quotaCheck.message || 'Storage quota exceeded',
        );
      }

      // Validate file using strategy pattern
      const validator = new ResourceTypeFileValidator({
        resourceType: createFileUploadDto.resourceType,
      });

      const isValid = await validator.isValid(file);
      if (!isValid) {
        // Delete file from disk before throwing error
        await this.cleanupFile(file.path);
        throw new UnprocessableEntityException(
          validator.buildErrorMessage(file),
        );
      }

      // Generate checksum
      const checksum = await this.generateChecksum(file.path);

      // Determine file type from MIME type
      const fileType = this.getFileTypeFromMimeType(file.mimetype);

      // Create database record
      try {
        const { resourceId, ...dtoRest } = createFileUploadDto;
        const fileRecord = await this.databaseService.file.create({
          data: {
            ...dtoRest,
            ...this.mapResourceIdToTypedColumn(
              dtoRest.resourceType,
              resourceId,
            ),
            filename: file.originalname,
            mimeType: file.mimetype,
            fileType,
            size: file.size,
            checksum,
            uploadedById: user.id,
            storageType: StorageType.LOCAL,
            storagePath: file.path,
          },
        });

        // Increment user's storage usage
        await this.storageQuotaService.incrementUserStorage(user.id, file.size);

        // Generate thumbnail for video files (fire-and-forget — failure won't block upload)
        if (fileType === FileType.VIDEO) {
          this.generateThumbnailAsync(file.path, fileRecord.id);
        }

        return fileRecord;
      } catch (dbError) {
        // If DB insert fails, clean up the file
        await this.cleanupFile(file.path);
        this.logger.error(`Database error during file upload: ${dbError}`);
        throw dbError;
      }
    } catch (error) {
      // Ensure file is cleaned up on any error
      if (
        error instanceof UnprocessableEntityException ||
        error instanceof PayloadTooLargeException
      ) {
        throw error; // Already cleaned up and has proper message
      }

      // For unexpected errors (not already handled), clean up and re-throw
      this.logger.error(`Error processing file upload: ${error}`);
      throw error;
    }
  }

  /**
   * Fire-and-forget thumbnail generation for video uploads.
   * Errors are logged but never propagate to the upload response.
   */
  private generateThumbnailAsync(filePath: string, fileId: string): void {
    void (async () => {
      try {
        const thumbnailPath =
          await this.thumbnailService.generateVideoThumbnail(filePath, fileId);
        if (thumbnailPath) {
          await this.databaseService.file.update({
            where: { id: fileId },
            data: { thumbnailPath },
          });
        }
      } catch (error) {
        this.logger.error(
          `Failed to generate thumbnail for file ${fileId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    })();
  }

  /**
   * Delete a file from disk
   */
  private async cleanupFile(filePath: string): Promise<void> {
    try {
      await this.storageService.deleteFile(filePath);
      this.logger.debug(`Cleaned up file: ${filePath}`);
    } catch (error) {
      this.logger.warn(`Failed to clean up file ${filePath}: ${error}`);
    }
  }

  /**
   * Generate SHA-256 checksum for a file
   */
  private async generateChecksum(filePath: string): Promise<string> {
    const fileBuffer = await this.storageService.readFile(filePath);
    return createHash('sha256').update(fileBuffer).digest('hex');
  }

  /**
   * Determine FileType enum from MIME type
   */
  private getFileTypeFromMimeType(mimeType: string): FileType {
    if (mimeType.startsWith('image/')) {
      return FileType.IMAGE;
    }
    if (mimeType.startsWith('video/')) {
      return FileType.VIDEO;
    }
    if (mimeType.startsWith('audio/')) {
      return FileType.AUDIO;
    }
    if (
      mimeType.startsWith('application/pdf') ||
      mimeType.startsWith('application/msword') ||
      mimeType.startsWith(
        'application/vnd.openxmlformats-officedocument.wordprocessingml',
      ) ||
      mimeType.startsWith('application/vnd.ms-excel') ||
      mimeType.startsWith(
        'application/vnd.openxmlformats-officedocument.spreadsheetml',
      ) ||
      mimeType.startsWith('application/vnd.ms-powerpoint') ||
      mimeType.startsWith(
        'application/vnd.openxmlformats-officedocument.presentationml',
      ) ||
      mimeType.startsWith('text/')
    ) {
      return FileType.DOCUMENT;
    }
    // Archives and other application types
    if (
      mimeType.includes('zip') ||
      mimeType.includes('rar') ||
      mimeType.includes('7z') ||
      mimeType.includes('tar') ||
      mimeType.includes('gzip') ||
      mimeType.includes('bzip') ||
      mimeType === 'application/octet-stream'
    ) {
      return FileType.OTHER;
    }
    return FileType.OTHER;
  }

  /**
   * Map a resourceId to the correct typed FK column based on resourceType.
   */
  private mapResourceIdToTypedColumn(
    resourceType: ResourceType,
    resourceId?: string | null,
  ): { fileUserId?: string; fileCommunityId?: string; fileMessageId?: string } {
    if (!resourceId) return {};
    switch (resourceType) {
      case ResourceType.USER_AVATAR:
      case ResourceType.USER_BANNER:
      case ResourceType.REPLAY_CLIP:
        return { fileUserId: resourceId };
      case ResourceType.COMMUNITY_AVATAR:
      case ResourceType.COMMUNITY_BANNER:
      case ResourceType.CUSTOM_EMOJI:
        return { fileCommunityId: resourceId };
      case ResourceType.MESSAGE_ATTACHMENT:
        return { fileMessageId: resourceId };
    }
  }

  async remove(id: string, userId: string) {
    const file = await this.databaseService.file.findUnique({
      where: { id },
      select: { uploadedById: true, size: true, deletedAt: true },
    });

    if (!file) {
      throw new NotFoundException('File not found');
    }

    if (file.uploadedById !== userId) {
      throw new ForbiddenException('You can only delete your own files');
    }

    if (file.deletedAt) {
      throw new NotFoundException('File not found');
    }

    const result = await this.databaseService.file.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    if (file.size) {
      await this.storageQuotaService.decrementUserStorage(userId, file.size);
    }

    return result;
  }
}
