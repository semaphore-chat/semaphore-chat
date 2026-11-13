//! The formatting the web does (counts, uptime, sizes), then the page in a window: what each tile
//! and attention action sends, what a missing permission turns off, and which sections show.

use super::fixtures::*;
use super::*;
use crate::dms::rig::{Rig, rig};
use core::prelude::v1::test;
use gpui_kit::TestAppContext;

fn page_rig(
    cx: &mut TestAppContext,
    width: f32,
    caps: InstanceAdminCaps,
    view: AdminDashboardView,
) -> Rig<DashboardPage, DashboardEvent> {
    rig(cx, width, move |window, cx| {
        let mut page = DashboardPage::new(window, cx);
        page.set_caps(caps, cx);
        page.set_view(view, cx);
        page
    })
}

fn open(page: AdminPage, storage_min_percent: Option<u32>) -> DashboardEvent {
    DashboardEvent::Open {
        page,
        storage_min_percent,
    }
}

#[test]
fn counts_and_uptime_format_like_the_web() {
    assert_eq!(count_label(0), "0");
    assert_eq!(count_label(999), "999");
    assert_eq!(count_label(1_000), "1,000");
    assert_eq!(count_label(999_999), "999,999");
    assert_eq!(count_label(1_000_000), "1M");
    assert_eq!(count_label(1_234_567), "1.2M");
    assert_eq!(count_label(12_345_678), "12.3M");
    assert_eq!(count_label(999_950_000), "1B");
    assert_eq!(count_label(1_234_567_890), "1.2B");
    assert_eq!(count_label(98_765_432_109), "98.8B");
    assert_eq!(count_label(2_500_000_000_000), "2.5T");
    assert_eq!(count_label(u64::MAX), "18446744.1T");

    assert_eq!(uptime_label(0), "0m");
    assert_eq!(uptime_label(59), "0m");
    assert_eq!(uptime_label(7 * 60), "7m");
    assert_eq!(uptime_label(4 * 3_600 + 5 * 60), "4h 5m");
    assert_eq!(uptime_label(2 * 86_400 + 3 * 3_600 + 59), "2d 3h");

    assert_eq!(bytes_label(0), "0 Bytes");
    assert_eq!(bytes_label(1), "1 Bytes");
    assert_eq!(bytes_label(1_023), "1023 Bytes");
    assert_eq!(bytes_label(1_024), "1 KB");
    assert_eq!(bytes_label(1_536), "1.5 KB");
    assert_eq!(bytes_label(500 * 1024 * 1024), "500 MB");
    assert_eq!(bytes_label(10 * 1024 * 1024 * 1024), "10 GB");
    assert_eq!(bytes_label(1024u64.pow(5) * 3), "3 PB");
    assert_eq!(bytes_label(1024u64.pow(6)), "1024 PB");

    assert_eq!(grouped(1_234_567), "1,234,567");
    assert_eq!(grouped(100), "100");
}

#[gpui_kit::test]
fn tile_opens_its_page(cx: &mut TestAppContext) {
    let rig = page_rig(cx, 1200., owner(), healthy());
    rig.click(cx, "admin-tile-users");
    rig.click(cx, "admin-tile-communities");
    rig.click(cx, "admin-tile-channels");
    rig.click(cx, "admin-tile-invites");
    rig.click(cx, "admin-tile-banned");
    rig.click(cx, "admin-tile-messages");
    assert_eq!(
        rig.events(),
        [
            open(AdminPage::Users, None),
            open(AdminPage::Communities, None),
            open(AdminPage::Communities, None),
            open(AdminPage::Invites, None),
            open(AdminPage::Users, None),
        ]
    );
    // The same on a phone.
    let rig = page_rig(cx, 390., owner(), healthy());
    rig.click(cx, "admin-tile-users");
    assert_eq!(rig.events(), [open(AdminPage::Users, None)]);
}

#[gpui_kit::test]
fn tile_without_access_emits_nothing(cx: &mut TestAppContext) {
    let rig = page_rig(cx, 1200., dashboard_only(), healthy());
    for tile in [
        "admin-tile-users",
        "admin-tile-communities",
        "admin-tile-channels",
        "admin-tile-invites",
        "admin-tile-banned",
    ] {
        rig.click(cx, tile);
    }
    assert!(rig.events().is_empty());
}

#[gpui_kit::test]
fn attention_storage_action_carries_the_filter(cx: &mut TestAppContext) {
    let rig = page_rig(cx, 1200., owner(), attention_view());
    rig.click(cx, "admin-attention-over-quota-action");
    rig.click(cx, "admin-attention-disk-action");
    assert_eq!(
        rig.events(),
        [
            open(AdminPage::Storage, Some(90)),
            open(AdminPage::Storage, None)
        ]
    );
}

