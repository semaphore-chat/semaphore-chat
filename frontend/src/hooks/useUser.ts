/**
 * Hooks for resolving user display info by ID.
 *
 * Uses TanStack Query to cache individual user lookups via the
 * GET /api/users/:id endpoint. Queries are deduped and cached
 * automatically — multiple components requesting the same userId
 * share a single request.
 *
 * Future improvement: seed the query cache from bulk fetches
 * (community membership, DM group members) using
 * queryClient.setQueryData() so that useUser/useUsers get
 * instant cache hits for already-loaded users without extra
 * API calls. 
 */

import { useQuery, useQueries } from "@tanstack/react-query";
import { userControllerGetUserByIdOptions } from "../api-client/@tanstack/react-query.gen";

const USER_STALE_TIME = 5 * 60 * 1000; // 5 minutes

/* 
TODO: update instances where we are fetching users to use these hooks.
and remove any custom user caching logic in those components 
(e.g. MessageContainer's author cache, TypingIndicator's user cache) 
*/
/**
 * Resolve a single user by ID. Returns the cached user if available,
 * otherwise fetches from the API.
 */
export function useUser(userId: string | undefined) {
  return useQuery({
    ...userControllerGetUserByIdOptions({ path: { id: userId! } }),
    enabled: !!userId,
    staleTime: USER_STALE_TIME,
  });
}

/**
 * Resolve multiple users by ID in parallel. Each userId gets its own
 * cached query entry, so subsequent lookups for the same user are free.
 *
 * Useful when you have a dynamic array of userIds (e.g. typing indicators,
 * reaction tooltips) where you can't call useUser() in a loop.
 */
export function useUsers(userIds: string[]) {
  return useQueries({
    queries: userIds.map((id) => ({
      ...userControllerGetUserByIdOptions({ path: { id } }),
      staleTime: USER_STALE_TIME,
    })),
  });
}
