//! UA1: the admin area's frame: the page list (Dashboard, Users, Communities, Invites, Roles,
//! Storage, Settings; a page shows only when `InstanceAdminCaps` allows it), the open page beside
//! it, and on a phone a list that drills into a page with a back arrow. After
//! `components/admin/AdminLayout.tsx`.
//!
//! The public API is the UI freeze's: `new`, the setters and `AdminShellEvent`.

use crate::community_settings::common::{loading_rows, locked_note, phone};
use crate::community_settings::rules::needs;
use crate::kit::{ListRow, Variant, spacing, text};
use crate::panel::common::{design_icon, icon_button};
use crate::theme::SemTheme;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{AdminPage, InstanceAdminCaps};
use semaphore_design::Icon as DesignIcon;

#[cfg(feature = "stories")]
mod stories;
#[cfg(test)]
mod tests;

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
    /// On a phone, a page was picked: draw it instead of the list.
    phone_open: bool,
}

impl EventEmitter<AdminShellEvent> for AdminShell {}

/// The pages in the web's order, with the web's labels (`AdminLayout.tsx`).
const PAGES: [AdminPage; 7] = [
    AdminPage::Dashboard,
    AdminPage::Users,
    AdminPage::Communities,
    AdminPage::Invites,
    AdminPage::Roles,
    AdminPage::Storage,
    AdminPage::Settings,
];

fn label(page: AdminPage) -> &'static str {
    match page {
        AdminPage::Dashboard => "Dashboard",
        AdminPage::Users => "Users",
        AdminPage::Communities => "Communities",
        AdminPage::Invites => "Invites",
        AdminPage::Roles => "Roles",
        AdminPage::Storage => "Storage",
        AdminPage::Settings => "Settings",
    }
}

/// The id suffix: `admin-page-<key>`.
fn key(page: AdminPage) -> &'static str {
    match page {
        AdminPage::Dashboard => "dashboard",
        AdminPage::Users => "users",
        AdminPage::Communities => "communities",
        AdminPage::Invites => "invites",
        AdminPage::Roles => "roles",
        AdminPage::Storage => "storage",
        AdminPage::Settings => "settings",
    }
}

fn icon(page: AdminPage) -> DesignIcon {
    match page {
        AdminPage::Dashboard => DesignIcon::Dashboard,
        AdminPage::Users => DesignIcon::People,
        AdminPage::Communities => DesignIcon::Groups,
        AdminPage::Invites => DesignIcon::Link,
        AdminPage::Roles => DesignIcon::Security,
        AdminPage::Storage => DesignIcon::Storage,
        AdminPage::Settings => DesignIcon::Settings,
    }
}

/// What gates a page, from `caps_from` in core: whether the caps allow it and the permission
/// its reason names. One row per page, so a reason can't drift from its gate.
fn gate(caps: &InstanceAdminCaps, page: AdminPage) -> (bool, &'static str) {
    match page {
        AdminPage::Dashboard => (caps.dashboard, "Read instance stats"),
        AdminPage::Users => (caps.users_read, "Read users"),
        AdminPage::Communities => (caps.communities_read, "Read all communities"),
        AdminPage::Invites => (caps.invites_read, "Read instance invites"),
        // Core maps `roles_read` to READ_INSTANCE_SETTINGS, as the backend's instance roles
        // list (`GET roles/instance/all`) does.
        AdminPage::Roles => (caps.roles_read, "Read instance settings"),
        AdminPage::Storage => (caps.storage, "Manage user storage"),
        AdminPage::Settings => (caps.settings_read, "Read instance settings"),
    }
}

impl AdminShell {
    pub fn new(_window: &mut Window, _cx: &mut Context<Self>) -> Self {
        Self {
            caps: InstanceAdminCaps::default(),
            page: AdminPage::Dashboard,
            content: None,
            phone_open: false,
        }
    }

    /// What this user may do on the instance (`InstancePermissionsView::admin`).
    pub fn set_caps(&mut self, caps: InstanceAdminCaps, cx: &mut Context<Self>) {
        self.caps = caps;
        cx.notify();
    }

    /// The page shown (from the route). On a phone this opens it, rather than showing the list.
    pub fn set_page(&mut self, page: AdminPage, cx: &mut Context<Self>) {
        self.page = page;
        self.phone_open = true;
        cx.notify();
    }

    /// The open page's view, built by the owner.
    pub fn set_content(&mut self, content: Option<AnyView>, cx: &mut Context<Self>) {
        self.content = content;
        cx.notify();
    }

    fn pick(&mut self, page: AdminPage, cx: &mut Context<Self>) {
        self.page = page;
        self.phone_open = true;
        cx.emit(AdminShellEvent::Open(page));
        cx.notify();
    }

    fn locked(&self, page: AdminPage) -> Option<String> {
        let (allowed, permission) = gate(&self.caps, page);
        (!allowed).then(|| needs(permission))
    }

