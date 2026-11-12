//! W3: sign in with browser, registering, invites, profiles, sessions, appearance, creating a
//! community and instance permissions, against the in-memory fakes. The same flows over real HTTP
//! and sockets are in `semaphore-net/tests/w3.rs`.

mod common;

use std::sync::Arc;

use common::w3::{FakeLoopback, appearance_json, profile_json, session_json};
use common::*;
use semaphore_core::backend::BackendError;
use semaphore_core::model::{
    AccentColor, AppearancePatch, BrowserSignInFailure, BrowserSignInView, DraftFile, ImageChange,
    LoadState, NewCommunity, ProfileImage, ProfilePatch, RegisterForm, RegistrationMode,
    SessionState, ThemeIntensity, ThemeMode, ViewKey,
};
use semaphore_core::platform::{CoreError, CoreEvent, LoopbackPage};
use semaphore_wire::enums::ErrorCode;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

const CODE: &str = "c0deC0deC0deC0deC0deC0deC0deC0deC0deC0de_-x";
const SESSION_A: &str = "6f0c3a52-1c1e-4b0e-9d43-2b8a5e0c5001";
const SESSION_B: &str = "6f0c3a52-1c1e-4b0e-9d43-2b8a5e0c5002";
const COMMUNITY: &str = "6f0c3a52-1c1e-4b0e-9d43-2b8a5e0cc001";

fn settings(browser: bool, mode: &str) -> Value {
    json!({
        "name": "Test", "registrationMode": mode, "maxFileSizeBytes": 1000,
        "gifSearchEnabled": false, "passwordResetEnabled": true, "desktopBrowserLogin": browser,
    })
}

fn error(status: u16, code: &str) -> BackendError {
    BackendError {
        status,
        code: ErrorCode::Unknown(code.into()),
        message: format!("{code} from the server"),
        retryable: false,
        retry_after_ms: None,
    }
}

/// Runs `drive` beside the test, for work that waits on something the test does next.
fn drive(core: &semaphore_core::Core) -> tokio::task::JoinHandle<()> {
    let core = core.clone();
    tokio::spawn(async move { core.drive().await })
}

/// Lets the driver run until `done` holds. Bounded: a stuck flow fails the test.
async fn until(mut done: impl FnMut() -> bool) {
    for _ in 0..10_000 {
        if done() {
            return;
        }
        tokio::task::yield_now().await;
    }
    panic!("condition never held");
}

fn query(url: &str, name: &str) -> String {
    let query = url.split_once('?').unwrap().1;
    query
        .split('&')
        .find_map(|pair| pair.strip_prefix(&format!("{name}=")))
        .unwrap()
        .to_owned()
}

fn base64url(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let n = (u32::from(chunk[0]) << 16)
            | (u32::from(*chunk.get(1).unwrap_or(&0)) << 8)
            | u32::from(*chunk.get(2).unwrap_or(&0));
        for index in 0..=chunk.len() {
            out.push(ALPHABET[((n >> (18 - 6 * index)) & 63) as usize] as char);
        }
    }
    out
}

struct Browser {
    rig: Rig,
    loopback: Arc<FakeLoopback>,
    driver: tokio::task::JoinHandle<()>,
}

impl Drop for Browser {
    fn drop(&mut self) {
        self.rig.core.shutdown();
        self.driver.abort();
    }
}

async fn browser_rig(offered: bool) -> Browser {
    let rig = Rig::new();
    rig.backend
        .w3
        .answer("public_settings", settings(offered, "INVITE_ONLY"));
    let info = rig
        .core
        .probe_server("http://server/".into())
        .await
        .unwrap();
    assert_eq!(info.browser_sign_in, offered);
    assert_eq!(info.registration, RegistrationMode::InviteOnly);
    let loopback = Arc::new(FakeLoopback::default());
    rig.core.set_loopback(loopback.clone());
    let driver = drive(&rig.core);
    Browser {
        rig,
        loopback,
        driver,
    }
}

fn no_secret_in(events: &[CoreEvent], secrets: &[&str]) {
    let shown = format!("{events:?}");
    for secret in secrets {
        assert!(!shown.contains(secret), "an event shows a secret: {shown}");
    }
}

// --- Sign in with browser ---

