import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import {
  handleUserOnline,
  handleUserOffline,
  resetCommunityPresenceThrottle,
} from '../../../socket-hub/handlers/presenceHandlers';
import {
  presenceControllerGetUserPresenceQueryKey,
  presenceControllerGetBulkPresenceQueryKey,
  presenceControllerGetMultipleUserPresenceQueryKey,
  presenceControllerGetCommunityPresenceQueryKey,
} from '../../../api-client/@tanstack/react-query.gen';

describe('presenceHandlers', () => {
  beforeEach(() => {
    resetCommunityPresenceThrottle();
  });

  describe('handleUserOnline', () => {
    it('sets isOnline to true in single-user cache', () => {
      const queryClient = new QueryClient();
      const key = presenceControllerGetUserPresenceQueryKey({ path: { userId: 'u1' } });
      queryClient.setQueryData(key, { isOnline: false });

      handleUserOnline({ userId: 'u1' }, queryClient);

      expect(queryClient.getQueryData(key)).toEqual({ isOnline: true });
    });

    it('updates bulk presence cache', () => {
      const queryClient = new QueryClient();
      const key = presenceControllerGetBulkPresenceQueryKey();
      queryClient.setQueryData(key, { presence: { u1: false, u2: true } });

      handleUserOnline({ userId: 'u1' }, queryClient);

      const data = queryClient.getQueryData<{ presence: Record<string, boolean> }>(key);
      expect(data!.presence.u1).toBe(true);
      expect(data!.presence.u2).toBe(true);
    });

    it('patches cached multi-presence queries in place without invalidating', () => {
      const queryClient = new QueryClient();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const key = presenceControllerGetMultipleUserPresenceQueryKey({ path: { userIds: 'u1,u2' } });
      queryClient.setQueryData(key, { presence: { u1: false, u2: true } });

      handleUserOnline({ userId: 'u1' }, queryClient);

      expect(queryClient.getQueryData(key)).toEqual({ presence: { u1: true, u2: true } });
      // The multi-presence query itself is patched, never refetched (the
      // community presence cache it also invalidates is a different query).
      expect(invalidateSpy).not.toHaveBeenCalledWith(expect.objectContaining({ queryKey: key }));
    });

    it('leaves multi-presence queries that do not include the user untouched', () => {
      const queryClient = new QueryClient();
      const key = presenceControllerGetMultipleUserPresenceQueryKey({ path: { userIds: 'u3,u4' } });
      const original = { presence: { u3: false, u4: false } };
      queryClient.setQueryData(key, original);

      handleUserOnline({ userId: 'u1' }, queryClient);

      expect(queryClient.getQueryData(key)).toEqual(original);
    });

    it('falls back to invalidating a multi-presence query whose key cannot be parsed', () => {
      const queryClient = new QueryClient();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      // Simulate a cached query whose key doesn't carry a parseable `path.userIds`
      // (e.g. a future/alternate query shape) — the handler must not silently
      // skip it, it must fall back to invalidating just that query.
      const unparseableKey = [{ _id: 'presenceControllerGetMultipleUserPresence', baseUrl: 'http://x' }] as const;
      queryClient.setQueryData(unparseableKey, { presence: { u1: false } });

      handleUserOnline({ userId: 'u1' }, queryClient);

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: unparseableKey, exact: true });
    });

    it('invalidates the community presence caches (membership is not knowable from the cache)', () => {
      const queryClient = new QueryClient();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const key = presenceControllerGetCommunityPresenceQueryKey({ path: { communityId: 'c-1' } });
      queryClient.setQueryData(key, { onlineUserIds: ['u2'], onlineCount: 1, memberCount: 2 });

      handleUserOnline({ userId: 'u1' }, queryClient);

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: [{ _id: 'presenceControllerGetCommunityPresence' }],
      });
      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
    });
  });

  describe('handleUserOffline', () => {
    it('sets isOnline to false in single-user cache', () => {
      const queryClient = new QueryClient();
      const key = presenceControllerGetUserPresenceQueryKey({ path: { userId: 'u1' } });
      queryClient.setQueryData(key, { isOnline: true });

      handleUserOffline({ userId: 'u1' }, queryClient);

      expect(queryClient.getQueryData(key)).toEqual({ isOnline: false });
    });

    it('patches cached multi-presence queries in place without invalidating', () => {
      const queryClient = new QueryClient();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const key = presenceControllerGetMultipleUserPresenceQueryKey({ path: { userIds: 'u1,u2' } });
      queryClient.setQueryData(key, { presence: { u1: true, u2: true } });

      handleUserOffline({ userId: 'u1' }, queryClient);

      expect(queryClient.getQueryData(key)).toEqual({ presence: { u1: false, u2: true } });
      expect(invalidateSpy).not.toHaveBeenCalledWith(expect.objectContaining({ queryKey: key }));
    });

    it('falls back to invalidating a multi-presence query whose key cannot be parsed', () => {
      const queryClient = new QueryClient();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const unparseableKey = [{ _id: 'presenceControllerGetMultipleUserPresence', baseUrl: 'http://x' }] as const;
      queryClient.setQueryData(unparseableKey, { presence: { u1: true } });

      handleUserOffline({ userId: 'u1' }, queryClient);

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: unparseableKey, exact: true });
    });
  });

  describe('community presence invalidation throttle', () => {
    /** A spy on `invalidateQueries` narrowed to the community presence calls. */
    interface InvalidateSpy {
      mock: { calls: unknown[][] };
    }

    function communityInvalidations(spy: InvalidateSpy): number {
      return spy.mock.calls.filter(([filters]) => {
        const key = (filters as { queryKey?: readonly { _id?: string }[] } | undefined)?.queryKey;
        return key?.[0]?._id === 'presenceControllerGetCommunityPresence';
      }).length;
    }

    function cacheCommunityPresence(queryClient: QueryClient): void {
      queryClient.setQueryData(
        presenceControllerGetCommunityPresenceQueryKey({ path: { communityId: 'c-1' } }),
        { onlineUserIds: [], onlineCount: 0, memberCount: 1 },
      );
    }

    /** No gc timers, so `vi.getTimerCount()` only sees the throttle's own timer. */
    function newQueryClient(): QueryClient {
      return new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
    }

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      resetCommunityPresenceThrottle();
      vi.useRealTimers();
    });

    it('coalesces a one-second burst into one leading and one trailing invalidation', () => {
      const queryClient = newQueryClient();
      cacheCommunityPresence(queryClient);
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      // 50 events in one second: alternating online/offline, as a busy instance sends them.
      for (let i = 0; i < 50; i++) {
        if (i % 2 === 0) handleUserOnline({ userId: `u${i}` }, queryClient);
        else handleUserOffline({ userId: `u${i}` }, queryClient);
        vi.advanceTimersByTime(20);
      }
      // Leading: the first event of an idle window invalidates straight away.
      expect(communityInvalidations(invalidateSpy)).toBe(1);

      // Trailing: once, when the 5 s window that started with the leading call ends.
      vi.advanceTimersByTime(4_000);
      expect(communityInvalidations(invalidateSpy)).toBe(2);

      // No third call, and the timer is gone.
      vi.advanceTimersByTime(10_000);
      expect(communityInvalidations(invalidateSpy)).toBe(2);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('invalidates every event that is more than a window apart', () => {
      const queryClient = newQueryClient();
      cacheCommunityPresence(queryClient);
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      handleUserOnline({ userId: 'u1' }, queryClient);
      vi.advanceTimersByTime(5_001);
      handleUserOnline({ userId: 'u2' }, queryClient);
      vi.advanceTimersByTime(5_001);
      handleUserOffline({ userId: 'u3' }, queryClient);

      expect(communityInvalidations(invalidateSpy)).toBe(3);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('does nothing and leaves no timer when no community presence query is cached', () => {
      const queryClient = newQueryClient();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      // The other presence caches exist, the community one does not.
      handleUserOnline({ userId: 'u1' }, queryClient);
      handleUserOnline({ userId: 'u2' }, queryClient);

      expect(invalidateSpy).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
