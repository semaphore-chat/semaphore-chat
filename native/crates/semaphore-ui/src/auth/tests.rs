//! The register rules, the browser sign-in mapping and the invite words, then the screens in a
//! window.

use super::invite::invite_date;
use super::*;
use crate::dms::rig::rig;
use crate::panel::PanelClock;
use core::prelude::v1::test;
use gpui_kit::TestAppContext;
use semaphore_core::model::{ErrorView, InvitePreview, InvitePreviewView, LoadState, RegisterForm};

fn form(username: &str, email: Option<&str>, password: &str, code: &str) -> RegisterForm {
    RegisterForm {
        username: username.into(),
        password: password.into(),
        email: email.map(str::to_owned),
        invite_code: code.into(),
    }
}

fn fields(form: &RegisterForm) -> Vec<RegisterField> {
    validate_register(form)
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
        validate_register(&form("ava chen", None, "hunter2hunter2", "C"))[0].1,
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

#[gpui_kit::test]
fn sign_in_hides_register_when_registration_is_closed(cx: &mut TestAppContext) {
    let step = AuthStep::SignIn {
        server_url: "https://chat.example.com".into(),
        server_name: "Ladle".into(),
        browser: BrowserLogin::Idle,
        notice: None,
        password_reset: true,
    };
    let rig = rig(cx, 1280., move |window, cx| {
        AuthScreen::new(step, window, cx)
    });
    assert!(rig.has(cx, "auth-register"));
    rig.click(cx, "auth-register");
    assert_eq!(rig.events(), [AuthEvent::Register]);
    rig.with(cx, |screen, _, cx| {
        screen.update(cx, |screen, cx| {
            screen.set_registration(semaphore_core::model::RegistrationMode::Closed, cx)
        })
    });
    assert!(!rig.has(cx, "auth-register"));
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
    assert!(rig.has(cx, "invite-signed-in"));
    assert!(!rig.has(cx, "invite-accept"));
    rig.click(cx, "invite-close");
    assert_eq!(rig.events().last(), Some(&InviteEvent::Close));
}
