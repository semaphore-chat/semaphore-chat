import { useCallback, useMemo } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  messagesControllerFindAroundForChannel,
  messagesControllerFindAroundForGroup,
  messagesControllerFindAllForChannel,
  messagesControllerFindAllForGroup,
} from "../api-client/sdk.gen";
import {
  channelAnchoredMessagesQueryKey,
  dmAnchoredMessagesQueryKey,
  MESSAGE_STALE_TIME,
  MESSAGE_MAX_PAGES,
} from "../utils/messageQueryKeys";
import type { Message } from "../types/message.type";

type PageParam =
  | { type: "around"; messageId: string }
  | { type: "older"; token: string }
  | { type: "newer"; token: string };

interface AnchoredPage {
  messages: unknown[];
  olderContinuationToken?: string;
  newerContinuationToken?: string;
}

export const useAnchoredMessages = (
  type: "channel" | "dm",
  id: string | undefined,
  anchorMessageId: string | undefined,
) => {
  const queryKey =
    type === "channel"
      ? channelAnchoredMessagesQueryKey(id || "", anchorMessageId || "")
      : dmAnchoredMessagesQueryKey(id || "", anchorMessageId || "");

  const {
    data,
    error,
    isLoading,
    fetchNextPage,
    fetchPreviousPage,
    hasNextPage,
    hasPreviousPage,
    isFetchingNextPage,
    isFetchingPreviousPage,
  } = useInfiniteQuery({
    queryKey,
    queryFn: async ({ pageParam, signal }): Promise<AnchoredPage> => {
      const p = pageParam as PageParam;

      if (p.type === "around") {
        if (type === "channel") {
          const { data } = await messagesControllerFindAroundForChannel({
            path: { channelId: id!, messageId: p.messageId },
            query: { limit: 50 },
            throwOnError: true,
            signal,
          });
          return data;
        } else {
          const { data } = await messagesControllerFindAroundForGroup({
            path: { groupId: id!, messageId: p.messageId },
            query: { limit: 50 },
            throwOnError: true,
            signal,
          });
          return data;
        }
      }

      // Older or newer pages use the regular pagination endpoint with direction
      const direction = p.type;
      const token = p.token;

      if (type === "channel") {
        const { data } = await messagesControllerFindAllForChannel({
          path: { channelId: id! },
          query: { limit: 25, continuationToken: token, direction },
          throwOnError: true,
          signal,
        });
        // Normalize to anchored page shape
        return {
          messages: data.messages,
          olderContinuationToken:
            direction === "older" ? data.continuationToken : undefined,
          newerContinuationToken:
            direction === "newer" ? data.continuationToken : undefined,
        };
      } else {
        const { data } = await messagesControllerFindAllForGroup({
          path: { groupId: id! },
          query: { limit: 25, continuationToken: token, direction },
          throwOnError: true,
          signal,
        });
        return {
          messages: data.messages,
          olderContinuationToken:
            direction === "older" ? data.continuationToken : undefined,
          newerContinuationToken:
            direction === "newer" ? data.continuationToken : undefined,
        };
      }
    },
    initialPageParam: {
      type: "around",
      messageId: anchorMessageId || "",
    } as PageParam,
    // "Next" = older (scroll up), matches existing useMessages convention
    getNextPageParam: (lastPage): PageParam | undefined => {
      if (lastPage.olderContinuationToken) {
        return { type: "older", token: lastPage.olderContinuationToken };
      }
      return undefined;
    },
    // "Previous" = newer (scroll down toward present)
    getPreviousPageParam: (firstPage): PageParam | undefined => {
      if (firstPage.newerContinuationToken) {
        return { type: "newer", token: firstPage.newerContinuationToken };
      }
      return undefined;
    },
    staleTime: MESSAGE_STALE_TIME,
    maxPages: MESSAGE_MAX_PAGES,
    enabled: !!id && !!anchorMessageId,
  });

  const messages: Message[] = useMemo(
    () =>
      (data?.pages.flatMap((page) => page.messages) as unknown as Message[]) ??
      [],
    [data],
  );

  // Older = fetchNextPage (scroll up, same as normal mode)
  const handleLoadMore = useCallback(async () => {
    if (!isFetchingNextPage && hasNextPage) {
      await fetchNextPage();
    }
  }, [isFetchingNextPage, hasNextPage, fetchNextPage]);

  // Newer = fetchPreviousPage (scroll down toward present)
  const handleLoadNewer = useCallback(async () => {
    if (!isFetchingPreviousPage && hasPreviousPage) {
      await fetchPreviousPage();
    }
  }, [isFetchingPreviousPage, hasPreviousPage, fetchPreviousPage]);

  const continuationToken =
    data?.pages[data.pages.length - 1]?.olderContinuationToken;

  return {
    messages,
    isLoading,
    error,
    continuationToken,
    isLoadingMore: isFetchingNextPage,
    onLoadMore: handleLoadMore,
    onLoadNewer: handleLoadNewer,
    isLoadingNewer: isFetchingPreviousPage,
    hasNewer: hasPreviousPage,
  };
};
