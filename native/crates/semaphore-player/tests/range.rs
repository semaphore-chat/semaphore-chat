//! The range reader: blocks, read-ahead, retries, cancellation and the cache's caps over an
//! in-memory file; then the real `HttpBackend` against the fake server's Range route, a refused
//! token refreshed once, and a fixture played over HTTP to its end.

use semaphore_core::backend::{FileUpload, FilesBackend, SessionBackend};
use semaphore_core::platform::{CoreError, SecretStore};
use semaphore_core::player::{MediaPlayer, PlaybackSource, PlaybackState, PlayerEvent};
use semaphore_fake_server::{FakeServer, Record, ScenarioSource};
use semaphore_media_livekit::audio::virtual_io::VirtualIo;
use semaphore_net::HttpBackend;
use semaphore_player::range::{
    BLOCK, BlockCache, FetchError, FetchFuture, Fetched, HttpFile, RangeFetch, RangeSource,
    http_opener,
};
use semaphore_player::{Cancel, DesktopPlayers, Frame, Media};
use std::collections::{HashMap, VecDeque};
use std::io::{Read, Seek, SeekFrom};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, mpsc};
use std::time::{Duration, Instant};

struct MemoryFile {
    bytes: Vec<u8>,
    calls: Mutex<Vec<(u64, u64)>>,
    failures: Mutex<VecDeque<FetchError>>,
    hang: AtomicBool,
}

impl MemoryFile {
    fn new(len: usize) -> Arc<Self> {
        Arc::new(Self {
            bytes: (0..len).map(|i| (i * 7 % 253) as u8).collect(),
            calls: Mutex::new(Vec::new()),
            failures: Mutex::new(VecDeque::new()),
            hang: AtomicBool::new(false),
        })
    }

    fn fail(&self, times: usize, retryable: bool) {
        let mut failures = self.failures.lock().unwrap();
        for _ in 0..times {
            failures.push_back(FetchError {
                retryable,
                message: "boom".into(),
            });
        }
    }

    fn calls_for(&self, start: u64) -> usize {
        self.calls
            .lock()
            .unwrap()
            .iter()
            .filter(|(s, _)| *s == start)
            .count()
    }
}

impl RangeFetch for MemoryFile {
    fn fetch(&self, start: u64, end: u64) -> FetchFuture {
        self.calls.lock().unwrap().push((start, end));
        if self.hang.load(Ordering::SeqCst) {
            return Box::pin(std::future::pending());
        }
        let result = match self.failures.lock().unwrap().pop_front() {
            Some(error) => Err(error),
            None => Ok(Fetched {
                bytes: self.bytes[start as usize..=end as usize].to_vec(),
                size: Some(self.bytes.len() as u64),
            }),
        };
        Box::pin(async move { result })
    }
}

fn runtime() -> tokio::runtime::Runtime {
    tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .unwrap()
}

fn source(
    file: &Arc<MemoryFile>,
    cache: &Arc<BlockCache>,
    rt: &tokio::runtime::Runtime,
    cancel: Cancel,
) -> RangeSource {
    let size = Some(file.bytes.len() as u64);
    RangeSource::open(
        file.clone(),
        "file",
        size,
        cache.clone(),
        rt.handle().clone(),
        cancel,
    )
    .unwrap()
}

#[test]
fn reads_the_whole_file_in_aligned_blocks_once_each() {
    let rt = runtime();
    let file = MemoryFile::new(5 * BLOCK + BLOCK / 2);
    let cache = Arc::new(BlockCache::default());
    let mut range = source(&file, &cache, &rt, Cancel::default());
    let mut out = Vec::new();
    range.read_to_end(&mut out).unwrap();
    assert!(out == file.bytes, "the bytes differ");
    let calls = file.calls.lock().unwrap().clone();
    assert_eq!(calls.len(), 6, "{calls:?}");
    for (start, end) in calls {
        assert_eq!(start % BLOCK as u64, 0);
        assert!(end == start + BLOCK as u64 - 1 || end == file.bytes.len() as u64 - 1);
    }
}

