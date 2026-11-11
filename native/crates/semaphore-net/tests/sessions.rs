//! What happens to tokens when calls overlap: a refresh or login still in flight when the user
//! signs out or changes server, a caller that gives up, and a keyring that takes its time.
//!
//! Each test stops the server, or the store, at the moment in question and releases it by hand.

mod common;

use std::sync::Arc;
use std::time::Duration;

use common::*;
use semaphore_core::backend::{CommunitiesBackend, SessionBackend};
use semaphore_net::HttpBackend;

fn backend() -> (HttpBackend, Arc<Secrets>) {
    let secrets = Arc::new(Secrets::default());
    (HttpBackend::new(secrets.clone()), secrets)
}

/// Finding 1. The rotated token is the one the server must revoke, so sign-out waits for it, then
/// nothing of the session stays here.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_refresh_in_flight_does_not_survive_sign_out() {
    let stub = Stub::auth("a").await;
    let (backend, secrets) = backend();
    signed_in(&backend, &stub).await;

    stub.hold(REFRESH);
    let refresh = tokio::spawn({
        let backend = backend.clone();
        async move { backend.refresh_access_token().await }
    });
    until("the refresh to reach the server", || {
        stub.count(REFRESH) == 1
    })
    .await;

    let mut logout = backend.auth_controller_logout(logout_body());
    assert!(
        tokio::time::timeout(Duration::from_millis(200), &mut logout)
            .await
            .is_err(),
        "sign-out finished while the refresh that would undo it was running"
    );

    stub.release(REFRESH);
    assert_eq!(refresh.await.unwrap().unwrap(), "a-access-r1");
    logout.await.unwrap();

    assert_eq!(backend.access_token(), None);
    assert_eq!(secrets.get(&stub.key()), None);
    let revoke = &stub.to(LOGOUT)[0];
    assert!(revoke.body.contains("a-refresh-r1"), "{}", revoke.body);
    assert_eq!(secrets.log().last().unwrap(), "delete");
}

/// Finding 1, the other way round: a refresh asked for while sign-out runs has no session to renew.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_refresh_queued_behind_sign_out_gets_an_error() {
    let stub = Stub::auth("a").await;
    let (backend, secrets) = backend();
    signed_in(&backend, &stub).await;

    stub.hold(LOGOUT);
    let logout = tokio::spawn({
        let backend = backend.clone();
        async move { backend.auth_controller_logout(logout_body()).await }
    });
    until("the logout to reach the server", || stub.count(LOGOUT) == 1).await;
    let mut refresh = Box::pin(backend.refresh_access_token());
    assert!(poll_once(&mut refresh).await.is_none());

    stub.release(LOGOUT);
    logout.await.unwrap().unwrap();
    refresh.await.expect_err("there is no session to renew");

    assert_eq!(stub.count(REFRESH), 0);
    assert_eq!(backend.access_token(), None);
    assert_eq!(secrets.get(&stub.key()), None);
}

/// Finding 1's other race: sign-out is slow, and the user is already on another server. Ending the
/// old session must not end the new one, and what's stored for the old server still goes.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_server_switch_during_sign_out_leaves_the_new_session_alone() {
    let old = Stub::auth("a").await;
    let new = Stub::auth("b").await;
    let (backend, secrets) = backend();
    signed_in(&backend, &old).await;

    old.hold(LOGOUT);
    let logout = tokio::spawn({
        let backend = backend.clone();
        async move { backend.auth_controller_logout(logout_body()).await }
    });
    until("the logout to reach the server", || old.count(LOGOUT) == 1).await;

    signed_in(&backend, &new).await;
    old.release(LOGOUT);
    logout.await.unwrap().unwrap();

    assert_eq!(backend.access_token().as_deref(), Some("b-access-l1"));
    assert_eq!(secrets.get(&new.key()).as_deref(), Some("b-refresh-l1"));
    assert_eq!(secrets.get(&old.key()), None);
}

