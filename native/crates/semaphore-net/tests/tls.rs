//! REST and the socket over real TLS, trusting the same roots. A locally generated CA signs the
//! server's certificate, and `SSL_CERT_FILE` makes that CA the OS trust store, the way a self-hoster
//! with a private CA installs theirs. On Linux `rustls-platform-verifier` reads it through
//! `rustls-native-certs`, which reads only that file when the variable is set.
//!
//! The variable has to be set before any verifier is built and before other threads exist, so
//! this binary holds one test. Linux only: other platforms' verifiers ask the OS, not that variable.

#![cfg(target_os = "linux")]

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use rcgen::{BasicConstraints, CertificateParams, DnType, IsCa, Issuer, KeyPair, SanType};
use rustls::pki_types::{CertificateDer, PrivateKeyDer};
use semaphore_core::backend::SessionBackend;
use semaphore_fake_server::{FakeServer, ScenarioSource};
use semaphore_net::socket::{Refresh, SocketClient, SocketConfig, SocketEvent, TokenSource};
use semaphore_net::{HttpBackend, open_websocket};
use semaphore_wire::types as wire;
use tokio::net::{TcpListener, TcpStream};
use tokio_rustls::TlsAcceptor;

struct Ca {
    pem: String,
    issuer: Issuer<'static, KeyPair>,
}

impl Ca {
    fn new(name: &str) -> Self {
        let key = KeyPair::generate().unwrap();
        let mut params = CertificateParams::default();
        params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
        params.distinguished_name.push(DnType::CommonName, name);
        let pem = params.clone().self_signed(&key).unwrap().pem();
        Self {
            pem,
            issuer: Issuer::new(params, key),
        }
    }

    /// A server certificate for `localhost` and `127.0.0.1`, signed by this CA.
    fn server_config(&self) -> Arc<rustls::ServerConfig> {
        let key = KeyPair::generate().unwrap();
        let mut params = CertificateParams::new(vec!["localhost".to_owned()]).unwrap();
        params
            .subject_alt_names
            .push(SanType::IpAddress("127.0.0.1".parse().unwrap()));
        let cert = params.signed_by(&key, &self.issuer).unwrap();
        let chain: Vec<CertificateDer<'static>> = vec![cert.der().clone()];
        let key = PrivateKeyDer::try_from(key.serialize_der()).unwrap();
        Arc::new(
            rustls::ServerConfig::builder()
                .with_no_client_auth()
                .with_single_cert(chain, key)
                .unwrap(),
        )
    }
}

/// Terminates TLS on a local port and passes the bytes to `target`, HTTP and WebSocket alike.
async fn tls_front(config: Arc<rustls::ServerConfig>, target: SocketAddr) -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let acceptor = TlsAcceptor::from(config);
    tokio::spawn(async move {
        while let Ok((stream, _)) = listener.accept().await {
            let acceptor = acceptor.clone();
            tokio::spawn(async move {
                // A client refusing the certificate ends the handshake here.
                let Ok(mut tls) = acceptor.accept(stream).await else {
                    return;
                };
                let Ok(mut upstream) = TcpStream::connect(target).await else {
                    return;
                };
                let _ = tokio::io::copy_bidirectional(&mut tls, &mut upstream).await;
            });
        }
    });
    port
}

struct Tokens;

#[async_trait]
impl TokenSource for Tokens {
    async fn access_token(&self) -> Option<String> {
        Some("fake-access-token".into())
    }
    async fn refresh(&self) -> Refresh {
        Refresh::Unavailable
    }
}

struct NoSecrets;
impl semaphore_core::platform::SecretStore for NoSecrets {
    fn load(&self, _key: String) -> Result<Option<String>, semaphore_core::platform::CoreError> {
        Ok(None)
    }
    fn save(
        &self,
        _key: String,
        _value: String,
    ) -> Result<(), semaphore_core::platform::CoreError> {
        Ok(())
    }
    fn delete(&self, _key: String) -> Result<(), semaphore_core::platform::CoreError> {
        Ok(())
    }
}

