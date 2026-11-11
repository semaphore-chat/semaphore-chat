//! Files the UI draws: attachments, avatars, custom emoji and, when allowed, link-preview images.
//!
//! - **Fetching** goes through `Core::file` (the session's auth and refresh) on the net runtime, or
//!   for preview images through [`PreviewFetcher`], never on the UI thread.
//! - **Encoded bytes** live in one in-memory LRU, [`FileStore`], bounded at [`STORE_BUDGET_BYTES`].
//!   Nothing is written to disk.
//! - **Decoding** is GPUI's: [`AppAssets`] serves the store's bytes under `semaphore-file/`, and
//!   `ImageCacheItem` loads them on its background executor into the list's bounded caches.
//! - **Untrusted images are checked before anyone decodes them**: past [`MAX_IMAGE_BYTES`] or
//!   [`MAX_IMAGE_PIXELS`] (less for animated formats, whose frames multiply) they're refused, and
//!   the UI draws the file row or the initials instead.

use crate::runtime::Exec;
use gpui_kit::{AssetSource, Resource, SharedString};
use semaphore_core::Core;
use semaphore_core::model::{AttachmentKind, AttachmentView};
use semaphore_ui::kit::UiAssets;
use semaphore_ui::messages::{MediaRef, MediaSource};
use std::borrow::Cow;
use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

/// Encoded bytes kept, across every kind of file.
pub const STORE_BUDGET_BYTES: usize = 64 * 1024 * 1024;
/// An image file bigger than this isn't decoded at all.
pub const MAX_IMAGE_BYTES: usize = 16 * 1024 * 1024;
/// Pixels in one frame of a still image, past which it isn't decoded: 64 megapixels is about
/// 256 MB of RGBA, twice the decoded cache's whole budget.
pub const MAX_IMAGE_PIXELS: u64 = 64_000_000;
/// For GIF and WebP, which GPUI decodes every frame of up front.
pub const MAX_ANIMATED_PIXELS: u64 = 4_000_000;
/// The prefix `AppAssets` serves from the store.
pub const ASSET_PREFIX: &str = "semaphore-file/";

/// Why an image won't be decoded.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Refusal {
    TooManyBytes(usize),
    TooManyPixels(u64),
    NotAnImage,
}

/// Whether bytes are an image small enough to decode, from the header alone.
pub fn decodable(bytes: &[u8]) -> Result<(), Refusal> {
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err(Refusal::TooManyBytes(bytes.len()));
    }
    let reader = image::ImageReader::new(std::io::Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|_| Refusal::NotAnImage)?;
    let format = reader.format().ok_or(Refusal::NotAnImage)?;
    let (width, height) = reader.into_dimensions().map_err(|_| Refusal::NotAnImage)?;
    let pixels = u64::from(width) * u64::from(height);
    let limit = match format {
        image::ImageFormat::Gif | image::ImageFormat::WebP => MAX_ANIMATED_PIXELS,
        _ => MAX_IMAGE_PIXELS,
    };
    if pixels > limit {
        return Err(Refusal::TooManyPixels(pixels));
    }
    Ok(())
}

enum Slot {
    Fetching,
    Ready {
        bytes: Arc<Vec<u8>>,
        used: u64,
    },
    /// Refused or failed: not asked for again until the store is cleared.
    Unavailable,
}

/// The encoded bytes of everything drawn, by asset path, least recently used first out.
#[derive(Default)]
pub struct FileStore {
    inner: Mutex<StoreInner>,
}

#[derive(Default)]
struct StoreInner {
    slots: HashMap<String, Slot>,
    bytes: usize,
    tick: u64,
}

/// What the store has for a path.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Have {
    Ready,
    Fetching,
    Unavailable,
    Nothing,
}

