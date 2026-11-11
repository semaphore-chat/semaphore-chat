//! W3 over the real transports: profiles, sessions, appearance, instance permissions, registering,
//! forgot password, invites, creating a community and sign in with browser, by `Core` on
//! `HttpBackend` and `SocketRealtime` against `semaphore-fake-server`. Sign in with browser runs on
//! the real `DesktopLoopback`, with the test as the browser. Every backend call W3 added is made
//! here and answered, so none is left to the trait's "unsupported" default.

mod common;

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use common::until;
use semaphore_core::lifecycle::ConnectionState;
use semaphore_core::model::{
    AccentColor, AppearancePatch, BrowserSignInFailure, BrowserSignInView, DraftFile, ImageChange,
    LoadState, NewCommunity, ProfilePatch, RegisterForm, RegistrationMode, SessionState, ThemeMode,
};
use semaphore_core::platform::{
    Clock, CoreError, CoreEvent, EventSink, Loopback, LoopbackListener, LoopbackPage,
    LoopbackRequest, SecretStore,
};
use semaphore_core::{Core, Services};
use semaphore_fake_server::{FakeServer, InviteSeed, ProfileOrder, Record, ScenarioSource};
use semaphore_net::socket::SocketConfig;
use semaphore_net::{HttpBackend, SocketRealtime};
use semaphore_platform_desktop::loopback::DesktopLoopback;

#[derive(Default)]
struct MemSecrets(Mutex<HashMap<String, String>>);

impl SecretStore for MemSecrets {
    fn load(&self, key: String) -> Result<Option<String>, CoreError> {
        Ok(self.0.lock().unwrap().get(&key).cloned())
    }
    fn save(&self, key: String, value: String) -> Result<(), CoreError> {
        self.0.lock().unwrap().insert(key, value);
        Ok(())
    }
    fn delete(&self, key: String) -> Result<(), CoreError> {
        self.0.lock().unwrap().remove(&key);
        Ok(())
    }
}

struct WallClock;
impl Clock for WallClock {
    fn now_ms(&self) -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |elapsed| elapsed.as_millis() as u64)
    }
}

#[derive(Default)]
struct Recorder(Mutex<Vec<CoreEvent>>);
impl EventSink for Recorder {
    fn on_event(&self, event: CoreEvent) {
        self.0.lock().unwrap().push(event);
    }
}

impl Recorder {
    fn all(&self) -> Vec<CoreEvent> {
        self.0.lock().unwrap().clone()
    }
}

/// Each operation the fake answered, with its statuses.
fn answered(server: &FakeServer) -> HashMap<&'static str, HashSet<u16>> {
    let mut seen: HashMap<&'static str, HashSet<u16>> = HashMap::new();
    for record in server.requests() {
        if let Record::Http {
            operation: Some(operation),
            status,
            ..
        } = record
        {
            seen.entry(operation).or_default().insert(status);
        }
    }
    seen
}

fn count(server: &FakeServer, operation: &str) -> usize {
    server
        .requests()
        .into_iter()
        .filter(
            |record| matches!(record, Record::Http { operation: Some(op), .. } if *op == operation),
        )
        .count()
}

struct Client {
    core: Core,
    events: Arc<Recorder>,
}

/// A core on the real transports, pointed at `server`, signed out.
fn client(server: &FakeServer) -> Client {
    let _ = server;
    let backend = HttpBackend::new(Arc::new(MemSecrets::default()));
    let mut config = SocketConfig::new("unused");
    config.reconnect_delay = Duration::from_millis(50);
    let realtime = SocketRealtime::new(config, backend.clone());
    let events = Arc::new(Recorder::default());
    let core = Core::with_services(
        Arc::new(WallClock),
        events.clone(),
        Services {
            backend: Arc::new(backend.clone()),
            realtime: realtime.clone(),
            media: None,
        },
    );
    realtime.attach(core.clone());
    let driver = core.clone();
    tokio::spawn(async move { driver.drive().await });
    Client { core, events }
}

async fn signed_in(server: &FakeServer, username: &str) -> Client {
    let client = client(server);
    client
        .core
        .sign_in(server.base_url(), username.into(), "pw".into())
        .await
        .unwrap();
    until("sign-in", || {
        matches!(client.core.session(), SessionState::SignedIn { .. })
    })
    .await;
    until("the socket", || {
        client.core.connection() == ConnectionState::Connected
    })
    .await;
    client
}

async fn server() -> FakeServer {
    FakeServer::start(ScenarioSource::Named("showcase"))
        .await
        .expect("the scenario loads")
}

