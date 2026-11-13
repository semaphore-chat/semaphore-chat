//! The instance settings stories: loading, a filled form, failed to load, without the write
//! permission, invalid, saving, refused and long content.
//! `rigs/shot/scripts/ua1-admin-shell-settings.steps` renders them all, on a desktop and a phone.

use super::InstanceSettingsPage;
use crate::dms::stories::failed;
use crate::stories::{Story, StoryEnv};
use gpui_kit::*;
use semaphore_core::model::{
    AdminAction, AdminActionKind as K, AdminActionState, AdminOp, ErrorView, InstanceAdminCaps,
    InstanceSettingsView, LoadState, RegistrationMode,
};

const GIB: u64 = 1_073_741_824;
const MIB: u64 = 1_048_576;

fn caps_owner() -> InstanceAdminCaps {
    InstanceAdminCaps {
        show_admin: true,
        settings_read: true,
        settings_write: true,
        dashboard: true,
        is_owner: true,
        full_authority: true,
        ..InstanceAdminCaps::default()
    }
}

fn caps_read_only() -> InstanceAdminCaps {
    InstanceAdminCaps {
        settings_write: false,
        ..caps_owner()
    }
}

fn error(message: &str) -> ErrorView {
    ErrorView {
        code: "INTERNAL".into(),
        message: message.into(),
        retryable: false,
        retry_after_ms: None,
    }
}

fn state(kind: K, busy: bool, message: Option<&str>) -> AdminActionState {
    AdminActionState {
        action: AdminAction {
            kind,
            target_id: None,
        },
        busy,
        upload: None,
        error: message.map(error),
    }
}

fn op(states: Vec<AdminActionState>) -> AdminOp {
    let last = states.last().cloned();
    AdminOp {
        busy: states.iter().any(|state| state.busy),
        upload: None,
        error: last.as_ref().and_then(|state| state.error.clone()),
        action: last.map(|state| state.action),
        actions: states,
        finished: Vec::new(),
    }
}

#[allow(clippy::too_many_arguments)]
fn settings(
    state: LoadState,
    name: &str,
    description: Option<&str>,
    registration: RegistrationMode,
    default_quota_bytes: u64,
    max_file_bytes: u64,
    op: AdminOp,
) -> InstanceSettingsView {
    InstanceSettingsView {
        state,
        name: name.into(),
        description: description.map(str::to_owned),
        registration,
        default_quota_bytes,
        max_file_bytes,
        op,
    }
}

fn ready() -> InstanceSettingsView {
    settings(
        LoadState::Ready,
        "Northwind Makers",
        Some("A small instance for the Northwind Makers Guild and its friends."),
        RegistrationMode::InviteOnly,
        50 * GIB,
        500 * MIB,
        AdminOp::default(),
    )
}

fn long_name() -> String {
    "Northwind Makers Guild and Community of Practice "
        .chars()
        .cycle()
        .take(100)
        .collect()
}

fn long_description() -> String {
    "word ".repeat(100)
}

fn settings_page(
    caps: InstanceAdminCaps,
    view: InstanceSettingsView,
    window: &mut Window,
    cx: &mut App,
    tweak: impl FnOnce(&mut InstanceSettingsPage, &mut Window, &mut Context<InstanceSettingsPage>),
) -> AnyView {
    cx.new(|cx| {
        let mut page = InstanceSettingsPage::new(window, cx);
        page.set_caps(caps, cx);
        page.set_view(view, cx);
        tweak(&mut page, window, cx);
        page
    })
    .into()
}

type Build = fn(&StoryEnv, &mut Window, &mut App) -> AnyView;

pub(crate) fn stories() -> Vec<Story> {
    let all: Vec<(&'static str, Build)> = vec![
        ("admin-settings-loading", |_, window, cx| {
            settings_page(
                caps_owner(),
                InstanceSettingsView::default(),
                window,
                cx,
                |_, _, _| {},
            )
        }),
        ("admin-settings-ready", |_, window, cx| {
            settings_page(caps_owner(), ready(), window, cx, |_, _, _| {})
        }),
        ("admin-settings-failed", |_, window, cx| {
            settings_page(
                caps_owner(),
                InstanceSettingsView {
                    state: failed(),
                    ..InstanceSettingsView::default()
                },
                window,
                cx,
                |_, _, _| {},
            )
        }),
        ("admin-settings-read-only", |_, window, cx| {
            settings_page(caps_read_only(), ready(), window, cx, |_, _, _| {})
        }),
        ("admin-settings-invalid", |_, window, cx| {
            let too_long = format!("{}!", long_name());
            settings_page(
                caps_owner(),
                ready(),
                window,
                cx,
                move |page, window, cx| {
                    page.preset(
                        Some(&too_long),
                        None,
                        None,
                        Some("0"),
                        Some("2000"),
                        window,
                        cx,
                    )
                },
            )
        }),
        ("admin-settings-busy", |_, window, cx| {
            let view = settings(
                LoadState::Ready,
                "Northwind Makers",
                Some("A small instance for the Northwind Makers Guild and its friends."),
                RegistrationMode::InviteOnly,
                50 * GIB,
                500 * MIB,
                op(vec![state(K::UpdateInstanceSettings, true, None)]),
            );
            settings_page(caps_owner(), view, window, cx, |page, window, cx| {
                page.preset(
                    Some("Northwind Makers Guild"),
                    None,
                    None,
                    None,
                    None,
                    window,
                    cx,
                )
            })
        }),
        ("admin-settings-refused", |_, window, cx| {
            let view = settings(
                LoadState::Ready,
                "Northwind Makers",
                Some("A small instance for the Northwind Makers Guild and its friends."),
                RegistrationMode::InviteOnly,
                50 * GIB,
                500 * MIB,
                op(vec![state(
                    K::UpdateInstanceSettings,
                    false,
                    Some("maxFileSizeBytes must not be greater than 1073741824"),
                )]),
            );
            settings_page(caps_owner(), view, window, cx, |page, window, cx| {
                page.preset(None, None, None, None, Some("1024"), window, cx)
            })
        }),
        ("admin-settings-long", |_, window, cx| {
            let view = settings(
                LoadState::Ready,
                &long_name(),
                Some(&long_description()),
                RegistrationMode::Open,
                250 * GIB,
                1024 * MIB,
                AdminOp::default(),
            );
            settings_page(caps_owner(), view, window, cx, |_, _, _| {})
        }),
    ];
    all.into_iter()
        .map(|(name, build)| Story::new(name, build))
        .collect()
}
