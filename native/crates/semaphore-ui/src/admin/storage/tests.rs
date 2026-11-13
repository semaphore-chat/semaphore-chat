//! The storage page in a window: the usage filter, the quota dialog's GiB arithmetic, the
//! recalculation, and the "Load more" foot.

use super::{StorageEvent, StoragePage};
use crate::dms::rig::{Rig, rig};
use core::prelude::v1::test;
use gpui_kit::component::select::SelectEvent;
use gpui_kit::*;
use semaphore_core::model::{
    AdminAction, AdminActionKind as K, AdminActionState, AdminOp, AdminStorageView,
    InstanceAdminCaps, LoadState, StorageRow,
};

const GIB: u64 = 1 << 30;

// ---- Fixtures. ----

fn caps() -> InstanceAdminCaps {
    InstanceAdminCaps {
        storage: true,
        is_owner: true,
        full_authority: true,
        ..InstanceAdminCaps::default()
    }
}

fn row(id: &str, username: &str, quota_gb: u64, percent_used: f64, files: u64) -> StorageRow {
    StorageRow {
        user_id: id.into(),
        username: username.into(),
        used_bytes: (quota_gb as f64 * GIB as f64 * percent_used / 100.) as u64,
        quota_bytes: quota_gb * GIB,
        percent_used,
        file_count: files,
    }
}

fn ready() -> AdminStorageView {
    let rows = vec![
        row("u-maple", "maple", 50, 38.2, 1204),
        row("u-harbor", "harbor", 10, 91.7, 302),
        row("u-quill", "quill", 10, 64.9, 41),
    ];
    let total = rows.len() as u64;
    AdminStorageView {
        state: LoadState::Ready,
        min_percent: 0,
        rows,
        total,
        more: false,
        loading_more: false,
        op: AdminOp::default(),
    }
}

fn view(more: bool, loading_more: bool) -> AdminStorageView {
    AdminStorageView {
        more,
        loading_more,
        ..ready()
    }
}

fn storage_rig(cx: &mut TestAppContext, view: AdminStorageView) -> Rig<StoragePage, StorageEvent> {
    rig(cx, 1200., move |window, cx| {
        let mut page = StoragePage::new(window, cx);
        page.set_caps(caps(), cx);
        page.set_view(view, cx);
        page
    })
}

fn type_quota(rig: &Rig<StoragePage, StorageEvent>, cx: &mut TestAppContext, text: &str) {
    let text = text.to_owned();
    rig.with(cx, |page, window, cx| {
        page.update(cx, |page, cx| {
            page.quota
                .update(cx, |field, cx| field.set_value(text.clone(), window, cx))
        })
    });
}

fn field_value(rig: &Rig<StoragePage, StorageEvent>, cx: &mut TestAppContext) -> String {
    rig.with(cx, |page, _, cx| {
        page.read(cx).quota.read(cx).value().to_string()
    })
}

fn busy_recalc(user_id: &str) -> AdminStorageView {
    AdminStorageView {
        op: AdminOp {
            busy: true,
            action: Some(AdminAction {
                kind: K::RecalculateStorage,
                target_id: Some(user_id.into()),
            }),
            actions: vec![AdminActionState {
                action: AdminAction {
                    kind: K::RecalculateStorage,
                    target_id: Some(user_id.into()),
                },
                busy: true,
                upload: None,
                error: None,
            }],
            ..AdminOp::default()
        },
        ..ready()
    }
}

// ---- Tests. ----

#[gpui_kit::test]
fn storage_filter_emits_the_percent(cx: &mut TestAppContext) {
    let rig = storage_rig(cx, ready());
    rig.with(cx, |page, _, cx| {
        let filter = page.read(cx).filter.clone();
        filter.update(cx, |_, cx| {
            cx.emit(SelectEvent::Confirm(Some("Over 90%".into())))
        });
    });
    assert_eq!(rig.events(), [StorageEvent::Filter(90)]);
    rig.with(cx, |page, _, cx| {
        let filter = page.read(cx).filter.clone();
        filter.update(cx, |_, cx| {
            cx.emit(SelectEvent::Confirm(Some("Over 75%".into())))
        });
    });
    assert_eq!(rig.events().last(), Some(&StorageEvent::Filter(75)));
    rig.with(cx, |page, _, cx| {
        let filter = page.read(cx).filter.clone();
        filter.update(cx, |_, cx| {
            cx.emit(SelectEvent::Confirm(Some("Everyone".into())))
        });
    });
    assert_eq!(rig.events().last(), Some(&StorageEvent::Filter(0)));
}

#[gpui_kit::test]
fn storage_quota_converts_gb(cx: &mut TestAppContext) {
    let rig = storage_rig(cx, ready());
    rig.click(cx, "admin-storage-quota-u-maple");
    assert_eq!(field_value(&rig, cx), "50", "starts at the quota they have");
    type_quota(&rig, cx, "5");
    rig.click(cx, "admin-storage-quota-save");
    assert_eq!(
        rig.events(),
        [StorageEvent::SetQuota {
            user_id: "u-maple".into(),
            quota_bytes: 5 * GIB,
        }]
    );

    rig.clear();
    rig.click(cx, "admin-storage-quota-u-maple");
    type_quota(&rig, cx, "1.5");
    assert!(rig.has(cx, "admin-storage-quota-error"));
    rig.click(cx, "admin-storage-quota-save");
    assert!(rig.events().is_empty(), "a fraction of a GB");
}

#[gpui_kit::test]
fn storage_recalculate_sends_it(cx: &mut TestAppContext) {
    let rig = storage_rig(cx, ready());
    rig.click(cx, "admin-storage-recalc-u-harbor");
    assert_eq!(
        rig.events(),
        [StorageEvent::Recalculate {
            user_id: "u-harbor".into(),
        }]
    );

    rig.with(cx, |page, _, cx| {
        page.update(cx, |page, cx| page.set_view(busy_recalc("u-harbor"), cx))
    });
    rig.clear();
    rig.click(cx, "admin-storage-recalc-u-harbor");
    assert!(rig.events().is_empty(), "already running");
}

#[gpui_kit::test]
fn storage_load_more_only_when_more(cx: &mut TestAppContext) {
    let rig = storage_rig(cx, view(false, false));
    assert!(!rig.has(cx, "admin-storage-more"));
    assert!(rig.events().is_empty());

    let rig = storage_rig(cx, view(true, false));
    rig.click(cx, "admin-storage-more");
    assert_eq!(rig.events(), [StorageEvent::LoadMore]);

    let rig = storage_rig(cx, view(true, true));
    rig.click(cx, "admin-storage-more");
    assert!(rig.events().is_empty(), "the next page is already coming");
}
