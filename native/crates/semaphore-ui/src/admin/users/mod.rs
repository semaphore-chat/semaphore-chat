//! UA3: users: search and filters, the list a page at a time, the per-user menu with each
//! action's reason when it's off (`AdminUserActions`), and its dialogs (reset password, instance
//! roles, storage quota, confirms), after `pages/admin/AdminUsersPage.tsx` and
//! `components/admin/ResetPasswordDialog.tsx`.
//!
//! Frozen by the UI freeze: the public API below (`new`, the setters and `UsersEvent`) is what the app
//! wiring lane builds against while UA3 draws the screen; change it only with the coordinator.
//!
//! The page decides nothing: the rows, the filters' query and every action's allowed-or-not come
//! from `AdminUsersView` / `AdminUserRow::actions`, and the open user's changes are followed in
//! `AdminUserView::op` / `AdminUserRolesView::op` through the W5-A machinery (`Pending`, `running`,
//! `failure`). It adds only what the web adds: the password's 8-to-128 and the quota's whole GiB.

#![allow(dead_code)]

mod dialogs;
mod rows;
#[cfg(feature = "stories")]
mod stories;
#[cfg(test)]
mod tests;

use crate::community_settings::rules::{Outcome, Pending, act, failure, running};
use crate::kit::{select_state, text_state};
use crate::messages::TimeFormat;
use gpui_kit::component::IndexPath;
use gpui_kit::component::input::{InputEvent, InputState};
use gpui_kit::component::select::{SelectEvent, SelectState};
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{
    AdminActionKind, AdminUserQuery, AdminUserRolesView, AdminUserView, AdminUsersView,
    InstanceAdminCaps,
};
use std::time::Duration;

/// `useDebounce(query, 300)` on the web, as `panel/search.rs` writes it.
const SEARCH_DEBOUNCE: Duration = Duration::from_millis(300);

/// The Status filter's labels: `AdminUserQuery::banned` `None`, `Some(false)`, `Some(true)`.
const STATUS_LABELS: [&str; 3] = ["All", "Active", "Banned"];
/// The Role filter's labels: `AdminUserQuery::owners` `None`, `Some(true)`, `Some(false)`.
const ROLE_LABELS: [&str; 3] = ["All", "Owner", "User"];

#[derive(Debug, Clone, PartialEq)]
pub enum UsersEvent {
    /// The filters changed: the owner reads `Core::admin_users(query)` and calls `set_view`.
    Query(AdminUserQuery),
    /// `Core::load_more_admin_users(query)`.
    LoadMore,
    /// A row's menu or a dialog opened for this user: the owner feeds `set_user` and
    /// `set_user_roles` from `Core::admin_user` and `Core::admin_user_roles`.
    OpenUser { user_id: String },
    /// The menu or dialog closed.
    CloseUser,
    /// `Core::ban_user`.
    Ban { user_id: String },
    /// `Core::unban_user`.
    Unban { user_id: String },
    /// Confirmed: `Core::delete_user`.
    Delete { user_id: String },
    /// `Core::reset_user_password(user_id, password)`.
    ResetPassword { user_id: String, password: String },
    /// `Core::set_user_owner(user_id, owner)`.
    SetOwner { user_id: String, owner: bool },
    /// `Core::assign_instance_role(user_id, role_id)`.
    AssignRole { user_id: String, role_id: String },
    /// `Core::unassign_instance_role(user_id, role_id)`.
    UnassignRole { user_id: String, role_id: String },
    /// `Core::set_user_quota(user_id, quota_bytes)` (the dialog takes GiB).
    SetQuota { user_id: String, quota_bytes: u64 },
    /// The read failed and the user asked again: `Core::retry_failed`.
    Retry,
}

/// What is open for `open_id`: the row's menu, or one of its dialogs. `None` is nothing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Panel {
    Menu,
    Ban,
    Delete,
    ResetPassword,
    Owner,
    Roles,
    Quota,
}

impl Panel {
    /// The change this panel waits on, on `AdminUserView::op`.
    fn action(self) -> Option<AdminActionKind> {
        match self {
            Panel::Ban => Some(AdminActionKind::BanUser),
            Panel::Delete => Some(AdminActionKind::DeleteUser),
            Panel::ResetPassword => Some(AdminActionKind::SetUserPassword),
            Panel::Owner => Some(AdminActionKind::SetOwner),
            Panel::Menu | Panel::Roles | Panel::Quota => None,
        }
    }
}