impl FileStore {
    fn lock(&self) -> std::sync::MutexGuard<'_, StoreInner> {
        self.inner.lock().unwrap_or_else(|p| p.into_inner())
    }

    pub fn have(&self, path: &str) -> Have {
        match self.lock().slots.get(path) {
            Some(Slot::Ready { .. }) => Have::Ready,
            Some(Slot::Fetching) => Have::Fetching,
            Some(Slot::Unavailable) => Have::Unavailable,
            None => Have::Nothing,
        }
    }

    /// Marks a path as being fetched. False if it's already here or on its way.
    pub fn begin(&self, path: &str) -> bool {
        let mut inner = self.lock();
        if inner.slots.contains_key(path) {
            return false;
        }
        inner.slots.insert(path.to_owned(), Slot::Fetching);
        true
    }

    /// Takes a fetch's answer, refusing an image that's too big to decode.
    pub fn finish(&self, path: &str, fetched: Result<Vec<u8>, String>) {
        let accepted = fetched.and_then(|bytes| match decodable(&bytes) {
            Ok(()) => Ok(bytes),
            Err(refusal) => Err(format!("{refusal:?}")),
        });
        let mut inner = self.lock();
        match accepted {
            Ok(bytes) => {
                inner.tick += 1;
                inner.bytes += bytes.len();
                let used = inner.tick;
                let previous = inner.slots.insert(
                    path.to_owned(),
                    Slot::Ready {
                        bytes: Arc::new(bytes),
                        used,
                    },
                );
                if let Some(Slot::Ready { bytes, .. }) = previous {
                    inner.bytes -= bytes.len();
                }
                Self::evict(&mut inner, path);
            }
            Err(reason) => {
                log::info!("not drawing {path}: {reason}");
                inner.slots.insert(path.to_owned(), Slot::Unavailable);
            }
        }
    }

    /// Drops the least recently used until the budget holds, never `keep`.
    fn evict(inner: &mut StoreInner, keep: &str) {
        while inner.bytes > STORE_BUDGET_BYTES {
            let victim = inner
                .slots
                .iter()
                .filter(|(path, _)| path.as_str() != keep)
                .filter_map(|(path, slot)| match slot {
                    Slot::Ready { used, .. } => Some((*used, path.clone())),
                    _ => None,
                })
                .min();
            let Some((_, victim)) = victim else {
                return;
            };
            if let Some(Slot::Ready { bytes, .. }) = inner.slots.remove(&victim) {
                inner.bytes -= bytes.len();
            }
        }
    }

    pub fn get(&self, path: &str) -> Option<Arc<Vec<u8>>> {
        let mut inner = self.lock();
        inner.tick += 1;
        let tick = inner.tick;
        match inner.slots.get_mut(path) {
            Some(Slot::Ready { bytes, used }) => {
                *used = tick;
                Some(bytes.clone())
            }
            _ => None,
        }
    }

    pub fn bytes(&self) -> usize {
        self.lock().bytes
    }

    /// Fetches still on their way: the rig waits for none before a screenshot.
    pub fn fetching(&self) -> usize {
        self.lock()
            .slots
            .values()
            .filter(|slot| matches!(slot, Slot::Fetching))
            .count()
    }

    /// Everything goes: a sign-out must not leave the last session's files in memory.
    pub fn clear(&self) {
        let mut inner = self.lock();
        inner.slots.clear();
        inner.bytes = 0;
    }
}

/// The one store, which the asset source GPUI was built with reads.
pub fn store() -> Arc<FileStore> {
    static STORE: OnceLock<Arc<FileStore>> = OnceLock::new();
    STORE.get_or_init(Arc::default).clone()
}

/// `UiAssets`, plus the store's files under [`ASSET_PREFIX`].
pub struct AppAssets;

impl AssetSource for AppAssets {
    fn load(&self, path: &str) -> gpui_kit::Result<Option<Cow<'static, [u8]>>> {
        if path.starts_with(ASSET_PREFIX) {
            // GPUI calls this from its background executor: a debug log shows which thread.
            log::trace!(
                "serving {path} on {:?}",
                std::thread::current().name().unwrap_or("unnamed")
            );
            return Ok(store().get(path).map(|bytes| Cow::Owned((*bytes).clone())));
        }
        UiAssets.load(path)
    }

    fn list(&self, path: &str) -> gpui_kit::Result<Vec<SharedString>> {
        UiAssets.list(path)
    }
}

