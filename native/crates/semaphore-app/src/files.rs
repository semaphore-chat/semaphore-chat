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
//! - **Pictures from other sites** (link-preview images, GIFs and the GIF picker's previews) go
//!   through one entry point, [`third_party`], which refuses while the "Load images from other
//!   sites" setting is off before it looks anywhere: no request, nothing served from the store.
//!   Turning the setting off drops what was kept ([`set_third_party`]) and any fetch still on its
//!   way.
//! - **Every image passes the frame budget** ([`budget`]) in [`FileStore::finish`] before it's
//!   kept: GPUI decodes every frame of a GIF or WebP up front, whoever sent it.
//! - **Video posters** are the server's thumbnails, through the same store ([`poster_resolver`]).
//! - **Saving** a download asks where with the system's save dialog ([`ask_save_path`]), then
//!   writes off the UI thread ([`write_file`]). The rigs' headless platform never answers that
//!   dialog, so nothing is saved, or shown, on the machine running them.

pub mod budget;
pub mod destinations;

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

    /// Takes a fetch's answer, refusing an image that's too big to decode and passing every image
    /// (avatars, custom emoji, attachments, pictures from other sites) through the frame budget
    /// ([`budget::within_budget`]): kept, frame 0 alone, or refused. Reads headers only, unless
    /// frame 0 must be re-encoded: call it off the async workers.
    pub fn finish(&self, path: &str, fetched: Result<Vec<u8>, String>) {
        let accepted = fetched
            .and_then(|bytes| match decodable(&bytes) {
                Ok(()) => Ok(bytes),
                Err(refusal) => Err(format!("{refusal:?}")),
            })
            .and_then(budget::within_budget);
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

    /// Forgets one path, whatever state it's in: a fetch whose answer is no longer wanted.
    pub fn forget(&self, path: &str) {
        let mut inner = self.lock();
        if let Some(Slot::Ready { bytes, .. }) = inner.slots.remove(path) {
            inner.bytes -= bytes.len();
        }
    }

    /// Drops every third-party picture kept or refused, leaving fetches on their way to drop
    /// themselves when they land (see [`third_party`]).
    pub fn purge_third_party(&self) {
        let mut inner = self.lock();
        let gone: Vec<String> = inner
            .slots
            .iter()
            .filter(|(path, slot)| is_third_party_path(path) && !matches!(slot, Slot::Fetching))
            .map(|(path, _)| path.clone())
            .collect();
        for path in gone {
            if let Some(Slot::Ready { bytes, .. }) = inner.slots.remove(&path) {
                inner.bytes -= bytes.len();
            }
        }
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

/// A picture from another site: which cap it fetches under and where the store keeps it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ThirdPartyKind {
    /// A link preview's picture.
    LinkImage,
    /// A GIF from the GIF service: a GIF message's picture or a picker preview.
    Gif,
}

impl ThirdPartyKind {
    fn folder(self) -> &'static str {
        match self {
            Self::LinkImage => "link",
            Self::Gif => "gif",
        }
    }

    fn max_bytes(self) -> usize {
        match self {
            Self::LinkImage => PREVIEW_MAX_BYTES,
            Self::Gif => GIF_MAX_BYTES,
        }
    }
}

fn third_party_path(kind: ThirdPartyKind, url: &str) -> String {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    url.hash(&mut hasher);
    format!("{ASSET_PREFIX}{}/{:016x}", kind.folder(), hasher.finish())
}

fn is_third_party_path(path: &str) -> bool {
    [ThirdPartyKind::LinkImage, ThirdPartyKind::Gif]
        .iter()
        .any(|kind| {
            path.strip_prefix(ASSET_PREFIX)
                .and_then(|rest| rest.strip_prefix(kind.folder()))
                .is_some_and(|rest| rest.starts_with('/'))
        })
}

/// Top-level names that can never resolve (RFC 2606 / 6761): asking for one would only send a
/// DNS query out for nothing (the showcase scenario's GIFs live on `media.gifs.example`).
const NEVER_RESOLVES: [&str; 3] = ["example", "invalid", "test"];

/// Whether `url` is one a third-party fetch may ask for at all: http or https, to a host that
/// can exist.
fn fetchable_url(url: &reqwest::Url) -> bool {
    if !matches!(url.scheme(), "http" | "https") {
        return false;
    }
    // `domain` is `None` for an IP address, which is fine as it is.
    match url.domain() {
        Some(domain) => {
            let last = domain
                .trim_end_matches('.')
                .rsplit('.')
                .next()
                .unwrap_or("");
            !NEVER_RESOLVES
                .iter()
                .any(|reserved| last.eq_ignore_ascii_case(reserved))
        }
        None => url.host_str().is_some(),
    }
}

fn fetchable(url: &str) -> bool {
    reqwest::Url::parse(url).is_ok_and(|url| fetchable_url(&url))
}

