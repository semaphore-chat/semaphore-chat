import { ApiProperty } from '@nestjs/swagger';
import { ChannelType } from '@prisma/client';
import { ChannelTypeValues } from '@/common/enums/swagger-enums';

export class ReadReceiptDto {
  id: string;
  userId: string;
  channelId: string | null;
  directMessageGroupId: string | null;
  lastReadMessageId: string;
  lastReadAt: Date;
}

export class UnreadCountDto {
  channelId?: string;
  directMessageGroupId?: string;
  /** The community the channel belongs to; null for direct-message entries. */
  @ApiProperty({ type: 'string', nullable: true, required: false })
  communityId?: string | null;
  /** The channel's type; absent for direct-message entries. Badges count TEXT channels only (as the classic sidebar shows them). */
  @ApiProperty({
    enum: ChannelTypeValues,
    enumName: 'ChannelType',
    required: false,
  })
  channelType?: ChannelType;
  @ApiProperty({ type: 'integer' })
  unreadCount: number;
  @ApiProperty({ type: 'integer' })
  mentionCount: number;
  lastReadMessageId?: string;
  lastReadAt?: Date;
}

export class LastReadResponseDto {
  lastReadMessageId: string | null;
}

export class MessageReaderDto {
  userId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  readAt: Date;
}

export class DmPeerReadDto {
  userId: string;
  lastReadAt: Date;
}
