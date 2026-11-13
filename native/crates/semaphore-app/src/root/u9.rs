//! WU: the remaining routes and small flows: the connect screen's "set it up in a browser", the
//! register form's requirements, joining an invite with an existing account, the notifications
//! page, `/friends`, `/profile`, `/community/create`, a channel's search route and its paging,
//! a DM group's "Add people" and "Leave", the shortcut sheet and the web's global shortcuts.
//!
//! - **Pages are per route.** `/notifications` and `/friends` build their screen when the route
//!   opens and drop it when it leaves, so nothing here reads core while it isn't on screen. Each
//!   is fed from core on its `ViewChanged`; the notification rows' actions are the centre's
//!   (`AppRoot::run_notification_event`).
//! - **Routes that are somewhere else.** `/profile` is this user's profile page, `/community/create`
//!   is Home with the form over it, and a channel's search route is that channel with its search
//!   panel open (once the pane shows the channel, so the panel searches the right conversation).
//!   `/friends` is its own page, as the web's `FriendsPage` is: the DM sidebar's Friends tab has
//!   no public way in from here (`DmSidebar::set_tab` is, but the sidebar entity is the inbox's).
//! - **The connect notice and the register modes** are read from what the last probe said in core
//!   (`Core::server_info`) and from `Core::register_requirements`, and applied to the auth screen
//!   on each core event. Both setters are idempotent. The probe announces `ViewChanged
//!   { Session }` itself when its answer changes something, so the screen takes the answer of the
//!   event that announced it; it reads core rather than the app's own copy, which the probe's
//!   reply callback fills in a moment later.
//! - **The shortcut sheet** is rebuilt each time it opens: it takes the focus on its first draw,
//!   which is what closes it on Escape.
//! - **The web's global shortcuts** are key bindings onto actions this file answers: Alt+Up/Down
//!   walk the sidebar's channels or conversations as the web's `findNavTarget` does, Alt+Shift the
//!   unread ones, and Mod+/ (Ctrl+/) shows the sheet. Escape is the pane's, bound in the pane's own
//!   key context: it closes the side panel or marks the conversation read, after every dialog,
//!   menu, the search field, the composer and the message list have had their say.
//!
//! Signing out drops everything here: the pages, the dialogs and the sheet belong to a session.

use super::AppRoot;
use crate::conversation::EscapePane;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{ChannelKind, DmRow, ErrorView, SessionState, ViewKey};
use semaphore_core::{Core, CoreEvent};
use semaphore_ui::auth::{InviteJoinState, InviteScreen};
use semaphore_ui::dms::picker::{SEARCH_LIMIT, UserPicker, UserPickerEvent};
use semaphore_ui::dms::{DmHeader, DmHeaderEvent};
use semaphore_ui::friends::{
    AddFriendDialog, AddFriendDialogEvent, AddFriendEvent, AddOutcome, FriendsEvent, FriendsPanel,
};
use semaphore_ui::kit::{Alert, Button, Dialog, Paper, Severity, spacing};
use semaphore_ui::nav::Route;
use semaphore_ui::notifications::page::{NotificationsPage, NotificationsPageEvent};
use semaphore_ui::shortcuts::{ShortcutSheet, ShortcutSheetEvent};
use semaphore_ui::theme::SemTheme as _;

actions!(
    u9,
    [
        PrevChannel,
        NextChannel,
        PrevUnread,
        NextUnread,
        ToggleShortcutSheet
    ]
);

/// `FRIENDS_LIST_MAX_WIDTH`: the friends page's column, as the web caps it.
const FRIENDS_WIDTH: f32 = 720.;

/// One global shortcut the keymap can ask for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Shortcut {
    PrevChannel,
    NextChannel,
    PrevUnread,
    NextUnread,
    Sheet,
}

/// A route's screen, and the subscription that carries its events to the app.
struct Page<V: 'static> {
    view: Entity<V>,
    _subscription: Subscription,
}

/// A group's "Add people": the DM it adds to, and the user search offered for it.
struct AddPeople {
    dm_id: String,
    picker: Entity<UserPicker>,
    busy: bool,
    failed: Option<String>,
    _subscription: Subscription,
}

/// What opening a route asks of the app.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Plan {
    /// Not ours, or already where it belongs.
    Ignore,
    Notifications,
    Friends,
    /// `/profile`: this user's own profile page.
    OwnProfile,
    /// `/community/create`: Home, with the form over it.
    CreateCommunity,
    /// A channel's search route: the channel, with its search panel open.
    ChannelSearch,
}

