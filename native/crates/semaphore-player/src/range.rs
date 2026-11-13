//! Attachment bytes over HTTP range requests, for a player's decode thread.
//!
//! - **Blocks.** The file is read in 1 MiB blocks (`GET /api/file/{id}` with `Range`, bearer
//!   token; `semaphore-net` refreshes a refused token once). Reading a block also asks for the
//!   next [`READ_AHEAD`] in the background, on the app's tokio runtime.
//! - **Retries.** A retryable failure (network, 5xx, 429) is retried 3 times with backoff
//!   (250, 500, 1000 ms); anything else fails the read at once, and the player reports a
//!   network error.
//! - **Memory only.** Blocks live in a [`BlockCache`]: at most 16 MiB per player and 32 MiB in
//!   all, least recently used out first, apart from the 64 MiB image cache so a long video can't
//!   evict avatars. Nothing is written to disk.
//! - **Cancellation.** [`Cancel`] (held by the player) ends a read that is waiting and aborts
//!   the fetches in flight; dropping the source does too, and frees its blocks.

use crate::buffered::{BufferedReport, merged_ranges};
use crate::engine::{Cancel, Opened, Opener};
use semaphore_core::player::{PlaybackSource, PlayerError};
use semaphore_net::HttpBackend;
use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::io::{self, Read, Seek, SeekFrom};
use std::ops::Range;
use std::pin::Pin;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::time::Duration;
use tokio::runtime::Handle;
use tokio::task::JoinHandle;

pub const BLOCK: usize = 1 << 20;
pub const PER_PLAYER: usize = 16 << 20;
pub const TOTAL: usize = 32 << 20;
pub const READ_AHEAD: u64 = 4;
pub const RETRIES: u32 = 3;
const BACKOFF: Duration = Duration::from_millis(250);
/// How often a waiting read looks at its cancel flag.
const CANCEL_CHECK: Duration = Duration::from_millis(50);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FetchError {
    pub retryable: bool,
    pub message: String,
}

/// One range's bytes and, when the server said, the whole file's size.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Fetched {
    pub bytes: Vec<u8>,
    pub size: Option<u64>,
}

pub type FetchFuture = Pin<Box<dyn Future<Output = Result<Fetched, FetchError>> + Send>>;

/// Reads bytes `start..=end` of one file.
pub trait RangeFetch: Send + Sync + 'static {
    fn fetch(&self, start: u64, end: u64) -> FetchFuture;
}

/// A backend file, through `HttpBackend::file_range`.
pub struct HttpFile {
    backend: HttpBackend,
    file_id: String,
}

impl HttpFile {
    pub fn new(backend: HttpBackend, file_id: impl Into<String>) -> Self {
        Self {
            backend,
            file_id: file_id.into(),
        }
    }
}

impl RangeFetch for HttpFile {
    fn fetch(&self, start: u64, end: u64) -> FetchFuture {
        let backend = self.backend.clone();
        let id = self.file_id.clone();
        Box::pin(async move {
            match backend.file_range(&id, start, end).await {
                Ok(range) => Ok(Fetched {
                    bytes: range.bytes,
                    size: range.size,
                }),
                Err(error) => Err(FetchError {
                    retryable: error.retryable
                        || error.status == 0
                        || error.status == 429
                        || error.status >= 500,
                    message: format!("{} {}", error.status, error.message),
                }),
            }
        })
    }
}

struct Listener {
    file: Arc<str>,
    size: u64,
    report: BufferedReport,
    runtime: Option<Handle>,
}

/// Reports owed after a change, sent once the cache's lock is released.
type Owed = Vec<(BufferedReport, Vec<Range<f32>>, Option<Handle>)>;

struct Entry {
    data: Arc<Vec<u8>>,
    owner: u64,
    used: u64,
}

#[derive(Default)]
struct CacheInner {
    blocks: HashMap<(Arc<str>, u64), Entry>,
    owned: HashMap<u64, usize>,
    /// Released owners: a fetch of theirs that finishes late inserts nothing.
    gone: HashSet<u64>,
    /// Sources that report their file's fetched ranges, by owner.
    listeners: HashMap<u64, Listener>,
    total: usize,
    tick: u64,
}

/// Blocks of attachments being played, in memory, shared by every player.
pub struct BlockCache {
    per_owner: usize,
    total: usize,
    inner: Mutex<CacheInner>,
}

impl Default for BlockCache {
    fn default() -> Self {
        Self::new(PER_PLAYER, TOTAL)
    }
}

impl BlockCache {
    pub fn new(per_owner: usize, total: usize) -> Self {
        Self {
            per_owner,
            total,
            inner: Mutex::new(CacheInner::default()),
        }
    }

