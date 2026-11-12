import {
  BadRequestException,
  Injectable,
  UnprocessableEntityException,
  PayloadTooLargeException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { CreateFileUploadDto } from './dto/create-file-upload.dto';
import { DatabaseService } from '@/database/database.service';
import {
  FileType,
  InstanceRole,
  RbacActions,
  ResourceType,
  StorageType,
} from '@prisma/client';
import { ErrorCode } from '@semaphore-chat/shared';
import { RbacResourceType } from '@/auth/rbac-resource.decorator';
import { PermissionsService } from '@/roles/permissions.service';
import { createHash } from 'crypto';
import { StorageService } from '@/storage/storage.service';
import { StorageQuotaService } from '@/storage-quota/storage-quota.service';
import { ThumbnailService } from '@/file/thumbnail.service';
import { MediaDimensionsService } from '@/file/media-dimensions.service';
import { ResourceTypeFileValidator } from './validators';
import { SOUNDBOARD_SOUND_MAX_DURATION_SECONDS } from './validators/strategies/soundboard-sound-validation.strategy';
import { FfmpegProvider } from '@/livekit/providers/ffmpeg.provider';
import { UserEntity } from '@/user/dto/user-response.dto';
import { FileUploadResponseDto } from './dto/file-upload-response.dto';

/** What uploading each community-owned file needs, as using it does. */
const COMMUNITY_UPLOAD_ACTIONS: Partial<Record<ResourceType, RbacActions>> = {
  [ResourceType.COMMUNITY_AVATAR]: RbacActions.UPDATE_COMMUNITY,
  [ResourceType.COMMUNITY_BANNER]: RbacActions.UPDATE_COMMUNITY,
  [ResourceType.CUSTOM_EMOJI]: RbacActions.MANAGE_EMOJIS,
  [ResourceType.SOUNDBOARD_SOUND]: RbacActions.CREATE_SOUNDBOARD_SOUND,
};

@Injectable()
export class FileUploadService {
  private readonly logger = new Logger(FileUploadService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly storageService: StorageService,
    private readonly storageQuotaService: StorageQuotaService,
    private readonly thumbnailService: ThumbnailService,
    private readonly mediaDimensionsService: MediaDimensionsService,
    private readonly permissionsService: PermissionsService,
    private readonly ffmpegProvider: FfmpegProvider,
  ) {}

  /**
   * A resourceId decides who can read the file and what can use it, so it has
   * to be something the uploader controls. Uploads without one stay allowed:
   * nothing but the uploader can reach them. An unknown id gets the same error,
   * so this can't be used to test whether a message exists.
   */
  private async assertCanUploadFor(
    { resourceType, resourceId }: CreateFileUploadDto,
    user: UserEntity,
  ): Promise<void> {
    if (!resourceId) return;

    let allowed: boolean;
    switch (resourceType) {
      case ResourceType.USER_AVATAR:
      case ResourceType.USER_BANNER:
      case ResourceType.REPLAY_CLIP:
        allowed = resourceId === user.id;
        break;
      case ResourceType.MESSAGE_ATTACHMENT: {
        const message = await this.databaseService.message.findUnique({
          where: { id: resourceId },
          select: { authorId: true },
        });
        allowed = !!message && message.authorId === user.id;
        break;
      }
      default:
        allowed =
          user.role === InstanceRole.OWNER ||
          (await this.permissionsService.verifyActionsForUserAndResource(
            user.id,
            resourceId,
            RbacResourceType.COMMUNITY,
            [COMMUNITY_UPLOAD_ACTIONS[resourceType]!],
          ));
    }

    if (!allowed) {
      throw new ForbiddenException(
        'You cannot upload a file for this resource',
        {
          description: 'Forbidden',
          errorCode: ErrorCode.UPLOAD_TARGET_NOT_ALLOWED,
        },
      );
    }
  }

  async uploadFile(
    file: Express.Multer.File,
    createFileUploadDto: CreateFileUploadDto,
    user: UserEntity,
  ) {
    // The active default storage type decides where this NEW upload lands.
    // Existing records keep whatever storageType they were created with —
    // resolved per-record everywhere else (serve, delete, backfill).
    const storageType = this.storageService.getDefaultStorageType();
    // For LOCAL, multer already wrote the final storage location at
    // file.path — the object key IS that path (zero-copy, unchanged
    // behavior). For S3, multer's write is just local staging; the object
    // key is the bare multer-generated filename and the bytes get streamed
    // up below before the DB record is created.
    let objectKey = file.path;

    try {
      await this.assertCanUploadFor(createFileUploadDto, user);
    } catch (error) {
      await this.cleanupFile(file.path);
      throw error;
    }

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
          {
            description: 'Payload Too Large',
            errorCode: ErrorCode.STORAGE_QUOTA_EXCEEDED,
          },
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

      // A small file can still hold minutes of decoded audio: cap the length
      // of a soundboard sound too, reading it with the same ffprobe the replay
      // pipeline uses.
      if (createFileUploadDto.resourceType === ResourceType.SOUNDBOARD_SOUND) {
        await this.assertSoundboardDuration(file);
      }

      // Generate checksum (streamed — never buffers the whole file)
      const checksum = await this.generateChecksum(file.path);

      // Determine file type from MIME type
      const fileType = this.getFileTypeFromMimeType(file.mimetype);

      // For S3, stream the staged tmp file up to the bucket now, before
      // creating the DB record — a failed upload must never produce an
      // orphan row. The local tmp file stays put: video thumbnailing (below)
      // still needs a local path for ffmpeg, so it's cleaned up afterwards.
      if (storageType === StorageType.S3) {
        objectKey = file.filename;
        try {
          const provider = this.storageService.getProvider(StorageType.S3);
          await provider.writeStream(
            objectKey,
            this.storageService.createReadStream(file.path),
            { contentType: file.mimetype },
          );
        } catch (uploadError) {
          await this.cleanupFile(file.path);
          this.logger.error(`Failed to upload file to S3: ${uploadError}`);
          throw uploadError;
        }
      }

      // Create database record
      try {
        // Read display dimensions while the local file is still there, so
        // clients can reserve an attachment's box before it loads.
        // Best-effort: a failed probe leaves both columns null and never
        // fails the upload.
        const dimensions = await this.mediaDimensionsService.read(
          file.path,
          file.mimetype,
        );

        const { resourceId, ...dtoRest } = createFileUploadDto;
        const fileRecord = await this.databaseService.file.create({
          data: {
            ...dtoRest,
            ...this.mapResourceIdToTypedColumn(
              dtoRest.resourceType,
              resourceId,
            ),
            filename: this.sanitizeFilename(file.originalname),
            mimeType: file.mimetype,
            fileType,
            size: file.size,
            width: dimensions?.width ?? null,
            height: dimensions?.height ?? null,
            checksum,
            uploadedById: user.id,
            storageType,
            storagePath: objectKey,
          },
        });

        // Increment user's storage usage
        await this.storageQuotaService.incrementUserStorage(user.id, file.size);

        // Generate thumbnail for video files before responding, so the
        // attachment metadata clients receive carries hasThumbnail: true.
        // Failure is non-fatal — the upload succeeds without a thumbnail.
        const finalRecord =
          fileType === FileType.VIDEO
            ? ((await this.generateThumbnail(
                file.path,
                fileRecord.id,
                storageType,
              )) ?? fileRecord)
            : fileRecord;

        // The local tmp copy is only scratch space for S3 uploads (ffmpeg
        // thumbnailing needed it above) — safe to remove now. For LOCAL,
        // file.path IS the permanent storage location and must never be
        // deleted here.
        if (storageType === StorageType.S3) {
          await this.cleanupFile(file.path);
        }

        return new FileUploadResponseDto(finalRecord);
      } catch (dbError) {
        // If DB insert fails, clean up the local tmp file and, if the
        // object was already uploaded to S3, the now-orphaned remote copy.
        await this.cleanupFile(file.path);
        if (storageType === StorageType.S3) {
          await this.cleanupRemoteObject(objectKey);
        }
        this.logger.error(`Database error during file upload: ${dbError}`);
        throw dbError;
      }
    } catch (error) {
      // Ensure file is cleaned up on any error
      if (
        error instanceof UnprocessableEntityException ||
        error instanceof PayloadTooLargeException ||
        error instanceof BadRequestException
      ) {
        throw error; // Already cleaned up and has proper message
      }

      // For unexpected errors (not already handled), clean up and re-throw
      this.logger.error(`Error processing file upload: ${error}`);
      throw error;
    }
  }

  /**
   * Reject a soundboard sound that is longer than the shared limit, or whose
   * length ffprobe can't read (not a decodable audio file). The local upload
   * is removed before throwing, as for any other rejected upload.
   */
  private async assertSoundboardDuration(
    file: Express.Multer.File,
  ): Promise<void> {
    let duration: number;
    try {
      const metadata = await this.ffmpegProvider.ffprobe(file.path);
      duration = Number(metadata?.format?.duration);
    } catch (error) {
      this.logger.warn(
        `Could not probe the length of ${file.originalname}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      duration = Number.NaN;
    }

    if (!Number.isFinite(duration) || duration <= 0) {
      await this.cleanupFile(file.path);
      throw new BadRequestException(
        'Could not read the length of this sound. Upload a valid audio file.',
      );
    }

    if (duration > SOUNDBOARD_SOUND_MAX_DURATION_SECONDS) {
      await this.cleanupFile(file.path);
      throw new BadRequestException(
        `Soundboard sounds must be ${SOUNDBOARD_SOUND_MAX_DURATION_SECONDS} seconds or shorter`,
      );
    }
  }

  /**
   * Generate a thumbnail for a video upload and persist its path.
   * Errors are logged but never propagate to the upload response.
   *
   * @returns The updated file record, or null if generation failed
   */
  private async generateThumbnail(
    filePath: string,
    fileId: string,
    storageType: StorageType,
  ) {
    try {
      const thumbnailPath = await this.thumbnailService.generateVideoThumbnail(
        filePath,
        fileId,
        storageType,
      );
      if (!thumbnailPath) {
        return null;
      }
      return await this.databaseService.file.update({
        where: { id: fileId },
        data: { thumbnailPath },
      });
    } catch (error) {
      this.logger.error(
        `Failed to generate thumbnail for file ${fileId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /**
   * Best-effort cleanup of an S3 object orphaned by a failed DB insert
   * (upload succeeded, but the record that would reference it never
   * committed). Logged, never thrown — mirrors cleanupFile's non-fatal
   * cleanup semantics.
   */
  private async cleanupRemoteObject(key: string): Promise<void> {
    try {
      const provider = this.storageService.getProvider(StorageType.S3);
      await provider.deleteFile(key);
      this.logger.debug(`Cleaned up orphaned S3 object: ${key}`);
    } catch (error) {
      this.logger.warn(
        `Failed to clean up orphaned S3 object ${key}: ${error}`,
      );
    }
  }

  /**
   * Sanitize the client-supplied original filename before persisting it for
   * display: strip path separators and control characters, and cap the
   * length at 255 characters. The on-disk name is multer-generated and never
   * derived from this value.
   */
  private sanitizeFilename(originalName: string): string {
    const sanitized = (originalName ?? '')
      .replace(/[/\\]/g, '_')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .trim();

    return (sanitized.length > 0 ? sanitized : 'file').slice(0, 255);
  }

  /**
   * Delete the local tmp file staged by multer. Always local — this never
   * needs per-record provider resolution (it runs before any DB record, or
   * S3 upload, exists).
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
   * Generate a SHA-256 checksum for a file by streaming it through the
   * hash — never buffers the whole file into memory.
   */
  private async generateChecksum(filePath: string): Promise<string> {
    const hash = createHash('sha256');
    const stream = this.storageService.createReadStream(filePath);
    for await (const chunk of stream) {
      hash.update(chunk as Buffer);
    }
    return hash.digest('hex');
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
      case ResourceType.SOUNDBOARD_SOUND:
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

    return new FileUploadResponseDto(result);
  }
}
