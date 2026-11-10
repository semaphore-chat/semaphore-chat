//! Core over the real transports: `Core::with_services` on `HttpBackend` and `SocketRealtime`,
//! against `semaphore-fake-server` on loopback. Secrets live in memory.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use semaphore_core::backend::Backend;
use semaphore_core::lifecycle::ConnectionState;
use semaphore_core::model::{
    Conversation, ListOp, MessageDraft, MessageRow, SendState, SessionState,
};
use semaphore_core::platform::{Clock, CoreError, CoreEvent, EventSink, SecretStore};
use semaphore_core::{Core, Services};
use semaphore_fake_server::{FakeServer, Record, ScenarioSource};
use semaphore_net::socket::SocketConfig;
use semaphore_net::{HttpBackend, SocketRealtime};
use semaphore_wire::types as wire;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

const CHANNEL: &str = "channel-13";
const COMMUNITY: &str = "community-1";

#[derive(Default)]
struct MemSecrets(Mutex<HashMap<String, String>>);

impl MemSecrets {
    fn get(&self, key: &str) -> Option<String> {
        self.0.lock().unwrap().get(key).cloned()
    }
}

impl SecretStore for MemSecrets {
    fn load(&self, key: String) -> Result<Option<String>, CoreError> {
        Ok(self.get(&key))
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

/// Waits for a condition, polling, for at most 10 s.
async fn until(what: &str, mut condition: impl FnMut() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(10);
    while !condition() {
        assert!(Instant::now() < deadline, "timed out waiting for {what}");
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
}

fn refresh_calls(server: &FakeServer) -> usize {
    server
        .requests()
        .iter()
        .filter(|record| {
            matches!(
                record,
                Record::Http {
                    operation: Some("AuthController_refresh"),
                    ..
                }
            )
        })
        .count()
}

fn status_count(server: &FakeServer, status: u16) -> usize {
    server
        .requests()
        .iter()
        .filter(|record| matches!(record, Record::Http { status: s, .. } if *s == status))
        .count()
}

fn handshakes(server: &FakeServer) -> usize {
    server
        .requests()
        .iter()
        .filter(|record| matches!(record, Record::Socket { event, .. } if event == "handshake"))
        .count()
}

struct Rig {
    server: FakeServer,
    core: Core,
    backend: HttpBackend,
    secrets: Arc<MemSecrets>,
    events: Arc<Recorder>,
}

impl Rig {
    async fn new() -> Self {
        let server = FakeServer::start(ScenarioSource::Named("big-community"))
            .await
            .expect("the scenario loads");
        let secrets = Arc::new(MemSecrets::default());
        let backend = HttpBackend::new(secrets.clone());
        let mut config = SocketConfig::new("unused");
        config.reconnect_delay = Duration::from_millis(50);
        config.reconnect_delay_max = Duration::from_millis(200);
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
        Self {
            server,
            core,
            backend,
            secrets,
            events,
        }
    }

    async fn sign_in(&self) {
        self.core
            .sign_in(self.server.base_url(), "me".into(), "pw".into())
            .await
            .unwrap();
        until("sign-in", || {
            matches!(self.core.session(), SessionState::SignedIn { .. })
        })
        .await;
        until("the socket", || {
            self.core.connection() == ConnectionState::Connected
        })
        .await;
    }

    fn refresh_key(&self) -> String {
        format!("refresh-token:{}", self.server.base_url())
    }
}

impl Drop for Rig {
    fn drop(&mut self) {
        self.core.shutdown();
    }
}

/// The rows a UI would show, built from `MessagesChanged` ops.
fn rows(events: &Recorder, conversation: &Conversation) -> Vec<MessageRow> {
    let mut rows: Vec<MessageRow> = Vec::new();
    for event in events.0.lock().unwrap().iter() {
        let CoreEvent::MessagesChanged {
            conversation: changed,
            ops,
        } = event
        else {
            continue;
        };
        if changed != conversation {
            continue;
        }
        for op in ops {
            match op {
                ListOp::Reset { rows: new } => rows = new.clone(),
                ListOp::Insert { index, rows: new } => {
                    rows.splice(*index as usize..*index as usize, new.clone());
                }
                ListOp::Remove { index, count } => {
                    rows.drain(*index as usize..(*index + *count) as usize);
                }
                ListOp::Replace { index, rows: new } => {
                    for (offset, row) in new.iter().enumerate() {
                        rows[*index as usize + offset] = row.clone();
                    }
                }
            }
        }
    }
    rows
}

#[tokio::test]
async fn signs_in_loads_channels_and_sends_a_message_to_its_ack() {
    let rig = Rig::new().await;
    rig.sign_in().await;

    until("communities", || !rig.core.communities().is_empty()).await;
    until("channels", || {
        !rig.core.channels(COMMUNITY.into()).is_empty()
    })
    .await;

    let conversation = Conversation::Channel { id: CHANNEL.into() };
    rig.core
        .open_conversation(conversation.clone())
        .await
        .unwrap();
    let nonce = rig
        .core
        .send_message(
            conversation.clone(),
            MessageDraft {
                text: "hello over the wire".into(),
                ..MessageDraft::default()
            },
        )
        .await
        .unwrap();
    until("the ack", || {
        rows(&rig.events, &conversation).iter().any(|row| {
            row.client_nonce.as_deref() == Some(nonce.as_str())
                && row.id.is_some()
                && row.send_state == SendState::Sent
        })
    })
    .await;
    let row = rows(&rig.events, &conversation)
        .into_iter()
        .find(|row| row.client_nonce.as_deref() == Some(nonce.as_str()))
        .unwrap();
    assert_eq!(row.display, "hello over the wire");

    // The refresh token is kept per server, and never reaches core.
    assert_eq!(
        rig.secrets.get(&rig.refresh_key()).as_deref(),
        Some("fake-refresh-token")
    );

    // Signing out forgets it, here and in the store.
    rig.core.sign_out().await.unwrap();
    assert_eq!(rig.core.session(), SessionState::SignedOut);
    assert_eq!(rig.secrets.get(&rig.refresh_key()), None);
    assert!(rig.backend.access_token().is_none());
}

#[tokio::test]
async fn a_dropped_socket_reconnects_and_resyncs() {
    let rig = Rig::new().await;
    rig.sign_in().await;
    rig.core
        .open_conversation(Conversation::Channel { id: CHANNEL.into() })
        .await
        .unwrap();
    let before = handshakes(&rig.server);
    let events_before = rig.events.0.lock().unwrap().len();

    rig.server.drop_connections().await;

    until("a second handshake", || handshakes(&rig.server) > before).await;
    until("the resync", || {
        rig.events.0.lock().unwrap()[events_before..]
            .iter()
            .any(|event| matches!(event, CoreEvent::QueriesInvalidated { .. }))
    })
    .await;
    until("the socket back", || {
        rig.core.connection() == ConnectionState::Connected
    })
    .await;
    // The open window was refetched, not just marked.
    until("the window refetch", || {
        rig.server
            .requests()
            .iter()
            .filter(|record| {
                matches!(
                    record,
                    Record::Http {
                        operation: Some("MessagesController_findAllForChannel"),
                        ..
                    }
                )
            })
            .count()
            >= 2
    })
    .await;
}

#[tokio::test]
async fn an_expired_access_token_refreshes_once_for_concurrent_callers() {
    let rig = Rig::new().await;
    rig.sign_in().await;
    assert_eq!(refresh_calls(&rig.server), 0);
    let held = rig.backend.access_token().unwrap();

    rig.server.expire_access_token();
    let callers: Vec<_> = (0..8)
        .map(|_| {
            let backend = rig.backend.clone();
            tokio::spawn(async move { backend.user_controller_get_profile().await })
        })
        .collect();
    for caller in callers {
        caller
            .await
            .unwrap()
            .expect("each caller retries after the refresh");
    }

    assert_eq!(
        refresh_calls(&rig.server),
        1,
        "one refresh for eight callers"
    );
    assert!(status_count(&rig.server, 401) >= 1);
    assert_ne!(rig.backend.access_token().unwrap(), held);
    // The new token is in use: no more 401s.
    let refused = status_count(&rig.server, 401);
    rig.backend.user_controller_get_profile().await.unwrap();
    assert_eq!(status_count(&rig.server, 401), refused);
    assert_eq!(refresh_calls(&rig.server), 1);
}

#[tokio::test]
async fn a_rejected_refresh_returns_its_error_and_does_not_loop() {
    let rig = Rig::new().await;
    rig.sign_in().await;
    let access = rig.backend.access_token().unwrap();

    rig.server.expire_access_token();
    rig.server
        .fail_route("AuthController_refresh", 401, "UNAUTHENTICATED");
    let callers: Vec<_> = (0..4)
        .map(|_| {
            let backend = rig.backend.clone();
            tokio::spawn(async move { backend.user_controller_get_profile().await })
        })
        .collect();
    for caller in callers {
        let error = caller.await.unwrap().expect_err("the session is gone");
        assert_eq!(error.status, 401);
        assert_eq!(error.code.as_str(), "UNAUTHENTICATED");
        assert!(!error.to_string().contains(&access));
    }

    assert_eq!(refresh_calls(&rig.server), 1, "no second attempt");
    // The session ended here: tokens dropped, stored token deleted, and a later call fails
    // without a refresh to attempt.
    assert!(rig.backend.access_token().is_none());
    assert_eq!(rig.secrets.get(&rig.refresh_key()), None);
    let error = rig.backend.user_controller_get_profile().await.unwrap_err();
    assert_eq!(error.status, 401);
    assert_eq!(refresh_calls(&rig.server), 1);
}

#[tokio::test]
async fn auth_lost_on_the_socket_signs_core_out() {
    let rig = Rig::new().await;
    rig.sign_in().await;

    // The server stops accepting the token, refuses the refresh, and cuts the socket.
    rig.server.expire_access_token();
    rig.server
        .fail_route("AuthController_refresh", 401, "UNAUTHENTICATED");
    rig.server.drop_connections().await;

    until("the forced sign-out", || {
        rig.core.session() == SessionState::SignedOut
    })
    .await;
    assert!(rig.core.communities().is_empty());
    assert_eq!(refresh_calls(&rig.server), 1);
}

/// Answers each request with `respond(request line)` and keeps what it was sent.
struct Stub {
    url: String,
    requests: Arc<Mutex<Vec<(String, String)>>>,
}

async fn stub(respond: fn(&str) -> (u16, &'static str)) -> Stub {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let requests = Arc::new(Mutex::new(Vec::new()));
    let seen = requests.clone();
    tokio::spawn(async move {
        loop {
            let Ok((mut stream, _)) = listener.accept().await else {
                return;
            };
            let seen = seen.clone();
            tokio::spawn(async move {
                let mut buffer = Vec::new();
                let (head_end, length) = loop {
                    let mut chunk = [0u8; 4096];
                    let read = stream.read(&mut chunk).await.unwrap_or(0);
                    if read == 0 {
                        return;
                    }
                    buffer.extend_from_slice(&chunk[..read]);
                    let text = String::from_utf8_lossy(&buffer).to_lowercase();
                    if let Some(end) = text.find("\r\n\r\n") {
                        let length = text[..end]
                            .lines()
                            .find_map(|line| line.strip_prefix("content-length: "))
                            .and_then(|value| value.trim().parse::<usize>().ok())
                            .unwrap_or(0);
                        break (end + 4, length);
                    }
                };
                while buffer.len() < head_end + length {
                    let mut chunk = [0u8; 4096];
                    let read = stream.read(&mut chunk).await.unwrap_or(0);
                    if read == 0 {
                        break;
                    }
                    buffer.extend_from_slice(&chunk[..read]);
                }
                let head = String::from_utf8_lossy(&buffer[..head_end]).to_lowercase();
                let body = String::from_utf8_lossy(&buffer[head_end..]).into_owned();
                let (status, reply) = respond(head.lines().next().unwrap_or_default());
                seen.lock().unwrap().push((head, body));
                let response = format!(
                    "HTTP/1.1 {status} X\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{reply}",
                    reply.len()
                );
                let _ = stream.write_all(response.as_bytes()).await;
            });
        }
    });
    Stub { url, requests }
}

fn auth_stub(line: &str) -> (u16, &'static str) {
    if line.starts_with("post /api/auth/login") {
        (
            200,
            r#"{"accessToken":"access-1","refreshToken":"refresh-1"}"#,
        )
    } else if line.starts_with("post /api/auth/refresh") {
        (
            200,
            r#"{"accessToken":"access-2","refreshToken":"refresh-2"}"#,
        )
    } else {
        (
            404,
            r#"{"statusCode":404,"message":"none","errorCode":"NOT_FOUND","retryable":false}"#,
        )
    }
}

#[tokio::test]
async fn requests_carry_the_native_client_identity_and_the_held_tokens() {
    let stub = stub(auth_stub).await;
    let secrets = Arc::new(MemSecrets::default());
    let backend = HttpBackend::new(secrets.clone());
    backend.set_server_url(stub.url.clone());

    let login = backend
        .auth_controller_login(wire::LoginRequestDto {
            username: "me".into(),
            password: "pw".into(),
        })
        .await
        .unwrap();
    assert_eq!(login.access_token, "access-1");
    assert!(
        login.refresh_token.is_none(),
        "core never sees the refresh token"
    );
    let _ = backend.user_controller_get_profile().await;
    // An empty refresh token means the held one.
    let refreshed = backend
        .auth_controller_refresh(wire::RefreshRequestDto {
            refresh_token: None,
        })
        .await
        .unwrap();
    assert_eq!(refreshed.access_token, "access-2");
    assert!(refreshed.refresh_token.is_none());
    let _ = backend.user_controller_get_profile().await;

    let requests = stub.requests.lock().unwrap().clone();
    let (login_head, _) = &requests[0];
    assert!(
        login_head.contains("x-client-type: desktop-native"),
        "{login_head}"
    );
    assert!(
        login_head.contains("user-agent: semaphore-native/"),
        "{login_head}"
    );
    let device_id = login_head
        .lines()
        .find_map(|line| line.strip_prefix("x-device-id: "))
        .expect("a device id");
    assert_eq!(device_id.len(), 36);
    assert!(!login_head.contains("authorization"), "{login_head}");

    let (profile_head, _) = &requests[1];
    assert!(
        profile_head.contains("authorization: bearer access-1"),
        "{profile_head}"
    );
    assert!(profile_head.contains("x-client-type: desktop-native"));

    let (refresh_head, refresh_body) = &requests[2];
    assert!(refresh_body.contains("refresh-1"), "{refresh_body}");
    assert!(!refresh_head.contains("authorization"), "{refresh_head}");
    assert!(refresh_head.contains("x-client-type: desktop-native"));

    let (profile_head, _) = &requests[3];
    assert!(
        profile_head.contains("authorization: bearer access-2"),
        "{profile_head}"
    );

    // Rotated tokens replaced the held ones, and the store has the latest.
    assert_eq!(
        secrets
            .get(&format!("refresh-token:{}", stub.url))
            .as_deref(),
        Some("refresh-2")
    );
    // The same install keeps its device id.
    let again = HttpBackend::new(secrets.clone());
    again.set_server_url(stub.url.clone());
    let _ = again.user_controller_get_profile().await;
    let (head, _) = stub.requests.lock().unwrap().last().unwrap().clone();
    assert!(
        head.contains(&format!("x-device-id: {device_id}")),
        "{head}"
    );
}

#[tokio::test]
async fn tokens_stay_out_of_debug_output_and_errors() {
    let stub = stub(auth_stub).await;
    let backend = HttpBackend::new(Arc::new(MemSecrets::default()));
    backend.set_server_url(stub.url.clone());
    backend
        .auth_controller_login(wire::LoginRequestDto {
            username: "me".into(),
            password: "pw".into(),
        })
        .await
        .unwrap();

    let debug = format!("{backend:?}");
    assert!(debug.contains("HttpBackend"));
    for secret in ["access-1", "refresh-1"] {
        assert!(!debug.contains(secret), "{debug}");
    }
    let error = backend.user_controller_get_profile().await.unwrap_err();
    for text in [error.to_string(), format!("{error:?}")] {
        for secret in ["access-1", "refresh-1"] {
            assert!(!text.contains(secret), "{text}");
        }
    }
}
