//! The one-shot HTTP listener behind "Sign in with browser" (RFC 8252 section 7.3).
//!
//! It binds `127.0.0.1` on a port the OS picks, reads only the head of each request (8 KiB, 5 s),
//! hands every well-formed head to [`LoopbackListener::next`] and answers it with one of three
//! fixed pages when the app calls `reply`. It serves no files and no other routes, and a page never
//! contains anything from the request: the target holds the sign-in code and `state`, so it is
//! never logged here either.

use async_trait::async_trait;
use semaphore_core::platform::{
    CoreError, Loopback, LoopbackListener, LoopbackPage, LoopbackRequest,
};
use std::collections::HashMap;
use std::net::{Ipv4Addr, SocketAddr};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{Mutex as AsyncMutex, mpsc, oneshot, watch};

/// The most of a request's head that is read. A longer one is answered 400 and dropped.
const MAX_HEAD_BYTES: usize = 8 * 1024;
/// How long a connection has to deliver a whole head.
const HEAD_DEADLINE: Duration = Duration::from_secs(5);
/// How long writing a page may take before the connection is dropped.
const WRITE_DEADLINE: Duration = Duration::from_secs(5);

/// The desktop's [`Loopback`]: a tokio `TcpListener` on `127.0.0.1`.
pub struct DesktopLoopback;

#[async_trait]
impl Loopback for DesktopLoopback {
    async fn bind(&self) -> Result<Arc<dyn LoopbackListener>, CoreError> {
        let listener = bind_with(HEAD_DEADLINE).await?;
        Ok(listener)
    }
}

/// `bind` with a chosen head deadline, so tests needn't wait the real 5 s.
pub(crate) async fn bind_with(head_deadline: Duration) -> Result<Arc<Listener>, CoreError> {
    let socket = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
        .await
        .map_err(|error| CoreError::Failed {
            message: format!("cannot listen on 127.0.0.1: {error}"),
        })?;
    let address = socket.local_addr().map_err(|error| CoreError::Failed {
        message: format!("cannot read the listener's address: {error}"),
    })?;
    let (closed_tx, _) = watch::channel(false);
    let (queue_tx, queue_rx) = mpsc::unbounded_channel();
    let shared = Arc::new(Shared {
        pending: Mutex::new(Pending::default()),
        next_id: AtomicU64::new(0),
        closed: closed_tx,
    });
    tokio::spawn(accept_loop(socket, shared.clone(), queue_tx, head_deadline));
    Ok(Arc::new(Listener {
        address,
        shared,
        queue: AsyncMutex::new(queue_rx),
    }))
}

#[derive(Default)]
struct Pending {
    closed: bool,
    /// Requests handed out and not yet answered: the connection task waits on the receiver.
    replies: HashMap<u64, oneshot::Sender<LoopbackPage>>,
}

struct Shared {
    pending: Mutex<Pending>,
    next_id: AtomicU64,
    closed: watch::Sender<bool>,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub(crate) struct Listener {
    address: SocketAddr,
    shared: Arc<Shared>,
    queue: AsyncMutex<mpsc::UnboundedReceiver<LoopbackRequest>>,
}

impl Listener {
    #[cfg(test)]
    pub(crate) fn local_addr(&self) -> SocketAddr {
        self.address
    }
}

impl Drop for Listener {
    fn drop(&mut self) {
        self.close();
    }
}

#[async_trait]
impl LoopbackListener for Listener {
    fn port(&self) -> u16 {
        self.address.port()
    }

    async fn next(&self, timeout_ms: u64) -> Option<LoopbackRequest> {
        let mut closed = self.shared.closed.subscribe();
        let wait = async {
            let mut queue = self.queue.lock().await;
            tokio::select! {
                biased;
                _ = wait_closed(&mut closed) => None,
                request = queue.recv() => request,
            }
        };
        tokio::time::timeout(Duration::from_millis(timeout_ms), wait)
            .await
            .ok()
            .flatten()
    }

