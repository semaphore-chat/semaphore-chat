//! The view values the communities stories and tests share: caps, communities with their counts,
//! and the list and detail views for each state. Each caller needs a different subset, so unused
//! ones are expected in either build.

#![allow(dead_code)]

use semaphore_core::model::{
    AdminAction, AdminActionKind, AdminActionOutcome, AdminActionState, AdminCommunitiesView,
    AdminCommunityRow, AdminCommunityView, AdminOp, ErrorView, InstanceAdminCaps, LoadState,
};

pub(super) const DAY: i64 = 24 * 60 * 60 * 1000;

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

/// May read every community, and nothing else.
pub(super) fn reader() -> InstanceAdminCaps {
    InstanceAdminCaps {
        show_admin: true,
        communities_read: true,
        ..InstanceAdminCaps::default()
    }
}

pub(super) fn nobody() -> InstanceAdminCaps {
    InstanceAdminCaps::default()
}

pub(super) fn error(message: &str) -> ErrorView {
    ErrorView {
        code: "FORBIDDEN".into(),
        message: message.into(),
        retryable: false,
        retry_after_ms: None,
    }
}

pub(super) fn community(
    id: &str,
    name: &str,
    description: Option<&str>,
    members: u64,
    channels: u64,
    created_at_ms: i64,
) -> AdminCommunityRow {
    AdminCommunityRow {
        id: id.into(),
        name: name.into(),
        description: description.map(str::to_owned),
        avatar_file_id: None,
        member_count: members,
        channel_count: channels,
        created_at_ms,
    }
}

/// The first page, with one of each kind of community the screen renders.
pub(super) fn rows() -> Vec<AdminCommunityRow> {
    vec![
        community(
            "c-northwind",
            "Northwind Makers",
            Some(
                "A workshop for people who build things: electronics, wood, code and everything between.",
            ),
            248,
            12,
            crate::messages::fixture::NOW_MS - 402 * DAY,
        ),
        community(
            "c-nightowl",
            "Nightowl Collective",
            Some("Late-night chats, synth jams and quiet company."),
            41,
            4,
            crate::messages::fixture::NOW_MS - 96 * DAY,
        ),
        community(
            "c-riverside",
            "Riverside Book Club",
            None,
            7,
            2,
            crate::messages::fixture::NOW_MS - 12 * DAY,
        ),
        community(
            "c-archived",
            "Archived Projects",
            Some("Read-only keepsakes from 2024."),
            2,
            1,
            crate::messages::fixture::NOW_MS - 640 * DAY,
        ),
    ]
}

/// Sixty communities whose names and descriptions run to the limit, so every line must truncate.
pub(super) fn long_rows() -> Vec<AdminCommunityRow> {
    (0..60)
        .map(|index| {
            let name = format!(
                "Community {index:02} of the long names that keep going and must never push the buttons off the row {}",
                "x".repeat(30)
            );
            let description = format!(
                "A description that is far too long for any single line of a list row, repeated {} times to reach the end",
                "very long ".repeat(8)
            );
            community(
                &format!("c-long-{index:02}"),
                &name,
                Some(&description),
                1_000 + index as u64 * 37,
                3 + index as u64,
                crate::messages::fixture::NOW_MS - (index as i64 + 1) * 3 * DAY,
            )
        })
        .collect()
}

pub(super) fn view(
    state: LoadState,
    rows: Vec<AdminCommunityRow>,
    more: bool,
    loading_more: bool,
    op: AdminOp,
) -> AdminCommunitiesView {
    AdminCommunitiesView {
        state,
        search: String::new(),
        rows,
        more,
        loading_more,
        op,
    }
}

pub(super) fn ready() -> AdminCommunitiesView {
    view(LoadState::Ready, rows(), false, false, AdminOp::default())
}

pub(super) fn failed() -> LoadState {
    LoadState::Failed {
        error: error("The server couldn't list the instance's communities."),
    }
}

pub(super) fn detail(
    community: Option<AdminCommunityRow>,
    message_count: u64,
    op: AdminOp,
) -> AdminCommunityView {
    AdminCommunityView {
        state: LoadState::Ready,
        community,
        message_count,
        op,
    }
}

pub(super) fn state(kind: AdminActionKind, target: Option<&str>) -> AdminActionState {
    AdminActionState {
        action: AdminAction {
            kind,
            target_id: target.map(str::to_owned),
        },
        busy: false,
        upload: None,
        error: None,
    }
}

pub(super) fn busy(kind: AdminActionKind, target: Option<&str>) -> AdminOp {
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

pub(super) fn erred(kind: AdminActionKind, target: Option<&str>, message: &str) -> AdminOp {
    let mut entry = state(kind, target);
    entry.error = Some(error(message));
    AdminOp {
        error: entry.error.clone(),
        action: Some(entry.action.clone()),
        actions: vec![entry.clone()],
        finished: vec![AdminActionOutcome {
            action: entry.action,
            seq: 1,
            error: entry.error,
        }],
        ..AdminOp::default()
    }
}
