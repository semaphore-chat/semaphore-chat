//! WA: the instance admin area in the app: `Route::Admin { page }` shows `AdminShell` with the
//! page, each page fed from its core view and its events run as core commands, the account
//! menu's "Admin" entry (`InstanceAdminCaps::show_admin`), and the phone drill-in.
//!
//! Hub file from the UI freeze: `root.rs` calls the functions below once each (core events,
//! navigation, the route's content, overlays), and nothing else in the app does. Copy the shape of
//! `root/community.rs` (W5-app).
//!
//! - **One shell while the route is open.** Entering `Route::Admin { page }` builds the shell once
//!   and the page's screen; another page replaces the screen and keeps the shell; leaving the
//!   admin routes drops both, so nothing here reads core while it isn't on screen.
//! - **No view model kept here.** Every feed reads core when it runs and pushes through the
//!   page's `set_*`. Which `ViewChanged` re-reads which setter is [`feeds`], a pure function of the
//!   view and [`OpenState`] (the open page and what it has open: the users' query, the storage
//!   filter, an open user, community or role). A view of another page, of another query or of an
//!   id that isn't open feeds nothing, since a read fetches.
//! - **Commands run on the app's executor** (`Services::exec`), and their failure is core's to
//!   show on the view's op: here it is only logged.

use super::AppRoot;
use gpui_kit::*;
use semaphore_core::CoreEvent;
use semaphore_core::model::{AdminPage, AdminUserQuery, InstanceAdminCaps, SessionState, ViewKey};
use semaphore_core::platform::CoreError;
use semaphore_ui::admin::communities::{CommunitiesEvent, CommunitiesPage};
use semaphore_ui::admin::dashboard::{DashboardEvent, DashboardPage};
use semaphore_ui::admin::invites::{InstanceInvitesEvent, InstanceInvitesPage};
use semaphore_ui::admin::layout::{AdminShell, AdminShellEvent};
use semaphore_ui::admin::roles::{InstanceRolesEvent, InstanceRolesPage};
use semaphore_ui::admin::settings::{InstanceSettingsEvent, InstanceSettingsPage};
use semaphore_ui::admin::storage::{StorageEvent, StoragePage};
use semaphore_ui::admin::users::{UsersEvent, UsersPage};
use semaphore_ui::kit::Button;
use semaphore_ui::nav::Route;

/// What the open page shows, which decides what each `ViewChanged` feeds.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpenState {
    pub page: AdminPage,
    /// The users list's query (`UsersEvent::Query`): the one on screen.
    pub users_query: AdminUserQuery,
    /// The communities list's search (`CommunitiesEvent::Search`), trimmed as core trims it.
    pub communities_search: String,
    /// The storage page's usage filter (`StorageEvent::Filter`).
    pub storage_min_percent: u32,
    /// The user whose menu or dialog is open (`UsersEvent::OpenUser`).
    pub user: Option<String>,
    /// The community whose detail is open (`CommunitiesEvent::Open`).
    pub community: Option<String>,
    /// The role whose users dialog is open (`InstanceRolesEvent::OpenUsers`).
    pub role: Option<String>,
}

impl OpenState {
    pub fn new(page: AdminPage) -> Self {
        Self {
            page,
            users_query: AdminUserQuery::default(),
            communities_search: String::new(),
            storage_min_percent: 0,
            user: None,
            community: None,
            role: None,
        }
    }
}

/// One setter to call with what core says now.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Feed {
    /// `AdminShell::set_caps` and the page's `set_caps`.
    Caps,
    /// `DashboardPage::set_view(core.admin_dashboard())`.
    Dashboard,
    /// `InstanceSettingsPage::set_view(core.instance_settings())`.
    Settings,
    /// `UsersPage::set_view(core.admin_users(query))` for the open query.
    Users,
    /// `UsersPage::set_user(Some(core.admin_user(id)))` for the open user.
    User(String),
    /// `UsersPage::set_user_roles(Some(core.admin_user_roles(id)))` for the open user.
    UserRoles(String),
    /// `CommunitiesPage::set_view(core.admin_communities(search))` for the shown search.
    Communities(String),
    /// `CommunitiesPage::set_detail(Some(core.admin_community(id)))` for the open community.
    CommunityDetail(String),
    /// `InstanceInvitesPage::set_view(core.admin_invites())`.
    Invites,
    /// `InstanceInvitesPage::set_communities(core.communities())`: what an invite may add.
    InviteCommunities,
    /// `InstanceRolesPage::set_view(core.instance_roles())`.
    Roles,
    /// `InstanceRolesPage::set_role_users(Some(core.instance_role_users(id)))`.
    RoleUsers(String),
    /// `StoragePage::set_view(core.admin_storage(min_percent))` for the shown filter.
    Storage,
}

