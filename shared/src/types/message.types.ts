export enum SpanType {
  PLAINTEXT = 'PLAINTEXT',
  USER_MENTION = 'USER_MENTION',
  SPECIAL_MENTION = 'SPECIAL_MENTION',
  COMMUNITY_MENTION = 'COMMUNITY_MENTION',
  ALIAS_MENTION = 'ALIAS_MENTION',
  // #channel mention: `channelId` only, `text` is always null (no name is
  // stored); readers resolve the name from the channels they can see.
  CHANNEL_MENTION = 'CHANNEL_MENTION',
  // Multi-line fenced (```) code block. Its `text` is rendered verbatim —
  // no mentions, inline formatting, or auto-linking are parsed inside it.
  CODE_BLOCK = 'CODE_BLOCK',
  // Community custom emoji (`:shortcode:`). Rendered as an inline image resolved
  // from `emojiId`; `text` holds the `:shortcode:` for round-trip and fallback.
  EMOJI = 'EMOJI',
}

export interface Span {
  type: SpanType;
  text?: string;
  userId?: string;
  specialKind?: string;
  communityId?: string;
  // For CHANNEL_MENTION spans
  // null when redacted for a reader who can't see the channel
  channelId?: string | null;
  aliasId?: string;
  // For EMOJI spans: id of the community CustomEmoji this shortcode resolved to.
  emojiId?: string;
  // Composable inline-formatting flags applied to PLAINTEXT spans. They combine
  // freely (a span can be bold AND italic). `code` marks an inline `code` run
  // whose text is rendered verbatim (no formatting/mentions/links inside).
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  code?: boolean;
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

export interface LinkPreview {
  url: string;
  title?: string;
  description?: string;
  imageUrl?: string;
  siteName?: string;
  faviconUrl?: string;
  authorName?: string;
}

export interface Message {
  id: string;
  channelId?: string | null;
  directMessageGroupId?: string | null;
  authorId: string | null;
  spans: Span[];
  attachments: FileMetadata[];
  pendingAttachments?: number;
  reactions: Reaction[];
  linkPreviews?: LinkPreview[];
  sentAt: string;
  editedAt?: string;
  deletedAt?: string;
  // Pinning fields (server DTOs send explicit null when unset)
  pinned?: boolean;
  pinnedAt?: string | null;
  pinnedBy?: string | null;
  // Threading fields
  parentMessageId?: string;
  replyCount?: number;
  lastReplyAt?: string | null;
  // Inline reply (quote) fields
  replyToId?: string | null;
  replyTo?: {
    id: string;
    authorId: string | null;
    spans: Span[];
    sentAt: string;
    deletedAt?: string | null;
  } | null;
  // Incoming webhook attribution — set instead of authorId for webhook-posted messages
  webhook?: {
    id: string;
    name: string;
    avatarUrl?: string | null;
  } | null;
}