    fn lock(&self) -> MutexGuard<'_, CacheInner> {
        self.inner.lock().unwrap_or_else(|p| p.into_inner())
    }

    fn get(&self, file: &Arc<str>, index: u64) -> Option<Arc<Vec<u8>>> {
        let mut inner = self.lock();
        inner.tick += 1;
        let tick = inner.tick;
        let entry = inner.blocks.get_mut(&(file.clone(), index))?;
        entry.used = tick;
        Some(entry.data.clone())
    }

    fn insert(&self, owner: u64, file: Arc<str>, index: u64, data: Arc<Vec<u8>>) {
        let owed = self.insert_locked(owner, file, index, data);
        Self::pay(owed);
    }

    fn insert_locked(&self, owner: u64, file: Arc<str>, index: u64, data: Arc<Vec<u8>>) -> Owed {
        let mut inner = self.lock();
        if inner.gone.contains(&owner) {
            return Vec::new();
        }
        let mut changed: HashSet<Arc<str>> = HashSet::from([file.clone()]);
        inner.tick += 1;
        let used = inner.tick;
        let key = (file, index);
        let len = data.len();
        if let Some(old) = inner
            .blocks
            .insert(key.clone(), Entry { data, owner, used })
        {
            inner.total -= old.data.len();
            *inner.owned.entry(old.owner).or_default() -= old.data.len();
        }
        inner.total += len;
        *inner.owned.entry(owner).or_default() += len;
        // The owner's oldest first, then anyone's, never the block just added.
        while inner.owned.get(&owner).copied().unwrap_or(0) > self.per_owner {
            match Self::evict(&mut inner, Some(owner), &key) {
                Some(file) => changed.insert(file),
                None => break,
            };
        }
        while inner.total > self.total {
            match Self::evict(&mut inner, None, &key) {
                Some(file) => changed.insert(file),
                None => break,
            };
        }
        Self::owed(&inner, &changed)
    }

    /// What each listener on a `changed` file now holds.
    fn owed(inner: &CacheInner, changed: &HashSet<Arc<str>>) -> Owed {
        inner
            .listeners
            .values()
            .filter(|l| changed.contains(&l.file))
            .map(|l| {
                (
                    l.report.clone(),
                    Self::ranges_locked(inner, &l.file, l.size),
                    l.runtime.clone(),
                )
            })
            .collect()
    }

    fn pay(owed: Owed) {
        for (report, ranges, runtime) in owed {
            report.report(ranges, runtime.as_ref());
        }
    }

    fn ranges_locked(inner: &CacheInner, file: &Arc<str>, size: u64) -> Vec<Range<f32>> {
        let indices = inner
            .blocks
            .keys()
            .filter(|(f, _)| f == file)
            .map(|(_, index)| *index)
            .collect();
        merged_ranges(indices, BLOCK as u64, size)
    }

    /// The fetched parts of `file` (`size` bytes), as fractions of it.
    pub fn ranges(&self, file: &str, size: u64) -> Vec<Range<f32>> {
        Self::ranges_locked(&self.lock(), &Arc::from(file), size)
    }

    /// `owner` reports `file`'s ranges from now on (and once now), until released.
    fn listen(&self, owner: u64, listener: Listener) {
        let owed = {
            let mut inner = self.lock();
            if inner.gone.contains(&owner) {
                return;
            }
            let now = (
                listener.report.clone(),
                Self::ranges_locked(&inner, &listener.file, listener.size),
                listener.runtime.clone(),
            );
            inner.listeners.insert(owner, listener);
            vec![now]
        };
        Self::pay(owed);
    }

    /// Removes a block and returns its file, or `None` when nothing may go.
    fn evict(
        inner: &mut CacheInner,
        owner: Option<u64>,
        keep: &(Arc<str>, u64),
    ) -> Option<Arc<str>> {
        let victim = inner
            .blocks
            .iter()
            .filter(|(key, entry)| *key != keep && owner.is_none_or(|o| entry.owner == o))
            .min_by_key(|(_, entry)| entry.used)
            .map(|(key, _)| key.clone());
        let victim = victim?;
        if let Some(entry) = inner.blocks.remove(&victim) {
            inner.total -= entry.data.len();
            *inner.owned.entry(entry.owner).or_default() -= entry.data.len();
        }
        Some(victim.0)
    }

    /// Frees every block `owner` fetched (its player went away).
    pub fn release(&self, owner: u64) {
        let owed = {
            let mut inner = self.lock();
            let changed: HashSet<Arc<str>> = inner
                .blocks
                .iter()
                .filter(|(_, entry)| entry.owner == owner)
                .map(|((file, _), _)| file.clone())
                .collect();
            inner.blocks.retain(|_, entry| entry.owner != owner);
            inner.owned.remove(&owner);
            inner.listeners.remove(&owner);
            inner.gone.insert(owner);
            inner.total = inner.blocks.values().map(|e| e.data.len()).sum();
            Self::owed(&inner, &changed)
        };
        Self::pay(owed);
    }

    /// Bytes held in all.
    pub fn bytes(&self) -> usize {
        self.lock().total
    }

    /// Bytes held for `owner`.
    pub fn bytes_of(&self, owner: u64) -> usize {
        self.lock().owned.get(&owner).copied().unwrap_or(0)
    }
}