/// The same on one server: a login that lands while sign-out runs is the session that counts.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_login_during_sign_out_is_the_session_that_stays() {
    let stub = Stub::auth("a").await;
    let (backend, secrets) = backend();
    signed_in(&backend, &stub).await;

    stub.hold(LOGOUT);
    let logout = tokio::spawn({
        let backend = backend.clone();
        async move { backend.auth_controller_logout(logout_body()).await }
    });
    until("the logout to reach the server", || stub.count(LOGOUT) == 1).await;

    backend.auth_controller_login(credentials()).await.unwrap();
    stub.release(LOGOUT);
    logout.await.unwrap().unwrap();

    assert_eq!(backend.access_token().as_deref(), Some("a-access-l2"));
    assert_eq!(secrets.get(&stub.key()).as_deref(), Some("a-refresh-l2"));
}

/// Finding 2. The old server's token must not land in the new server's client, and the caller
/// waiting on that refresh gets an error rather than a token from the wrong server.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_refresh_in_flight_does_not_cross_a_server_switch() {
    let old = Stub::auth("a").await;
    let new = Stub::auth("b").await;
    let (backend, secrets) = backend();
    signed_in(&backend, &old).await;

    old.hold(REFRESH);
    let refresh = tokio::spawn({
        let backend = backend.clone();
        async move { backend.refresh_access_token().await }
    });
    until("the refresh to reach the server", || {
        old.count(REFRESH) == 1
    })
    .await;
    let mut waiter = Box::pin(backend.refresh_access_token());
    assert!(poll_once(&mut waiter).await.is_none());

    backend.set_server_url(new.url.clone());
    backend.auth_controller_login(credentials()).await.unwrap();

    old.release(REFRESH);
    refresh
        .await
        .unwrap()
        .expect_err("from the previous session");
    waiter.await.expect_err("from the previous session");

    assert_eq!(backend.access_token().as_deref(), Some("b-access-l1"));
    backend.community_controller_find_all_mine().await.unwrap();
    let sent = new.to(COMMUNITIES);
    assert!(
        sent[0].head.contains("authorization: bearer b-access-l1"),
        "{}",
        sent[0].head
    );
    // Nothing from the old server reached the new one, or the store.
    assert!(new.requests().iter().all(|r| !r.head.contains("a-access")));
    assert_eq!(secrets.get(&new.key()).as_deref(), Some("b-refresh-l1"));
    assert_eq!(secrets.get(&old.key()).as_deref(), Some("a-refresh-l1"));
    assert_eq!(new.count(REFRESH), 0);
}

/// Finding 2. The old server refusing a token says nothing about the session on the new one.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_refused_refresh_from_the_old_server_leaves_the_new_session_alone() {
    let refusing = auth_responder("a");
    let old = Stub::start(move |request| {
        if request.is(REFRESH) {
            (401, UNAUTHENTICATED.to_owned())
        } else {
            refusing(request)
        }
    })
    .await;
    let new = Stub::auth("b").await;
    let (backend, secrets) = backend();
    signed_in(&backend, &old).await;

    old.hold(REFRESH);
    let refresh = tokio::spawn({
        let backend = backend.clone();
        async move { backend.refresh_access_token().await }
    });
    until("the refresh to reach the server", || {
        old.count(REFRESH) == 1
    })
    .await;

    signed_in(&backend, &new).await;
    old.release(REFRESH);
    refresh
        .await
        .unwrap()
        .expect_err("from the previous session");

    assert_eq!(backend.access_token().as_deref(), Some("b-access-l1"));
    assert_eq!(secrets.get(&new.key()).as_deref(), Some("b-refresh-l1"));
}

/// Finding 2, for a login.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_login_in_flight_does_not_cross_a_server_switch() {
    let old = Stub::auth("a").await;
    let new = Stub::auth("b").await;
    let (backend, secrets) = backend();
    backend.set_server_url(old.url.clone());

    old.hold(LOGIN);
    let login = tokio::spawn({
        let backend = backend.clone();
        async move { backend.auth_controller_login(credentials()).await }
    });
    until("the login to reach the server", || old.count(LOGIN) == 1).await;

    backend.set_server_url(new.url.clone());
    old.release(LOGIN);
    login.await.unwrap().expect_err("from the previous server");

    assert_eq!(backend.access_token(), None);
    assert_eq!(secrets.get(&old.key()), None);
    assert_eq!(secrets.get(&new.key()), None);
    let _ = backend.community_controller_find_all_mine().await;
    let sent = new.to(COMMUNITIES);
    assert!(!sent[0].head.contains("authorization"), "{}", sent[0].head);
}

