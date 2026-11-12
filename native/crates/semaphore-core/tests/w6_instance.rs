//! W6-A in core, on `FakeBackend` (`common/w6_instance.rs`): the admin dashboard (stats, instance
//! storage, LiveKit health and the attention items they add up to) and instance settings, read and
//! changed, with every refusal kept.

mod common;

use common::w6_instance::*;
use common::*;
use semaphore_core::commands::instance_admin::instance::attention_items;
use semaphore_core::model::{
    AdminActionKind, AdminOp, AdminPage, AttentionId, AttentionItem, AttentionSeverity,
    AttentionTarget, InstanceSettingsPatch, InstanceSettingsView, InstanceStats, InstanceStorage,
    LoadState, RegistrationMode, ServerHealth, StorageByKind, StorageDistribution,
};
use serde_json::{Value, json};

const LIVEKIT_DOCS_URL: &str =
    "https://docs.semaphorechat.app/installation/docker-compose/#connecting-your-livekit-server";

// ----- the dashboard ---------------------------------------------------------------------------

#[tokio::test]
async fn the_dashboard_reads_stats_storage_and_livekit_once_and_maps_every_field() {
    let mut rig = Rig::new().signed_in().await;
    rig.backend.w4.answer("w6a_stats", stats_json());
    rig.backend.w4.answer("w6a_storage", storage_json());
    rig.backend.w4.answer("w6a_livekit", livekit_json(true));

    let view = rig.core.admin_dashboard();
    assert_eq!(view.state, LoadState::Loading);
    assert_eq!(view.storage, None, "nothing is cached yet");

    rig.settle().await;
    let view = rig.core.admin_dashboard();
    assert_eq!(view.state, LoadState::Ready);
    assert_eq!(
        (
            rig.backend.w4.count("w6a_stats"),
            rig.backend.w4.count("w6a_storage"),
            rig.backend.w4.count("w6a_livekit")
        ),
        (1, 1, 1),
        "one read each while it's fresh"
    );
    assert_eq!(
        view.stats,
        Some(InstanceStats {
            total_users: 13,
            total_communities: 4,
            total_channels: 20,
            total_messages: 79,
            active_invites: 1,
            banned_users: 2,
        })
    );
    assert_eq!(
        view.storage,
        Some(InstanceStorage {
            total_used_bytes: 12_345_678_901,
            total_files: 4321,
            total_users: 13,
            average_per_user_bytes: 949_667_608,
            distribution: StorageDistribution {
                under_25: 5,
                under_50: 3,
                under_75: 2,
                under_90: 1,
                over_90: 2,
            },
            by_kind: vec![
                StorageByKind {
                    kind: "MESSAGE_ATTACHMENT".into(),
                    bytes: 10_000_000_000,
                    count: 4000,
                },
                StorageByKind {
                    kind: "USER_AVATAR".into(),
                    bytes: 2_000_000_000,
                    count: 300,
                },
                StorageByKind {
                    kind: "REPLAY_CLIP".into(),
                    bytes: 345_678_901,
                    count: 21,
                },
            ],
            default_quota_bytes: 53_687_091_200,
            max_file_bytes: 524_288_000,
            users_approaching_quota: 3,
            users_over_quota: 2,
            server: ServerHealth {
                memory_total_bytes: 34_359_738_368,
                memory_used_bytes: 14_602_223_206,
                memory_used_percent: 42.5,
                cpu_cores: 8,
                cpu_model: "AMD EPYC 7B13".into(),
                load_average: vec![0.5, 0.4, 0.3],
                disk_total_bytes: 1_000_000_000_000,
                disk_used_bytes: 500_000_000_000,
                disk_free_bytes: 500_000_000_000,
                disk_used_percent: 50.0,
                platform: "linux".into(),
                hostname: "fake-1".into(),
                uptime_secs: 86_400,
            },
        })
    );
    assert_eq!(view.livekit_configured, Some(true));
    assert_eq!(
        view.attention,
        vec![over_quota_item(
            "2 users are over 90% of their storage quota"
        )],
        "disk 50% and LiveKit configured: only the two users over quota"
    );
}

