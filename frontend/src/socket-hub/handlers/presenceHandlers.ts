import type { QueryClient, QueryKey } from '@tanstack/react-query';
import type { UserPresenceInfo, UserProfileUpdatedPayload, ServerEvents } from '@semaphore-chat/shared';
import type { UserControllerGetProfileResponse } from '../../api-client';
import {
  presenceControllerGetUserPresenceQueryKey,
  presenceControllerGetBulkPresenceQueryKey,
  userControllerGetUserByIdQueryKey,
  userControllerGetProfileQueryKey,
} from '../../api-client/@tanstack/react-query.gen';
import type { SocketEventHandler } from './types';

/**
 * Extract the comma-joined `userIds` path param that
 * `presenceControllerGetMultipleUserPresenceQueryKey` embeds in the query key
 * (`[{ _id, baseUrl, path: { userIds: 'a,b,c' } }]`). Returns null when the
 * key doesn't have the expected shape, so callers can fall back to
 * invalidating instead of guessing.
 */
function parseMultiPresenceUserIds(queryKey: QueryKey): string[] | null {
  const keyPart = queryKey[0];
  if (typeof keyPart !== 'object' || keyPart === null) return null;

  const path = (keyPart as { path?: unknown }).path;
  if (typeof path !== 'object' || path === null) return null;

  const userIds = (path as { userIds?: unknown }).userIds;
  if (typeof userIds !== 'string' || userIds.length === 0) return null;

  return userIds.split(',').filter(Boolean);
}

/**
 * Patch every cached `presenceControllerGetMultipleUserPresence` query whose
 * parsed userIds include `userId`, in place — no refetch, no re-render of
 * unrelated queries. Queries whose key can't be parsed confidently fall back
 * to a targeted invalidation of just that query (safety net).
 */
function patchMultiPresenceCaches(queryClient: QueryClient, userId: string, isOnline: boolean): void {
  const queries = queryClient.getQueryCache().findAll({
    queryKey: [{ _id: 'presenceControllerGetMultipleUserPresence' }],
  });

  for (const query of queries) {
    const userIds = parseMultiPresenceUserIds(query.queryKey);

    if (userIds === null) {
      void queryClient.invalidateQueries({ queryKey: query.queryKey, exact: true });
      continue;
    }

    if (!userIds.includes(userId)) continue;

    queryClient.setQueryData(
      query.queryKey,
      (old: { presence: Record<string, boolean> } | undefined) => {
        if (!old) return old;
        return { ...old, presence: { ...old.presence, [userId]: isOnline } };
      },
    );
  }
}

const COMMUNITY_PRESENCE_QUERY_KEY = [{ _id: 'presenceControllerGetCommunityPresence' }];

/**
 * Presence events arrive many times per second on a busy instance, and every
 * one of them would refetch the community presence query (TanStack only
 * dedupes requests that overlap in time). Coalesce them into at most one
 * invalidation per window: the first event after an idle window invalidates
 * immediately, and every event during the window is served by one trailing
 * invalidation when the window ends.
 */
const COMMUNITY_PRESENCE_THROTTLE_MS = 5_000;

/** Start of the current window (the last invalidation), if a window is open. */
let lastCommunityPresenceAt: number | null = null;
let trailingCommunityPresenceTimer: number | null = null;
let trailingCommunityPresenceClient: QueryClient | null = null;

/** Forget the window and drop a pending trailing invalidation. Tests only. */
export function resetCommunityPresenceThrottle(): void {
  if (trailingCommunityPresenceTimer !== null) window.clearTimeout(trailingCommunityPresenceTimer);
  trailingCommunityPresenceTimer = null;
  trailingCommunityPresenceClient = null;
  lastCommunityPresenceAt = null;
}

/**
 * A community's online ids and count are the server's answer for the whole
 * community. Whether this event's user is a member of a cached community is
 * not knowable from the cache (the member pages hold only the loaded ones),
 * so refetch the (at most a couple) cached community presence queries instead
 * of guessing at the patch. No cached query, no request and no timer.
 */
