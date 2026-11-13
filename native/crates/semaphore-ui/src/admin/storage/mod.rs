//! UA5: per-user storage: the usage filter (everyone, over 75%, over 90%), the list a page at a
//! time, a user's quota (GiB) and recalculation, after `pages/admin/AdminStoragePage.tsx`.
//!
//! Frozen by the UI freeze: the public API below (`new`, the setters and `StorageEvent`) is what the app
//! wiring lane builds against while UA5 draws the screen; change it only with the coordinator.
//! Until UA5 lands, it draws a placeholder.

#![allow(dead_code)]

use crate::kit::{Variant, text};
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{AdminStorageView, InstanceAdminCaps};

#[derive(Debug, Clone, PartialEq)]
pub enum StorageEvent {
    /// The filter changed: the owner reads `Core::admin_storage(min_percent)`.
    Filter(u32),
    /// `Core::load_more_storage(min_percent)`.
    LoadMore,
    /// `Core::set_user_quota(user_id, quota_bytes)`.
    SetQuota { user_id: String, quota_bytes: u64 },
    /// `Core::recalculate_storage(user_id)`.
    Recalculate { user_id: String },
    /// The read failed and the user asked again: `Core::retry_failed`.
    Retry,
}

pub struct StoragePage {
    caps: InstanceAdminCaps,
    view: AdminStorageView,
}

impl EventEmitter<StorageEvent> for StoragePage {}

impl StoragePage {
    pub fn new(_window: &mut Window, _cx: &mut Context<Self>) -> Self {
        Self {
            caps: InstanceAdminCaps::default(),
            view: AdminStorageView::default(),
        }
    }

    /// What this user may do on the instance (`InstancePermissionsView::admin`).
    pub fn set_caps(&mut self, caps: InstanceAdminCaps, cx: &mut Context<Self>) {
        self.caps = caps;
        cx.notify();
    }

    /// `Core::admin_storage(min_percent)`.
    pub fn set_view(&mut self, view: AdminStorageView, cx: &mut Context<Self>) {
        self.view = view;
        cx.notify();
    }
}

impl Render for StoragePage {
    fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .id("storagepage-placeholder")
            .p_4()
            .child(text(Variant::Body2, "This screen isn't built yet."))
    }
}

#[cfg(feature = "stories")]
pub fn stories() -> Vec<crate::stories::Story> {
    Vec::new()
}
