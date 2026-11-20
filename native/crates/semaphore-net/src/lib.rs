//! Transport: the Socket.IO session in [`socket`], and the generated REST client later.

pub mod backend;
pub mod ed25519;
pub mod realtime;
pub mod socket;

pub use backend::{ClientInfo, ClientKind, HttpBackend};
pub use realtime::SocketRealtime;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Once, OnceLock};
use std::time::Duration;

use rustls_platform_verifier::ConfigVerifierExt;
use semaphore_core::CoreError;
use tokio_tungstenite::Connector;

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

/// Set by a successful [`init_android`]. Android's verifier panics at its first handshake if the
/// JVM was never handed over, so [`tls_client_config`] refuses to build before this is set.
static ANDROID_INITIALISED: AtomicBool = AtomicBool::new(false);

/// Whether a TLS client may be built: always off Android, and on Android once [`init_android`]
/// succeeded. A function of its inputs so the refusal can be tested on any host.
fn ensure_tls_ready(is_android: bool, initialised: bool) -> Result<(), CoreError> {
    if is_android && !initialised {
        return Err(CoreError::Failed {
            message: "TLS isn't initialised: call init_android first".to_owned(),
        });
    }
    Ok(())
}

/// On Android, hands rustls-platform-verifier the JVM and the application `Context` it reads the
/// system trust store through. Call it once, before the first [`tls_client_config`] (so before any
/// backend makes a request or opens the socket): from then on the verifier is valid for the life
/// of the process, and calling it again does nothing. Until it has succeeded,
/// [`tls_client_config`] (and so every REST client and socket) returns an error.
///
/// `semaphore-mobile`'s `Java_app_semaphorechat_android_NativeLib_nativeInit` is the JNI entry
/// point the app calls; a host that links this crate itself can call this directly.
#[cfg(target_os = "android")]
pub fn init_android(
    env: &mut jni::Env<'_>,
    context: jni::objects::JObject<'_>,
) -> Result<(), jni::errors::Error> {
    rustls_platform_verifier::android::init_with_env(env, context)?;
    ANDROID_INITIALISED.store(true, Ordering::Release);
    Ok(())
}

/// How long the network and the keyring may keep a caller waiting.
#[derive(Clone, Copy, Debug)]
pub struct Timeouts {
    /// To open a connection, TLS included.
    pub connect: Duration,
    /// For each read of a response, restarted by every byte, so a long download is fine while it
    /// moves. Before the response starts this is one deadline from the start of the request,
    /// sending included (reqwest 0.13's `PendingRequest`): an upload that takes longer than this
    /// fails, so uploads, when they arrive, need a client of their own.
    pub read: Duration,
    /// For a whole refresh, and for a whole logout. The refresh gate is held that long at most.
    pub refresh_total: Duration,
    /// For a caller waiting on its own write to the secret store, which stays queued after that.
    pub store_wait: Duration,
}

impl Default for Timeouts {
    fn default() -> Self {
        Self {
            connect: Duration::from_secs(10),
            read: Duration::from_secs(30),
            refresh_total: Duration::from_secs(45),
            store_wait: Duration::from_secs(5),
        }
    }
}

/// The one TLS client configuration, so REST and the socket trust the same certificates: the OS
/// store, through `rustls-platform-verifier`. A self-hoster's private CA, once installed in the
/// OS, works for both. Reads the OS store the first time, then keeps it until the app restarts.
///
/// On Android this is an error until [`init_android`] has succeeded.
pub fn tls_client_config() -> Result<Arc<rustls::ClientConfig>, CoreError> {
    ensure_tls_ready(
        cfg!(target_os = "android"),
        ANDROID_INITIALISED.load(Ordering::Acquire),
    )?;
    static CONFIG: OnceLock<Arc<rustls::ClientConfig>> = OnceLock::new();
    if let Some(config) = CONFIG.get() {
        return Ok(config.clone());
    }
    install_crypto_provider();
    let config =
        rustls::ClientConfig::with_platform_verifier().map_err(|error| CoreError::Failed {
            message: format!("cannot read the system's trusted certificates: {error}"),
        })?;
    Ok(CONFIG.get_or_init(|| Arc::new(config)).clone())
}

/// What every WebSocket connects with. tokio-tungstenite is built with no roots of its own, so a
/// connection that forgets this is refused rather than trusting something else.
pub(crate) fn websocket_connector() -> Result<Connector, CoreError> {
    tls_client_config().map(Connector::Rustls)
}

pub fn http_client() -> Result<reqwest::Client, CoreError> {
    http_client_with_headers(reqwest::header::HeaderMap::new())
}

/// [`http_client`] that sends `headers` on every request. The generated client has no hook for
/// per-request headers, so [`HttpBackend`] builds one per server and per access token.
pub fn http_client_with_headers(
    headers: reqwest::header::HeaderMap,
) -> Result<reqwest::Client, CoreError> {
    http_client_with_timeouts(headers, Timeouts::default())
}

/// [`http_client_with_headers`] with other limits.
pub fn http_client_with_timeouts(
    headers: reqwest::header::HeaderMap,
    timeouts: Timeouts,
) -> Result<reqwest::Client, CoreError> {
    let tls = rustls::ClientConfig::clone(&*tls_client_config()?);
    reqwest::Client::builder()
        .default_headers(headers)
        .tls_backend_preconfigured(tls)
        .connect_timeout(timeouts.connect)
        .read_timeout(timeouts.read)
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
    let connector = websocket_connector()?;
    let (stream, _) =
        tokio_tungstenite::connect_async_tls_with_config(url, None, false, Some(connector))
            .await
            .map_err(|error| CoreError::Failed {
                message: error.to_string(),
            })?;
    Ok(stream)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn android_refuses_a_tls_client_before_init() {
        let Err(CoreError::Failed { message }) = ensure_tls_ready(true, false) else {
            panic!("expected a refusal");
        };
        assert!(message.contains("init_android"), "{message}");
    }

    #[test]
    fn android_allows_a_tls_client_after_init() {
        assert!(ensure_tls_ready(true, true).is_ok());
    }

    #[test]
    fn other_targets_never_need_init() {
        assert!(ensure_tls_ready(false, false).is_ok());
    }
}