#[test]
fn seeks_read_the_right_bytes() {
    let rt = runtime();
    let file = MemoryFile::new(4 * BLOCK);
    let cache = Arc::new(BlockCache::default());
    let mut range = source(&file, &cache, &rt, Cancel::default());
    let at = 3 * BLOCK as u64 - 50;
    range.seek(SeekFrom::Start(at)).unwrap();
    let mut buf = [0u8; 100];
    range.read_exact(&mut buf).unwrap();
    assert_eq!(buf[..], file.bytes[at as usize..at as usize + 100]);
    assert_eq!(
        range.seek(SeekFrom::End(-10)).unwrap(),
        4 * BLOCK as u64 - 10
    );
}

#[test]
fn a_retryable_failure_is_retried_and_three_retries_is_the_limit() {
    let rt = runtime();
    let file = MemoryFile::new(BLOCK);
    file.fail(2, true);
    let cache = Arc::new(BlockCache::default());
    let mut buf = [0u8; 10];
    source(&file, &cache, &rt, Cancel::default())
        .read_exact(&mut buf)
        .expect("third time lucky");
    assert_eq!(file.calls_for(0), 3);

    let file = MemoryFile::new(BLOCK);
    file.fail(4, true);
    let cache = Arc::new(BlockCache::default());
    let error = source(&file, &cache, &rt, Cancel::default()).read(&mut buf);
    assert!(error.is_err());
    assert_eq!(file.calls_for(0), 4, "one try and three retries");
}

#[test]
fn a_failure_that_is_not_retryable_fails_at_once() {
    let rt = runtime();
    let file = MemoryFile::new(BLOCK);
    file.fail(1, false);
    let cache = Arc::new(BlockCache::default());
    let mut buf = [0u8; 10];
    assert!(
        source(&file, &cache, &rt, Cancel::default())
            .read(&mut buf)
            .is_err()
    );
    assert_eq!(file.calls_for(0), 1);
}

#[test]
fn cancelling_ends_a_read_that_is_waiting() {
    let rt = runtime();
    let file = MemoryFile::new(BLOCK);
    file.hang.store(true, Ordering::SeqCst);
    let cache = Arc::new(BlockCache::default());
    let cancel = Cancel::default();
    let mut range = source(&file, &cache, &rt, cancel.clone());
    let (done, finished) = mpsc::channel();
    std::thread::spawn(move || {
        let mut buf = [0u8; 10];
        let _ = done.send(range.read(&mut buf).is_err());
    });
    assert!(
        finished.recv_timeout(Duration::from_millis(200)).is_err(),
        "it waits"
    );
    cancel.cancel();
    assert_eq!(finished.recv_timeout(Duration::from_secs(2)), Ok(true));
}

#[test]
fn the_cache_keeps_its_caps_and_dropping_a_source_frees_its_blocks() {
    let rt = runtime();
    let cache = Arc::new(BlockCache::new(4 * BLOCK, 6 * BLOCK));
    let first = MemoryFile::new(10 * BLOCK);
    let mut a = source(&first, &cache, &rt, Cancel::default());
    let mut sink = Vec::new();
    a.read_to_end(&mut sink).unwrap();
    assert!(cache.bytes_of(a.owner()) <= 4 * BLOCK, "per player");

    let second = MemoryFile::new(10 * BLOCK);
    let mut b = source(&second, &cache, &rt, Cancel::default());
    sink.clear();
    b.read_to_end(&mut sink).unwrap();
    assert!(cache.bytes_of(b.owner()) <= 4 * BLOCK);
    assert!(cache.bytes() <= 6 * BLOCK, "in all: {}", cache.bytes());

    drop(a);
    drop(b);
    // Read-ahead tasks were aborted; anything they had inserted went with the owner.
    assert_eq!(cache.bytes(), 0);
}

fn coverage(ranges: &[std::ops::Range<f32>]) -> f32 {
    ranges.iter().map(|r| r.end - r.start).sum()
}

