//! Transport: the Socket.IO session in [`socket`], and the generated REST client later.

pub mod socket;

use std::sync::Once;

use semaphore_core::CoreError;

/// Installs rustls's process-wide crypto provider, once.
///
/// reqwest 0.13 builds rustls without a provider (`rustls-no-provider`) so that adding it
/// does not drag in aws-lc-rs; the provider is chosen here instead, and it has to be
/// installed before the first TLS client or connection is built.
pub fn install_crypto_provider() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        // Already installed by someone else is not an error: the point is that one exists.
        let _ = rustls::crypto::ring::default_provider().install_default();
    });
}

pub fn http_client() -> Result<reqwest::Client, CoreError> {
    install_crypto_provider();
    reqwest::Client::builder()
        .build()
        .map_err(|error| CoreError::Failed {
            message: error.to_string(),
        })
}

/// Opens a raw WebSocket; the Socket.IO framing belongs on top of this.
pub async fn open_websocket(
    url: &str,
) -> Result<
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>,
    CoreError,
> {
    install_crypto_provider();
    let (stream, _) = tokio_tungstenite::connect_async(url)
        .await
        .map_err(|error| CoreError::Failed {
            message: error.to_string(),
        })?;
    Ok(stream)
}