#[gpui_kit::test]
fn attention_url_action_emits_open_url(cx: &mut TestAppContext) {
    let rig = page_rig(cx, 390., owner(), attention_view());
    rig.click(cx, "admin-attention-livekit-action");
    assert_eq!(
        rig.events(),
        [DashboardEvent::OpenUrl(
            "https://docs.semaphorechat.app/installation/docker-compose/#connecting-your-livekit-server"
                .into()
        )]
    );
}

#[gpui_kit::test]
fn attention_retry_action_emits_retry(cx: &mut TestAppContext) {
    let rig = page_rig(
        cx,
        1200.,
        owner(),
        ready(None, vec![storage_unavailable_item()]),
    );
    rig.click(cx, "admin-attention-storage-unavailable-action");
    assert_eq!(rig.events(), [DashboardEvent::Retry]);
    // A failed storage read hides its section rather than showing a skeleton forever.
    assert!(!rig.has(cx, "admin-storage-card"));
    assert!(!rig.has(cx, "admin-storage-loading"));
    assert!(!rig.has(cx, "admin-attention-loading"));
}

#[gpui_kit::test]
fn failed_try_again_emits_retry(cx: &mut TestAppContext) {
    let rig = page_rig(cx, 1200., owner(), failed_view());
    assert!(!rig.has(cx, "admin-tile-users"));
    rig.click(cx, "admin-dashboard-retry");
    assert_eq!(rig.events(), [DashboardEvent::Retry]);
}

#[gpui_kit::test]
fn storage_action_without_cap_is_disabled(cx: &mut TestAppContext) {
    let rig = page_rig(cx, 1200., dashboard_only(), attention_view());
    assert!(rig.has(cx, "admin-attention-disk-locked"));
    assert!(rig.has(cx, "admin-attention-over-quota-locked"));
    rig.click(cx, "admin-attention-disk-action");
    rig.click(cx, "admin-attention-over-quota-action");
    assert!(rig.events().is_empty());
    // A web page needs no permission.
    assert!(!rig.has(cx, "admin-attention-livekit-locked"));
    rig.click(cx, "admin-attention-livekit-action");
    assert_eq!(rig.events().len(), 1);
}

#[gpui_kit::test]
fn view_storage_opens_storage(cx: &mut TestAppContext) {
    let rig = page_rig(cx, 1200., owner(), healthy());
    rig.click(cx, "admin-view-storage");
    assert_eq!(rig.events(), [open(AdminPage::Storage, None)]);
    let rig = page_rig(cx, 1200., dashboard_only(), healthy());
    assert!(!rig.has(cx, "admin-view-storage"));
    assert!(rig.has(cx, "admin-view-storage-locked"));
}

#[gpui_kit::test]
fn denied_shows_only_the_reason(cx: &mut TestAppContext) {
    let rig = page_rig(cx, 1200., InstanceAdminCaps::default(), healthy());
    assert!(rig.has(cx, "admin-dashboard-denied"));
    assert!(!rig.has(cx, "admin-tile-users"));
    assert!(!rig.has(cx, "admin-storage-card"));
}

#[gpui_kit::test]
fn sections_follow_what_has_loaded(cx: &mut TestAppContext) {
    // Nothing yet: skeletons, no tiles.
    let rig = page_rig(cx, 1200., owner(), AdminDashboardView::default());
    assert!(rig.has(cx, "admin-attention-loading"));
    assert!(rig.has(cx, "admin-storage-loading"));
    assert!(!rig.has(cx, "admin-tile-users"));
    // Stats in, storage still out.
    let rig = page_rig(cx, 1200., owner(), ready(None, Vec::new()));
    assert!(rig.has(cx, "admin-tile-users"));
    assert!(rig.has(cx, "admin-attention-loading"));
    assert!(!rig.has(cx, "admin-attention-all-good"));
    // Everything in and healthy.
    let rig = page_rig(cx, 1200., owner(), healthy());
    assert!(rig.has(cx, "admin-attention-all-good"));
    assert!(!rig.has(cx, "admin-attention"));
    assert!(rig.has(cx, "admin-storage-card"));
    assert!(rig.has(cx, "admin-disk-bar"));
    // A server without a disk figure has no disk bar.
    let rig = page_rig(cx, 1200., owner(), no_disk_view());
    assert!(!rig.has(cx, "admin-disk-bar"));
    assert!(rig.has(cx, "admin-memory-bar"));
    // Long numbers and names on a phone still draw every section.
    let rig = page_rig(cx, 390., owner(), long_view());
    assert!(rig.has(cx, "admin-tile-messages"));
    assert!(rig.has(cx, "admin-attention-over-quota"));
    assert!(rig.has(cx, "admin-storage-card"));
}

fn healthy() -> AdminDashboardView {
    ready(Some(storage(42., 0)), Vec::new())
}
