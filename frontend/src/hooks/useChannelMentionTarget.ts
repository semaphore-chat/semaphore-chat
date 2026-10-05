/**
 * Resolves a #channel mention (a span holding only a channel id) to the
 * channel, from the channel lists already in the query cache: the server
 * only ever returns channels the reader can see, so a channel missing from
 * every cached list is one the reader can't see (or that was deleted), and
 * renders as "#private-channel". It observes the current route's community
 * list (normally already loaded by the sidebar) and re-renders when any
 * cached list changes.
 */
import { useCallback, useSyncExternalStore } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { channelsControllerFindAllForCommunityOptions } from "../api-client/@tanstack/react-query.gen";
import type { ChannelDto } from "../api-client/types.gen";

const CHANNEL_LIST_KEY = [{ _id: "channelsControllerFindAllForCommunity" }];

/** The cached (so: visible) channel with this id, outside React. */
export function findCachedChannel(
  queryClient: QueryClient,
  channelId: string | null | undefined,
): ChannelDto | undefined {
  if (!channelId) return undefined;
  for (const [, channels] of queryClient.getQueriesData<ChannelDto[]>({
    queryKey: CHANNEL_LIST_KEY,
  })) {
    const found = channels?.find((c) => c.id === channelId);
    if (found) return found;
  }
  return undefined;
}

export function useChannelMentionTarget(
  channelId: string | null | undefined,
): ChannelDto | undefined {
  const queryClient = useQueryClient();
  const { communityId } = useParams<{ communityId?: string }>();

  // Keep the current community's list observed (and loaded), so a mention
  // still resolves on a phone where the sidebar isn't mounted.
  useQuery({
    ...channelsControllerFindAllForCommunityOptions({
      path: { communityId: communityId ?? "" },
    }),
    enabled: !!communityId && !!channelId,
  });

  const subscribe = useCallback(
    (onChange: () => void) => queryClient.getQueryCache().subscribe(onChange),
    [queryClient],
  );

  const getSnapshot = useCallback(
    () => findCachedChannel(queryClient, channelId),
    [queryClient, channelId],
  );

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
