//! The register rules, the browser sign-in mapping and the invite words, then the screens in a
//! window.

use super::invite::{InviteJoinState, invite_date, invite_reason};
use super::*;
use crate::dms::rig::rig;
use crate::panel::PanelClock;
use core::prelude::v1::test;
use gpui_kit::TestAppContext;
use gpui_kit::test::TestQueryExt as _;
use semaphore_core::model::{
    ErrorView, InviteJoin, InvitePreview, InvitePreviewView, InviteSkipReason, JoinedCommunity,
    LoadState, RegisterForm, RegisterRequirements, RegistrationMode, SkippedInviteCommunity,
};

fn form(username: &str, email: Option<&str>, password: &str, code: &str) -> RegisterForm {
    RegisterForm {
        username: username.into(),
        password: password.into(),
        email: email.map(str::to_owned),
        invite_code: code.into(),
    }
}

fn fields(form: &RegisterForm) -> Vec<RegisterField> {
    validate_register(form, true)
        .into_iter()
        .map(|(field, _)| field)
        .collect()
}

fn error(code: &str) -> ErrorView {
    ErrorView {
        code: code.into(),
        message: "nope".into(),
        retryable: true,
        retry_after_ms: None,
    }
}

#[test]
fn register_takes_the_servers_rules() {
    assert!(fields(&form("ava_chen-2", None, "hunter2hunter2", "CODE")).is_empty());
    assert!(fields(&form("av", Some("ava@example.com"), &"p".repeat(128), "C")).is_empty());
    assert_eq!(
        fields(&form("a", Some("ava@"), "short", " ")),
        [
            RegisterField::Username,
            RegisterField::Email,
            RegisterField::Password,
            RegisterField::InviteCode
        ]
    );
    assert_eq!(
        validate_register(&form("ava chen", None, "hunter2hunter2", "C"), true)[0].1,
        "Username can only contain letters, numbers, underscores, and hyphens"
    );
    assert_eq!(
        fields(&form(&"a".repeat(33), None, &"p".repeat(129), "C")),
        [RegisterField::Username, RegisterField::Password]
    );
    for bad in [
        "@example.com",
        "ava@example",
        "ava@@example.com",
        "a va@example.com",
    ] {
        assert_eq!(
            fields(&form("ava", Some(bad), "hunter2hunter2", "C")),
            [RegisterField::Email],
            "{bad}"
        );
    }
}

#[test]
fn the_browser_sign_in_view_maps_to_the_panel() {
    use semaphore_core::model::{BrowserSignInFailure as F, BrowserSignInView as V};
    assert_eq!(
        BrowserLogin::from_view(&V::Idle, false),
        BrowserLogin::Unavailable
    );
    assert_eq!(BrowserLogin::from_view(&V::Idle, true), BrowserLogin::Idle);
    assert_eq!(
        BrowserLogin::from_view(&V::Waiting { expires_at_ms: 1 }, true),
        BrowserLogin::Waiting
    );
    assert_eq!(
        BrowserLogin::from_view(&V::Redeeming, true),
        BrowserLogin::Finishing
    );
    let failed = |reason| BrowserLogin::from_view(&V::Failed { reason }, true);
    assert_eq!(failed(F::Denied), BrowserLogin::Denied);
    assert_eq!(failed(F::TimedOut), BrowserLogin::TimedOut);
    assert_eq!(failed(F::NotOffered), BrowserLogin::Unavailable);
    assert_eq!(
        failed(F::Refused {
            error: error("BAD_CODE")
        }),
        BrowserLogin::Failed
    );
    assert_eq!(
        failed(F::ListenFailed {
            message: "in use".into()
        }),
        BrowserLogin::Failed
    );
}

#[test]
fn invite_expiry_reads_as_the_web_shows_it() {
    assert_eq!(
        invite_date(
            &crate::messages::TimeFormat::fixed(1_798_675_200_000),
            1_798_675_200_000
        ),
        "Dec 31, 2026"
    );
}

