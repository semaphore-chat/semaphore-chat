//! The storage stories: the list loading, empty and failed; ready with users in every usage band;
//! filtered over 90%; sixty long usernames with another page to load; the next page on its way; the
//! quota dialog open and busy; a refused recalculation; without the permission; and the stacked
//! phone layout.
//! `rigs/shot/scripts/ua5-admin-roles-storage.steps` renders them all on a desktop and a phone.

use super::StoragePage;
use crate::stories::{Story, StoryEnv};
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{
    AdminAction, AdminActionKind as K, AdminActionState, AdminOp, AdminStorageView, ErrorView,
    InstanceAdminCaps, LoadState, StorageRow,
};

const GIB: u64 = 1 << 30;

// ---- Fixtures. ----

fn caps() -> InstanceAdminCaps {
    InstanceAdminCaps {
        show_admin: true,
        dashboard: true,
        settings_read: true,
        settings_write: true,
        users_read: true,
        users_update: true,
        users_ban: true,
        users_delete: true,
        storage: true,
        communities_read: true,
        communities_delete: true,
        invites_read: true,
        invites_create: true,
        invites_delete: true,
        roles_read: true,
        roles_write: true,
        is_owner: true,
        full_authority: true,
    }
}

fn row(id: &str, username: &str, quota_gb: u64, percent_used: f64, file_count: u64) -> StorageRow {
    let quota_bytes = quota_gb * GIB;
    StorageRow {
        user_id: id.into(),
        username: username.into(),
        used_bytes: (quota_bytes as f64 * percent_used / 100.).round() as u64,
        quota_bytes,
        percent_used,
        file_count,
    }
}

fn people() -> Vec<StorageRow> {
    vec![
        row("u-river", "river_owner", 50, 12.4, 214),
        row("u-maple", "maple_admin", 50, 38.2, 1204),
        row("u-juniper", "juniper", 10, 64.9, 88),
        row("u-quill", "quill", 10, 78.3, 41),
        row("u-harbor", "harbor_mod", 10, 91.7, 302),
        row("u-sable", "sable", 50, 96.4, 2871),
    ]
}

/// A 100-character version of `base`.
fn long(base: &str) -> String {
    let mut out = String::new();
    while out.chars().count() < 100 {
        out.push_str(base);
    }
    out.chars().take(100).collect()
}

fn long_rows() -> Vec<StorageRow> {
    (0..60)
        .map(|index| {
            let username = format!(
                "{} {index:02}",
                long("long_username_with_a_very_long_tail_")
            );
            row(
                &format!("u-long{index:02}"),
                &username,
                50,
                3.5 + (index % 20) as f64 * 4.8,
                20 + index * 37,
            )
        })
        .collect()
}

fn view(
    state: LoadState,
    min_percent: u32,
    rows: Vec<StorageRow>,
    total: u64,
    more: bool,
    loading_more: bool,
) -> AdminStorageView {
    AdminStorageView {
        state,
        min_percent,
        rows,
        total,
        more,
        loading_more,
        op: AdminOp::default(),
    }
}

fn ready() -> AdminStorageView {
    let rows = people();
    let total = rows.len() as u64;
    view(LoadState::Ready, 0, rows, total, false, false)
}

fn server_error(message: &str) -> ErrorView {
    ErrorView {
        code: "FORBIDDEN".into(),
        message: message.into(),
        retryable: false,
        retry_after_ms: None,
    }
}

fn state(kind: K, target: &str) -> AdminActionState {
    AdminActionState {
        action: AdminAction {
            kind,
            target_id: Some(target.into()),
        },
        busy: false,
        upload: None,
        error: None,
    }
}

fn busy(kind: K, target: &str) -> AdminOp {
    AdminOp {
        busy: true,
        action: Some(state(kind, target).action),
        actions: vec![AdminActionState {
            busy: true,
            ..state(kind, target)
        }],
        ..AdminOp::default()
    }
}

fn erred(kind: K, target: &str, message: &str) -> AdminOp {
    AdminOp {
        error: Some(server_error(message)),
        action: Some(state(kind, target).action),
        actions: vec![AdminActionState {
            error: Some(server_error(message)),
            ..state(kind, target)
        }],
        ..AdminOp::default()
    }
}

// ---- Builders. ----

