import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { createTestQueryClient, createTestWrapper, createChannel, createDmGroup, createDmGroupMember } from '../test-utils';
import { useHomeSummary } from '../../hooks/useHomeSummary';
import {
  voicePresenceControllerGetChannelPresenceQueryKey,
  channelsControllerFindAllForCommunityQueryKey,
} from '../../api-client/@tanstack/react-query.gen';
import type {
  ChannelDto,
  ChannelVoicePresenceResponseDto,
  CommunityResponseDto,
  DmGroupResponseDto,
  UnreadCountDto,
} from '../../api-client/types.gen';

const community = (id: string, name: string): CommunityResponseDto => ({
  id,
  name,
  description: null,
  avatar: null,
  banner: null,
  createdAt: '2026-01-01T00:00:00.000Z',
});
const voiceUser = (id: string) => ({
  id,
  username: id,
  joinedAt: '2026-01-01T00:00:00.000Z',
  isDeafened: false,
  isServerMuted: false,
});

let mockCommunities: CommunityResponseDto[] = [];
let mockChannels: Record<string, ChannelDto[] | Error> = {};
let mockUnread: UnreadCountDto[] = [];
let mockDms: DmGroupResponseDto[] = [];
let mockPresence: Record<string, ChannelVoicePresenceResponseDto> = {};
const presenceFetches: string[] = [];

vi.mock('../../api-client/@tanstack/react-query.gen', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api-client/@tanstack/react-query.gen')>();
  type PathOpts<K extends string> = { path: Record<K, string> };
  return {
    ...actual,
    communityControllerFindAllMineOptions: () => ({
      ...actual.communityControllerFindAllMineOptions(),
      queryFn: async () => mockCommunities,
    }),
    readReceiptsControllerGetUnreadCountsOptions: () => ({
      ...actual.readReceiptsControllerGetUnreadCountsOptions(),
      queryFn: async () => mockUnread,
    }),
    directMessagesControllerFindUserDmGroupsOptions: () => ({
      ...actual.directMessagesControllerFindUserDmGroupsOptions(),
      queryFn: async () => mockDms,
    }),
    channelsControllerFindAllForCommunityOptions: (opts: PathOpts<'communityId'>) => ({
      ...actual.channelsControllerFindAllForCommunityOptions(opts),
      queryFn: async () => {
        const result = mockChannels[opts.path.communityId] ?? [];
        if (result instanceof Error) throw result;
        return result;
      },
    }),
    voicePresenceControllerGetChannelPresenceOptions: (opts: PathOpts<'channelId'>) => ({
      ...actual.voicePresenceControllerGetChannelPresenceOptions(opts),
      queryFn: async () => {
        presenceFetches.push(opts.path.channelId);
        return mockPresence[opts.path.channelId] ?? { channelId: opts.path.channelId, users: [], count: 0 };
      },
    }),
  };
});

function setup() {
  const queryClient = createTestQueryClient();
  const utils = renderHook(() => useHomeSummary(), { wrapper: createTestWrapper({ queryClient }) });
  return { ...utils, queryClient };
}