/// Finding 2, for a call: a 401 from the old server must not refresh the new session or send the
/// old request on to the new server.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_call_refused_by_the_old_server_is_not_resent_to_the_new_one() {
    let refusing = auth_responder("a");
    let old = Stub::start(move |request| {
        if request.is(COMMUNITIES) {
            (401, UNAUTHENTICATED.to_owned())
        } else {
            refusing(request)
        }
    })
    .await;
    let new = Stub::auth("b").await;
    let (backend, _secrets) = backend();
    signed_in(&backend, &old).await;

    old.hold(COMMUNITIES);
    let call = tokio::spawn({
        let backend = backend.clone();
        async move { backend.community_controller_find_all_mine().await }
    });
    until("the call to reach the server", || {
        old.count(COMMUNITIES) == 1
    })
    .await;

    signed_in(&backend, &new).await;
    old.release(COMMUNITIES);
    call.await.unwrap().expect_err("from the previous session");

    assert_eq!(new.count(COMMUNITIES), 0);
    assert_eq!(new.count(REFRESH), 0);
    assert_eq!(old.count(REFRESH), 0);
}

/// Finding 2's shape on one server: a new login outranks a refresh of the session before it.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_new_login_outranks_a_refresh_in_flight() {
    let stub = Stub::auth("a").await;
    let (backend, secrets) = backend();
    signed_in(&backend, &stub).await;

    stub.hold(REFRESH);
    let refresh = tokio::spawn({
        let backend = backend.clone();
        async move { backend.refresh_access_token().await }
    });
    until("the refresh to reach the server", || {
        stub.count(REFRESH) == 1
    })
    .await;

    backend.auth_controller_login(credentials()).await.unwrap();
    stub.release(REFRESH);
    refresh
        .await
        .unwrap()
        .expect_err("from the previous session");

    assert_eq!(backend.access_token().as_deref(), Some("a-access-l2"));
    assert_eq!(secrets.get(&stub.key()).as_deref(), Some("a-refresh-l2"));
}

/// Finding 3. The caller goes away, the refresh goes on, and the next caller waits for it instead
/// of presenting a token the first refresh is consuming.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_cancelled_caller_keeps_the_refresh_gate_shut() {
    let stub = Stub::auth("a").await;
    let (backend, secrets) = backend();
    signed_in(&backend, &stub).await;

    stub.hold(REFRESH);
    let first = tokio::spawn({
        let backend = backend.clone();
        async move { backend.refresh_access_token().await }
    });
    until("the refresh to reach the server", || {
        stub.count(REFRESH) == 1
    })
    .await;
    first.abort();
    let _ = first.await;

    let mut second = Box::pin(backend.refresh_access_token());
    assert!(poll_once(&mut second).await.is_none());

    stub.release(REFRESH);
    assert_eq!(second.await.unwrap(), "a-access-r1");
    assert_eq!(stub.count(REFRESH), 1, "the old token was presented twice");
    // A waiter doesn't wait for the store, so the save may still be on its way.
    until("the rotated token to be stored", || {
        secrets.get(&stub.key()).as_deref() == Some("a-refresh-r1")
    })
    .await;
}

/// Finding 4. A keyring at its unlock prompt holds up its own write and nothing else.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_blocked_secret_store_does_not_block_other_calls() {
    let stub = Stub::auth("a").await;
    let (backend, secrets) = backend();
    let _unblock = Unblock(secrets.clone());
    backend.set_server_url(stub.url.clone());

    secrets.block_saves();
    let login = tokio::spawn({
        let backend = backend.clone();
        async move { backend.auth_controller_login(credentials()).await }
    });
    until("the save to reach the store", || secrets.waiting() == 1).await;

    let held = backend.clone();
    let token = within("access_token", move || held.access_token());
    assert_eq!(token.as_deref(), Some("a-access-l1"));
    let held = backend.clone();
    let url = within("server_url", move || held.server_url());
    assert_eq!(url.as_deref(), Some(stub.url.as_str()));
    tokio::time::timeout(
        Duration::from_secs(5),
        backend.community_controller_find_all_mine(),
    )
    .await
    .expect("a request did not get through while the store was busy")
    .unwrap();

    secrets.unblock();
    login.await.unwrap().unwrap();
    assert_eq!(secrets.get(&stub.key()).as_deref(), Some("a-refresh-l1"));
}