pub struct UsersPage {
    caps: InstanceAdminCaps,
    view: AdminUsersView,
    user: Option<AdminUserView>,
    user_roles: Option<AdminUserRolesView>,
    /// Which panel is open for `open_id`; nothing while `None`.
    panel: Option<Panel>,
    /// The user the menu or dialog belongs to (the id its events name).
    open_id: Option<String>,
    /// The open dialog's own change, followed until core records that it ended.
    pending: Option<Pending>,
    /// Why that change was refused: the dialog stays open and shows it.
    error: Option<String>,
    search: Entity<InputState>,
    status: Entity<SelectState<Vec<SharedString>>>,
    role: Entity<SelectState<Vec<SharedString>>>,
    password: Entity<InputState>,
    quota: Entity<InputState>,
    debounce: Option<Task<()>>,
    /// The filters the controls stand for: the query last sent, or the view's when it changed
    /// from outside (a route, or a story).
    emitted: AdminUserQuery,
    /// The query sent and not yet the view's own: the view has not answered it yet.
    asked: Option<AdminUserQuery>,
    /// The view's query already looked at, so a repeated render asks nothing new.
    seen: AdminUserQuery,
    time: TimeFormat,
    _subscriptions: Vec<Subscription>,
}

impl EventEmitter<UsersEvent> for UsersPage {}