describe('useHomeSummary', () => {
  beforeEach(() => {
    presenceFetches.length = 0;
    mockCommunities = [community('c1', 'Gaming'), community('c2', 'Work')];
    mockChannels = {
      c1: [
        createChannel({ id: 'general', name: 'general', communityId: 'c1' }),
        createChannel({ id: 'lounge', name: 'Lounge', communityId: 'c1', type: 'VOICE' }),
      ],
      c2: [
        createChannel({ id: 'dev', name: 'dev', communityId: 'c2' }),
        createChannel({ id: 'standup', name: 'Standup', communityId: 'c2', type: 'VOICE' }),
      ],
    };
    mockUnread = [];
    mockDms = [];
    mockPresence = {};
  });

  it('lists channels with unread mentions, named and placed in their community, most mentions first', async () => {
    mockUnread = [
      { channelId: 'general', unreadCount: 5, mentionCount: 1 },
      { channelId: 'dev', unreadCount: 9, mentionCount: 3 },
      { channelId: 'lounge', unreadCount: 2, mentionCount: 0 },
      { directMessageGroupId: 'dm1', unreadCount: 1, mentionCount: 1 },
      { channelId: 'unknown-channel', unreadCount: 1, mentionCount: 4 },
    ];
    const { result } = setup();
    await waitFor(() => expect(result.current.mentions).toHaveLength(2));
    expect(result.current.mentions).toEqual([
      { channelId: 'dev', channelName: 'dev', communityId: 'c2', communityName: 'Work', mentionCount: 3 },
      { channelId: 'general', channelName: 'general', communityId: 'c1', communityName: 'Gaming', mentionCount: 1 },
    ]);
  });

  it('lists DMs with unread messages, newest message first', async () => {
    const older = createDmGroup({
      id: 'dm-old',
      members: [createDmGroupMember()],
      lastMessage: { id: 'm1', authorId: null, spans: [], sentAt: '2026-01-01T00:00:00.000Z' },
    });
    const newer = createDmGroup({
      id: 'dm-new',
      lastMessage: { id: 'm2', authorId: null, spans: [], sentAt: '2026-02-01T00:00:00.000Z' },
    });
    const read = createDmGroup({ id: 'dm-read' });
    mockDms = [older, newer, read];
    mockUnread = [
      { directMessageGroupId: 'dm-old', unreadCount: 2, mentionCount: 0 },
      { directMessageGroupId: 'dm-new', unreadCount: 1, mentionCount: 0 },
      { directMessageGroupId: 'dm-read', unreadCount: 0, mentionCount: 0 },
    ];
    const { result } = setup();
    await waitFor(() => expect(result.current.unreadDms).toHaveLength(2));
    expect(result.current.unreadDms.map((d) => [d.group.id, d.unreadCount])).toEqual([
      ['dm-new', 1],
      ['dm-old', 2],
    ]);
  });

  it('collects occupied voice channels across communities, fetching presence for VOICE channels only', async () => {
    mockPresence = {
      standup: { channelId: 'standup', users: [voiceUser('alice'), voiceUser('bob')], count: 2 },
    };
    const { result } = setup();
    await waitFor(() => expect(result.current.voice).toHaveLength(1));
    expect(result.current.voice[0]).toMatchObject({
      channelId: 'standup',
      channelName: 'Standup',
      communityId: 'c2',
      communityName: 'Work',
    });
    expect(result.current.voice[0].users.map((u) => u.id)).toEqual(['alice', 'bob']);
    expect([...presenceFetches].sort()).toEqual(['lounge', 'standup']);
  });

  it('shares the presence cache entry the socket voice handlers update', async () => {
    const { result, queryClient } = setup();
    await waitFor(() => expect(presenceFetches).toHaveLength(2));
    await waitFor(() => expect(result.current.isChannelsLoading).toBe(false));
    expect(result.current.voice).toEqual([]);

    // What handleVoiceUserJoined does: patch the per-channel presence query.
    act(() => {
      queryClient.setQueryData(voicePresenceControllerGetChannelPresenceQueryKey({ path: { channelId: 'lounge' } }), {
        channelId: 'lounge',
        users: [voiceUser('carol')],
        count: 1,
      });
    });
    await waitFor(() => expect(result.current.voice.map((v) => v.channelId)).toEqual(['lounge']));
  });

  it("skips a community whose channel list fails rather than failing the page", async () => {
    mockChannels.c1 = new Error('boom');
    mockUnread = [
      { channelId: 'general', unreadCount: 1, mentionCount: 1 },
      { channelId: 'dev', unreadCount: 1, mentionCount: 2 },
    ];
    const { result, queryClient } = setup();
    await waitFor(() =>
      expect(
        queryClient.getQueryState(channelsControllerFindAllForCommunityQueryKey({ path: { communityId: 'c1' } }))?.status,
      ).toBe('error'),
    );
    await waitFor(() => expect(result.current.mentions.map((m) => m.channelId)).toEqual(['dev']));
    expect(result.current.communitiesError).toBeNull();
  });

  it('has nothing to show for a user in no communities', async () => {
    mockCommunities = [];
    const { result } = setup();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.communities).toEqual([]);
    expect(result.current.mentions).toEqual([]);
    expect(result.current.voice).toEqual([]);
    expect(presenceFetches).toEqual([]);
  });
});
