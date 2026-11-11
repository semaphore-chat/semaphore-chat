//! A scriptable HTTP stub and a secret store that can be held shut, for the tests that need a
//! server or a keyring to stop at an exact moment. Nothing here waits for a fixed time: requests
//! are released by the test, and conditions are polled with a limit.

#![allow(dead_code)]

use std::collections::HashMap;
use std::future::Future;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex, mpsc};
use std::time::{Duration, Instant};

use semaphore_core::backend::Backend;
use semaphore_core::platform::{CoreError, SecretStore};
use semaphore_wire::types as wire;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::watch;

pub const LOGIN: &str = "post /api/auth/login";
pub const REFRESH: &str = "post /api/auth/refresh";
pub const LOGOUT: &str = "post /api/auth/logout";
pub const COMMUNITIES: &str = "get /api/community/mine";

/// What the backend answers a refused access token with.
pub const UNAUTHENTICATED: &str =
    r#"{"statusCode":401,"message":"no","errorCode":"UNAUTHENTICATED","retryable":false}"#;

/// Waits for a condition, polling, for at most 10 s.
pub async fn until(what: &str, mut condition: impl FnMut() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(10);
    while !condition() {
        assert!(Instant::now() < deadline, "timed out waiting for {what}");
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
}

/// Polls `future` exactly once, so what it does before its first wait has happened.
pub async fn poll_once<F: Future + Unpin>(future: &mut F) -> Option<F::Output> {
    tokio::select! {
        biased;
        output = future => Some(output),
        () = std::future::ready(()) => None,
    }
}

/// Runs a call that takes a lock on another thread, so a test can fail if it never returns.
pub fn within<T: Send + 'static>(what: &str, f: impl FnOnce() -> T + Send + 'static) -> T {
    let (done, result) = mpsc::channel();
    std::thread::spawn(move || {
        let _ = done.send(f());
    });
    result
        .recv_timeout(Duration::from_secs(5))
        .unwrap_or_else(|_| panic!("{what} did not return while the secret store was busy"))
}

#[derive(Clone)]
pub struct Request {
    /// Lowercased, like the head an HTTP/2 server would see.
    pub head: String,
    pub body: String,
}

impl Request {
    pub fn is(&self, route: &str) -> bool {
        self.head.starts_with(route)
    }
}

type Respond = dyn Fn(&Request) -> (u16, String) + Send + Sync;

#[derive(Default)]
struct Shared {
    requests: Mutex<Vec<Request>>,
    /// Requests to these routes wait here until released, or for good if never.
    held: Mutex<HashMap<String, watch::Sender<bool>>>,
}

pub struct Stub {
    pub url: String,
    shared: Arc<Shared>,
}

impl Stub {
    /// Answers each request with `respond`.
    pub async fn start(
        respond: impl Fn(&Request) -> (u16, String) + Send + Sync + 'static,
    ) -> Self {
        let respond: Arc<Respond> = Arc::new(respond);
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let shared = Arc::new(Shared::default());
        let accepted = shared.clone();
        tokio::spawn(async move {
            while let Ok((mut stream, _)) = listener.accept().await {
                let shared = accepted.clone();
                let respond = respond.clone();
                tokio::spawn(async move {
                    let Some(request) = read_request(&mut stream).await else {
                        return;
                    };
                    shared.requests.lock().unwrap().push(request.clone());
                    let held = shared
                        .held
                        .lock()
                        .unwrap()
                        .iter()
                        .find(|(route, _)| request.is(route))
                        .map(|(_, gate)| gate.subscribe());
                    if let Some(mut gate) = held {
                        let _ = gate.wait_for(|released| *released).await;
                    }
                    let (status, reply) = respond(&request);
                    let response = format!(
                        "HTTP/1.1 {status} X\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{reply}",
                        reply.len()
                    );
                    let _ = stream.write_all(response.as_bytes()).await;
                });
            }
        });
        Self { url, shared }
    }

    /// A server called `name` whose tokens say so: its `n`th login answers `name-access-l<n>` and
    /// `name-refresh-l<n>`, its `n`th refresh `name-access-r<n>` and `name-refresh-r<n>`.
    pub async fn auth(name: &'static str) -> Self {
        Self::start(auth_responder(name)).await
    }

    pub fn hold(&self, route: &str) {
        let (gate, _) = watch::channel(false);
        self.shared
            .held
            .lock()
            .unwrap()
            .insert(route.to_owned(), gate);
    }

    pub fn release(&self, route: &str) {
        if let Some(gate) = self.shared.held.lock().unwrap().remove(route) {
            gate.send_replace(true);
        }
    }

    pub fn requests(&self) -> Vec<Request> {
        self.shared.requests.lock().unwrap().clone()
    }

    pub fn to(&self, route: &str) -> Vec<Request> {
        self.requests()
            .into_iter()
            .filter(|request| request.is(route))
            .collect()
    }

    pub fn count(&self, route: &str) -> usize {
        self.to(route).len()
    }

    pub fn key(&self) -> String {
        format!("refresh-token:{}", self.url)
    }
}