fn file_path(file_id: &str, thumbnail: bool) -> String {
    format!(
        "{ASSET_PREFIX}{}/{file_id}",
        if thumbnail { "thumbnail" } else { "file" }
    )
}

fn link_path(url: &str) -> String {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    url.hash(&mut hasher);
    format!("{ASSET_PREFIX}link/{:016x}", hasher.finish())
}

fn resource(path: String) -> MediaRef {
    MediaRef::Resource(Resource::Embedded(path.into()))
}

/// Third-party images for link previews: fetched only when allowed, and then only images, over
/// http or https, a few redirects deep, with a byte cap and a deadline, and with nothing of the
/// session (no cookies, no auth, a generic user agent).
pub struct PreviewFetcher {
    allowed: bool,
    pub requests: AtomicUsize,
    client: OnceLock<Option<reqwest::Client>>,
}

/// What a preview fetch may take.
pub const PREVIEW_MAX_BYTES: usize = 5 * 1024 * 1024;
pub const PREVIEW_TIMEOUT: Duration = Duration::from_secs(10);
pub const PREVIEW_MAX_REDIRECTS: usize = 3;

impl PreviewFetcher {
    pub fn new(allowed: bool) -> Self {
        Self {
            allowed,
            requests: AtomicUsize::new(0),
            client: OnceLock::new(),
        }
    }

    pub fn allowed(&self) -> bool {
        self.allowed
    }

    fn client(&self) -> Option<reqwest::Client> {
        self.client
            .get_or_init(|| {
                let tls = semaphore_net::tls_client_config().ok()?;
                reqwest::Client::builder()
                    .tls_backend_preconfigured(rustls::ClientConfig::clone(&tls))
                    .user_agent("Mozilla/5.0 (compatible; link preview)")
                    .redirect(reqwest::redirect::Policy::custom(|attempt| {
                        let scheme_ok = matches!(attempt.url().scheme(), "http" | "https");
                        if !scheme_ok {
                            attempt.error("a redirect left http and https")
                        } else if attempt.previous().len() > PREVIEW_MAX_REDIRECTS {
                            attempt.error("too many redirects")
                        } else {
                            attempt.follow()
                        }
                    }))
                    .connect_timeout(PREVIEW_TIMEOUT)
                    .timeout(PREVIEW_TIMEOUT)
                    .build()
                    .ok()
            })
            .clone()
    }

    /// The image at `url`, or why not. Makes no request unless allowed and the URL is http(s).
    pub async fn fetch(&self, url: &str) -> Result<Vec<u8>, String> {
        if !self.allowed {
            return Err("link preview images are off".into());
        }
        let parsed = reqwest::Url::parse(url).map_err(|error| error.to_string())?;
        if !matches!(parsed.scheme(), "http" | "https") {
            return Err(format!("not fetching a {} URL", parsed.scheme()));
        }
        let client = self.client().ok_or("no HTTP client")?;
        self.requests.fetch_add(1, Ordering::SeqCst);
        let response = client
            .get(parsed)
            .send()
            .await
            .map_err(|error| error.to_string())?;
        if !response.status().is_success() {
            return Err(format!("status {}", response.status()));
        }
        let is_image = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| value.trim().to_ascii_lowercase().starts_with("image/"));
        if !is_image {
            return Err("not an image".into());
        }
        if response
            .content_length()
            .is_some_and(|length| length > PREVIEW_MAX_BYTES as u64)
        {
            return Err("too big".into());
        }
        let mut body = Vec::new();
        let mut stream = response.bytes_stream();
        use futures_util::StreamExt as _;
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|error| error.to_string())?;
            if body.len() + chunk.len() > PREVIEW_MAX_BYTES {
                return Err("too big".into());
            }
            body.extend_from_slice(&chunk);
        }
        Ok(body)
    }
}