impl UsersPage {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let search = text_state(window, cx, false);
        let status = select_state(labels(&STATUS_LABELS), Some(0), window, cx);
        let role = select_state(labels(&ROLE_LABELS), Some(0), window, cx);
        let password = text_state(window, cx, true);
        let quota = text_state(window, cx, false);
        let _subscriptions = vec![
            cx.subscribe_in(&search, window, |page, search, event, _, cx| {
                if let InputEvent::Change = event {
                    let typed = search.read(cx).value().to_string();
                    page.search_changed(&typed, cx);
                }
            }),
            cx.subscribe_in(&status, window, |page, _, event, _, cx| {
                let SelectEvent::Confirm(Some(label)) = event else {
                    return;
                };
                page.banned_filter(banned_of(label.as_ref()), cx);
            }),
            cx.subscribe_in(&role, window, |page, _, event, _, cx| {
                let SelectEvent::Confirm(Some(label)) = event else {
                    return;
                };
                page.owners_filter(owners_of(label.as_ref()), cx);
            }),
        ];
        Self {
            caps: InstanceAdminCaps::default(),
            view: AdminUsersView::default(),
            user: None,
            user_roles: None,
            panel: None,
            open_id: None,
            pending: None,
            error: None,
            search,
            status,
            role,
            password,
            quota,
            debounce: None,
            emitted: AdminUserQuery::default(),
            asked: None,
            seen: AdminUserQuery::default(),
            time: TimeFormat::default(),
            _subscriptions,
        }
    }

    /// What this user may do on the instance (`InstancePermissionsView::admin`).
    pub fn set_caps(&mut self, caps: InstanceAdminCaps, cx: &mut Context<Self>) {
        self.caps = caps;
        cx.notify();
    }

    /// `Core::admin_users(query)`.
    pub fn set_view(&mut self, view: AdminUsersView, cx: &mut Context<Self>) {
        self.view = view;
        cx.notify();
    }

    /// `Core::admin_user(id)` for the open menu or dialog; `None` when none is open.
    pub fn set_user(&mut self, user: Option<AdminUserView>, cx: &mut Context<Self>) {
        let Some(view) = user else {
            self.reset();
            cx.notify();
            return;
        };
        if let Some(mut pending) = self.pending.clone() {
            match pending.observe(&view.op) {
                // Core can record the refusal on the action's own entry before its end reaches
                // this view: either is the same answer.
                Outcome::Waiting => {
                    if let Some(error) = failure(&view.op, &pending.action) {
                        self.error = Some(error.message.clone());
                        self.pending = None;
                    }
                }
                Outcome::Failed => {
                    self.error = Some(
                        failure(&view.op, &pending.action)
                            .map(|error| error.message.clone())
                            .unwrap_or_else(|| {
                                "Something went wrong. Please try again.".to_owned()
                            }),
                    );
                    self.pending = None;
                }
                Outcome::Succeeded => {
                    // The change worked: the menu and its dialog go. The owner is told once this
                    // update is over, so it can drop the user it fed.
                    self.reset();
                    let page = cx.weak_entity();
                    cx.defer(move |cx| {
                        page.update(cx, |_, cx| cx.emit(UsersEvent::CloseUser)).ok();
                    });
                    cx.notify();
                    return;
                }
            }
        }
        if let Some(row) = &view.user
            && self.open_id.as_deref() != Some(row.user.id.as_str())
        {
            // Another user than the one open (the owner fed it without this page asking, as a
            // route or a story does): its menu.
            self.open_id = Some(row.user.id.clone());
            self.panel = Some(Panel::Menu);
            self.pending = None;
            self.error = None;
        }
        self.user = Some(view);
        cx.notify();
    }

    /// `Core::admin_user_roles(id)` for the roles dialog.
    pub fn set_user_roles(
        &mut self,
        user_roles: Option<AdminUserRolesView>,
        cx: &mut Context<Self>,
    ) {
        self.user_roles = user_roles;
        cx.notify();
    }

    /// The zone dates are written in: the app's, unless a story fixes it.
    fn set_time(&mut self, time: TimeFormat, cx: &mut Context<Self>) {
        self.time = time;
        cx.notify();
    }

    /// Nothing is open any more.
    fn reset(&mut self) {
        self.user = None;
        self.user_roles = None;
        self.panel = None;
        self.open_id = None;
        self.pending = None;
        self.error = None;
    }

    /// The open user's op, or an empty one while it's still being read.
    fn user_op(&self) -> semaphore_core::model::AdminOp {
        self.user
            .as_ref()
            .map(|view| view.op.clone())
            .unwrap_or_default()
    }

    fn roles_op(&self) -> semaphore_core::model::AdminOp {
        self.user_roles
            .as_ref()
            .map(|view| view.op.clone())
            .unwrap_or_default()
    }

    /// The user the menu or dialog is about, once the owner has fed its row.
    fn open_row(&self) -> Option<&semaphore_core::model::AdminUserRow> {
        let id = self.open_id.as_deref()?;
        self.user
            .as_ref()?
            .user
            .as_ref()
            .filter(|row| row.user.id == id)
    }

    /// A row's menu button: the owner reads the user, and its menu opens.
    fn open_user(&mut self, user_id: String, cx: &mut Context<Self>) {
        self.open_id = Some(user_id.clone());
        self.panel = Some(Panel::Menu);
        self.user = None;
        self.user_roles = None;
        self.pending = None;
        self.error = None;
        cx.emit(UsersEvent::OpenUser { user_id });
        cx.notify();
    }

    /// A menu item or a dialog's Cancel: the menu or dialog goes, and the owner clears the user.
    fn close(&mut self, cx: &mut Context<Self>) {
        self.reset();
        cx.emit(UsersEvent::CloseUser);
        cx.notify();
    }

    /// Whether the panel's change is on its way: sent and not yet recorded, or running on the op.
    fn busy(&self, kind: AdminActionKind) -> bool {
        let running_on_op = self.open_id.as_deref().is_some_and(|id| {
            let action = act(kind, Some(id));
            running(&self.user_op(), &action)
        });
        running_on_op
            || self
                .pending
                .as_ref()
                .is_some_and(|pending| pending.action.kind == kind)
    }

    /// The server's words for this action, once it was refused.
    fn failure_for(&self, kind: AdminActionKind) -> Option<String> {
        let id = self.open_id.as_deref()?;
        let action = act(kind, Some(id));
        failure(&self.user_op(), &action).map(|error| error.message.clone())
    }

    /// Why the open dialog can't finish its change: the message its own pending change got, or the
    /// one core recorded for that action on the user's op.
    fn refusal(&self, kind: AdminActionKind) -> Option<String> {
        self.error.clone().or_else(|| self.failure_for(kind))
    }

    /// Sends one change on the open user and waits on its entry in `AdminUserView::op`.
    fn send(&mut self, kind: AdminActionKind, event: UsersEvent, cx: &mut Context<Self>) {
        if self.busy(kind) {
            return;
        }
        let Some(user_id) = self.open_id.clone() else {
            return;
        };
        let action = act(kind, Some(&user_id));
        self.pending = Some(Pending::new(action, &self.user_op()));
        self.error = None;
        cx.emit(event);
        cx.notify();
    }

    /// The filters' controls stand for the view's query when it changed from outside (a route, or
    /// a story). An answer to a query this page sent is not an outside change: the controls keep
    /// what the user set while core catches up, so nothing typed is overwritten by a stale reply.
    fn sync_filters(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.view.query == self.seen {
            return;
        }
        self.seen = self.view.query.clone();
        if self.asked.as_ref() == Some(&self.view.query) {
            self.asked = None;
            return;
        }
        if self.asked.is_some() {
            return;
        }
        self.emitted = self.view.query.clone();
        let query = self.emitted.clone();
        let (status, role, search) = (self.status.clone(), self.role.clone(), self.search.clone());
        cx.defer_in(window, move |_, window, cx| {
            status.update(cx, |state, cx| {
                state.set_selected_index(
                    Some(IndexPath::default().row(status_index(query.banned))),
                    window,
                    cx,
                )
            });
            role.update(cx, |state, cx| {
                state.set_selected_index(
                    Some(IndexPath::default().row(role_index(query.owners))),
                    window,
                    cx,
                )
            });
            search.update(cx, |field, cx| {
                field.set_value(query.search.clone(), window, cx)
            });
        });
    }

    /// What was typed in the search field, after `panel/search.rs`'s 300 ms debounce. Emptying it
    /// asks at once, so clearing the search shows everyone without a wait.
    fn search_changed(&mut self, typed: &str, cx: &mut Context<Self>) {
        if typed == self.emitted.search {
            self.debounce = None;
            return;
        }
        if typed.is_empty() {
            self.debounce = None;
            self.emitted.search.clear();
            self.asked = Some(self.emitted.clone());
            cx.emit(UsersEvent::Query(self.emitted.clone()));
            cx.notify();
            return;
        }
        self.debounce = Some(cx.spawn(async move |page, cx| {
            cx.background_executor().timer(SEARCH_DEBOUNCE).await;
            page.update(cx, |page, cx| {
                page.debounce = None;
                let typed = page.search.read(cx).value().to_string();
                if typed != page.emitted.search {
                    page.emitted.search = typed;
                    page.asked = Some(page.emitted.clone());
                    cx.emit(UsersEvent::Query(page.emitted.clone()));
                }
                cx.notify();
            })
            .ok();
        }));
        cx.notify();
    }

    fn banned_filter(&mut self, banned: Option<bool>, cx: &mut Context<Self>) {
        if self.emitted.banned == banned {
            return;
        }
        self.emitted.banned = banned;
        self.asked = Some(self.emitted.clone());
        cx.emit(UsersEvent::Query(self.emitted.clone()));
        cx.notify();
    }

    fn owners_filter(&mut self, owners: Option<bool>, cx: &mut Context<Self>) {
        if self.emitted.owners == owners {
            return;
        }
        self.emitted.owners = owners;
        self.asked = Some(self.emitted.clone());
        cx.emit(UsersEvent::Query(self.emitted.clone()));
        cx.notify();
    }
}

fn labels(labels: &[&'static str]) -> Vec<SharedString> {
    labels
        .iter()
        .map(|label| SharedString::from(*label))
        .collect()
}

fn banned_of(label: &str) -> Option<bool> {
    match label {
        "Banned" => Some(true),
        "Active" => Some(false),
        _ => None,
    }
}

fn owners_of(label: &str) -> Option<bool> {
    match label {
        "Owner" => Some(true),
        "User" => Some(false),
        _ => None,
    }
}

fn status_index(banned: Option<bool>) -> usize {
    match banned {
        None => 0,
        Some(false) => 1,
        Some(true) => 2,
    }
}

fn role_index(owners: Option<bool>) -> usize {
    match owners {
        None => 0,
        Some(true) => 1,
        Some(false) => 2,
    }
}

impl Render for UsersPage {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        self.sync_filters(window, cx);
        let body = self.body(window, cx);
        let dialog = self.dialog(cx);
        div().relative().size_full().child(body).children(dialog)
    }
}

#[cfg(feature = "stories")]
pub fn stories() -> Vec<crate::stories::Story> {
    stories::stories()
}