/// WU's state: what it has on screen. Gone with the session.
#[derive(Default)]
pub struct U9Area {
    notifications: Option<Page<NotificationsPage>>,
    friends: Option<Page<FriendsPanel>>,
    /// The friends page's "Add Friend".
    add_friend: Option<Page<AddFriendDialog>>,
    add_people: Option<AddPeople>,
    sheet: Option<Page<ShortcutSheet>>,
    /// The window's key bindings and global action handlers are registered once.
    keys: bool,
    /// A channel's search route is open: its panel opens after the frame that draws the channel.
    search_pending: std::cell::Cell<bool>,
    /// The pane's search panel is this route's: leaving the route closes it.
    search_open: bool,
}

/// One row of the list the navigation shortcuts walk.
#[derive(Debug, Clone, PartialEq, Eq)]
struct NavItem {
    id: String,
    unread: bool,
}

impl AppRoot {
    pub(super) fn u9_on_core(&mut self, event: &CoreEvent, cx: &mut Context<Self>) {
        self.u9_bind_shortcuts(cx);
        self.u9_sync_auth(cx);
        match event {
            CoreEvent::ViewChanged {
                view: ViewKey::Session,
            } => {
                if !self.u9_signed_in() {
                    self.u9_forget(cx);
                }
            }
            CoreEvent::ViewChanged {
                view: ViewKey::Notifications,
            } => self.u9_feed_notifications(cx),
            CoreEvent::ViewChanged {
                view: ViewKey::Friends,
            } => self.u9_feed_friends(cx),
            _ => {}
        }
    }

    pub(super) fn u9_navigated(
        &mut self,
        route: &Route,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.u9_bind_shortcuts(cx);
        // A channel's search route, and only it, has the pane's search panel open.
        if u9_plan(route) == Plan::ChannelSearch {
            self.u9.search_pending.set(true);
        } else if self.u9.search_open {
            self.u9.search_open = false;
            if let Some(pane) = self.pane.clone()
                && pane.read(cx).side_panel_kind() == "search"
            {
                pane.update(cx, |pane, cx| pane.close_side(cx));
            }
        }
        // A page lives while its route is open.
        if u9_plan(route) != Plan::Notifications {
            self.u9.notifications = None;
        }
        if u9_plan(route) != Plan::Friends {
            self.u9.friends = None;
            self.u9.add_friend = None;
        }
        match u9_plan(route) {
            Plan::Ignore => {}
            Plan::Notifications => self.u9_open_notifications(window, cx),
            Plan::Friends => self.u9_open_friends(window, cx),
            Plan::OwnProfile => {
                if let Some(me) = self.u9_me() {
                    self.shell_navigate(Route::Profile { user_id: me }, cx);
                }
            }
            Plan::CreateCommunity => {
                // The form is a card over Home, as the web's page over the community list.
                self.shell_navigate(Route::Home, cx);
                self.open_create_community(window, cx);
            }
            Plan::ChannelSearch => {}
        }
    }

    /// A channel's search route: the pane's search panel, unless it is already what the panel
    /// shows.
    fn u9_open_search(
        &mut self,
        pane: Option<Entity<crate::conversation::ConversationPane>>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(pane) = pane else {
            return;
        };
        if !matches!(self.u9_route(cx), Some(Route::ChannelSearch { .. })) {
            return;
        }
        if pane.read(cx).side_panel_kind() != "search" {
            pane.update(cx, |pane, cx| pane.toggle_search(window, cx));
        }
        self.u9.search_open = true;
    }

    /// The route's content when it's WU's; `None` otherwise.
    pub(super) fn u9_content(&self, route: &Route, cx: &App) -> Option<AnyElement> {
        match route {
            Route::Notifications => self
                .u9
                .notifications
                .as_ref()
                .map(|page| page.view.clone().into_any_element()),
            Route::Friends => self.u9.friends.as_ref().map(|page| {
                // The web's page is the panel in a card, at `FRIENDS_LIST_MAX_WIDTH`.
                div()
                    .size_full()
                    .flex()
                    .flex_col()
                    .items_center()
                    .bg(cx.sem().background_default)
                    .child(
                        Paper::new()
                            .radius(8.)
                            .overflow_hidden()
                            .w_full()
                            .max_w(px(FRIENDS_WIDTH))
                            .h_full()
                            .child(page.view.clone()),
                    )
                    .into_any_element()
            }),
            _ => None,
        }
    }

    pub(super) fn u9_overlays(&self, cx: &mut Context<Self>) -> Vec<AnyElement> {
        // Registered during the draw, so it runs once this frame is done: the frame that shows
        // the channel has given the composer the focus by then, and the panel keeps the caret.
        if self.u9.search_pending.replace(false) {
            let root = cx.entity().downgrade();
            let pane = self.pane.clone();
            cx.defer(move |cx| {
                let Some(window) = cx.active_window() else {
                    return;
                };
                window
                    .update(cx, |_, window, cx| {
                        root.update(cx, |root, cx| root.u9_open_search(pane, window, cx))
                            .ok();
                    })
                    .ok();
            });
        }
        let mut overlays: Vec<AnyElement> = Vec::new();
        if let Some(sheet) = &self.u9.sheet {
            overlays.push(sheet.view.clone().into_any_element());
        }
        if let Some(add) = &self.u9.add_people {
            overlays.push(add_people_dialog(add, cx));
        }
        if let Some(dialog) = &self.u9.add_friend {
            overlays.push(dialog.view.clone().into_any_element());
        }
        overlays
    }

