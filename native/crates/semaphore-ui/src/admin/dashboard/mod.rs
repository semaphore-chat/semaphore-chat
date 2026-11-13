//! UA2: the admin dashboard: stats tiles, server health and the attention items, after
//! `pages/admin/AdminDashboard.tsx` and `adminAttention.ts`.
//!
//! Frozen by the UI freeze: the public API below (`new`, the setters and `DashboardEvent`) is what the app
//! wiring lane builds against while UA2 draws the screen; change it only with the coordinator.
//! Until UA2 lands, it draws a placeholder.

#![allow(dead_code)]

use crate::kit::{Variant, text};
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{AdminDashboardView, AdminPage, InstanceAdminCaps};

#[derive(Debug, Clone, PartialEq)]
pub enum DashboardEvent {
    /// An attention item's action or a tile: open an admin page (Storage with its filter).
    Open {
        page: AdminPage,
        storage_min_percent: Option<u32>,
    },
    /// The LiveKit item's "Setup guide": open the URL in the browser.
    OpenUrl(String),
    /// The read failed and the user asked again: `Core::retry_failed`.
    Retry,
}

pub struct DashboardPage {
    caps: InstanceAdminCaps,
    view: AdminDashboardView,
}

impl EventEmitter<DashboardEvent> for DashboardPage {}

impl DashboardPage {
    pub fn new(_window: &mut Window, _cx: &mut Context<Self>) -> Self {
        Self {
            caps: InstanceAdminCaps::default(),
            view: AdminDashboardView::default(),
        }
    }

    /// What this user may do on the instance (`InstancePermissionsView::admin`).
    pub fn set_caps(&mut self, caps: InstanceAdminCaps, cx: &mut Context<Self>) {
        self.caps = caps;
        cx.notify();
    }

    /// `Core::admin_dashboard()`.
    pub fn set_view(&mut self, view: AdminDashboardView, cx: &mut Context<Self>) {
        self.view = view;
        cx.notify();
    }
}

impl Render for DashboardPage {
    fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .id("dashboardpage-placeholder")
            .p_4()
            .child(text(Variant::Body2, "This screen isn't built yet."))
    }
}

#[cfg(feature = "stories")]
pub fn stories() -> Vec<crate::stories::Story> {
    Vec::new()
}