/// The list's `MediaSource` over the store: what's here is a resource GPUI decodes off the UI
/// thread; what isn't is fetched once, and `Pending` until then.
pub struct AppMedia {
    pub core: Arc<Core>,
    pub exec: Exec,
    pub store: Arc<FileStore>,
    pub previews: Arc<PreviewFetcher>,
    /// Redraw once a fetch lands.
    pub arrived: async_channel::Sender<()>,
    /// The community whose custom emoji the list shows.
    pub community: RefCell<Option<String>>,
}

impl AppMedia {
    fn fetch_file(&self, path: String, file_id: String, thumbnail: bool) -> MediaRef {
        match self.store.have(&path) {
            Have::Ready => return resource(path),
            Have::Unavailable => return MediaRef::Missing,
            Have::Fetching => return MediaRef::Pending,
            Have::Nothing => {}
        }
        if self.store.begin(&path) {
            let (core, store, arrived) =
                (self.core.clone(), self.store.clone(), self.arrived.clone());
            let handle = self.exec.handle().clone();
            self.exec.fire(async move {
                let fetched = core
                    .file(file_id, thumbnail)
                    .await
                    .map_err(|error| error.to_string());
                // The header check reads a little of the image: off the async workers.
                let _ = handle
                    .spawn_blocking(move || store.finish(&path, fetched))
                    .await;
                let _ = arrived.try_send(());
            });
        }
        MediaRef::Pending
    }

    /// An image attachment at full size, for the viewer.
    pub fn full_image(&self, attachment: &AttachmentView) -> MediaRef {
        self.fetch_file(
            file_path(&attachment.file_id, false),
            attachment.file_id.clone(),
            false,
        )
    }

    /// For avatars drawn outside the list: a resource once the bytes are here, fetching them if not.
    pub fn avatar_resource(&self, file_id: &str) -> Option<Resource> {
        match self.avatar(file_id) {
            MediaRef::Resource(resource) => Some(resource),
            _ => None,
        }
    }
}

impl MediaSource for AppMedia {
    fn attachment(&self, attachment: &AttachmentView) -> MediaRef {
        if attachment.kind != AttachmentKind::Image {
            return MediaRef::Missing;
        }
        let thumbnail = attachment.has_thumbnail;
        self.fetch_file(
            file_path(&attachment.file_id, thumbnail),
            attachment.file_id.clone(),
            thumbnail,
        )
    }

    fn emoji(&self, emoji_id: &str) -> MediaRef {
        let Some(community) = self.community.borrow().clone() else {
            return MediaRef::Missing;
        };
        let file_id = self
            .core
            .custom_emojis(community)
            .into_iter()
            .find(|emoji| emoji.id == emoji_id)
            .map(|emoji| emoji.file_id);
        match file_id {
            Some(file_id) => self.fetch_file(file_path(&file_id, false), file_id, false),
            None => MediaRef::Missing,
        }
    }

    fn avatar(&self, file_id: &str) -> MediaRef {
        self.fetch_file(file_path(file_id, false), file_id.to_owned(), false)
    }

    fn link_image(&self, url: &str) -> MediaRef {
        if !self.previews.allowed() {
            return MediaRef::Missing;
        }
        let path = link_path(url);
        match self.store.have(&path) {
            Have::Ready => return resource(path),
            Have::Unavailable => return MediaRef::Missing,
            Have::Fetching => return MediaRef::Pending,
            Have::Nothing => {}
        }
        if self.store.begin(&path) {
            let (previews, store, arrived) = (
                self.previews.clone(),
                self.store.clone(),
                self.arrived.clone(),
            );
            let handle = self.exec.handle().clone();
            let url = url.to_owned();
            self.exec.fire(async move {
                let fetched = previews.fetch(&url).await;
                let _ = handle
                    .spawn_blocking(move || store.finish(&path, fetched))
                    .await;
                let _ = arrived.try_send(());
            });
        }
        MediaRef::Pending
    }
}