    /// `AuthEvent::OpenInBrowser`: open `url` with the system's link handler.
    pub(super) fn u9_open_in_browser(&mut self, url: String, cx: &mut Context<Self>) {
        crate::open_url(&url, cx);
    }

    /// `DmHeaderEvent::AddPeople` and `DmHeaderEvent::Leave`.
    pub(super) fn u9_dm_header(
        &mut self,
        event: &DmHeaderEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(dm_id) = self.u9_open_dm(cx) else {
            return;
        };
        match event {
            DmHeaderEvent::AddPeople => self.u9_open_add_people(dm_id, window, cx),
            DmHeaderEvent::Leave => self.u9_leave_group(dm_id, window, cx),
            _ => {}
        }
    }

    /// `InviteEvent::Accept` on the invite page: `true` when it was handled (signed in: joined with
    /// this account through `Core::accept_invite` and `InviteScreen::set_join`), `false` to keep the
    /// signed-out path (register with the code).
    pub(super) fn u9_accept_invite(
        &mut self,
        screen: &Entity<InviteScreen>,
        code: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        let (Some(core), Some(exec)) = (
            self.core(),
            self.services.as_ref().map(|services| services.exec.clone()),
        ) else {
            return false;
        };
        if !matches!(core.session(), SessionState::SignedIn { .. }) {
            return false;
        }
        screen.update(cx, |screen, cx| {
            screen.set_join(InviteJoinState::Joining, cx)
        });
        let code = code.to_owned();
        let screen = screen.clone();
        exec.run(
            window,
            cx,
            async move { core.accept_invite(code).await },
            move |_, result, _, cx| {
                let join = match result {
                    Ok(join) => InviteJoinState::Joined(join),
                    Err(error) => InviteJoinState::Failed(error.to_string()),
                };
                screen.update(cx, |screen, cx| screen.set_join(join, cx));
            },
        );
        true
    }

    /// The open DM's header was given its state: offer the group actions
    /// (`DmHeader::set_group_actions`) when it's a group.
    pub(super) fn u9_dm_header_updated(
        &mut self,
        header: &Entity<DmHeader>,
        dm_group_id: &str,
        cx: &mut Context<Self>,
    ) {
        let Some(core) = self.core() else {
            return;
        };
        let row = core.dm(dm_group_id.to_owned());
        let group = u9_is_group(row.as_ref());
        header.update(cx, |header, cx| header.set_group_actions(group, cx));
    }

    // ---- The auth screen. ----

    /// The connect screen's notice and what the sign-in card offers for registering, from what the
    /// last probe said and from core. Both are idempotent: the screen keeps the last answer. The
    /// probe's answer is core's, not the app's copy: its `ViewChanged { Session }` arrives before
    /// the probe's reply callback runs, so the app's copy can still be the one before it.
    fn u9_sync_auth(&mut self, cx: &mut Context<Self>) {
        let Some(auth) = self.auth.clone() else {
            return;
        };
        let core = self.core();
        let notice = core
            .as_ref()
            .and_then(|core| core.server_info())
            .filter(|info| info.needs_setup)
            .map(|info| info.url.clone());
        let requirements = core.map(|core| core.register_requirements());
        auth.update(cx, |auth, cx| {
            auth.set_setup_needed(notice, cx);
            if let Some(requirements) = requirements {
                auth.set_register_requirements(requirements, cx);
            }
        });
    }

    // ---- Routes to other areas. ----

    fn u9_signed_in(&self) -> bool {
        self.core()
            .is_some_and(|core| matches!(core.session(), SessionState::SignedIn { .. }))
    }

    /// This user's id, while signed in.
    fn u9_me(&self) -> Option<String> {
        match self.core()?.session() {
            SessionState::SignedIn { me } => Some(me.id),
            _ => None,
        }
    }

    /// The route on screen.
    fn u9_route(&self, cx: &App) -> Option<Route> {
        self.shell
            .as_ref()
            .map(|shell| shell.read(cx).nav().current().clone())
    }

    /// The open DM, from the route.
    fn u9_open_dm(&self, cx: &App) -> Option<String> {
        match self.u9_route(cx)? {
            Route::DirectMessage { dm_group_id } => Some(dm_group_id),
            _ => None,
        }
    }

    // ---- `/notifications`. ----