#[tokio::test]
async fn a_failed_storage_read_shows_as_an_attention_item_not_a_failed_dashboard() {
    let mut rig = Rig::new().signed_in().await;
    rig.backend.w4.answer("w6a_stats", stats_json());
    rig.backend.w4.answer("w6a_livekit", livekit_json(true));
    rig.backend
        .w4
        .fail_next("w6a_storage", refusal(500, "INTERNAL"));

    rig.core.admin_dashboard();
    rig.settle().await;
    let view = rig.core.admin_dashboard();
    assert_eq!(
        view.state,
        LoadState::Ready,
        "the stats arrived, so the dashboard isn't loading"
    );
    assert!(view.stats.is_some());
    assert_eq!(view.storage, None);
    assert_eq!(view.attention, vec![storage_unavailable_item()]);
    // The failed read isn't retried by merely showing the dashboard again.
    assert_eq!(rig.backend.w4.count("w6a_storage"), 1);
}

#[tokio::test]
async fn the_dashboard_reads_again_when_shown_after_thirty_seconds() {
    let mut rig = Rig::new().signed_in().await;
    rig.backend.w4.answer("w6a_stats", stats_json());
    rig.backend.w4.answer("w6a_storage", storage_json());
    rig.backend.w4.answer("w6a_livekit", livekit_json(true));
    rig.core.admin_dashboard();
    rig.settle().await;
    rig.clock.advance(10_000);
    rig.core.admin_dashboard();
    rig.settle().await;
    assert_eq!(rig.backend.w4.count("w6a_stats"), 1);
    assert_eq!(rig.backend.w4.count("w6a_storage"), 1);
    assert_eq!(rig.backend.w4.count("w6a_livekit"), 1);
    rig.clock.advance(25_000);
    rig.core.admin_dashboard();
    rig.settle().await;
    assert_eq!(rig.backend.w4.count("w6a_stats"), 2);
    assert_eq!(rig.backend.w4.count("w6a_storage"), 2);
    assert_eq!(rig.backend.w4.count("w6a_livekit"), 2);
}

// ----- attention items -------------------------------------------------------------------------

fn disk_item(severity: AttentionSeverity, title: &str) -> AttentionItem {
    AttentionItem {
        id: AttentionId::Disk,
        severity,
        title: title.into(),
        detail: Some("Free up space or grow the disk before uploads start failing.".into()),
        target: AttentionTarget::Page {
            page: AdminPage::Storage,
            storage_min_percent: None,
        },
        action_label: "Storage".into(),
    }
}

fn over_quota_item(title: &str) -> AttentionItem {
    AttentionItem {
        id: AttentionId::OverQuota,
        severity: AttentionSeverity::Warning,
        title: title.into(),
        detail: Some("They'll soon be unable to upload files.".into()),
        target: AttentionTarget::Page {
            page: AdminPage::Storage,
            storage_min_percent: Some(90),
        },
        action_label: "Storage".into(),
    }
}

fn storage_unavailable_item() -> AttentionItem {
    AttentionItem {
        id: AttentionId::StorageUnavailable,
        severity: AttentionSeverity::Warning,
        title: "Couldn't load storage and server status".into(),
        detail: Some("Disk and quota checks are unavailable until it loads.".into()),
        target: AttentionTarget::Retry,
        action_label: "Try again".into(),
    }
}

fn livekit_off_item() -> AttentionItem {
    AttentionItem {
        id: AttentionId::Livekit,
        severity: AttentionSeverity::Warning,
        title: "Voice and video are off: LiveKit isn't configured".into(),
        detail: Some(
            "Text chat works without it. Set up LiveKit to enable voice channels and screen sharing."
                .into(),
        ),
        target: AttentionTarget::Url {
            url: LIVEKIT_DOCS_URL.into(),
        },
        action_label: "Setup guide".into(),
    }
}

/// Storage that reports `disk_percent` of a `disk_total`-byte disk, and `over_quota` users over 90%.
fn storage_with(disk_percent: f64, disk_total: u64, over_quota: u64) -> InstanceStorage {
    InstanceStorage {
        users_over_quota: over_quota,
        server: ServerHealth {
            disk_total_bytes: disk_total,
            disk_used_percent: disk_percent,
            ..Default::default()
        },
        ..Default::default()
    }
}

/// One row of `attention_items_table`: the inputs, and what they add up to.
struct Case {
    storage: Option<InstanceStorage>,
    storage_error: bool,
    livekit: Option<bool>,
    want: Vec<AttentionItem>,
}

