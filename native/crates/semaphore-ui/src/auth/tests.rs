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

#[test]
fn a_pasted_reset_link_yields_its_token() {
    let server = Some("https://chat.example.com");
    let token = |t: &str| PastedReset::Token(t.into());
    for (input, want) in [
        // The mail's link, as PUBLIC_APP_URL builds it, with the app at the root, under a path,
        // or behind a hash route, and the same origin spelled differently.
        (
            "https://chat.example.com/reset-password?token=aB3x9Q2w",
            token("aB3x9Q2w"),
        ),
        (
            "https://chat.example.com/#/reset-password?token=aB3x9Q2w",
            token("aB3x9Q2w"),
        ),
        (
            "https://chat.example.com/chat/reset-password?token=aB3x9Q2w",
            token("aB3x9Q2w"),
        ),
        (
            "https://chat.example.com/chat/#/reset-password?x=1&token=aB3x9Q2w",
            token("aB3x9Q2w"),
        ),
        (
            "HTTPS://Chat.Example.COM:443/reset-password?token=aB3x9Q2w#top",
            token("aB3x9Q2w"),
        ),
        (
            "https://chat.example.com./reset-password?token=a%2Db",
            token("a-b"),
        ),
        // No server in it: the reset card names where it posts.
        (
            "semaphore://reset-password?token=aB3x9Q2w",
            token("aB3x9Q2w"),
        ),
        ("  aB3_-x  ", token("aB3_-x")),
        ("a%2Db", token("a-b")),
        // Not a reset link.
        ("", PastedReset::NotALink),
        ("https://chat.example.com/login", PastedReset::NotALink),
        (
            "https://chat.example.com/login?token=aB3x9Q2w",
            PastedReset::NotALink,
        ),
        (
            "https://chat.example.com/reset-password",
            PastedReset::NotALink,
        ),
        (
            "chat.example.com/reset-password?token=aB3x9Q2w",
            PastedReset::NotALink,
        ),
        (
            "ftp://chat.example.com/reset-password?token=x",
            PastedReset::NotALink,
        ),
        ("semaphore://join/abc", PastedReset::NotALink),
        ("has space", PastedReset::NotALink),
        ("a/b", PastedReset::NotALink),
        ("a?b", PastedReset::NotALink),
    ] {
        assert_eq!(reset_from_input(input, server), want, "{input:?}");
    }
    assert_eq!(
        reset_from_input(&"a".repeat(129), server),
        PastedReset::NotALink
    );
    assert_eq!(
        reset_from_input(&"a".repeat(128), server),
        token(&"a".repeat(128))
    );
}

#[test]
fn a_reset_link_from_another_server_is_refused_naming_both() {
    let wrong = |link: &str, server: &str| PastedReset::WrongServer {
        link: link.into(),
        server: server.into(),
    };
    for (input, server, want) in [
        (
            "https://chat.a.org/reset-password?token=tok",
            "https://chat.b.org",
            wrong("chat.a.org", "chat.b.org"),
        ),
        // Scheme and port are the origin too.
        (
            "http://chat.example.com/reset-password?token=tok",
            "https://chat.example.com",
            wrong("http://chat.example.com", "https://chat.example.com"),
        ),
        (
            "https://chat.example.com:8443/reset-password?token=tok",
            "https://chat.example.com",
            wrong("chat.example.com:8443", "chat.example.com"),
        ),
        (
            "https://chat.example.com/reset-password?token=tok",
            "http://chat.example.com:8080/",
            wrong("chat.example.com", "chat.example.com:8080"),
        ),
        // A look-alike: another host that ends in the server's name.
        (
            "https://chat.example.com.evil.net/reset-password?token=tok",
            "https://chat.example.com",
            wrong("chat.example.com.evil.net", "chat.example.com"),
        ),
        (
            "https://[::1]:3000/reset-password?token=tok",
            "http://[::1]:3000",
            wrong("https://[::1]:3000", "http://[::1]:3000"),
        ),
    ] {
        assert_eq!(reset_from_input(input, Some(server)), want, "{input:?}");
    }
    // Credentials or a backslash in the authority: not a link this server sends.
    for input in [
        "https://chat.example.com@evil.net/reset-password?token=tok",
        "https://evil.net\\@chat.example.com/reset-password?token=tok",
    ] {
        assert_eq!(
            reset_from_input(input, Some("https://chat.example.com")),
            PastedReset::NotALink,
            "{input:?}"
        );
    }
    // Same origin, a default port written out, a path on the server's URL.
    assert_eq!(
        reset_from_input(
            "http://chat.example.com:80/reset-password?token=tok",
            Some("http://chat.example.com/app/")
        ),
        PastedReset::Token("tok".into())
    );
    // No server to compare with: a web link is refused; a bare token isn't.
    assert_eq!(
        reset_from_input("https://chat.example.com/reset-password?token=tok", None),
        PastedReset::NoServer
    );
    assert_eq!(
        reset_from_input("tok", None),
        PastedReset::Token("tok".into())
    );
    assert_eq!(
        server_host("https://chat.example.com:443/x"),
        "chat.example.com"
    );
    assert_eq!(server_host("http://10.0.0.5:3000"), "10.0.0.5:3000");
}