    fn content(&self, window: &Window) -> AnyElement {
        match &self.content {
            Some(view) => view.clone().into_any_element(),
            None => div()
                .size_full()
                .p(spacing(if phone(window) { 2. } else { 3. }))
                .child(loading_rows("admin-content-loading", "Loading page", 4))
                .into_any_element(),
        }
    }

    fn nav(&self, phone: bool, cx: &mut Context<Self>) -> AnyElement {
        let sem = cx.sem().clone();
        let header = div()
            .flex()
            .items_center()
            .gap(spacing(1.))
            .px(spacing(2.))
            .min_h(px(if phone { 56. } else { 64. }))
            .child(
                text(Variant::H6, "Admin")
                    .flex_1()
                    .min_w_0()
                    .truncate()
                    .text_color(sem.text_primary),
            );
        let rows: Vec<_> = PAGES
            .into_iter()
            .map(|page| {
                let view = cx.weak_entity();
                let locked = self.locked(page);
                let colour = if locked.is_some() {
                    sem.text_disabled
                } else if !phone && page == self.page {
                    sem.primary
                } else {
                    sem.action_active
                };
                let mut row = ListRow::new(
                    SharedString::from(format!("admin-page-{}", key(page))),
                    label(page),
                )
                .leading(design_icon(icon(page), 22., colour))
                .selected(!phone && page == self.page)
                .disabled(locked.is_some());
                if locked.is_none() {
                    row = row.on_click(move |_, cx| {
                        view.update(cx, |shell, cx| shell.pick(page, cx)).ok();
                    });
                    if phone {
                        row = row.trailing(design_icon(
                            DesignIcon::ChevronRight,
                            22.,
                            sem.text_secondary,
                        ));
                    }
                }
                match locked {
                    // The nav is narrow: the reason wraps under the entry rather than ending
                    // in an ellipsis.
                    Some(reason) => div()
                        .flex()
                        .flex_col()
                        .child(row)
                        .child(div().pl(px(50.)).pr(spacing(1.5)).pb(spacing(0.5)).child(
                            locked_note(
                                SharedString::from(format!("admin-page-{}-locked", key(page))),
                                reason,
                                cx,
                            ),
                        ))
                        .into_any_element(),
                    None => row.into_any_element(),
                }
            })
            .collect();
        let exit_view = cx.weak_entity();
        let exit = ListRow::new("admin-exit", "Back to the app")
            .leading(design_icon(DesignIcon::ExitToApp, 22., sem.text_secondary))
            .on_click(move |_, cx| {
                exit_view
                    .update(cx, |_, cx| cx.emit(AdminShellEvent::Back))
                    .ok();
            });
        div()
            .id("admin-nav")
            .test_support()
            .role(Role::Navigation)
            .aria_label("Admin pages")
            .flex()
            .flex_col()
            .size_full()
            .child(header)
            .child(
                div()
                    .id("admin-nav-scroll")
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scroll()
                    .px(spacing(1.))
                    .pb(spacing(1.))
                    .flex()
                    .flex_col()
                    .children(rows),
            )
            .child(
                div()
                    .flex_shrink_0()
                    .border_t_1()
                    .border_color(sem.divider)
                    .p(spacing(1.))
                    .child(exit),
            )
            .into_any_element()
    }
}

impl Render for AdminShell {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let sem = cx.sem().clone();
        let root = div()
            .id("admin-shell")
            .test_support()
            .role(Role::Region)
            .aria_label("Admin")
            .size_full()
            .flex()
            .bg(sem.background_default);
        if !phone(window) {
            return root
                .child(
                    div()
                        .w(px(260.))
                        .flex_shrink_0()
                        .h_full()
                        .bg(sem.paper)
                        .border_r_1()
                        .border_color(sem.divider)
                        .child(self.nav(false, cx)),
                )
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .h_full()
                        .flex()
                        .justify_center()
                        .child(
                            div()
                                .w_full()
                                .max_w(px(1100.))
                                .h_full()
                                .child(self.content(window)),
                        ),
                );
        }
        if !self.phone_open {
            return root.child(div().size_full().bg(sem.paper).child(self.nav(true, cx)));
        }
        let bar = div()
            .flex_shrink_0()
            .flex()
            .items_center()
            .gap(spacing(1.))
            .px(spacing(1.))
            .min_h(px(56.))
            .border_b_1()
            .border_color(sem.divider)
            .bg(sem.paper)
            .child(
                icon_button(
                    "admin-back",
                    DesignIcon::ArrowBack,
                    "Back to admin pages",
                    true,
                    sem.action_active,
                    cx,
                )
                .on_click(cx.listener(|shell, _, _, cx| {
                    shell.phone_open = false;
                    cx.emit(AdminShellEvent::Back);
                    cx.notify();
                })),
            )
            .child(
                text(Variant::H6, label(self.page))
                    .flex_1()
                    .min_w_0()
                    .truncate()
                    .text_color(sem.text_primary),
            );
        root.flex_col()
            .child(bar)
            .child(div().flex_1().min_h_0().child(self.content(window)))
    }
}

#[cfg(feature = "stories")]
pub fn stories() -> Vec<crate::stories::Story> {
    stories::stories()
}