/// THE entry point for pictures from other sites. While the setting is off it answers `Missing`
/// before looking anywhere: no request, and nothing kept from before is served. While it is on,
/// only http(s) URLs are fetched, once, under the kind's byte cap; animated ones pass the frame
/// budget; an answer that lands after the setting went off is dropped, not kept.
pub fn third_party(
    previews: &Arc<PreviewFetcher>,
    store: &Arc<FileStore>,
    exec: &Exec,
    arrived: &async_channel::Sender<()>,
    kind: ThirdPartyKind,
    url: &str,
) -> MediaRef {
    if !previews.allowed() || !fetchable(url) {
        return MediaRef::Missing;
    }
    let path = third_party_path(kind, url);
    match store.have(&path) {
        Have::Ready => return resource(path),
        Have::Unavailable => return MediaRef::Missing,
        Have::Fetching => return MediaRef::Pending,
        Have::Nothing => {}
    }
    if store.begin(&path) {
        let (previews, store, arrived) = (previews.clone(), store.clone(), arrived.clone());
        let handle = exec.handle().clone();
        let url = url.to_owned();
        exec.fire(async move {
            let fetched = previews.fetch_limited(&url, kind.max_bytes()).await;
            let _ = handle
                .spawn_blocking(move || {
                    if previews.allowed() {
                        // The budget reads the header, and may decode one frame: off the workers.
                        store.finish(&path, fetched);
                    } else {
                        store.forget(&path);
                    }
                })
                .await;
            let _ = arrived.try_send(());
        });
    }
    MediaRef::Pending
}

/// The switch changed: the fetcher follows it, and turning it off drops every picture from another
/// site kept so far.
pub fn set_third_party(previews: &PreviewFetcher, store: &FileStore, on: bool) {
    previews.set_allowed(on);
    if !on {
        store.purge_third_party();
    }
}

fn resource(path: String) -> MediaRef {
    MediaRef::Resource(Resource::Embedded(path.into()))
}

/// Third-party images for link previews: fetched only when allowed, and then only images, over
/// http or https, a few redirects deep, with a byte cap and a deadline, and with nothing of the
/// session (no cookies, no auth, a generic user agent).
pub struct PreviewFetcher {
    /// The settings' link preview images switch, as it is now.
    allowed: std::sync::atomic::AtomicBool,
    pub requests: AtomicUsize,
    client: OnceLock<Option<reqwest::Client>>,
    /// Where it may connect: public addresses only, but in the rig ([`destinations`]).
    destinations: destinations::Destinations,
}

/// What a preview fetch may take.
pub const PREVIEW_MAX_BYTES: usize = 5 * 1024 * 1024;
/// What a GIF fetch may take: 16 MiB, the most the store decodes at all ([`MAX_IMAGE_BYTES`]).
/// GIF files are far bigger than link-preview pictures for what they show, and the GIF service's
/// full-size renditions often pass 5 MiB; past 16 MiB the frame budget would show only the first
/// frame of almost any of them anyway.
pub const GIF_MAX_BYTES: usize = 16 * 1024 * 1024;
const _: () = assert!(
    GIF_MAX_BYTES <= MAX_IMAGE_BYTES,
    "a GIF fetched must be decodable"
);
pub const PREVIEW_TIMEOUT: Duration = Duration::from_secs(10);
pub const PREVIEW_MAX_REDIRECTS: usize = 3;

impl PreviewFetcher {
    /// A fetcher that reaches public addresses only.
    pub fn new(allowed: bool) -> Self {
        Self::with_destinations(allowed, destinations::Destinations::PublicOnly)
    }

    /// A fetcher with its own destination rule: `AlsoPrivate` only for the rig
    /// (`AppConfig::media_allow_private`).
    pub fn with_destinations(allowed: bool, destinations: destinations::Destinations) -> Self {
        Self {
            allowed: std::sync::atomic::AtomicBool::new(allowed),
            requests: AtomicUsize::new(0),
            client: OnceLock::new(),
            destinations,
        }
    }

    pub fn allowed(&self) -> bool {
        self.allowed.load(Ordering::Relaxed)
    }

    /// The switch changed: images load (or stop loading) from the next preview drawn.
    pub fn set_allowed(&self, allowed: bool) {
        self.allowed.store(allowed, Ordering::Relaxed);
    }