// --- Account: profile, sessions, appearance, instance permissions ---

#[tokio::test]
async fn every_account_call_over_the_wire() {
    let server = server().await;
    let Client { core, events } = signed_in(&server, "me").await;
    let me = match core.session() {
        SessionState::SignedIn { me } => me.id,
        other => panic!("{other:?}"),
    };

    // Appearance is read at sign-in; a change shows at once and takes the server's answer.
    until("appearance", || core.appearance().state == LoadState::Ready).await;
    assert_eq!(core.appearance().appearance.mode, ThemeMode::Dark);
    core.update_appearance(AppearancePatch {
        mode: Some(ThemeMode::Light),
        accent: Some(AccentColor::Rose),
        ..AppearancePatch::default()
    })
    .await
    .unwrap();
    let shown = core.appearance().appearance;
    assert_eq!(
        (shown.mode, shown.accent),
        (ThemeMode::Light, AccentColor::Rose)
    );

    // Instance permissions: the showcase's user owns the instance, so needs no roles read.
    assert!(core.instance_permissions().can_create_community);
    assert_eq!(core.instance_permissions().state, LoadState::Ready);

    // Profile: a new avatar goes up first, then one update; the server's answer is shown.
    let avatar = DraftFile {
        name: "me.png".into(),
        mime_type: "image/png".into(),
        bytes: vec![0x89, b'P', b'N', b'G', 1, 2, 3, 4],
    };
    core.update_profile(ProfilePatch {
        display_name: Some("  Mika  ".into()),
        bio: Some("Hello there".into()),
        avatar: Some(ImageChange::Set { file: avatar }),
        ..ProfilePatch::default()
    })
    .await
    .unwrap();
    let profile = core.profile(me.clone()).profile.unwrap();
    assert!(profile.is_me);
    assert_eq!(profile.user.display_name.as_deref(), Some("Mika"));
    assert_eq!(profile.bio.as_deref(), Some("Hello there"));
    let avatar_id = profile.user.avatar_file_id.clone().expect("an avatar");
    assert_eq!(avatar_id.len(), 36);
    // And removed again: an empty id clears it.
    core.update_profile(ProfilePatch {
        avatar: Some(ImageChange::Remove),
        bio: Some(String::new()),
        ..ProfilePatch::default()
    })
    .await
    .unwrap();
    let profile = core.profile(me.clone()).profile.unwrap();
    assert_eq!(profile.user.avatar_file_id, None);
    assert_eq!(profile.bio, None);
    let SessionState::SignedIn { me: shown_me } = core.session() else {
        panic!()
    };
    assert_eq!(shown_me.display_name.as_deref(), Some("Mika"));

    // Sessions: this device's and another, revoked one at a time, then all the others.
    let phone = server.add_session("Phone", Some("10.0.0.7"));
    let tablet = server.add_session("Tablet", None);
    core.sessions();
    until("sessions", || core.sessions().sessions.len() >= 3).await;
    let view = core.sessions();
    assert!(view.sessions[0].is_current, "{view:?}");
    let current = view.sessions[0].id.clone();
    assert!(core.revoke_session(current).await.is_err());
    core.revoke_session(phone.id.clone()).await.unwrap();
    assert!(
        core.sessions()
            .sessions
            .iter()
            .all(|row| row.id != phone.id)
    );
    assert!(core.revoke_other_sessions().await.unwrap() >= 1);
    assert!(
        core.sessions()
            .sessions
            .iter()
            .all(|row| row.id != tablet.id)
    );
    until("the sessions read again", || {
        let view = core.sessions();
        view.state == LoadState::Ready && view.sessions.len() == 1 && view.sessions[0].is_current
    })
    .await;
    // This client is still signed in, and its token still works.
    assert!(matches!(core.session(), SessionState::SignedIn { .. }));
    core.appearance();
    core.update_appearance(AppearancePatch {
        mode: Some(ThemeMode::Dark),
        ..AppearancePatch::default()
    })
    .await
    .unwrap();

    // Creating a community: listed at once, then read again with the server's membership.
    let made = core
        .create_community(NewCommunity {
            name: "Native Club".into(),
            description: Some("made by the native client".into()),
        })
        .await
        .unwrap();
    assert!(core.communities().iter().any(|row| row.id == made.id));
    until("the community read again", || {
        core.communities()
            .iter()
            .filter(|row| row.id == made.id)
            .count()
            == 1
    })
    .await;

    let seen = answered(&server);
    for operation in [
        "AppearanceSettingsController_getSettings",
        "AppearanceSettingsController_updateSettings",
        "FileUploadController_uploadFile",
        "UserController_updateProfile",
        "AuthController_getSessions",
        "AuthController_revokeSession",
        "AuthController_revokeAllOtherSessions",
        "CommunityController_create",
    ] {
        let statuses = seen
            .get(operation)
            .unwrap_or_else(|| panic!("{operation} unused"));
        assert!(
            statuses.iter().any(|status| (200..300).contains(status)),
            "{operation}: {statuses:?}"
        );
    }
    assert!(events.all().iter().any(|event| matches!(
        event,
        CoreEvent::ViewChanged {
            view: semaphore_core::model::ViewKey::Sessions
        }
    )));
}