fn case(
    storage: Option<InstanceStorage>,
    storage_error: bool,
    livekit: Option<bool>,
    want: Vec<AttentionItem>,
) -> Case {
    Case {
        storage,
        storage_error,
        livekit,
        want,
    }
}

#[test]
fn attention_items_table() {
    let disk = 1_000_000_000_000u64;
    let cases = vec![
        // Disk use below the warning line says nothing.
        case(Some(storage_with(79.9, disk, 0)), false, Some(true), vec![]),
        // 80.0 warns, and the title rounds to the nearest percent.
        case(
            Some(storage_with(80.0, disk, 0)),
            false,
            Some(true),
            vec![disk_item(
                AttentionSeverity::Warning,
                "Server disk is 80% full",
            )],
        ),
        // 89.5 still warns, though its title reads 90%.
        case(
            Some(storage_with(89.5, disk, 0)),
            false,
            Some(true),
            vec![disk_item(
                AttentionSeverity::Warning,
                "Server disk is 90% full",
            )],
        ),
        case(
            Some(storage_with(90.0, disk, 0)),
            false,
            Some(true),
            vec![disk_item(
                AttentionSeverity::Error,
                "Server disk is 90% full",
            )],
        ),
        case(
            Some(storage_with(100.0, disk, 0)),
            false,
            Some(true),
            vec![disk_item(
                AttentionSeverity::Error,
                "Server disk is 100% full",
            )],
        ),
        // A server that reports no disk can't be judged by its percentage.
        case(Some(storage_with(95.0, 0, 0)), false, Some(true), vec![]),
        // Users over 90% of their quota.
        case(Some(storage_with(50.0, disk, 0)), false, Some(true), vec![]),
        case(
            Some(storage_with(50.0, disk, 1)),
            false,
            Some(true),
            vec![over_quota_item("1 user is over 90% of their storage quota")],
        ),
        case(
            Some(storage_with(50.0, disk, 2)),
            false,
            Some(true),
            vec![over_quota_item(
                "2 users are over 90% of their storage quota",
            )],
        ),
        case(
            Some(storage_with(50.0, disk, 1234)),
            false,
            Some(true),
            vec![over_quota_item(
                "1,234 users are over 90% of their storage quota",
            )],
        ),
        // A storage read that failed.
        case(None, true, Some(true), vec![storage_unavailable_item()]),
        case(
            None,
            true,
            Some(false),
            vec![storage_unavailable_item(), livekit_off_item()],
        ),
        // Errors first, warnings after in the order built.
        case(
            Some(storage_with(95.0, disk, 2)),
            false,
            Some(false),
            vec![
                disk_item(AttentionSeverity::Error, "Server disk is 95% full"),
                over_quota_item("2 users are over 90% of their storage quota"),
                livekit_off_item(),
            ],
        ),
        // LiveKit: unknown says nothing, and so does configured.
        case(Some(storage_with(50.0, disk, 0)), false, None, vec![]),
        case(Some(storage_with(50.0, disk, 0)), false, Some(true), vec![]),
    ];
    for row in cases {
        let got = attention_items(row.storage.as_ref(), row.storage_error, row.livekit);
        assert_eq!(
            got, row.want,
            "storage {:?}, error {}, livekit {:?}",
            row.storage, row.storage_error, row.livekit
        );
    }
}

// ----- instance settings -----------------------------------------------------------------------

/// Reads the settings `mode`, `description`, `quota` and `max_file` a fresh server answers.
async fn read_settings(
    mode: &str,
    description: Value,
    quota: i64,
    max_file: i64,
) -> InstanceSettingsView {
    let mut rig = Rig::new().signed_in().await;
    let mut settings = settings_json("Semaphore Chat");
    settings["registrationMode"] = json!(mode);
    settings["description"] = description;
    settings["defaultStorageQuotaBytes"] = json!(quota);
    settings["maxFileSizeBytes"] = json!(max_file);
    rig.backend.w4.answer("w6a_settings", settings);
    rig.core.instance_settings();
    rig.settle().await;
    rig.core.instance_settings()
}

