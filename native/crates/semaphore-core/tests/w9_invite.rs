//! Invites: joining one with an existing account (`POST /invite/{code}/accept`), the reason a
//! code can't be used, and the registration modes the probe advertises.

mod common;

use common::*;
use semaphore_core::backend::BackendError;
use semaphore_core::commands::onboarding::{NO_INVITE, REGISTRATION_CLOSED};
use semaphore_core::model::{
    InviteSkipReason, LoadState, RegisterForm, RegisterRequirements, RegistrationMode, SessionState,
};
use semaphore_core::platform::CoreError;
use semaphore_wire::enums::ErrorCode;
use serde_json::{Value, json};

fn settings(mode: &str) -> Value {
    json!({
        "name": "Test", "registrationMode": mode, "maxFileSizeBytes": 1000,
        "gifSearchEnabled": false, "passwordResetEnabled": true, "desktopBrowserLogin": false,
    })
}

fn error(status: u16, code: &str, message: &str) -> BackendError {
    BackendError {
        status,
        code: ErrorCode::Unknown(code.into()),
        message: message.into(),
        retryable: false,
        retry_after_ms: None,
    }
}

fn form(code: &str) -> RegisterForm {
    RegisterForm {
        username: "newcomer".into(),
        password: "a long password".into(),
        email: None,
        invite_code: code.into(),
    }
}

/// A signed-in rig, probed at an invite-only instance.
async fn signed_in_rig() -> Rig {
    let rig = Rig::new();
    rig.backend
        .w3
        .answer("public_settings", settings("INVITE_ONLY"));
    rig.core.probe_server("http://server".into()).await.unwrap();
    rig.signed_in().await
}

// --- The registration modes -------------------------------------------------------------------

#[tokio::test]
async fn the_probe_says_what_the_register_screen_offers() {
    let table = [
        (
            "OPEN",
            RegisterRequirements {
                mode: RegistrationMode::Open,
                can_register: true,
                invite_required: false,
            },
        ),
        (
            "INVITE_ONLY",
            RegisterRequirements {
                mode: RegistrationMode::InviteOnly,
                can_register: true,
                invite_required: true,
            },
        ),
        (
            "CLOSED",
            RegisterRequirements {
                mode: RegistrationMode::Closed,
                can_register: false,
                invite_required: false,
            },
        ),
    ];
    for (wire, expected) in table {
        let rig = Rig::new();
        rig.backend.w3.answer("public_settings", settings(wire));
        rig.core.probe_server("http://server".into()).await.unwrap();
        assert_eq!(rig.core.register_requirements(), expected, "{wire}");
    }
    // Nothing probed yet: the stricter mode that still registers.
    let rig = Rig::new();
    assert_eq!(
        rig.core.register_requirements(),
        RegisterRequirements {
            mode: RegistrationMode::InviteOnly,
            can_register: true,
            invite_required: true,
        }
    );
}

#[tokio::test]
async fn a_closed_instance_takes_no_registration_without_asking_it() {
    let rig = Rig::new();
    rig.backend.w3.answer("public_settings", settings("CLOSED"));
    rig.core.probe_server("http://server".into()).await.unwrap();
    let failure = rig.core.register(form("CODE")).await.unwrap_err();
    assert_eq!(
        failure,
        CoreError::Failed {
            message: REGISTRATION_CLOSED.into()
        }
    );
    // Nothing went out but the probe's own reads.
    assert_eq!(rig.backend.w3.count("register"), 0);
    assert_eq!(rig.core.session(), SessionState::SignedOut);
}

#[tokio::test]
async fn an_invite_only_instance_needs_a_code_and_asks_nothing_without_one() {
    let rig = Rig::new();
    rig.backend
        .w3
        .answer("public_settings", settings("INVITE_ONLY"));
    rig.core.probe_server("http://server".into()).await.unwrap();
    let failure = rig.core.register(form("  ")).await.unwrap_err();
    assert_eq!(
        failure,
        CoreError::Failed {
            message: NO_INVITE.into()
        }
    );
    assert_eq!(rig.backend.w3.count("register"), 0);

    // With one, the server makes the account and the session follows.
    rig.backend.w3.answer("register", user_json(ME));
    rig.core.register(form(" CODE ")).await.unwrap();
    assert_eq!(
        rig.backend.w3.calls().last().unwrap(),
        "register newcomer CODE"
    );
    assert!(matches!(rig.core.session(), SessionState::SignedIn { .. }));
}

