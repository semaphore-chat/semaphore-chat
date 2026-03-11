import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { handleReconnect } from '../../../socket-hub/handlers/reconnectHandlers';

describe('handleReconnect', () => {
  let queryClient: QueryClient;
  let invalidateSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    queryClient = new QueryClient();
    invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  });

  it('invalidates channel messages', () => {
    handleReconnect(queryClient);

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: [{ _id: 'messagesControllerFindAllForChannel' }],
      }),
    );
  });

  it('invalidates DM messages', () => {
    handleReconnect(queryClient);

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: [{ _id: 'messagesControllerFindAllForGroup' }],
      }),
    );
  });

  it('invalidates read receipts', () => {
    handleReconnect(queryClient);

    const calls = invalidateSpy.mock.calls.map((c) => c[0]);
    const hasReadReceipts = calls.some((call) => {
      const key = (call as { queryKey: unknown[] }).queryKey;
      return JSON.stringify(key).includes('readReceiptsControllerGetUnreadCounts');
    });
    expect(hasReadReceipts).toBe(true);
  });

  it('invalidates DM peer reads queries', () => {
    handleReconnect(queryClient);

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: [{ _id: 'readReceiptsControllerGetDmPeerReads' }],
      }),
    );
  });

  it('invalidates notification unread count', () => {
    handleReconnect(queryClient);

    const calls = invalidateSpy.mock.calls.map((c) => c[0]);
    const hasNotifCount = calls.some((call) => {
      const key = (call as { queryKey: unknown[] }).queryKey;
      return JSON.stringify(key).includes('notificationsControllerGetUnreadCount');
    });
    expect(hasNotifCount).toBe(true);
  });

  it('invalidates notification list', () => {
    handleReconnect(queryClient);

    const calls = invalidateSpy.mock.calls.map((c) => c[0]);
    const hasNotifList = calls.some((call) => {
      const key = (call as { queryKey: unknown[] }).queryKey;
      return JSON.stringify(key).includes('notificationsControllerGetNotifications');
    });
    expect(hasNotifList).toBe(true);
  });

  it('invalidates channel voice presence', () => {
    handleReconnect(queryClient);

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: [{ _id: 'voicePresenceControllerGetChannelPresence' }],
      }),
    );
  });

  it('invalidates DM voice presence', () => {
    handleReconnect(queryClient);

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: [{ _id: 'dmVoicePresenceControllerGetDmPresence' }],
      }),
    );
  });

  it('invalidates all 8 query types in a single call', () => {
    handleReconnect(queryClient);

    // 8 invalidation calls — one per stale data source (added message readers)
    expect(invalidateSpy).toHaveBeenCalledTimes(8);
  });
});