#[test]
fn invite_dates_are_written_in_the_users_zone() {
    use crate::messages::TimeFormat;
    use chrono::FixedOffset;

    // Zone minutes east of UTC, the instant, the local date, and the UTC date.
    let cases = [
        (9 * 60, 1_793_804_340_000, "Nov 4, 2026", "Nov 4, 2026"),
        (9 * 60, 1_793_804_460_000, "Nov 5, 2026", "Nov 4, 2026"),
        (-8 * 60, 1_793_865_540_000, "Nov 4, 2026", "Nov 5, 2026"),
        (-8 * 60, 1_793_865_660_000, "Nov 5, 2026", "Nov 5, 2026"),
        // 2026-12-31 15:30 UTC: New Year's Day in +09:00.
        (9 * 60, 1_798_731_000_000, "Jan 1, 2027", "Dec 31, 2026"),
        // 2026-11-05 18:31 UTC: 00:01 the 6th in +05:30.
        (5 * 60 + 30, 1_793_903_460_000, "Nov 6, 2026", "Nov 5, 2026"),
        // 2026-11-05 18:16 UTC: 00:01 the 6th in +05:45.
        (5 * 60 + 45, 1_793_902_560_000, "Nov 6, 2026", "Nov 5, 2026"),
    ];
    for (minutes, ms, local, utc) in cases {
        let zone = FixedOffset::east_opt(minutes * 60).expect("a zone");
        let time = TimeFormat {
            zone: Some(zone),
            now: PanelClock::fixed(ms),
        };
        assert_eq!(invite_date(&time, ms), local, "{minutes} minutes east");
        assert_eq!(
            TimeFormat::fixed(ms).format_at(ms, "%b %-d, %Y"),
            utc,
            "{minutes} minutes east: the UTC date"
        );
    }
}

fn sign_in_step() -> AuthStep {
    AuthStep::SignIn {
        server_url: "https://chat.example.com".into(),
        server_name: "Ladle".into(),
        browser: BrowserLogin::Idle,
        notice: None,
        password_reset: true,
    }
}

#[gpui_kit::test]
fn closed_registration_hides_register(cx: &mut TestAppContext) {
    let closed_rig = rig(cx, 1280., |window, cx| {
        AuthScreen::new(sign_in_step(), window, cx)
    });
    assert!(closed_rig.has(cx, "auth-register"));
    closed_rig.click(cx, "auth-register");
    assert_eq!(closed_rig.events(), [AuthEvent::Register]);

    let closed = RegisterRequirements {
        mode: RegistrationMode::Closed,
        can_register: false,
        invite_required: false,
    };
    closed_rig.with(cx, |screen, _, cx| {
        screen.update(cx, |screen, cx| {
            screen.set_register_requirements(closed, cx)
        })
    });
    assert!(!closed_rig.has(cx, "auth-register"), "no way to register");
    assert!(
        closed_rig.has(cx, "auth-register-closed"),
        "the link is replaced by the sentence"
    );

    // The older setter says the same thing.
    let older = rig(cx, 1280., |window, cx| {
        AuthScreen::new(sign_in_step(), window, cx)
    });
    older.with(cx, |screen, _, cx| {
        screen.update(cx, |screen, cx| {
            screen.set_registration(RegistrationMode::Closed, cx)
        })
    });
    assert!(!older.has(cx, "auth-register"));
    assert!(older.has(cx, "auth-register-closed"));
}

#[gpui_kit::test]
fn register_checks_then_submits_and_waits_while_busy(cx: &mut TestAppContext) {
    let rig = rig(cx, 390., RegisterScreen::new);
    rig.click(cx, "register-submit");
    assert!(rig.events().is_empty(), "an empty form sends nothing");
    rig.with(cx, |screen, window, cx| {
        screen.update(cx, |screen, cx| {
            screen.preset(" ava ", "", "hunter2hunter2", "", window, cx);
            screen.set_invite_code("WELCOME".into(), window, cx);
        })
    });
    rig.click(cx, "register-submit");
    assert_eq!(
        rig.events(),
        [RegisterEvent::Submit(form(
            "ava",
            None,
            "hunter2hunter2",
            "WELCOME"
        ))]
    );
    rig.clear();
    rig.with(cx, |screen, _, cx| {
        screen.update(cx, |screen, cx| screen.set_busy(true, cx))
    });
    rig.click(cx, "register-submit");
    assert!(rig.events().is_empty());
    rig.with(cx, |screen, _, cx| {
        screen.update(cx, |screen, cx| screen.set_error(Some("taken".into()), cx))
    });
    assert!(rig.has(cx, "register-error"));
    rig.click(cx, "register-sign-in");
    rig.click(cx, "register-change-server");
    assert_eq!(
        rig.events(),
        [RegisterEvent::SignIn, RegisterEvent::ChangeServer]
    );
}