#[tokio::test]
async fn settings_map_the_registration_mode_and_bytes() {
    let open = read_settings("OPEN", json!(""), 53_687_091_200, 524_288_000).await;
    assert_eq!(open.state, LoadState::Ready);
    assert_eq!(open.name, "Semaphore Chat");
    assert_eq!(open.description, None, "an empty description reads as none");
    assert_eq!(open.registration, RegistrationMode::Open);
    assert_eq!(open.default_quota_bytes, 53_687_091_200);
    assert_eq!(open.max_file_bytes, 524_288_000);

    let closed = read_settings("CLOSED", json!("About"), 1_073_741_824, 1_048_576).await;
    assert_eq!(closed.registration, RegistrationMode::Closed);
    assert_eq!(closed.description.as_deref(), Some("About"));
    assert_eq!(closed.default_quota_bytes, 1_073_741_824);
    assert_eq!(closed.max_file_bytes, 1_048_576);

    let invite = read_settings("INVITE_ONLY", json!(null), 53_687_091_200, 524_288_000).await;
    assert_eq!(invite.registration, RegistrationMode::InviteOnly);
    assert_eq!(invite.description, None, "a null description reads as none");

    let unknown = read_settings("SOMETHING_NEW", json!(null), 0, 0).await;
    assert_eq!(
        unknown.registration,
        RegistrationMode::InviteOnly,
        "an unknown mode asks for a code"
    );
    assert_eq!(
        (unknown.default_quota_bytes, unknown.max_file_bytes),
        (0, 0),
        "negative bytes read as zero"
    );
}

fn update_bodies(rig: &Rig) -> Vec<Value> {
    rig.backend
        .w4
        .calls()
        .into_iter()
        .filter_map(|call| {
            call.strip_prefix("w6a_update_settings ")
                .map(|body| serde_json::from_str(body).expect("the body is JSON"))
        })
        .collect()
}