#[tokio::test]
async fn browser_sign_in_redeems_the_code_with_the_verifier_of_the_challenge() {
    let b = browser_rig(true).await;
    let core = &b.rig.core;
    b.rig
        .backend
        .w3
        .answer("redeem", json!({ "accessToken": "a.b.c" }));
    let url = core.start_browser_sign_in().await.unwrap();
    assert!(url.starts_with("http://server/#/desktop-login?"), "{url}");
    let listener = b.loopback.last();
    assert_eq!(query(&url, "port"), listener.port.to_string());
    let state = query(&url, "state");
    let challenge = query(&url, "challenge");
    assert_eq!(state.len(), 43);
    assert!(matches!(
        core.browser_sign_in(),
        BrowserSignInView::Waiting { .. }
    ));

    // A page that guessed the port, without the state, gets nowhere; the attempt keeps waiting.
    let guessed = listener.get(&format!("/callback?code={CODE}&state=nope"));
    let other = listener.get("/");
    until(|| listener.reply_to(other).is_some()).await;
    assert_eq!(listener.reply_to(guessed), Some(LoopbackPage::BadRequest));
    assert_eq!(listener.reply_to(other), Some(LoopbackPage::BadRequest));
    assert!(!listener.is_closed());

    let good = listener.get(&format!("/callback?code={CODE}&state={state}"));
    until(|| matches!(core.session(), SessionState::SignedIn { .. })).await;
    assert_eq!(listener.reply_to(good), Some(LoopbackPage::SignedIn));
    assert!(listener.is_closed());
    assert_eq!(core.browser_sign_in(), BrowserSignInView::Idle);

    let redeem = b
        .rig
        .backend
        .w3
        .calls()
        .into_iter()
        .find(|call| call.starts_with("redeem "))
        .unwrap();
    let parts: Vec<&str> = redeem.split(' ').collect();
    assert_eq!(parts[1], CODE);
    let verifier = parts[2];
    assert_eq!(base64url(&Sha256::digest(verifier.as_bytes())), challenge);
    assert_ne!(verifier, challenge);
    no_secret_in(&b.rig.events.take(), &[verifier, &state, CODE]);
}

#[tokio::test]
async fn cancel_on_the_browser_page_fails_the_attempt_as_denied() {
    let b = browser_rig(true).await;
    let url = b.rig.core.start_browser_sign_in().await.unwrap();
    let listener = b.loopback.last();
    let state = query(&url, "state");
    let id = listener.get(&format!("/callback?error=access_denied&state={state}"));
    until(|| listener.is_closed()).await;
    assert_eq!(listener.reply_to(id), Some(LoopbackPage::Denied));
    assert_eq!(
        b.rig.core.browser_sign_in(),
        BrowserSignInView::Failed {
            reason: BrowserSignInFailure::Denied
        }
    );
    assert_eq!(b.rig.backend.w3.count("redeem"), 0);
}

#[tokio::test]
async fn an_attempt_times_out_and_closes_its_listener() {
    let b = browser_rig(true).await;
    b.rig.core.start_browser_sign_in().await.unwrap();
    let listener = b.loopback.last();
    until(|| !listener.timeouts_asked.lock().unwrap().is_empty()).await;
    assert_eq!(
        listener.timeouts_asked.lock().unwrap()[0],
        semaphore_core::commands::browser_sign_in::BROWSER_SIGN_IN_TIMEOUT_MS
    );
    listener.expire();
    until(|| listener.is_closed()).await;
    assert_eq!(
        b.rig.core.browser_sign_in(),
        BrowserSignInView::Failed {
            reason: BrowserSignInFailure::TimedOut
        }
    );
}

#[tokio::test]
async fn a_second_attempt_replaces_the_first_and_the_first_code_is_dropped() {
    let b = browser_rig(true).await;
    let core = &b.rig.core;
    let first_url = core.start_browser_sign_in().await.unwrap();
    let first = b.loopback.last();
    let second_url = core.start_browser_sign_in().await.unwrap();
    let second = b.loopback.last();
    assert!(first.is_closed());
    assert!(!second.is_closed());
    assert_ne!(query(&first_url, "state"), query(&second_url, "state"));

    // The first tab comes back to the second listener: its state doesn't match.
    let stale = second.get(&format!(
        "/callback?code={CODE}&state={}",
        query(&first_url, "state")
    ));
    until(|| second.reply_to(stale).is_some()).await;
    assert_eq!(second.reply_to(stale), Some(LoopbackPage::BadRequest));
    assert!(matches!(
        core.browser_sign_in(),
        BrowserSignInView::Waiting { .. }
    ));
    assert_eq!(b.rig.backend.w3.count("redeem"), 0);

    core.cancel_browser_sign_in();
    assert!(second.is_closed());
    assert_eq!(core.browser_sign_in(), BrowserSignInView::Idle);
}

