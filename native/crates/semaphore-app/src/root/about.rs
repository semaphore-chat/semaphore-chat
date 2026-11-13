//! About Semaphore Chat, opened from the app menu's Help item or the account menu.
//!
//! The dialog is the UI crate's (`semaphore_ui::about`): this is its state on the root, the
//! version the build reports ([`crate::version::version`]), where the package's licences are, and
//! what its links ask for: the app's `open_url` seam (a URL, or the licence file's path).
//!
//! It lives over whatever is on screen, signed in or not, and closes on Escape, the backdrop or
//! Close without touching the session.

use super::AppRoot;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_ui::about::{AboutDialog, AboutEvent};

impl AppRoot {
    /// Shows About Semaphore Chat, unless it is already open (a second press is a no-op).
    pub(crate) fn open_about(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.about.is_some() {
            return;
        }
        let dialog = cx.new(|cx| AboutDialog::new(crate::version::version(), window, cx));
        dialog.update(cx, |dialog, cx| {
            dialog.set_licences(crate::menu::licences_path(), cx)
        });
        self.about_subscription =
            Some(
                cx.subscribe(&dialog, |root, _, event: &AboutEvent, cx| match event {
                    AboutEvent::Close => {
                        root.about = None;
                        cx.notify();
                    }
                    AboutEvent::OpenUrl(url) => crate::open_url(url, cx),
                }),
            );
        self.about = Some(dialog);
        cx.notify();
    }
}
