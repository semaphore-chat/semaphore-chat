import {
  Injectable,
  Logger,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { RbacActions } from '@prisma/client';
import { PermissionsService } from '@/roles/permissions.service';
import { DatabaseService } from '@/database/database.service';
import { StorageService } from '@/storage/storage.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  ClipMessageCreateEvent,
  emitClipMessageCreate,
} from '@/common/events/clip-message.events';
import { getErrorMessage } from '@/common/utils/error.utils';
import {
  UpdateClipDto,
  ShareClipDto,
  ClipResponseDto,
  ShareClipResponseDto,
} from './dto/clip-library.dto';

/**
 * Service for managing the user's clip library (CRUD operations)
 *
 * Extracted from LivekitReplayService to follow single responsibility principle.
 * Handles clip metadata, visibility, and sharing - not video processing.
 */
@Injectable()
export class ClipLibraryService {
  private readonly logger = new Logger(ClipLibraryService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly storageService: StorageService,
    private readonly eventEmitter: EventEmitter2,
    private readonly permissionsService: PermissionsService,
  ) {}

  /**
   * Map database clip to response DTO
   */
  private mapClipToResponse(clip: {
    id: string;
    fileId: string;
    channelId: string | null;
    durationSeconds: number;
    isPublic: boolean;
    capturedAt: Date;
    file: {
      id: string;
      filename: string;
      size: number;
    };
  }): ClipResponseDto {
    return {
      id: clip.id,
      fileId: clip.fileId,
      channelId: clip.channelId,
      durationSeconds: clip.durationSeconds,
      isPublic: clip.isPublic,
      capturedAt: clip.capturedAt,
      downloadUrl: `/file/${clip.fileId}`,
      sizeBytes: clip.file.size,
      filename: clip.file.filename,
    };
  }

  /**
   * Get all clips for a user (their personal clip library)
   *
   * @param userId - ID of the user
   * @returns Array of clips with file metadata
   */
  async getUserClips(userId: string): Promise<ClipResponseDto[]> {
    this.logger.log(`Fetching clips for user ${userId}`);

    const clips = await this.databaseService.replayClip.findMany({
      where: { userId },
      include: {
        file: {
          select: {
            id: true,
            filename: true,
            size: true,
          },
        },
      },
      orderBy: { capturedAt: 'desc' },
    });

    return clips.map((clip) => this.mapClipToResponse(clip));
  }

  /**
   * Get public clips for a user (visible on their profile)
   *
   * @param userId - ID of the user whose public clips to fetch
   * @returns Array of public clips with file metadata
   */
  async getPublicClips(userId: string): Promise<ClipResponseDto[]> {
    this.logger.log(`Fetching public clips for user ${userId}`);

    const clips = await this.databaseService.replayClip.findMany({
      where: {
        userId,
        isPublic: true,
      },
      include: {
        file: {
          select: {
            id: true,
            filename: true,
            size: true,
          },
        },
      },
      orderBy: { capturedAt: 'desc' },
    });

    return clips.map((clip) => this.mapClipToResponse(clip));
  }

  /**
   * Update a clip (e.g., toggle public visibility)
   *
   * @param userId - ID of the user (for ownership verification)
   * @param clipId - ID of the clip to update
   * @param dto - Update data
   * @returns Updated clip
   */
  async updateClip(
    userId: string,
    clipId: string,
    dto: UpdateClipDto,
  ): Promise<ClipResponseDto> {
    this.logger.log(`Updating clip ${clipId} for user ${userId}`);

    // Verify ownership
    const clip = await this.databaseService.replayClip.findFirst({
      where: { id: clipId, userId },
      include: {
        file: {
          select: {
            id: true,
            filename: true,
            size: true,
          },
        },
      },
    });

    if (!clip) {
      throw new NotFoundException('Clip not found or access denied');
    }

    // Update clip
    const updatedClip = await this.databaseService.replayClip.update({
      where: { id: clipId },
      data: {
        ...(dto.isPublic !== undefined && { isPublic: dto.isPublic }),
      },
      include: {
        file: {
          select: {
            id: true,
            filename: true,
            size: true,
          },
        },
      },
    });

    this.logger.log(`Updated clip ${clipId}: isPublic=${updatedClip.isPublic}`);

    return this.mapClipToResponse(updatedClip);
  }

