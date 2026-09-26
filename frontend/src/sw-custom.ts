/// <reference lib="webworker" />
import {
  precacheAndRoute,
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
} from 'workbox-precaching';
import { clientsClaim } from 'workbox-core';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { swDbGet, swDbSet, SW_DB_KEYS } from './utils/swDb';
import {
  buildNotificationOptions,
  getMarkReadRequest,
  getNavigationHash,
  supportsNotificationActions,
  type PushNotificationData,
} from './utils/swPush';

declare let self: ServiceWorkerGlobalScope;

// Use the precache manifest that Workbox will inject
precacheAndRoute(self.__WB_MANIFEST);

// Clean up old caches
cleanupOutdatedCaches();

// Offline app-shell fallback: serve the precached SPA entry (index.html) for
// all navigation requests so the app boots offline. HashRouter then resolves
// the in-app route client-side. The negative lookahead keeps API and asset
// requests off the navigation handler.
const navigationHandler = createHandlerBoundToURL('index.html');
registerRoute(
  new NavigationRoute(navigationHandler, {
    denylist: [/^\/api(\/|$)/, /^\/socket\.io(\/|$)/],
  }),
);

// Claim uncontrolled clients on activate, but DON'T skipWaiting() at the top
// level — that would silently swap the SW mid-session (e.g. during a call).
// Instead we wait for an explicit SKIP_WAITING message from the app (the
// "Update available → Reload" toast) so updates only apply on user consent.
clientsClaim();

// Apply a pending update only when the app asks (UpdateToast → updateSW(true)).
self.addEventListener('message', (event: ExtendableMessageEvent) => {
  if ((event.data as { type?: string } | null)?.type === 'SKIP_WAITING') {
    event.waitUntil(self.skipWaiting());
  }
});

// Cache images
registerRoute(
  /\.(?:png|jpg|jpeg|svg|gif|webp)$/i,
  new CacheFirst({
    cacheName: 'image-cache',
    plugins: [
      new ExpirationPlugin({
        maxEntries: 100,
        maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
      }),
    ],
  })
);

// Cache fonts
registerRoute(
  /\.(?:woff|woff2|ttf|eot)$/i,
  new CacheFirst({
    cacheName: 'font-cache',
    plugins: [
      new ExpirationPlugin({
        maxEntries: 20,
        maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
      }),
    ],
  })
);

/**
 * Convert a base64url VAPID public key into the Uint8Array that
 * PushManager.subscribe expects. Mirrors utils/pushSubscription.ts (the SW
 * can't import that module — it references `window`).
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = self.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Set or clear the app-icon badge flag (Badging API, Chromium-only).
 * Always resolves — feature-detected and error-swallowed so badge support
 * can never break notification delivery or click handling.
 */
function setBadgeFlag(on: boolean): Promise<void> {
  const nav = self.navigator as Navigator & {
    setAppBadge?: () => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  };
  const fn = on ? nav.setAppBadge : nav.clearAppBadge;
  if (typeof fn !== 'function') {
    return Promise.resolve();
  }
  return fn.call(nav).catch(() => {});
}

// Handle push notifications
self.addEventListener('push', (event: PushEvent) => {
  if (!event.data) {
    console.log('[SW] Push event with no data');
    return;
  }

  let data: PushNotificationData;
  try {
    data = event.data.json() as PushNotificationData;
  } catch {
    console.error('[SW] Failed to parse push data');
    return;
  }

  // In SW scope the global `Notification` constructor exists but isn't in
  // the `webworker` lib types under that name in all contexts — cast as needed.
  const options = buildNotificationOptions(
    data,
    supportsNotificationActions(Notification as unknown),
  );

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(data.title, options),
      // Flag the app icon (Badging API, Chromium-only). Count-less form: the
      // SW doesn't know the total unread count; the app sets the exact count
      // via useAppBadge whenever it's running.
      setBadgeFlag(true),
    ]),
  );
});

// Handle notification click
self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();

  const data = event.notification.data as PushNotificationData['data'];

  if (event.action === 'mark-read') {
    // Best-effort: mark the notification read server-side without opening or
    // focusing any window. Deliberately does NOT clear the SW-set badge flag
    // — other unread notifications may still exist, and the app corrects the
    // badge to the exact count on next launch (see useAppBadge).
    const request = getMarkReadRequest(data);
    if (request) {
      event.waitUntil(fetch(request.url, request.init).catch(() => {}));
    }
    return;
  }

  // Determine the path to navigate to (app uses HashRouter, so paths must be under /#/)
  const hash = getNavigationHash(data);
  const targetUrl = new URL(`/${hash}`, self.location.origin).href;

  // Clear the SW-set badge flag, then focus an existing same-origin window
  // or open a new one; once the app opens, useAppBadge takes over with the
  // exact unread count.
  event.waitUntil(
    setBadgeFlag(false).then(() =>
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }),
    ).then(async (clients) => {
      const existing = clients.find(
        (c) => new URL(c.url).origin === self.location.origin,
      );
      if (existing) {
        try {
          await existing.focus();
          if (existing.url !== targetUrl) {
            await (existing as WindowClient).navigate(targetUrl);
          }
          return;
        } catch {
          // navigate() fails on some mobile browsers — fall through to openWindow
        }
      }
      return self.clients.openWindow(targetUrl);
    }),
  );
});

/**
 * Best-effort re-subscription when the browser rotates/expires the push
 * subscription. The SW has no reliable access to the user's JWT (we
 * deliberately never store auth tokens in the SW for a self-hosted app), so
 * the authoritative re-sync happens on next app startup (see usePushResync).
 *
 * Here we do two things, both best-effort and error-swallowed:
 *   1. Re-subscribe with the VAPID key stashed in IndexedDB at subscribe time,
 *      so a valid subscription exists as early as possible.
 *   2. Record the new endpoint as "pending" in IndexedDB and clear the
 *      "last synced" marker, so the startup re-sync detects the change and
 *      POSTs the new subscription to the backend with proper auth.
 */
self.addEventListener('pushsubscriptionchange', (rawEvent: Event) => {
  // `pushsubscriptionchange` isn't in the TS SW event map; it's an
  // ExtendableEvent at runtime (has waitUntil).
  const event = rawEvent as ExtendableEvent;
  event.waitUntil(
    (async () => {
      try {
        const vapidKey = await swDbGet<string>(
          SW_DB_KEYS.applicationServerKey,
        );
        if (!vapidKey) {
          return;
        }

        const newSub = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey),
        });

        // Signal the window layer that a re-sync is needed. Clearing the
        // last-synced endpoint guarantees usePushResync re-POSTs on startup.
        await swDbSet(SW_DB_KEYS.pendingEndpoint, newSub.endpoint);
        await swDbSet(SW_DB_KEYS.lastSyncedEndpoint, null);
      } catch (err) {
        console.error('[SW] pushsubscriptionchange re-subscribe failed', err);
      }
    })(),
  );
});
