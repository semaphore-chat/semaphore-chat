import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import {
  handleUserBanned,
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
          queryKey: [{ _id: 'membershipControllerGetMembers' }],
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

  describe('handleUserKicked', () => {
    it('invalidates the members list', () => {
      handleUserKicked({} as never, queryClient);

      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          queryKey: [{ _id: 'membershipControllerGetMembers' }],
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
          queryKey: [{ _id: 'membershipControllerGetMembers' }],
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
      expect(invalidateSpy).toHaveBeenCalledTimes(2);
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
          queryKey: [{ _id: 'membershipControllerGetMembers' }],
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

    it('does NOT invalidate communities', () => {
      handleTimeoutRemoved({} as never, queryClient);
      expect(invalidateSpy).toHaveBeenCalledTimes(2);
      expect(invalidateSpy).not.toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: [{ _id: 'communityControllerFindAllMine' }] }),
      );
    });
  });
});