/// Buffered reports until one matches `done`, or panics after a deadline.
fn buffered_until(
    rx: &mpsc::Receiver<PlayerEvent>,
    done: impl Fn(&[std::ops::Range<f32>]) -> bool,
) -> Vec<Vec<std::ops::Range<f32>>> {
    let deadline = Instant::now() + Duration::from_secs(10);
    let mut seen = Vec::new();
    loop {
        let left = deadline.saturating_duration_since(Instant::now());
        match rx.recv_timeout(left) {
            Ok(PlayerEvent::Buffered(ranges)) => {
                let finished = done(&ranges);
                seen.push(ranges);
                if finished {
                    return seen;
                }
            }
            Ok(_) => {}
            Err(_) => panic!("no matching Buffered report; saw {seen:?}"),
        }
    }
}

#[test]
fn buffered_ranges_grow_as_blocks_arrive_and_shrink_on_eviction() {
    let rt = runtime();
    let cache = Arc::new(BlockCache::new(100 * BLOCK, 5 * BLOCK));
    let (tx, rx) = mpsc::channel();
    let tx = Mutex::new(tx);
    let report = semaphore_player::BufferedReport::new(Arc::new(move |event| {
        let _ = tx.lock().unwrap().send(event);
    }));
    let first = MemoryFile::new(10 * BLOCK);
    let mut a = RangeSource::open(
        first.clone(),
        "first",
        Some(10 * BLOCK as u64),
        cache.clone(),
        rt.handle().clone(),
        Cancel::default(),
    )
    .unwrap()
    .with_buffered(report);

    // One byte: block 0 and four blocks of read-ahead.
    a.read_exact(&mut [0u8; 1]).unwrap();
    let growing = buffered_until(&rx, |r| r == [0.0..0.5]);
    assert_eq!(growing[0], [], "reported once on open, before any block");
    for pair in growing.windows(2) {
        assert!(coverage(&pair[1]) >= coverage(&pair[0]), "{growing:?}");
        assert!(pair[1].windows(2).all(|w| w[0].end < w[1].start), "merged");
    }
    assert!(
        growing.len() <= 6,
        "at most one report per change: {growing:?}"
    );
    assert_eq!(cache.ranges("first", 10 * BLOCK as u64), [0.0..0.5]);

    // Another file's blocks push the first file's out of the 5-block cache.
    let second = MemoryFile::new(10 * BLOCK);
    let mut b = RangeSource::open(
        second,
        "second",
        Some(10 * BLOCK as u64),
        cache.clone(),
        rt.handle().clone(),
        Cancel::default(),
    )
    .unwrap();
    b.read_exact(&mut [0u8; 1]).unwrap();
    let shrinking = buffered_until(&rx, |r| r.is_empty());
    for pair in shrinking.windows(2) {
        assert!(coverage(&pair[1]) <= coverage(&pair[0]), "{shrinking:?}");
    }
    drop(a);
    drop(b);
}

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

fn fixture(name: &str) -> Vec<u8> {
    let path = format!("{}/fixtures/{name}", env!("CARGO_MANIFEST_DIR"));
    std::fs::read(&path).unwrap_or_else(|error| panic!("{path}: {error}"))
}

/// A signed-in backend on a fake server, with `file` uploaded: its id and size.
async fn served(file: &str) -> (FakeServer, HttpBackend, String, u64) {
    semaphore_net::install_crypto_provider();
    let server = FakeServer::start(ScenarioSource::Named("big-community"))
        .await
        .expect("the scenario loads");
    let backend = HttpBackend::new(Arc::new(MemSecrets::default()));
    backend.set_server_url(server.base_url());
    backend
        .auth_controller_login(semaphore_wire::types::LoginRequestDto {
            username: "me".into(),
            password: "pw".into(),
        })
        .await
        .expect("signs in");
    let bytes = fixture(file);
    let size = bytes.len() as u64;
    let uploaded = backend
        .file_upload_controller_upload_file(
            FileUpload {
                filename: file.into(),
                mime_type: "video/webm".into(),
                bytes: Arc::new(bytes),
                resource_type: semaphore_wire::enums::ResourceType::MessageAttachment,
                resource_id: None,
            },
            Arc::new(|_| {}),
        )
        .await
        .expect("uploads");
    (server, backend, uploaded.id.to_string(), size)
}

