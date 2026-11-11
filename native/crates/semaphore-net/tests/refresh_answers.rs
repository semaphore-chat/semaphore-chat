//! What the refresh endpoint can answer besides a good token pair, and what each leaves behind:
//! a garbled or partial body, a rate limit, a server error, a refusal, a rotation that keeps the
//! refresh token. Also a 401 that isn't about the access token.

mod common;

use std::sync::Arc;

use common::*;
use semaphore_core::backend::{CommunitiesBackend, SessionBackend};
use semaphore_net::HttpBackend;

/// A server that logs in as `auth_responder("a")` does and answers every refresh with `refresh`.
async fn stub_answering_refresh(refresh: (u16, &'static str)) -> Stub {
    let auth = auth_responder("a");
    Stub::start(move |request| {
        if request.is(REFRESH) {
            (refresh.0, refresh.1.to_owned())
        } else {
            auth(request)
        }
    })
    .await
}

async fn signed_in_against(stub: &Stub) -> (HttpBackend, Arc<Secrets>) {
    let secrets = Arc::new(Secrets::default());
    let backend = HttpBackend::new(secrets.clone());
    signed_in(&backend, stub).await;
    assert_eq!(backend.access_token().as_deref(), Some("a-access-l1"));
    (backend, secrets)
}

/// A refresh that failed for a reason other than a refusal keeps the session: the tokens it had,
/// in memory and in the store, so a later attempt can still succeed.
async fn assert_session_kept(backend: &HttpBackend, secrets: &Secrets, stub: &Stub) {
    assert_eq!(backend.access_token().as_deref(), Some("a-access-l1"));
    assert!(backend.has_stored_session());
    assert_eq!(secrets.get(&stub.key()).as_deref(), Some("a-refresh-l1"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_garbled_refresh_answer_fails_and_keeps_the_session() {
    for body in [
        "not json",
        "{}",
        r#"{"refreshToken":"a-refresh-x"}"#,
        r#"{"accessToken":7}"#,
        "",
    ] {
        let stub = stub_answering_refresh((200, body)).await;
        let (backend, secrets) = signed_in_against(&stub).await;

        let error = backend.refresh_access_token().await.unwrap_err();

        assert!(
            !matches!(error.status, 401 | 403),
            "{body:?} read as a refusal: {error}"
        );
        assert_session_kept(&backend, &secrets, &stub).await;
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_rate_limit_or_server_error_on_refresh_keeps_the_session() {
    for (status, body) in [
        (
            429,
            r#"{"statusCode":429,"message":"slow down","errorCode":"RATE_LIMITED","retryable":true}"#,
        ),
        (
            500,
            r#"{"statusCode":500,"message":"boom","errorCode":"INTERNAL","retryable":true}"#,
        ),
        (503, "<html>down</html>"),
    ] {
        let stub = stub_answering_refresh((status, body)).await;
        let (backend, secrets) = signed_in_against(&stub).await;

        let error = backend.refresh_access_token().await.unwrap_err();

        assert_eq!(error.status, status);
        assert_session_kept(&backend, &secrets, &stub).await;
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_refused_refresh_ends_the_session_whether_401_or_403() {
    for (status, code) in [
        (401, "UNAUTHENTICATED"),
        (403, "FORBIDDEN"),
        (401, "TOKEN_REUSED"),
    ] {
        let body: &'static str = Box::leak(
            format!(
                r#"{{"statusCode":{status},"message":"no","errorCode":"{code}","retryable":false}}"#
            )
            .into_boxed_str(),
        );
        let stub = stub_answering_refresh((status, body)).await;
        let (backend, secrets) = signed_in_against(&stub).await;

        let error = backend.refresh_access_token().await.unwrap_err();

        assert_eq!(error.status, status);
        assert_eq!(backend.access_token(), None, "{status} {code}");
        assert!(!backend.has_stored_session());
        assert_eq!(secrets.get(&stub.key()), None);
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_refresh_without_a_new_refresh_token_keeps_the_old_one() {
    let stub = stub_answering_refresh((200, r#"{"accessToken":"a-access-only"}"#)).await;
    let (backend, secrets) = signed_in_against(&stub).await;

    assert_eq!(
        backend.refresh_access_token().await.unwrap(),
        "a-access-only"
    );

    assert_eq!(backend.access_token().as_deref(), Some("a-access-only"));
    assert!(backend.has_stored_session());
    assert_eq!(secrets.get(&stub.key()).as_deref(), Some("a-refresh-l1"));
    // The next refresh still sends the token it has.
    backend.refresh_access_token().await.unwrap();
    let last = stub.to(REFRESH).pop().unwrap();
    assert!(last.body.contains("a-refresh-l1"), "{}", last.body);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_401_that_is_not_about_the_access_token_does_not_refresh() {
    let auth = auth_responder("a");
    let stub = Stub::start(move |request| {
        if request.is(COMMUNITIES) {
            (
                401,
                r#"{"statusCode":401,"message":"wrong password","errorCode":"INVALID_CREDENTIALS","retryable":false}"#
                    .to_owned(),
            )
        } else {
            auth(request)
        }
    })
    .await;
    let (backend, _secrets) = signed_in_against(&stub).await;

    let error = backend
        .community_controller_find_all_mine()
        .await
        .unwrap_err();

    assert_eq!(error.status, 401);
    assert_eq!(error.code.as_str(), "INVALID_CREDENTIALS");
    assert_eq!(stub.count(REFRESH), 0);
    assert_eq!(stub.count(COMMUNITIES), 1, "not retried");
    assert_eq!(backend.access_token().as_deref(), Some("a-access-l1"));
}