async fn login(base: &str) -> Result<wire::LoginResponseDto, String> {
    let backend = HttpBackend::new(Arc::new(NoSecrets));
    backend.set_server_url(base.to_owned());
    backend
        .auth_controller_login(wire::LoginRequestDto {
            username: "me".into(),
            password: "pw".into(),
        })
        .await
        .map_err(|error| error.message)
}

/// The socket session's first event for this server: connected, or refused.
async fn socket_outcome(base: &str) -> SocketEvent {
    let mut config = SocketConfig::new(base);
    config.reconnect_delay = Duration::from_millis(50);
    config.reconnect_delay_max = Duration::from_millis(100);
    let (client, mut events) = SocketClient::start(config, Arc::new(Tokens));
    client.connect();
    let event = tokio::time::timeout(Duration::from_secs(20), async {
        loop {
            match events.recv().await {
                Some(
                    event @ (SocketEvent::Connected { .. } | SocketEvent::ConnectError { .. }),
                ) => return event,
                Some(_) => {}
                None => panic!("the socket ended without connecting or failing"),
            }
        }
    })
    .await
    .expect("the socket neither connected nor failed");
    client.disconnect();
    event
}

fn websocket_url(base: &str) -> String {
    semaphore_core::socketio::websocket_url(base)
}

#[test]
fn rest_and_the_socket_trust_the_os_store_and_nothing_else() {
    semaphore_net::install_crypto_provider();
    let private_ca = Ca::new("Semaphore test private CA");
    let unknown_ca = Ca::new("A CA nobody installed");

    let bundle = std::env::temp_dir().join(format!("semaphore-tls-{}.pem", std::process::id()));
    std::fs::write(&bundle, &private_ca.pem).unwrap();
    // SAFETY: this binary's only test, before its runtime or anything else starts a thread that
    // could read the environment. The harness's own threads don't.
    unsafe {
        std::env::set_var("SSL_CERT_FILE", &bundle);
        std::env::remove_var("SSL_CERT_DIR");
    }

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .unwrap();
    runtime.block_on(async {
        let server = FakeServer::start(ScenarioSource::Named("big-community"))
            .await
            .expect("the scenario loads");
        let target: SocketAddr = server
            .base_url()
            .trim_start_matches("http://")
            .parse()
            .unwrap();
        let trusted = tls_front(private_ca.server_config(), target).await;
        let untrusted = tls_front(unknown_ca.server_config(), target).await;

        // A private CA, by name and by LAN-style address, over both transports.
        for host in ["localhost", "127.0.0.1"] {
            let base = format!("https://{host}:{trusted}");
            assert_eq!(
                websocket_url(&base),
                format!("wss://{host}:{trusted}/socket.io/?EIO=4&transport=websocket")
            );
            login(&base).await.expect("REST trusts the installed CA");
            open_websocket(&websocket_url(&base))
                .await
                .expect("the WebSocket trusts the installed CA");
            let event = socket_outcome(&base).await;
            assert!(
                matches!(event, SocketEvent::Connected { .. }),
                "the socket session trusts the installed CA: {event:?}"
            );
        }

        // The same address and path, with a certificate from a CA the OS doesn't know.
        let base = format!("https://localhost:{untrusted}");
        login(&base).await.expect_err("REST refuses an unknown CA");
        let error = open_websocket(&websocket_url(&base))
            .await
            .expect_err("the WebSocket refuses an unknown CA");
        assert!(
            error.to_string().to_lowercase().contains("certificate"),
            "refused, but not for the certificate: {error}"
        );
        let event = socket_outcome(&base).await;
        assert!(
            matches!(event, SocketEvent::ConnectError { .. }),
            "the socket session refuses an unknown CA: {event:?}"
        );
    });
    drop(runtime);
    let _ = std::fs::remove_file(&bundle);
}