    fn reply(&self, id: u64, page: LoopbackPage) {
        let sender = lock(&self.shared.pending).replies.remove(&id);
        if let Some(sender) = sender {
            // A connection that already went away has dropped its receiver; nothing to do.
            let _ = sender.send(page);
        }
    }

    fn close(&self) {
        let drained: Vec<_> = {
            let mut pending = lock(&self.shared.pending);
            pending.closed = true;
            pending.replies.drain().collect()
        };
        for (_, sender) in drained {
            let _ = sender.send(LoopbackPage::BadRequest);
        }
        self.shared.closed.send_replace(true);
    }
}

/// Resolves once `close` has run. Returns `()`, not the watch's guard, which isn't `Send`.
async fn wait_closed(closed: &mut watch::Receiver<bool>) {
    let _ = closed.wait_for(|closed| *closed).await;
}

async fn accept_loop(
    socket: TcpListener,
    shared: Arc<Shared>,
    queue: mpsc::UnboundedSender<LoopbackRequest>,
    head_deadline: Duration,
) {
    let mut closed = shared.closed.subscribe();
    loop {
        tokio::select! {
            _ = wait_closed(&mut closed) => break,
            accepted = socket.accept() => match accepted {
                Ok((stream, _)) => {
                    tokio::spawn(serve(shared.clone(), stream, queue.clone(), head_deadline));
                }
                // Out of descriptors and the like: back off a moment, then try again.
                Err(_) => tokio::time::sleep(Duration::from_millis(20)).await,
            },
        }
    }
    // Dropping the socket refuses everything after this.
}

async fn serve(
    shared: Arc<Shared>,
    mut stream: TcpStream,
    queue: mpsc::UnboundedSender<LoopbackRequest>,
    head_deadline: Duration,
) {
    let mut closed = shared.closed.subscribe();
    let head = tokio::select! {
        read = tokio::time::timeout(head_deadline, read_head(&mut stream)) => read.ok().flatten(),
        _ = wait_closed(&mut closed) => None,
    };
    let Some(head) = head else {
        write_page(&mut stream, LoopbackPage::BadRequest).await;
        return;
    };

    let id = shared.next_id.fetch_add(1, Ordering::SeqCst) + 1;
    let (page_tx, page_rx) = oneshot::channel();
    let registered = {
        let mut pending = lock(&shared.pending);
        if pending.closed {
            false
        } else {
            pending.replies.insert(id, page_tx);
            true
        }
    };
    if !registered {
        write_page(&mut stream, LoopbackPage::BadRequest).await;
        return;
    }
    let request = LoopbackRequest {
        id,
        method: head.method,
        host: head.host,
        target: head.target,
    };
    if queue.send(request).is_err() {
        lock(&shared.pending).replies.remove(&id);
        write_page(&mut stream, LoopbackPage::BadRequest).await;
        return;
    }
    let page = page_rx.await.unwrap_or(LoopbackPage::BadRequest);
    write_page(&mut stream, page).await;
}

struct Head {
    method: String,
    host: Option<String>,
    target: String,
}

/// Reads until the blank line that ends the head. `None` for a closed or failing connection, a
/// head over the cap, or one that doesn't parse.
async fn read_head(stream: &mut TcpStream) -> Option<Head> {
    let mut buffer: Vec<u8> = Vec::with_capacity(1024);
    let mut chunk = [0u8; 1024];
    loop {
        let read = stream.read(&mut chunk).await.ok()?;
        if read == 0 {
            return None;
        }
        let scan_from = buffer.len().saturating_sub(3);
        buffer.extend_from_slice(&chunk[..read]);
        if let Some(end) = find_head_end(&buffer, scan_from) {
            if end + 4 > MAX_HEAD_BYTES {
                return None;
            }
            return parse_head(&buffer[..end]);
        }
        if buffer.len() > MAX_HEAD_BYTES {
            return None;
        }
    }
}

fn find_head_end(buffer: &[u8], from: usize) -> Option<usize> {
    buffer[from..]
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .map(|position| from + position)
}

fn is_token(text: &str) -> bool {
    !text.is_empty()
        && text
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"!#$%&'*+-.^_`|~".contains(&byte))
}

