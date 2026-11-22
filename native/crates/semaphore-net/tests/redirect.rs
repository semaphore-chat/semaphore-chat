//! A redirect from `https` to `http` is never followed: the request's password or token would be
//! sent again in plain text. A local TLS server answers 307 with an `http://` Location, and a
//! plain listener stands in for that target and counts who connects. The CA goes in through
//! `SSL_CERT_FILE` the way `tls.rs` does it, so this binary holds one test.

#![cfg(target_os = "linux")]

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use rcgen::{BasicConstraints, CertificateParams, DnType, IsCa, Issuer, KeyPair, SanType};
use rustls::pki_types::{CertificateDer, PrivateKeyDer};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio_rustls::TlsAcceptor;

#[test]
fn a_redirect_from_https_to_http_is_not_followed() {
    semaphore_net::install_crypto_provider();
    let ca_key = KeyPair::generate().unwrap();
    let mut ca_params = CertificateParams::default();
    ca_params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
    ca_params
        .distinguished_name
        .push(DnType::CommonName, "Redirect test CA");
    let pem = ca_params.clone().self_signed(&ca_key).unwrap().pem();
    let issuer = Issuer::new(ca_params, ca_key);

    let bundle =
        std::env::temp_dir().join(format!("semaphore-redirect-{}.pem", std::process::id()));
    std::fs::write(&bundle, &pem).unwrap();
    // SAFETY: this binary's only test, before its runtime starts any thread that reads the
    // environment.
    unsafe {
        std::env::set_var("SSL_CERT_FILE", &bundle);
        std::env::remove_var("SSL_CERT_DIR");
    }

    let key = KeyPair::generate().unwrap();
    let mut params = CertificateParams::new(vec!["localhost".to_owned()]).unwrap();
    params
        .subject_alt_names
        .push(SanType::IpAddress("127.0.0.1".parse().unwrap()));
    let cert = params.signed_by(&key, &issuer).unwrap();
    let chain: Vec<CertificateDer<'static>> = vec![cert.der().clone()];
    let server_key = PrivateKeyDer::try_from(key.serialize_der()).unwrap();
    let config = Arc::new(
        rustls::ServerConfig::builder()
            .with_no_client_auth()
            .with_single_cert(chain, server_key)
            .unwrap(),
    );

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .unwrap();
    runtime.block_on(async {
        // The plain-HTTP target of the redirect.
        let plain = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let plain_port = plain.local_addr().unwrap().port();
        let plain_hits = Arc::new(AtomicUsize::new(0));
        let hits = plain_hits.clone();
        tokio::spawn(async move {
            while let Ok((mut stream, _)) = plain.accept().await {
                hits.fetch_add(1, Ordering::SeqCst);
                let _ = stream
                    .write_all(b"HTTP/1.1 200 OK\r\ncontent-length: 0\r\nconnection: close\r\n\r\n")
                    .await;
            }
        });

        // The HTTPS server: every request is a 307 to the plain one.
        let tls = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let tls_port = tls.local_addr().unwrap().port();
        let acceptor = TlsAcceptor::from(config);
        tokio::spawn(async move {
            while let Ok((stream, _)) = tls.accept().await {
                let acceptor = acceptor.clone();
                tokio::spawn(async move {
                    let Ok(mut stream) = acceptor.accept(stream).await else {
                        return;
                    };
                    let mut buffer = [0u8; 4096];
                    let _ = stream.read(&mut buffer).await;
                    let reply = format!(
                        "HTTP/1.1 307 Temporary Redirect\r\nlocation: http://127.0.0.1:{plain_port}/login\r\ncontent-length: 0\r\nconnection: close\r\n\r\n"
                    );
                    let _ = stream.write_all(reply.as_bytes()).await;
                    let _ = stream.shutdown().await;
                });
            }
        });

        let client = semaphore_net::http_client().unwrap();
        let outcome = client
            .post(format!("https://127.0.0.1:{tls_port}/api/auth/login"))
            .body("password=hunter2")
            .send()
            .await;
        // Either the 307 itself comes back or the request fails; the client never follows it.
        if let Ok(response) = outcome {
            assert_eq!(response.status().as_u16(), 307);
        }
        assert_eq!(
            plain_hits.load(Ordering::SeqCst),
            0,
            "the client followed a redirect from https to http"
        );
    });
}
