/**
 * Notification Utility
 *
 * Handles browser Notification API and Electron notification integration.
 * Provides platform-agnostic notification display with permission management.
 */

import { isElectron, getElectronAPI, isSecureContext } from './platform';
import { logger } from './logger';
import { NotificationType } from '../types/notification.type';

/**
 * Browser notification permission states
 */
export type NotificationPermission = 'default' | 'granted' | 'denied';

/**
 * Check if notification permission is currently granted
 */
export const isNotificationPermissionGranted = (): boolean => {
  return getNotificationPermission() === 'granted';
};

/**
 * Check if notifications are supported in the current environment
 */
export const supportsNotifications = (): boolean => {
  if (isElectron()) {
    // Electron always supports notifications
    return true;
  }

  // Browser: Check for Notification API support and secure context
  return (
    typeof window !== 'undefined' &&
    'Notification' in window &&
    isSecureContext()
  );
};

/**
 * Get current notification permission status
 */
export const getNotificationPermission = (): NotificationPermission => {
  if (!supportsNotifications()) {
    return 'denied';
  }

  if (isElectron()) {
    // Electron notifications don't require explicit permission
    return 'granted';
  }

  return Notification.permission as NotificationPermission;
};

/**
 * Request notification permission from the user
 * Returns the permission status after the request
 */
export const requestNotificationPermission = async (): Promise<NotificationPermission> => {
  if (!supportsNotifications()) {
    logger.warn('[Notifications] Notifications not supported in this environment');
    return 'denied';
  }

  if (isElectron()) {
    // Electron doesn't require permission
    return 'granted';
  }

  try {
    const permission = await Notification.requestPermission();
    return permission as NotificationPermission;
  } catch (error) {
    logger.error('[Notifications] Error requesting permission:', error);
    return 'denied';
  }
};

/**
 * Options for showing a notification
 */
export interface ShowNotificationOptions {
  title: string;
  body?: string;
  icon?: string;
  tag?: string; // Unique identifier to replace existing notifications
  data?: Record<string, unknown>; // Custom data to attach to the notification
  requireInteraction?: boolean; // Keep notification visible until user interacts
  silent?: boolean; // Don't play sound
  onClick?: () => void; // Callback when notification is clicked
}

/**
 * Show a platform-specific notification
 */
export const showNotification = async (
  options: ShowNotificationOptions
): Promise<globalThis.Notification | null> => {
  const permission = getNotificationPermission();

  if (permission !== 'granted') {
    logger.warn('[Notifications] Permission not granted, cannot show notification');
    return null;
  }

  if (isElectron()) {
    return showElectronNotification(options);
  } else {
    return showBrowserNotification(options);
  }
};

/**
 * Show a browser notification using the Notification API
 */
const showBrowserNotification = (
  options: ShowNotificationOptions
): globalThis.Notification | null => {
  try {
    const notification = new Notification(options.title, {
      body: options.body,
      icon: options.icon,
      tag: options.tag,
      data: options.data,
      requireInteraction: options.requireInteraction,
      silent: options.silent,
    });

    if (options.onClick) {
      notification.onclick = () => {
        options.onClick?.();
        notification.close();
      };
    }

    return notification;
  } catch (error) {
    logger.error('[Notifications] Error showing browser notification:', error);
    return null;
  }
};

/**
 * Show an Electron notification via IPC
 */
const showElectronNotification = (
  options: ShowNotificationOptions
): globalThis.Notification | null => {
  const electronAPI = getElectronAPI();

  if (!electronAPI || typeof electronAPI.showNotification !== 'function') {
    logger.error('[Notifications] Electron notification API not available');
    return null;
  }

  try {
    // Send notification to Electron main process
    electronAPI.showNotification({
      title: options.title,
      body: options.body,
      icon: options.icon,
      tag: options.tag,
      silent: options.silent,
    });

    // Electron IPC doesn't return a Notification object, so we return null
    // The click handler will be managed by Electron's IPC
    return null;
  } catch (error) {
    logger.error('[Notifications] Error showing Electron notification:', error);
    return null;
  }
};

/**
 * Format notification content based on notification type
 */
export interface FormatNotificationParams {
  type: NotificationType;
  authorUsername: string;
  messageText?: string;
  channelName?: string;
  dmGroupName?: string;
}

export const formatNotificationContent = (
  params: FormatNotificationParams
): { title: string; body: string } => {
  const { type, authorUsername, messageText, channelName, dmGroupName } = params;

  switch (type) {
    case NotificationType.USER_MENTION:
      return {
        title: `${authorUsername} mentioned you${channelName ? ` in #${channelName}` : ''}`,
        body: messageText || 'New mention',
      };

    case NotificationType.SPECIAL_MENTION:
      return {
        title: `${authorUsername} mentioned ${channelName ? `#${channelName}` : 'everyone'}`,
        body: messageText || 'New mention',
      };

    case NotificationType.DIRECT_MESSAGE:
      return {
        title: dmGroupName || `${authorUsername}`,
        body: messageText || 'New message',
      };

    case NotificationType.CHANNEL_MESSAGE:
      return {
        title: `${authorUsername}${channelName ? ` in #${channelName}` : ''}`,
        body: messageText || 'New message',
      };

    default:
      return {
        title: 'New notification',
        body: messageText || '',
      };
  }
};

/**
 * Clear all notifications with a specific tag
 */
export const clearNotificationsByTag = (tag: string): void => {
  // Browser API doesn't provide a way to clear notifications by tag
  // Electron will need to implement this via IPC
  if (isElectron()) {
    const electronAPI = getElectronAPI();
    if (electronAPI && typeof electronAPI.clearNotifications === 'function') {
      electronAPI.clearNotifications(tag);
    }
  }
};

export default {
  supportsNotifications,
  getNotificationPermission,
  requestNotificationPermission,
  showNotification,
  formatNotificationContent,
  clearNotificationsByTag,
};