fn has_control(text: &str, allow_tab: bool) -> bool {
    text.bytes()
        .any(|byte| (byte < 0x20 && !(allow_tab && byte == b'\t')) || byte == 0x7f)
}

/// The request line and headers, without the final blank line.
fn parse_head(bytes: &[u8]) -> Option<Head> {
    if !bytes.is_ascii() {
        return None;
    }
    let text = std::str::from_utf8(bytes).ok()?;
    let mut lines = text.split("\r\n");
    let request_line = lines.next()?;
    let mut parts = request_line.split(' ');
    let (method, target, version) = (parts.next()?, parts.next()?, parts.next()?);
    if parts.next().is_some() || !is_token(method) {
        return None;
    }
    if !version.starts_with("HTTP/1.") || version.len() != "HTTP/1.1".len() {
        return None;
    }
    if !target.starts_with('/') || has_control(target, false) {
        return None;
    }
    let mut hosts = Vec::new();
    for line in lines {
        let (name, value) = line.split_once(':')?;
        if !is_token(name) || has_control(value, true) {
            return None;
        }
        if name.eq_ignore_ascii_case("host") {
            hosts.push(value.trim().to_owned());
        }
    }
    let host = if hosts.len() == 1 { hosts.pop() } else { None };
    Some(Head {
        method: method.to_owned(),
        host,
        target: target.to_owned(),
    })
}

fn page_html(title: &str, message: &str) -> String {
    format!(
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">\n\
<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n\
<title>{title}</title>\n\
<style>\n\
:root{{color-scheme:light dark}}\n\
body{{font-family:system-ui,-apple-system,\"Segoe UI\",Roboto,sans-serif;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:Canvas;color:CanvasText}}\n\
main{{max-width:28rem;padding:2rem 1.5rem;text-align:center}}\n\
h1{{font-size:1.4rem;margin:0 0 .75rem}}\n\
p{{margin:0;opacity:.8;line-height:1.5}}\n\
</style></head><body><main><h1>{title}</h1><p>{message}</p></main></body></html>"
    )
}

/// Status line, headers and body of a page. Fixed text: nothing from a request goes in.
fn render(page: LoopbackPage) -> Vec<u8> {
    let (status, title, message) = match page {
        LoopbackPage::SignedIn => (
            "200 OK",
            "You\u{2019}re signed in",
            "Semaphore Chat is signing you in. You can close this tab and go back to the app.",
        ),
        LoopbackPage::Denied => (
            "200 OK",
            "Sign-in cancelled",
            "The desktop app wasn\u{2019}t signed in. You can close this tab.",
        ),
        LoopbackPage::BadRequest => (
            "400 Bad Request",
            "This link doesn\u{2019}t work",
            "Start again with \u{201c}Sign in with browser\u{201d} in the Semaphore Chat app.",
        ),
    };
    let body = page_html(title, message);
    format!(
        "HTTP/1.1 {status}\r\n\
Content-Type: text/html; charset=utf-8\r\n\
Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'\r\n\
Cache-Control: no-store\r\n\
Referrer-Policy: no-referrer\r\n\
X-Frame-Options: DENY\r\n\
Connection: close\r\n\
Content-Length: {}\r\n\
\r\n{body}",
        body.len()
    )
    .into_bytes()
}

async fn write_page(stream: &mut TcpStream, page: LoopbackPage) {
    let bytes = render(page);
    let write = async {
        stream.write_all(&bytes).await?;
        stream.shutdown().await
    };
    // A browser that went away or doesn't read is not worth waiting for.
    let _ = tokio::time::timeout(WRITE_DEADLINE, write).await;
}

#[cfg(test)]
mod tests {
    use super::*;

    const CODE: &str = "C0DEsecretCODE";
    const STATE: &str = "ST4TEsecretSTATE";

    fn callback() -> String {
        format!("/callback?code={CODE}&state={STATE}")
    }

