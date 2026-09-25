/**
 * useNotificationSideEffects Hook
 *
 * Handles UI side effects for notifications: desktop notifications, sounds,
 * Electron click handling, and navigation. Uses useServerEvent() to subscribe
 * to notification events from the SocketHub.
 *
 * Cache updates are handled by notificationHandlers.ts in the hub — this hook
 * is for side effects only.
 */

import { useEffect, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ServerEvents, NotificationType } from '@semaphore-chat/shared';
import type { NewNotificationPayload } from '@semaphore-chat/shared';
import { notificationsControllerGetSettingsOptions } from '../api-client/@tanstack/react-query.gen';
import { useServerEvent } from '../socket-hub/useServerEvent';
import { isDndActive } from '../utils/dnd';
import {
  showNotification,
  formatNotificationContent,
  isNotificationPermissionGranted,
  getNotificationPermission,
} from '../utils/notifications';
import { isNotificationShown, markNotificationAsShown } from '../utils/notificationTracking';
import { getActiveDmGroupId } from '../utils/activeDmTracking';
import { useElectronAPI } from '../contexts/ElectronContext';
import { useWindowFocus } from './useWindowFocus';
import { logger } from '../utils/logger';
import { playSound as playSoundEffect, Sounds, type SoundName } from './useSound';

const NOTIFICATION_SOUND_MAP: Record<string, SoundName> = {
  [NotificationType.CHANNEL_MESSAGE]: Sounds.channelMessage,
  [NotificationType.DIRECT_MESSAGE]: Sounds.directMessage,
  [NotificationType.USER_MENTION]: Sounds.mention,
  [NotificationType.SPECIAL_MENTION]: Sounds.mention,
  [NotificationType.THREAD_REPLY]: Sounds.mention,
};

export interface UseNotificationSideEffectsOptions {
  showDesktopNotifications?: boolean;
  playSound?: boolean;
  onNotificationReceived?: (notification: NewNotificationPayload) => void;
  onNotificationClick?: (notificationId: string) => void;
}

export function useNotificationSideEffects(options: UseNotificationSideEffectsOptions = {}) {
  const {
    showDesktopNotifications = true,
    playSound = true,
    onNotificationReceived,
    onNotificationClick,
  } = options;

  const navigate = useNavigate();
  const location = useLocation();
  const isFocused = useWindowFocus();
  const electronAPI = useElectronAPI();
  const notificationsRef = useRef<Map<string, NewNotificationPayload>>(new Map());

  // Notification settings for Do-Not-Disturb evaluation (cache is updated
  // when the user saves settings, so this rarely refetches)
  const { data: notificationSettings } = useQuery(notificationsControllerGetSettingsOptions());

  // Use refs to avoid stale closures in the useServerEvent callback
  const isFocusedRef = useRef(isFocused);
  isFocusedRef.current = isFocused;
  const locationRef = useRef(location);
  locationRef.current = location;
  const settingsRef = useRef(notificationSettings);
  settingsRef.current = notificationSettings;

  const navigateToNotification = useCallback(
    (notification: { communityId?: string | null; channelId?: string | null; directMessageGroupId?: string | null }) => {
      if (notification.communityId && notification.channelId) {
        navigate(`/community/${notification.communityId}/channel/${notification.channelId}`);
      } else if (notification.directMessageGroupId) {
        navigate(`/direct-messages?group=${notification.directMessageGroupId}`);
      }
    },
    [navigate],
  );

  const handleNotificationClicked = useCallback(
    (notificationId: string) => {
      const notification = notificationsRef.current.get(notificationId);
      if (notification) {
        navigateToNotification(notification);
      }
      onNotificationClick?.(notificationId);
    },
    [navigateToNotification, onNotificationClick],
  );

  // Subscribe to NEW_NOTIFICATION for side effects
  useServerEvent(ServerEvents.NEW_NOTIFICATION, async (payload: NewNotificationPayload) => {
    logger.dev('[Notifications] New notification received:', payload);

    // Store for later lookup (Electron click)
    notificationsRef.current.set(payload.notificationId, payload);

    // Custom callback
    onNotificationReceived?.(payload);

    // Suppress sound + desktop notification when actively viewing the same channel/DM
    const isViewingContext = (() => {
      if (!isFocusedRef.current) return false;
      const { pathname } = locationRef.current;
      if (payload.channelId && payload.communityId) {
        return pathname.includes(`/channel/${payload.channelId}`);
      }
      if (payload.directMessageGroupId) {
        return getActiveDmGroupId() === payload.directMessageGroupId;
      }
      return false;
    })();

    if (isViewingContext) return;

    // Do-Not-Disturb suppresses sounds + desktop notifications (cache/unread
    // updates in notificationHandlers.ts are unaffected)
    const settings = settingsRef.current;
    if (settings && isDndActive(settings)) {
      logger.dev('[Notifications] DND active — suppressing side effects');
      return;
    }

    // Sound — pick the right sound based on notification type
    if (playSound) {
      const soundName = NOTIFICATION_SOUND_MAP[payload.type] || Sounds.channelMessage;
      playSoundEffect(soundName);
    }

    // Desktop notification (skip if already shown via push handler)
    if (showDesktopNotifications && isNotificationPermissionGranted() && !isNotificationShown(payload.notificationId)) {
      const messageText = payload.message?.spans
        .filter((span) => span.type === 'PLAINTEXT')
        .map((span) => span.text)
        .join('');

      const { title, body } = formatNotificationContent({
        type: payload.type,
        authorUsername: payload.author?.username || 'Unknown',
        messageText,
        channelName: payload.channelName ?? undefined,
      });

      await showNotification({
        title,
        body,
        icon: payload.author?.avatarUrl,
        tag: payload.notificationId,
        data: {
          notificationId: payload.notificationId,
          messageId: payload.messageId,
          channelId: payload.channelId,
          communityId: payload.communityId,
          directMessageGroupId: payload.directMessageGroupId,
        },
        onClick: () => {
          handleNotificationClicked(payload.notificationId);
        },
      });

      markNotificationAsShown(payload.notificationId);
    }
  });

  // Electron notification click handler
  useEffect(() => {
    // Null outside Electron.
    if (!electronAPI?.onNotificationClick) return;

    const unsubscribe = electronAPI.onNotificationClick((notificationId: string) => {
      logger.dev('[Notifications] Electron notification clicked:', notificationId);
      handleNotificationClicked(notificationId);
    });

    return () => {
      unsubscribe?.();
    };
  }, [electronAPI, handleNotificationClicked]);

  const requestPermission = useCallback(async () => {
    const { requestNotificationPermission } = await import('../utils/notifications');
    return requestNotificationPermission();
  }, []);

  const checkPermission = useCallback(() => {
    return getNotificationPermission();
  }, []);

  return {
    requestPermission,
    checkPermission,
    navigateToNotification,
  };
}
