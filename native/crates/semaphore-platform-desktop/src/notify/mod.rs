//! OS notifications.
//!
//! - **Linux:** [`FreedesktopNotifier`], our own client of `org.freedesktop.Notifications` on zbus
//!   (async-io): one thread and one session-bus connection for the app's lifetime. A newer
//!   notification for a tag replaces the older one (`replaces_id`), a withdraw closes it, and a
//!   click (the default action, with the `ActivationToken` that came just before it) becomes
//!   [`DesktopEvent::NotificationClicked`](crate::DesktopEvent::NotificationClicked).
//! - **Windows:** GPUI's toasts, which live on the UI thread, so the app forwards to them
//!   (`semaphore-app`'s `notifier` module) and routes their clicks to the same event.

#[cfg(target_os = "linux")]
mod linux;

#[cfg(target_os = "linux")]
pub use linux::FreedesktopNotifier;

use std::sync::atomic::{AtomicU64, Ordering};

/// A tag for a plain `Notifier::notify`, which has none: each is its own notification.
pub fn plain_tag() -> String {
    static NEXT: AtomicU64 = AtomicU64::new(1);
    format!("plain:{}", NEXT.fetch_add(1, Ordering::Relaxed))
}