    fn get(target: &str, port: u16) -> String {
        format!("GET {target} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nUser-Agent: test\r\n\r\n")
    }

    /// Sends `bytes`, then reads until the server closes the connection.
    async fn exchange(port: u16, bytes: Vec<u8>) -> String {
        let mut stream = TcpStream::connect((Ipv4Addr::LOCALHOST, port))
            .await
            .expect("connect");
        let _ = stream.write_all(&bytes).await;
        read_all(&mut stream).await
    }

    async fn read_all(stream: &mut TcpStream) -> String {
        let mut out = Vec::new();
        // A reset after the 400 is as good as an EOF here: keep what arrived.
        let _ = stream.read_to_end(&mut out).await;
        String::from_utf8_lossy(&out).into_owned()
    }

    fn status(response: &str) -> &str {
        response.lines().next().unwrap_or("")
    }

    async fn with_timeout<T>(future: impl std::future::Future<Output = T>) -> T {
        tokio::time::timeout(Duration::from_secs(10), future)
            .await
            .expect("timed out")
    }

    #[tokio::test]
    async fn binds_to_127_0_0_1_only() {
        let listener = bind_with(HEAD_DEADLINE).await.unwrap();
        let address = listener.local_addr();
        assert_eq!(address.ip(), std::net::IpAddr::V4(Ipv4Addr::LOCALHOST));
        assert_ne!(address.port(), 0);
        assert_eq!(listener.port(), address.port());
    }

    #[tokio::test]
    async fn the_trait_object_binds_and_serves() {
        let listener = DesktopLoopback.bind().await.unwrap();
        let port = listener.port();
        let client = tokio::spawn(exchange(port, get("/callback", port).into_bytes()));
        let request = with_timeout(listener.next(10_000)).await.unwrap();
        listener.reply(request.id, LoopbackPage::SignedIn);
        assert!(status(&with_timeout(client).await.unwrap()).contains("200"));
    }

    #[tokio::test]
    async fn a_get_is_delivered_and_answered_with_the_page() {
        let listener = bind_with(HEAD_DEADLINE).await.unwrap();
        let port = listener.port();
        let client = tokio::spawn(exchange(port, get(&callback(), port).into_bytes()));
        let request = with_timeout(listener.next(10_000))
            .await
            .expect("a request");
        assert_eq!(request.method, "GET");
        assert_eq!(
            request.host.as_deref(),
            Some(format!("127.0.0.1:{port}").as_str())
        );
        assert_eq!(request.target, callback());
        listener.reply(request.id, LoopbackPage::SignedIn);
        let response = with_timeout(client).await.unwrap();

        assert_eq!(status(&response), "HTTP/1.1 200 OK");
        let (head, body) = response.split_once("\r\n\r\n").unwrap();
        for header in [
            "Content-Type: text/html; charset=utf-8",
            "Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'",
            "Cache-Control: no-store",
            "Referrer-Policy: no-referrer",
            "X-Frame-Options: DENY",
            "Connection: close",
        ] {
            assert!(head.lines().any(|line| line == header), "missing {header}");
        }
        assert!(body.contains("You\u{2019}re signed in"));
        assert!(head.contains(&format!("Content-Length: {}", body.len())));
    }

    #[tokio::test]
    async fn each_page_has_its_status_and_wording() {
        let listener = bind_with(HEAD_DEADLINE).await.unwrap();
        let port = listener.port();
        for (page, line, words) in [
            (
                LoopbackPage::SignedIn,
                "HTTP/1.1 200 OK",
                "You\u{2019}re signed in",
            ),
            (LoopbackPage::Denied, "HTTP/1.1 200 OK", "Sign-in cancelled"),
            (
                LoopbackPage::BadRequest,
                "HTTP/1.1 400 Bad Request",
                "This link doesn\u{2019}t work",
            ),
        ] {
            let client = tokio::spawn(exchange(port, get(&callback(), port).into_bytes()));
            let request = with_timeout(listener.next(10_000)).await.unwrap();
            listener.reply(request.id, page);
            let response = with_timeout(client).await.unwrap();
            assert_eq!(status(&response), line);
            assert!(response.contains(words), "{response}");
            // Nothing of the request is echoed: no code, no state, no target, no path.
            for secret in [CODE, STATE, "callback", "127.0.0.1:", "code=", "state="] {
                assert!(!response.contains(secret), "{page:?} echoes {secret}");
            }
        }
    }

