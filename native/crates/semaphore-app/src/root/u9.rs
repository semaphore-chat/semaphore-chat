//! WU: the remaining routes and small flows: the connect screen's "set it up in a browser", the
//! register form's requirements, joining an invite with an existing account, the notifications
//! page, `/friends`, `/profile`, `/community/create`, a channel's search route and its paging,
//! a DM group's "Add people" and "Leave", the shortcut sheet and the web's global shortcuts.
//!
//! Hub file from the UI freeze: `root.rs` calls the functions below once each (core events,
//! navigation, the route's content, overlays, and the auth and DM header events below), and nothing else in the app does; WU
//! fills them. Copy the shape of `root/community.rs` (W5-app): one state struct here, feeds that
//! read core when they run, continuations that hold a ticket.

use super::AppRoot;
use gpui_kit::*;
use semaphore_core::CoreEvent;
use semaphore_ui::nav::Route;

/// WU's state: what it has on screen. Gone with the session.
#[derive(Default)]
pub struct U9Area {}

impl AppRoot {
    pub(super) fn u9_on_core(&mut self, _event: &CoreEvent, _cx: &mut Context<Self>) {}

    pub(super) fn u9_navigated(
        &mut self,
        _route: &Route,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) {
    }

    /// The route's content when it's WU's; `None` otherwise.
    pub(super) fn u9_content(&self, _route: &Route, _cx: &App) -> Option<AnyElement> {
        None
    }

    pub(super) fn u9_overlays(&self, _cx: &mut Context<Self>) -> Vec<AnyElement> {
        Vec::new()
    }

    /// `AuthEvent::OpenInBrowser`: open `url` with the system's link handler.
    pub(super) fn u9_open_in_browser(&mut self, _url: String, _cx: &mut Context<Self>) {}

    /// `DmHeaderEvent::AddPeople` and `DmHeaderEvent::Leave`.
    pub(super) fn u9_dm_header(
        &mut self,
        _event: &semaphore_ui::dms::DmHeaderEvent,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) {
    }

    /// `InviteEvent::Accept` on the invite page: `true` when it was handled (signed in: joined with
    /// this account through `Core::accept_invite` and `InviteScreen::set_join`), `false` to keep the
    /// signed-out path (register with the code).
    pub(super) fn u9_accept_invite(
        &mut self,
        _screen: &Entity<semaphore_ui::auth::InviteScreen>,
        _code: &str,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) -> bool {
        false
    }

    /// The open DM's header was given its state: offer the group actions
    /// (`DmHeader::set_group_actions`) when it's a group.
    pub(super) fn u9_dm_header_updated(
        &mut self,
        _header: &Entity<semaphore_ui::dms::DmHeader>,
        _dm_group_id: &str,
        _cx: &mut Context<Self>,
    ) {
    }
}