#[tokio::test]
async fn a_password_sign_in_ends_a_waiting_browser_sign_in() {
    let b = browser_rig(true).await;
    let core = &b.rig.core;
    let url = core.start_browser_sign_in().await.unwrap();
    let listener = b.loopback.last();
    core.sign_in("http://server".into(), "me".into(), "pw".into())
        .await
        .unwrap();
    assert!(listener.is_closed());
    assert_eq!(core.browser_sign_in(), BrowserSignInView::Idle);
    // A code arriving now is answered with nothing that signs anyone in.
    listener.get(&format!(
        "/callback?code={CODE}&state={}",
        query(&url, "state")
    ));
    for _ in 0..50 {
        tokio::task::yield_now().await;
    }
    assert_eq!(b.rig.backend.w3.count("redeem"), 0);
}

#[tokio::test]
async fn a_refused_code_fails_the_attempt_and_signs_nobody_in() {
    let b = browser_rig(true).await;
    let core = &b.rig.core;
    b.rig
        .backend
        .w3
        .fail_next("redeem", error(401, "UNAUTHENTICATED"));
    let url = core.start_browser_sign_in().await.unwrap();
    let listener = b.loopback.last();
    listener.get(&format!(
        "/callback?code={CODE}&state={}",
        query(&url, "state")
    ));
    until(|| matches!(core.browser_sign_in(), BrowserSignInView::Failed { .. })).await;
    let BrowserSignInView::Failed {
        reason: BrowserSignInFailure::Refused { error },
    } = core.browser_sign_in()
    else {
        panic!("{:?}", core.browser_sign_in());
    };
    assert_eq!(error.code, "UNAUTHENTICATED");
    assert_eq!(core.session(), SessionState::SignedOut);
}