    #[tokio::test]
    async fn an_oversized_head_gets_400_and_never_reaches_next() {
        let listener = bind_with(HEAD_DEADLINE).await.unwrap();
        let port = listener.port();

        // Over the cap with no end in sight.
        let mut endless = b"GET /".to_vec();
        endless.extend(std::iter::repeat_n(b'a', MAX_HEAD_BYTES + 2048));
        let response = with_timeout(exchange(port, endless)).await;
        assert_eq!(status(&response), "HTTP/1.1 400 Bad Request");

        // A head that does end, but past the cap.
        let mut long = b"GET /callback HTTP/1.1\r\nHost: x\r\nX-Pad: ".to_vec();
        long.extend(std::iter::repeat_n(b'a', MAX_HEAD_BYTES));
        long.extend_from_slice(b"\r\n\r\n");
        let response = with_timeout(exchange(port, long)).await;
        assert_eq!(status(&response), "HTTP/1.1 400 Bad Request");

        assert!(listener.next(100).await.is_none());
    }

    #[tokio::test]
    async fn an_unparseable_head_gets_400_and_never_reaches_next() {
        let listener = bind_with(HEAD_DEADLINE).await.unwrap();
        let port = listener.port();
        for bad in [
            "garbage\r\n\r\n",
            "GET /callback\r\n\r\n",
            "GET callback HTTP/1.1\r\n\r\n",
            "GET /a HTTP/2.0\r\n\r\n",
            "GET /a HTTP/1.1\r\nno colon here\r\n\r\n",
            "GET /a HTTP/1.1\r\nHost : spaced\r\n\r\n",
            "GET /a HTTP/1.1\r\nHost: x\nInjected: y\r\n\r\n",
            "GET /\u{e9} HTTP/1.1\r\n\r\n",
        ] {
            let response = with_timeout(exchange(port, bad.as_bytes().to_vec())).await;
            assert_eq!(status(&response), "HTTP/1.1 400 Bad Request", "{bad:?}");
        }
        assert!(listener.next(100).await.is_none());
    }

    #[tokio::test]
    async fn host_is_some_only_when_there_is_exactly_one() {
        let listener = bind_with(HEAD_DEADLINE).await.unwrap();
        let port = listener.port();
        for (head, expected) in [
            ("GET /a HTTP/1.1\r\n\r\n", None),
            ("GET /a HTTP/1.1\r\nHost: a\r\nhost: b\r\n\r\n", None),
            ("GET /a HTTP/1.1\r\nhOsT:   one \r\n\r\n", Some("one")),
        ] {
            let client = tokio::spawn(exchange(port, head.as_bytes().to_vec()));
            let request = with_timeout(listener.next(10_000)).await.unwrap();
            assert_eq!(request.host.as_deref(), expected, "{head:?}");
            listener.reply(request.id, LoopbackPage::BadRequest);
            with_timeout(client).await.unwrap();
        }
    }

    #[tokio::test]
    async fn a_stalled_connection_does_not_block_a_complete_request() {
        let deadline = Duration::from_millis(300);
        let listener = bind_with(deadline).await.unwrap();
        let port = listener.port();

        // Half a head, then silence.
        let mut stalled = TcpStream::connect((Ipv4Addr::LOCALHOST, port))
            .await
            .unwrap();
        stalled
            .write_all(b"GET /half HTTP/1.1\r\nHo")
            .await
            .unwrap();
        let stalled = tokio::spawn(async move { read_all(&mut stalled).await });

        let client = tokio::spawn(exchange(port, get("/callback", port).into_bytes()));
        let request = with_timeout(listener.next(10_000))
            .await
            .expect("the second request");
        assert_eq!(request.target, "/callback");
        listener.reply(request.id, LoopbackPage::SignedIn);
        assert!(status(&with_timeout(client).await.unwrap()).contains("200"));

        // The stalled one is answered 400 at its deadline, and never shows up.
        let response = with_timeout(stalled).await.unwrap();
        assert_eq!(status(&response), "HTTP/1.1 400 Bad Request");
        assert!(listener.next(50).await.is_none());
    }

