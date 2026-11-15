/**
 * A community's channels as both shells list them: text and voice, each in
 * the server's position order. Only the server-filtered list
 * (`channelsControllerFindAllForCommunity`: private channels you cannot see
 * never arrive), kept live by the community socket handlers.
 *
 * Headless: no UI imports (see the `src/data` lint block in eslint.config.js).
 */
import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { channelsControllerFindAllForCommunityOptions } from '../api-client/@tanstack/react-query.gen';
import { ChannelType, type Channel } from '../types/channel.type';

export type QueryStatus = 'pending' | 'error' | 'success';

export interface SortedChannels {
  text: Channel[];
  voice: Channel[];
}

const byPosition = (a: Channel, b: Channel) => (a.position ?? 0) - (b.position ?? 0);

/** Pure: split by type, each sorted by `position` (stable for ties: server order). */
export function sortCommunityChannels(channels: readonly Channel[] | undefined): SortedChannels {
  if (!channels) return { text: [], voice: [] };
  return {
    text: channels.filter((c) => c.type === ChannelType.TEXT).sort(byPosition),
    voice: channels.filter((c) => c.type === ChannelType.VOICE).sort(byPosition),
  };
}

export interface CommunityChannels extends SortedChannels {
  /** Every channel the server returned, unsorted (undefined until loaded). */
  all: Channel[] | undefined;
  status: QueryStatus;
  isLoading: boolean;
  error: unknown;
  refetch(): void;
}

export function useCommunityChannels(communityId: string): CommunityChannels {
  const { data, status, isLoading, error, refetch } = useQuery(
    channelsControllerFindAllForCommunityOptions({ path: { communityId } }),
  );
  const sorted = useMemo(() => sortCommunityChannels(data), [data]);
  const refetchChannels = useCallback(() => void refetch(), [refetch]);
  return {
    ...sorted,
    all: data,
    status,
    isLoading,
    error,
    refetch: refetchChannels,
  };
}
