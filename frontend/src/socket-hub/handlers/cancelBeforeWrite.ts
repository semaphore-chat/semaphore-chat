import type { QueryClient, QueryKey } from '@tanstack/react-query';

/**
 * Before a socket event writes into a cached list: cancel an in-flight fetch, so its answer (read before the event)
 * cannot overwrite the write.
 *
 * Not while nothing is cached yet. Cancelling a first load reverts the query to "pending" with no fetch running, and
 * nothing starts it again (message lists never go stale), so the chat showed "No messages yet." for good and later
 * events had no list to land in. Every write here leaves a missing list alone, so restart that load instead: its
 * answer then includes the event.
 */
export async function cancelBeforeWrite(queryClient: QueryClient, queryKey: QueryKey): Promise<void> {
  if (queryClient.getQueryData(queryKey) === undefined) {
    void queryClient.resetQueries({ queryKey, exact: true });
    return;
  }
  await queryClient.cancelQueries({ queryKey });
}