function invalidateCommunityPresence(queryClient: QueryClient): void {
  if (queryClient.getQueryCache().findAll({ queryKey: COMMUNITY_PRESENCE_QUERY_KEY }).length === 0) {
    return;
  }

  const elapsed =
    lastCommunityPresenceAt === null ? Infinity : Date.now() - lastCommunityPresenceAt;

  if (elapsed >= COMMUNITY_PRESENCE_THROTTLE_MS) {
    lastCommunityPresenceAt = Date.now();
    void queryClient.invalidateQueries({ queryKey: COMMUNITY_PRESENCE_QUERY_KEY });
    return;
  }

  // Inside the window: serve all of its events with one trailing invalidation.
  if (trailingCommunityPresenceTimer !== null) return;

  trailingCommunityPresenceClient = queryClient;
  trailingCommunityPresenceTimer = window.setTimeout(() => {
    trailingCommunityPresenceTimer = null;
    const client = trailingCommunityPresenceClient;
    trailingCommunityPresenceClient = null;
    lastCommunityPresenceAt = Date.now();
    // The panel may have closed during the window: nothing cached, nothing to fetch.
    if (!client || client.getQueryCache().findAll({ queryKey: COMMUNITY_PRESENCE_QUERY_KEY }).length === 0) {
      return;
    }
    void client.invalidateQueries({ queryKey: COMMUNITY_PRESENCE_QUERY_KEY });
  }, COMMUNITY_PRESENCE_THROTTLE_MS - elapsed);
}

export const handleUserOnline: SocketEventHandler<typeof ServerEvents.USER_ONLINE> = (
  data: UserPresenceInfo,
  queryClient: QueryClient,
) => {
  queryClient.setQueryData(
    presenceControllerGetUserPresenceQueryKey({ path: { userId: data.userId } }),
    (old: { isOnline: boolean } | undefined) => (old ? { ...old, isOnline: true } : old),
  );

  queryClient.setQueryData(
    presenceControllerGetBulkPresenceQueryKey(),
    (old: { presence: Record<string, boolean> } | undefined) => {
      if (!old) return old;
      return { ...old, presence: { ...old.presence, [data.userId]: true } };
    },
  );

  patchMultiPresenceCaches(queryClient, data.userId, true);
  invalidateCommunityPresence(queryClient);
};

export const handleUserOffline: SocketEventHandler<typeof ServerEvents.USER_OFFLINE> = (
  data: UserPresenceInfo,
  queryClient: QueryClient,
) => {
  queryClient.setQueryData(
    presenceControllerGetUserPresenceQueryKey({ path: { userId: data.userId } }),
    (old: { isOnline: boolean } | undefined) => (old ? { ...old, isOnline: false } : old),
  );

  queryClient.setQueryData(
    presenceControllerGetBulkPresenceQueryKey(),
    (old: { presence: Record<string, boolean> } | undefined) => {
      if (!old) return old;
      return { ...old, presence: { ...old.presence, [data.userId]: false } };
    },
  );

  patchMultiPresenceCaches(queryClient, data.userId, false);
  invalidateCommunityPresence(queryClient);
};

// =============================================================================
// User Profile Update
// =============================================================================

export const handleUserProfileUpdated: SocketEventHandler<typeof ServerEvents.USER_PROFILE_UPDATED> = (
  payload: UserProfileUpdatedPayload,
  queryClient: QueryClient,
) => {
  // Only invalidate the current user's own profile query if they are the one who updated
  const currentUser = queryClient.getQueryData<UserControllerGetProfileResponse>(
    userControllerGetProfileQueryKey(),
  );
  if (currentUser && payload.userId === currentUser.id) {
    queryClient.invalidateQueries({ queryKey: [{ _id: 'userControllerGetProfile' }] });
  }

  // Invalidate the useUser() cache for this user so all UserAvatar
  // instances and other components showing this user's data refresh
  queryClient.invalidateQueries({
    queryKey: userControllerGetUserByIdQueryKey({ path: { id: payload.userId } }),
  });
};
