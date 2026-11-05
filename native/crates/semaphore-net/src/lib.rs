//! Transport: the Socket.IO session in [`socket`], and the generated REST client later.

pub mod socket;

use semaphore_core::CoreError;

pub fn http_client() -> Result<reqwest::Client, CoreError> {
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
    let (stream, _) = tokio_tungstenite::connect_async(url)
        .await
        .map_err(|error| CoreError::Failed {
            message: error.to_string(),
        })?;
    Ok(stream)
}
