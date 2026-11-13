//! The instance settings form in a window: what Save sends, that an invalid form sends nothing,
//! that reads without the write permission offer no save, and that the form waits on its change.

use super::InstanceSettingsPage;
use crate::dms::rig::{Rig, rig};
use gpui_kit::test::TestWindowExt as _;
use gpui_kit::{Context, TestAppContext, Window};
use semaphore_core::model::{
    AdminAction, AdminActionKind, AdminActionOutcome, AdminActionState, AdminOp, ErrorView,
    InstanceAdminCaps, InstanceSettingsPatch, InstanceSettingsView, LoadState, RegistrationMode,
};

const GIB: u64 = 1_073_741_824;
const MIB: u64 = 1_048_576;

fn caps(write: bool) -> InstanceAdminCaps {
    InstanceAdminCaps {
        show_admin: true,
        settings_read: true,
        settings_write: write,
        is_owner: write,
        ..InstanceAdminCaps::default()
    }
}

fn error(message: &str) -> ErrorView {
    ErrorView {
        code: "BAD_REQUEST".into(),
        message: message.into(),
        retryable: false,
        retry_after_ms: None,
    }
}

fn view() -> InstanceSettingsView {
    InstanceSettingsView {
        state: LoadState::Ready,
        name: "Northwind Makers".into(),
        description: Some("A small instance for the Northwind Makers Guild.".into()),
        registration: RegistrationMode::InviteOnly,
        default_quota_bytes: 50 * GIB,
        max_file_bytes: 500 * MIB,
        op: AdminOp::default(),
    }
}

fn action() -> AdminAction {
    AdminAction {
        kind: AdminActionKind::UpdateInstanceSettings,
        target_id: None,
    }
}

fn op(states: Vec<AdminActionState>, finished: Vec<AdminActionOutcome>) -> AdminOp {
    let last = states.last().cloned();
    AdminOp {
        busy: states.iter().any(|state| state.busy),
        upload: None,
        error: last.as_ref().and_then(|state| state.error.clone()),
        action: last.map(|state| state.action),
        actions: states,
        finished,
    }
}

fn settings_rig(
    cx: &mut TestAppContext,
    caps: InstanceAdminCaps,
) -> Rig<InstanceSettingsPage, super::InstanceSettingsEvent> {
    rig(cx, 1000., move |window, cx| {
        let mut page = InstanceSettingsPage::new(window, cx);
        page.set_caps(caps, cx);
        page.set_view(view(), cx);
        page
    })
}

fn preset(
    rig: &Rig<InstanceSettingsPage, super::InstanceSettingsEvent>,
    cx: &mut TestAppContext,
    f: impl FnOnce(&mut InstanceSettingsPage, &mut Window, &mut Context<InstanceSettingsPage>),
) {
    rig.with(cx, |view, window, cx| {
        view.update(cx, |page, cx| f(page, window, cx))
    });
}

#[gpui_kit::test]
fn settings_save_sends_only_changed_fields(cx: &mut TestAppContext) {
    let rig = settings_rig(cx, caps(true));
    preset(&rig, cx, |page, window, cx| {
        page.preset(
            Some("Northwind Makers Guild"),
            None,
            None,
            None,
            None,
            window,
            cx,
        )
    });
    rig.click(cx, "admin-settings-save");
    assert_eq!(
        rig.events(),
        [super::InstanceSettingsEvent::Save(InstanceSettingsPatch {
            name: Some("Northwind Makers Guild".into()),
            ..InstanceSettingsPatch::default()
        })]
    );
}

#[gpui_kit::test]
fn settings_converts_gb_and_mb_to_bytes(cx: &mut TestAppContext) {
    let rig = settings_rig(cx, caps(true));
    preset(&rig, cx, |page, window, cx| {
        page.preset(None, None, None, Some("64"), Some("512"), window, cx)
    });
    rig.click(cx, "admin-settings-save");
    assert_eq!(
        rig.events(),
        [super::InstanceSettingsEvent::Save(InstanceSettingsPatch {
            default_quota_bytes: Some(64 * GIB),
            max_file_bytes: Some(512 * MIB),
            ..InstanceSettingsPatch::default()
        })]
    );
}

#[gpui_kit::test]
fn settings_invalid_sends_nothing(cx: &mut TestAppContext) {
    type Fill = fn(&mut InstanceSettingsPage, &mut Window, &mut Context<InstanceSettingsPage>);
    let rows: [(&str, Fill); 6] = [
        ("name over 100", |page, window, cx| {
            page.preset(Some(&"n".repeat(101)), None, None, None, None, window, cx)
        }),
        ("description over 500", |page, window, cx| {
            page.preset(None, Some(&"d".repeat(501)), None, None, None, window, cx)
        }),
        ("quota below 1 GB", |page, window, cx| {
            page.preset(None, None, None, Some("0"), None, window, cx)
        }),
        ("quota not a whole number", |page, window, cx| {
            page.preset(None, None, None, Some("1.5"), None, window, cx)
        }),
        ("max file below 1 MB", |page, window, cx| {
            page.preset(None, None, None, None, Some("0"), window, cx)
        }),
        ("max file above 1 GB", |page, window, cx| {
            page.preset(None, None, None, None, Some("2000"), window, cx)
        }),
    ];
    for (label, fill) in rows {
        let rig = settings_rig(cx, caps(true));
        preset(&rig, cx, fill);
        let disabled = rig.with(cx, |_, window, _| {
            window
                .find("admin-settings-save")
                .disabled()
                .unwrap_or(false)
        });
        assert!(disabled, "{label}: Save is off");
        rig.click(cx, "admin-settings-save");
        assert!(rig.events().is_empty(), "{label}");
    }
}

