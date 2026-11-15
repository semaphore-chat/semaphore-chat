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

/**
 * An unread entry as this layer reads it. `communityId` is being added to
 * `UnreadCountDto` by the backend (design F3); until that lands in the
 * generated client it is optional here, and entries without it group under
 * the `null` community.
 * TODO(unread-by-community): drop this type for `UnreadCountDto` once the
 * generated client has `communityId`.
 */
export type UnreadEntry = UnreadCountDto & { communityId?: string | null };

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
  /** `null`: channel entries the server did not tag with a community. */
  community(id: string | null): CommunityUnread;
  inbox: InboxUnread;
}

const NO_COMMUNITY_UNREAD: CommunityUnread = { mentions: 0, hasUnread: false };

/** Pure: channel entries grouped by community (DM entries are left out). */
export function groupUnreadByCommunity(
  entries: readonly UnreadEntry[] | undefined,
): Map<string | null, CommunityUnread> {
  const groups = new Map<string | null, CommunityUnread>();
  for (const entry of entries ?? []) {
    if (!entry.channelId) continue;
    const key = entry.communityId ?? null;
    const group = groups.get(key) ?? { mentions: 0, hasUnread: false };
    groups.set(key, {
      mentions: group.mentions + entry.mentionCount,
      hasUnread: group.hasUnread || entry.unreadCount > 0,
    });
  }
  return groups;
}

/** Pure: the inbox count, DM unread + channel mentions (one source, design §3.1). */
export function inboxUnread(entries: readonly UnreadEntry[] | undefined): InboxUnread {
  let directMessages = 0;
  let mentions = 0;
  for (const entry of entries ?? []) {
    if (entry.directMessageGroupId) directMessages += entry.unreadCount;
    else if (entry.channelId) mentions += entry.mentionCount;
  }
  return { directMessages, mentions, total: directMessages + mentions };
}

export function useUnreadSummary(): UnreadSummary {
  // Built on useReadReceipts so there is exactly one reader of the query.
  const { unreadCount, mentionCount, allUnreadCounts } = useReadReceipts();
  const entries = allUnreadCounts as readonly UnreadEntry[] | undefined;
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

/** The unread notification count (the bell and the tab title): the key `useAppBadge` reads. */
export function useNotificationCount(): number {
  const { data } = useQuery({
    ...notificationsControllerGetUnreadCountOptions(),
    refetchOnWindowFocus: true,
  });
  return data?.count ?? 0;
}
