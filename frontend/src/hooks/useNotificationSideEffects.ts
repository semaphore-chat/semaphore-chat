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
import { useNavigate } from 'react-router-dom';
import { ServerEvents, NotificationType } from '@kraken/shared';
import type { NewNotificationPayload } from '@kraken/shared';
import { useServerEvent } from '../socket-hub/useServerEvent';
import {
  showNotification,
  formatNotificationContent,
  isNotificationPermissionGranted,
  getNotificationPermission,
} from '../utils/notifications';
import { isNotificationShown, markNotificationAsShown } from '../utils/notificationTracking';
import { isElectron, getElectronAPI } from '../utils/platform';
import { logger } from '../utils/logger';
import { playSound as playSoundEffect, Sounds, type SoundName } from './useSound';

const NOTIFICATION_SOUND_MAP: Record<string, SoundName> = {
  [NotificationType.CHANNEL_MESSAGE]: Sounds.channelMessage,
  [NotificationType.DIRECT_MESSAGE]: Sounds.directMessage,
  [NotificationType.USER_MENTION]: Sounds.mention,
  [NotificationType.SPECIAL_MENTION]: Sounds.mention,
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
  const notificationsRef = useRef<Map<string, NewNotificationPayload>>(new Map());

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
    if (!isElectron()) return;

    const electronAPI = getElectronAPI();
    if (!electronAPI?.onNotificationClick) return;

    const unsubscribe = electronAPI.onNotificationClick((notificationId: string) => {
      logger.dev('[Notifications] Electron notification clicked:', notificationId);
      handleNotificationClicked(notificationId);
    });

    return () => {
      unsubscribe?.();
    };
  }, [handleNotificationClicked]);

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