/// Which setters a `ViewChanged { view }` re-reads, with `open` on screen. Views of another page,
/// of another query or of an id that isn't open feed nothing.
pub fn feeds(view: &ViewKey, open: &OpenState) -> Vec<Feed> {
    let page = open.page;
    let feed = match view {
        ViewKey::InstancePermissions => Feed::Caps,
        ViewKey::AdminDashboard if page == AdminPage::Dashboard => Feed::Dashboard,
        ViewKey::InstanceSettings if page == AdminPage::Settings => Feed::Settings,
        ViewKey::AdminUsers { query } if page == AdminPage::Users && *query == open.users_query => {
            Feed::Users
        }
        ViewKey::AdminUser { user_id }
            if page == AdminPage::Users && open.user.as_deref() == Some(user_id.as_str()) =>
        {
            Feed::User(user_id.clone())
        }
        ViewKey::AdminUserRoles { user_id }
            if page == AdminPage::Users && open.user.as_deref() == Some(user_id.as_str()) =>
        {
            Feed::UserRoles(user_id.clone())
        }
        ViewKey::AdminCommunities { search }
            if page == AdminPage::Communities && *search == open.communities_search =>
        {
            Feed::Communities(search.clone())
        }
        ViewKey::AdminCommunity { community_id }
            if page == AdminPage::Communities
                && open.community.as_deref() == Some(community_id.as_str()) =>
        {
            Feed::CommunityDetail(community_id.clone())
        }
        ViewKey::AdminInvites if page == AdminPage::Invites => Feed::Invites,
        ViewKey::Communities if page == AdminPage::Invites => Feed::InviteCommunities,
        ViewKey::InstanceRoles if page == AdminPage::Roles => Feed::Roles,
        ViewKey::InstanceRoleUsers { role_id }
            if page == AdminPage::Roles && open.role.as_deref() == Some(role_id.as_str()) =>
        {
            Feed::RoleUsers(role_id.clone())
        }
        ViewKey::AdminStorage { min_percent }
            if page == AdminPage::Storage && *min_percent == open.storage_min_percent =>
        {
            Feed::Storage
        }
        _ => return Vec::new(),
    };
    vec![feed]
}

/// What `open` feeds when its page opens: its caps, and the page's own view.
pub fn opening(open: &OpenState) -> Vec<Feed> {
    let mut feeds = vec![Feed::Caps];
    feeds.push(match open.page {
        AdminPage::Dashboard => Feed::Dashboard,
        AdminPage::Settings => Feed::Settings,
        AdminPage::Users => Feed::Users,
        AdminPage::Communities => Feed::Communities(open.communities_search.clone()),
        AdminPage::Invites => Feed::Invites,
        AdminPage::Roles => Feed::Roles,
        AdminPage::Storage => Feed::Storage,
    });
    if open.page == AdminPage::Invites {
        // The create dialog's "Communities to Auto-Join".
        feeds.push(Feed::InviteCommunities);
    }
    feeds
}

/// The page on screen: its screen entity, which is the shell's content.
#[derive(Clone)]
enum Page {
    Dashboard(Entity<DashboardPage>),
    Settings(Entity<InstanceSettingsPage>),
    Users(Entity<UsersPage>),
    Communities(Entity<CommunitiesPage>),
    Invites(Entity<InstanceInvitesPage>),
    Roles(Entity<InstanceRolesPage>),
    Storage(Entity<StoragePage>),
}

impl Page {
    fn kind(&self) -> AdminPage {
        match self {
            Page::Dashboard(_) => AdminPage::Dashboard,
            Page::Settings(_) => AdminPage::Settings,
            Page::Users(_) => AdminPage::Users,
            Page::Communities(_) => AdminPage::Communities,
            Page::Invites(_) => AdminPage::Invites,
            Page::Roles(_) => AdminPage::Roles,
            Page::Storage(_) => AdminPage::Storage,
        }
    }

    fn view(&self) -> AnyView {
        match self {
            Page::Dashboard(screen) => screen.clone().into(),
            Page::Settings(screen) => screen.clone().into(),
            Page::Users(screen) => screen.clone().into(),
            Page::Communities(screen) => screen.clone().into(),
            Page::Invites(screen) => screen.clone().into(),
            Page::Roles(screen) => screen.clone().into(),
            Page::Storage(screen) => screen.clone().into(),
        }
    }

    fn set_caps(&self, caps: &InstanceAdminCaps, cx: &mut App) {
        let caps = caps.clone();
        match self {
            Page::Dashboard(screen) => screen.update(cx, |screen, cx| screen.set_caps(caps, cx)),
            Page::Settings(screen) => screen.update(cx, |screen, cx| screen.set_caps(caps, cx)),
            Page::Users(screen) => screen.update(cx, |screen, cx| screen.set_caps(caps, cx)),
            Page::Communities(screen) => screen.update(cx, |screen, cx| screen.set_caps(caps, cx)),
            Page::Invites(screen) => screen.update(cx, |screen, cx| screen.set_caps(caps, cx)),
            Page::Roles(screen) => screen.update(cx, |screen, cx| screen.set_caps(caps, cx)),
            Page::Storage(screen) => screen.update(cx, |screen, cx| screen.set_caps(caps, cx)),
        }
    }
}

