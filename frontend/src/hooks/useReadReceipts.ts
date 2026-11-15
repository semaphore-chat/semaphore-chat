import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { readReceiptsControllerGetUnreadCountsOptions } from "../api-client/@tanstack/react-query.gen";
import type { UnreadCountDto } from "../api-client";

export function useReadReceipts() {
  const { data: unreadCounts } = useQuery({
    ...readReceiptsControllerGetUnreadCountsOptions(),
    refetchOnWindowFocus: true,
  });

  const byId = useMemo(() => {
    const map = new Map<string, UnreadCountDto>();
    if (!unreadCounts) return map;
    for (const count of unreadCounts) {
      const id = count.channelId || count.directMessageGroupId;
      if (id) map.set(id, count);
    }
    return map;
  }, [unreadCounts]);

  // Stable while the counts are unchanged, so readers can memoize on them.
  const unreadCount = useCallback((id?: string): number => {
    if (!id) return 0;
    return byId.get(id)?.unreadCount ?? 0;
  }, [byId]);

  const mentionCount = useCallback((id?: string): number => {
    if (!id) return 0;
    return byId.get(id)?.mentionCount ?? 0;
  }, [byId]);

  const lastReadMessageId = useCallback((id?: string): string | undefined => {
    if (!id) return undefined;
    return byId.get(id)?.lastReadMessageId ?? undefined;
  }, [byId]);

  const hasUnread = useCallback((id?: string): boolean => {
    if (!id) return false;
    return (byId.get(id)?.unreadCount ?? 0) > 0;
  }, [byId]);

  const totalDmUnreadCount = useMemo(() => {
    if (!unreadCounts) return 0;
    return unreadCounts
      .filter((c) => c.directMessageGroupId)
      .reduce((sum, c) => sum + c.unreadCount, 0);
  }, [unreadCounts]);

  return { unreadCount, mentionCount, lastReadMessageId, hasUnread, allUnreadCounts: unreadCounts, totalDmUnreadCount };
}
