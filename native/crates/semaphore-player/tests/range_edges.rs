//! The range reader at its edges: short answers, a size that is wrong either way, files that end
//! on or just past a block boundary, seeks out of range, and two players of one file.

use semaphore_player::Cancel;
use semaphore_player::range::{
    BLOCK, BlockCache, FetchError, FetchFuture, Fetched, RangeFetch, RangeSource,
};
use std::io::{Read, Seek, SeekFrom};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

/// A file served by range, as a server would: an end past the file is cut at the file's end.
/// The first `short` answers lose their last half.
struct File {
    bytes: Vec<u8>,
    calls: Mutex<Vec<(u64, u64)>>,
    short: AtomicUsize,
    /// What the answer says the size is.
    says_size: Mutex<Option<u64>>,
}

impl File {
    fn new(len: usize) -> Arc<Self> {
        Arc::new(Self {
            bytes: (0..len).map(|i| (i * 13 % 251) as u8).collect(),
            calls: Mutex::new(Vec::new()),
            short: AtomicUsize::new(0),
            says_size: Mutex::new(Some(len as u64)),
        })
    }

    fn calls(&self) -> usize {
        self.calls.lock().unwrap().len()
    }
}

impl RangeFetch for File {
    fn fetch(&self, start: u64, end: u64) -> FetchFuture {
        self.calls.lock().unwrap().push((start, end));
        let len = self.bytes.len() as u64;
        let result = if start >= len {
            Err(FetchError {
                retryable: false,
                message: "416".into(),
            })
        } else {
            let end = end.min(len - 1);
            let mut bytes = self.bytes[start as usize..=end as usize].to_vec();
            if self
                .short
                .try_update(Ordering::SeqCst, Ordering::SeqCst, |n| n.checked_sub(1))
                .is_ok()
            {
                bytes.truncate(bytes.len() / 2);
            }
            Ok(Fetched {
                bytes,
                size: *self.says_size.lock().unwrap(),
            })
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

fn open(
    file: &Arc<File>,
    size: Option<u64>,
    cache: &Arc<BlockCache>,
    rt: &tokio::runtime::Runtime,
) -> std::io::Result<RangeSource> {
    RangeSource::open(
        file.clone(),
        "file",
        size,
        cache.clone(),
        rt.handle().clone(),
        Cancel::default(),
    )
}

fn read_all(source: &mut RangeSource) -> std::io::Result<Vec<u8>> {
    let mut out = Vec::new();
    source.read_to_end(&mut out)?;
    Ok(out)
}

#[test]
fn files_ending_on_and_just_past_a_block_boundary_read_whole() {
    let rt = runtime();
    for len in [1, BLOCK - 1, BLOCK, BLOCK + 1, 2 * BLOCK] {
        let file = File::new(len);
        let cache = Arc::new(BlockCache::default());
        let mut source = open(&file, Some(len as u64), &cache, &rt).unwrap();
        assert!(
            read_all(&mut source).unwrap() == file.bytes,
            "{len} bytes differ"
        );
        assert_eq!(file.calls(), len.div_ceil(BLOCK), "{len}");
    }
}

#[test]
fn an_empty_file_reads_as_empty_without_asking() {
    let rt = runtime();
    let file = File::new(0);
    let cache = Arc::new(BlockCache::default());
    let mut source = open(&file, Some(0), &cache, &rt).unwrap();
    assert!(read_all(&mut source).unwrap().is_empty());
    assert_eq!(file.calls(), 0);
}

#[test]
fn a_size_smaller_than_the_file_reads_only_that_much() {
    let rt = runtime();
    let file = File::new(BLOCK + 100);
    let cache = Arc::new(BlockCache::default());
    let mut source = open(&file, Some(BLOCK as u64 + 10), &cache, &rt).unwrap();
    let out = read_all(&mut source).unwrap();
    assert_eq!(out.len(), BLOCK + 10);
    assert!(out[..] == file.bytes[..BLOCK + 10]);
}

#[test]
fn a_size_larger_than_the_file_fails_at_the_end_instead_of_hanging() {
    let rt = runtime();
    let file = File::new(BLOCK + 100);
    let cache = Arc::new(BlockCache::default());
    let mut source = open(&file, Some(3 * BLOCK as u64), &cache, &rt).unwrap();
    let mut out = vec![0u8; BLOCK + 100];
    source.read_exact(&mut out).unwrap();
    assert!(out == file.bytes);
    // The size promised more than there is.
    let mut more = [0u8; 16];
    assert!(source.read(&mut more).is_err());
}

#[test]
fn the_size_is_learned_from_the_first_block_and_a_server_that_wont_say_is_refused() {
    let rt = runtime();
    let file = File::new(BLOCK + 5);
    let cache = Arc::new(BlockCache::default());
    let mut source = open(&file, None, &cache, &rt).unwrap();
    assert_eq!(source.size(), BLOCK as u64 + 5);
    assert!(read_all(&mut source).unwrap() == file.bytes);
    assert_eq!(file.calls(), 2, "the first block isn't fetched twice");

    let silent = File::new(10);
    *silent.says_size.lock().unwrap() = None;
    assert!(open(&silent, None, &cache, &rt).is_err());
}

#[test]
fn seeks_past_the_end_read_nothing_and_seeks_before_the_start_are_refused() {
    let rt = runtime();
    let file = File::new(100);
    let cache = Arc::new(BlockCache::default());
    let mut source = open(&file, Some(100), &cache, &rt).unwrap();
    assert_eq!(source.seek(SeekFrom::Start(500)).unwrap(), 500);
    assert_eq!(source.read(&mut [0u8; 8]).unwrap(), 0);
    assert!(source.seek(SeekFrom::End(-101)).is_err());
    source.seek(SeekFrom::Start(10)).unwrap();
    assert!(source.seek(SeekFrom::Current(-11)).is_err());
    assert_eq!(source.seek(SeekFrom::Current(-10)).unwrap(), 0);
    let mut empty: [u8; 0] = [];
    assert_eq!(source.read(&mut empty).unwrap(), 0);
}

#[test]
fn two_players_of_one_file_share_blocks_and_one_leaving_does_not_break_the_other() {
    let rt = runtime();
    let file = File::new(3 * BLOCK);
    let cache = Arc::new(BlockCache::default());
    let mut first = open(&file, Some(3 * BLOCK as u64), &cache, &rt).unwrap();
    let mut second = open(&file, Some(3 * BLOCK as u64), &cache, &rt).unwrap();
    assert!(read_all(&mut first).unwrap() == file.bytes);
    drop(first);
    assert!(read_all(&mut second).unwrap() == file.bytes);
    drop(second);
    assert_eq!(cache.bytes(), 0);
}

#[test]
fn a_short_answer_is_asked_again_rather_than_kept() {
    let rt = runtime();
    let file = File::new(2 * BLOCK);
    file.short.store(1, Ordering::SeqCst);
    let cache = Arc::new(BlockCache::default());
    let mut source = open(&file, Some(2 * BLOCK as u64), &cache, &rt).unwrap();
    assert!(read_all(&mut source).unwrap() == file.bytes);
}

#[test]
fn answers_that_stay_short_fail_the_read_and_are_not_cached() {
    let rt = runtime();
    let file = File::new(BLOCK);
    file.short.store(100, Ordering::SeqCst);
    let cache = Arc::new(BlockCache::default());
    let mut source = open(&file, Some(BLOCK as u64), &cache, &rt).unwrap();
    assert!(read_all(&mut source).is_err());
    assert_eq!(cache.bytes(), 0, "a short block was kept");
    // Once the server answers in full, the next read works.
    file.short.store(0, Ordering::SeqCst);
    source.seek(SeekFrom::Start(0)).unwrap();
    assert!(read_all(&mut source).unwrap() == file.bytes);
}
