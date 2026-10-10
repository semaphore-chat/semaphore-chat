/**
 * useHomeSummary
 *
 * The data behind the desktop Home page, built only from queries the rail,
 * sidebar and DM list already use (same query keys, so one cache each, and
 * the socket handlers keep them live):
 *
 *   - communities         communityControllerFindAllMine
 *   - unread / mentions   readReceiptsControllerGetUnreadCounts
 *   - DM names, previews  directMessagesControllerFindUserDmGroups
 *   - channel names       channelsControllerFindAllForCommunity × communities
 *   - voice               voicePresenceControllerGetChannelPresence × VOICE channels
 *
 * A community whose channel list fails is skipped (its rows just don't show)
 * rather than failing the whole page.
 */
import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import {
  channelsControllerFindAllForCommunityOptions,
  communityControllerFindAllMineOptions,
  directMessagesControllerFindUserDmGroupsOptions,
  readReceiptsControllerGetUnreadCountsOptions,
  voicePresenceControllerGetChannelPresenceOptions,
} from "../api-client/@tanstack/react-query.gen";
import type {
  ChannelDto,
  CommunityResponseDto,
  DmGroupResponseDto,
  VoicePresenceUserDto,
} from "../api-client/types.gen";

export interface HomeMention {
  channelId: string;
  channelName: string;
  communityId: string;
  communityName: string;
  mentionCount: number;
}

export interface HomeUnreadDm {
  group: DmGroupResponseDto;
  unreadCount: number;
  mentionCount: number;
}

export interface HomeVoiceChannel {
  channelId: string;
  channelName: string;
  communityId: string;
  communityName: string;
  users: VoicePresenceUserDto[];
}

export interface HomeSummary {
  communities: CommunityResponseDto[];
  mentions: HomeMention[];
  unreadDms: HomeUnreadDm[];
  voice: HomeVoiceChannel[];
  /** Communities or unread counts still loading (nothing meaningful to show yet). */
  isLoading: boolean;
  /** Channel lists / presence still loading (mentions and voice may grow). */
  isChannelsLoading: boolean;
  isDmsLoading: boolean;
  communitiesError: unknown;
  unreadError: unknown;
  dmsError: unknown;
  refetchCommunities: () => void;
  refetchUnread: () => void;
  refetchDms: () => void;
}

export function useHomeSummary(): HomeSummary {
  const communitiesQuery = useQuery(communityControllerFindAllMineOptions());
  const unreadQuery = useQuery({
    ...readReceiptsControllerGetUnreadCountsOptions(),
    refetchOnWindowFocus: true,
  });
  const dmsQuery = useQuery(directMessagesControllerFindUserDmGroupsOptions());

  const communities = useMemo(() => communitiesQuery.data ?? [], [communitiesQuery.data]);

  const channelQueries = useQueries({
    queries: communities.map((c) => channelsControllerFindAllForCommunityOptions({ path: { communityId: c.id } })),
  });

  // channelId -> channel, plus the community it belongs to. Small (a few
  // hundred channels at most), so it is rebuilt each render rather than memoised
  // over a variable number of query results.
  const channelMap = new Map<string, { channel: ChannelDto; community: CommunityResponseDto }>();
  communities.forEach((community, i) => {
    for (const channel of channelQueries[i]?.data ?? []) channelMap.set(channel.id, { channel, community });
  });

  const voiceChannels = [...channelMap.values()].filter(({ channel }) => channel.type === "VOICE");

  // Only VOICE channels get a presence query, keyed exactly like the sidebar's
  // so the socket voice handlers update this same cache entry.
  const presenceQueries = useQueries({
    queries: voiceChannels.map(({ channel }) =>
      voicePresenceControllerGetChannelPresenceOptions({ path: { channelId: channel.id } }),
    ),
  });

  const voice: HomeVoiceChannel[] = voiceChannels
    .map(({ channel, community }, i) => ({
      channelId: channel.id,
      channelName: channel.name,
      communityId: community.id,
      communityName: community.name,
      users: presenceQueries[i]?.data?.users ?? [],
    }))
    .filter((v) => v.users.length > 0);

  const mentions = ((): HomeMention[] => {
    const out: HomeMention[] = [];
    for (const count of unreadQuery.data ?? []) {
      if (!count.channelId || count.mentionCount <= 0) continue;
      const entry = channelMap.get(count.channelId);
      if (!entry) continue;
      out.push({
        channelId: entry.channel.id,
        channelName: entry.channel.name,
        communityId: entry.community.id,
        communityName: entry.community.name,
        mentionCount: count.mentionCount,
      });
    }
    return out.sort((a, b) => b.mentionCount - a.mentionCount);
  })();

  const unreadDms = useMemo<HomeUnreadDm[]>(() => {
    const groups = new Map((dmsQuery.data ?? []).map((g) => [g.id, g]));
    const out: HomeUnreadDm[] = [];
    for (const count of unreadQuery.data ?? []) {
      if (!count.directMessageGroupId || count.unreadCount <= 0) continue;
      const group = groups.get(count.directMessageGroupId);
      if (!group) continue;
      out.push({ group, unreadCount: count.unreadCount, mentionCount: count.mentionCount });
    }
    const sentAt = (g: DmGroupResponseDto) => (g.lastMessage ? new Date(g.lastMessage.sentAt).getTime() : 0);
    return out.sort((a, b) => sentAt(b.group) - sentAt(a.group));
  }, [unreadQuery.data, dmsQuery.data]);

  return {
    communities,
    mentions,
    unreadDms,
    voice,
    isLoading: communitiesQuery.isLoading || unreadQuery.isLoading,
    isChannelsLoading:
      channelQueries.some((q) => q.isLoading) || presenceQueries.some((q) => q.isLoading),
    isDmsLoading: dmsQuery.isLoading,
    communitiesError: communitiesQuery.error,
    unreadError: unreadQuery.error,
    dmsError: dmsQuery.error,
    refetchCommunities: () => void communitiesQuery.refetch(),
    refetchUnread: () => void unreadQuery.refetch(),
    refetchDms: () => void dmsQuery.refetch(),
  };
}
