/**
 * Push Subscription Utilities
 *
 * Helper functions for managing Web Push API subscriptions.
 * These functions handle the browser Push API directly.
 */

import { isElectron } from './platform';

/**
 * Check if push notifications are supported in this browser
 */
export function isPushSupported(): boolean {
  // Push not supported in Electron - use native notifications instead
  if (isElectron()) {
    return false;
  }

  return (
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/**
 * Check if notification permission has been granted
 */
export function hasNotificationPermission(): boolean {
  if (!('Notification' in window)) {
    return false;
  }
  return Notification.permission === 'granted';
}

/**
 * Request notification permission from the user
 */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!('Notification' in window)) {
    return 'denied';
  }
  return Notification.requestPermission();
}

/**
 * Convert a base64 VAPID key to Uint8Array format for PushManager
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  return outputArray;
}

/**
 * Get the current push subscription from the service worker
 */
export async function getCurrentPushSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) {
    return null;
  }

  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

/**
 * Subscribe to push notifications using the VAPID public key
 */
export async function subscribeToPush(vapidPublicKey: string): Promise<PushSubscription> {
  if (!isPushSupported()) {
    throw new Error('Push notifications are not supported in this browser');
  }

  // Request permission if not already granted
  const permission = await requestNotificationPermission();
  if (permission !== 'granted') {
    throw new Error('Notification permission denied');
  }

  // Wait for service worker to be ready
  const registration = await navigator.serviceWorker.ready;

  // Convert VAPID key to the format PushManager expects
  const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);

  // Subscribe to push notifications
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey,
  });

  return subscription;
}

/**
 * Unsubscribe from push notifications
 */
export async function unsubscribeFromPush(): Promise<boolean> {
  const subscription = await getCurrentPushSubscription();
  if (!subscription) {
    return true; // Already unsubscribed
  }

  return subscription.unsubscribe();
}

/**
 * Extract subscription data in the format expected by our backend
 */
export function extractSubscriptionData(subscription: PushSubscription): {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  userAgent: string;
} {
  const json = subscription.toJSON();

  if (!json.keys?.p256dh || !json.keys?.auth) {
    throw new Error('Invalid push subscription: missing keys');
  }

  return {
    endpoint: subscription.endpoint,
    keys: {
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
    },
    userAgent: navigator.userAgent,
  };
}
