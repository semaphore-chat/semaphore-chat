//! UA4: every community on the instance with its counts, search, paging and force delete, after
//! `pages/admin/AdminCommunitiesPage.tsx`.
//!
//! Frozen by the UI freeze: the public API below (`new`, the setters and `CommunitiesEvent`) is what the app
//! wiring lane builds against while UA4 draws the screen; change it only with the coordinator.
//! Until UA4 lands, it draws a placeholder.

#![allow(dead_code)]

use crate::kit::{Variant, text};
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{AdminCommunitiesView, AdminCommunityView, InstanceAdminCaps};

#[derive(Debug, Clone, PartialEq)]
pub enum CommunitiesEvent {
    /// The search changed: the owner reads `Core::admin_communities(search)`.
    Search(String),
    /// `Core::load_more_admin_communities(search)`.
    LoadMore,
    /// A row opened: the owner feeds `set_detail` from `Core::admin_community(id)`.
    Open { community_id: String },
    /// Confirmed: `Core::force_delete_community(id)`.
    ForceDelete { community_id: String },
    /// The read failed and the user asked again: `Core::retry_failed`.
    Retry,
}

pub struct CommunitiesPage {
    caps: InstanceAdminCaps,
    view: AdminCommunitiesView,
    detail: Option<AdminCommunityView>,
}

impl EventEmitter<CommunitiesEvent> for CommunitiesPage {}

impl CommunitiesPage {
    pub fn new(_window: &mut Window, _cx: &mut Context<Self>) -> Self {
        Self {
            caps: InstanceAdminCaps::default(),
            view: AdminCommunitiesView::default(),
            detail: None,
        }
    }

    /// What this user may do on the instance (`InstancePermissionsView::admin`).
    pub fn set_caps(&mut self, caps: InstanceAdminCaps, cx: &mut Context<Self>) {
        self.caps = caps;
        cx.notify();
    }

    /// `Core::admin_communities(search)`.
    pub fn set_view(&mut self, view: AdminCommunitiesView, cx: &mut Context<Self>) {
        self.view = view;
        cx.notify();
    }

    /// `Core::admin_community(id)` for the open row.
    pub fn set_detail(&mut self, detail: Option<AdminCommunityView>, cx: &mut Context<Self>) {
        self.detail = detail;
        cx.notify();
    }
}

impl Render for CommunitiesPage {
    fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .id("communitiespage-placeholder")
            .p_4()
            .child(text(Variant::Body2, "This screen isn't built yet."))
    }
}

#[cfg(feature = "stories")]
pub fn stories() -> Vec<crate::stories::Story> {
    Vec::new()
}