/// WA's state: what it has on screen. Gone with the session.
#[derive(Default)]
pub struct AdminArea {
    shell: Option<Entity<AdminShell>>,
    page: Option<Page>,
    open: Option<OpenState>,
    /// The filter the dashboard's Storage item asked the page to open with (`DashboardEvent::Open`).
    storage_filter: Option<u32>,
    shell_subscription: Option<Subscription>,
    page_subscriptions: Vec<Subscription>,
}

/// Whether this window is a phone's (`DEVICE_BREAKPOINTS.PHONE`).
fn phone(window: &Window) -> bool {
    f32::from(window.viewport_size().width) < semaphore_ui::shell::PHONE
}

/// The account menu's "Admin" button, when `caps` say this user holds an admin permission
/// (`InstanceAdminCaps::show_admin`).
fn account_admin_button(
    caps: &InstanceAdminCaps,
    on_click: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
) -> Option<Button> {
    caps.show_admin
        .then(|| Button::new("account-admin", "Admin").on_click(on_click))
}

impl AppRoot {
    /// The admin area on show: its page and what it has open, for the rig.
    pub fn admin_open(&self) -> Option<OpenState> {
        self.admin.open.clone()
    }

    fn drop_admin(&mut self) {
        self.admin = AdminArea::default();
    }

    pub(super) fn admin_on_core(&mut self, event: &CoreEvent, cx: &mut Context<Self>) {
        let CoreEvent::ViewChanged { view } = event else {
            return;
        };
        // The account menu's entry appears once the caps land, and goes with the session.
        if matches!(view, ViewKey::InstancePermissions) && self.account_open {
            cx.notify();
        }
        if matches!(view, ViewKey::Session)
            && !matches!(
                self.core().map(|core| core.session()),
                Some(SessionState::SignedIn { .. })
            )
        {
            self.drop_admin();
            return;
        }
        let Some(open) = self.admin.open.clone() else {
            return;
        };
        let feeds = feeds(view, &open);
        if !feeds.is_empty() {
            self.feed_admin_later(feeds, cx);
        }
    }

    /// The route changed: build the shell and the page, replace the page, or drop them all.
    pub(super) fn admin_navigated(
        &mut self,
        route: &Route,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Route::Admin { page } = route else {
            if self.admin.shell.is_some() {
                self.drop_admin();
            }
            return;
        };
        let same = self
            .admin
            .page
            .as_ref()
            .is_some_and(|shown| shown.kind() == *page)
            && self
                .admin
                .open
                .as_ref()
                .is_some_and(|open| open.page == *page);
        if !same {
            self.open_admin_page(*page, window, cx);
            return;
        }
        // The same page again: the shell still has it; the phone's drill-in opens it and the caps
        // may have landed since.
        if let Some(shell) = self.admin.shell.clone() {
            shell.update(cx, |shell, cx| {
                shell.set_page(*page, cx);
                cx.notify();
            });
        }
        if let Some(open) = self.admin.open.clone() {
            self.apply_admin_feeds(&open, opening(&open), cx);
        }
    }

    /// The route's content when it's WA's; `None` otherwise.
    pub(super) fn admin_content(&self, route: &Route, _cx: &App) -> Option<AnyElement> {
        match route {
            Route::Admin { .. } => self.admin.shell.clone().map(IntoElement::into_any_element),
            _ => None,
        }
    }

    /// Dialogs this module draws over the shell: none (each page draws its own).
    pub(super) fn admin_overlays(&self, _cx: &mut Context<Self>) -> Vec<AnyElement> {
        Vec::new()
    }

    /// The account menu's "Admin" button, when this user holds any admin permission
    /// (`InstanceAdminCaps::show_admin`); it opens `Route::Admin { page: Dashboard }`.
    pub(super) fn admin_account_action(&self, cx: &mut Context<Self>) -> Option<Button> {
        let caps = self.core()?.instance_permissions().admin;
        let root = cx.weak_entity();
        account_admin_button(&caps, move |_, _, cx| {
            root.update(cx, |root, cx| {
                root.account_open = false;
                root.shell_navigate(
                    Route::Admin {
                        page: AdminPage::Dashboard,
                    },
                    cx,
                );
                cx.notify();
            })
            .ok();
        })
    }

    // ---- The screen. ----