#[gpui_kit::test]
fn closed_registration_only_goes_back(cx: &mut TestAppContext) {
    let rig = rig(cx, 1280., |window, cx| {
        let mut screen = RegisterScreen::new(window, cx);
        screen.set_mode(semaphore_core::model::RegistrationMode::Closed, cx);
        screen
    });
    assert!(rig.has(cx, "register-closed"));
    assert!(!rig.has(cx, "register-submit"));
    rig.click(cx, "register-back");
    assert_eq!(rig.events(), [RegisterEvent::SignIn]);
}

#[gpui_kit::test]
fn forgot_password_sends_the_email_then_says_so(cx: &mut TestAppContext) {
    let rig = rig(cx, 390., ForgotPasswordScreen::new);
    rig.click(cx, "forgot-submit");
    assert!(rig.events().is_empty());
    rig.with(cx, |screen, window, cx| {
        screen.update(cx, |screen, cx| {
            screen.preset(" ava@example.com ", window, cx)
        })
    });
    rig.click(cx, "forgot-submit");
    assert_eq!(
        rig.events(),
        [ForgotEvent::Submit {
            email: "ava@example.com".into()
        }]
    );
    rig.with(cx, |screen, _, cx| {
        screen.update(cx, |screen, cx| screen.set_sent(true, cx))
    });
    assert!(rig.has(cx, "forgot-sent"));
    assert!(!rig.has(cx, "forgot-submit"));
    rig.click(cx, "forgot-back");
    assert_eq!(rig.events().last(), Some(&ForgotEvent::Back));
}

fn preview() -> InvitePreviewView {
    InvitePreviewView {
        state: LoadState::Ready,
        invite: Some(InvitePreview {
            code: "WELCOME".into(),
            created_by: None,
            uses: 0,
            max_uses: None,
            valid_until_ms: None,
        }),
        reason: None,
    }
}

#[gpui_kit::test]
fn an_invite_is_joined_or_refused_retried_or_explained(cx: &mut TestAppContext) {
    let rig = rig(cx, 1280., |_, cx| {
        let mut screen = InviteScreen::new(cx);
        screen.set_view(preview(), cx);
        screen
    });
    rig.click(cx, "invite-accept");
    rig.click(cx, "invite-login");
    assert_eq!(
        rig.events(),
        [
            InviteEvent::Accept {
                code: "WELCOME".into()
            },
            InviteEvent::SignIn
        ]
    );
    let set = |view: InvitePreviewView, cx: &mut TestAppContext| {
        rig.with(cx, move |screen, _, cx| {
            screen.update(cx, |screen, cx| screen.set_view(view, cx))
        })
    };
    set(
        InvitePreviewView {
            state: LoadState::Ready,
            invite: None,
            reason: None,
        },
        cx,
    );
    assert!(
        rig.has(cx, "invite-invalid"),
        "read and empty: can't be used"
    );
    assert!(!rig.has(cx, "invite-accept"));
    rig.click(cx, "invite-sign-in");
    set(
        InvitePreviewView {
            state: LoadState::Failed {
                error: error("NETWORK"),
            },
            invite: None,
            reason: None,
        },
        cx,
    );
    rig.clear();
    rig.click(cx, "invite-retry");
    assert_eq!(rig.events(), [InviteEvent::Retry]);

    set(preview(), cx);
    rig.with(cx, |screen, _, cx| {
        screen.update(cx, |screen, cx| screen.set_signed_in(true, cx))
    });
    assert!(rig.has(cx, "invite-join"));
    assert!(!rig.has(cx, "invite-accept"));
    rig.click(cx, "invite-close");
    assert_eq!(rig.events().last(), Some(&InviteEvent::Close));
}