    fn u9_open_notifications(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.u9.notifications.is_none() {
            let time = self.config.time;
            let page = cx.new(|cx| {
                let mut page = NotificationsPage::new(window, cx);
                page.set_clock(time.now, cx);
                page.set_time(time, cx);
                page
            });
            let subscription = cx.subscribe_in(&page, window, Self::u9_on_notifications);
            self.u9.notifications = Some(Page {
                view: page,
                _subscription: subscription,
            });
        }
        self.u9_feed_notifications(cx);
    }

    fn u9_feed_notifications(&mut self, cx: &mut Context<Self>) {
        let (Some(core), Some(page)) = (
            self.core(),
            self.u9.notifications.as_ref().map(|page| page.view.clone()),
        ) else {
            return;
        };
        let list = core.notifications();
        page.update(cx, |page, cx| page.set_list(list, cx));
    }

    fn u9_on_notifications(
        &mut self,
        _: &Entity<NotificationsPage>,
        event: &NotificationsPageEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let NotificationsPageEvent::Notification(event) = event;
        self.run_notification_event(event, window, cx);
    }

    // ---- `/friends`. ----

    fn u9_open_friends(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.u9.friends.is_none() {
            let time = self.config.time;
            let panel = cx.new(FriendsPanel::new);
            panel.update(cx, |panel, cx| {
                panel.set_clock(time.now, cx);
                panel.set_time(time, cx);
            });
            let subscription = cx.subscribe_in(&panel, window, Self::u9_on_friends);
            self.u9.friends = Some(Page {
                view: panel,
                _subscription: subscription,
            });
        }
        self.u9_feed_friends(cx);
    }

    fn u9_feed_friends(&mut self, cx: &mut Context<Self>) {
        let (Some(core), Some(page)) = (
            self.core(),
            self.u9.friends.as_ref().map(|page| page.view.clone()),
        ) else {
            return;
        };
        let view = core.friends();
        page.update(cx, |panel, cx| panel.set_view(view, cx));
    }

    fn u9_on_friends(
        &mut self,
        _: &Entity<FriendsPanel>,
        event: &FriendsEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let (Some(core), Some(exec)) = (
            self.core(),
            self.services.as_ref().map(|services| services.exec.clone()),
        ) else {
            return;
        };
        match event.clone() {
            FriendsEvent::Message { user_id } => exec.run(
                window,
                cx,
                async move { core.create_dm(vec![user_id], None).await },
                |this, result, _, cx| match result {
                    Ok(dm_id) => {
                        this.shell_navigate(Route::DirectMessage { dm_group_id: dm_id }, cx)
                    }
                    Err(error) => log::warn!("opening the DM failed: {error}"),
                },
            ),
            FriendsEvent::Accept { friendship_id } => exec.fire(async move {
                log_failure(
                    "accepting a friend request",
                    core.accept_friend_request(friendship_id).await,
                )
            }),
            FriendsEvent::Decline { friendship_id } => exec.fire(async move {
                log_failure(
                    "declining a friend request",
                    core.decline_friend_request(friendship_id).await,
                )
            }),
            FriendsEvent::Cancel { friendship_id } => exec.fire(async move {
                log_failure(
                    "cancelling a friend request",
                    core.cancel_friend_request(friendship_id).await,
                )
            }),
            FriendsEvent::Remove { friendship_id } => exec.fire(async move {
                log_failure("removing a friend", core.remove_friend(friendship_id).await)
            }),
            FriendsEvent::AddFriend => self.u9_open_add_friend(window, cx),
            FriendsEvent::OpenProfile { user_id } => self.open_profile(user_id, window, cx),
            FriendsEvent::Retry => core.retry_failed(),
        }
    }

    fn u9_open_add_friend(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(core) = self.core() else {
            return;
        };
        let dialog = cx.new(|cx| AddFriendDialog::new(window, cx));
        let form = dialog.read(cx).form().clone();
        let excluded: Vec<String> = self.u9_me().into_iter().collect();
        let friends = core.friends();
        form.update(cx, |form, cx| {
            form.set_friends(&friends, cx);
            form.set_excluded(excluded, cx);
            form.focus_field(window, cx);
        });
        self.u9.add_friend = Some(Page {
            view: dialog.clone(),
            _subscription: cx.subscribe_in(&dialog, window, Self::u9_on_add_friend),
        });
        cx.notify();
    }