/// A server's file name, made safe to suggest in a save dialog: the last path component only, no
/// leading dots, no control characters, at most 100 characters.
pub fn safe_file_name(name: &str) -> String {
    let last = name.rsplit(['/', '\\']).next().unwrap_or_default();
    let cleaned: String = last
        .chars()
        .filter(|c| !c.is_control() && !matches!(c, ':' | '*' | '?' | '"' | '<' | '>' | '|'))
        .collect();
    let trimmed = cleaned.trim().trim_start_matches('.').trim();
    let bounded: String = trimmed.chars().take(100).collect();
    if bounded.is_empty() {
        "download".into()
    } else {
        bounded
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::prelude::rust_2024::test;

    /// A PNG's signature and IHDR claiming `width` x `height`: enough for a header read.
    fn png_header(width: u32, height: u32) -> Vec<u8> {
        let mut bytes = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
        let mut ihdr = Vec::new();
        ihdr.extend_from_slice(b"IHDR");
        ihdr.extend_from_slice(&width.to_be_bytes());
        ihdr.extend_from_slice(&height.to_be_bytes());
        ihdr.extend_from_slice(&[8, 6, 0, 0, 0]);
        bytes.extend_from_slice(&13u32.to_be_bytes());
        bytes.extend_from_slice(&ihdr);
        bytes.extend_from_slice(&crc32(&ihdr).to_be_bytes());
        // An empty IDAT, so a reader that looks for the image data before answering finds it.
        for chunk in [b"IDAT", b"IEND"] {
            bytes.extend_from_slice(&0u32.to_be_bytes());
            bytes.extend_from_slice(chunk);
            bytes.extend_from_slice(&crc32(chunk).to_be_bytes());
        }
        bytes
    }

    fn crc32(data: &[u8]) -> u32 {
        let mut crc = 0xFFFF_FFFFu32;
        for byte in data {
            crc ^= u32::from(*byte);
            for _ in 0..8 {
                crc = if crc & 1 == 1 {
                    (crc >> 1) ^ 0xEDB8_8320
                } else {
                    crc >> 1
                };
            }
        }
        !crc
    }

    #[test]
    fn an_image_claiming_too_many_pixels_is_refused_before_decoding() {
        assert_eq!(decodable(&png_header(64, 64)), Ok(()));
        assert_eq!(
            decodable(&png_header(10_000, 10_000)),
            Err(Refusal::TooManyPixels(100_000_000))
        );
        assert_eq!(decodable(b"not an image at all"), Err(Refusal::NotAnImage));
        let huge = vec![0u8; MAX_IMAGE_BYTES + 1];
        assert_eq!(
            decodable(&huge),
            Err(Refusal::TooManyBytes(MAX_IMAGE_BYTES + 1))
        );
    }

    #[test]
    fn the_store_refuses_oversized_images_and_stays_within_its_budget() {
        let store = FileStore::default();
        assert!(store.begin("a"));
        assert!(!store.begin("a"), "once per path");
        store.finish("a", Ok(png_header(10_000, 10_000)));
        assert_eq!(store.have("a"), Have::Unavailable);
        assert!(store.get("a").is_none());

        // Real PNGs aren't needed for the budget: the header passes, the rest is padding.
        let mut big = png_header(100, 100);
        big.resize(MAX_IMAGE_BYTES - 1024, 0);
        for name in ["p", "q", "r", "s", "t"] {
            store.begin(name);
            store.finish(name, Ok(big.clone()));
        }
        assert!(store.bytes() <= STORE_BUDGET_BYTES);
        assert_eq!(store.have("p"), Have::Nothing, "the oldest went first");
        assert_eq!(store.have("t"), Have::Ready);
        store.clear();
        assert_eq!(store.bytes(), 0);
    }

    #[test]
    fn save_names_lose_paths_dots_and_length() {
        assert_eq!(safe_file_name("../../etc/passwd"), "passwd");
        assert_eq!(safe_file_name("C:\\x\\report.pdf"), "report.pdf");
        assert_eq!(safe_file_name(".bashrc"), "bashrc");
        assert_eq!(safe_file_name("..."), "download");
        assert_eq!(safe_file_name("a\u{0}b?.txt"), "ab.txt");
        assert_eq!(safe_file_name(&"x".repeat(300)).chars().count(), 100);
    }

    /// One canned HTTP answer per connection, for the fetcher's limits.
    async fn serve(answers: Vec<String>) -> (String, Arc<AtomicUsize>) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let hits = Arc::new(AtomicUsize::new(0));
        let counted = hits.clone();
        tokio::spawn(async move {
            for answer in answers {
                let Ok((mut stream, _)) = listener.accept().await else {
                    return;
                };
                counted.fetch_add(1, Ordering::SeqCst);
                let mut buffer = [0u8; 4096];
                let _ = stream.read(&mut buffer).await;
                let _ = stream.write_all(answer.as_bytes()).await;
            }
        });
        (format!("http://{address}"), hits)
    }

    fn answer(status: &str, content_type: &str, body: &str) -> String {
        format!(
            "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        )
    }

    #[tokio::test]
    async fn with_the_switch_off_no_request_is_made() {
        let (url, hits) = serve(vec![answer("200 OK", "image/png", "x")]).await;
        let fetcher = PreviewFetcher::new(false);
        assert!(fetcher.fetch(&format!("{url}/a.png")).await.is_err());
        assert_eq!(fetcher.requests.load(Ordering::SeqCst), 0);
        assert_eq!(hits.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn only_http_images_under_the_cap_come_back() {
        semaphore_net::install_crypto_provider();
        let fetcher = PreviewFetcher::new(true);
        assert!(fetcher.fetch("data:image/png;base64,AAAA").await.is_err());
        assert!(fetcher.fetch("file:///etc/passwd").await.is_err());
        assert_eq!(
            fetcher.requests.load(Ordering::SeqCst),
            0,
            "no request for those"
        );

        let (url, _) = serve(vec![answer("200 OK", "image/png", "pixels")]).await;
        assert_eq!(
            fetcher.fetch(&format!("{url}/a.png")).await.unwrap(),
            b"pixels"
        );

        let (url, _) = serve(vec![answer("200 OK", "text/html", "<html>")]).await;
        assert!(fetcher.fetch(&format!("{url}/page")).await.is_err());

        let big = "x".repeat(PREVIEW_MAX_BYTES + 1);
        let (url, _) = serve(vec![answer("200 OK", "image/png", &big)]).await;
        assert!(fetcher.fetch(&format!("{url}/big.png")).await.is_err());
    }

    #[tokio::test]
    async fn redirects_stop_after_three() {
        semaphore_net::install_crypto_provider();
        let (url, hits) = serve(vec![]).await;
        drop(hits);
        let redirect = |to: &str| {
            format!(
                "HTTP/1.1 302 Found\r\nLocation: {to}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            )
        };
        let _ = url;
        // Five hops, each to the same server: the fourth redirect is refused.
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let base = format!("http://{address}");
        let answers: Vec<String> = (0..5).map(|n| redirect(&format!("{base}/{n}"))).collect();
        let hops = Arc::new(AtomicUsize::new(0));
        let counted = hops.clone();
        tokio::spawn(async move {
            use tokio::io::{AsyncReadExt, AsyncWriteExt};
            for answer in answers {
                let Ok((mut stream, _)) = listener.accept().await else {
                    return;
                };
                counted.fetch_add(1, Ordering::SeqCst);
                let mut buffer = [0u8; 4096];
                let _ = stream.read(&mut buffer).await;
                let _ = stream.write_all(answer.as_bytes()).await;
            }
        });
        let fetcher = PreviewFetcher::new(true);
        assert!(fetcher.fetch(&format!("{base}/start")).await.is_err());
        assert_eq!(hops.load(Ordering::SeqCst), PREVIEW_MAX_REDIRECTS + 1);
    }
}
