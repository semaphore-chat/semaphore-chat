//! The instance invites stories and tests share: caps, the communities an invite can add people to,
//! and the rows in every state the list draws. Each caller needs a different subset, so unused ones
//! are expected in either build.

#![allow(dead_code)]

use semaphore_core::model::{
    AdminAction, AdminActionKind, AdminActionOutcome, AdminActionState, AdminInvitesView, AdminOp,
    CommunityRow, ErrorView, InstanceAdminCaps, InstanceInviteRow, InviteCommunity, LoadState,
    UserView,
};

pub(super) const DAY: i64 = 24 * 60 * 60 * 1000;

pub(super) fn now() -> i64 {
    crate::messages::fixture::NOW_MS
}

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

/// May read the list, and nothing else.
pub(super) fn reader() -> InstanceAdminCaps {
    InstanceAdminCaps {
        show_admin: true,
        invites_read: true,
        ..InstanceAdminCaps::default()
    }
}

pub(super) fn user(id: &str, username: &str, display: Option<&str>) -> UserView {
    UserView {
        id: id.into(),
        username: username.into(),
        display_name: display.map(str::to_owned),
        avatar_file_id: None,
    }
}

pub(super) fn community(id: &str, name: &str) -> CommunityRow {
    CommunityRow {
        id: id.into(),
        name: name.into(),
        avatar_file_id: None,
        unread_count: 0,
        mention_count: 0,
    }
}

pub(super) fn communities() -> Vec<CommunityRow> {
    vec![
        community("c-northwind", "Northwind Makers"),
        community("c-nightowl", "Nightowl Collective"),
        community("c-riverside", "Riverside Book Club"),
        community("c-archived", "Archived Projects"),
    ]
}

pub(super) fn invite(
    code: &str,
    uses: u32,
    max: Option<u32>,
    until: Option<i64>,
    disabled: bool,
    by: Option<UserView>,
    in_communities: &[&str],
) -> InstanceInviteRow {
    InstanceInviteRow {
        code: code.into(),
        created_by: by,
        uses,
        max_uses: max,
        valid_until_ms: until,
        created_at_ms: now() - 3 * DAY,
        disabled,
        communities: in_communities
            .iter()
            .map(|id| InviteCommunity {
                id: (*id).into(),
                name: match *id {
                    "c-northwind" => "Northwind Makers",
                    "c-nightowl" => "Nightowl Collective",
                    "c-riverside" => "Riverside Book Club",
                    _ => "Archived Projects",
                }
                .into(),
            })
            .collect(),
    }
}

/// One of each state the screen shows: active, expired, used up and disabled.
pub(super) fn rows() -> Vec<InstanceInviteRow> {
    let nova = Some(user("u-nova", "nova", None));
    let mike = Some(user("u-mike", "mike", Some("Mike R.")));
    vec![
        invite(
            "aB3x9Q",
            2,
            Some(10),
            Some(now() + 5 * DAY),
            false,
            nova.clone(),
            &["c-northwind", "c-nightowl"],
        ),
        invite(
            "fr33Pass",
            14,
            None,
            None,
            false,
            mike.clone(),
            &["c-northwind"],
        ),
        invite(
            "oldLink",
            1,
            Some(5),
            Some(now() - DAY),
            false,
            nova,
            &["c-riverside"],
        ),
        invite("fullUp", 3, Some(3), None, false, mike, &[]),
        invite("paused", 0, None, None, true, None, &["c-archived"]),
    ]
}

/// Forty invites, each adding people to six communities whose names run to the limit, with long
/// codes and, every fifth row, a creator whose display name is too long for one line.
pub(super) fn long_rows() -> Vec<InstanceInviteRow> {
    let long_name = format!(
        "Community of the long names that keep going and must never push the buttons off the row {}",
        "y".repeat(20)
    );
    let long_person = format!(
        "A display name that runs on and on and on, past any row {}",
        "z".repeat(24)
    );
    (0..40)
        .map(|index| InstanceInviteRow {
            code: format!("code{index:02}xYz{}", "Q".repeat(index % 12)),
            created_by: Some(user(
                &format!("u-{index}"),
                &format!("person{index}"),
                (index % 5 == 0).then_some(long_person.as_str()),
            )),
            uses: index as u32,
            max_uses: Some(50),
            valid_until_ms: Some(now() + (index as i64 + 1) * DAY),
            created_at_ms: now() - 3 * DAY,
            disabled: false,
            communities: (0..6)
                .map(|slot| InviteCommunity {
                    id: format!("c-long-{slot}"),
                    name: format!("{long_name} {slot}"),
                })
                .collect(),
        })
        .collect()
}

pub(super) fn view(
    state: LoadState,
    rows: Vec<InstanceInviteRow>,
    op: AdminOp,
) -> AdminInvitesView {
    AdminInvitesView { state, rows, op }
}

pub(super) fn ready() -> AdminInvitesView {
    view(LoadState::Ready, rows(), AdminOp::default())
}

pub(super) fn failed() -> LoadState {
    LoadState::Failed {
        error: ErrorView {
            code: "UNAVAILABLE".into(),
            message: "The server couldn't list the instance's invites.".into(),
            retryable: true,
            retry_after_ms: None,
        },
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
    let error = ErrorView {
        code: "FORBIDDEN".into(),
        message: message.into(),
        retryable: false,
        retry_after_ms: None,
    };
    let mut entry = state(kind, target);
    entry.error = Some(error);
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
