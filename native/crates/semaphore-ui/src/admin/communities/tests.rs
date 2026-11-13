//! The communities page in a window: what the search, the paging, a row, the delete confirm and
//! the caps send.

use super::CommunitiesPage;
use super::fixtures::*;
use crate::dms::rig::{Rig, rig};
use core::prelude::v1::test;
use gpui_kit::TestAppContext;
use semaphore_core::model::{
    AdminActionKind as K, AdminCommunitiesView, AdminCommunityView, AdminOp, InstanceAdminCaps,
    LoadState,
};
use std::time::Duration;

fn page_rig(
    cx: &mut TestAppContext,
    caps: InstanceAdminCaps,
    view: AdminCommunitiesView,
) -> Rig<CommunitiesPage, super::CommunitiesEvent> {
    rig(cx, 1200., move |window, cx| {
        let mut page = CommunitiesPage::new(window, cx);
        page.set_time(crate::messages::TimeFormat::fixed(
            crate::messages::fixture::NOW_MS,
        ));
        page.set_caps(caps, cx);
        page.set_view(view, cx);
        page
    })
}

fn with_detail(
    rig: &Rig<CommunitiesPage, super::CommunitiesEvent>,
    cx: &mut TestAppContext,
    detail: AdminCommunityView,
) {
    rig.with(cx, |view, _, cx| {
        view.update(cx, |page, cx| page.set_detail(Some(detail), cx))
    });
}

#[gpui_kit::test]
fn search_emits_after_the_debounce(cx: &mut TestAppContext) {
    let rig = page_rig(cx, owner(), ready());
    rig.with(cx, |view, _, cx| {
        view.update(cx, |page, cx| {
            page.query_changed("nor", cx);
            page.query_changed("north", cx);
        })
    });
    assert!(rig.events().is_empty(), "nothing until typing stops");
    cx.executor().advance_clock(Duration::from_millis(350));
    cx.run_until_parked();
    assert_eq!(
        rig.events(),
        [super::CommunitiesEvent::Search("north".into())]
    );
    rig.clear();
    rig.with(cx, |view, _, cx| {
        view.update(cx, |page, cx| page.query_changed("north", cx))
    });
    cx.executor().advance_clock(Duration::from_millis(350));
    cx.run_until_parked();
    assert!(rig.events().is_empty(), "the same query again");
}

#[gpui_kit::test]
fn load_more_only_when_more(cx: &mut TestAppContext) {
    let rig = page_rig(
        cx,
        owner(),
        view(LoadState::Ready, rows(), true, false, AdminOp::default()),
    );
    rig.click(cx, "admin-communities-more");
    assert_eq!(rig.events(), [super::CommunitiesEvent::LoadMore]);

    let rig = page_rig(cx, owner(), ready());
    assert!(!rig.has(cx, "admin-communities-more"), "no next page");

    rig.clear();
    let rig = page_rig(
        cx,
        owner(),
        view(LoadState::Ready, rows(), true, true, AdminOp::default()),
    );
    rig.click(cx, "admin-communities-more");
    assert!(rig.events().is_empty(), "a page is on its way");
}

#[gpui_kit::test]
fn open_emits_the_row(cx: &mut TestAppContext) {
    let rig = page_rig(cx, owner(), ready());
    rig.click(cx, "admin-community-c-nightowl");
    assert_eq!(
        rig.events(),
        [super::CommunitiesEvent::Open {
            community_id: "c-nightowl".into()
        }]
    );
}

#[gpui_kit::test]
fn force_delete_needs_the_typed_name(cx: &mut TestAppContext) {
    let rig = page_rig(cx, owner(), ready());
    let community = rows()[0].clone();
    with_detail(
        &rig,
        cx,
        detail(Some(community.clone()), 4_812, AdminOp::default()),
    );
    rig.click(cx, "admin-community-delete");
    assert!(rig.has(cx, "admin-community-delete-confirm"));
    rig.click(cx, "admin-community-delete-confirm");
    assert!(rig.events().is_empty(), "nothing typed");

    rig.with(cx, |view, window, cx| {
        view.update(cx, |page, cx| {
            page.open_delete("northwind makers", window, cx)
        })
    });
    rig.click(cx, "admin-community-delete-confirm");
    assert!(rig.events().is_empty(), "wrong case");

    rig.with(cx, |view, window, cx| {
        view.update(cx, |page, cx| {
            page.open_delete("Northwind Makers", window, cx)
        })
    });
    rig.click(cx, "admin-community-delete-confirm");
    assert_eq!(
        rig.events(),
        [super::CommunitiesEvent::ForceDelete {
            community_id: community.id.clone()
        }]
    );
}

#[gpui_kit::test]
fn force_delete_disabled_without_the_permission(cx: &mut TestAppContext) {
    let rig = page_rig(cx, reader(), ready());
    with_detail(
        &rig,
        cx,
        detail(Some(rows()[0].clone()), 4_812, AdminOp::default()),
    );
    assert!(
        rig.has(cx, "admin-community-delete-locked"),
        "the reason is shown"
    );
    rig.click(cx, "admin-community-delete");
    assert!(rig.events().is_empty());
    assert!(!rig.has(cx, "admin-community-delete-confirm"));
}

#[gpui_kit::test]
fn a_reader_without_the_permission_sees_why(cx: &mut TestAppContext) {
    let rig = page_rig(cx, InstanceAdminCaps::default(), ready());
    assert!(rig.has(cx, "admin-communities-locked"));
    assert!(!rig.has(cx, "admin-communities-search"));
}

#[gpui_kit::test]
fn a_failed_read_asks_again(cx: &mut TestAppContext) {
    let rig = page_rig(
        cx,
        owner(),
        view(failed(), Vec::new(), false, false, AdminOp::default()),
    );
    rig.click(cx, "admin-communities-retry");
    assert_eq!(rig.events(), [super::CommunitiesEvent::Retry]);
}

/// A page's delete failure is that action's, so the detail keeps it beside the button.
#[gpui_kit::test]
fn a_refused_delete_stays_on_its_action(cx: &mut TestAppContext) {
    let rig = page_rig(cx, owner(), ready());
    let community = rows()[0].clone();
    with_detail(
        &rig,
        cx,
        detail(
            Some(community.clone()),
            4_812,
            erred(
                K::ForceDeleteCommunity,
                Some(&community.id),
                "The owner must do it.",
            ),
        ),
    );
    assert!(rig.has(cx, "admin-communities-list"), "still the list");
    assert!(rig.has(cx, "admin-community-delete"), "and the detail");
    assert!(
        rig.has(cx, "admin-community-delete-error"),
        "the refusal sits by the button that sent it"
    );
}
