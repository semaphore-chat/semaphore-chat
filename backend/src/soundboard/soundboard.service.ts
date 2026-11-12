import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { ResourceType } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DatabaseService } from '@/database/database.service';
import { FileUploadService } from '@/file-upload/file-upload.service';
import { RoomEvents } from '@/rooms/room-subscription.events';
import { isPrismaError } from '@/common/utils/prisma.utils';
import { CreateSoundboardSoundDto } from './dto/create-soundboard-sound.dto';
import { SoundboardSoundDto } from './dto/soundboard-sound-response.dto';

@Injectable()
export class SoundboardService {
  private readonly logger = new Logger(SoundboardService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly fileUploadService: FileUploadService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  private toDto(sound: {
    id: string;
    communityId: string;
    name: string;
    emoji: string | null;
    fileId: string;
    createdBy: string | null;
    createdAt: Date;
  }): SoundboardSoundDto {
    return {
      id: sound.id,
      communityId: sound.communityId,
      name: sound.name,
      emoji: sound.emoji,
      fileId: sound.fileId,
      createdBy: sound.createdBy,
      createdAt: sound.createdAt,
    };
  }

  /**
   * List all soundboard sounds for a community.
   */
  async listCommunitySounds(
    communityId: string,
  ): Promise<SoundboardSoundDto[]> {
    const sounds = await this.databaseService.soundboardSound.findMany({
      where: { communityId },
      orderBy: { name: 'asc' },
    });
    return sounds.map((s) => this.toDto(s));
  }

  /**
   * Create a soundboard sound. The audio file must already be uploaded via
   * /file-upload with resourceType SOUNDBOARD_SOUND for this community.
   */
  async createSound(
    communityId: string,
    userId: string,
    dto: CreateSoundboardSoundDto,
  ): Promise<SoundboardSoundDto> {
    // Enforce unique sound name within the community
    const existing = await this.databaseService.soundboardSound.findUnique({
      where: {
        communityId_name: { communityId, name: dto.name },
      },
    });
    if (existing) {
      throw new ConflictException(
        `A soundboard sound named "${dto.name}" already exists in this community`,
      );
    }

    // Validate the referenced file: must exist, be an audio soundboard file,
    // and belong to this community (prevents cross-community file references).
    const file = await this.databaseService.file.findUnique({
      where: { id: dto.fileId },
      select: {
        id: true,
        resourceType: true,
        fileCommunityId: true,
        deletedAt: true,
      },
    });
    if (!file || file.deletedAt) {
      throw new NotFoundException('Referenced file not found');
    }
    if (
      file.resourceType !== ResourceType.SOUNDBOARD_SOUND ||
      file.fileCommunityId !== communityId
    ) {
      throw new BadRequestException(
        'File is not a soundboard sound for this community',
      );
    }

    // Guard against reusing the same file for multiple sounds
    const fileInUse = await this.databaseService.soundboardSound.findFirst({
      where: { fileId: dto.fileId },
    });
    if (fileInUse) {
      throw new ConflictException(
        'This audio file is already used by another soundboard sound',
      );
    }

    try {
      const sound = await this.databaseService.soundboardSound.create({
        data: {
          communityId,
          name: dto.name,
          emoji: dto.emoji ?? null,
          fileId: dto.fileId,
          createdBy: userId,
        },
      });

      this.logger.log(
        `Created soundboard sound "${dto.name}" in community ${communityId}`,
      );
      this.eventEmitter.emit(RoomEvents.SOUNDBOARD_SOUND_CREATED, {
        communityId,
        soundId: sound.id,
      });
      return this.toDto(sound);
    } catch (error) {
      // The name pre-check above is not atomic with the create; a concurrent
      // request can still hit the @@unique([communityId, name]) constraint.
      if (isPrismaError(error, 'P2002')) {
        throw new ConflictException(
          `A soundboard sound named "${dto.name}" already exists in this community`,
        );
      }
      throw error;
    }
  }

  /**
   * Delete a soundboard sound (scoped to its community), then soft-delete the
   * backing file via FileUploadService.remove so the storage reaper picks up
   * the physical blob and the uploader's storage quota is credited back.
   * (A raw file.delete would hard-delete the row, orphaning the blob on disk
   * and never decrementing quota.)
   */
  async deleteSound(communityId: string, soundId: string): Promise<void> {
    const sound = await this.databaseService.soundboardSound.findUnique({
      where: { id: soundId },
    });
    if (!sound || sound.communityId !== communityId) {
      throw new NotFoundException('Soundboard sound not found');
    }

    // Look up the uploader before deleting the sound row: remove() enforces
    // owner-only deletion, so it must be called with the uploader's id (not
    // the admin performing this delete).
    const file = await this.databaseService.file.findUnique({
      where: { id: sound.fileId },
      select: { uploadedById: true, deletedAt: true },
    });

    // Delete the sound row first so the soundboard entry disappears even if
    // the file cleanup below fails.
    await this.databaseService.soundboardSound.delete({
      where: { id: soundId },
    });

    this.eventEmitter.emit(RoomEvents.SOUNDBOARD_SOUND_DELETED, {
      communityId,
      soundId,
    });

    if (file && !file.deletedAt) {
      try {
        if (file.uploadedById) {
          await this.fileUploadService.remove(sound.fileId, file.uploadedById);
        } else {
          // Uploader account deleted (uploadedById SetNull): soft-delete
          // directly so the reaper still removes the blob; no quota to credit.
          await this.databaseService.file.update({
            where: { id: sound.fileId },
            data: { deletedAt: new Date() },
          });
        }
      } catch (err: unknown) {
        this.logger.warn(
          `Failed to soft-delete backing file ${sound.fileId} for sound ${soundId}: ${String(
            err,
          )}`,
        );
      }
    }

    this.logger.log(
      `Deleted soundboard sound "${sound.name}" (${soundId}) from community ${communityId}`,
    );
  }
}
