//! UA1: the admin area's frame: the page list (Dashboard, Users, Communities, Invites, Roles,
//! Storage, Settings; a page shows only when `InstanceAdminCaps` allows it), the open page beside
//! it, and on a phone a list that drills into a page with a back arrow. After
//! `components/admin/AdminLayout.tsx`.
//!
//! Frozen by the UI freeze: the public API below (`new`, the setters and `AdminShellEvent`) is what the app
//! wiring lane builds against while UA1 draws the screen; change it only with the coordinator.
//! Until UA1 lands, it draws a placeholder.

#![allow(dead_code)]

use crate::kit::{Variant, text};
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{AdminPage, InstanceAdminCaps};

#[derive(Debug, Clone, PartialEq)]
pub enum AdminShellEvent {
    /// A page in the list: the owner navigates to `Route::Admin { page }`.
    Open(AdminPage),
    /// The phone layout's back arrow, or "Back to the app".
    Back,
}

pub struct AdminShell {
    caps: InstanceAdminCaps,
    page: AdminPage,
    content: Option<AnyView>,
}

impl EventEmitter<AdminShellEvent> for AdminShell {}

impl AdminShell {
    pub fn new(_window: &mut Window, _cx: &mut Context<Self>) -> Self {
        Self {
            caps: InstanceAdminCaps::default(),
            page: AdminPage::Dashboard,
            content: None,
        }
    }

    /// What this user may do on the instance (`InstancePermissionsView::admin`).
    pub fn set_caps(&mut self, caps: InstanceAdminCaps, cx: &mut Context<Self>) {
        self.caps = caps;
        cx.notify();
    }

    /// The page shown (from the route).
    pub fn set_page(&mut self, page: AdminPage, cx: &mut Context<Self>) {
        self.page = page;
        cx.notify();
    }

    /// The open page's view, built by the owner.
    pub fn set_content(&mut self, content: Option<AnyView>, cx: &mut Context<Self>) {
        self.content = content;
        cx.notify();
    }
}

impl Render for AdminShell {
    fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .id("adminshell-placeholder")
            .p_4()
            .child(text(Variant::Body2, "This screen isn't built yet."))
    }
}

#[cfg(feature = "stories")]
pub fn stories() -> Vec<crate::stories::Story> {
    Vec::new()
}
