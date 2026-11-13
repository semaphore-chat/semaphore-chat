//! The communities page's stories: loading, empty, failed, ready, sixty long rows with a next page,
//! a page loading more, the detail card, the delete confirm, that confirm busy and refused, a
//! reader without the delete permission, a user who can't read the list at all, and the phone
//! layout. `rigs/shot/scripts/ua4-admin-communities-invites.steps` renders them on a desktop (dark)
//! and a phone (light).

use super::CommunitiesPage;
use super::fixtures::*;
use crate::messages::TimeFormat;
use crate::stories::{Story, StoryEnv};
use gpui_kit::*;
use semaphore_core::model::{
    AdminActionKind as K, AdminCommunitiesView, AdminCommunityView, AdminOp, InstanceAdminCaps,
    LoadState,
};

fn now() -> i64 {
    crate::messages::fixture::NOW_MS
}

fn build(
    caps: InstanceAdminCaps,
    view: AdminCommunitiesView,
    window: &mut Window,
    cx: &mut App,
    tweak: impl FnOnce(&mut CommunitiesPage, &mut Window, &mut Context<CommunitiesPage>),
) -> AnyView {
    cx.new(|cx| {
        let mut page = CommunitiesPage::new(window, cx);
        page.set_time(TimeFormat::fixed(now()));
        page.set_caps(caps, cx);
        page.set_view(view, cx);
        tweak(&mut page, window, cx);
        page
    })
    .into()
}

fn plain(
    caps: InstanceAdminCaps,
    view: AdminCommunitiesView,
    window: &mut Window,
    cx: &mut App,
) -> AnyView {
    build(caps, view, window, cx, |_, _, _| {})
}

fn opened(
    caps: InstanceAdminCaps,
    view: AdminCommunitiesView,
    detail: AdminCommunityView,
    window: &mut Window,
    cx: &mut App,
    tweak: impl FnOnce(&mut CommunitiesPage, &mut Window, &mut Context<CommunitiesPage>),
) -> AnyView {
    build(caps, view, window, cx, move |page, window, cx| {
        page.set_detail(Some(detail), cx);
        tweak(page, window, cx);
    })
}

type Build = fn(&StoryEnv, &mut Window, &mut App) -> AnyView;

pub(super) fn stories() -> Vec<Story> {
    let all: Vec<(&'static str, Build)> = vec![
        ("admin-communities-loading", |_, w, cx| {
            plain(
                owner(),
                view(
                    LoadState::Loading,
                    Vec::new(),
                    false,
                    false,
                    AdminOp::default(),
                ),
                w,
                cx,
            )
        }),
        ("admin-communities-empty", |_, w, cx| {
            plain(
                owner(),
                view(
                    LoadState::Ready,
                    Vec::new(),
                    false,
                    false,
                    AdminOp::default(),
                ),
                w,
                cx,
            )
        }),
        ("admin-communities-failed", |_, w, cx| {
            plain(
                owner(),
                view(failed(), Vec::new(), false, false, AdminOp::default()),
                w,
                cx,
            )
        }),
        ("admin-communities-ready", |_, w, cx| {
            plain(owner(), ready(), w, cx)
        }),
        ("admin-communities-long", |_, w, cx| {
            let searched = AdminCommunitiesView {
                search: "makers".into(),
                ..view(
                    LoadState::Ready,
                    long_rows(),
                    true,
                    false,
                    AdminOp::default(),
                )
            };
            build(owner(), searched, w, cx, |page, window, cx| {
                page.preset_search("makers", window, cx);
            })
        }),
        ("admin-communities-loading-more", |_, w, cx| {
            plain(
                owner(),
                view(LoadState::Ready, rows(), true, true, AdminOp::default()),
                w,
                cx,
            )
        }),
        ("admin-communities-detail", |_, w, cx| {
            opened(
                owner(),
                ready(),
                detail(Some(rows()[0].clone()), 4_812, AdminOp::default()),
                w,
                cx,
                |_, _, _| {},
            )
        }),
        ("admin-communities-delete-confirm", |_, w, cx| {
            opened(
                owner(),
                ready(),
                detail(Some(rows()[0].clone()), 4_812, AdminOp::default()),
                w,
                cx,
                |page, window, cx| page.open_delete("", window, cx),
            )
        }),
        ("admin-communities-delete-busy", |_, w, cx| {
            let community = rows()[0].clone();
            opened(
                owner(),
                ready(),
                detail(
                    Some(community.clone()),
                    4_812,
                    busy(K::ForceDeleteCommunity, Some(&community.id)),
                ),
                w,
                cx,
                |page, window, cx| page.open_delete("Northwind Makers", window, cx),
            )
        }),
        ("admin-communities-delete-refused", |_, w, cx| {
            let community = rows()[0].clone();
            opened(
                owner(),
                ready(),
                detail(
                    Some(community.clone()),
                    4_812,
                    erred(
                        K::ForceDeleteCommunity,
                        Some(&community.id),
                        "The community's owner must delete it first.",
                    ),
                ),
                w,
                cx,
                |page, window, cx| page.open_delete("Northwind Makers", window, cx),
            )
        }),
        ("admin-communities-read-only", |_, w, cx| {
            opened(
                reader(),
                ready(),
                detail(Some(rows()[0].clone()), 4_812, AdminOp::default()),
                w,
                cx,
                |_, _, _| {},
            )
        }),
        ("admin-communities-locked", |_, w, cx| {
            plain(
                InstanceAdminCaps::default(),
                view(
                    LoadState::Loading,
                    Vec::new(),
                    false,
                    false,
                    AdminOp::default(),
                ),
                w,
                cx,
            )
        }),
        ("admin-communities-phone", |_, w, cx| {
            let listed = rows().into_iter().take(2).collect();
            opened(
                owner(),
                view(LoadState::Ready, listed, false, false, AdminOp::default()),
                detail(Some(rows()[0].clone()), 4_812, AdminOp::default()),
                w,
                cx,
                |_, _, _| {},
            )
        }),
    ];
    all.into_iter()
        .map(|(name, build)| Story::new(name, build))
        .collect()
}