#[tokio::test]
async fn an_open_instance_takes_an_account_without_a_code() {
    let rig = Rig::new();
    rig.backend.w3.answer("public_settings", settings("OPEN"));
    rig.core.probe_server("http://server".into()).await.unwrap();
    rig.backend.w3.answer("register", user_json(ME));
    rig.core.register(form("")).await.unwrap();
    assert!(
        rig.backend
            .w3
            .calls()
            .iter()
            .any(|call| call == "register newcomer <no code>")
    );
}

// --- Joining an invite as an existing account -------------------------------------------------

#[tokio::test]
async fn accepting_an_invite_joins_some_communities_and_skips_others_with_why() {
    let rig = signed_in_rig().await;
    rig.backend.w3.answer(
        "accept_invite",
        json!({
            "joined": [{ "id": "c-new", "name": "New" }],
            "skipped": [
                { "id": "c-couch", "name": "Couch", "reason": "already_member" },
                { "id": "c-banned", "name": "Banned", "reason": "banned" },
                { "id": "c-odd", "name": "Odd", "reason": "something_new" },
            ],
        }),
    );
    let communities = rig
        .backend
        .community_requests
        .load(std::sync::atomic::Ordering::SeqCst);
    let join = rig.core.accept_invite(" CODE ".into()).await.unwrap();
    assert_eq!(
        rig.backend.w3.calls().last().unwrap(),
        "accept_invite CODE",
        "trimmed"
    );
    assert_eq!(join.joined.len(), 1);
    assert_eq!(join.joined[0].id, "c-new");
    assert_eq!(join.joined[0].name, "New");
    assert_eq!(join.skipped.len(), 3);
    assert_eq!(join.skipped[0].reason, InviteSkipReason::AlreadyMember);
    assert_eq!(join.skipped[1].reason, InviteSkipReason::Banned);
    assert_eq!(
        join.skipped[2].reason,
        InviteSkipReason::Other,
        "a reason this build doesn't know"
    );
    // The list of communities is read again: the joined one appears there.
    rig.core.run_until_idle().await;
    assert!(
        rig.backend
            .community_requests
            .load(std::sync::atomic::Ordering::SeqCst)
            > communities,
        "the community list is read again after a join"
    );
}

#[tokio::test]
async fn an_invite_that_joins_nothing_leaves_the_community_list_alone() {
    let rig = signed_in_rig().await;
    rig.backend.w3.answer(
        "accept_invite",
        json!({ "joined": [], "skipped": [
            { "id": "c-couch", "name": "Couch", "reason": "already_member" },
        ] }),
    );
    let communities = rig
        .backend
        .community_requests
        .load(std::sync::atomic::Ordering::SeqCst);
    let join = rig.core.accept_invite("CODE".into()).await.unwrap();
    assert!(join.joined.is_empty());
    assert!(!join.is_empty());
    rig.core.run_until_idle().await;
    assert_eq!(
        rig.backend
            .community_requests
            .load(std::sync::atomic::Ordering::SeqCst),
        communities
    );
}

#[tokio::test]
async fn an_invite_the_server_refuses_says_its_words() {
    let rig = signed_in_rig().await;
    rig.backend.w3.fail_next(
        "accept_invite",
        error(404, "NOT_FOUND", "No invite found for the provided code."),
    );
    let failure = rig.core.accept_invite("GONE".into()).await.unwrap_err();
    let CoreError::Failed { message } = failure else {
        panic!("a refusal is a failure");
    };
    // Core's errors carry the server's code first, as every failed command does.
    assert!(
        message.ends_with("No invite found for the provided code."),
        "{message}"
    );
}

