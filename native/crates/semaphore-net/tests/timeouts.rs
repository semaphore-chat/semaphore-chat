//! A server or keyring that stops answering costs a call its answer, never the session, and never
//! the callers behind it.

mod common;

use std::sync::Arc;
use std::time::{Duration, Instant};

use common::*;
use semaphore_core::backend::Backend;
use semaphore_net::{HttpBackend, Timeouts};
use tokio::io::AsyncWriteExt;
use tokio::net::TcpListener;

const LONG: Duration = Duration::from_secs(60);

fn limits(read: Duration, refresh_total: Duration) -> Timeouts {
    Timeouts {
        connect: Duration::from_secs(2),
        read,
        refresh_total,
        store_wait: Duration::from_secs(5),
    }
}

fn backend(timeouts: Timeouts) -> (HttpBackend, Arc<Secrets>) {
    let secrets = Arc::new(Secrets::default());
    (
        HttpBackend::with_timeouts(secrets.clone(), timeouts),
        secrets,
    )
}

/// Finding 5. The server takes the connection and the request and never answers. Before there were
/// timeouts this held the refresh gate for good, and every later caller behind it.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_refresh_that_never_answers_fails_retryably_and_keeps_the_session() {
    let stub = Stub::auth("a").await;
    let (backend, secrets) = backend(limits(Duration::from_millis(200), LONG));
    signed_in(&backend, &stub).await;

    stub.hold(REFRESH);
    let error = tokio::time::timeout(Duration::from_secs(10), backend.refresh_access_token())
        .await
        .expect("a hung refresh must time out")
        .unwrap_err();
    assert!(error.retryable, "{error}");
    assert_eq!(error.status, 0);

    // Nothing was refused, so nothing is lost.
    assert_eq!(backend.access_token().as_deref(), Some("a-access-l1"));
    assert_eq!(secrets.get(&stub.key()).as_deref(), Some("a-refresh-l1"));

    // And the gate is open again: the next try reaches a server that has recovered.
    stub.release(REFRESH);
    let renewed = backend.refresh_access_token().await.unwrap();
    assert!(renewed.starts_with("a-access-r"), "{renewed}");
    assert_eq!(stub.count(REFRESH), 2);
}

/// Finding 5. A server that keeps resetting the read timer can't hold the gate either.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_refresh_has_a_limit_of_its_own() {
    let stub = Stub::auth("a").await;
    let (backend, _secrets) = backend(limits(LONG, Duration::from_millis(200)));
    signed_in(&backend, &stub).await;

    stub.hold(REFRESH);
    let error = tokio::time::timeout(Duration::from_secs(10), backend.refresh_access_token())
        .await
        .expect("a hung refresh must time out")
        .unwrap_err();
    assert!(error.retryable, "{error}");
    assert_eq!(backend.access_token().as_deref(), Some("a-access-l1"));
}

/// Finding 5, for an ordinary call.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_call_that_never_answers_fails_retryably() {
    let stub = Stub::auth("a").await;
    let (backend, _secrets) = backend(limits(Duration::from_millis(200), LONG));
    signed_in(&backend, &stub).await;

    stub.hold(COMMUNITIES);
    let error = tokio::time::timeout(
        Duration::from_secs(10),
        backend.community_controller_find_all_mine(),
    )
    .await
    .expect("a hung call must time out")
    .unwrap_err();
    assert!(error.retryable, "{error}");
    assert_eq!(backend.access_token().as_deref(), Some("a-access-l1"));
}

/// Finding 5. The user asked to leave: a hung server can't stop that.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_hung_server_cannot_stop_a_sign_out() {
    let stub = Stub::auth("a").await;
    let (backend, secrets) = backend(limits(Duration::from_millis(200), LONG));
    signed_in(&backend, &stub).await;

    stub.hold(LOGOUT);
    tokio::time::timeout(
        Duration::from_secs(10),
        backend.auth_controller_logout(logout_body()),
    )
    .await
    .expect("a hung logout must time out")
    .unwrap_err();
    assert_eq!(backend.access_token(), None);
    assert_eq!(secrets.get(&stub.key()), None);
}

/// Finding 5. The limit is per read: a download slower than it in total, but never stalled, gets
/// through. This is why it isn't `ClientBuilder::timeout`.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_long_download_outlives_the_read_timeout() {
    const CHUNKS: usize = 5;
    const GAP: Duration = Duration::from_millis(400);
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let mut request = vec![0u8; 4096];
        let _ = tokio::io::AsyncReadExt::read(&mut stream, &mut request).await;
        let head = format!(
            "HTTP/1.1 200 OK\r\ncontent-type: application/octet-stream\r\ncontent-length: {CHUNKS}\r\nconnection: close\r\n\r\n"
        );
        stream.write_all(head.as_bytes()).await.unwrap();
        for _ in 0..CHUNKS {
            // Paces the stream on purpose: the gaps are what's being tested.
            tokio::time::sleep(GAP).await;
            stream.write_all(b"x").await.unwrap();
            stream.flush().await.unwrap();
        }
    });
    let read = Duration::from_millis(1500);
    let (backend, _secrets) = backend(limits(read, LONG));
    backend.set_server_url(url);

    let started = Instant::now();
    let body = backend
        .file_controller_get_file("file-1".into())
        .await
        .expect("no single read took longer than the limit");
    assert_eq!(body.len(), CHUNKS);
    assert!(
        started.elapsed() > read,
        "the download was meant to outlast the limit"
    );
}

/// Finding 4. A call waiting on its own write gives up after a while, the write stays queued, and
/// the refresh gate isn't held meanwhile.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_stuck_store_delays_callers_only_up_to_a_limit() {
    let stub = Stub::auth("a").await;
    let secrets = Arc::new(Secrets::default());
    let backend = HttpBackend::with_timeouts(
        secrets.clone(),
        Timeouts {
            store_wait: Duration::from_millis(100),
            ..limits(Duration::from_secs(5), Duration::from_secs(5))
        },
    );
    let _unblock = Unblock(secrets.clone());
    backend.set_server_url(stub.url.clone());

    secrets.block_saves();
    backend.auth_controller_login(credentials()).await.unwrap();
    assert_eq!(backend.refresh_access_token().await.unwrap(), "a-access-r1");
    assert_eq!(backend.refresh_access_token().await.unwrap(), "a-access-r2");
    backend.auth_controller_logout(logout_body()).await.unwrap();
    assert_eq!(backend.access_token(), None);

    // Open again, the queue drains in order, and the sign-out has the last word.
    secrets.unblock();
    until("the queue to drain", || {
        secrets.log().last().map(String::as_str) == Some("delete")
    })
    .await;
    assert_eq!(
        secrets.log(),
        [
            "save a-refresh-l1",
            "save a-refresh-r1",
            "save a-refresh-r2",
            "delete"
        ]
    );
    assert_eq!(secrets.get(&stub.key()), None);
}