#[tokio::test]
async fn an_update_sends_only_the_fields_given() {
    let mut rig = Rig::new().signed_in().await;
    rig.backend
        .w4
        .answer("w6a_settings", settings_json("Semaphore Chat"));
    rig.core.instance_settings();
    rig.settle().await;

    rig.backend
        .w4
        .answer("w6a_update_settings", settings_json("Renamed"));
    rig.core
        .update_instance_settings(InstanceSettingsPatch {
            name: Some("Renamed".into()),
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(update_bodies(&rig), vec![json!({ "name": "Renamed" })]);
    let view = rig.core.instance_settings();
    assert_eq!(
        view.name, "Renamed",
        "the answer replaces the cached settings"
    );
    assert!(!view.op.busy && view.op.error.is_none());

    let mut closed = settings_json("Renamed");
    closed["registrationMode"] = json!("CLOSED");
    closed["description"] = json!("");
    rig.backend.w4.answer("w6a_update_settings", closed);
    rig.core
        .update_instance_settings(InstanceSettingsPatch {
            name: None,
            description: Some(String::new()),
            registration: Some(RegistrationMode::Closed),
            default_quota_bytes: Some(1_073_741_824),
            max_file_bytes: Some(1_048_576),
        })
        .await
        .unwrap();
    let bodies = update_bodies(&rig);
    assert_eq!(
        bodies.last(),
        Some(&json!({
            "description": "",
            "registrationMode": "CLOSED",
            "defaultStorageQuotaBytes": 1_073_741_824i64,
            "maxFileSizeBytes": 1_048_576i64,
        }))
    );
    let view = rig.core.instance_settings();
    assert_eq!(
        (view.registration, view.description),
        (RegistrationMode::Closed, None),
        "an empty description clears it"
    );
}

/// The message a refusal before the send shows on `UpdateInstanceSettings`.
fn refusal_message(op: &AdminOp) -> String {
    let state = op
        .actions
        .iter()
        .find(|state| state.action.kind == AdminActionKind::UpdateInstanceSettings)
        .expect("the action shows its refusal");
    assert!(!state.busy);
    state
        .error
        .as_ref()
        .expect("the refusal shows")
        .message
        .clone()
}

#[tokio::test]
async fn an_update_out_of_bounds_is_refused_before_sending() {
    let mut rig = Rig::new().signed_in().await;
    rig.backend
        .w4
        .answer("w6a_settings", settings_json("Semaphore Chat"));
    rig.core.instance_settings();
    rig.settle().await;
    let cases: Vec<(InstanceSettingsPatch, &str)> = vec![
        (
            InstanceSettingsPatch {
                name: Some("a".repeat(101)),
                ..Default::default()
            },
            "name must be shorter than or equal to 100 characters",
        ),
        (
            InstanceSettingsPatch {
                description: Some("a".repeat(501)),
                ..Default::default()
            },
            "description must be shorter than or equal to 500 characters",
        ),
        (
            InstanceSettingsPatch {
                default_quota_bytes: Some(1_073_741_823),
                ..Default::default()
            },
            "defaultStorageQuotaBytes must not be less than 1073741824",
        ),
        (
            InstanceSettingsPatch {
                max_file_bytes: Some(1_048_575),
                ..Default::default()
            },
            "maxFileSizeBytes must not be less than 1048576",
        ),
        (
            InstanceSettingsPatch {
                max_file_bytes: Some(1_073_741_825),
                ..Default::default()
            },
            "maxFileSizeBytes must not be greater than 1073741824",
        ),
    ];
    for (patch, message) in cases {
        assert!(rig.core.update_instance_settings(patch).await.is_err());
        let view = rig.core.instance_settings();
        assert_eq!(refusal_message(&view.op), message);
    }
    assert_eq!(
        rig.backend.w4.count("w6a_update_settings"),
        0,
        "nothing was sent"
    );

    // The bounds themselves pass.
    rig.backend
        .w4
        .answer("w6a_update_settings", settings_json("Semaphore Chat"));
    rig.core
        .update_instance_settings(InstanceSettingsPatch {
            name: Some("a".repeat(100)),
            description: Some("a".repeat(500)),
            default_quota_bytes: Some(1_073_741_824),
            max_file_bytes: Some(1_073_741_824),
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(rig.backend.w4.count("w6a_update_settings"), 1);
}

#[tokio::test]
async fn a_refused_update_shows_the_servers_message_and_keeps_the_old_settings() {
    let mut rig = Rig::new().signed_in().await;
    rig.backend
        .w4
        .answer("w6a_settings", settings_json("Old name"));
    rig.core.instance_settings();
    rig.settle().await;

    rig.backend
        .w4
        .fail_next("w6a_update_settings", refusal(403, "FORBIDDEN"));
    assert!(
        rig.core
            .update_instance_settings(InstanceSettingsPatch {
                name: Some("New name".into()),
                ..Default::default()
            })
            .await
            .is_err()
    );
    let view = rig.core.instance_settings();
    assert_eq!(view.name, "Old name", "the server kept it");
    assert_eq!(refusal_message(&view.op), "refused: FORBIDDEN");
}

#[tokio::test]
async fn an_update_answer_after_sign_out_changes_nothing() {
    let mut rig = Rig::new().signed_in().await;
    rig.backend
        .w4
        .answer("w6a_settings", settings_json("Old name"));
    rig.core.instance_settings();
    rig.settle().await;

    let hold = rig.backend.w4.hold("w6a_update_settings");
    rig.backend
        .w4
        .answer("w6a_update_settings", settings_json("New name"));
    let update = rig.core.update_instance_settings(InstanceSettingsPatch {
        name: Some("New name".into()),
        ..Default::default()
    });
    let (result, ()) = tokio::join!(update, async {
        tokio::task::yield_now().await;
        rig.core.sign_out().await.unwrap();
        hold.send(()).unwrap();
    });
    assert_eq!(
        result
            .expect_err("the answer is for an ended session")
            .to_string(),
        "signed out"
    );
    let view = rig.core.instance_settings();
    assert_eq!(view.name, "", "the session's settings are gone");
    assert_eq!(view.state, LoadState::Loading);
    assert_eq!(
        rig.backend.w4.count("public_settings"),
        0,
        "a success re-probes; this answer changed nothing"
    );
}

#[tokio::test]
async fn a_new_connection_reads_the_settings_again() {
    let mut rig = Rig::new().signed_in().await;
    rig.backend
        .w4
        .answer("w6a_settings", settings_json("Semaphore Chat"));
    rig.core.instance_settings();
    rig.settle().await;
    assert_eq!(rig.backend.w4.count("w6a_settings"), 1);
    rig.core.ingest(dropped());
    rig.core.ingest(connected());
    rig.settle().await;
    assert_eq!(rig.backend.w4.count("w6a_settings"), 2);
}