fn build(
    view: AdminStorageView,
    caps: InstanceAdminCaps,
    window: &mut Window,
    cx: &mut App,
    tweak: impl FnOnce(&mut StoragePage, &mut Window, &mut Context<StoragePage>),
) -> AnyView {
    cx.new(|cx| {
        let mut page = StoragePage::new(window, cx);
        page.set_caps(caps, cx);
        page.set_view(view, cx);
        tweak(&mut page, window, cx);
        page
    })
    .into()
}

type Build = fn(&StoryEnv, &mut Window, &mut App) -> AnyView;

pub(super) fn stories() -> Vec<Story> {
    let all: Vec<(&'static str, Build)> = vec![
        ("admin-storage-loading", |_, w, cx| {
            build(
                view(LoadState::Loading, 0, Vec::new(), 0, false, false),
                caps(),
                w,
                cx,
                |_, _, _| {},
            )
        }),
        ("admin-storage-empty", |_, w, cx| {
            build(
                view(LoadState::Ready, 90, Vec::new(), 0, false, false),
                caps(),
                w,
                cx,
                |_, _, _| {},
            )
        }),
        ("admin-storage-failed", |_, w, cx| {
            build(
                view(
                    LoadState::Failed {
                        error: ErrorView {
                            code: "NETWORK".into(),
                            message: "network unreachable".into(),
                            retryable: true,
                            retry_after_ms: None,
                        },
                    },
                    0,
                    Vec::new(),
                    0,
                    false,
                    false,
                ),
                caps(),
                w,
                cx,
                |_, _, _| {},
            )
        }),
        ("admin-storage-ready", |_, w, cx| {
            build(ready(), caps(), w, cx, |_, _, _| {})
        }),
        ("admin-storage-over-90", |_, w, cx| {
            let rows = vec![
                row("u-harbor", "harbor_mod", 10, 91.7, 302),
                row("u-sable", "sable", 50, 96.4, 2871),
                row("u-quill", "quill", 10, 90.5, 41),
            ];
            let total = rows.len() as u64;
            build(
                view(LoadState::Ready, 90, rows, total, false, false),
                caps(),
                w,
                cx,
                |_, _, _| {},
            )
        }),
        ("admin-storage-long", |_, w, cx| {
            build(
                view(LoadState::Ready, 0, long_rows(), 60, true, false),
                caps(),
                w,
                cx,
                |_, _, _| {},
            )
        }),
        ("admin-storage-loading-more", |_, w, cx| {
            build(
                view(
                    LoadState::Ready,
                    0,
                    people().into_iter().take(3).collect(),
                    60,
                    true,
                    true,
                ),
                caps(),
                w,
                cx,
                |_, _, _| {},
            )
        }),
        ("admin-storage-quota-dialog", |_, w, cx| {
            build(ready(), caps(), w, cx, |page, window, cx| {
                page.open_quota("u-maple", window, cx);
            })
        }),
        ("admin-storage-quota-busy", |_, w, cx| {
            build(ready(), caps(), w, cx, |page, window, cx| {
                page.open_quota("u-maple", window, cx);
                page.set_view(
                    AdminStorageView {
                        op: busy(K::SetUserQuota, "u-maple"),
                        ..ready()
                    },
                    cx,
                );
            })
        }),
        ("admin-storage-recalc-refused", |_, w, cx| {
            // The refused row first, so the message is in view on a phone too.
            let mut rows = people();
            rows.rotate_left(4);
            build(
                AdminStorageView {
                    rows,
                    op: erred(
                        K::RecalculateStorage,
                        "u-harbor",
                        "Storage recalculation failed: the storage backend is unreachable.",
                    ),
                    ..ready()
                },
                caps(),
                w,
                cx,
                |_, _, _| {},
            )
        }),
        ("admin-storage-locked", |_, w, cx| {
            build(
                AdminStorageView::default(),
                InstanceAdminCaps::default(),
                w,
                cx,
                |_, _, _| {},
            )
        }),
        ("admin-storage-phone", |_, w, cx| {
            let rows = vec![
                row("u-long-1", &long("long_username_"), 10, 78.3, 41),
                row("u-long-2", &long("another_long_name_"), 50, 96.4, 2871),
                row("u-maple", "maple_admin", 50, 38.2, 1204),
            ];
            let total = rows.len() as u64;
            build(
                view(LoadState::Ready, 0, rows, total, false, false),
                caps(),
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
