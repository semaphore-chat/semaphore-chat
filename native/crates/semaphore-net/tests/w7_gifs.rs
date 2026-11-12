//! W7-A over the real transports: the featured list and search, a page at a time, by `Core` on
//! `HttpBackend` and `SocketRealtime` against `semaphore-fake-server`'s showcase.

mod common;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use common::until;
use semaphore_core::lifecycle::ConnectionState;
use semaphore_core::model::{LoadState, SessionState};
use semaphore_core::platform::{Clock, CoreError, CoreEvent, EventSink, SecretStore};
use semaphore_core::{Core, Services};
use semaphore_fake_server::{FakeServer, ScenarioSource};
use semaphore_net::socket::SocketConfig;
use semaphore_net::{HttpBackend, SocketRealtime};
use serde_json::json;

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

struct Client {
    core: Core,
}

/// The fake's public settings answer GIF search off until a control turns it on.
async fn enable_gifs(server: &FakeServer) {
    // reqwest 0.13 builds a client over rustls without a provider; the transport picks ring.
    let _ = rustls::crypto::ring::default_provider().install_default();
    let response = reqwest::Client::new()
        .post(format!("{}/__control/public_settings", server.base_url()))
        .json(&json!({ "gifSearchEnabled": true }))
        .send()
        .await
        .expect("the fake answers");
    assert_eq!(response.status().as_u16(), 200);
}

async fn signed_in(server: &FakeServer, username: &str) -> Client {
    let backend = HttpBackend::new(Arc::new(MemSecrets::default()));
    let mut config = SocketConfig::new("unused");
    config.reconnect_delay = Duration::from_millis(50);
    let realtime = SocketRealtime::new(config, backend.clone());
    let events = Arc::new(Recorder::default());
    let core = Core::with_services(
        Arc::new(WallClock),
        events,
        Services {
            backend: Arc::new(backend.clone()),
            realtime: realtime.clone(),
            media: None,
        },
    );
    realtime.attach(core.clone());
    let driver = core.clone();
    tokio::spawn(async move { driver.drive().await });
    // What the server offers, before signing in: `gif_search` comes from here.
    core.probe_server(server.base_url())
        .await
        .expect("the server answers");
    core.sign_in(server.base_url(), username.into(), "pw".into())
        .await
        .unwrap();
    until("sign-in", || {
        matches!(core.session(), SessionState::SignedIn { .. })
    })
    .await;
    until("the socket", || {
        core.connection() == ConnectionState::Connected
    })
    .await;
    Client { core }
}

async fn server() -> FakeServer {
    FakeServer::start(ScenarioSource::Named("showcase"))
        .await
        .expect("the scenario loads")
}

fn ids(view: &semaphore_core::model::GifResultsView) -> Vec<String> {
    view.results.iter().map(|gif| gif.id.clone()).collect()
}

#[tokio::test]
async fn featured_search_and_paging_over_http() {
    let server = server().await;
    enable_gifs(&server).await;
    let me = signed_in(&server, "me").await;
    // Third-party images are off until the host turns them on (the app's setting): the picker
    // reads nothing meanwhile.
    me.core.set_third_party_media(true);

    // Featured: the fixture GIFs, twenty at a time, on the fake's own address.
    me.core.gifs(String::new());
    until("the featured list", || {
        me.core.gifs(String::new()).state == LoadState::Ready
    })
    .await;
    let featured = me.core.gifs(String::new());
    assert!(featured.enabled);
    assert_eq!(featured.results.len(), 20);
    assert!(featured.more, "thirty fixtures are two pages");
    let first = &featured.results[0];
    assert_eq!(first.id, "gif-1");
    assert_eq!(first.title, "Fixture GIF 1");
    assert!(
        first.url.starts_with(&server.base_url()) && first.url.ends_with("/gif-1.gif"),
        "{}",
        first.url
    );
    assert!(first.preview_url.ends_with("/gif-1-preview.gif"));
    assert_eq!((first.width, first.height), (200, 150));

    // The next page is appended, and the cursor is gone.
    me.core.load_more_gifs(String::new()).await.unwrap();
    let all = me.core.gifs(String::new());
    assert_eq!(all.results.len(), 30);
    assert_eq!(all.results.last().unwrap().id, "gif-30");
    assert!(!all.more);
    assert!(!all.loading_more);

    // A search is its own list; the server cuts long queries and matches titles.
    me.core.gifs("Fixture GIF 7".into());
    until("the search", || {
        me.core.gifs("Fixture GIF 7".into()).state == LoadState::Ready
    })
    .await;
    let found = me.core.gifs("Fixture GIF 7".into());
    assert_eq!(found.query, "Fixture GIF 7");
    assert_eq!(ids(&found), vec!["gif-7"]);
    assert!(!found.more);
    // The featured list stayed where it was.
    assert_eq!(me.core.gifs(String::new()).results.len(), 30);
}
