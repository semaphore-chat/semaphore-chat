//! The dashboard's stories: loading, ready, each attention severity and target, all good, the
//! storage read still loading or failed, the page's read failed, fewer permissions, no access, long
//! numbers and names, and a server without a disk figure. `rigs/shot/scripts/ua2-admin-dashboard.steps`
//! renders them all on a desktop (dark) and a phone (light).

use super::DashboardPage;
use super::fixtures::*;
use crate::stories::{Story, StoryEnv};
use crate::theme::SemTheme;
use gpui_kit::*;
use semaphore_core::model::{AdminDashboardView, AttentionSeverity, InstanceAdminCaps};

fn page(
    caps: InstanceAdminCaps,
    view: AdminDashboardView,
    window: &mut Window,
    cx: &mut App,
) -> AnyView {
    cx.new(|cx| {
        let mut page = DashboardPage::new(window, cx);
        page.set_caps(caps, cx);
        page.set_view(view, cx);
        page
    })
    .into()
}

/// The dashboard in the column the admin shell gives it: 260 px of page list at the left, then a
/// content column at most 1100 px wide, as `AdminShell` lays them out on a desktop.
struct InShell {
    list: AnyView,
    page: AnyView,
}

impl Render for InShell {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let sem = cx.sem().clone();
        div()
            .size_full()
            .flex()
            .bg(sem.background_default)
            .child(
                div()
                    .w(px(super::SHELL_LIST))
                    .flex_shrink_0()
                    .h_full()
                    .bg(sem.paper)
                    .border_r_1()
                    .border_color(sem.divider)
                    .child(self.list.clone()),
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
                            .max_w(px(super::SHELL_CONTENT_MAX))
                            .h_full()
                            .child(self.page.clone()),
                    ),
            )
    }
}

/// An empty stand-in for the page list.
struct List;

impl Render for List {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div()
    }
}

fn in_shell(view: AdminDashboardView, window: &mut Window, cx: &mut App) -> AnyView {
    let page = page(owner(), view, window, cx);
    let list: AnyView = cx.new(|_| List).into();
    cx.new(|_| InShell { list, page }).into()
}

type Build = fn(&StoryEnv, &mut Window, &mut App) -> AnyView;

pub(super) fn stories() -> Vec<Story> {
    let all: Vec<(&'static str, Build)> = vec![
        ("admin-dashboard-loading", |_, w, cx| {
            page(owner(), AdminDashboardView::default(), w, cx)
        }),
        ("admin-dashboard-ready", |_, w, cx| {
            page(
                owner(),
                ready(Some(storage(42., 3)), vec![over_quota_item("3", false)]),
                w,
                cx,
            )
        }),
        ("admin-dashboard-attention", |_, w, cx| {
            page(owner(), attention_view(), w, cx)
        }),
        ("admin-dashboard-disk-warning", |_, w, cx| {
            page(
                owner(),
                ready(
                    Some(storage(85., 0)),
                    vec![disk_item(AttentionSeverity::Warning, 85)],
                ),
                w,
                cx,
            )
        }),
        ("admin-dashboard-healthy", |_, w, cx| {
            page(owner(), ready(Some(storage(42., 0)), Vec::new()), w, cx)
        }),
        ("admin-dashboard-storage-loading", |_, w, cx| {
            page(owner(), ready(None, Vec::new()), w, cx)
        }),
        ("admin-dashboard-storage-failed", |_, w, cx| {
            page(
                owner(),
                ready(None, vec![storage_unavailable_item()]),
                w,
                cx,
            )
        }),
        ("admin-dashboard-failed", |_, w, cx| {
            page(owner(), failed_view(), w, cx)
        }),
        ("admin-dashboard-limited", |_, w, cx| {
            page(dashboard_only(), attention_view(), w, cx)
        }),
        ("admin-dashboard-denied", |_, w, cx| {
            page(
                InstanceAdminCaps::default(),
                AdminDashboardView::default(),
                w,
                cx,
            )
        }),
        ("admin-dashboard-long", |_, w, cx| {
            page(owner(), long_view(), w, cx)
        }),
        ("admin-dashboard-in-shell", |_, w, cx| {
            in_shell(
                ready(Some(storage(42., 3)), vec![over_quota_item("3", false)]),
                w,
                cx,
            )
        }),
        ("admin-dashboard-in-shell-long", |_, w, cx| {
            in_shell(long_view(), w, cx)
        }),
        ("admin-dashboard-no-disk", |_, w, cx| {
            page(owner(), no_disk_view(), w, cx)
        }),
    ];
    all.into_iter()
        .map(|(name, build)| Story::new(name, build))
        .collect()
}