    fn u9_on_add_friend(
        &mut self,
        dialog: &Entity<AddFriendDialog>,
        event: &AddFriendDialogEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let (Some(core), Some(exec)) = (
            self.core(),
            self.services.as_ref().map(|services| services.exec.clone()),
        ) else {
            return;
        };
        let form = dialog.read(cx).form().clone();
        match event.clone() {
            AddFriendDialogEvent::Form(AddFriendEvent::Search { query }) => {
                let asked = query.clone();
                exec.run(
                    window,
                    cx,
                    async move { core.search_users(query, Some(SEARCH_LIMIT)).await },
                    move |_, result, _, cx| {
                        form.update(cx, |form, cx| {
                            form.set_results(&asked, result.map_err(|error| error.to_string()), cx)
                        });
                    },
                );
            }
            AddFriendDialogEvent::Form(AddFriendEvent::Send { user_id }) => {
                form.update(cx, |form, cx| {
                    form.set_outcome(AddOutcome::Sending, window, cx)
                });
                exec.run(
                    window,
                    cx,
                    async move { core.send_friend_request(user_id).await },
                    move |_, result, window, cx| {
                        let outcome = match result {
                            Ok(()) => AddOutcome::Sent,
                            Err(error) => AddOutcome::Failed(error_view(&error)),
                        };
                        form.update(cx, |form, cx| form.set_outcome(outcome, window, cx));
                    },
                );
            }
            AddFriendDialogEvent::Close => {
                self.u9.add_friend = None;
                cx.notify();
            }
        }
    }

    // ---- A DM group: "Add people" and "Leave group". ----

    fn u9_open_add_people(&mut self, dm_id: String, window: &mut Window, cx: &mut Context<Self>) {
        let Some(core) = self.core() else {
            return;
        };
        let picker = cx.new(|cx| UserPicker::new("add-people", "People", true, window, cx));
        // The people already in it, and this user, are not offered again.
        let mut excluded: Vec<String> = core
            .dm(dm_id.clone())
            .map(|row| row.members.iter().map(|user| user.id.clone()).collect())
            .unwrap_or_default();
        excluded.extend(self.u9_me());
        picker.update(cx, |picker, cx| {
            picker.set_excluded(excluded, cx);
            picker.focus_field(window, cx);
        });
        self.u9.add_people = Some(AddPeople {
            dm_id,
            picker: picker.clone(),
            busy: false,
            failed: None,
            _subscription: cx.subscribe_in(&picker, window, Self::u9_on_add_people),
        });
        cx.notify();
    }

    fn u9_on_add_people(
        &mut self,
        picker: &Entity<UserPicker>,
        event: &UserPickerEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let (Some(core), Some(exec)) = (
            self.core(),
            self.services.as_ref().map(|services| services.exec.clone()),
        ) else {
            return;
        };
        let UserPickerEvent::Search { query } = event.clone() else {
            return;
        };
        let asked = query.clone();
        let picker = picker.clone();
        exec.run(
            window,
            cx,
            async move { core.search_users(query, Some(SEARCH_LIMIT)).await },
            move |_, result, _, cx| {
                picker.update(cx, |picker, cx| {
                    picker.set_results(&asked, result.map_err(|error| error.to_string()), cx)
                });
            },
        );
    }

    /// "Add": the people picked join the group, and the dialog closes when the server agrees.
    fn u9_add_people(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let (Some(core), Some(exec)) = (
            self.core(),
            self.services.as_ref().map(|services| services.exec.clone()),
        ) else {
            return;
        };
        let Some(add) = &mut self.u9.add_people else {
            return;
        };
        let ids: Vec<String> = add
            .picker
            .read(cx)
            .picked()
            .iter()
            .map(|user| user.id.clone())
            .collect();
        if ids.is_empty() {
            return;
        }
        let dm_id = add.dm_id.clone();
        add.busy = true;
        add.failed = None;
        exec.run(
            window,
            cx,
            async move { core.add_dm_members(dm_id, ids).await },
            |this, result, _, cx| {
                match result {
                    Ok(()) => this.u9.add_people = None,
                    Err(error) => {
                        if let Some(add) = &mut this.u9.add_people {
                            add.busy = false;
                            add.failed = Some(error.to_string());
                        }
                    }
                }
                cx.notify();
            },
        );
    }

    fn u9_leave_group(&mut self, dm_id: String, window: &mut Window, cx: &mut Context<Self>) {
        let (Some(core), Some(exec)) = (
            self.core(),
            self.services.as_ref().map(|services| services.exec.clone()),
        ) else {
            return;
        };
        exec.run(
            window,
            cx,
            async move { core.leave_dm(dm_id).await },
            |this, result, _, cx| match result {
                Ok(()) => this.shell_navigate(Route::DirectMessages, cx),
                Err(error) => log::warn!("leaving the group: {error}"),
            },
        );
    }

    // ---- Shortcuts. ----