/// Finding 4, and worse than a stall: on Linux the real keyring goes through zbus's `block_on`, which
/// panics on a Tokio worker with "Cannot start a runtime from within a runtime".
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn the_store_is_never_touched_on_a_runtime_thread() {
    let stub = Stub::auth("a").await;
    let (backend, secrets) = backend();
    signed_in(&backend, &stub).await;
    backend.refresh_access_token().await.unwrap();
    backend.auth_controller_logout(logout_body()).await.unwrap();

    assert_eq!(secrets.log().last().unwrap(), "delete");
    assert_eq!(secrets.calls_on_a_runtime_thread(), 0);
}

/// Finding 4. Writes reach the store in the order the session changed, so a sign-out can't lose to
/// a save it overtook.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_sign_out_does_not_lose_to_a_save_in_progress() {
    let stub = Stub::auth("a").await;
    let (backend, secrets) = backend();
    let _unblock = Unblock(secrets.clone());
    signed_in(&backend, &stub).await;

    secrets.block_saves();
    let refresh = tokio::spawn({
        let backend = backend.clone();
        async move { backend.refresh_access_token().await }
    });
    until("the save to reach the store", || secrets.waiting() == 1).await;

    let logout = tokio::spawn({
        let backend = backend.clone();
        async move { backend.auth_controller_logout(logout_body()).await }
    });
    until("the logout to reach the server", || stub.count(LOGOUT) == 1).await;
    // The session is gone here already, though the store is still busy.
    until("the session to end", || backend.access_token().is_none()).await;

    secrets.unblock();
    refresh.await.unwrap().unwrap();
    logout.await.unwrap().unwrap();

    assert_eq!(secrets.get(&stub.key()), None);
    assert_eq!(
        secrets.log(),
        vec![
            "save a-refresh-l1".to_owned(),
            "save a-refresh-r1".to_owned(),
            "delete".to_owned()
        ]
    );
}

/// Finding 7. The route sits behind the global JWT guard, so a stale access token is refused before
/// the handler runs and the refresh token it carries is never revoked.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn logout_with_an_expired_access_token_still_revokes_on_the_server() {
    let serve = auth_responder("a");
    let stub = Stub::start(move |request| {
        if request.is(LOGOUT) && !request.head.contains("authorization: bearer a-access-r1") {
            (401, UNAUTHENTICATED.to_owned())
        } else {
            serve(request)
        }
    })
    .await;
    let (backend, secrets) = backend();
    signed_in(&backend, &stub).await;

    backend
        .auth_controller_logout(logout_body())
        .await
        .expect("the revoke went through after a refresh");

    let attempts = stub.to(LOGOUT);
    assert_eq!(attempts.len(), 2, "one refused, one after the refresh");
    assert!(
        attempts[1].body.contains("a-refresh-r1"),
        "{}",
        attempts[1].body
    );
    assert_eq!(stub.count(REFRESH), 1);
    assert_eq!(backend.access_token(), None);
    assert_eq!(secrets.get(&stub.key()), None);
}

/// Finding 7: with the session already dead on the server there is nothing to revoke, and signing
/// out here still works.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn logout_with_a_dead_session_still_signs_out_here() {
    let serve = auth_responder("a");
    let stub = Stub::start(move |request| {
        if request.is(LOGOUT) || request.is(REFRESH) {
            (401, UNAUTHENTICATED.to_owned())
        } else {
            serve(request)
        }
    })
    .await;
    let (backend, secrets) = backend();
    signed_in(&backend, &stub).await;

    let error = backend
        .auth_controller_logout(logout_body())
        .await
        .unwrap_err();
    assert_eq!(error.status, 401);
    assert_eq!(stub.count(LOGOUT), 1);
    assert_eq!(stub.count(REFRESH), 1);
    assert_eq!(backend.access_token(), None);
    assert_eq!(secrets.get(&stub.key()), None);
}

