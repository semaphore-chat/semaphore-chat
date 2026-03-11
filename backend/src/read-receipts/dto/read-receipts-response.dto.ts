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
  unreadCount: number;
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
