import { useInfiniteQuery } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { gifsControllerFeatured, gifsControllerSearch } from '../../api-client/sdk.gen';
import type { GifResultDto } from '../../api-client/types.gen';
import { useDebounce } from '../../hooks/useDebounce';

export const GIF_PAGE_LIMIT = 20;
export const GIF_SEARCH_DEBOUNCE_MS = 300;

export interface GifSearch {
  gifs: GifResultDto[];
  isLoading: boolean;
  isError: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
  refetch: () => void;
  /** The trimmed query the results are for (300 ms behind the input). */
  debouncedQuery: string;
}

/**
 * Infinite GIF results for `query`: Tenor's featured GIFs when it is blank,
 * search results otherwise (debounced 300 ms, pages of 20, paged by `next`).
 */
export function useGifSearch(query: string, options?: { enabled?: boolean }): GifSearch {
  const debouncedQuery = useDebounce(query.trim(), GIF_SEARCH_DEBOUNCE_MS);

  const { data, isLoading, isError, isFetchingNextPage, hasNextPage, fetchNextPage, refetch } =
    useInfiniteQuery({
      queryKey: debouncedQuery
        ? (['gifs', 'search', debouncedQuery] as const)
        : (['gifs', 'featured'] as const),
      queryFn: async ({ pageParam, signal }) => {
        if (debouncedQuery) {
          const { data } = await gifsControllerSearch({
            query: { q: debouncedQuery, limit: GIF_PAGE_LIMIT, pos: pageParam || undefined },
            throwOnError: true,
            signal,
          });
          return data;
        }
        const { data } = await gifsControllerFeatured({
          query: { limit: GIF_PAGE_LIMIT, pos: pageParam || undefined },
          throwOnError: true,
          signal,
        });
        return data;
      },
      initialPageParam: '',
      getNextPageParam: (lastPage) => lastPage.next || undefined,
      enabled: options?.enabled ?? true,
    });

  const gifs = useMemo(() => data?.pages.flatMap((page) => page.results) ?? [], [data]);
  const next = useCallback(() => void fetchNextPage(), [fetchNextPage]);
  const again = useCallback(() => void refetch(), [refetch]);

  return {
    gifs,
    isLoading,
    isError,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage: next,
    refetch: again,
    debouncedQuery,
  };
}