/// A login that returns no refresh token ends the older session here too: the one left in the
/// store belongs to a session this client no longer holds.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_login_without_a_refresh_token_forgets_the_stored_one() {
    let serve = auth_responder("a");
    let logins = std::sync::atomic::AtomicUsize::new(0);
    let stub = Stub::start(move |request| {
        if request.is(LOGIN) && logins.fetch_add(1, std::sync::atomic::Ordering::SeqCst) == 1 {
            (200, r#"{"accessToken":"a-access-bare"}"#.to_owned())
        } else {
            serve(request)
        }
    })
    .await;
    let (backend, secrets) = backend();
    signed_in(&backend, &stub).await;
    assert_eq!(secrets.get(&stub.key()).as_deref(), Some("a-refresh-l1"));

    backend.auth_controller_login(credentials()).await.unwrap();

    assert_eq!(backend.access_token().as_deref(), Some("a-access-bare"));
    assert_eq!(secrets.get(&stub.key()), None);
}

/// U13 phase 3: a session stored at one run resumes at the next with no password, using the stored
/// refresh token, and only for the server it belongs to.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_stored_session_resumes_at_the_next_start() {
    let stub = Stub::auth("a").await;
    let (first, secrets) = backend();
    signed_in(&first, &stub).await;
    assert_eq!(secrets.get(&stub.key()).as_deref(), Some("a-refresh-l1"));
    drop(first);

    let store = secrets.clone();
    let url = stub.url.clone();
    let next = within("constructing", move || {
        HttpBackend::restoring(store, Some(format!("{url}/")))
    });
    assert!(
        !next.has_stored_session(),
        "nothing until the server is set"
    );
    next.set_server_url(stub.url.clone());
    assert!(next.has_stored_session());
    let refreshed = next
        .auth_controller_refresh(semaphore_wire::types::RefreshRequestDto {
            refresh_token: None,
        })
        .await
        .unwrap();
    assert_eq!(refreshed.access_token, "a-access-r1");
    let sent = stub.to(REFRESH);
    assert_eq!(sent.len(), 1);
    assert!(sent[0].body.contains("a-refresh-l1"), "{}", sent[0].body);
    // The rotated token replaces the stored one.
    assert_eq!(secrets.get(&stub.key()).as_deref(), Some("a-refresh-r1"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_stored_session_is_only_for_its_own_server() {
    let stub = Stub::auth("a").await;
    let other = Stub::auth("b").await;
    let (first, secrets) = backend();
    signed_in(&first, &stub).await;

    let store = secrets.clone();
    let url = stub.url.clone();
    let next = within("constructing", move || {
        HttpBackend::restoring(store, Some(url))
    });
    next.set_server_url(other.url.clone());
    assert!(!next.has_stored_session());
    // Coming back to the stored server finds it still waiting.
    next.set_server_url(stub.url.clone());
    assert!(next.has_stored_session());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn flush_waits_for_writes_already_queued() {
    let stub = Stub::auth("a").await;
    let (backend, secrets) = backend();
    let _unblock = Unblock(secrets.clone());
    backend.set_server_url(stub.url.clone());
    secrets.block_saves();
    let login = tokio::spawn({
        let backend = backend.clone();
        async move { backend.auth_controller_login(credentials()).await }
    });
    until("the save to reach the store", || secrets.waiting() == 1).await;

    let held = backend.clone();
    let flushed = tokio::task::spawn_blocking(move || held.flush(Duration::from_millis(100)))
        .await
        .unwrap();
    assert!(!flushed, "the write is still held at the store");

    secrets.unblock();
    let held = backend.clone();
    let flushed = tokio::task::spawn_blocking(move || held.flush(Duration::from_secs(5)))
        .await
        .unwrap();
    assert!(flushed);
    assert_eq!(secrets.get(&stub.key()).as_deref(), Some("a-refresh-l1"));
    login.await.unwrap().unwrap();
}
