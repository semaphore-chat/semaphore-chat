import type { InfiniteData } from '@tanstack/react-query';
import type { PaginatedMessagesResponseDto, ThreadRepliesResponseDto, EnrichedThreadReplyDto, FriendshipWithUsersDto, UserEntity } from '../../api-client/types.gen';
import type { Message, Reaction, Span } from '../../types/message.type';
import { SpanType } from '../../types/message.type';
import type { DirectMessageGroup } from '../../types/direct-message.type';
import type { DmGroupMemberDto } from '../../api-client/types.gen';
import { ChannelType, type Channel } from '../../types/channel.type';

let counter = 0;

function nextId(): string {
  return `msg-${++counter}`;
}

export function resetFactoryCounter() {
  counter = 0;
}

export function createMessage(overrides: Partial<Message> = {}): Message {
  const id = overrides.id ?? nextId();
  return {
    id,
    channelId: 'channel-1',
    authorId: 'user-1',
    spans: [],
    attachments: [],
    reactions: [],
    sentAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Creates a message that satisfies both Message and EnrichedMessageDto at runtime.
 * Use `as never` when inserting into typed caches (same pattern as production code).
 */
export function createEnrichedMessage(overrides: Partial<Message> = {}): Message {
  return createMessage({
    pinned: false,
    pinnedAt: undefined,
    pinnedBy: undefined,
    replyCount: 0,
    lastReplyAt: undefined,
    pendingAttachments: 0,
    ...overrides,
  });
}

export function createThreadReply(overrides: Partial<EnrichedThreadReplyDto> = {}): EnrichedThreadReplyDto {
  const id = overrides.id ?? nextId();
  return {
    id,
    channelId: 'channel-1',
    directMessageGroupId: null,
    authorId: 'user-1',
    spans: [],
    attachments: [],
    pendingAttachments: 0,
    reactions: [],
    sentAt: new Date().toISOString(),
    editedAt: null,
    deletedAt: null,
    pinned: false,
    pinnedAt: null,
    pinnedBy: null,
    replyCount: 0,
    lastReplyAt: null,
    parentMessageId: 'parent-1',
    ...overrides,
  } as EnrichedThreadReplyDto;
}

export function createReaction(overrides: Partial<Reaction> = {}): Reaction {
  return {
    emoji: '👍',
    userIds: ['user-1'],
    ...overrides,
  };
}

/** Single-page InfiniteData for channel messages */
export function createInfiniteData(
  messages: Message[],
  continuationToken?: string,
): InfiniteData<PaginatedMessagesResponseDto> {
  return {
    pages: [{ messages: messages as never[], continuationToken }],
    pageParams: [undefined],
  };
}

/** Multi-page InfiniteData for channel messages */
export function createMultiPageInfiniteData(
  pages: { messages: Message[]; continuationToken?: string }[],
): InfiniteData<PaginatedMessagesResponseDto> {
  return {
    pages: pages.map(p => ({
      messages: p.messages as never[],
      continuationToken: p.continuationToken,
    })),
    pageParams: pages.map((_, i) => (i === 0 ? undefined : `token-${i}`)),
  };
}

/** Flat PaginatedMessagesResponseDto for DMs */
export function createFlatData(
  messages: Message[],
  continuationToken?: string,
): PaginatedMessagesResponseDto {
  return {
    messages: messages as never[],
    continuationToken,
  };
}

/** ThreadRepliesResponseDto */
export function createThreadRepliesData(
  replies: EnrichedThreadReplyDto[],
  continuationToken?: string,
): ThreadRepliesResponseDto {
  return {
    replies,
    continuationToken,
  };
}

export function createChannel(overrides: Partial<{
  id: string;
  name: string;
  communityId: string;
  type: ChannelType | 'TEXT' | 'VOICE';
  isPrivate: boolean;
  createdAt: string;
  position: number;
  slowmodeSeconds: number;
}> = {}): Channel {
  return {
    id: overrides.id ?? `channel-${++counter}`,
    name: overrides.name ?? 'general',
    communityId: overrides.communityId ?? 'community-1',
    type: overrides.type === 'VOICE' ? 'VOICE' : 'TEXT',
    isPrivate: overrides.isPrivate ?? false,
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    position: overrides.position ?? 0,
    slowmodeSeconds: overrides.slowmodeSeconds ?? 0,
  };
}

export function createUser(overrides: Partial<UserEntity & { email: string }> = {}): UserEntity & { email: string } {
  const id = overrides.id ?? `user-${++counter}`;
  return {
    id,
    username: overrides.username ?? `user_${id}`,
    displayName: overrides.displayName ?? null,
    avatarUrl: overrides.avatarUrl ?? null,
    bannerUrl: overrides.bannerUrl ?? null,
    lastSeen: overrides.lastSeen ?? null,
    bio: overrides.bio ?? null,
    status: overrides.status ?? null,
    role: overrides.role ?? 'USER',
    email: overrides.email ?? `${id}@test.com`,
  };
}

export function createDmGroupMember(overrides: Partial<DmGroupMemberDto> = {}): DmGroupMemberDto {
  const memberId = overrides.id ?? `member-${++counter}`;
  const userId = overrides.userId ?? `user-${++counter}`;
  return {
    id: memberId,
    userId,
    joinedAt: overrides.joinedAt ?? new Date().toISOString(),
    user: overrides.user ?? {
      id: userId,
      username: `user_${userId}`,
      displayName: null,
      avatarUrl: null,
    },
  };
}

export function createDmGroup(overrides: Partial<DirectMessageGroup> = {}): DirectMessageGroup {
  return {
    id: overrides.id ?? `dm-${++counter}`,
    name: overrides.name ?? null,
    isGroup: overrides.isGroup ?? false,
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    members: overrides.members ?? [],
    lastMessage: overrides.lastMessage ?? null,
  };
}

export function createSpan(overrides: Partial<{
  type: SpanType;
  text: string;
  userId: string;
  specialKind: string;
  communityId: string;
  aliasId: string;
}> = {}): Span {
  return {
    type: overrides.type ?? SpanType.PLAINTEXT,
    text: overrides.text ?? 'hello',
    userId: overrides.userId,
    specialKind: overrides.specialKind,
    communityId: overrides.communityId,
    aliasId: overrides.aliasId,
  };
}

export function createFileMetadata(overrides: Partial<{
  id: string;
  filename: string;
  mimeType: string;
  fileType: string;
  size: number;
}> = {}) {
  return {
    id: overrides.id ?? `file-${++counter}`,
    filename: overrides.filename ?? 'test-file.png',
    mimeType: overrides.mimeType ?? 'image/png',
    fileType: overrides.fileType ?? 'IMAGE',
    size: overrides.size ?? 1024,
  };
}

function createUserEntity(overrides: Partial<UserEntity> = {}): UserEntity {
  const id = overrides.id ?? `user-${++counter}`;
  return {
    id,
    username: overrides.username ?? `user_${id}`,
    displayName: overrides.displayName ?? null,
    avatarUrl: overrides.avatarUrl ?? null,
    bannerUrl: overrides.bannerUrl ?? null,
    lastSeen: overrides.lastSeen ?? null,
    bio: overrides.bio ?? null,
    status: overrides.status ?? null,
    role: overrides.role ?? 'USER',
  };
}

export function createFriendship(overrides: Partial<FriendshipWithUsersDto> = {}): FriendshipWithUsersDto {
  const id = overrides.id ?? `friendship-${++counter}`;
  return {
    id,
    userAId: overrides.userAId ?? overrides.userA?.id ?? `user-${++counter}`,
    userBId: overrides.userBId ?? overrides.userB?.id ?? `user-${++counter}`,
    status: overrides.status ?? 'PENDING',
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    userA: overrides.userA ?? createUserEntity({ id: overrides.userAId }),
    userB: overrides.userB ?? createUserEntity({ id: overrides.userBId }),
  };
}
