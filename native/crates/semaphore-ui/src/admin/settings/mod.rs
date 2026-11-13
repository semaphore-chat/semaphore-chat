//! UA1: instance settings (name, description, registration mode, default quota, max file size),
//! after `pages/admin/AdminSettingsPage.tsx`.
//!
//! Frozen by the UI freeze: the public API below (`new`, the setters and `InstanceSettingsEvent`) is what the app
//! wiring lane builds against while UA1 draws the screen; change it only with the coordinator.
//! Until UA1 lands, it draws a placeholder.

#![allow(dead_code)]

use crate::kit::{Variant, text};
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{InstanceAdminCaps, InstanceSettingsPatch, InstanceSettingsView};

#[derive(Debug, Clone, PartialEq)]
pub enum InstanceSettingsEvent {
    /// "Save": `Core::update_instance_settings(patch)`; the form waits on its op.
    Save(InstanceSettingsPatch),
    /// The read failed and the user asked again: `Core::retry_failed`.
    Retry,
}

pub struct InstanceSettingsPage {
    caps: InstanceAdminCaps,
    view: InstanceSettingsView,
}

impl EventEmitter<InstanceSettingsEvent> for InstanceSettingsPage {}

impl InstanceSettingsPage {
    pub fn new(_window: &mut Window, _cx: &mut Context<Self>) -> Self {
        Self {
            caps: InstanceAdminCaps::default(),
            view: InstanceSettingsView::default(),
        }
    }

    /// What this user may do on the instance (`InstancePermissionsView::admin`).
    pub fn set_caps(&mut self, caps: InstanceAdminCaps, cx: &mut Context<Self>) {
        self.caps = caps;
        cx.notify();
    }

    /// `Core::instance_settings()`.
    pub fn set_view(&mut self, view: InstanceSettingsView, cx: &mut Context<Self>) {
        self.view = view;
        cx.notify();
    }
}

impl Render for InstanceSettingsPage {
    fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .id("instancesettingspage-placeholder")
            .p_4()
            .child(text(Variant::Body2, "This screen isn't built yet."))
    }
}

#[cfg(feature = "stories")]
pub fn stories() -> Vec<crate::stories::Story> {
    Vec::new()
}