    fn client(&self) -> Option<reqwest::Client> {
        self.client
            .get_or_init(|| {
                let tls = semaphore_net::tls_client_config().ok()?;
                let destinations = self.destinations.clone();
                reqwest::Client::builder()
                    .tls_backend_preconfigured(rustls::ClientConfig::clone(&tls))
                    .user_agent("Mozilla/5.0 (compatible; link preview)")
                    // Names resolve to allowed addresses only, and reqwest connects to exactly
                    // those. The environment's proxy is kept: through one, the proxy resolves
                    // names, so only IP literals are filtered (by the checks on each URL).
                    .dns_resolver(destinations::resolver(self.destinations.clone()))
                    .redirect(reqwest::redirect::Policy::custom(move |attempt| {
                        if !fetchable_url(attempt.url()) {
                            attempt.error("a redirect left http(s) or went nowhere")
                        } else if !destinations.allows_url(attempt.url()) {
                            attempt.error("a redirect went to a private address")
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

    /// A link preview's image at `url`, under [`PREVIEW_MAX_BYTES`].
    pub async fn fetch(&self, url: &str) -> Result<Vec<u8>, String> {
        self.fetch_limited(url, PREVIEW_MAX_BYTES).await
    }

    /// The image at `url`, at most `max_bytes` (from Content-Length and while it streams), or why
    /// not. Makes no request unless allowed and the URL is http(s).
    pub async fn fetch_limited(&self, url: &str, max_bytes: usize) -> Result<Vec<u8>, String> {
        if !self.allowed() {
            return Err("link preview images are off".into());
        }
        let parsed = reqwest::Url::parse(url).map_err(|error| error.to_string())?;
        if !fetchable_url(&parsed) || !self.destinations.allows_url(&parsed) {
            return Err(format!("not fetching {parsed}"));
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
            .is_some_and(|length| length > max_bytes as u64)
        {
            return Err("too big".into());
        }
        let mut body = Vec::new();
        let mut stream = response.bytes_stream();
        use futures_util::StreamExt as _;
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|error| error.to_string())?;
            if body.len() + chunk.len() > max_bytes {
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

    /// The "Load images from other sites" switch: see [`set_third_party`].
    pub fn set_third_party(&self, on: bool) {
        set_third_party(&self.previews, &self.store, on);
    }

    fn third_party(&self, kind: ThirdPartyKind, url: &str) -> MediaRef {
        third_party(
            &self.previews,
            &self.store,
            &self.exec,
            &self.arrived,
            kind,
            url,
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
        self.third_party(ThirdPartyKind::LinkImage, url)
    }

    fn gif(&self, url: &str) -> MediaRef {
        self.third_party(ThirdPartyKind::Gif, url)
    }
}

/// Creates `directory` (and its parents) for this user only: mode 0700 on Unix. Used for files
/// the app writes on the user's behalf outside a save dialog.
pub fn create_private_dir(directory: &std::path::Path) -> std::io::Result<()> {
    let mut builder = std::fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(directory)
}

/// What `Players::set_posters` takes: a video with a server thumbnail gets it as its poster,
/// fetched into the store on its first draw and drawn once it's there.
pub fn poster_resolver(media: &std::rc::Rc<AppMedia>) -> semaphore_ui::player::PosterResolver {
    let media = media.clone();
    std::rc::Rc::new(move |attachment: &AttachmentView| {
        if !attachment.has_thumbnail {
            return None;
        }
        let (media, file_id) = (media.clone(), attachment.file_id.clone());
        Some(gpui_kit::ImageSource::from(
            move |window: &mut gpui_kit::Window, cx: &mut gpui_kit::App| match media.fetch_file(
                file_path(&file_id, true),
                file_id.clone(),
                true,
            ) {
                MediaRef::Resource(resource) => {
                    window.use_asset::<gpui_kit::ImgResourceLoader>(&resource, cx)
                }
                // Drawn again when the fetch lands (`AppMedia::arrived`).
                MediaRef::Pending => None,
                _ => Some(Err(gpui_kit::ImageCacheError::Asset(
                    "the thumbnail isn't available".into(),
                ))),
            },
        ))
    })
}

/// Asks where to save a download called `name`: the save dialog the config chose
/// (`crate::ask_save_path`; the system's, or the rig's queue). `None` when cancelled.
pub fn ask_save_path(
    name: &str,
    cx: &mut gpui_kit::App,
) -> gpui_kit::Task<Option<std::path::PathBuf>> {
    crate::ask_save_path(name, cx)
}

/// Writes a download where the user chose, on a blocking thread of the net runtime, and marks it
/// as downloaded from the internet (Windows' Mark-of-the-Web), as a browser does. A volume that
/// can't hold the mark (FAT32) keeps the file: the user chose where it goes, and nothing opens it
/// from here.
pub async fn write_file(path: std::path::PathBuf, bytes: Vec<u8>) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
        if let Err(error) = semaphore_platform_desktop::download_mark::mark_downloaded(&path) {
            log::warn!(
                "{} is saved without its downloaded mark: {error}",
                path.display()
            );
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// What "Open externally" may hand to the OS's default app: audio and video, the only kinds the
/// player offers it for. An allowlist, not a denylist: Windows runs, loads or follows far more
/// kinds of file on "open" than any list of them stays complete for (`.cpl`, `.chm`, `.msc`,
/// `.appref-ms`, `.rdp`, `.iso`, `.search-ms` ...). Anything else is saved instead.
pub const MEDIA_EXTENSIONS: &[&str] = &[
    "mp4", "m4v", "mov", "mkv", "webm", "avi", "wmv", "mpg", "mpeg", "ogv", "ogg", "oga", "opus",
    "mp3", "m4a", "aac", "wav", "flac",
];

/// The file name "Open externally" writes under the app's `open` folder for an attachment:
/// `<id>-<name>`, both made safe. [`may_open_with_the_os`] judges this name, the one the OS sees.
pub fn open_externally_name(file_id: &str, filename: &str) -> String {
    format!("{}-{}", safe_file_name(file_id), safe_file_name(filename))
}

/// Whether a file called `name` may go to the OS's default app: only audio and video
/// ([`MEDIA_EXTENSIONS`]). Judged on the name as it would be written ([`safe_file_name`]), so
/// trailing dots, stream names and direction marks can't hide the real extension; callers pass
/// the name actually written to disk ([`open_externally_name`]).
pub fn may_open_with_the_os(name: &str) -> bool {
    let safe = safe_file_name(name);
    match safe.rsplit_once('.') {
        Some((stem, extension)) if !stem.is_empty() && !extension.is_empty() => {
            let extension = extension.to_ascii_lowercase();
            MEDIA_EXTENSIONS.contains(&extension.as_str())
        }
        _ => false,
    }
}

/// Characters that change how a name reads without being seen: direction overrides and
/// isolates (which can make `fdp.exe` read as `exe.pdf`), marks, zero-width spaces, BOMs. Not
/// the zero-width joiner and non-joiner: emoji and several scripts need them.
fn is_invisible(c: char) -> bool {
    matches!(c,
        '\u{00AD}' | '\u{061C}' | '\u{180E}' | '\u{200B}' | '\u{200E}' | '\u{200F}' | '\u{202A}'..='\u{202E}'
        | '\u{2060}'..='\u{2064}' | '\u{2066}'..='\u{206F}' | '\u{FEFF}' | '\u{FFF9}'..='\u{FFFB}')
}

/// Names Windows keeps for devices, whatever their extension: `NUL.txt` is the null device.
fn is_device_name(name: &str) -> bool {
    let stem = name
        .split('.')
        .next()
        .unwrap_or_default()
        .trim_end()
        .to_ascii_uppercase();
    matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ((stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.len() == 4
            && matches!(stem.as_bytes()[3], b'1'..=b'9'))
}

/// At most `most` graphemes, keeping a short extension: `long-name….pdf` stays a PDF, and no
/// character made of several code points is split.
fn bounded(name: &str, most: usize) -> String {
    use unicode_segmentation::UnicodeSegmentation;
    if name.graphemes(true).count() <= most {
        return name.to_owned();
    }
    let extension = name
        .rsplit_once('.')
        .map(|(_, extension)| extension)
        .filter(|extension| !extension.is_empty() && extension.graphemes(true).count() <= 16);
    match extension {
        Some(extension) => {
            let keep = most - extension.graphemes(true).count() - 1;
            let stem: String = name.graphemes(true).take(keep).collect();
            format!("{stem}.{extension}")
        }
        None => name.graphemes(true).take(most).collect(),
    }
}

/// A server's file name, made safe to suggest in a save dialog or write: the last path component
/// only, no leading dots, no trailing dots or spaces (Windows drops them, so `a.exe.` is
/// `a.exe`), no control or invisible characters, not a Windows device name, at most 100
/// graphemes with its extension kept.
pub fn safe_file_name(name: &str) -> String {
    let last = name.rsplit(['/', '\\']).next().unwrap_or_default();
    let cleaned: String = last
        .chars()
        .filter(|c| {
            !c.is_control()
                && !is_invisible(*c)
                && !matches!(c, ':' | '*' | '?' | '"' | '<' | '>' | '|')
        })
        .collect();
    let trimmed = cleaned
        .trim()
        .trim_start_matches('.')
        .trim_end_matches(['.', ' '])
        .trim();
    let named = if is_device_name(trimmed) {
        format!("_{trimmed}")
    } else {
        trimmed.to_owned()
    };
    let bounded = bounded(&named, 100);
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

    /// NAT-2: avatars, custom emoji and full-size attachments pass the frame budget as well,
    /// not only pictures from other sites.
    #[test]
    fn every_image_the_store_keeps_passes_the_frame_budget() {
        use budget::tests::{gif_frames, gif_shape, real_gif};
        let store = FileStore::default();
        for path in [
            "semaphore-file/f/avatar",
            "semaphore-file/f/emoji",
            "semaphore-file/t/thumb",
        ] {
            // 2000x2000 x 10,000 frames: 160 GB decoded from a quarter of a megabyte. Not even
            // one frame of it is drawn from filler data, so nothing is kept.
            store.begin(path);
            store.finish(path, Ok(gif_shape(2000, 2000, 10_000, true)));
            match store.get(path) {
                None => assert_eq!(store.have(path), Have::Unavailable, "{path}"),
                Some(kept) => assert_eq!(
                    budget::animation_cost(&kept).unwrap().frames,
                    1,
                    "{path} kept every frame"
                ),
            }
        }

        // Over the budget but drawable: frame 0 alone, as a PNG.
        store.begin("semaphore-file/f/long");
        store.finish("semaphore-file/f/long", Ok(real_gif(600, 600, 30)));
        let kept = store
            .get("semaphore-file/f/long")
            .expect("first frame kept");
        assert_eq!(image::guess_format(&kept).unwrap(), image::ImageFormat::Png);
        assert_eq!(budget::animation_cost(&kept).unwrap().frames, 1);

        // Inside the budget: kept as sent, and still animated.
        let small = real_gif(32, 32, 5);
        store.begin("semaphore-file/f/small");
        store.finish("semaphore-file/f/small", Ok(small.clone()));
        assert_eq!(
            store.get("semaphore-file/f/small").unwrap().as_slice(),
            small
        );

        // A frame bigger than its screen: refused.
        store.begin("semaphore-file/f/wide");
        store.finish(
            "semaphore-file/f/wide",
            Ok(gif_frames(10, 10, &[(0, 0, 65535, 65535)])),
        );
        assert_eq!(store.have("semaphore-file/f/wide"), Have::Unavailable);
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

    #[test]
    fn windows_device_names_are_not_saved_as_themselves() {
        for (name, safe) in [
            ("CON", "_CON"),
            ("nul.txt", "_nul.txt"),
            ("Com1.tar.gz", "_Com1.tar.gz"),
            ("lpt9", "_lpt9"),
            ("AUX ", "_AUX"),
            ("prn .txt", "_prn .txt"),
            ("COM10.txt", "COM10.txt"),
            ("console.txt", "console.txt"),
            ("nullable", "nullable"),
        ] {
            assert_eq!(safe_file_name(name), safe, "{name:?}");
        }
    }

    #[test]
    fn trailing_dots_and_spaces_go_as_windows_would_drop_them() {
        for (name, safe) in [
            ("report.pdf.", "report.pdf"),
            ("report.pdf .  ", "report.pdf"),
            ("a.exe. . .", "a.exe"),
            ("   spaced name.txt  ", "spaced name.txt"),
        ] {
            assert_eq!(safe_file_name(name), safe, "{name:?}");
        }
    }

    #[test]
    fn invisible_and_direction_marks_are_stripped() {
        for (name, safe) in [
            ("invoice\u{202E}fdp.exe", "invoicefdp.exe"),
            ("\u{2066}a\u{2069}.txt", "a.txt"),
            ("\u{2067}\u{2068}b.txt", "b.txt"),
            ("a\u{200E}\u{200F}b", "ab"),
            ("a\u{200B}b\u{FEFF}", "ab"),
            ("\u{061C}c\u{202A}\u{202B}\u{202C}\u{202D}", "c"),
        ] {
            assert_eq!(safe_file_name(name), safe, "{name:?}");
        }
    }

    #[test]
    fn a_long_name_is_cut_before_its_extension_and_between_characters() {
        let long = format!("{}.pdf", "x".repeat(300));
        let safe = safe_file_name(&long);
        assert_eq!(safe.chars().count(), 100);
        assert!(safe.ends_with(".pdf"), "{safe}");

        // A grapheme of several code points is kept whole or not at all.
        let coder = "\u{1F469}\u{200D}\u{1F4BB}";
        assert_eq!(safe_file_name(&coder.repeat(150)), coder.repeat(100));
        let accented = "e\u{301}";
        assert_eq!(safe_file_name(&accented.repeat(150)), accented.repeat(100));

        // An "extension" too long to be one is cut like the rest of the name.
        let odd = format!("a.{}", "b".repeat(300));
        assert_eq!(safe_file_name(&odd).chars().count(), 100);
    }

    #[test]
    fn only_media_open_with_the_os() {
        for name in [
            "song.mp3",
            "clip.webm",
            "CLIP.MP4",
            "a.exe.mp4",
            "film.mkv",
            "film.Mov",
            "voice.opus",
            "track.flac",
        ] {
            assert!(may_open_with_the_os(name), "{name:?} was refused");
        }
        for extension in MEDIA_EXTENSIONS {
            assert!(may_open_with_the_os(&format!("x.{extension}")));
            assert!(may_open_with_the_os(&format!(
                "x.{}",
                extension.to_ascii_uppercase()
            )));
        }
        for name in [
            // Documents and pictures: the button is only offered for audio and video.
            "report.pdf",
            "photo.JPG",
            "notes.txt",
            "setup.exe",
            "SETUP.EXE",
            "a.pdf.exe",
            "a.mp4.exe",
            "installer.msi",
            "x.bat",
            "x.cmd",
            "x.com",
            "x.scr",
            "x.pif",
            "x.ps1",
            "x.vbs",
            "x.js",
            "x.JSE",
            "x.wsf",
            "x.hta",
            "evil.lnk",
            "x.url",
            "x.reg",
            "x.jar",
            "run.Sh",
            "x.run",
            "x.bin",
            "x.AppImage",
            "app.desktop",
            "pkg.deb",
            "pkg.rpm",
            "noextension",
            "mp4",
            ".mp4",
            ".exe",
            "x.",
            "trailing.exe.",
            "trailing.exe .",
            "trailing.mp4.exe.",
            "invoice\u{202E}4pm.exe",
            "invoice\u{202E}fdp.exe",
            "CON.exe",
            "clip.mp4:Zone.Identifier",
            "clip.mp4:evil.exe",
        ] {
            assert!(!may_open_with_the_os(name), "{name:?} would be opened");
        }
    }

    /// NAT-1: every kind of file Windows runs, loads or follows on "open" that the old denylist
    /// missed.
    #[test]
    fn programs_the_denylist_missed_are_not_opened() {
        for ext in [
            "cpl",
            "vbe",
            "wsh",
            "chm",
            "msc",
            "appref-ms",
            "application",
            "py",
            "pyw",
            "rdp",
            "search-ms",
            "library-ms",
            "iso",
            "img",
            "vhd",
            "vhdx",
            "xll",
            "msp",
            "msix",
            "appx",
            "appinstaller",
            "diagcab",
            "jnlp",
            "settingcontent-ms",
            "website",
            "theme",
        ] {
            assert!(!may_open_with_the_os(&format!("clip.{ext}")), "{ext}");
            assert!(!may_open_with_the_os(&format!("clip.mp4.{ext}")), "{ext}");
        }
    }

    /// The check runs on the name written to disk, which is what the OS sees.
    #[test]
    fn the_name_on_disk_is_the_one_judged() {
        assert_eq!(open_externally_name("f1", "clip.mp4"), "f1-clip.mp4");
        assert!(may_open_with_the_os(&open_externally_name(
            "f1", "clip.mp4"
        )));
        // A path in the name is cut to its last part; what's left decides.
        assert_eq!(
            open_externally_name("f1", "clip.mp4/evil.cpl"),
            "f1-evil.cpl"
        );
        assert!(!may_open_with_the_os(&open_externally_name(
            "f1",
            "clip.mp4/evil.cpl"
        )));
        assert!(!may_open_with_the_os(&open_externally_name(
            "f1",
            "a.mp4\\b.cpl"
        )));
        // Trailing dots and spaces are dropped as Windows would.
        assert!(!may_open_with_the_os(&open_externally_name(
            "f1",
            "a.mp4.cpl. . "
        )));
        // A name with no extension can't borrow one from the id.
        assert!(!may_open_with_the_os(&open_externally_name(
            "x.mp4", "noext"
        )));
        // A server id can't smuggle a separator or a stream name.
        assert_eq!(open_externally_name("../x:y", "a.mp4"), "xy-a.mp4");
        // An extension too long to keep is cut with the rest: never opened.
        let long = format!("clip.mp4{}", "4".repeat(300));
        assert!(!may_open_with_the_os(&open_externally_name("f", &long)));
    }

    /// One canned HTTP answer per connection, for the fetcher's limits.
    async fn serve(answers: Vec<String>) -> (String, Arc<AtomicUsize>) {
        serve_bytes(answers.into_iter().map(String::into_bytes).collect()).await
    }

    async fn serve_bytes(answers: Vec<Vec<u8>>) -> (String, Arc<AtomicUsize>) {
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
                let _ = stream.write_all(&answer).await;
            }
        });
        (format!("http://{address}"), hits)
    }

    /// The same, listening on another loopback address (Linux routes all of 127/8).
    async fn serve_at(ip: &str, answers: Vec<String>) -> (String, Arc<AtomicUsize>) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind((ip, 0)).await.unwrap();
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

    /// A fetcher that may also reach the tests' own server on 127.0.0.1, and nothing else
    /// private.
    fn local_fetcher(allowed: bool) -> PreviewFetcher {
        PreviewFetcher::with_destinations(
            allowed,
            destinations::Destinations::PublicAnd(vec!["127.0.0.1".parse().unwrap()]),
        )
    }

    /// NAT-6: with the switch on, nothing on the viewer's own machine or network is asked for:
    /// not by literal address, not by a name that resolves there.
    #[tokio::test]
    async fn the_fetcher_never_reaches_loopback_or_private_addresses() {
        semaphore_net::install_crypto_provider();
        let (url, hits) = serve(vec![answer("200 OK", "image/png", "x"); 4]).await;
        let port = url.rsplit(':').next().unwrap().to_owned();
        let fetcher = PreviewFetcher::new(true);
        for target in [
            format!("{url}/a.png"),
            format!("http://localhost:{port}/a.png"),
            format!("http://[::ffff:127.0.0.1]:{port}/a.png"),
            format!("http://2130706433:{port}/a.png"),
        ] {
            assert!(fetcher.fetch(&target).await.is_err(), "{target}");
        }
        assert_eq!(hits.load(Ordering::SeqCst), 0);
    }

    /// Every redirect hop is checked: an allowed server can't send the fetch on to a private one.
    #[tokio::test]
    async fn a_redirect_into_a_private_address_is_not_followed() {
        semaphore_net::install_crypto_provider();
        let (private, private_hits) =
            serve_at("127.0.0.2", vec![answer("200 OK", "image/png", "x"); 2]).await;
        let redirect = format!(
            "HTTP/1.1 302 Found\r\nLocation: {private}/a.png\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
        );
        let (allowed, allowed_hits) = serve(vec![redirect]).await;
        let fetcher = local_fetcher(true);
        assert!(
            fetcher
                .fetch(&format!("{allowed}/start.png"))
                .await
                .is_err()
        );
        assert_eq!(
            allowed_hits.load(Ordering::SeqCst),
            1,
            "the first hop was asked"
        );
        assert_eq!(
            private_hits.load(Ordering::SeqCst),
            0,
            "the second never was"
        );
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
        let fetcher = local_fetcher(true);
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
        let fetcher = local_fetcher(true);
        assert!(fetcher.fetch(&format!("{base}/start")).await.is_err());
        assert_eq!(hops.load(Ordering::SeqCst), PREVIEW_MAX_REDIRECTS + 1);
    }

    // ---- WM: the third-party entry point. ----

    fn binary_answer(content_type: &str, body: &[u8]) -> Vec<u8> {
        let mut answer = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        )
        .into_bytes();
        answer.extend_from_slice(body);
        answer
    }

    fn animated_gif(width: u32, height: u32, frames: usize) -> Vec<u8> {
        let mut bytes = Vec::new();
        {
            let mut encoder = image::codecs::gif::GifEncoder::new(&mut bytes);
            encoder
                .encode_frames((0..frames).map(|index| {
                    image::Frame::new(image::RgbaImage::from_pixel(
                        width,
                        height,
                        image::Rgba([(index * 50 % 256) as u8, 0, 0, 255]),
                    ))
                }))
                .unwrap();
        }
        bytes
    }

    /// The entry point's parts: its own store, so tests don't share the process's.
    struct Parts {
        previews: Arc<PreviewFetcher>,
        store: Arc<FileStore>,
        exec: Exec,
        arrived: async_channel::Sender<()>,
        landed: async_channel::Receiver<()>,
    }

    impl Parts {
        fn new(on: bool) -> Self {
            semaphore_net::install_crypto_provider();
            let (arrived, landed) = async_channel::unbounded();
            Self {
                previews: Arc::new(local_fetcher(on)),
                store: Arc::default(),
                exec: Exec::new(tokio::runtime::Handle::current(), Arc::default()),
                arrived,
                landed,
            }
        }

        fn get(&self, kind: ThirdPartyKind, url: &str) -> MediaRef {
            third_party(
                &self.previews,
                &self.store,
                &self.exec,
                &self.arrived,
                kind,
                url,
            )
        }

        /// Asks, waits for the fetch to land, and asks again.
        async fn fetched(&self, kind: ThirdPartyKind, url: &str) -> MediaRef {
            assert!(matches!(self.get(kind, url), MediaRef::Pending));
            self.landed.recv().await.unwrap();
            self.get(kind, url)
        }

        fn set(&self, on: bool) {
            set_third_party(&self.previews, &self.store, on);
        }

        fn requests(&self) -> usize {
            self.previews.requests.load(Ordering::SeqCst)
        }
    }

    const KINDS: [ThirdPartyKind; 2] = [ThirdPartyKind::LinkImage, ThirdPartyKind::Gif];

    fn is_missing(media: &MediaRef) -> bool {
        matches!(media, MediaRef::Missing)
    }

    fn is_resource(media: &MediaRef) -> bool {
        matches!(media, MediaRef::Resource(_))
    }

    #[tokio::test]
    async fn third_party_off_makes_no_request_for_any_kind() {
        let (base, hits) = serve_bytes(vec![]).await;
        let parts = Parts::new(false);
        let urls = [
            format!("{base}/gif-1.gif"),
            format!("{base}/gif-1-preview.gif"),
            format!("{base}/preview.png"),
            "https://media.gifs.example/a.gif".to_owned(),
            "data:image/gif;base64,R0lGODlhAQABAAAAACw=".to_owned(),
            "file:///etc/passwd".to_owned(),
            "javascript:alert(1)".to_owned(),
            "ftp://example.invalid/a.gif".to_owned(),
            "not a url".to_owned(),
            String::new(),
        ];
        for kind in KINDS {
            for url in &urls {
                assert!(is_missing(&parts.get(kind, url)), "{kind:?} {url}");
            }
        }
        tokio::task::yield_now().await;
        assert_eq!(parts.requests(), 0);
        assert_eq!(hits.load(Ordering::SeqCst), 0);
        assert_eq!(parts.store.fetching(), 0, "nothing was even begun");
        assert_eq!(parts.store.bytes(), 0);
    }

    #[tokio::test]
    async fn third_party_on_fetches_once_then_serves_from_the_store() {
        let gif = animated_gif(4, 4, 3);
        let (base, hits) = serve_bytes(vec![
            binary_answer("image/gif", &gif),
            binary_answer("image/png", &png_header(2, 2)),
        ])
        .await;
        let parts = Parts::new(true);
        let gif_url = format!("{base}/gif-1.gif");
        assert!(is_resource(
            &parts.fetched(ThirdPartyKind::Gif, &gif_url).await
        ));
        let link_url = format!("{base}/preview.png");
        assert!(is_resource(
            &parts.fetched(ThirdPartyKind::LinkImage, &link_url).await
        ));
        for _ in 0..5 {
            assert!(is_resource(&parts.get(ThirdPartyKind::Gif, &gif_url)));
            assert!(is_resource(
                &parts.get(ThirdPartyKind::LinkImage, &link_url)
            ));
        }
        assert_eq!(hits.load(Ordering::SeqCst), 2, "each asked once");
        assert_eq!(parts.requests(), 2);
        // The same URL as the other kind is kept apart.
        assert_ne!(
            third_party_path(ThirdPartyKind::Gif, &gif_url),
            third_party_path(ThirdPartyKind::LinkImage, &gif_url)
        );
    }

    #[tokio::test]
    async fn turning_off_serves_nothing_and_requests_nothing() {
        let gif = animated_gif(4, 4, 2);
        let (base, hits) = serve_bytes(vec![
            binary_answer("image/gif", &gif),
            binary_answer("image/gif", &gif),
        ])
        .await;
        let parts = Parts::new(true);
        let url = format!("{base}/gif-2.gif");
        assert!(is_resource(&parts.fetched(ThirdPartyKind::Gif, &url).await));
        let path = third_party_path(ThirdPartyKind::Gif, &url);

        parts.set(false);
        for _ in 0..5 {
            assert!(is_missing(&parts.get(ThirdPartyKind::Gif, &url)));
        }
        assert_eq!(parts.store.have(&path), Have::Nothing, "purged");
        assert!(
            parts.store.get(&path).is_none(),
            "the asset source has nothing to serve"
        );
        assert_eq!(parts.store.bytes(), 0);
        tokio::task::yield_now().await;
        assert_eq!(hits.load(Ordering::SeqCst), 1);

        // On again: fetched afresh, since nothing was kept.
        parts.set(true);
        assert!(is_resource(&parts.fetched(ThirdPartyKind::Gif, &url).await));
        assert_eq!(hits.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn turning_off_purges_third_party_pictures_but_keeps_files() {
        let store = FileStore::default();
        let previews = local_fetcher(true);
        let file = file_path("abc", false);
        let gif = third_party_path(ThirdPartyKind::Gif, "http://a/x.gif");
        let link = third_party_path(ThirdPartyKind::LinkImage, "http://a/x.png");
        let refused = third_party_path(ThirdPartyKind::Gif, "http://a/bad.gif");
        let fetching = third_party_path(ThirdPartyKind::Gif, "http://a/slow.gif");
        for path in [&file, &gif, &link] {
            assert!(store.begin(path));
            store.finish(path, Ok(png_header(2, 2)));
        }
        assert!(store.begin(&refused));
        store.finish(&refused, Err("no".into()));
        assert!(store.begin(&fetching));

        set_third_party(&previews, &store, false);
        assert!(!previews.allowed());
        assert_eq!(store.have(&file), Have::Ready, "the server's files stay");
        assert_eq!(store.have(&gif), Have::Nothing);
        assert_eq!(store.have(&link), Have::Nothing);
        assert_eq!(store.have(&refused), Have::Nothing, "asked again when on");
        assert_eq!(
            store.have(&fetching),
            Have::Fetching,
            "drops itself on landing"
        );
        assert_eq!(store.bytes(), png_header(2, 2).len());

        // Turning it on keeps everything.
        set_third_party(&previews, &store, true);
        assert_eq!(store.have(&file), Have::Ready);
        assert!(is_third_party_path(&gif) && is_third_party_path(&link));
        assert!(!is_third_party_path(&file));
        assert!(!is_third_party_path(&format!("{ASSET_PREFIX}gifs/x")));
    }

    #[tokio::test]
    async fn a_fetch_landing_after_turning_off_is_not_kept() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let release = Arc::new(tokio::sync::Notify::new());
        let asked = Arc::new(tokio::sync::Notify::new());
        let (release_server, asked_server) = (release.clone(), asked.clone());
        let gif = animated_gif(4, 4, 2);
        tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut buffer = [0u8; 4096];
            let _ = stream.read(&mut buffer).await;
            asked_server.notify_one();
            release_server.notified().await;
            let _ = stream.write_all(&binary_answer("image/gif", &gif)).await;
        });
        let parts = Parts::new(true);
        let url = format!("{base}/slow.gif");
        assert!(matches!(
            parts.get(ThirdPartyKind::Gif, &url),
            MediaRef::Pending
        ));
        asked.notified().await;
        parts.set(false);
        release.notify_one();
        parts.landed.recv().await.unwrap();
        let path = third_party_path(ThirdPartyKind::Gif, &url);
        assert_eq!(parts.store.have(&path), Have::Nothing);
        assert_eq!(parts.store.bytes(), 0);
        assert!(is_missing(&parts.get(ThirdPartyKind::Gif, &url)));
    }

    #[tokio::test]
    async fn only_http_urls_are_fetched_while_on() {
        let parts = Parts::new(true);
        for kind in KINDS {
            for url in [
                "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
                "file:///etc/passwd",
                "javascript:alert(1)",
                "ftp://example.invalid/a.gif",
                "semaphore-file/gif/0000",
                "//example.invalid/a.gif",
                "https://media.gifs.example/a.gif",
                "http://site.invalid/a.png",
                "http://a.TEST./a.png",
                "",
            ] {
                assert!(is_missing(&parts.get(kind, url)), "{kind:?} {url}");
            }
        }
        assert_eq!(parts.requests(), 0);
        assert_eq!(parts.store.fetching(), 0);
    }

    #[test]
    fn names_that_can_never_resolve_are_not_asked_for() {
        for url in [
            "https://media.gifs.example/a.gif",
            "https://EXAMPLE/a.gif",
            "http://x.invalid/",
            "http://x.test./a",
        ] {
            assert!(!fetchable(url), "{url}");
        }
        for url in [
            "https://media.giphy.com/media/x/giphy.gif",
            "http://127.0.0.1:3999/__fixtures/gif-1.gif",
            "http://[::1]/a.gif",
            "https://example.com/a.png",
            "https://testing.org/a.png",
        ] {
            assert!(fetchable(url), "{url}");
        }
    }

    #[tokio::test]
    async fn wrong_type_oversized_or_junk_gifs_are_missing() {
        let six_mib = vec![b'x'; 6 * 1024 * 1024];
        let (base, _) = serve_bytes(vec![
            binary_answer("text/html", &animated_gif(2, 2, 2)),
            binary_answer("image/gif", &vec![0u8; GIF_MAX_BYTES + 1]),
            binary_answer("image/gif", b"<html>a page, not a gif</html>"),
            binary_answer("image/png", &six_mib),
        ])
        .await;
        let parts = Parts::new(true);
        for name in ["typed.gif", "huge.gif", "junk.gif"] {
            let url = format!("{base}/{name}");
            assert!(
                is_missing(&parts.fetched(ThirdPartyKind::Gif, &url).await),
                "{name}"
            );
        }
        // A link preview's cap is 5 MiB.
        let url = format!("{base}/six.png");
        assert!(is_missing(
            &parts.fetched(ThirdPartyKind::LinkImage, &url).await
        ));
        assert_eq!(parts.requests(), 4);
    }

    #[tokio::test]
    async fn gifs_have_their_own_byte_cap() {
        semaphore_net::install_crypto_provider();
        let six_mib = vec![b'x'; 6 * 1024 * 1024];
        let (base, _) = serve_bytes(vec![
            binary_answer("image/gif", &six_mib),
            binary_answer("image/gif", &six_mib),
        ])
        .await;
        let fetcher = local_fetcher(true);
        let url = format!("{base}/big.gif");
        assert!(
            fetcher.fetch(&url).await.is_err(),
            "over a link preview's cap"
        );
        assert_eq!(
            fetcher
                .fetch_limited(&url, GIF_MAX_BYTES)
                .await
                .unwrap()
                .len(),
            six_mib.len()
        );
    }

    #[tokio::test]
    async fn webp_is_accepted_and_big_animations_keep_one_frame() {
        let mut webp = Vec::new();
        image::codecs::webp::WebPEncoder::new_lossless(&mut webp)
            .encode(&[200u8; 4 * 4 * 4], 4, 4, image::ExtendedColorType::Rgba8)
            .unwrap();
        // 600x600 x 30 frames is 43 MB decoded: over the animation budget.
        let big = animated_gif(600, 600, 30);
        let (base, _) = serve_bytes(vec![
            binary_answer("image/webp", &webp),
            binary_answer("image/gif", &big),
        ])
        .await;
        let parts = Parts::new(true);
        let webp_url = format!("{base}/a.webp");
        assert!(is_resource(
            &parts.fetched(ThirdPartyKind::Gif, &webp_url).await
        ));
        let big_url = format!("{base}/big.gif");
        assert!(is_resource(
            &parts.fetched(ThirdPartyKind::Gif, &big_url).await
        ));
        let kept = parts
            .store
            .get(&third_party_path(ThirdPartyKind::Gif, &big_url))
            .unwrap();
        assert!(
            kept.starts_with(&[0x89, b'P', b'N', b'G']),
            "frame 0 as a PNG"
        );
        assert_eq!(
            budget::animation_cost(&kept).unwrap().frames,
            1,
            "a single frame"
        );
    }
}