    /// Binds the web's global shortcuts and their handlers, once for the run.
    fn u9_bind_shortcuts(&mut self, cx: &mut Context<Self>) {
        if self.u9.keys {
            return;
        }
        self.u9.keys = true;
        let root = cx.entity().downgrade();
        cx.bind_keys([
            KeyBinding::new("alt-up", PrevChannel, None),
            KeyBinding::new("alt-down", NextChannel, None),
            KeyBinding::new("alt-shift-up", PrevUnread, None),
            KeyBinding::new("alt-shift-down", NextUnread, None),
            // Mod is Ctrl here, as `ShortcutKey::Mod` says; Shift as well, since some layouts
            // need it to type "/".
            KeyBinding::new("ctrl-/", ToggleShortcutSheet, None),
            KeyBinding::new("ctrl-shift-/", ToggleShortcutSheet, None),
            // Escape belongs to the pane, in the context its root carries
            // (`ConversationPane`, `conversation.rs`), never to a context-free binding: one of
            // those outranks every focused view's own, so the dialogs', the menus', the search
            // field's, the composer's and the message list's Escape would stop working. Inside
            // the pane the deepest context takes the key first and the event only travels
            // outward while it is still propagating, so the pane's Escape runs after all of
            // those: it closes the side panel, or marks the conversation read.
            KeyBinding::new("escape", EscapePane, Some("ConversationPane")),
        ]);
        let listener = root.clone();
        gpui_kit::App::on_action::<PrevChannel>(cx, move |_: &PrevChannel, cx| {
            u9_dispatch(cx, &listener, Shortcut::PrevChannel)
        });
        let listener = root.clone();
        gpui_kit::App::on_action::<NextChannel>(cx, move |_: &NextChannel, cx| {
            u9_dispatch(cx, &listener, Shortcut::NextChannel)
        });
        let listener = root.clone();
        gpui_kit::App::on_action::<PrevUnread>(cx, move |_: &PrevUnread, cx| {
            u9_dispatch(cx, &listener, Shortcut::PrevUnread)
        });
        let listener = root.clone();
        gpui_kit::App::on_action::<NextUnread>(cx, move |_: &NextUnread, cx| {
            u9_dispatch(cx, &listener, Shortcut::NextUnread)
        });
        gpui_kit::App::on_action::<ToggleShortcutSheet>(cx, move |_: &ToggleShortcutSheet, cx| {
            u9_dispatch(cx, &root, Shortcut::Sheet)
        });
    }

    fn u9_run_shortcut(&mut self, shortcut: Shortcut, window: &mut Window, cx: &mut Context<Self>) {
        match shortcut {
            Shortcut::PrevChannel => self.u9_step(-1, false, cx),
            Shortcut::NextChannel => self.u9_step(1, false, cx),
            Shortcut::PrevUnread => self.u9_step(-1, true, cx),
            Shortcut::NextUnread => self.u9_step(1, true, cx),
            Shortcut::Sheet => self.u9_toggle_sheet(window, cx),
        }
    }

    /// Walks the sidebar's channels (in a community) or conversations (in the DM area), as the
    /// web's `findNavTarget` does: `direction` places, wrapping, skipping what is read when
    /// `unread_only`, and nothing when that lands on the conversation on screen.
    fn u9_step(&mut self, direction: i32, unread_only: bool, cx: &mut Context<Self>) {
        let Some(core) = self.core() else {
            return;
        };
        let Some(route) = self.u9_route(cx) else {
            return;
        };
        let (items, current) = u9_nav_items(&core, &route);
        let Some(target) = u9_step_target(&items, current.as_deref(), direction, unread_only)
        else {
            return;
        };
        let target = target.to_owned();
        match &route {
            Route::Channel { community_id, .. } | Route::ChannelSearch { community_id, .. } => self
                .shell_navigate(
                    Route::Channel {
                        community_id: community_id.clone(),
                        channel_id: target,
                    },
                    cx,
                ),
            Route::DirectMessages | Route::DirectMessage { .. } => self.shell_navigate(
                Route::DirectMessage {
                    dm_group_id: target,
                },
                cx,
            ),
            _ => {}
        }
    }

    fn u9_toggle_sheet(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.u9.sheet.is_some() {
            self.u9.sheet = None;
            cx.notify();
            return;
        }
        let sheet = cx.new(|cx| ShortcutSheet::new(window, cx));
        let subscription = cx.subscribe_in(&sheet, window, Self::u9_on_sheet);
        self.u9.sheet = Some(Page {
            view: sheet,
            _subscription: subscription,
        });
        cx.notify();
    }

    fn u9_on_sheet(
        &mut self,
        _: &Entity<ShortcutSheet>,
        _: &ShortcutSheetEvent,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.u9.sheet = None;
        cx.notify();
    }

    /// Signing out: nothing of this session's stays here.
    fn u9_forget(&mut self, cx: &mut Context<Self>) {
        self.u9.notifications = None;
        self.u9.friends = None;
        self.u9.add_friend = None;
        self.u9.add_people = None;
        self.u9.sheet = None;
        cx.notify();
    }
}

/// Runs a shortcut on the app root. A keystroke's action arrives without the window, and a window
/// cannot be borrowed again inside a frame, so this takes it once the frame is done.
fn u9_dispatch(cx: &mut App, root: &WeakEntity<AppRoot>, shortcut: Shortcut) {
    let Some(window) = cx.active_window() else {
        return;
    };
    let root = root.clone();
    cx.defer(move |cx| {
        window
            .update(cx, |_, window, cx| {
                root.update(cx, |root, cx| root.u9_run_shortcut(shortcut, window, cx))
                    .ok();
            })
            .ok();
    });
}