    /// Builds the shell (once) and `page`'s screen, then feeds it once.
    fn open_admin_page(&mut self, page: AdminPage, window: &mut Window, cx: &mut Context<Self>) {
        let Some(core) = self.core() else {
            return;
        };
        let caps = core.instance_permissions().admin;
        let shell = match self.admin.shell.clone() {
            Some(shell) => shell,
            None => {
                let shell = cx.new(|cx| AdminShell::new(window, cx));
                self.admin.shell_subscription =
                    Some(cx.subscribe_in(&shell, window, Self::on_admin_shell));
                self.admin.shell = Some(shell.clone());
                shell
            }
        };
        // The page replaces the last one, and its subscriptions with it.
        self.admin.page = None;
        self.admin.page_subscriptions.clear();
        // A filter the dashboard asked for is this page's; anything else drops it.
        let storage_min_percent = if page == AdminPage::Storage {
            self.admin.storage_filter.take().unwrap_or(0)
        } else {
            self.admin.storage_filter = None;
            0
        };
        let mut open = OpenState::new(page);
        open.storage_min_percent = storage_min_percent;
        let mut subscriptions = Vec::new();
        let screen = match page {
            AdminPage::Dashboard => {
                let screen = cx.new(|cx| DashboardPage::new(window, cx));
                subscriptions.push(cx.subscribe_in(&screen, window, Self::on_admin_dashboard));
                Page::Dashboard(screen)
            }
            AdminPage::Settings => {
                let screen = cx.new(|cx| InstanceSettingsPage::new(window, cx));
                subscriptions.push(cx.subscribe_in(&screen, window, Self::on_admin_settings));
                Page::Settings(screen)
            }
            AdminPage::Users => {
                let screen = cx.new(|cx| UsersPage::new(window, cx));
                subscriptions.push(cx.subscribe_in(&screen, window, Self::on_admin_users));
                Page::Users(screen)
            }
            AdminPage::Communities => {
                let screen = cx.new(|cx| CommunitiesPage::new(window, cx));
                subscriptions.push(cx.subscribe_in(&screen, window, Self::on_admin_communities));
                Page::Communities(screen)
            }
            AdminPage::Invites => {
                let screen = cx.new(|cx| InstanceInvitesPage::new(window, cx));
                let time = self.config.time;
                let clock = time.now;
                let base = self
                    .services
                    .as_ref()
                    .and_then(|services| services.backend.server_url())
                    .unwrap_or_default();
                screen.update(cx, |screen, cx| {
                    screen.set_time(time, cx);
                    screen.set_clock(clock, cx);
                    screen.set_link_base(base, cx);
                });
                subscriptions.push(cx.subscribe_in(&screen, window, Self::on_admin_invites));
                Page::Invites(screen)
            }
            AdminPage::Roles => {
                let screen = cx.new(|cx| InstanceRolesPage::new(window, cx));
                subscriptions.push(cx.subscribe_in(&screen, window, Self::on_admin_roles));
                Page::Roles(screen)
            }
            AdminPage::Storage => {
                let screen = cx.new(|cx| StoragePage::new(window, cx));
                subscriptions.push(cx.subscribe_in(&screen, window, Self::on_admin_storage));
                Page::Storage(screen)
            }
        };
        screen.set_caps(&caps, cx);
        shell.update(cx, |shell, cx| {
            shell.set_caps(caps, cx);
            shell.set_page(page, cx);
            shell.set_content(Some(screen.view()), cx);
        });
        self.admin.page = Some(screen);
        self.admin.page_subscriptions = subscriptions;
        self.admin.open = Some(open.clone());
        self.apply_admin_feeds(&open, opening(&open), cx);
    }

    /// `feeds` after the event being handled: if the screen is still the same by then.
    fn feed_admin_later(&self, feeds: Vec<Feed>, cx: &mut Context<Self>) {
        let (handle, root) = (self.window, cx.entity().downgrade());
        cx.defer(move |cx| {
            handle
                .update(cx, |_, _window, cx| {
                    root.update(cx, |root, cx| root.feed_admin_now(feeds, cx))
                        .ok();
                })
                .ok();
        });
    }

    fn feed_admin_now(&mut self, feeds: Vec<Feed>, cx: &mut Context<Self>) {
        let Some(open) = self.admin.open.clone() else {
            return;
        };
        self.apply_admin_feeds(&open, feeds, cx);
    }

