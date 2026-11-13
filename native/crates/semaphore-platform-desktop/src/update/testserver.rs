//! A loopback HTTP server for the updater's tests, and the client they use.
//!
//! Plain HTTP on `127.0.0.1`, one answer per route, and a request counter. No TLS (the manifest's
//! rule allows plain HTTP to a loopback address for exactly this), no files, and nothing reached
//! but the loopback interface. [`Server::route`] sets the answer, replacing whatever was there;
//! [`Server::script`] sets a sequence, answered in order and then repeated, which is how a test
//! says "a dropped transfer, then a good one".

use std::collections::{HashMap, VecDeque};
use std::net::Ipv4Addr;
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

/// One answer.
#[derive(Debug, Clone)]
pub struct Response {
    status: u16,
    body: Vec<u8>,
    cut_after: Option<usize>,
    stall_after: Option<usize>,
}

impl Response {
    pub fn ok(body: impl Into<Vec<u8>>) -> Self {
        Self {
            status: 200,
            body: body.into(),
            cut_after: None,
            stall_after: None,
        }
    }

    pub fn status(status: u16) -> Self {
        Self {
            status,
            body: Vec::new(),
            cut_after: None,
            stall_after: None,
        }
    }

    /// Send only this many bytes of the body, then close: a transfer that dropped.
    pub fn cut_after(mut self, bytes: usize) -> Self {
        self.cut_after = Some(bytes);
        self
    }

    /// Send this many bytes and then hold the connection open, never finishing the body: a
    /// transfer still in progress when the test looks at it.
    pub fn stall_after(mut self, bytes: usize) -> Self {
        self.stall_after = Some(bytes);
        self
    }
}

struct Shared {
    routes: Mutex<HashMap<String, VecDeque<Response>>>,
    counts: Mutex<HashMap<String, usize>>,
}

pub struct Server {
    /// `http://127.0.0.1:<port>`.
    url: String,
    shared: Arc<Shared>,
}

impl Server {
    pub async fn start() -> Self {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
            .await
            .expect("a loopback listener");
        let port = listener
            .local_addr()
            .expect("the listener's address")
            .port();
        let shared = Arc::new(Shared {
            routes: Mutex::new(HashMap::new()),
            counts: Mutex::new(HashMap::new()),
        });
        let serving = shared.clone();
        tokio::spawn(async move {
            loop {
                let Ok((stream, _)) = listener.accept().await else {
                    return;
                };
                let shared = serving.clone();
                tokio::spawn(async move { answer(stream, shared).await });
            }
        });
        Self {
            url: format!("http://127.0.0.1:{port}"),
            shared,
        }
    }

    pub fn url(&self, path: &str) -> String {
        format!("{}{path}", self.url)
    }

    /// Answers `path` with `response` from now on, replacing whatever was there.
    pub fn route(&self, path: &str, response: Response) {
        self.script(path, vec![response]);
    }

    /// Answers `path` with these in order, repeating the last.
    pub fn script(&self, path: &str, responses: Vec<Response>) {
        let mut routes = self.shared.routes.lock().expect("routes");
        let queue = routes.entry(path.to_owned()).or_default();
        queue.clear();
        queue.extend(responses);
    }

    /// How many requests arrived for `path`.
    pub fn count(&self, path: &str) -> usize {
        self.shared
            .counts
            .lock()
            .expect("counts")
            .get(path)
            .copied()
            .unwrap_or(0)
    }
}

async fn answer(mut stream: TcpStream, shared: Arc<Shared>) {
    let mut head = Vec::new();
    let mut buffer = [0u8; 512];
    loop {
        match stream.read(&mut buffer).await {
            Ok(0) | Err(_) => return,
            Ok(read) => head.extend_from_slice(&buffer[..read]),
        }
        if head.windows(4).any(|window| window == b"\r\n\r\n") {
            break;
        }
        if head.len() > 8 * 1024 {
            return;
        }
    }
    let text = String::from_utf8_lossy(&head);
    let path = text.split_whitespace().nth(1).unwrap_or("/").to_owned();
    *shared
        .counts
        .lock()
        .expect("counts")
        .entry(path.clone())
        .or_default() += 1;
    // In order, and the last one keeps answering.
    let response = shared
        .routes
        .lock()
        .expect("routes")
        .get_mut(&path)
        .and_then(|queue| match queue.len() {
            0 => None,
            1 => queue.front().cloned(),
            _ => queue.pop_front(),
        });
    let Some(response) = response else {
        let _ = stream
            .write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            .await;
        return;
    };
    let reason = match response.status {
        200 => "OK",
        404 => "Not Found",
        500 => "Internal Server Error",
        503 => "Service Unavailable",
        _ => "Status",
    };
    let head = format!(
        "HTTP/1.1 {} {reason}\r\nContent-Length: {}\r\nContent-Type: application/octet-stream\r\nConnection: close\r\n\r\n",
        response.status,
        response.body.len()
    );
    let sent = match (response.cut_after, response.stall_after) {
        (Some(bytes), _) => &response.body[..bytes.min(response.body.len())],
        (None, Some(bytes)) => &response.body[..bytes.min(response.body.len())],
        (None, None) => &response.body[..],
    };
    let _ = stream.write_all(head.as_bytes()).await;
    let _ = stream.write_all(sent).await;
    let _ = stream.flush().await;
    if response.stall_after.is_some() {
        // Held until the test's runtime drops the connection (or the test ends).
        std::future::pending::<()>().await;
    }
    let _ = stream.shutdown().await;
}

/// A client for the tests. In a workspace build reqwest is compiled with `rustls-no-provider`
/// (semaphore-net's choice, so that it can pick the ring provider itself), and building any
/// client then needs a provider installed in the process. The app does that once in
/// `semaphore_net::install_crypto_provider`; a test binary has no such step, so this does it.
/// Off Linux the dev-dependency isn't there (ring needs MSVC headers), and the tests that use
/// this are not run there.
pub fn client() -> reqwest::Client {
    #[cfg(target_os = "linux")]
    {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    reqwest::Client::new()
}