/// What opening `route` asks of the app.
fn u9_plan(route: &Route) -> Plan {
    match route {
        Route::Notifications => Plan::Notifications,
        Route::Friends => Plan::Friends,
        Route::OwnProfile => Plan::OwnProfile,
        Route::CreateCommunity => Plan::CreateCommunity,
        Route::ChannelSearch { .. } => Plan::ChannelSearch,
        _ => Plan::Ignore,
    }
}

/// Whether the open DM is a group: the server says so; older rows that don't are a group when it
/// holds more than two people (this user and two others).
fn u9_is_group(row: Option<&DmRow>) -> bool {
    row.is_some_and(|row| row.is_group || row.members.len() > 1)
}

/// The list the navigation shortcuts walk for `route`, and the entry it has on screen.
fn u9_nav_items(core: &Core, route: &Route) -> (Vec<NavItem>, Option<String>) {
    match route {
        Route::Channel {
            community_id,
            channel_id,
        }
        | Route::ChannelSearch {
            community_id,
            channel_id,
        } => {
            // The sidebar's text channels, in their order; a voice channel would join a call.
            let mut channels: Vec<_> = core
                .channels(community_id.clone())
                .into_iter()
                .filter(|channel| channel.kind != ChannelKind::Voice)
                .collect();
            channels.sort_by_key(|channel| channel.position);
            let items = channels
                .iter()
                .map(|channel| NavItem {
                    id: channel.id.clone(),
                    unread: channel.id != *channel_id && channel.unread_count > 0,
                })
                .collect();
            (items, Some(channel_id.clone()))
        }
        Route::DirectMessages | Route::DirectMessage { .. } => {
            let current = match route {
                Route::DirectMessage { dm_group_id } => Some(dm_group_id.clone()),
                _ => None,
            };
            let items = core
                .dm_list()
                .rows
                .iter()
                .map(|row| NavItem {
                    id: row.id.clone(),
                    unread: row.unread > 0,
                })
                .collect();
            (items, current)
        }
        _ => (Vec::new(), None),
    }
}

/// The web's `findNavTarget`: the item `direction` places from the current one, wrapping, skipping
/// read items when `unread_only`. `None` when there is no other item, or the step lands on the
/// current one.
fn u9_step_target<'a>(
    items: &'a [NavItem],
    current: Option<&str>,
    direction: i32,
    unread_only: bool,
) -> Option<&'a str> {
    let count = items.len() as i64;
    if count == 0 || direction == 0 {
        return None;
    }
    let current_index =
        current.and_then(|current| items.iter().position(|item| item.id == current));
    let start = match current_index {
        Some(index) => index as i64,
        None if direction > 0 => -1,
        None => count,
    };
    for step in 1..=count {
        let index = (((start + i64::from(direction) * step) % count) + count) % count;
        if Some(index as usize) == current_index {
            return None;
        }
        let item = &items[index as usize];
        if !unread_only || item.unread {
            return Some(item.id.as_str());
        }
    }
    None
}

/// The group's "Add people" dialog: the user search, and "Add" once someone is picked.
fn add_people_dialog(add: &AddPeople, cx: &mut Context<AppRoot>) -> AnyElement {
    let picked = add.picker.read(cx).picked().len();
    let body = div()
        .w_full()
        .flex()
        .flex_col()
        .gap(spacing(1.))
        .child(add.picker.clone())
        .children(
            add.failed
                .clone()
                .map(|message| Alert::new(Severity::Error, message)),
        );
    let cancel = cx.entity().downgrade();
    let close = cx.entity().downgrade();
    Dialog::new("Add people")
        .body(body)
        .action(
            Button::new("add-people-cancel", "Cancel").on_click(move |_, _, cx| {
                cancel
                    .update(cx, |root, cx| {
                        root.u9.add_people = None;
                        cx.notify();
                    })
                    .ok();
            }),
        )
        .action(
            Button::new("add-people-submit", "Add")
                .contained()
                .disabled(picked == 0 || add.busy)
                .loading(add.busy)
                .on_click(cx.listener(|root, _, window, cx| root.u9_add_people(window, cx))),
        )
        .on_close(move |_, cx| {
            close
                .update(cx, |root, cx| {
                    root.u9.add_people = None;
                    cx.notify();
                })
                .ok();
        })
        .into_any_element()
}

/// A message a failed change is logged with: the screens show their own.
fn log_failure(what: &str, result: Result<(), semaphore_core::platform::CoreError>) {
    if let Err(error) = result {
        log::warn!("{what}: {error}");
    }
}

/// A failed change as the screens' `AddOutcome::Failed` takes it.
fn error_view(error: &semaphore_core::platform::CoreError) -> ErrorView {
    ErrorView {
        code: String::new(),
        message: error.to_string(),
        retryable: false,
        retry_after_ms: None,
    }
}