    /// Reads core for each feed and pushes it to its page.
    fn apply_admin_feeds(&mut self, open: &OpenState, feeds: Vec<Feed>, cx: &mut Context<Self>) {
        let (Some(core), Some(shell), Some(page)) = (
            self.core(),
            self.admin.shell.clone(),
            self.admin.page.clone(),
        ) else {
            return;
        };
        if self.admin.open.as_ref() != Some(open) {
            return;
        }
        for feed in feeds {
            match feed {
                Feed::Caps => {
                    let caps = core.instance_permissions().admin;
                    shell.update(cx, |shell, cx| shell.set_caps(caps.clone(), cx));
                    page.set_caps(&caps, cx);
                }
                Feed::Dashboard => {
                    let Page::Dashboard(screen) = &page else {
                        continue;
                    };
                    let view = core.admin_dashboard();
                    screen.update(cx, |screen, cx| screen.set_view(view, cx));
                }
                Feed::Settings => {
                    let Page::Settings(screen) = &page else {
                        continue;
                    };
                    let view = core.instance_settings();
                    screen.update(cx, |screen, cx| screen.set_view(view, cx));
                }
                Feed::Users => {
                    let Page::Users(screen) = &page else {
                        continue;
                    };
                    let view = core.admin_users(open.users_query.clone());
                    screen.update(cx, |screen, cx| screen.set_view(view, cx));
                }
                Feed::User(user_id) => {
                    let Page::Users(screen) = &page else {
                        continue;
                    };
                    let view = core.admin_user(user_id);
                    screen.update(cx, |screen, cx| screen.set_user(Some(view), cx));
                }
                Feed::UserRoles(user_id) => {
                    let Page::Users(screen) = &page else {
                        continue;
                    };
                    let view = core.admin_user_roles(user_id);
                    screen.update(cx, |screen, cx| screen.set_user_roles(Some(view), cx));
                }
                Feed::Communities(search) => {
                    let Page::Communities(screen) = &page else {
                        continue;
                    };
                    let view = core.admin_communities(search);
                    screen.update(cx, |screen, cx| screen.set_view(view, cx));
                }
                Feed::CommunityDetail(community_id) => {
                    let Page::Communities(screen) = &page else {
                        continue;
                    };
                    let view = core.admin_community(community_id);
                    screen.update(cx, |screen, cx| screen.set_detail(Some(view), cx));
                }
                Feed::Invites => {
                    let Page::Invites(screen) = &page else {
                        continue;
                    };
                    let view = core.admin_invites();
                    screen.update(cx, |screen, cx| screen.set_view(view, cx));
                }
                Feed::InviteCommunities => {
                    let Page::Invites(screen) = &page else {
                        continue;
                    };
                    let communities = core.communities();
                    screen.update(cx, |screen, cx| screen.set_communities(communities, cx));
                }
                Feed::Roles => {
                    let Page::Roles(screen) = &page else {
                        continue;
                    };
                    let view = core.instance_roles();
                    screen.update(cx, |screen, cx| screen.set_view(view, cx));
                }
                Feed::RoleUsers(role_id) => {
                    let Page::Roles(screen) = &page else {
                        continue;
                    };
                    let view = core.instance_role_users(role_id);
                    screen.update(cx, |screen, cx| screen.set_role_users(Some(view), cx));
                }
                Feed::Storage => {
                    let Page::Storage(screen) = &page else {
                        continue;
                    };
                    let view = core.admin_storage(open.storage_min_percent);
                    screen.update(cx, |screen, cx| screen.set_view(view, cx));
                }
            }
        }
    }