#[gpui_kit::test]
fn setup_notice_emits_open_in_browser(cx: &mut TestAppContext) {
    let rig = rig(cx, 1280., |window, cx| {
        let mut screen = AuthScreen::new(
            AuthStep::ServerUrl {
                testing: false,
                error: None,
            },
            window,
            cx,
        );
        screen.set_setup_needed(Some("https://chat.example.com".into()), cx);
        screen
    });
    assert!(
        !rig.has(cx, "auth-connect"),
        "a server with no users can't be connected to"
    );
    rig.click(cx, "auth-setup-open");
    assert_eq!(
        rig.events(),
        [AuthEvent::OpenInBrowser {
            url: "https://chat.example.com".into()
        }]
    );
    rig.clear();
    rig.click(cx, "auth-setup-change-server");
    assert_eq!(rig.events(), [AuthEvent::ChangeServer]);
}

#[gpui_kit::test]
fn setup_notice_hides_sign_in(cx: &mut TestAppContext) {
    let rig = rig(cx, 1280., |window, cx| {
        let mut screen = AuthScreen::new(sign_in_step(), window, cx);
        screen.set_setup_needed(Some("https://chat.example.com".into()), cx);
        screen
    });
    assert!(!rig.has(cx, "auth-login"), "no accounts to sign in with");
    assert!(!rig.has(cx, "auth-username"));
    assert!(rig.has(cx, "auth-setup-open"));
    rig.with(cx, |screen, _, cx| {
        screen.update(cx, |screen, cx| screen.set_setup_needed(None, cx))
    });
    assert!(rig.has(cx, "auth-login"), "a set-up server signs in here");
    assert!(!rig.has(cx, "auth-setup-open"));
}

#[gpui_kit::test]
fn invite_code_required_only_when_required(cx: &mut TestAppContext) {
    assert!(
        validate_register(&form("ava", None, "hunter2hunter2", ""), false).is_empty(),
        "an open server takes an empty code"
    );
    assert_eq!(
        validate_register(&form("ava", None, "hunter2hunter2", ""), true),
        [(
            RegisterField::InviteCode,
            "An invite code is required".to_owned()
        )]
    );

    let open = rig(cx, 390., |window, cx| {
        let mut screen = RegisterScreen::new(window, cx);
        screen.set_mode(RegistrationMode::Open, cx);
        screen
    });
    open.with(cx, |screen, window, cx| {
        screen.update(cx, |screen, cx| {
            screen.preset("ava", "ava@example.com", "hunter2hunter2", "", window, cx)
        })
    });
    open.with(cx, |_, window, _| {
        assert!(
            window.try_find_by_label("Invite code (optional)").is_some(),
            "an open server's code says it's optional"
        );
    });
    open.click(cx, "register-submit");
    assert_eq!(
        open.events(),
        [RegisterEvent::Submit(form(
            "ava",
            Some("ava@example.com"),
            "hunter2hunter2",
            ""
        ))]
    );

    let invite_only = rig(cx, 390., |window, cx| {
        let mut screen = RegisterScreen::new(window, cx);
        screen.set_mode(RegistrationMode::InviteOnly, cx);
        screen
    });
    invite_only.with(cx, |screen, window, cx| {
        screen.update(cx, |screen, cx| {
            screen.preset("ava", "ava@example.com", "hunter2hunter2", "", window, cx)
        })
    });
    invite_only.with(cx, |_, window, _| {
        assert!(window.try_find_by_label("Invite code").is_some());
        assert!(
            window.try_find_by_label("Invite code (optional)").is_none(),
            "an invite-only server's code isn't optional"
        );
    });
    invite_only.click(cx, "register-submit");
    assert!(
        invite_only.events().is_empty(),
        "an invite-only server sends no form without the code"
    );
}