#[cfg(test)]
mod tests {
    use super::{NavItem, Plan, u9_is_group, u9_plan, u9_step_target};
    use core::prelude::v1::test;
    use semaphore_core::model::{DmRow, UserView};
    use semaphore_ui::nav::Route;

    #[test]
    fn opening_a_route_is_one_of_these_plans() {
        assert_eq!(u9_plan(&Route::Notifications), Plan::Notifications);
        assert_eq!(u9_plan(&Route::Friends), Plan::Friends);
        assert_eq!(u9_plan(&Route::OwnProfile), Plan::OwnProfile);
        assert_eq!(u9_plan(&Route::CreateCommunity), Plan::CreateCommunity);
        assert_eq!(
            u9_plan(&Route::ChannelSearch {
                community_id: "c".into(),
                channel_id: "ch".into(),
            }),
            Plan::ChannelSearch
        );
        for route in [
            Route::Home,
            Route::DirectMessages,
            Route::DirectMessage {
                dm_group_id: "dm".into(),
            },
            Route::Profile {
                user_id: "u".into(),
            },
            Route::ProfileEdit,
            Route::Channel {
                community_id: "c".into(),
                channel_id: "ch".into(),
            },
            Route::Invite {
                invite_code: "code".into(),
            },
        ] {
            assert_eq!(u9_plan(&route), Plan::Ignore, "{route:?}");
        }
    }

    fn dm(is_group: bool, members: usize) -> DmRow {
        DmRow {
            is_group,
            members: (0..members)
                .map(|index| UserView {
                    id: format!("u{index}"),
                    ..Default::default()
                })
                .collect(),
            ..Default::default()
        }
    }

    #[test]
    fn a_group_is_what_the_row_says_or_more_than_two_people() {
        assert!(!u9_is_group(None));
        assert!(u9_is_group(Some(&dm(true, 1))));
        assert!(!u9_is_group(Some(&dm(false, 1))));
        // Three people: this user and two others. One-to-one rows have one other.
        assert!(u9_is_group(Some(&dm(false, 2))));
        assert!(!u9_is_group(Some(&dm(false, 0))));
    }

    fn items(ids: &[(&str, bool)]) -> Vec<NavItem> {
        ids.iter()
            .map(|(id, unread)| NavItem {
                id: (*id).to_string(),
                unread: *unread,
            })
            .collect()
    }

    #[test]
    fn the_next_channel_is_the_one_after_it_and_the_last_wraps() {
        let list = items(&[("a", false), ("b", true), ("c", false)]);
        assert_eq!(u9_step_target(&list, Some("a"), 1, false), Some("b"));
        assert_eq!(u9_step_target(&list, Some("c"), 1, false), Some("a"));
        assert_eq!(u9_step_target(&list, Some("a"), -1, false), Some("c"));
        assert_eq!(u9_step_target(&list, Some("b"), -1, false), Some("a"));
    }

    #[test]
    fn unread_only_skips_what_is_read_and_stops_at_the_conversation_on_screen() {
        let list = items(&[("a", false), ("b", true), ("c", false), ("d", true)]);
        assert_eq!(u9_step_target(&list, Some("a"), 1, true), Some("b"));
        // "c" is read, so the next unread one is "d".
        assert_eq!(u9_step_target(&list, Some("b"), 1, true), Some("d"));
        assert_eq!(u9_step_target(&list, Some("a"), -1, true), Some("d"));
        assert_eq!(u9_step_target(&list, Some("c"), -1, true), Some("b"));
        // The conversation on screen is the only unread one: there is nowhere to go.
        let only: Vec<NavItem> = items(&[("a", true), ("b", false)]);
        assert_eq!(u9_step_target(&only, Some("a"), 1, true), None);
        assert_eq!(u9_step_target(&only, Some("a"), -1, true), None);
        let read: Vec<NavItem> = items(&[("a", false), ("b", false)]);
        assert_eq!(u9_step_target(&read, Some("a"), 1, true), None);
        assert_eq!(u9_step_target(&read, Some("a"), 1, false), Some("b"));
    }

    #[test]
    fn no_list_or_nowhere_to_go_is_no_target() {
        let none: Vec<NavItem> = Vec::new();
        assert_eq!(u9_step_target(&none, None, 1, false), None);
        let one = items(&[("a", false)]);
        assert_eq!(u9_step_target(&one, Some("a"), 1, false), None);
        // An unknown current entry starts just outside the list.
        let list = items(&[("a", false), ("b", false), ("c", false)]);
        assert_eq!(u9_step_target(&list, None, 1, false), Some("a"));
        assert_eq!(u9_step_target(&list, None, -1, false), Some("c"));
        assert_eq!(u9_step_target(&list, Some("gone"), 1, false), Some("a"));
    }
}
