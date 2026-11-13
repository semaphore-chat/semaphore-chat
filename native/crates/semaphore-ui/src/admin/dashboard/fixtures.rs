//! The view values the stories and the tests share: core's attention items as core words them,
//! a typical instance, and the views for each state.

use semaphore_core::model::{
    AdminDashboardView, AdminPage, AttentionId, AttentionItem, AttentionSeverity, AttentionTarget,
    ErrorView, InstanceAdminCaps, InstanceStats, InstanceStorage, LoadState, ServerHealth,
    StorageByKind, StorageDistribution,
};

const GB: u64 = 1024 * 1024 * 1024;
const MB: u64 = 1024 * 1024;
const LIVEKIT_DOCS: &str =
    "https://docs.semaphorechat.app/installation/docker-compose/#connecting-your-livekit-server";

pub(super) fn owner() -> InstanceAdminCaps {
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

/// May read the dashboard and nothing it links to.
pub(super) fn dashboard_only() -> InstanceAdminCaps {
    InstanceAdminCaps {
        show_admin: true,
        dashboard: true,
        ..InstanceAdminCaps::default()
    }
}

pub(super) fn stats() -> InstanceStats {
    InstanceStats {
        total_users: 248,
        total_communities: 12,
        total_channels: 87,
        total_messages: 48_213,
        active_invites: 5,
        banned_users: 3,
    }
}

pub(super) fn server(disk_percent: f64) -> ServerHealth {
    let disk_total = 500 * GB;
    let disk_used = (disk_total as f64 * disk_percent / 100.) as u64;
    ServerHealth {
        memory_total_bytes: 16 * GB,
        memory_used_bytes: 10 * GB,
        memory_used_percent: 62.5,
        cpu_cores: 8,
        cpu_model: "AMD EPYC 7B13".into(),
        load_average: vec![0.42, 0.38, 0.35],
        disk_total_bytes: disk_total,
        disk_used_bytes: disk_used,
        disk_free_bytes: disk_total - disk_used,
        disk_used_percent: disk_percent,
        platform: "linux".into(),
        hostname: "semaphore-1".into(),
        uptime_secs: 1_234_567,
    }
}

pub(super) fn storage(disk_percent: f64, over_quota: u64) -> InstanceStorage {
    InstanceStorage {
        total_used_bytes: 182 * GB + 400 * MB,
        total_files: 23_418,
        total_users: 248,
        average_per_user_bytes: 753 * MB,
        distribution: StorageDistribution {
            under_25: 190,
            under_50: 31,
            under_75: 17,
            under_90: 7,
            over_90: over_quota,
        },
        by_kind: vec![
            StorageByKind {
                kind: "MESSAGE_ATTACHMENT".into(),
                bytes: 170 * GB,
                count: 21_904,
            },
            StorageByKind {
                kind: "USER_AVATAR".into(),
                bytes: 820 * MB,
                count: 1_204,
            },
            StorageByKind {
                kind: "CUSTOM_EMOJI".into(),
                bytes: 64 * MB,
                count: 310,
            },
        ],
        default_quota_bytes: 10 * GB,
        max_file_bytes: 500 * MB,
        users_approaching_quota: 7,
        users_over_quota: over_quota,
        server: server(disk_percent),
    }
}

/// Core's items, worded as `commands/instance_admin/instance.rs` words them.
pub(super) fn disk_item(severity: AttentionSeverity, percent: u32) -> AttentionItem {
    AttentionItem {
        id: AttentionId::Disk,
        severity,
        title: format!("Server disk is {percent}% full"),
        detail: Some("Free up space or grow the disk before uploads start failing.".into()),
        target: AttentionTarget::Page {
            page: AdminPage::Storage,
            storage_min_percent: None,
        },
        action_label: "Storage".into(),
    }
}

pub(super) fn over_quota_item(users: &str, one: bool) -> AttentionItem {
    let verb = if one { "user is" } else { "users are" };
    AttentionItem {
        id: AttentionId::OverQuota,
        severity: AttentionSeverity::Warning,
        title: format!("{users} {verb} over 90% of their storage quota"),
        detail: Some("They'll soon be unable to upload files.".into()),
        target: AttentionTarget::Page {
            page: AdminPage::Storage,
            storage_min_percent: Some(90),
        },
        action_label: "Storage".into(),
    }
}

pub(super) fn livekit_item() -> AttentionItem {
    AttentionItem {
        id: AttentionId::Livekit,
        severity: AttentionSeverity::Warning,
        title: "Voice and video are off: LiveKit isn't configured".into(),
        detail: Some(
            "Text chat works without it. Set up LiveKit to enable voice channels and screen sharing."
                .into(),
        ),
        target: AttentionTarget::Url {
            url: LIVEKIT_DOCS.into(),
        },
        action_label: "Setup guide".into(),
    }
}

pub(super) fn storage_unavailable_item() -> AttentionItem {
    AttentionItem {
        id: AttentionId::StorageUnavailable,
        severity: AttentionSeverity::Warning,
        title: "Couldn't load storage and server status".into(),
        detail: Some("Disk and quota checks are unavailable until it loads.".into()),
        target: AttentionTarget::Retry,
        action_label: "Try again".into(),
    }
}

pub(super) fn ready(
    storage: Option<InstanceStorage>,
    attention: Vec<AttentionItem>,
) -> AdminDashboardView {
    AdminDashboardView {
        state: LoadState::Ready,
        stats: Some(stats()),
        storage,
        livekit_configured: Some(true),
        attention,
    }
}

/// Every severity and every kind of target: a full disk (error), users over quota (a page with a
/// filter) and LiveKit (a web page).
pub(super) fn attention_view() -> AdminDashboardView {
    AdminDashboardView {
        livekit_configured: Some(false),
        ..ready(
            Some(storage(93., 3)),
            vec![
                disk_item(AttentionSeverity::Error, 93),
                over_quota_item("3", false),
                livekit_item(),
            ],
        )
    }
}

pub(super) fn failed_view() -> AdminDashboardView {
    AdminDashboardView {
        state: LoadState::Failed {
            error: ErrorView {
                code: "SERVER".into(),
                message: "Something went wrong on our side. Try again in a moment.".into(),
                retryable: true,
                retry_after_ms: None,
            },
        },
        ..AdminDashboardView::default()
    }
}

pub(super) fn long_view() -> AdminDashboardView {
    let mut storage = storage(88., 1_234_567);
    storage.total_used_bytes = 3 * 1024 * 1024 * GB;
    storage.total_files = 9_876_543_210;
    storage.users_approaching_quota = 2_345_678;
    storage.server.platform =
        "linux-6.11.0-1015-azure-x86_64-with-an-unusually-long-kernel-build-tag".into();
    storage.server.hostname =
        "semaphore-production-primary-node-eu-west-3-availability-zone-c.internal.example.com"
            .into();
    storage.server.uptime_secs = 400 * 86_400 + 5 * 3_600;
    storage.by_kind = (0..8)
        .map(|index| StorageByKind {
            kind: format!("A_VERY_LONG_STORAGE_RESOURCE_TYPE_NAME_NUMBER_{index}"),
            bytes: (index + 1) * 37 * GB,
            count: (index + 1) * 1_234_567,
        })
        .collect();
    AdminDashboardView {
        state: LoadState::Ready,
        stats: Some(InstanceStats {
            total_users: 1_234_567_890,
            total_communities: 999_999,
            total_channels: 12_345_678,
            total_messages: 98_765_432_109,
            active_invites: 1_000_000,
            banned_users: 54_321,
        }),
        storage: Some(storage),
        livekit_configured: Some(false),
        attention: vec![
            disk_item(AttentionSeverity::Warning, 88),
            over_quota_item("1,234,567", false),
            livekit_item(),
        ],
    }
}

pub(super) fn no_disk_view() -> AdminDashboardView {
    let mut storage = storage(0., 0);
    storage.server.disk_total_bytes = 0;
    storage.server.disk_used_bytes = 0;
    storage.server.disk_free_bytes = 0;
    storage.by_kind.clear();
    ready(Some(storage), Vec::new())
}
