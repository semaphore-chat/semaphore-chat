import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

// --- Mocks ---
const subscribeMutate = vi.fn();
const unsubscribeMutate = vi.fn().mockResolvedValue({});
const refetch = vi.fn();
let vapid: { enabled: boolean; publicKey?: string } | undefined;
vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: { queryKey: string }) =>
    options.queryKey === 'vapid'
      ? { data: vapid, isLoading: false }
      : { data: undefined, isLoading: false, refetch },
  useMutation: (options: { kind: string }) => ({
    mutateAsync: options.kind === 'subscribe' ? subscribeMutate : unsubscribeMutate,
  }),
}));
vi.mock('../../api-client/@tanstack/react-query.gen', () => ({
  pushNotificationsControllerGetVapidPublicKeyOptions: () => ({ queryKey: 'vapid' }),
  pushNotificationsControllerGetStatusOptions: () => ({ queryKey: 'status' }),
  pushNotificationsControllerSubscribeMutation: () => ({ kind: 'subscribe' }),
  pushNotificationsControllerUnsubscribeMutation: () => ({ kind: 'unsubscribe' }),
}));

const getCurrentPushSubscription = vi.fn();
const unsubscribeFromPush = vi.fn().mockResolvedValue(true);
let permission = true;
vi.mock('../../utils/pushSubscription', () => ({
  isPushSupported: () => true,
  hasNotificationPermission: () => permission,
  getCurrentPushSubscription: () => getCurrentPushSubscription(),
  unsubscribeFromPush: () => unsubscribeFromPush(),
  requestNotificationPermission: vi.fn(),
  subscribeToPush: vi.fn(),
  extractSubscriptionData: (sub: { endpoint: string }) => ({
    endpoint: sub.endpoint,
    keys: { p256dh: 'p', auth: 'a' },
    userAgent: 'test',
  }),
}));

const swDbSet = vi.fn().mockResolvedValue(undefined);
vi.mock('../../utils/swDb', () => ({
  swDbSet: (...args: unknown[]) => swDbSet(...args),
  swDbDelete: vi.fn().mockResolvedValue(undefined),
  SW_DB_KEYS: {
    applicationServerKey: 'push:applicationServerKey',
    lastSyncedEndpoint: 'push:lastSyncedEndpoint',
    pendingEndpoint: 'push:pendingEndpoint',
  },
}));
vi.mock('../../utils/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { usePushNotifications } from '../../hooks/usePushNotifications';

const subscription = { endpoint: 'https://push.example/this-device' };
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

describe('usePushNotifications: giving the server this device back', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vapid = { enabled: true, publicKey: 'key' };
    permission = true;
    subscribeMutate.mockResolvedValue({});
    unsubscribeMutate.mockResolvedValue({});
    getCurrentPushSubscription.mockResolvedValue(subscription);
  });

  it('re-posts a local subscription on mount, for a server that lost it', async () => {
    const { result } = renderHook(() => usePushNotifications());

    await waitFor(() => expect(subscribeMutate).toHaveBeenCalledTimes(1));
    expect(subscribeMutate).toHaveBeenCalledWith({
      body: expect.objectContaining({ endpoint: subscription.endpoint }),
    });
    await waitFor(() => expect(result.current.isSubscribed).toBe(true));
    await waitFor(() =>
      expect(swDbSet).toHaveBeenCalledWith('push:lastSyncedEndpoint', subscription.endpoint),
    );
  });

  it('re-posts once, not on every render', async () => {
    const { rerender } = renderHook(() => usePushNotifications());
    await waitFor(() => expect(subscribeMutate).toHaveBeenCalledTimes(1));
    rerender();
    rerender();
    await flush();
    expect(subscribeMutate).toHaveBeenCalledTimes(1);
  });

  it('posts nothing without a local subscription', async () => {
    getCurrentPushSubscription.mockResolvedValue(null);
    const { result } = renderHook(() => usePushNotifications());
    await flush();
    expect(result.current.isSubscribed).toBe(false);
    expect(subscribeMutate).not.toHaveBeenCalled();
  });

  it('posts nothing when push is off on this instance, or permission is gone', async () => {
    vapid = { enabled: false };
    const { unmount } = renderHook(() => usePushNotifications());
    await flush();
    unmount();

    vapid = { enabled: true, publicKey: 'key' };
    permission = false;
    renderHook(() => usePushNotifications());
    await flush();

    expect(subscribeMutate).not.toHaveBeenCalled();
  });

  it('a failed re-post stays quiet', async () => {
    subscribeMutate.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => usePushNotifications());
    await waitFor(() => expect(subscribeMutate).toHaveBeenCalled());
    await flush();
    expect(result.current.error).toBeNull();
  });

  it('turning push off while the re-post is in flight lets it land first', async () => {
    let finishPost: (value: unknown) => void = () => {};
    subscribeMutate.mockReturnValue(new Promise((resolve) => { finishPost = resolve; }));
    const { result } = renderHook(() => usePushNotifications());
    await waitFor(() => expect(subscribeMutate).toHaveBeenCalledTimes(1));

    let done: Promise<boolean> = Promise.resolve(false);
    act(() => { done = result.current.unsubscribe(); });
    await flush();
    expect(unsubscribeMutate).not.toHaveBeenCalled();

    finishPost({});
    await act(async () => { await done; });

    expect(unsubscribeMutate).toHaveBeenCalledTimes(1);
    expect(unsubscribeFromPush).toHaveBeenCalledTimes(1);
    expect(result.current.isSubscribed).toBe(false);
  });

  it('turning push off before the re-post starts cancels it', async () => {
    let giveSubscription: (value: unknown) => void = () => {};
    getCurrentPushSubscription.mockReturnValueOnce(new Promise((resolve) => { giveSubscription = resolve; }));
    const { result } = renderHook(() => usePushNotifications());

    let done: Promise<boolean> = Promise.resolve(false);
    act(() => { done = result.current.unsubscribe(); });
    giveSubscription(subscription);
    await act(async () => { await done; });

    expect(subscribeMutate).not.toHaveBeenCalled();
    expect(unsubscribeMutate).toHaveBeenCalledTimes(1);
  });
});
