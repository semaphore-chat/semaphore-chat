/**
 * Message search query shared by the desktop `MessageSearch` popover and the
 * phone `MobileSearchScreen`: searches this channel or the whole community.
 */
import { useQuery } from "@tanstack/react-query";
import {
  messagesControllerSearchChannelMessagesOptions,
  messagesControllerSearchCommunityMessagesOptions,
} from "../api-client/@tanstack/react-query.gen";
import { Message } from "../types/message.type";

export enum SearchScope {
  Channel = "channel",
  Community = "community",
}

export interface SearchResult extends Message {
  channelName?: string;
}

const SEARCH_LIMIT = 20;

interface UseMessageSearchArgs {
  channelId: string;
  communityId: string;
  /** Already-debounced query text. */
  query: string;
  scope: SearchScope;
}

export function useMessageSearch({ channelId, communityId, query, scope }: UseMessageSearchArgs) {
  const q = query.trim();
  const hasQuery = q.length > 0;

  const channelSearch = useQuery({
    ...messagesControllerSearchChannelMessagesOptions({
      path: { channelId },
      query: { q, limit: SEARCH_LIMIT },
    }),
    enabled: hasQuery && scope === SearchScope.Channel && !!channelId,
  });
  const communitySearch = useQuery({
    ...messagesControllerSearchCommunityMessagesOptions({
      path: { communityId },
      query: { q, limit: SEARCH_LIMIT },
    }),
    enabled: hasQuery && scope === SearchScope.Community && !!communityId,
  });

  const active = scope === SearchScope.Channel ? channelSearch : communitySearch;
  const results = (hasQuery ? active.data ?? [] : []) as SearchResult[];

  return {
    results,
    isLoading: hasQuery && active.isLoading,
    isError: hasQuery && active.isError,
    refetch: active.refetch,
  };
}
