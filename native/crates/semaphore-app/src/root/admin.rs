//! WA: the instance admin area in the app: `Route::Admin { page }` shows `AdminShell` with the
//! page, each page fed from its core view and its events run as core commands, the account
//! menu's "Admin" entry (`InstanceAdminCaps::show_admin`), and the phone drill-in.
//!
//! Hub file from the UI freeze: `root.rs` calls the functions below once each (core events,
//! navigation, the route's content, overlays), and nothing else in the app does; WA
//! fills them. Copy the shape of `root/community.rs` (W5-app): one state struct here, feeds that
//! read core when they run, continuations that hold a ticket.

use super::AppRoot;
use gpui_kit::*;
use semaphore_core::CoreEvent;
use semaphore_ui::nav::Route;

/// WA's state: what it has on screen. Gone with the session.
#[derive(Default)]
pub struct AdminArea {}

impl AppRoot {
    pub(super) fn admin_on_core(&mut self, _event: &CoreEvent, _cx: &mut Context<Self>) {}

    pub(super) fn admin_navigated(
        &mut self,
        _route: &Route,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) {
    }

    /// The route's content when it's WA's; `None` otherwise.
    pub(super) fn admin_content(&self, _route: &Route, _cx: &App) -> Option<AnyElement> {
        None
    }

    pub(super) fn admin_overlays(&self, _cx: &mut Context<Self>) -> Vec<AnyElement> {
        Vec::new()
    }

    /// The account menu's "Admin" button, when this user holds any admin permission
    /// (`InstanceAdminCaps::show_admin`); it opens `Route::Admin { page: Dashboard }`.
    pub(super) fn admin_account_action(
        &self,
        _cx: &mut Context<Self>,
    ) -> Option<semaphore_ui::kit::Button> {
        None
    }
}