#[gpui_kit::test]
fn settings_read_only_offers_no_save(cx: &mut TestAppContext) {
    let rig = settings_rig(cx, caps(false));
    preset(&rig, cx, |page, window, cx| {
        page.preset(Some("Somewhere Else"), None, None, None, None, window, cx)
    });
    rig.click(cx, "admin-settings-save");
    assert!(rig.events().is_empty(), "no write permission");
    assert!(
        rig.with(cx, |_, window, _| {
            window
                .find("admin-settings-save")
                .disabled()
                .unwrap_or(false)
        }),
        "Save is off"
    );
    assert!(
        rig.has(cx, "admin-settings-locked"),
        "the reason is shown, not just a disabled button"
    );
    assert!(rig.has(cx, "admin-settings-name"), "the fields are shown");
}

#[gpui_kit::test]
fn settings_save_waits_for_its_change(cx: &mut TestAppContext) {
    let rig = settings_rig(cx, caps(true));
    preset(&rig, cx, |page, window, cx| {
        page.preset(
            Some("Northwind Makers Guild"),
            None,
            None,
            None,
            None,
            window,
            cx,
        )
    });
    rig.click(cx, "admin-settings-save");
    assert_eq!(rig.events().len(), 1);
    assert!(rig.has(cx, "admin-settings-busy"), "the save is on its way");
    rig.click(cx, "admin-settings-save");
    assert_eq!(rig.events().len(), 1, "it doesn't repeat while pending");

    // Core started it.
    let mut running = view();
    running.op = op(
        vec![AdminActionState {
            action: action(),
            busy: true,
            upload: None,
            error: None,
        }],
        Vec::new(),
    );
    rig.with(cx, |view, _, cx| {
        view.update(cx, |page, cx| page.set_view(running, cx))
    });
    assert!(rig.has(cx, "admin-settings-busy"), "still saving");

    // Core recorded that it ended: the busy state closes through `AdminOp::finished`.
    let mut ended = view();
    ended.op = op(
        Vec::new(),
        vec![AdminActionOutcome {
            action: action(),
            seq: 1,
            error: None,
        }],
    );
    rig.with(cx, |view, _, cx| {
        view.update(cx, |page, cx| page.set_view(ended, cx))
    });
    assert!(!rig.has(cx, "admin-settings-busy"), "the save finished");
    rig.click(cx, "admin-settings-save");
    assert_eq!(rig.events().len(), 2, "the form can be saved again");
}

#[gpui_kit::test]
fn a_refused_save_shows_the_servers_message_under_save(cx: &mut TestAppContext) {
    let rig = settings_rig(cx, caps(true));
    let mut refused = view();
    refused.op = op(
        vec![AdminActionState {
            action: action(),
            busy: false,
            upload: None,
            error: Some(error(
                "maxFileSizeBytes must not be greater than 1073741824",
            )),
        }],
        Vec::new(),
    );
    rig.with(cx, |view, _, cx| {
        view.update(cx, |page, cx| page.set_view(refused, cx))
    });
    preset(&rig, cx, |page, window, cx| {
        page.preset(None, None, None, None, Some("1024"), window, cx)
    });
    let message = rig.with(cx, |_, window, _| {
        window.find("alert").label().map(str::to_owned)
    });
    assert_eq!(
        message.as_deref(),
        Some("maxFileSizeBytes must not be greater than 1073741824"),
        "the server's message, under Save"
    );
    assert!(
        !rig.has(cx, "admin-settings-busy"),
        "a refusal isn't running"
    );
    rig.click(cx, "admin-settings-save");
    assert_eq!(rig.events().len(), 1, "the form can try again");
}

#[test]
fn validation_messages_speak_in_the_fields_units() {
    use super::{description_error, grouped, max_file_error, name_error, quota_error};
    assert_eq!(name_error(0), None);
    assert_eq!(name_error(100), None);
    assert_eq!(
        name_error(101).as_deref(),
        Some("Name must be 100 characters or fewer")
    );
    assert_eq!(description_error(500), None);
    assert_eq!(
        description_error(501).as_deref(),
        Some("Description must be 500 characters or fewer")
    );
    assert_eq!(quota_error(Some(1)), None);
    assert_eq!(quota_error(Some(5000)), None, "the quota has no maximum");
    for typed in [Some(0), None] {
        assert_eq!(
            quota_error(typed).as_deref(),
            Some("Quota must be at least 1 GB")
        );
    }
    assert_eq!(max_file_error(Some(1)), None);
    assert_eq!(max_file_error(Some(1024)), None);
    for typed in [Some(0), None] {
        assert_eq!(
            max_file_error(typed).as_deref(),
            Some("Max file size must be at least 1 MB")
        );
    }
    assert_eq!(
        max_file_error(Some(1025)).as_deref(),
        Some("Max file size must be 1,024 MB or less")
    );
    assert_eq!(grouped(7), "7");
    assert_eq!(grouped(1024), "1,024");
    assert_eq!(grouped(1_234_567), "1,234,567");
}