#[tokio::test]
async fn the_profile_reply_and_its_event_land_in_either_order() {
    let server = server().await;
    let Client { core, .. } = signed_in(&server, "me").await;
    let me = match core.session() {
        SessionState::SignedIn { me } => me.id,
        other => panic!("{other:?}"),
    };

    // The event is on the socket before the reply comes back.
    server.set_profile_order(ProfileOrder::EventThenReply);
    let reads = count(&server, "UserController_getProfile");
    core.update_profile(ProfilePatch {
        display_name: Some("Event First".into()),
        ..ProfilePatch::default()
    })
    .await
    .unwrap();
    until("the event's re-read", || {
        count(&server, "UserController_getProfile") > reads
    })
    .await;
    server.idle().await;
    until("the profile", || {
        core.profile(me.clone())
            .profile
            .is_some_and(|profile| profile.user.display_name.as_deref() == Some("Event First"))
    })
    .await;

    // The reply first, the event only when released.
    server.set_profile_order(ProfileOrder::ReplyThenEvent);
    core.update_profile(ProfilePatch {
        display_name: Some("Reply First".into()),
        ..ProfilePatch::default()
    })
    .await
    .unwrap();
    let shown = core.profile(me.clone()).profile.unwrap();
    assert_eq!(shown.user.display_name.as_deref(), Some("Reply First"));
    let reads = count(&server, "UserController_getProfile");
    assert_eq!(server.release_held_events(), 1);
    until("the event's re-read", || {
        count(&server, "UserController_getProfile") > reads
    })
    .await;
    server.idle().await;
    until("the profile", || {
        core.profile(me.clone())
            .profile
            .is_some_and(|profile| profile.user.display_name.as_deref() == Some("Reply First"))
    })
    .await;
}

#[tokio::test]
async fn another_users_profile_that_fails_to_load_says_so_until_retried() {
    let server = server().await;
    let Client { core, .. } = signed_in(&server, "me").await;
    let priya = semaphore_fake_server::entity_uuid("u-priya");
    server.fail_route("UserController_getUserById", 500, "INTERNAL_ERROR");
    assert_eq!(core.profile(priya.clone()).state, LoadState::Loading);
    until("the failure", || {
        matches!(core.profile(priya.clone()).state, LoadState::Failed { .. })
    })
    .await;
    assert_eq!(core.profile(priya.clone()).profile, None);
    core.retry_failed();
    until("the profile", || {
        core.profile(priya.clone()).state == LoadState::Ready
    })
    .await;
    let profile = core.profile(priya).profile.unwrap();
    assert!(!profile.is_me);
}

// --- Onboarding: register, forgot password, invites ---

