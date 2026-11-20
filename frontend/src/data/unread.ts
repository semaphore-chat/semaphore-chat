/**
 * Unread counts as both shells read them: per channel, per community and the
 * inbox. One query (`readReceiptsControllerGetUnreadCounts`, the key
 * `useReadReceipts` reads and the socket handlers keep live), so the classic
 * sidebar and the new shell can never disagree.
 *
 * Headless: no UI imports (see the `src/data` lint block in eslint.config.js).
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { notificationsControllerGetUnreadCountOptions } from '../api-client/@tanstack/react-query.gen';
import type { UnreadCountDto } from '../api-client/types.gen';
import { useReadReceipts } from '../hooks/useReadReceipts';

export interface ChannelUnread {
  unread: number;
  mentions: number;
}

export interface CommunityUnread {
  mentions: number;
  hasUnread: boolean;
}

export interface InboxUnread {
  /** Unread messages in DMs and groups. */
  directMessages: number;
  /** Mentions in channels (DMs are already counted above, design F5). */
  mentions: number;
  total: number;
}

/** Stable while the counts are unchanged (safe to memoize on). */
export interface UnreadSummary {
  channel(id: string | undefined): ChannelUnread;
  /**
   * A community's channels. An entry without `communityId` (the socket
   * handlers insert one for a brand-new channel, then refetch) counts for no
   * community until the refetch tags it.
   */
  community(id: string): CommunityUnread;
  inbox: InboxUnread;
}

const NO_COMMUNITY_UNREAD: CommunityUnread = { mentions: 0, hasUnread: false };

/**
 * Badges count text channels only, as the classic channel rows show them (`ChannelRow`: a voice row has no badge or
 * unread mark). An entry without a type (one the socket handlers inserted, refetched at once) counts.
 */
function countsAsTextChannel(entry: UnreadCountDto): boolean {
  return entry.channelType === undefined || entry.channelType === 'TEXT';
}

/** Pure: channel entries grouped by community (DM entries and untagged entries are left out). */
export function groupUnreadByCommunity(
  entries: readonly UnreadCountDto[] | undefined,
): Map<string, CommunityUnread> {
  const groups = new Map<string, CommunityUnread>();
  for (const entry of entries ?? []) {
    if (!entry.channelId || !entry.communityId || !countsAsTextChannel(entry)) continue;
    const key = entry.communityId;
    const group = groups.get(key) ?? { mentions: 0, hasUnread: false };
    groups.set(key, {
      mentions: group.mentions + entry.mentionCount,
      hasUnread: group.hasUnread || entry.unreadCount > 0,
    });
  }
  return groups;
}

/** Pure: the inbox count, DM unread + channel mentions (one source, design §3.1). */
export function inboxUnread(entries: readonly UnreadCountDto[] | undefined): InboxUnread {
  let directMessages = 0;
  let mentions = 0;
  for (const entry of entries ?? []) {
    if (entry.directMessageGroupId) directMessages += entry.unreadCount;
    else if (entry.channelId && countsAsTextChannel(entry)) mentions += entry.mentionCount;
  }
  return { directMessages, mentions, total: directMessages + mentions };
}

export function useUnreadSummary(): UnreadSummary {
  // Built on useReadReceipts so there is exactly one reader of the query.
  const { unreadCount, mentionCount, allUnreadCounts } = useReadReceipts();
  const entries = allUnreadCounts;
  const byCommunity = useMemo(() => groupUnreadByCommunity(entries), [entries]);
  const inbox = useMemo(() => inboxUnread(entries), [entries]);
  return useMemo<UnreadSummary>(
    () => ({
      channel: (id) => ({ unread: unreadCount(id), mentions: mentionCount(id) }),
      community: (id) => byCommunity.get(id) ?? NO_COMMUNITY_UNREAD,
      inbox,
    }),
    [unreadCount, mentionCount, byCommunity, inbox],
  );
}

/**
 * One channel's counts, without the per-community grouping (what a channel
 * row needs; cheaper than useUnreadSummary per row).
 */
export function useChannelUnread(id: string | undefined): ChannelUnread {
  const { unreadCount, mentionCount } = useReadReceipts();
  return { unread: unreadCount(id), mentions: mentionCount(id) };
}

/** The unread notification count (the bell and the tab title): the key `useAppBadge` reads. */
export function useNotificationCount(): number {
  const { data } = useQuery({
    ...notificationsControllerGetUnreadCountOptions(),
    refetchOnWindowFocus: true,
  });
  return data?.count ?? 0;
}