#[derive(Default)]
struct Flight {
    pending: HashSet<u64>,
    failed: HashMap<u64, FetchError>,
}

struct Shared {
    flight: Mutex<Flight>,
    done: Condvar,
}

impl Shared {
    fn flight(&self) -> MutexGuard<'_, Flight> {
        self.flight.lock().unwrap_or_else(|p| p.into_inner())
    }
}

static OWNERS: AtomicU64 = AtomicU64::new(1);

/// A file as `Read + Seek`, block by block over [`RangeFetch`]. Blocking: for the decode thread.
pub struct RangeSource {
    file: Arc<str>,
    size: u64,
    position: u64,
    fetch: Arc<dyn RangeFetch>,
    cache: Arc<BlockCache>,
    owner: u64,
    runtime: Handle,
    cancel: Cancel,
    shared: Arc<Shared>,
    tasks: Vec<JoinHandle<()>>,
}

impl RangeSource {
    /// `size` from the attachment's metadata; `None` learns it from the first block's
    /// `Content-Range`, fetched here (so this blocks).
    pub fn open(
        fetch: Arc<dyn RangeFetch>,
        file_id: &str,
        size: Option<u64>,
        cache: Arc<BlockCache>,
        runtime: Handle,
        cancel: Cancel,
    ) -> io::Result<Self> {
        let mut source = Self {
            file: Arc::from(file_id),
            size: size.unwrap_or(u64::MAX),
            position: 0,
            fetch,
            cache,
            owner: OWNERS.fetch_add(1, Ordering::Relaxed),
            runtime,
            cancel,
            shared: Arc::new(Shared {
                flight: Mutex::new(Flight::default()),
                done: Condvar::new(),
            }),
            tasks: Vec::new(),
        };
        if size.is_none() {
            let learned = source.learn_size()?;
            source.size = learned;
        }
        Ok(source)
    }

    /// Reports this file's fetched ranges to `report` (now, and after each block lands or is
    /// evicted) until the source is dropped.
    pub fn with_buffered(self, report: BufferedReport) -> Self {
        self.cache.listen(
            self.owner,
            Listener {
                file: self.file.clone(),
                size: self.size,
                report,
                runtime: Some(self.runtime.clone()),
            },
        );
        self
    }

    /// This source's share of the cache.
    pub fn owner(&self) -> u64 {
        self.owner
    }

    pub fn size(&self) -> u64 {
        self.size
    }

    fn learn_size(&mut self) -> io::Result<u64> {
        let fetch = self.fetch.clone();
        let cancel = self.cancel.clone();
        let fetched = self
            .runtime
            .block_on(
                async move { fetch_with_retries(&*fetch, 0, BLOCK as u64 - 1, &cancel).await },
            )
            .map_err(|e| io::Error::other(e.message))?;
        let size = fetched
            .size
            .ok_or_else(|| io::Error::other("the server didn't say the file's size"))?;
        self.cache
            .insert(self.owner, self.file.clone(), 0, Arc::new(fetched.bytes));
        Ok(size)
    }

    fn blocks(&self) -> u64 {
        self.size.div_ceil(BLOCK as u64)
    }

    /// Starts fetching `index` unless it is cached or already on its way.
    fn request(&mut self, index: u64) {
        if index >= self.blocks() || self.cache.get(&self.file, index).is_some() {
            return;
        }
        {
            let mut flight = self.shared.flight();
            if !flight.pending.insert(index) {
                return;
            }
            flight.failed.remove(&index);
        }
        let start = index * BLOCK as u64;
        let end = (start + BLOCK as u64).min(self.size) - 1;
        let (fetch, cache, shared, cancel) = (
            self.fetch.clone(),
            self.cache.clone(),
            self.shared.clone(),
            self.cancel.clone(),
        );
        let (file, owner) = (self.file.clone(), self.owner);
        self.tasks.retain(|task| !task.is_finished());
        self.tasks.push(self.runtime.spawn(async move {
            let result = fetch_with_retries(&*fetch, start, end, &cancel).await;
            // Cached before it stops being pending, so a reader never asks for it twice.
            match result {
                Ok(fetched) => {
                    cache.insert(owner, file, index, Arc::new(fetched.bytes));
                    shared.flight().pending.remove(&index);
                }
                Err(error) => {
                    let mut flight = shared.flight();
                    flight.pending.remove(&index);
                    flight.failed.insert(index, error);
                }
            }
            shared.done.notify_all();
        }));
    }