#[tokio::test]
async fn register_with_an_invite_then_sign_in_and_preview_invites() {
    let server = server().await;
    server.seed_invite(InviteSeed::new("WELCOME1"));
    server.seed_invite(InviteSeed {
        disabled: true,
        ..InviteSeed::new("OFF")
    });
    let Client { core, .. } = client(&server);
    let info = core.probe_server(server.base_url()).await.unwrap();
    assert_ne!(info.registration, RegistrationMode::Closed);

    // A usable invite shows who made it; one the server won't honour reads as "can't be used".
    core.invite_preview("WELCOME1".into());
    until("the invite", || {
        core.invite_preview("WELCOME1".into()).state == LoadState::Ready
    })
    .await;
    let invite = core.invite_preview("WELCOME1".into()).invite.unwrap();
    assert_eq!(invite.created_by.as_deref(), Some("inviter"));
    core.invite_preview("OFF".into());
    until("the disabled invite", || {
        core.invite_preview("OFF".into()).state == LoadState::Ready
    })
    .await;
    assert_eq!(core.invite_preview("OFF".into()).invite, None);

    core.forgot_password("someone@example.com".into())
        .await
        .unwrap();

    // A bad code is refused in the server's words; the good one registers and signs in.
    let form = RegisterForm {
        username: "newcomer".into(),
        password: "a long password".into(),
        email: Some("new@example.com".into()),
        invite_code: "NOPE".into(),
    };
    assert!(matches!(
        core.register(form.clone()).await,
        Err(CoreError::Failed { .. })
    ));
    assert_eq!(core.session(), SessionState::SignedOut);
    core.register(RegisterForm {
        invite_code: "WELCOME1".into(),
        ..form.clone()
    })
    .await
    .unwrap();
    until("sign-in", || {
        matches!(core.session(), SessionState::SignedIn { .. })
    })
    .await;
    // A plain user's permission to create communities comes from their instance roles.
    let SessionState::SignedIn { me } = core.session() else {
        panic!()
    };
    assert_eq!(me.username, "newcomer");
    core.instance_permissions();
    until("instance roles", || {
        core.instance_permissions().state == LoadState::Ready
    })
    .await;
    assert!(core.instance_permissions().can_create_community);
    let refused = core.register(form).await.unwrap_err();
    assert_eq!(
        refused,
        CoreError::Failed {
            message: semaphore_core::commands::onboarding::ALREADY_SIGNED_IN.into()
        }
    );

    let seen = answered(&server);
    for operation in [
        "UserController_register",
        "AuthController_forgotPassword",
        "InviteController_getPublicInvite",
        "RolesController_getMyInstanceRoles",
    ] {
        let statuses = seen
            .get(operation)
            .unwrap_or_else(|| panic!("{operation} unused"));
        assert!(
            statuses.contains(&200) || statuses.contains(&201),
            "{operation}: {statuses:?}"
        );
    }
}

// --- Sign in with browser, on the real loopback listener ---

/// The real listener, with every wait cut to `cap_ms`: a test's stand-in for ten minutes.
struct Capped {
    cap_ms: u64,
}

struct CappedListener {
    inner: Arc<dyn LoopbackListener>,
    cap_ms: u64,
}

#[async_trait::async_trait]
impl Loopback for Capped {
    async fn bind(&self) -> Result<Arc<dyn LoopbackListener>, CoreError> {
        let inner = DesktopLoopback.bind().await?;
        Ok(Arc::new(CappedListener {
            inner,
            cap_ms: self.cap_ms,
        }))
    }
}

#[async_trait::async_trait]
impl LoopbackListener for CappedListener {
    fn port(&self) -> u16 {
        self.inner.port()
    }
    async fn next(&self, timeout_ms: u64) -> Option<LoopbackRequest> {
        self.inner.next(timeout_ms.min(self.cap_ms)).await
    }
    fn reply(&self, id: u64, page: LoopbackPage) {
        self.inner.reply(id, page);
    }
    fn close(&self) {
        self.inner.close();
    }
}

fn query(url: &str, name: &str) -> String {
    let query = url.split_once('?').unwrap().1;
    query
        .split('&')
        .find_map(|pair| pair.strip_prefix(&format!("{name}=")))
        .unwrap()
        .to_owned()
}

/// The browser coming back to the app.
async fn browse(port: &str, query: &str) -> Result<(u16, String), reqwest::Error> {
    let response = reqwest::Client::new()
        .get(format!("http://127.0.0.1:{port}/callback?{query}"))
        .send()
        .await?;
    let status = response.status().as_u16();
    Ok((status, response.text().await?))
}

async fn browser_client(server: &FakeServer, cap_ms: u64) -> Client {
    let client = client(server);
    let info = client.core.probe_server(server.base_url()).await.unwrap();
    assert!(info.browser_sign_in);
    if cap_ms == 0 {
        client.core.set_loopback(Arc::new(DesktopLoopback));
    } else {
        client.core.set_loopback(Arc::new(Capped { cap_ms }));
    }
    client
}

