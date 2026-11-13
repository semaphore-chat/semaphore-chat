//! UA4: instance invites: the list, creating one for some communities (uses, expiry), copying its
//! link and deleting it, after `pages/AdminInvitePage.tsx`.
//!
//! Frozen by the UI freeze: the public API below (`new`, the setters and `InstanceInvitesEvent`) is what the app
//! wiring lane builds against while UA4 draws the screen; change it only with the coordinator.
//! Until UA4 lands, it draws a placeholder.

#![allow(dead_code)]

use crate::kit::{Variant, text};
use crate::messages::TimeFormat;
use crate::panel::PanelClock;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{
    AdminInvitesView, CommunityRow, InstanceAdminCaps, InstanceInviteDraft,
};

#[derive(Debug, Clone, PartialEq)]
pub enum InstanceInvitesEvent {
    /// "Create": `Core::create_instance_invite(draft)`.
    Create(InstanceInviteDraft),
    /// Confirmed: `Core::delete_instance_invite(code)`.
    Delete { code: String },
    /// "Copy link": the owner writes `url` to the clipboard.
    CopyLink { url: String },
    /// The read failed and the user asked again: `Core::retry_failed`.
    Retry,
}

pub struct InstanceInvitesPage {
    caps: InstanceAdminCaps,
    view: AdminInvitesView,
    communities: Vec<CommunityRow>,
    link_base: String,
    clock: PanelClock,
    time: TimeFormat,
}

impl EventEmitter<InstanceInvitesEvent> for InstanceInvitesPage {}

impl InstanceInvitesPage {
    pub fn new(_window: &mut Window, _cx: &mut Context<Self>) -> Self {
        Self {
            caps: InstanceAdminCaps::default(),
            view: AdminInvitesView::default(),
            communities: Vec::new(),
            link_base: String::new(),
            clock: PanelClock::default(),
            time: TimeFormat::default(),
        }
    }

    /// What this user may do on the instance (`InstancePermissionsView::admin`).
    pub fn set_caps(&mut self, caps: InstanceAdminCaps, cx: &mut Context<Self>) {
        self.caps = caps;
        cx.notify();
    }

    /// `Core::admin_invites()`.
    pub fn set_view(&mut self, view: AdminInvitesView, cx: &mut Context<Self>) {
        self.view = view;
        cx.notify();
    }

    /// The communities an invite can add people to (`Core::communities()`).
    pub fn set_communities(&mut self, communities: Vec<CommunityRow>, cx: &mut Context<Self>) {
        self.communities = communities;
        cx.notify();
    }

    /// The server the links point at: `https://chat.example.com`.
    pub fn set_link_base(&mut self, link_base: String, cx: &mut Context<Self>) {
        self.link_base = link_base;
        cx.notify();
    }

    /// What expiry is measured from.
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

impl Render for InstanceInvitesPage {
    fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .id("instanceinvitespage-placeholder")
            .p_4()
            .child(text(Variant::Body2, "This screen isn't built yet."))
    }
}

#[cfg(feature = "stories")]
pub fn stories() -> Vec<crate::stories::Story> {
    Vec::new()
}