    /// Runs a command whose outcome core reports on the view's op. A failure is already on the
    /// view for the screen to show, so it is only logged here.
    fn admin_command<T, F>(&self, what: &'static str, work: F)
    where
        F: Future<Output = Result<T, CoreError>> + Send + 'static,
    {
        if let Some(services) = &self.services {
            services.exec.fire(async move {
                if let Err(error) = work.await {
                    log::info!("{what}: {error}");
                }
            });
        }
    }

    // ---- Events. ----

    fn on_admin_shell(
        &mut self,
        _: &Entity<AdminShell>,
        event: &AdminShellEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        match event {
            AdminShellEvent::Open(page) => self.shell_navigate(Route::Admin { page: *page }, cx),
            // On a phone the shell already went back to its page list; anywhere else "Back to the
            // app" leaves the admin area.
            AdminShellEvent::Back => {
                if !phone(window) {
                    self.shell_navigate(Route::Home, cx);
                }
            }
        }
    }

    fn on_admin_dashboard(
        &mut self,
        _: &Entity<DashboardPage>,
        event: &DashboardEvent,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(core) = self.core() else {
            return;
        };
        match event {
            DashboardEvent::Open {
                page,
                storage_min_percent,
            } => {
                if *page == AdminPage::Storage {
                    self.admin.storage_filter = Some(storage_min_percent.unwrap_or(0));
                }
                self.shell_navigate(Route::Admin { page: *page }, cx);
            }
            DashboardEvent::OpenUrl(url) => crate::open_url(url, cx),
            DashboardEvent::Retry => core.retry_failed(),
        }
    }

    fn on_admin_settings(
        &mut self,
        _: &Entity<InstanceSettingsPage>,
        event: &InstanceSettingsEvent,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) {
        let Some(core) = self.core() else {
            return;
        };
        match event {
            InstanceSettingsEvent::Save(patch) => {
                let patch = patch.clone();
                self.admin_command("saving the instance settings", async move {
                    core.update_instance_settings(patch).await
                });
            }
            InstanceSettingsEvent::Retry => core.retry_failed(),
        }
    }

    fn on_admin_users(
        &mut self,
        screen: &Entity<UsersPage>,
        event: &UsersEvent,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(core) = self.core() else {
            return;
        };
        match event.clone() {
            UsersEvent::Query(query) => {
                let Some(open) = self.admin.open.clone() else {
                    return;
                };
                if open.page != AdminPage::Users {
                    return;
                }
                if let Some(open) = self.admin.open.as_mut() {
                    open.users_query = query.clone();
                }
                let view = core.admin_users(query);
                screen.update(cx, |screen, cx| screen.set_view(view, cx));
            }
            UsersEvent::LoadMore => {
                let Some(query) = self
                    .admin
                    .open
                    .as_ref()
                    .map(|open| open.users_query.clone())
                else {
                    return;
                };
                self.admin_command("loading more users", async move {
                    core.load_more_admin_users(query).await
                });
            }
            UsersEvent::OpenUser { user_id } => {
                if let Some(open) = self.admin.open.as_mut() {
                    open.user = Some(user_id.clone());
                }
                let user = core.admin_user(user_id.clone());
                let roles = core.admin_user_roles(user_id);
                screen.update(cx, |screen, cx| {
                    screen.set_user(Some(user), cx);
                    screen.set_user_roles(Some(roles), cx);
                });
            }
            UsersEvent::CloseUser => {
                if let Some(open) = self.admin.open.as_mut() {
                    open.user = None;
                }
                // The page may have reopened the row from a user view that landed as it closed
                // (a change's end, then the changed user): it asked for nothing, so it keeps
                // nothing open.
                screen.update(cx, |screen, cx| screen.set_user(None, cx));
            }
            UsersEvent::Ban { user_id } => {
                self.admin_command(
                    "banning a user",
                    async move { core.ban_user(user_id).await },
                )
            }
            UsersEvent::Unban { user_id } => {
                self.admin_command(
                    "unbanning a user",
                    async move { core.unban_user(user_id).await },
                )
            }
            UsersEvent::Delete { user_id } => {
                self.admin_command(
                    "deleting a user",
                    async move { core.delete_user(user_id).await },
                )
            }
            UsersEvent::ResetPassword { user_id, password } => self
                .admin_command("resetting a password", async move {
                    core.reset_user_password(user_id, password).await
                }),
            UsersEvent::SetOwner { user_id, owner } => self
                .admin_command("changing the owner role", async move {
                    core.set_user_owner(user_id, owner).await
                }),
            UsersEvent::AssignRole { user_id, role_id } => self
                .admin_command("assigning an instance role", async move {
                    core.assign_instance_role(user_id, role_id).await
                }),
            UsersEvent::UnassignRole { user_id, role_id } => self
                .admin_command("taking an instance role", async move {
                    core.unassign_instance_role(user_id, role_id).await
                }),
            UsersEvent::SetQuota {
                user_id,
                quota_bytes,
            } => self.admin_command("setting a user's quota", async move {
                core.set_user_quota(user_id, quota_bytes).await
            }),
            UsersEvent::Retry => core.retry_failed(),
        }
    }

    fn on_admin_communities(
        &mut self,
        screen: &Entity<CommunitiesPage>,
        event: &CommunitiesEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(core) = self.core() else {
            return;
        };
        match event.clone() {
            CommunitiesEvent::Search(search) => {
                let Some(open) = self.admin.open.clone() else {
                    return;
                };
                if open.page != AdminPage::Communities {
                    return;
                }
                let search = search.trim().to_owned();
                if let Some(open) = self.admin.open.as_mut() {
                    open.communities_search = search.clone();
                }
                let view = core.admin_communities(search);
                screen.update(cx, |screen, cx| screen.set_view(view, cx));
            }
            CommunitiesEvent::LoadMore => {
                let Some(search) = self
                    .admin
                    .open
                    .as_ref()
                    .map(|open| open.communities_search.clone())
                else {
                    return;
                };
                self.admin_command("loading more communities", async move {
                    core.load_more_admin_communities(search).await
                });
            }
            CommunitiesEvent::Open { community_id } => {
                if let Some(open) = self.admin.open.as_mut() {
                    open.community = Some(community_id.clone());
                }
                let view = core.admin_community(community_id);
                screen.update(cx, |screen, cx| screen.set_detail(Some(view), cx));
            }
            CommunitiesEvent::ForceDelete { community_id } => {
                // On success the community is gone: the detail closes, so nothing asks the server
                // for it again. Its op records the end the page's confirm waits on.
                let (screen, gone) = (screen.downgrade(), community_id.clone());
                let Some(exec) = self.services.as_ref().map(|services| services.exec.clone())
                else {
                    return;
                };
                exec.run(
                    window,
                    cx,
                    async move { core.force_delete_community(community_id).await },
                    move |root, result, _window, cx| match result {
                        Ok(()) => {
                            let view = root.core().map(|core| core.admin_community(gone.clone()));
                            if let Some(view) = view {
                                screen
                                    .update(cx, |screen, cx| screen.set_detail(Some(view), cx))
                                    .ok();
                            }
                            if let Some(open) = root.admin.open.as_mut()
                                && open.community.as_deref() == Some(gone.as_str())
                            {
                                open.community = None;
                            }
                            screen
                                .update(cx, |screen, cx| screen.set_detail(None, cx))
                                .ok();
                            cx.notify();
                        }
                        Err(error) => log::info!("deleting a community: {error}"),
                    },
                );
            }
            CommunitiesEvent::Retry => core.retry_failed(),
        }
    }

    fn on_admin_invites(
        &mut self,
        _: &Entity<InstanceInvitesPage>,
        event: &InstanceInvitesEvent,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(core) = self.core() else {
            return;
        };
        match event.clone() {
            InstanceInvitesEvent::Create(draft) => self
                .admin_command("creating an invite", async move {
                    core.create_instance_invite(draft).await
                }),
            InstanceInvitesEvent::Delete { code } => self
                .admin_command("deleting an invite", async move {
                    core.delete_instance_invite(code).await
                }),
            InstanceInvitesEvent::CopyLink { url } => {
                cx.write_to_clipboard(ClipboardItem::new_string(url));
            }
            InstanceInvitesEvent::Retry => core.retry_failed(),
        }
    }

    fn on_admin_roles(
        &mut self,
        screen: &Entity<InstanceRolesPage>,
        event: &InstanceRolesEvent,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(core) = self.core() else {
            return;
        };
        match event.clone() {
            InstanceRolesEvent::Create(draft) => self
                .admin_command("creating an instance role", async move {
                    core.create_instance_role(draft).await
                }),
            InstanceRolesEvent::Update { role_id, draft } => self
                .admin_command("saving an instance role", async move {
                    core.update_instance_role(role_id, draft).await
                }),
            InstanceRolesEvent::Delete { role_id } => self
                .admin_command("deleting an instance role", async move {
                    core.delete_instance_role(role_id).await
                }),
            InstanceRolesEvent::OpenUsers { role_id } => {
                if let Some(open) = self.admin.open.as_mut() {
                    open.role = Some(role_id.clone());
                }
                let view = core.instance_role_users(role_id);
                screen.update(cx, |screen, cx| screen.set_role_users(Some(view), cx));
            }
            InstanceRolesEvent::Retry => core.retry_failed(),
        }
    }

    fn on_admin_storage(
        &mut self,
        screen: &Entity<StoragePage>,
        event: &StorageEvent,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(core) = self.core() else {
            return;
        };
        match event.clone() {
            StorageEvent::Filter(min_percent) => {
                let Some(open) = self.admin.open.clone() else {
                    return;
                };
                if open.page != AdminPage::Storage {
                    return;
                }
                if let Some(open) = self.admin.open.as_mut() {
                    open.storage_min_percent = min_percent;
                }
                let view = core.admin_storage(min_percent);
                screen.update(cx, |screen, cx| screen.set_view(view, cx));
            }
            StorageEvent::LoadMore => {
                let Some(min_percent) = self
                    .admin
                    .open
                    .as_ref()
                    .map(|open| open.storage_min_percent)
                else {
                    return;
                };
                self.admin_command("loading more storage rows", async move {
                    core.load_more_storage(min_percent).await
                });
            }
            StorageEvent::SetQuota {
                user_id,
                quota_bytes,
            } => self.admin_command("setting a user's quota", async move {
                core.set_user_quota(user_id, quota_bytes).await
            }),
            StorageEvent::Recalculate { user_id } => self
                .admin_command("recalculating storage", async move {
                    core.recalculate_storage(user_id).await
                }),
            StorageEvent::Retry => core.retry_failed(),
        }
    }
}

#[cfg(test)]
mod tests {
    // Not `super::*`: gpui_kit's glob brings its own `test` attribute.
    use super::{Feed, OpenState, ViewKey, account_admin_button, feeds};
    use semaphore_core::model::{AdminPage, AdminUserQuery, InstanceAdminCaps};