    #[tokio::test]
    async fn next_times_out_to_none() {
        let listener = bind_with(HEAD_DEADLINE).await.unwrap();
        assert!(listener.next(30).await.is_none());
        assert!(listener.next(0).await.is_none());
    }

    #[tokio::test]
    async fn close_wakes_a_waiting_next() {
        let listener = bind_with(HEAD_DEADLINE).await.unwrap();
        let waiting = {
            let listener = listener.clone();
            tokio::spawn(async move { listener.next(600_000).await })
        };
        for _ in 0..10 {
            tokio::task::yield_now().await;
        }
        listener.close();
        assert!(with_timeout(waiting).await.unwrap().is_none());
        // And a `next` after the close returns at once, with or without a request queued.
        assert!(with_timeout(listener.next(600_000)).await.is_none());
    }

    #[tokio::test]
    async fn close_answers_pending_requests_with_400() {
        let listener = bind_with(HEAD_DEADLINE).await.unwrap();
        let port = listener.port();

        // One taken from next() and unanswered; one still queued.
        let taken = tokio::spawn(exchange(port, get("/one", port).into_bytes()));
        let request = with_timeout(listener.next(10_000)).await.unwrap();
        assert_eq!(request.target, "/one");
        let queued = tokio::spawn(exchange(port, get("/two", port).into_bytes()));
        // Its head is in the queue once the connection task has registered it: wait on that, not
        // on time, by reading the registry.
        with_timeout(async {
            while lock(&listener.shared.pending).replies.len() < 2 {
                tokio::task::yield_now().await;
            }
        })
        .await;

        listener.close();
        for client in [taken, queued] {
            let response = with_timeout(client).await.unwrap();
            assert_eq!(status(&response), "HTTP/1.1 400 Bad Request");
        }
        // Answering after the close is harmless.
        listener.reply(request.id, LoopbackPage::SignedIn);
    }

    #[tokio::test]
    async fn requests_after_close_are_refused_or_answered_400() {
        let listener = bind_with(HEAD_DEADLINE).await.unwrap();
        let port = listener.port();
        listener.close();
        match TcpStream::connect((Ipv4Addr::LOCALHOST, port)).await {
            Err(_) => {}
            Ok(mut stream) => {
                let _ = stream.write_all(get(&callback(), port).as_bytes()).await;
                let response = with_timeout(read_all(&mut stream)).await;
                assert!(
                    response.is_empty() || status(&response) == "HTTP/1.1 400 Bad Request",
                    "{response}"
                );
            }
        }
        assert!(listener.next(50).await.is_none());
    }

    #[tokio::test]
    async fn debug_of_a_request_has_no_query() {
        let listener = bind_with(HEAD_DEADLINE).await.unwrap();
        let port = listener.port();
        let client = tokio::spawn(exchange(port, get(&callback(), port).into_bytes()));
        let request = with_timeout(listener.next(10_000)).await.unwrap();
        let shown = format!("{request:?}");
        assert!(shown.contains("/callback"), "{shown}");
        for secret in [CODE, STATE, "code=", "state="] {
            assert!(!shown.contains(secret), "{shown}");
        }
        listener.reply(request.id, LoopbackPage::Denied);
        with_timeout(client).await.unwrap();
    }

    #[tokio::test]
    async fn dropping_the_listener_closes_it() {
        let listener = bind_with(HEAD_DEADLINE).await.unwrap();
        let port = listener.port();
        let client = tokio::spawn(exchange(port, get("/a", port).into_bytes()));
        let _ = with_timeout(listener.next(10_000)).await.unwrap();
        drop(listener);
        let response = with_timeout(client).await.unwrap();
        assert_eq!(status(&response), "HTTP/1.1 400 Bad Request");
    }

