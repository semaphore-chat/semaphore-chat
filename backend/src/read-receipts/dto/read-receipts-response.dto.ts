import { ApiProperty } from '@nestjs/swagger';

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