#[test]
fn the_reset_fields_take_the_dtos_rules() {
    assert_eq!(validate_reset("", ""), ResetErrors::default());
    assert_eq!(
        validate_reset("short", "short"),
        ResetErrors {
            too_short: true,
            ..ResetErrors::default()
        }
    );
    assert_eq!(
        validate_reset(&"p".repeat(129), ""),
        ResetErrors {
            too_long: true,
            ..ResetErrors::default()
        }
    );
    assert_eq!(
        validate_reset("a long password", "another password"),
        ResetErrors {
            mismatch: true,
            ..ResetErrors::default()
        }
    );
    assert!(!can_submit_reset(
        None,
        "a long password",
        "a long password",
        false,
        false
    ));
    assert!(!can_submit_reset(
        Some("tok"),
        "short",
        "short",
        false,
        false
    ));
    assert!(!can_submit_reset(
        Some("tok"),
        "a long password",
        "another password",
        false,
        false
    ));
    assert!(!can_submit_reset(
        Some("tok"),
        "a long password",
        "a long password",
        true,
        false
    ));
    assert!(can_submit_reset(
        Some("tok"),
        "a long password",
        "a long password",
        false,
        false
    ));
}

#[gpui_kit::test]
fn the_reset_screen_sends_only_a_password_the_server_takes(cx: &mut TestAppContext) {
    let rig = rig(cx, 390., |window, cx| {
        ResetPasswordScreen::new(
            Some("tok3n".into()),
            Some("chat.example.com".into()),
            window,
            cx,
        )
    });
    assert!(
        rig.has(cx, "reset-password-target"),
        "the card names the server"
    );
    rig.with(cx, |screen, _, cx| {
        assert_eq!(screen.read(cx).server_host(), Some("chat.example.com"));
    });
    assert_eq!(
        reset_target_line("chat.example.com"),
        "This will reset your password on chat.example.com."
    );
    rig.click(cx, "reset-password-submit");
    assert!(rig.events().is_empty(), "empty fields");
    rig.with(cx, |screen, window, cx| {
        screen.update(cx, |screen, cx| screen.preset("short", "short", window, cx))
    });
    rig.click(cx, "reset-password-submit");
    assert!(rig.events().is_empty(), "too short");
    rig.with(cx, |screen, window, cx| {
        screen.update(cx, |screen, cx| {
            screen.preset("a long password", "another password", window, cx)
        })
    });
    rig.click(cx, "reset-password-submit");
    assert!(rig.events().is_empty(), "they differ");
    rig.with(cx, |screen, window, cx| {
        screen.update(cx, |screen, cx| {
            screen.preset("a long password", "a long password", window, cx)
        })
    });
    rig.click(cx, "reset-password-submit");
    assert_eq!(
        rig.events(),
        [ResetEvent::Submit {
            token: "tok3n".into(),
            password: "a long password".into()
        }]
    );

    // Busy: a second click waits.
    rig.with(cx, |screen, _, cx| {
        screen.update(cx, |screen, cx| screen.set_busy(true, cx))
    });
    rig.click(cx, "reset-password-submit");
    assert_eq!(rig.events().len(), 1);

    // The server refused: the message and a way to ask for another link.
    rig.with(cx, |screen, _, cx| {
        screen.update(cx, |screen, cx| {
            screen.set_error(Some("Invalid or expired reset token".into()), cx)
        })
    });
    assert!(rig.has(cx, "reset-password-error"));
    rig.click(cx, "reset-password-request-new");
    assert_eq!(rig.events().last(), Some(&ResetEvent::RequestNewLink));

    // Done: sign in with the new password.
    rig.with(cx, |screen, _, cx| {
        screen.update(cx, |screen, cx| screen.set_success(true, cx))
    });
    assert!(rig.has(cx, "reset-password-done"));
    rig.click(cx, "reset-password-sign-in");
    assert_eq!(rig.events().last(), Some(&ResetEvent::SignIn));
}

#[gpui_kit::test]
fn a_reset_link_without_its_token_says_so(cx: &mut TestAppContext) {
    let rig = rig(cx, 390., |window, cx| {
        ResetPasswordScreen::new(None, Some("chat.example.com".into()), window, cx)
    });
    assert!(rig.has(cx, "reset-password-invalid"));
    assert!(!rig.has(cx, "reset-password-submit"));
    rig.click(cx, "reset-password-request-new");
    assert_eq!(rig.events(), [ResetEvent::RequestNewLink]);
}

#[gpui_kit::test]
fn the_forgot_card_takes_a_pasted_reset_link(cx: &mut TestAppContext) {
    let rig = rig(cx, 390., ForgotPasswordScreen::new);
    rig.with(cx, |screen, _, cx| {
        screen.update(cx, |screen, cx| {
            screen.set_sent(true, cx);
            screen.set_server_url(Some("https://chat.example.com".into()), cx);
        })
    });
    rig.click(cx, "forgot-reset-open");
    assert!(rig.events().is_empty(), "nothing pasted");
    // Another server's link: refused, its token never handed on.
    rig.with(cx, |screen, window, cx| {
        screen.update(cx, |screen, cx| {
            screen.preset_reset_link(
                "https://chat.example.org/reset-password?token=aB3x9Q2w",
                window,
                cx,
            )
        })
    });
    rig.click(cx, "forgot-reset-open");
    assert!(rig.events().is_empty(), "another server's link is refused");
    rig.with(cx, |screen, _, cx| {
        assert_eq!(
            screen.read(cx).link_error(),
            Some(wrong_server_message("chat.example.org", "chat.example.com").as_str())
        );
    });
    rig.with(cx, |screen, window, cx| {
        screen.update(cx, |screen, cx| {
            screen.preset_reset_link(
                "https://chat.example.com/reset-password?token=aB3x9Q2w",
                window,
                cx,
            )
        })
    });
    rig.click(cx, "forgot-reset-open");
    assert_eq!(
        rig.events(),
        [ForgotEvent::OpenReset {
            token: "aB3x9Q2w".into()
        }]
    );
    rig.with(cx, |screen, window, cx| {
        screen.update(cx, |screen, cx| {
            screen.preset_reset_link("not a link", window, cx)
        })
    });
    rig.click(cx, "forgot-reset-open");
    assert_eq!(rig.events().len(), 1, "a bad link is refused");
}