#[tokio::test]
async fn joining_needs_a_session_and_a_code() {
    let rig = Rig::new();
    rig.backend
        .w3
        .answer("public_settings", settings("INVITE_ONLY"));
    rig.core.probe_server("http://server".into()).await.unwrap();
    assert_eq!(
        rig.core.accept_invite("CODE".into()).await.unwrap_err(),
        CoreError::Failed {
            message: "signed out".into()
        }
    );

    let rig = signed_in_rig().await;
    assert_eq!(
        rig.core.accept_invite("  ".into()).await.unwrap_err(),
        CoreError::Failed {
            message: NO_INVITE.into()
        }
    );
    assert_eq!(rig.backend.w3.count("accept_invite"), 0);
}

#[tokio::test]
async fn an_answer_after_sign_out_joins_nothing_for_the_next_session() {
    let rig = signed_in_rig().await;
    let held = rig.backend.w3.hold("accept_invite");
    rig.backend.w3.answer(
        "accept_invite",
        json!({ "joined": [{ "id": "c-new", "name": "New" }], "skipped": [] }),
    );
    let communities = rig
        .backend
        .community_requests
        .load(std::sync::atomic::Ordering::SeqCst);
    let call = rig.core.accept_invite("CODE".into());
    let (outcome, ()) = tokio::join!(call, async {
        tokio::task::yield_now().await;
        rig.core.sign_out().await.unwrap();
        held.send(()).unwrap();
    });
    assert!(matches!(outcome, Err(CoreError::Failed { .. })));
    assert_eq!(
        rig.backend
            .community_requests
            .load(std::sync::atomic::Ordering::SeqCst),
        communities,
        "the old session's join reads nothing into the new one"
    );
}

// --- The reason a code can't be used ----------------------------------------------------------

#[tokio::test]
async fn a_code_the_server_will_not_honour_reads_as_unusable_with_its_reason() {
    let rig = Rig::new();
    rig.core.probe_server("http://server".into()).await.ok();
    rig.backend.w3.fail_next(
        "invite",
        error(404, "INVITE_EXPIRED", "This invite has expired."),
    );
    rig.core.invite_preview("OLD".into());
    rig.core.run_until_idle().await;
    let view = rig.core.invite_preview("OLD".into());
    assert_eq!(view.state, LoadState::Ready, "an answer, not a failed read");
    assert_eq!(view.invite, None);
    assert_eq!(view.reason.as_deref(), Some("This invite has expired."));
}

#[tokio::test]
async fn a_read_that_got_no_answer_is_a_failure_with_no_reason() {
    let rig = Rig::new();
    rig.core.probe_server("http://server".into()).await.ok();
    rig.backend
        .w3
        .fail_next("invite", error(500, "INTERNAL", "boom"));
    rig.core.invite_preview("LATER".into());
    rig.core.run_until_idle().await;
    let view = rig.core.invite_preview("LATER".into());
    assert!(matches!(view.state, LoadState::Failed { .. }));
    assert_eq!(view.reason, None);
    // A retry reads again.
    rig.backend.w3.answer(
        "invite",
        json!({ "code": "LATER", "uses": 0, "maxUses": null, "validUntil": null,
                "disabled": false, "createdBy": null }),
    );
    rig.core.retry_failed();
    rig.core.invite_preview("LATER".into());
    rig.core.run_until_idle().await;
    assert_eq!(
        rig.core.invite_preview("LATER".into()).state,
        LoadState::Ready
    );
    assert!(rig.core.invite_preview("LATER".into()).invite.is_some());
}

// --- A trait object is what the commands hold -------------------------------------------------

#[test]
fn the_accept_answer_is_the_contracts_shape() {
    // The fake decodes into the wire type, so this is the compile-time half of that check: the
    // fields core reads are the contract's.
    let answer: semaphore_wire::types::AcceptInviteResponseDto = serde_json::from_value(json!({
        "joined": [{ "id": "c", "name": "C" }],
        "skipped": [{ "id": "d", "name": "D", "reason": "banned" }],
    }))
    .unwrap();
    assert_eq!(answer.joined[0].name, "C");
    assert_eq!(
        answer.skipped[0].reason,
        semaphore_wire::enums::InviteSkipReason::Banned
    );
}