  /**
   * Delete a clip from user's library
   *
   * @param userId - ID of the user (for ownership verification)
   * @param clipId - ID of the clip to delete
   */
  async deleteClip(userId: string, clipId: string): Promise<void> {
    this.logger.log(`Deleting clip ${clipId} for user ${userId}`);

    // Verify ownership and get file info
    const clip = await this.databaseService.replayClip.findFirst({
      where: { id: clipId, userId },
      include: {
        file: {
          select: {
            id: true,
            storagePath: true,
          },
        },
      },
    });

    if (!clip) {
      throw new NotFoundException('Clip not found or access denied');
    }

    // Delete clip record (will cascade delete due to relation)
    await this.databaseService.replayClip.delete({
      where: { id: clipId },
    });

    // Delete file record
    await this.databaseService.file.delete({
      where: { id: clip.fileId },
    });

    // Delete actual file from storage
    try {
      if (clip.file.storagePath) {
        await this.storageService.deleteFile(clip.file.storagePath);
        this.logger.log(`Deleted file from storage: ${clip.file.storagePath}`);
      }
    } catch (error) {
      this.logger.warn(
        `Failed to delete file from storage: ${getErrorMessage(error)}`,
      );
      // Don't throw - DB records are already deleted
    }

    this.logger.log(`Successfully deleted clip ${clipId}`);
  }

  /**
   * Share an existing clip to a channel or DM
   *
   * Creates a message with the clip attached without creating a new clip
   *
   * @param userId - ID of the user sharing the clip
   * @param clipId - ID of the clip to share
   * @param dto - Share destination details
   * @returns Response with message ID
   */
  async shareClip(
    userId: string,
    clipId: string,
    dto: ShareClipDto,
  ): Promise<ShareClipResponseDto> {
    this.logger.log(`Sharing clip ${clipId} to ${dto.destination}`);

    // Verify ownership
    const clip = await this.databaseService.replayClip.findFirst({
      where: { id: clipId, userId },
      include: {
        file: {
          select: {
            id: true,
            size: true,
          },
        },
      },
    });

    if (!clip) {
      throw new NotFoundException('Clip not found or access denied');
    }

    // Authorization: verify the user can post to the target destination
    if (dto.destination === 'channel' && dto.targetChannelId) {
      const channel = await this.databaseService.channel.findUnique({
        where: { id: dto.targetChannelId },
      });
      if (!channel) {
        throw new NotFoundException('Target channel not found');
      }
      // Posting a clip is sending a message with a file: the same channel
      // permissions as any message (overwrites, timeouts, private channels).
      const allowed = await this.permissionsService.userHasChannelActions(
        userId,
        dto.targetChannelId,
        [RbacActions.CREATE_MESSAGE, RbacActions.ATTACH_FILES],
      );
      if (!allowed) {
        throw new ForbiddenException(
          "You don't have permission to post files in that channel",
        );
      }
    }

    if (dto.destination === 'dm' && dto.targetDirectMessageGroupId) {
      const dmMember =
        await this.databaseService.directMessageGroupMember.findFirst({
          where: { groupId: dto.targetDirectMessageGroupId, userId },
        });
      if (!dmMember) {
        throw new ForbiddenException(
          'You are not a member of the target DM group',
        );
      }
    }

    const sizeMB = Math.round(clip.file.size / 1024 / 1024);

    // Delegate message creation + broadcast to the messages module via a
    // domain event (avoids importing MessagesModule, which would create a
    // circular module dependency).
    const eventPayload: ClipMessageCreateEvent = {
      authorId: userId,
      fileId: clip.fileId,
      durationSeconds: clip.durationSeconds,
      sizeMB,
      destination: dto.destination,
      targetChannelId: dto.targetChannelId,
      targetDirectMessageGroupId: dto.targetDirectMessageGroupId,
    };

    const { messageId } = await emitClipMessageCreate(
      this.eventEmitter,
      eventPayload,
    );

    this.logger.log(
      `Shared clip ${clipId} to ${dto.destination} via message ${messageId}`,
    );

    return {
      messageId,
      clipId: clip.id,
      destination: dto.destination,
    };
  }
}
