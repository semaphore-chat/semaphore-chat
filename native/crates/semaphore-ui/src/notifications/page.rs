//! US2: the notifications page (`/notifications`), the centre's list full width with its filters,
//! "Mark all read", dismiss and "Load more", after `pages/NotificationsPage.tsx`. It emits the
//! centre's events.
//!
//! Frozen by the UI freeze: the public API below (`new`, the setters and `NotificationsPageEvent`) is what the app
//! wiring lane builds against while US2 draws the screen; change it only with the coordinator.
//! Until US2 lands, it draws a placeholder.

#![allow(dead_code)]

use crate::kit::{Variant, text};
use crate::messages::TimeFormat;
use crate::panel::PanelClock;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::NotificationList;

#[derive(Debug, Clone, PartialEq)]
pub enum NotificationsPageEvent {
    /// Every action is the centre's (`NotificationEvent`), handled the same way.
    Notification(super::NotificationEvent),
}

pub struct NotificationsPage {
    list: NotificationList,
    clock: PanelClock,
    time: TimeFormat,
}

impl EventEmitter<NotificationsPageEvent> for NotificationsPage {}

impl NotificationsPage {
    pub fn new(_window: &mut Window, _cx: &mut Context<Self>) -> Self {
        Self {
            list: NotificationList::default(),
            clock: PanelClock::default(),
            time: TimeFormat::default(),
        }
    }

    /// `Core::notifications()`.
    pub fn set_list(&mut self, list: NotificationList, cx: &mut Context<Self>) {
        self.list = list;
        cx.notify();
    }

    /// What "2 hours ago" is measured from.
    pub fn set_clock(&mut self, clock: PanelClock, cx: &mut Context<Self>) {
        self.clock = clock;
        cx.notify();
    }

    /// The zone dates are written in.
    pub fn set_time(&mut self, time: TimeFormat, cx: &mut Context<Self>) {
        self.time = time;
        cx.notify();
    }
}

impl Render for NotificationsPage {
    fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .id("notificationspage-placeholder")
            .p_4()
            .child(text(Variant::Body2, "This screen isn't built yet."))
    }
}

#[cfg(feature = "stories")]
pub fn stories() -> Vec<crate::stories::Story> {
    Vec::new()
}
