/**
 * usePushNotifications Hook
 *
 * Manages push notification subscription state and provides
 * methods to subscribe/unsubscribe from push notifications.
 *
 * This hook is only relevant for web PWA - Electron uses native notifications.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { logger } from '../utils/logger';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  pushNotificationsControllerGetVapidPublicKeyOptions,
  pushNotificationsControllerGetStatusOptions,
  pushNotificationsControllerSubscribeMutation,
  pushNotificationsControllerUnsubscribeMutation,
} from '../api-client/@tanstack/react-query.gen';
import {
  isPushSupported,
  hasNotificationPermission,
  requestNotificationPermission,
  getCurrentPushSubscription,
  subscribeToPush,
  unsubscribeFromPush,
  extractSubscriptionData,
} from '../utils/pushSubscription';
import { swDbSet, swDbDelete, SW_DB_KEYS } from '../utils/swDb';

export interface UsePushNotificationsResult {
  /** Whether push notifications are supported in this environment */
  isSupported: boolean;
  /** Whether push is enabled on the server (VAPID keys configured) */
  isServerEnabled: boolean;
  /** Whether the user is currently subscribed to push notifications */
  isSubscribed: boolean;
  /** Whether notification permission has been granted */
  hasPermission: boolean;
  /** Whether an operation is in progress */
  isLoading: boolean;
  /** Error message if something went wrong */
  error: string | null;
  /** Subscribe to push notifications */
  subscribe: () => Promise<boolean>;
  /** Unsubscribe from push notifications */
  unsubscribe: () => Promise<boolean>;
  /** Toggle subscription state */
  toggle: () => Promise<boolean>;
}

export function usePushNotifications(): UsePushNotificationsResult {
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Query VAPID public key and push status from backend
  const { data: vapidData, isLoading: isLoadingVapid } = useQuery({
    ...pushNotificationsControllerGetVapidPublicKeyOptions(),
    enabled: isPushSupported(),
  });
  const { data: _pushStatus, isLoading: isLoadingStatus, refetch: refetchStatus } = useQuery({
    ...pushNotificationsControllerGetStatusOptions(),
    enabled: isPushSupported(),
  });

  // Mutations for subscribing/unsubscribing
  const { mutateAsync: subscribePushMutation } = useMutation(pushNotificationsControllerSubscribeMutation());
  const { mutateAsync: unsubscribePushMutation } = useMutation(pushNotificationsControllerUnsubscribeMutation());

  const isSupported = isPushSupported();
  const isServerEnabled = vapidData?.enabled ?? false;
  const hasPermission = hasNotificationPermission();

  // Check if we have a local subscription on mount
  useEffect(() => {
    if (!isSupported) return;

    getCurrentPushSubscription().then((subscription) => {
      setIsSubscribed(subscription !== null);
    });
  }, [isSupported]);

  // The server can lose this device while the browser keeps its subscription
  // ("sign out everywhere else" ends every subscription), and nothing here would
  // show it: the switch reads the browser's. So give it back, once per mount.
  // Turning push off removes the browser's subscription, so this can't undo that,
  // and unsubscribe waits for or cancels a re-post already under way.
  const repost = useRef<Promise<void> | null>(null);
  const turningOff = useRef(false);
  useEffect(() => {
    if (!isSupported || !isServerEnabled || !hasPermission || repost.current) return;
    repost.current = (async () => {
      try {
        const subscription = await getCurrentPushSubscription();
        if (!subscription || turningOff.current) return;
        await subscribePushMutation({ body: extractSubscriptionData(subscription) });
        await swDbSet(SW_DB_KEYS.lastSyncedEndpoint, subscription.endpoint);
        refetchStatus();
      } catch (err) {
        // Best effort, like usePushResync: the switch still works by hand.
        logger.warn('[usePushNotifications] Could not re-post the subscription:', err);
      }
    })();
  }, [isSupported, isServerEnabled, hasPermission, subscribePushMutation, refetchStatus]);

  // Subscribe to push notifications
  const subscribe = useCallback(async (): Promise<boolean> => {
    if (!isSupported) {
      setError('Push notifications are not supported in this browser');
      return false;
    }

    if (!isServerEnabled || !vapidData?.publicKey) {
      setError('Push notifications are not configured on this instance');
      return false;
    }

    setIsLoading(true);
    setError(null);

    let subscription: PushSubscription | null = null;

    try {
      // Request permission if needed
      const permission = await requestNotificationPermission();
      if (permission !== 'granted') {
        setError('Notification permission was denied');
        return false;
      }

      // Subscribe via Push API
      subscription = await subscribeToPush(vapidData.publicKey);

      // Extract data and send to backend
      const subscriptionData = extractSubscriptionData(subscription);
      await subscribePushMutation({ body: subscriptionData });

      // Persist bookkeeping the SW / startup re-sync need:
      //  - the VAPID key so the SW can re-subscribe on pushsubscriptionchange
      //  - the synced endpoint so usePushResync can detect a later rotation
      await swDbSet(SW_DB_KEYS.applicationServerKey, vapidData.publicKey);
      await swDbSet(SW_DB_KEYS.lastSyncedEndpoint, subscription.endpoint);

      setIsSubscribed(true);
      refetchStatus();
      return true;
    } catch (err) {
      // If we created a local subscription but backend failed, clean it up
      if (subscription) {
        try {
          await subscription.unsubscribe();
        } catch (cleanupErr) {
          logger.warn('[usePushNotifications] Failed to cleanup local subscription:', cleanupErr);
        }
      }

      const message = err instanceof Error ? err.message : 'Failed to subscribe to push notifications';
      setError(message);
      logger.error('[usePushNotifications] Subscribe error:', err);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [isSupported, isServerEnabled, vapidData?.publicKey, subscribePushMutation, refetchStatus]);

  // Unsubscribe from push notifications
  const unsubscribe = useCallback(async (): Promise<boolean> => {
    if (!isSupported) {
      return true;
    }

    setIsLoading(true);
    setError(null);
    turningOff.current = true;

    try {
      await repost.current;

      // Get current subscription
      const subscription = await getCurrentPushSubscription();
      if (!subscription) {
        setIsSubscribed(false);
        return true;
      }

      // Unsubscribe from backend first
      try {
        await unsubscribePushMutation({ body: { endpoint: subscription.endpoint } });
      } catch (backendError) {
        // Continue even if backend fails - we'll clean up the local subscription
        logger.warn('[usePushNotifications] Backend unsubscribe failed:', backendError);
      }

      // Unsubscribe locally
      await unsubscribeFromPush();

      // Clear the synced-endpoint marker so a stale value can't trigger a
      // spurious re-sync of a subscription the user has removed.
      await swDbDelete(SW_DB_KEYS.lastSyncedEndpoint);
      await swDbDelete(SW_DB_KEYS.pendingEndpoint);

      setIsSubscribed(false);
      refetchStatus();
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to unsubscribe from push notifications';
      setError(message);
      logger.error('[usePushNotifications] Unsubscribe error:', err);
      return false;
    } finally {
      turningOff.current = false;
      setIsLoading(false);
    }
  }, [isSupported, unsubscribePushMutation, refetchStatus]);

  // Toggle subscription state
  const toggle = useCallback(async (): Promise<boolean> => {
    if (isSubscribed) {
      return unsubscribe();
    } else {
      return subscribe();
    }
  }, [isSubscribed, subscribe, unsubscribe]);

  return {
    isSupported,
    isServerEnabled,
    isSubscribed,
    hasPermission,
    isLoading: isLoading || isLoadingVapid || isLoadingStatus,
    error,
    subscribe,
    unsubscribe,
    toggle,
  };
}
