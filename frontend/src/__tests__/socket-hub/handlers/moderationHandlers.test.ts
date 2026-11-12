import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import {
  handleUserBanned,
  handleUserUnbanned,
  handleUserKicked,
  handleUserTimedOut,
  handleTimeoutRemoved,
} from '../../../socket-hub/handlers/moderationHandlers';

describe('moderationHandlers', () => {
  let queryClient: QueryClient;
  let invalidateSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    queryClient = new QueryClient();
    invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  });

  describe('handleUserBanned', () => {
    it('invalidates the members list', () => {
      handleUserBanned({} as never, queryClient);

      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          queryKey: [{ _id: 'membershipControllerFindAllForCommunity' }],
        }),
      );
    });

    it('invalidates the communities list', () => {
      handleUserBanned({} as never, queryClient);

      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          queryKey: [{ _id: 'communityControllerFindAllMine' }],
        }),
      );
    });

    it('invalidates exactly 2 query types', () => {
      handleUserBanned({} as never, queryClient);
      expect(invalidateSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('handleUserUnbanned', () => {
    it('invalidates the ban list and the moderation log', () => {
      handleUserUnbanned(
        { communityId: 'c1', userId: 'u1', moderatorId: 'm1' },
        queryClient,
      );

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: [{ _id: 'moderationControllerGetBanList' }],
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: [{ _id: 'moderationControllerGetModerationLogs' }],
      });
    });

    it('invalidates exactly those 2 queries', () => {
      handleUserUnbanned(
        { communityId: 'c1', userId: 'u1', moderatorId: 'm1' },
        queryClient,
      );
      expect(invalidateSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('handleUserKicked', () => {
    it('invalidates the members list', () => {
      handleUserKicked({} as never, queryClient);

      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          queryKey: [{ _id: 'membershipControllerFindAllForCommunity' }],
        }),
      );
    });

    it('invalidates the communities list', () => {
      handleUserKicked({} as never, queryClient);

      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          queryKey: [{ _id: 'communityControllerFindAllMine' }],
        }),
      );
    });

    it('invalidates exactly 2 query types', () => {
      handleUserKicked({} as never, queryClient);
      expect(invalidateSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('handleUserTimedOut', () => {
    it('invalidates the members list', () => {
      handleUserTimedOut({} as never, queryClient);

      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          queryKey: [{ _id: 'membershipControllerFindAllForCommunity' }],
        }),
      );
    });

    it('invalidates the timeout status so the composer shows the timeout', () => {
      handleUserTimedOut({} as never, queryClient);
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          queryKey: [{ _id: 'moderationControllerGetTimeoutStatus' }],
        }),
      );
    });

    it('does NOT invalidate communities (timeout is not removal)', () => {
      handleUserTimedOut({} as never, queryClient);
      // members + timeout status + the 4 channel-permission queries
      expect(invalidateSpy).toHaveBeenCalledTimes(6);
      expect(invalidateSpy).not.toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: [{ _id: 'communityControllerFindAllMine' }] }),
      );
    });
  });

  describe('handleTimeoutRemoved', () => {
    it('invalidates the members list', () => {
      handleTimeoutRemoved({} as never, queryClient);

      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          queryKey: [{ _id: 'membershipControllerFindAllForCommunity' }],
        }),
      );
    });

    it('invalidates the timeout status so the composer comes back', () => {
      handleTimeoutRemoved({} as never, queryClient);
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          queryKey: [{ _id: 'moderationControllerGetTimeoutStatus' }],
        }),
      );
    });

    it('invalidates the timeout list so moderators see it is gone', () => {
      handleTimeoutRemoved({} as never, queryClient);
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          queryKey: [{ _id: 'moderationControllerGetTimeoutList' }],
        }),
      );
    });

    it('does the same when the timeout ran out on its own', () => {
      handleTimeoutRemoved(
        {
          communityId: 'c1',
          userId: 'u1',
          moderatorId: 'm1',
          expired: true,
        },
        queryClient,
      );

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: [{ _id: 'moderationControllerGetTimeoutStatus' }],
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: [{ _id: 'moderationControllerGetTimeoutList' }],
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: [{ _id: 'channelPermissionsControllerGetMyChannelPermissions' }],
      });
    });

    it('does NOT invalidate communities', () => {
      handleTimeoutRemoved({} as never, queryClient);
      expect(invalidateSpy).toHaveBeenCalledTimes(7);
      expect(invalidateSpy).not.toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: [{ _id: 'communityControllerFindAllMine' }] }),
      );
    });
  });

  describe('timeouts refresh the effective channel permissions', () => {
    it.each([
      ['handleUserTimedOut', handleUserTimedOut],
      ['handleTimeoutRemoved', handleTimeoutRemoved],
    ])('%s invalidates the channel-permission queries (composer, voice controls)', (_name, handler) => {
      handler({} as never, queryClient);
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: [{ _id: 'channelPermissionsControllerGetMyCommunityChannelPermissions' }],
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: [{ _id: 'channelPermissionsControllerGetMyChannelPermissions' }],
      });
    });
  });
});
