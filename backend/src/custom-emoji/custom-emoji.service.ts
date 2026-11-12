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
import { RoomEvents } from '@/rooms/room-subscription.events';
import { CreateCustomEmojiDto } from './dto/create-custom-emoji.dto';
import { CustomEmojiDto } from './dto/custom-emoji-response.dto';

/**
 * Community-scoped custom emojis.
 *
 * Managers upload a small image (validated as a CUSTOM_EMOJI file) then register
 * it under a `:shortcode:` name. Members use the shortcode inline in messages and
 * as reactions (via the `custom:{emojiId}` sentinel).
 */
@Injectable()
export class CustomEmojiService {
  private readonly logger = new Logger(CustomEmojiService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  private toDto(emoji: {
    id: string;
    communityId: string;
    name: string;
    fileId: string;
    createdBy: string | null;
    createdAt: Date;
  }): CustomEmojiDto {
    return {
      id: emoji.id,
      communityId: emoji.communityId,
      name: emoji.name,
      fileId: emoji.fileId,
      createdBy: emoji.createdBy,
      createdAt: emoji.createdAt,
    };
  }

  /** List all custom emojis for a community, alphabetically by name. */
  async listCommunityEmojis(communityId: string): Promise<CustomEmojiDto[]> {
    const emojis = await this.databaseService.customEmoji.findMany({
      where: { communityId },
      orderBy: { name: 'asc' },
    });
    return emojis.map((e) => this.toDto(e));
  }

  /**
   * Register a new custom emoji from a previously uploaded CUSTOM_EMOJI file.
   *
   * Validates: name uniqueness within the community, and that the referenced
   * file is a non-deleted CUSTOM_EMOJI belonging to this community.
   */
  async createEmoji(
    communityId: string,
    dto: CreateCustomEmojiDto,
    userId: string,
  ): Promise<CustomEmojiDto> {
    const existing = await this.databaseService.customEmoji.findUnique({
      where: { communityId_name: { communityId, name: dto.name } },
    });
    if (existing) {
      throw new ConflictException(
        `An emoji named ":${dto.name}:" already exists in this community`,
      );
    }

    const file = await this.databaseService.file.findUnique({
      where: { id: dto.fileId },
    });
    if (!file || file.deletedAt) {
      throw new NotFoundException('Emoji image file not found');
    }
    if (file.resourceType !== ResourceType.CUSTOM_EMOJI) {
      throw new BadRequestException('File is not a custom emoji image');
    }
    if (file.fileCommunityId !== communityId) {
      throw new BadRequestException(
        'Emoji image does not belong to this community',
      );
    }

    const emoji = await this.databaseService.customEmoji.create({
      data: {
        communityId,
        name: dto.name,
        fileId: dto.fileId,
        createdBy: userId,
      },
    });

    this.logger.log(
      `Created custom emoji ":${dto.name}:" (${emoji.id}) in community ${communityId}`,
    );

    this.eventEmitter.emit(RoomEvents.CUSTOM_EMOJI_CREATED, {
      communityId,
      emojiId: emoji.id,
    });

    return this.toDto(emoji);
  }

  /**
   * Delete a custom emoji. The emoji must belong to the given community.
   * Existing message spans referencing it fall back to their `:shortcode:` text
   * (the FK is ON DELETE SET NULL).
   */
  async deleteEmoji(communityId: string, emojiId: string): Promise<void> {
    const emoji = await this.databaseService.customEmoji.findUnique({
      where: { id: emojiId },
    });
    if (!emoji || emoji.communityId !== communityId) {
      throw new NotFoundException('Custom emoji not found');
    }

    await this.databaseService.customEmoji.delete({ where: { id: emojiId } });

    this.logger.log(
      `Deleted custom emoji ":${emoji.name}:" (${emojiId}) from community ${communityId}`,
    );

    this.eventEmitter.emit(RoomEvents.CUSTOM_EMOJI_DELETED, {
      communityId,
      emojiId,
    });
  }
}