fn file_requests(server: &FakeServer) -> Vec<u16> {
    server
        .requests()
        .iter()
        .filter_map(|record| match record {
            Record::Http {
                operation: Some("FileController_getFile"),
                status,
                ..
            } => Some(*status),
            _ => None,
        })
        .collect()
}

fn refreshes(server: &FakeServer) -> usize {
    server
        .requests()
        .iter()
        .filter(|r| matches!(r, Record::Http { path, .. } if path == "/api/auth/refresh"))
        .count()
}

#[test]
fn the_fake_server_serves_a_fixture_by_range_and_it_decodes() {
    let rt = runtime();
    let (server, backend, id, size) = rt.block_on(served("vp9-opus.webm"));
    let cache = Arc::new(BlockCache::default());
    let fetch = Arc::new(HttpFile::new(backend.clone(), id.clone()));
    // Size unknown: learned from the first block's Content-Range.
    let range = RangeSource::open(
        fetch,
        &id,
        None,
        cache,
        rt.handle().clone(),
        Cancel::default(),
    )
    .expect("opens");
    assert_eq!(range.size(), size);
    let mut media = Media::open(range).expect("demuxes over HTTP");
    media.enable(0).expect("vp9");
    let mut frames = 0;
    while let Some(frame) = media.next_frame().expect("decodes") {
        if matches!(frame, Frame::Video(_)) {
            frames += 1;
        }
    }
    assert_eq!(frames, 20);
    let statuses = file_requests(&server);
    assert!(
        !statuses.is_empty() && statuses.iter().all(|s| *s == 206),
        "{statuses:?}"
    );

    // The access token runs out: one refresh, and reading goes on.
    server.expire_access_token();
    let before = refreshes(&server);
    let fetch = Arc::new(HttpFile::new(backend, id.clone()));
    let mut range = RangeSource::open(
        fetch,
        &id,
        Some(size),
        Arc::new(BlockCache::default()),
        rt.handle().clone(),
        Cancel::default(),
    )
    .unwrap();
    let mut bytes = Vec::new();
    range
        .read_to_end(&mut bytes)
        .expect("reads after a refresh");
    assert!(bytes == fixture("vp9-opus.webm"), "the bytes differ");
    assert_eq!(refreshes(&server) - before, 1);
    drop(server);
}

#[test]
fn a_fixture_plays_to_its_end_over_http() {
    let rt = runtime();
    let (server, backend, id, size) = rt.block_on(served("vp9-opus.webm"));
    let cache = Arc::new(BlockCache::default());
    let players = DesktopPlayers::new(
        Arc::new(VirtualIo::new()),
        http_opener(backend, cache.clone(), rt.handle().clone()),
    );
    let (tx, rx) = mpsc::channel();
    let tx = Mutex::new(tx);
    let player = players.open_with_sink(
        PlaybackSource {
            file_id: id,
            filename: "vp9-opus.webm".into(),
            mime_type: "video/webm".into(),
            size,
            has_thumbnail: false,
        },
        Arc::new(move |e| {
            let _ = tx.lock().unwrap().send(e);
        }),
        None,
    );
    player.play();
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        let left = deadline.saturating_duration_since(Instant::now());
        match rx.recv_timeout(left).expect("events until the end") {
            PlayerEvent::State(PlaybackState::Ended) => break,
            PlayerEvent::State(PlaybackState::Failed(error)) => panic!("failed: {error:?}"),
            _ => {}
        }
    }
    assert!(
        cache.bytes() > 0 && cache.bytes() <= BLOCK,
        "{} bytes cached",
        cache.bytes()
    );
    drop(player);
    let deadline = Instant::now() + Duration::from_secs(5);
    while cache.bytes() > 0 {
        assert!(
            Instant::now() < deadline,
            "the player's blocks were never freed"
        );
        std::thread::yield_now();
    }
    drop(server);
}