    fn block(&mut self, index: u64) -> io::Result<Arc<Vec<u8>>> {
        loop {
            if self.cancel.is_cancelled() {
                return Err(io::Error::other("cancelled"));
            }
            if let Some(block) = self.cache.get(&self.file, index) {
                return Ok(block);
            }
            let failed = self.shared.flight().failed.remove(&index);
            if let Some(error) = failed {
                return Err(io::Error::other(error.message));
            }
            self.request(index);
            let flight = self.shared.flight();
            if flight.pending.contains(&index) {
                // Woken by the fetch finishing; the timeout is only to see a cancel.
                let _ = self.shared.done.wait_timeout(flight, CANCEL_CHECK);
            }
        }
    }
}

async fn fetch_with_retries(
    fetch: &dyn RangeFetch,
    start: u64,
    end: u64,
    cancel: &Cancel,
) -> Result<Fetched, FetchError> {
    let mut attempt = 0;
    loop {
        if cancel.is_cancelled() {
            return Err(FetchError {
                retryable: false,
                message: "cancelled".into(),
            });
        }
        let result = fetch
            .fetch(start, end)
            .await
            .and_then(|fetched| whole(fetched, start, end));
        match result {
            Ok(fetched) => return Ok(fetched),
            Err(error) if error.retryable && attempt < RETRIES => {
                // A bounded retry's backoff, not a wait for something to happen.
                tokio::time::sleep(BACKOFF * 2u32.pow(attempt)).await;
                attempt += 1;
            }
            Err(error) => return Err(error),
        }
    }
}

/// A block as asked for: `start..=end`, or up to the file's end when the answer says the file
/// stops sooner. Fewer bytes (a dropped connection, a proxy) would be kept as the block and fail
/// every read past them, so they are a retryable failure; more are cut.
fn whole(mut fetched: Fetched, start: u64, end: u64) -> Result<Fetched, FetchError> {
    let last = fetched
        .size
        .map_or(end, |size| end.min(size.saturating_sub(1)));
    let wanted = (last + 1).saturating_sub(start);
    let got = fetched.bytes.len() as u64;
    if got < wanted {
        return Err(FetchError {
            retryable: true,
            message: format!("a short range: {got} of {wanted} bytes from {start}"),
        });
    }
    fetched
        .bytes
        .truncate(usize::try_from(end - start + 1).unwrap_or(usize::MAX));
    Ok(fetched)
}

impl Read for RangeSource {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if self.position >= self.size || buf.is_empty() {
            return Ok(0);
        }
        let index = self.position / BLOCK as u64;
        for ahead in index + 1..=index + READ_AHEAD {
            self.request(ahead);
        }
        let block = self.block(index)?;
        let offset = (self.position - index * BLOCK as u64) as usize;
        if offset >= block.len() {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "a short range",
            ));
        }
        let n = buf.len().min(block.len() - offset);
        buf[..n].copy_from_slice(&block[offset..offset + n]);
        self.position += n as u64;
        Ok(n)
    }
}

impl Seek for RangeSource {
    fn seek(&mut self, to: SeekFrom) -> io::Result<u64> {
        let target = match to {
            SeekFrom::Start(at) => Some(at),
            SeekFrom::Current(by) => self.position.checked_add_signed(by),
            SeekFrom::End(by) => self.size.checked_add_signed(by),
        };
        let target = target
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "seek out of range"))?;
        self.position = target;
        Ok(target)
    }
}

impl Drop for RangeSource {
    fn drop(&mut self) {
        for task in &self.tasks {
            task.abort();
        }
        self.cache.release(self.owner);
    }
}

/// Opens attachments from the backend: a [`RangeSource`] over [`HttpFile`], sharing `cache`.
pub fn http_opener(backend: HttpBackend, cache: Arc<BlockCache>, runtime: Handle) -> Opener {
    Arc::new(
        move |source: &PlaybackSource, cancel: &Cancel, buffered: &BufferedReport| {
            let Some(source) = source.attachment() else {
                log::warn!("player: {} isn't an attachment", source.id());
                return Err(PlayerError::Unsupported);
            };
            let fetch = Arc::new(HttpFile::new(backend.clone(), source.file_id.clone()));
            let size = (source.size > 0).then_some(source.size);
            RangeSource::open(
                fetch,
                &source.file_id,
                size,
                cache.clone(),
                runtime.clone(),
                cancel.clone(),
            )
            .map(|range| Opened::Bytes(Box::new(range.with_buffered(buffered.clone()))))
            .map_err(|error| {
                log::warn!("player: cannot open {}: {error}", source.file_id);
                PlayerError::Network
            })
        },
    )
}