    fn for_page(page: AdminPage) -> OpenState {
        OpenState::new(page)
    }

    fn search(query: &str) -> AdminUserQuery {
        AdminUserQuery {
            search: query.into(),
            ..AdminUserQuery::default()
        }
    }

    #[test]
    fn each_view_feeds_its_own_page_and_nothing_else() {
        type Case = (
            AdminPage,
            ViewKey,
            Vec<Feed>,
            // A view of another page, which feeds nothing.
            ViewKey,
        );
        let cases: Vec<Case> = vec![
            (
                AdminPage::Dashboard,
                ViewKey::AdminDashboard,
                vec![Feed::Dashboard],
                ViewKey::InstanceSettings,
            ),
            (
                AdminPage::Settings,
                ViewKey::InstanceSettings,
                vec![Feed::Settings],
                ViewKey::AdminDashboard,
            ),
            (
                AdminPage::Users,
                ViewKey::AdminUsers {
                    query: AdminUserQuery::default(),
                },
                vec![Feed::Users],
                ViewKey::AdminDashboard,
            ),
            (
                AdminPage::Communities,
                ViewKey::AdminCommunities {
                    search: String::new(),
                },
                vec![Feed::Communities(String::new())],
                ViewKey::AdminInvites,
            ),
            (
                AdminPage::Invites,
                ViewKey::AdminInvites,
                vec![Feed::Invites],
                ViewKey::InstanceRoles,
            ),
            (
                AdminPage::Invites,
                ViewKey::Communities,
                vec![Feed::InviteCommunities],
                ViewKey::AdminDashboard,
            ),
            (
                AdminPage::Roles,
                ViewKey::InstanceRoles,
                vec![Feed::Roles],
                ViewKey::AdminInvites,
            ),
            (
                AdminPage::Storage,
                ViewKey::AdminStorage { min_percent: 0 },
                vec![Feed::Storage],
                ViewKey::InstanceRoles,
            ),
        ];
        for (page, view, want, other) in cases {
            let open = for_page(page);
            assert_eq!(feeds(&view, &open), want, "{view:?} on {page:?}");
            assert!(feeds(&other, &open).is_empty(), "{other:?} on {page:?}");
        }
    }