    #[test]
    fn a_head_that_is_not_a_plain_http_1_request_does_not_parse() {
        for head in [
            "",
            "GET",
            "GET /callback",
            "GET /callback HTTP/2",
            "GET /callback HTTP/1.11",
            "GET /callback HTTP/1.1 extra",
            "GET  /callback HTTP/1.1",
            "GET callback HTTP/1.1",
            "GET http://127.0.0.1/callback HTTP/1.1",
            "G(T /callback HTTP/1.1",
            "GET /call\x01back HTTP/1.1",
            "GET /callback HTTP/1.1\r\nHost",
            "GET /callback HTTP/1.1\r\n Host: 127.0.0.1:1",
            "GET /callback HTTP/1.1\r\nHo st: 127.0.0.1:1",
            "GET /callback HTTP/1.1\r\nHost: a\x00b",
            "GET /callback HTTP/1.1\r\nHost: caf\u{e9}",
        ] {
            assert!(parse_head(head.as_bytes()).is_none(), "{head:?}");
        }
    }

    #[test]
    fn a_plain_head_parses_with_its_one_host() {
        let head = parse_head(b"get /callback?x=1 HTTP/1.0\r\nhOsT:  127.0.0.1:9 \r\nX-Tab: a\tb")
            .expect("parses");
        assert_eq!(head.method, "get");
        assert_eq!(head.target, "/callback?x=1");
        assert_eq!(head.host.as_deref(), Some("127.0.0.1:9"));
        // Two Hosts, even equal ones, are none.
        let twice = parse_head(b"GET / HTTP/1.1\r\nHost: a\r\nhost: a").unwrap();
        assert_eq!(twice.host, None);
        let none = parse_head(b"GET / HTTP/1.1").unwrap();
        assert_eq!(none.host, None);
    }

    #[test]
    fn the_end_of_a_head_is_found_wherever_a_read_split_it() {
        let bytes = b"GET / HTTP/1.1\r\nHost: a\r\n\r\nbody";
        let end = bytes.windows(4).position(|w| w == b"\r\n\r\n").unwrap();
        for from in 0..=end {
            assert_eq!(find_head_end(bytes, from), Some(end), "from {from}");
        }
        assert_eq!(find_head_end(bytes, end + 1), None);
        assert_eq!(find_head_end(b"\r\n\r", 0), None);
        assert_eq!(find_head_end(b"", 0), None);
    }

    mod properties {
        use super::super::*;
        use proptest::prelude::*;
        use proptest::test_runner::{Config, RngSeed};

        fn config() -> Config {
            Config {
                cases: 512,
                rng_seed: RngSeed::Fixed(0x1005_bac4),
                ..Config::default()
            }
        }

        proptest! {
            #![proptest_config(config())]

            #[test]
            fn no_bytes_panic_the_head_parser(bytes in prop::collection::vec(any::<u8>(), 0..200)) {
                let _ = parse_head(&bytes);
                for from in 0..bytes.len().min(8) {
                    let _ = find_head_end(&bytes, from);
                }
            }

            #[test]
            fn a_parsed_head_holds_no_control_characters(
                method in "[A-Za-z]{1,8}",
                target in "/[ -~]{0,30}",
                host in proptest::option::of("[ -~]{0,20}"),
            ) {
                let mut head = format!("{method} {target} HTTP/1.1");
                if let Some(host) = &host {
                    head.push_str(&format!("\r\nHost: {host}"));
                }
                if let Some(parsed) = parse_head(head.as_bytes()) {
                    prop_assert!(!has_control(&parsed.target, false));
                    prop_assert!(parsed.target.starts_with('/'));
                    prop_assert!(parsed.host.as_deref().is_none_or(|host| !has_control(host, true)));
                }
            }
        }
    }
}