#[tokio::test]
async fn a_server_without_browser_sign_in_says_so_and_binds_nothing() {
    let b = browser_rig(false).await;
    assert!(b.rig.core.start_browser_sign_in().await.is_err());
    assert_eq!(
        b.rig.core.browser_sign_in(),
        BrowserSignInView::Failed {
            reason: BrowserSignInFailure::NotOffered
        }
    );
    assert!(b.loopback.listeners.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_listener_that_cant_start_fails_the_attempt() {
    let b = browser_rig(true).await;
    *b.loopback.bind_fails.lock().unwrap() = Some("port in use".into());
    assert!(b.rig.core.start_browser_sign_in().await.is_err());
    assert!(matches!(
        b.rig.core.browser_sign_in(),
        BrowserSignInView::Failed {
            reason: BrowserSignInFailure::ListenFailed { .. }
        }
    ));
}

#[tokio::test]
async fn without_a_loopback_browser_sign_in_is_unavailable() {
    let rig = Rig::new();
    rig.backend
        .w3
        .answer("public_settings", settings(true, "OPEN"));
    rig.core.probe_server("http://server".into()).await.unwrap();
    assert!(matches!(
        rig.core.start_browser_sign_in().await,
        Err(CoreError::Unavailable { .. })
    ));
}

// --- The connection probe's setup status ---

#[tokio::test]
async fn the_probe_learns_an_instance_with_no_users_needs_setup() {
    let rig = Rig::new();
    rig.backend
        .w3
        .answer("public_settings", settings(false, "OPEN"));
    rig.backend.w3.answer(
        "onboarding_status",
        json!({ "needsSetup": true, "hasUsers": false, "setupToken": "a-setup-token" }),
    );
    let info = rig.core.probe_server("http://server".into()).await.unwrap();
    assert!(info.needs_setup);
    // The rest of the probe still answers.
    assert_eq!(info.name.as_deref(), Some("Test"));
    assert_eq!(info.registration, RegistrationMode::Open);
    // A token is never kept or shown.
    assert!(!format!("{info:?}").contains("a-setup-token"));
    assert!(!format!("{:?}", rig.events.take()).contains("a-setup-token"));
}

#[tokio::test]
async fn a_server_that_cannot_say_whether_it_needs_setup_still_probes() {
    // An older build without the route, or a failed read: the settings already answered, and a
    // signed-in instance is what the rest of the app assumes.
    let rig = Rig::new();
    rig.backend
        .w3
        .answer("public_settings", settings(false, "INVITE_ONLY"));
    rig.backend
        .w3
        .fail_next("onboarding_status", error(404, "NOT_FOUND"));
    let info = rig.core.probe_server("http://server".into()).await.unwrap();
    assert!(!info.needs_setup);
    assert_eq!(info.registration, RegistrationMode::InviteOnly);
}

// --- Registering, forgot password, invites ---

#[tokio::test]
async fn register_creates_the_account_then_signs_in_with_it() {
    let rig = Rig::new();
    rig.backend
        .w3
        .answer("public_settings", settings(false, "INVITE_ONLY"));
    let info = rig.core.probe_server("http://server".into()).await.unwrap();
    assert_eq!(info.registration, RegistrationMode::InviteOnly);
    rig.backend.w3.answer("register", user_json(ME));
    let form = RegisterForm {
        username: " me ".into(),
        password: "a long password".into(),
        email: Some(" ".into()),
        invite_code: "INVITE".into(),
    };
    assert!(!format!("{form:?}").contains("a long password"));
    rig.core.register(form.clone()).await.unwrap();
    assert_eq!(
        rig.backend.w3.calls(),
        vec!["public_settings", "onboarding_status", "register me INVITE"]
    );
    assert!(matches!(rig.core.session(), SessionState::SignedIn { .. }));

    // Signed in, an invite can't be applied to the account.
    let refused = rig.core.register(form).await.unwrap_err();
    assert_eq!(
        refused,
        CoreError::Failed {
            message: semaphore_core::commands::onboarding::ALREADY_SIGNED_IN.into()
        }
    );
}

#[tokio::test]
async fn a_refused_registration_says_the_servers_words_and_signs_nobody_in() {
    let rig = Rig::new();
    rig.backend
        .w3
        .answer("public_settings", settings(false, "OPEN"));
    rig.core.probe_server("http://server".into()).await.unwrap();
    rig.backend
        .w3
        .fail_next("register", error(404, "NOT_FOUND"));
    let failure = rig
        .core
        .register(RegisterForm {
            username: "me".into(),
            password: "a long password".into(),
            email: None,
            invite_code: String::new(),
        })
        .await
        .unwrap_err();
    assert_eq!(
        failure,
        CoreError::Failed {
            message: "NOT_FOUND from the server".into()
        }
    );
    assert_eq!(rig.core.session(), SessionState::SignedOut);
}

#[tokio::test]
async fn forgot_password_asks_for_the_email() {
    let rig = Rig::new();
    rig.core.probe_server("http://server".into()).await.ok();
    rig.backend.w3.answer(
        "forgot",
        json!({ "message": "If it exists, a link is on its way" }),
    );
    rig.core
        .forgot_password(" me@example.com ".into())
        .await
        .unwrap();
    assert!(
        rig.backend
            .w3
            .calls()
            .contains(&"forgot me@example.com".to_owned())
    );
}

#[tokio::test]
async fn an_invite_preview_loads_says_why_and_fails_until_retried() {
    let rig = Rig::new();
    rig.core.probe_server("http://server".into()).await.ok();
    rig.backend.w3.answer(
        "invite",
        json!({ "code": "ok", "uses": 3, "maxUses": 5, "validUntil": null, "disabled": false,
                "createdBy": { "username": "ann" } }),
    );
    assert_eq!(
        rig.core.invite_preview("ok".into()).state,
        LoadState::Loading
    );
    rig.core.run_until_idle().await;
    let view = rig.core.invite_preview("ok".into());
    assert_eq!(view.state, LoadState::Ready);
    let invite = view.invite.unwrap();
    assert_eq!((invite.uses, invite.max_uses), (3, Some(5)));
    assert_eq!(invite.created_by.as_deref(), Some("ann"));

    // One the server won't honour, answered the older way: an empty body, with no reason said.
    // Today's backend names the reason instead (w9_invite).
    rig.backend.w3.answer("invite", Value::Null);
    rig.core.invite_preview("used".into());
    rig.core.run_until_idle().await;
    let view = rig.core.invite_preview("used".into());
    assert_eq!((view.state, view.invite), (LoadState::Ready, None));
    assert_eq!(view.reason, None);

    rig.backend.w3.fail_next("invite", error(0, "UNKNOWN"));
    rig.core.invite_preview("gone".into());
    rig.core.run_until_idle().await;
    assert!(matches!(
        rig.core.invite_preview("gone".into()).state,
        LoadState::Failed { .. }
    ));
    rig.core.run_until_idle().await;
    assert_eq!(
        rig.backend.w3.count("invite"),
        3,
        "a failure isn't read again by itself"
    );
    rig.core.retry_failed();
    rig.core.invite_preview("gone".into());
    rig.core.run_until_idle().await;
    assert_eq!(rig.backend.w3.count("invite"), 4);
    assert_eq!(
        rig.core.invite_preview("gone".into()).state,
        LoadState::Ready
    );
}

// --- Profiles ---

fn edit(display_name: Option<&str>, bio: Option<&str>) -> ProfilePatch {
    ProfilePatch {
        display_name: display_name.map(Into::into),
        bio: bio.map(Into::into),
        ..ProfilePatch::default()
    }
}

#[tokio::test]
async fn a_failed_edit_takes_back_only_its_own_fields() {
    let rig = Rig::new().signed_in().await;
    let core = &rig.core;
    assert_eq!(core.profile(ME.into()).state, LoadState::Ready);

    // The first edit sets the bio and waits; the second sets the name and succeeds.
    let hold = rig.backend.w3.hold("update_profile");
    let first = core.update_profile(edit(None, Some("first bio")));
    let (first_result, ()) = tokio::join!(first, async {
        tokio::task::yield_now().await;
        let shown = core.profile(ME.into()).profile.unwrap();
        assert_eq!(shown.bio.as_deref(), Some("first bio"));
        assert!(core.profile_edit().saving);
        rig.backend
            .w3
            .answer("update_profile", profile_json("New name", None, None));
        let second = core.update_profile(edit(Some(" New name "), None));
        let (second_result, _) = tokio::join!(second, async {
            tokio::task::yield_now().await;
            let shown = core.profile(ME.into()).profile.unwrap();
            assert_eq!(shown.user.display_name.as_deref(), Some("New name"));
            assert_eq!(shown.bio.as_deref(), Some("first bio"));
            rig.backend
                .w3
                .fail_next("update_profile", error(400, "VALIDATION"));
            hold.send(()).unwrap();
        });
        second_result.unwrap();
    });
    // The second's answer came first and stays; the first's failure took only the bio away.
    assert!(first_result.is_err());
    let shown = core.profile(ME.into()).profile.unwrap();
    assert_eq!(shown.user.display_name.as_deref(), Some("New name"));
    assert_eq!(shown.bio, None);
    assert!(!core.profile_edit().saving);
    assert!(core.profile_edit().error.is_some());
    // `me` follows the profile, for the rail and the account menu.
    let SessionState::SignedIn { me } = core.session() else {
        panic!()
    };
    assert_eq!(me.display_name.as_deref(), Some("New name"));
}

#[tokio::test]
async fn the_reply_and_user_profile_updated_land_in_either_order() {
    // Reply first, then the event: the profile is read again and stays the new one.
    let rig = Rig::new().signed_in().await;
    rig.backend
        .w3
        .answer("update_profile", profile_json("Reply", Some("bio"), None));
    rig.core
        .update_profile(edit(Some("Reply"), Some("bio")))
        .await
        .unwrap();
    rig.backend
        .w3
        .answer("profile", profile_json("Reply", Some("bio"), None));
    rig.core.ingest(event(
        "userProfileUpdated",
        json!({ "userId": ME, "displayName": "Reply", "avatarUrl": null, "bannerUrl": null, "bio": "bio" }),
    ));
    rig.core.run_until_idle().await;
    let shown = rig.core.profile(ME.into()).profile.unwrap();
    assert_eq!(shown.user.display_name.as_deref(), Some("Reply"));
    assert_eq!(shown.bio.as_deref(), Some("bio"));

    // The event first: its refetch answers the new profile while the reply is still out.
    let hold = rig.backend.w3.hold("update_profile");
    rig.backend
        .w3
        .answer("update_profile", profile_json("Event", None, None));
    let update = rig.core.update_profile(edit(Some("Event"), Some("")));
    let (result, ()) = tokio::join!(update, async {
        tokio::task::yield_now().await;
        rig.backend
            .w3
            .answer("profile", profile_json("Event", None, None));
        rig.core.ingest(event(
            "userProfileUpdated",
            json!({ "userId": ME, "displayName": "Event", "avatarUrl": null, "bannerUrl": null, "bio": null }),
        ));
        rig.core.run_until_idle().await;
        let shown = rig.core.profile(ME.into()).profile.unwrap();
        assert_eq!(shown.user.display_name.as_deref(), Some("Event"));
        assert_eq!(shown.bio, None);
        hold.send(()).unwrap();
    });
    result.unwrap();
    rig.core.run_until_idle().await;
    let shown = rig.core.profile(ME.into()).profile.unwrap();
    assert_eq!(shown.user.display_name.as_deref(), Some("Event"));
    assert_eq!(shown.bio, None);
}

#[tokio::test]
async fn images_upload_first_with_progress_and_a_failed_upload_changes_nothing() {
    let rig = Rig::new().signed_in().await;
    let file = DraftFile {
        name: "me.png".into(),
        mime_type: "image/png".into(),
        bytes: vec![7; 64],
    };
    rig.backend
        .w3
        .answer("update_profile", profile_json("me", None, Some("x")));
    rig.core
        .update_profile(ProfilePatch {
            avatar: Some(ImageChange::Set { file: file.clone() }),
            banner: Some(ImageChange::Remove),
            ..ProfilePatch::default()
        })
        .await
        .unwrap();
    let uploads = rig.backend.uploads.lock().unwrap().clone();
    assert_eq!(uploads.len(), 1);
    let patch = rig
        .backend
        .w3
        .calls()
        .into_iter()
        .find(|call| call.starts_with("update_profile"))
        .unwrap();
    let body: Value = serde_json::from_str(patch.split_once(' ').unwrap().1).unwrap();
    assert!(body["avatar"].as_str().unwrap().len() == 36, "{body}");
    assert_eq!(body["banner"], "");
    assert!(rig.core.profile_edit().upload.is_none());

    // The upload fails: no update goes out, and the form says why, for the avatar.
    let before = rig.backend.w3.count("update_profile");
    *rig.backend.upload_error.lock().unwrap() = Some(error(413, "PAYLOAD_TOO_LARGE"));
    let failed = rig
        .core
        .update_profile(ProfilePatch {
            display_name: Some("Not saved".into()),
            avatar: Some(ImageChange::Set { file }),
            ..ProfilePatch::default()
        })
        .await;
    assert!(failed.is_err());
    assert_eq!(rig.backend.w3.count("update_profile"), before);
    let edit_view = rig.core.profile_edit();
    assert_eq!(edit_view.error.unwrap().code, "PAYLOAD_TOO_LARGE");
    assert_ne!(
        rig.core
            .profile(ME.into())
            .profile
            .unwrap()
            .user
            .display_name
            .as_deref(),
        Some("Not saved")
    );
}

#[tokio::test]
async fn the_upload_slot_says_which_image_it_is() {
    let rig = Rig::new().signed_in().await;
    let hold = rig.backend.w3.hold("update_profile");
    rig.backend
        .w3
        .answer("update_profile", profile_json("me", None, None));
    let file = DraftFile {
        name: "banner.png".into(),
        mime_type: "image/png".into(),
        bytes: vec![1; 10],
    };
    let update = rig.core.update_profile(ProfilePatch {
        banner: Some(ImageChange::Set { file }),
        ..ProfilePatch::default()
    });
    let (result, ()) = tokio::join!(update, async {
        tokio::task::yield_now().await;
        let upload = rig.core.profile_edit().upload.unwrap();
        assert_eq!(upload.image, ProfileImage::Banner);
        assert_eq!(upload.upload.sent_bytes, 10);
        hold.send(()).unwrap();
    });
    result.unwrap();
}

#[tokio::test]
async fn an_edit_answered_after_sign_out_changes_nothing() {
    let rig = Rig::new().signed_in().await;
    let hold = rig.backend.w3.hold("update_profile");
    rig.backend
        .w3
        .answer("update_profile", profile_json("Late", None, None));
    let update = rig.core.update_profile(edit(Some("Late"), None));
    let (result, ()) = tokio::join!(update, async {
        tokio::task::yield_now().await;
        rig.core.sign_out().await.unwrap();
        hold.send(()).unwrap();
    });
    assert!(result.is_err());
    assert_eq!(rig.core.profile(ME.into()).profile, None);
    assert!(!rig.core.profile_edit().saving);
}

#[tokio::test]
async fn another_users_profile_loads_and_tells_failed_from_loading() {
    let rig = Rig::new().signed_in().await;
    let view = rig.core.profile("ann".into());
    assert_eq!(view.state, LoadState::Loading);
    rig.core.run_until_idle().await;
    let view = rig.core.profile("ann".into());
    assert_eq!(view.state, LoadState::Ready);
    let profile = view.profile.unwrap();
    assert!(!profile.is_me);
    assert_eq!(profile.user.username, "ann");
    assert!(rig.events.take().iter().any(|event| matches!(
        event,
        CoreEvent::ViewChanged { view: ViewKey::Profile { user_id } } if user_id == "ann"
    )));
}

// --- Sessions ---

#[tokio::test]
async fn revoking_a_session_shows_it_busy_then_gone_and_refuses_this_one() {
    let rig = Rig::new().signed_in().await;
    rig.backend.w3.answer(
        "sessions",
        json!([
            session_json(SESSION_A, true, "2026-11-10T00:00:00Z"),
            session_json(SESSION_B, false, "2026-11-11T00:00:00Z")
        ]),
    );
    assert_eq!(rig.core.sessions().state, LoadState::Loading);
    rig.core.run_until_idle().await;
    let view = rig.core.sessions();
    assert_eq!(view.sessions.len(), 2);
    assert!(view.sessions[0].is_current, "this device comes first");

    assert!(rig.core.revoke_session(SESSION_A.into()).await.is_err());
    assert_eq!(rig.backend.w3.count("revoke"), 0);

    let hold = rig.backend.w3.hold("revoke");
    rig.backend.w3.answer(
        "revoke",
        json!({ "message": "Session revoked successfully" }),
    );
    let revoke = rig.core.revoke_session(SESSION_B.into());
    let (result, ()) = tokio::join!(revoke, async {
        tokio::task::yield_now().await;
        let row = rig
            .core
            .sessions()
            .sessions
            .into_iter()
            .find(|row| row.id == SESSION_B);
        assert!(row.unwrap().busy);
        rig.backend.w3.answer(
            "sessions",
            json!([session_json(SESSION_A, true, "2026-11-10T00:00:00Z")]),
        );
        hold.send(()).unwrap();
    });
    result.unwrap();
    assert_eq!(rig.core.sessions().sessions.len(), 1);
    rig.core.run_until_idle().await;
    assert_eq!(
        rig.backend.w3.count("sessions"),
        2,
        "read again after the revoke"
    );
}

#[tokio::test]
async fn revoke_others_keeps_this_session_even_when_the_server_refuses() {
    let rig = Rig::new().signed_in().await;
    rig.backend.w3.answer(
        "sessions",
        json!([
            session_json(SESSION_A, true, "2026-11-10T00:00:00Z"),
            session_json(SESSION_B, false, "2026-11-11T00:00:00Z")
        ]),
    );
    rig.core.sessions();
    rig.core.run_until_idle().await;
    rig.backend
        .w3
        .fail_next("revoke_others", error(401, "UNAUTHENTICATED"));
    assert!(rig.core.revoke_other_sessions().await.is_err());
    assert!(
        matches!(rig.core.session(), SessionState::SignedIn { .. }),
        "a 401 here says the server couldn't tell which session asked, not that this one ended"
    );
    rig.backend.w3.answer(
        "revoke_others",
        json!({ "revokedCount": 1, "message": "Revoked 1 session" }),
    );
    assert_eq!(rig.core.revoke_other_sessions().await.unwrap(), 1);
    let view = rig.core.sessions();
    assert_eq!(view.sessions.len(), 1);
    assert!(view.sessions[0].is_current);
    assert!(!view.revoking_others);
}

#[tokio::test]
async fn a_desktop_sign_in_warns_and_reads_the_sessions_again() {
    let rig = Rig::new().signed_in().await;
    rig.backend.w3.answer("sessions", json!([]));
    rig.core.sessions();
    rig.core.run_until_idle().await;
    rig.events.take();
    rig.core.ingest(event(
        "desktopSignIn",
        json!({ "ipAddress": "10.1.2.3", "signedInAt": "2026-11-11T10:00:00Z" }),
    ));
    rig.core.run_until_idle().await;
    let events = rig.events.take();
    assert!(events.iter().any(|event| matches!(
        event,
        CoreEvent::DesktopSignedIn { ip_address: Some(ip), .. } if ip == "10.1.2.3"
    )));
    assert_eq!(rig.backend.w3.count("sessions"), 2);
}

#[tokio::test]
async fn sessions_older_than_the_stale_limit_are_read_again_when_shown() {
    let rig = Rig::new().signed_in().await;
    rig.backend.w3.answer("sessions", json!([]));
    rig.core.sessions();
    rig.core.run_until_idle().await;
    rig.core.sessions();
    rig.core.run_until_idle().await;
    assert_eq!(rig.backend.w3.count("sessions"), 1);
    rig.clock
        .advance(semaphore_core::commands::account::SESSIONS_STALE_MS + 1);
    rig.core.sessions();
    rig.core.run_until_idle().await;
    assert_eq!(rig.backend.w3.count("sessions"), 2);
}

// --- Appearance ---

#[tokio::test]
async fn appearance_is_read_at_sign_in_and_a_refused_change_goes_back_alone() {
    let rig = Rig::new().signed_in().await;
    assert_eq!(rig.backend.w3.count("appearance"), 1);
    let view = rig.core.appearance();
    assert_eq!(view.state, LoadState::Ready);
    assert_eq!(view.appearance.mode, ThemeMode::Dark);

    let hold = rig.backend.w3.hold("update_appearance");
    let first = rig.core.update_appearance(AppearancePatch {
        mode: Some(ThemeMode::Light),
        ..AppearancePatch::default()
    });
    let (first_result, ()) = tokio::join!(first, async {
        tokio::task::yield_now().await;
        assert_eq!(rig.core.appearance().appearance.mode, ThemeMode::Light);
        rig.backend.w3.answer(
            "update_appearance",
            appearance_json("dark", "rose", "vibrant"),
        );
        let second = rig.core.update_appearance(AppearancePatch {
            accent: Some(AccentColor::Rose),
            intensity: Some(ThemeIntensity::Vibrant),
            ..AppearancePatch::default()
        });
        let (second_result, ()) = tokio::join!(second, async {
            tokio::task::yield_now().await;
            let shown = rig.core.appearance().appearance;
            assert_eq!(
                (shown.mode, shown.accent),
                (ThemeMode::Light, AccentColor::Rose)
            );
            rig.backend
                .w3
                .fail_next("update_appearance", error(400, "VALIDATION"));
            hold.send(()).unwrap();
        });
        second_result.unwrap();
    });
    assert!(first_result.is_err());
    let shown = rig.core.appearance().appearance;
    assert_eq!(shown.mode, ThemeMode::Dark);
    assert_eq!(shown.accent, AccentColor::Rose);
    assert_eq!(shown.intensity, ThemeIntensity::Vibrant);
    let sent: Vec<String> = rig.backend.w3.calls();
    assert!(
        sent.iter()
            .any(|call| call.contains("\"themeMode\":\"light\""))
    );
}

// --- Creating a community, instance permissions ---

fn created() -> Value {
    json!({ "id": COMMUNITY, "name": "New", "description": null, "avatar": null, "banner": null,
            "createdAt": "2026-11-11T00:00:00Z" })
}

#[tokio::test]
async fn a_created_community_is_listed_at_once_and_once() {
    let mut rig = Rig::new().signed_in().await;
    rig.core.communities();
    rig.settle().await;
    rig.backend.w3.answer("create_community", created());
    let made = rig
        .core
        .create_community(NewCommunity {
            name: " New ".into(),
            description: None,
        })
        .await
        .unwrap();
    assert_eq!(made.id, COMMUNITY);
    assert!(
        rig.backend
            .w3
            .calls()
            .contains(&"create_community New".to_owned())
    );
    let ids: Vec<String> = rig
        .core
        .communities()
        .into_iter()
        .map(|row| row.id)
        .collect();
    assert_eq!(
        ids.iter().filter(|id| *id == COMMUNITY).count(),
        1,
        "{ids:?}"
    );

    // The event first, then the reply: still once.
    let hold = rig.backend.w3.hold("create_community");
    let create = rig.core.create_community(NewCommunity {
        name: "New".into(),
        description: Some("d".into()),
    });
    let (result, ()) = tokio::join!(create, async {
        tokio::task::yield_now().await;
        rig.core.ingest(event(
            "memberAddedToCommunity",
            json!({ "communityId": COMMUNITY, "userId": ME }),
        ));
        hold.send(()).unwrap();
    });
    result.unwrap();
    let ids: Vec<String> = rig
        .core
        .communities()
        .into_iter()
        .map(|row| row.id)
        .collect();
    assert!(
        ids.iter().filter(|id| *id == COMMUNITY).count() <= 1,
        "{ids:?}"
    );
}

fn roles(actions: &[&str]) -> Value {
    json!({ "resourceType": "INSTANCE", "userId": ME, "resourceId": null, "roles": [{
        "id": "r", "name": "Member", "position": 1, "isDefault": true, "actions": actions,
        "createdAt": "2026-09-22T18:00:00.000Z",
    }]})
}

#[tokio::test]
async fn creating_communities_is_allowed_by_an_instance_role_or_ownership() {
    let rig = Rig::new().signed_in().await;
    rig.backend
        .w3
        .answer("instance_roles", roles(&["READ_MESSAGE"]));
    let view = rig.core.instance_permissions();
    assert_eq!(view.state, LoadState::Loading);
    assert!(!view.can_create_community);
    rig.core.run_until_idle().await;
    let view = rig.core.instance_permissions();
    assert_eq!(view.state, LoadState::Ready);
    assert!(!view.can_create_community);

    let rig = Rig::new().signed_in().await;
    rig.backend
        .w3
        .answer("instance_roles", roles(&["CREATE_COMMUNITY"]));
    rig.core.instance_permissions();
    rig.core.run_until_idle().await;
    assert!(rig.core.instance_permissions().can_create_community);

    let rig = Rig::new().signed_in().await;
    rig.backend
        .w3
        .fail_next("instance_roles", error(500, "INTERNAL"));
    rig.core.instance_permissions();
    rig.core.run_until_idle().await;
    assert!(matches!(
        rig.core.instance_permissions().state,
        LoadState::Failed { .. }
    ));

    let rig = Rig::new();
    let mut owner = user_json(ME);
    owner["role"] = json!("OWNER");
    rig.backend.w3.answer("profile", owner);
    let rig = rig.signed_in().await;
    let view = rig.core.instance_permissions();
    assert!(view.can_create_community);
    assert_eq!(rig.backend.w3.count("instance_roles"), 0);
}