#[tokio::test]
async fn browser_sign_in_end_to_end_and_the_other_session_hears_of_it() {
    let server = server().await;
    let first = signed_in(&server, "me").await;
    let Client { core, events } = browser_client(&server, 0).await;

    let url = core.start_browser_sign_in().await.unwrap();
    assert!(
        url.starts_with(&format!("{}/#/desktop-login?", server.base_url())),
        "{url}"
    );
    let (port, state, challenge) = (
        query(&url, "port"),
        query(&url, "state"),
        query(&url, "challenge"),
    );

    // A wrong state: refused, and the attempt keeps waiting.
    let (status, _) = browse(
        &port,
        "code=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&state=wrong",
    )
    .await
    .unwrap();
    assert_eq!(status, 400);
    assert!(matches!(
        core.browser_sign_in(),
        BrowserSignInView::Waiting { .. }
    ));

    // The user approves in the browser; the browser comes back with the code.
    let code = server.approve_desktop(&challenge);
    let (status, page) = browse(&port, &format!("code={code}&state={state}"))
        .await
        .unwrap();
    assert_eq!(status, 200);
    assert!(!page.contains(&code) && !page.contains(&state), "{page}");
    until("sign-in", || {
        matches!(core.session(), SessionState::SignedIn { .. })
    })
    .await;
    until("the socket", || {
        core.connection() == ConnectionState::Connected
    })
    .await;
    assert_eq!(core.browser_sign_in(), BrowserSignInView::Idle);
    // The listener is gone.
    assert!(browse(&port, "x=1").await.is_err());

    // The other session is told a desktop app signed in.
    until("the warning", || {
        first
            .events
            .all()
            .iter()
            .any(|event| matches!(event, CoreEvent::DesktopSignedIn { .. }))
    })
    .await;
    let shown = format!("{:?}", events.all());
    assert!(!shown.contains(&code) && !shown.contains(&state));
    assert_eq!(
        answered(&server).get("AuthController_redeemDesktopLogin"),
        Some(&HashSet::from([200]))
    );
}

#[tokio::test]
async fn cancel_in_the_browser_fails_the_attempt_as_denied() {
    let server = server().await;
    let Client { core, .. } = browser_client(&server, 0).await;
    let url = core.start_browser_sign_in().await.unwrap();
    let (status, _) = browse(
        &query(&url, "port"),
        &format!("error=access_denied&state={}", query(&url, "state")),
    )
    .await
    .unwrap();
    assert_eq!(status, 200);
    until("denied", || {
        core.browser_sign_in()
            == BrowserSignInView::Failed {
                reason: BrowserSignInFailure::Denied,
            }
    })
    .await;
    assert_eq!(count(&server, "AuthController_redeemDesktopLogin"), 0);
}

#[tokio::test]
async fn a_second_attempt_replaces_the_first() {
    let server = server().await;
    let Client { core, .. } = browser_client(&server, 0).await;
    let first = core.start_browser_sign_in().await.unwrap();
    let second = core.start_browser_sign_in().await.unwrap();
    assert_ne!(query(&first, "state"), query(&second, "state"));
    // The first listener is closed; its state doesn't open the second.
    let code = server.approve_desktop(&query(&first, "challenge"));
    assert!(
        browse(
            &query(&first, "port"),
            &format!("code={code}&state={}", query(&first, "state"))
        )
        .await
        .is_err()
    );
    let (status, _) = browse(
        &query(&second, "port"),
        &format!("code={code}&state={}", query(&first, "state")),
    )
    .await
    .unwrap();
    assert_eq!(status, 400);
    let code = server.approve_desktop(&query(&second, "challenge"));
    let (status, _) = browse(
        &query(&second, "port"),
        &format!("code={code}&state={}", query(&second, "state")),
    )
    .await
    .unwrap();
    assert_eq!(status, 200);
    until("sign-in", || {
        matches!(core.session(), SessionState::SignedIn { .. })
    })
    .await;
}

#[tokio::test]
async fn an_attempt_times_out_and_its_port_closes() {
    let server = server().await;
    let Client { core, .. } = browser_client(&server, 200).await;
    let url = core.start_browser_sign_in().await.unwrap();
    until("the timeout", || {
        core.browser_sign_in()
            == BrowserSignInView::Failed {
                reason: BrowserSignInFailure::TimedOut,
            }
    })
    .await;
    assert!(browse(&query(&url, "port"), "x=1").await.is_err());
}

#[tokio::test]
async fn a_refused_code_signs_nobody_in() {
    let server = server().await;
    let Client { core, .. } = browser_client(&server, 0).await;
    let url = core.start_browser_sign_in().await.unwrap();
    let code = server.approve_desktop_with_revoked_approver(&query(&url, "challenge"));
    browse(
        &query(&url, "port"),
        &format!("code={code}&state={}", query(&url, "state")),
    )
    .await
    .unwrap();
    until("refused", || {
        matches!(
            core.browser_sign_in(),
            BrowserSignInView::Failed {
                reason: BrowserSignInFailure::Refused { .. }
            }
        )
    })
    .await;
    assert_eq!(core.session(), SessionState::SignedOut);
    assert_eq!(
        answered(&server).get("AuthController_redeemDesktopLogin"),
        Some(&HashSet::from([401]))
    );
}
