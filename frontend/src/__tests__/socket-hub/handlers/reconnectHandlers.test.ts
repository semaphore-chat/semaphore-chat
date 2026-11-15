import { describe, it, expect, beforeEach, vi, type MockInstance } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { handleReconnect } from '../../../socket-hub/handlers/reconnectHandlers';
import { createInfiniteData, createMessage } from '../../test-utils';
import { channelMessagesQueryKey, dmMessagesQueryKey } from '../../../utils/messageQueryKeys';

describe('handleReconnect', () => {
  let queryClient: QueryClient;
  let invalidateSpy: MockInstance<QueryClient['invalidateQueries']>;
  let resetSpy: MockInstance<QueryClient['resetQueries']>;

  beforeEach(() => {
    queryClient = new QueryClient();
    invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    resetSpy = vi.spyOn(queryClient, 'resetQueries');
  });

  it('invalidates channel messages that are still at the live edge', () => {
    const live = createInfiniteData([createMessage()]);
    queryClient.setQueryData(channelMessagesQueryKey('chan-1'), live);

    handleReconnect(queryClient);

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: channelMessagesQueryKey('chan-1'),
      exact: true,
    });
  });

  it('invalidates DM messages that are still at the live edge', () => {
    const live = createInfiniteData([createMessage()]);
    queryClient.setQueryData(dmMessagesQueryKey('dm-1'), live);

    handleReconnect(queryClient);

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: dmMessagesQueryKey('dm-1'),
      exact: true,
    });
  });

  it('resets detached message queries instead of invalidating them', () => {
    const detached = { ...createInfiniteData([createMessage()]), pageParams: ['cursor-uuid'] };
    queryClient.setQueryData(channelMessagesQueryKey('chan-detached'), detached);
    const live = createInfiniteData([createMessage()]);
    queryClient.setQueryData(channelMessagesQueryKey('chan-live'), live);

    handleReconnect(queryClient);

    expect(resetSpy).toHaveBeenCalledWith({ queryKey: channelMessagesQueryKey('chan-detached'), exact: true });
    // live window: not reset (still handled by invalidation)
    expect(resetSpy).not.toHaveBeenCalledWith({ queryKey: channelMessagesQueryKey('chan-live'), exact: true });
    expect(queryClient.getQueryState(channelMessagesQueryKey('chan-live'))?.isInvalidated).toBe(true);
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

  it('invalidates all 9 query types in a single call', () => {
    // Message queries only invalidate when present in cache and at the live
    // edge (see the reset test above for the detached case).
    queryClient.setQueryData(channelMessagesQueryKey('chan-1'), createInfiniteData([createMessage()]));
    queryClient.setQueryData(dmMessagesQueryKey('dm-1'), createInfiniteData([createMessage()]));

    handleReconnect(queryClient);

    // 9 invalidation calls — one per stale data source (added message readers,
    // then bulk presence)
    expect(invalidateSpy).toHaveBeenCalledTimes(9);
  });
});
