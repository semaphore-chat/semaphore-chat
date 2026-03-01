export enum SpanType {
  PLAINTEXT = 'PLAINTEXT',
  USER_MENTION = 'USER_MENTION',
  SPECIAL_MENTION = 'SPECIAL_MENTION',
  COMMUNITY_MENTION = 'COMMUNITY_MENTION',
  ALIAS_MENTION = 'ALIAS_MENTION',
}

export interface Span {
  type: SpanType;
  text?: string;
  userId?: string;
  specialKind?: string;
  communityId?: string;
  aliasId?: string;
}

export interface Reaction {
  emoji: string;
  userIds: string[];
}

export interface FileMetadata {
  id: string;
  filename: string;
  mimeType: string;
  fileType: string;
  size: number;
  hasThumbnail?: boolean;
}

export interface Message {
  id: string;
  channelId?: string;
  directMessageGroupId?: string;
  authorId: string | null;
  spans: Span[];
  attachments: FileMetadata[];
  pendingAttachments?: number;
  reactions: Reaction[];
  sentAt: string;
  editedAt?: string;
  deletedAt?: string;
  // Pinning fields
  pinned?: boolean;
  pinnedAt?: string;
  pinnedBy?: string;
  // Threading fields
  parentMessageId?: string;
  replyCount?: number;
  lastReplyAt?: string;
}