pub fn auth_responder(name: &'static str) -> impl Fn(&Request) -> (u16, String) + Send + Sync {
    let logins = AtomicUsize::new(0);
    let refreshes = AtomicUsize::new(0);
    move |request| {
        if request.is(LOGIN) {
            let n = logins.fetch_add(1, Ordering::SeqCst) + 1;
            (
                200,
                format!(
                    r#"{{"accessToken":"{name}-access-l{n}","refreshToken":"{name}-refresh-l{n}"}}"#
                ),
            )
        } else if request.is(REFRESH) {
            let n = refreshes.fetch_add(1, Ordering::SeqCst) + 1;
            (
                200,
                format!(
                    r#"{{"accessToken":"{name}-access-r{n}","refreshToken":"{name}-refresh-r{n}"}}"#
                ),
            )
        } else if request.is(LOGOUT) {
            (201, r#"{"message":"bye"}"#.to_owned())
        } else if request.is(COMMUNITIES) {
            (200, "[]".to_owned())
        } else {
            (
                404,
                r#"{"statusCode":404,"message":"none","errorCode":"NOT_FOUND","retryable":false}"#
                    .to_owned(),
            )
        }
    }
}

async fn read_request(stream: &mut tokio::net::TcpStream) -> Option<Request> {
    let mut buffer = Vec::new();
    let mut chunk = [0u8; 4096];
    let (head_end, length) = loop {
        let read = stream.read(&mut chunk).await.ok()?;
        if read == 0 {
            return None;
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
        let read = stream.read(&mut chunk).await.ok()?;
        if read == 0 {
            break;
        }
        buffer.extend_from_slice(&chunk[..read]);
    }
    Some(Request {
        head: String::from_utf8_lossy(&buffer[..head_end]).to_lowercase(),
        body: String::from_utf8_lossy(&buffer[head_end..]).into_owned(),
    })
}

/// Secrets in memory, with a log of what was done to them. Saving a token can be held shut, the
/// way a locked keyring holds a caller at its prompt.
#[derive(Default)]
pub struct Secrets {
    map: Mutex<HashMap<String, String>>,
    log: Mutex<Vec<String>>,
    blocked: Mutex<bool>,
    unblocked: Condvar,
    waiting: AtomicUsize,
    on_a_runtime: AtomicUsize,
}

impl Secrets {
    /// The real keyring panics on a Tokio thread (zbus's `block_on`), so this has to stay at 0.
    pub fn calls_on_a_runtime_thread(&self) -> usize {
        self.on_a_runtime.load(Ordering::SeqCst)
    }

    fn note_thread(&self) {
        if tokio::runtime::Handle::try_current().is_ok() {
            self.on_a_runtime.fetch_add(1, Ordering::SeqCst);
        }
    }

    pub fn get(&self, key: &str) -> Option<String> {
        self.map.lock().unwrap().get(key).cloned()
    }

    pub fn block_saves(&self) {
        *self.blocked.lock().unwrap() = true;
    }

    pub fn unblock(&self) {
        *self.blocked.lock().unwrap() = false;
        self.unblocked.notify_all();
    }

    /// Saves stopped at the block right now.
    pub fn waiting(&self) -> usize {
        self.waiting.load(Ordering::SeqCst)
    }

    /// What reached the store, oldest first, leaving out the device id.
    pub fn log(&self) -> Vec<String> {
        self.log.lock().unwrap().clone()
    }
}

impl SecretStore for Secrets {
    fn load(&self, key: String) -> Result<Option<String>, CoreError> {
        self.note_thread();
        Ok(self.get(&key))
    }

    fn save(&self, key: String, value: String) -> Result<(), CoreError> {
        self.note_thread();
        if key != "device-id" {
            self.waiting.fetch_add(1, Ordering::SeqCst);
            let mut blocked = self.blocked.lock().unwrap();
            while *blocked {
                blocked = self.unblocked.wait(blocked).unwrap();
            }
            drop(blocked);
            self.waiting.fetch_sub(1, Ordering::SeqCst);
            self.log.lock().unwrap().push(format!("save {value}"));
        }
        self.map.lock().unwrap().insert(key, value);
        Ok(())
    }

    fn delete(&self, key: String) -> Result<(), CoreError> {
        self.note_thread();
        self.log.lock().unwrap().push("delete".to_owned());
        self.map.lock().unwrap().remove(&key);
        Ok(())
    }
}

/// Opens the store again when a test ends, passing or not, so no thread stays stuck in it.
pub struct Unblock(pub Arc<Secrets>);

impl Drop for Unblock {
    fn drop(&mut self) {
        self.0.unblock();
    }
}

pub fn credentials() -> wire::LoginRequestDto {
    wire::LoginRequestDto {
        username: "me".into(),
        password: "pw".into(),
    }
}

pub async fn signed_in(backend: &impl Backend, stub: &Stub) {
    backend.set_server_url(stub.url.clone());
    backend.auth_controller_login(credentials()).await.unwrap();
}

pub fn logout_body() -> wire::LogoutRequestDto {
    wire::LogoutRequestDto {
        refresh_token: None,
    }
}