    #[test]
    fn the_caps_feed_whatever_page_is_open() {
        for page in [
            AdminPage::Dashboard,
            AdminPage::Users,
            AdminPage::Communities,
            AdminPage::Invites,
            AdminPage::Roles,
            AdminPage::Storage,
            AdminPage::Settings,
        ] {
            assert_eq!(
                feeds(&ViewKey::InstancePermissions, &for_page(page)),
                vec![Feed::Caps],
                "{page:?}"
            );
        }
    }

    #[test]
    fn what_is_not_open_feeds_nothing() {
        let mut open = for_page(AdminPage::Users);
        open.users_query = search("pri");
        open.user = Some("u1".into());
        open.community = Some("c1".into());
        open.role = Some("r1".into());
        open.storage_min_percent = 90;
        assert_eq!(
            feeds(
                &ViewKey::AdminUsers {
                    query: search("pri")
                },
                &open
            ),
            vec![Feed::Users]
        );
        assert!(
            feeds(
                &ViewKey::AdminUsers {
                    query: search("die")
                },
                &open
            )
            .is_empty()
        );
        assert_eq!(
            feeds(
                &ViewKey::AdminUser {
                    user_id: "u1".into()
                },
                &open
            ),
            vec![Feed::User("u1".into())]
        );
        assert!(
            feeds(
                &ViewKey::AdminUser {
                    user_id: "u2".into()
                },
                &open
            )
            .is_empty()
        );
        assert_eq!(
            feeds(
                &ViewKey::AdminUserRoles {
                    user_id: "u1".into()
                },
                &open
            ),
            vec![Feed::UserRoles("u1".into())]
        );
        // Views the pages beside it own.
        assert!(
            feeds(
                &ViewKey::AdminCommunity {
                    community_id: "c1".into()
                },
                &open
            )
            .is_empty()
        );
        assert!(
            feeds(
                &ViewKey::InstanceRoleUsers {
                    role_id: "r1".into()
                },
                &open
            )
            .is_empty()
        );
        assert!(feeds(&ViewKey::AdminStorage { min_percent: 90 }, &open).is_empty());

        let mut open = for_page(AdminPage::Communities);
        open.communities_search = "co".into();
        open.community = Some("c1".into());
        assert_eq!(
            feeds(
                &ViewKey::AdminCommunities {
                    search: "co".into()
                },
                &open
            ),
            vec![Feed::Communities("co".into())]
        );
        assert!(
            feeds(
                &ViewKey::AdminCommunities {
                    search: String::new()
                },
                &open
            )
            .is_empty()
        );
        assert_eq!(
            feeds(
                &ViewKey::AdminCommunity {
                    community_id: "c1".into()
                },
                &open
            ),
            vec![Feed::CommunityDetail("c1".into())]
        );
        assert!(
            feeds(
                &ViewKey::AdminCommunity {
                    community_id: "c2".into()
                },
                &open
            )
            .is_empty()
        );

        let mut open = for_page(AdminPage::Roles);
        open.role = Some("r1".into());
        assert_eq!(
            feeds(
                &ViewKey::InstanceRoleUsers {
                    role_id: "r1".into()
                },
                &open
            ),
            vec![Feed::RoleUsers("r1".into())]
        );
        assert!(
            feeds(
                &ViewKey::InstanceRoleUsers {
                    role_id: "r2".into()
                },
                &open
            )
            .is_empty()
        );

        let mut open = for_page(AdminPage::Storage);
        open.storage_min_percent = 90;
        assert_eq!(
            feeds(&ViewKey::AdminStorage { min_percent: 90 }, &open),
            vec![Feed::Storage]
        );
        assert!(feeds(&ViewKey::AdminStorage { min_percent: 0 }, &open).is_empty());
    }

    #[test]
    fn the_admin_entry_shows_only_with_an_admin_permission() {
        let none = account_admin_button(&InstanceAdminCaps::default(), |_, _, _| {});
        assert!(none.is_none());
        let caps = InstanceAdminCaps {
            show_admin: true,
            ..InstanceAdminCaps::default()
        };
        assert!(account_admin_button(&caps, |_, _, _| {}).is_some());
    }
}