#[gpui_kit::test]
fn join_button_only_signed_in(cx: &mut TestAppContext) {
    let rig = rig(cx, 1280., |_, cx| {
        let mut screen = InviteScreen::new(cx);
        screen.set_view(preview(), cx);
        screen
    });
    assert!(!rig.has(cx, "invite-join"), "signed out: register instead");
    assert!(rig.has(cx, "invite-accept"));
    rig.with(cx, |screen, _, cx| {
        screen.update(cx, |screen, cx| screen.set_signed_in(true, cx))
    });
    assert!(rig.has(cx, "invite-join"));
    assert!(!rig.has(cx, "invite-accept"));
}

#[gpui_kit::test]
fn join_emits_accept(cx: &mut TestAppContext) {
    let rig = rig(cx, 1280., |_, cx| {
        let mut screen = InviteScreen::new(cx);
        screen.set_view(preview(), cx);
        screen.set_signed_in(true, cx);
        screen
    });
    rig.click(cx, "invite-join");
    assert_eq!(
        rig.events(),
        [InviteEvent::Accept {
            code: "WELCOME".into()
        }]
    );
    rig.clear();
    rig.with(cx, |screen, _, cx| {
        screen.update(cx, |screen, cx| {
            screen.set_join(InviteJoinState::Joining, cx)
        })
    });
    rig.click(cx, "invite-join");
    assert!(rig.events().is_empty(), "a join on its way doesn't repeat");
}

#[gpui_kit::test]
fn joined_lists_joined_and_skipped_with_reasons(cx: &mut TestAppContext) {
    let join = InviteJoin {
        joined: vec![JoinedCommunity {
            id: "c1".into(),
            name: "Maple City".into(),
        }],
        skipped: vec![
            SkippedInviteCommunity {
                id: "c2".into(),
                name: "Pine Ridge".into(),
                reason: InviteSkipReason::AlreadyMember,
            },
            SkippedInviteCommunity {
                id: "c3".into(),
                name: "Bayview".into(),
                reason: InviteSkipReason::Banned,
            },
            SkippedInviteCommunity {
                id: "c4".into(),
                name: "Old Mill".into(),
                reason: InviteSkipReason::Other,
            },
        ],
    };
    let rig = rig(cx, 1280., move |_, cx| {
        let mut screen = InviteScreen::new(cx);
        screen.set_view(preview(), cx);
        screen.set_signed_in(true, cx);
        screen.set_join(InviteJoinState::Joined(join), cx);
        screen
    });
    assert!(rig.has(cx, "invite-joined"));
    assert!(!rig.has(cx, "invite-join"), "nothing more to join");
    rig.with(cx, |_, window, _| {
        assert!(window.try_find_by_label("Maple City").is_some());
        assert!(
            window
                .try_find_by_label("Pine Ridge, You're already a member")
                .is_some()
        );
        assert!(
            window
                .try_find_by_label("Bayview, You're banned from it")
                .is_some()
        );
        assert!(
            window
                .try_find_by_label("Old Mill, Couldn't join")
                .is_some()
        );
    });

    rig.with(cx, |screen, _, cx| {
        screen.update(cx, |screen, cx| {
            screen.set_join(InviteJoinState::Joined(InviteJoin::default()), cx)
        })
    });
    rig.with(cx, |_, window, _| {
        assert!(
            window
                .try_find_by_label("You're already in every community this invite adds")
                .is_some(),
            "an empty result says so"
        );
    });
}

#[test]
fn invite_reason_sentences() {
    assert_eq!(
        invite_reason("INVITE_NOT_FOUND"),
        "This invite doesn't exist"
    );
    assert_eq!(invite_reason("INVITE_EXPIRED"), "This invite has expired");
    assert_eq!(
        invite_reason("INVITE_EXHAUSTED"),
        "This invite has been used up"
    );
    assert_eq!(
        invite_reason("INVITE_DISABLED"),
        "This invite has been disabled"
    );
    assert_eq!(
        invite_reason("This invite has expired."),
        "This invite has expired.",
        "a message from an older server is shown as it came"
    );
    assert_eq!(invite_reason("SOMETHING_ELSE"), "SOMETHING_ELSE");
}
