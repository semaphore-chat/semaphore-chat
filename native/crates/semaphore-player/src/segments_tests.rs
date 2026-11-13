//! `segments.rs`'s pure parts: the timeline, placing units on it, seek points, the cache and the
//! retries. Decoding through real fixtures is in `tests/segments.rs`.

use super::*;
use crate::ts::{Demuxed, EsInfo, PTS_WRAP};
use std::sync::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};

const S: Duration = Duration::from_secs(1);

fn us(seconds: f64) -> i64 {
    (seconds * 1e6) as i64
}

#[test]
fn segments_start_at_the_sum_of_the_lengths_before_them() {
    let (starts, total) = starts_us(&[10 * S, 10 * S, Duration::from_millis(9_500)]);
    assert_eq!(starts, [0, us(10.0), us(20.0)]);
    assert_eq!(total, us(29.5));
    assert_eq!(starts_us(&[]), (vec![], 0));
}

#[test]
fn a_time_falls_in_the_last_segment_starting_at_or_before_it() {
    let starts = [0, us(10.0), us(20.0)];
    assert_eq!(segment_at(&starts, 0), 0);
    assert_eq!(segment_at(&starts, us(9.999_999)), 0);
    assert_eq!(segment_at(&starts, us(10.0)), 1);
    assert_eq!(segment_at(&starts, us(25.0)), 2);
    assert_eq!(segment_at(&starts, us(99.0)), 2, "past the end: the last");
    assert_eq!(segment_at(&starts, -5), 0, "before the start: the first");
    assert_eq!(segment_at(&[0], us(3.0)), 0);
}

#[test]
fn buffered_ranges_merge_adjacent_segments() {
    let starts = [0, us(10.0), us(20.0), us(30.0)];
    let total = us(40.0);
    assert_eq!(
        buffered_ranges(&[], &starts, total),
        Vec::<Range<f32>>::new()
    );
    assert_eq!(buffered_ranges(&[1], &starts, total), [0.25..0.5]);
    assert_eq!(
        buffered_ranges(&[0, 1, 3], &starts, total),
        [0.0..0.5, 0.75..1.0]
    );
    assert_eq!(buffered_ranges(&[0, 1, 2, 3], &starts, total), [0.0..1.0]);
    assert!(buffered_ranges(&[0], &[0], 0).is_empty());
}

fn bytes(n: usize) -> Arc<Vec<u8>> {
    Arc::new(vec![0; n])
}

#[test]
fn the_cache_evicts_least_recently_used_first_within_its_budget() {
    let mut cache = SegmentCache::new(30);
    cache.insert(0, bytes(10));
    cache.insert(1, bytes(10));
    cache.insert(2, bytes(10));
    assert_eq!(cache.indices(), [0, 1, 2]);
    // Reading 0 makes it the newest: 1 goes when 3 comes.
    assert!(cache.get(0).is_some());
    cache.insert(3, bytes(10));
    assert_eq!(cache.indices(), [0, 2, 3]);
    assert!(cache.get(1).is_none());
    assert_eq!(cache.bytes(), 30);
    // Inserting an index again replaces it.
    cache.insert(2, bytes(5));
    assert_eq!(cache.bytes(), 25);
    assert!(cache.contains(2) && !cache.contains(1));
}

#[test]
fn the_newest_segment_stays_even_over_the_budget() {
    let mut cache = SegmentCache::new(10);
    cache.insert(0, bytes(4));
    cache.insert(1, bytes(50));
    assert_eq!(cache.indices(), [1]);
    assert_eq!(cache.get(1).map(|b| b.len()), Some(50));
}

const V: u16 = 0x100;
const A: u16 = 0x101;

fn tracks() -> Vec<Track> {
    vec![
        Track {
            pid: V,
            stream_type: StreamType::H264,
        },
        Track {
            pid: A,
            stream_type: StreamType::AacAdts,
        },
    ]
}

fn unit(pid: u16, pts: Option<u64>, keyframe: bool) -> Unit {
    Unit {
        pid,
        pts,
        dts: pts,
        data: vec![pid as u8],
        keyframe,
    }
}

fn demuxed(units: Vec<Unit>) -> Demuxed {
    Demuxed {
        packet_size: 188,
        streams: vec![
            EsInfo {
                pid: V,
                stream_type: StreamType::H264,
            },
            EsInfo {
                pid: A,
                stream_type: StreamType::AacAdts,
            },
        ],
        units,
        skipped: 0,
    }
}

#[test]
fn a_segment_starts_at_its_first_video_pts_with_audio_ahead_kept_before_it() {
    // As ffmpeg's HLS muxer cuts (fixtures/ts): audio from 0.187 s before the keyframe.
    let d = demuxed(vec![
        unit(A, Some(1_027_200), true),
        unit(V, Some(1_044_000), true),
        unit(V, Some(1_053_000), false),
        unit(V, Some(1_048_500), false),
    ]);
    let placed = place(&d, &tracks(), us(10.0));
    let pts: Vec<_> = placed.iter().map(|p| p.pts_us).collect();
    assert_eq!(
        pts,
        [
            Some(us(10.0) - 186_666),
            Some(us(10.0)),
            Some(us(10.1)),
            Some(us(10.05))
        ]
    );
    assert_eq!(placed[0].stream, 1);
    assert_eq!(placed[1].stream, 0);
    assert!(placed[1].keyframe);
}

#[test]
fn the_earliest_video_pts_is_the_base_even_after_b_frames() {
    let d = demuxed(vec![unit(V, Some(9_000), true), unit(V, Some(0), false)]);
    let placed = place(&d, &tracks(), 0);
    assert_eq!(placed[0].pts_us, Some(100_000));
    assert_eq!(placed[1].pts_us, Some(0));
}

#[test]
fn placing_unwraps_the_33_bit_pts() {
    let d = demuxed(vec![
        unit(V, Some(PTS_WRAP - 4_500), true),
        unit(V, Some(4_500), false),
        unit(A, Some(PTS_WRAP - 9_000), true),
    ]);
    let placed = place(&d, &tracks(), us(20.0));
    assert_eq!(placed[0].pts_us, Some(us(20.0)));
    assert_eq!(placed[1].pts_us, Some(us(20.1)));
    assert_eq!(placed[2].pts_us, Some(us(19.95)));
}

#[test]
fn audio_alone_starts_at_its_first_pts() {
    let mut d = demuxed(vec![
        unit(A, Some(90_000), true),
        unit(A, Some(91_920), true),
    ]);
    d.streams.remove(0);
    let placed = place(&d, &tracks(), 0);
    assert_eq!(placed[0].pts_us, Some(0));
    assert_eq!(placed[1].pts_us, Some(21_333));
}

#[test]
fn units_of_unknown_pids_go_and_a_moved_pid_is_matched_by_type() {
    let mut d = demuxed(vec![unit(0x300, Some(0), true), unit(0x555, Some(0), true)]);
    d.streams = vec![
        EsInfo {
            pid: 0x300,
            stream_type: StreamType::H264,
        },
        EsInfo {
            pid: 0x555,
            stream_type: StreamType::Other(0x86),
        },
    ];
    let placed = place(&d, &tracks(), 0);
    assert_eq!(placed.len(), 1);
    assert_eq!(placed[0].stream, 0);
}

#[test]
fn a_segment_without_timestamps_places_nothing() {
    assert!(place(&demuxed(vec![unit(V, None, true)]), &tracks(), 0).is_empty());
}

fn placed(stream: usize, seconds: f64, keyframe: bool) -> Placed {
    Placed {
        stream,
        pts_us: Some(us(seconds)),
        dts_us: Some(us(seconds)),
        data: Vec::new(),
        keyframe,
    }
}

fn timeline() -> Vec<Placed> {
    vec![
        placed(1, 9.8, true),  // 0
        placed(0, 10.0, true), // 1
        placed(1, 10.0, true), // 2
        placed(0, 11.0, false),
        placed(1, 11.0, true), // 4
        placed(0, 12.0, true), // 5
        placed(1, 12.0, true), // 6
        placed(0, 13.0, false),
        placed(1, 13.0, true), // 8
    ]
}

#[test]
fn a_seek_starts_video_at_its_keyframe_and_audio_at_that_time() {
    let units = timeline();
    assert_eq!(seek_points(&units, 2, Some(0), us(12.5)), [5, 6]);
    assert_eq!(seek_points(&units, 2, Some(0), us(12.0)), [5, 6]);
    assert_eq!(seek_points(&units, 2, Some(0), us(11.9)), [1, 2]);
    // Before the first keyframe: the first keyframe; audio from the target.
    assert_eq!(seek_points(&units, 2, Some(0), us(9.9)), [1, 2]);
    assert_eq!(seek_points(&units, 2, Some(0), us(9.0)), [1, 0]);
}

#[test]
fn a_seek_without_video_starts_audio_at_or_before_the_target() {
    let units = timeline();
    assert_eq!(seek_points(&units, 2, None, us(11.5)), [3, 4]);
    assert_eq!(
        seek_points(&units, 2, None, us(0.0)),
        [1, 0],
        "before all: the first"
    );
    assert_eq!(seek_points(&[], 2, Some(0), 0), [0, 0]);
}

struct Flaky {
    calls: AtomicUsize,
    answers: Mutex<Vec<Result<Vec<u8>, FetchError>>>,
}

impl SegmentFetch for Flaky {
    fn fetch(&self, _: usize, _: &Cancel) -> Result<Vec<u8>, FetchError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        let mut answers = self.answers.lock().unwrap();
        if answers.len() > 1 {
            answers.remove(0)
        } else {
            answers[0].clone()
        }
    }
}

fn flaky(answers: Vec<Result<Vec<u8>, FetchError>>) -> Flaky {
    Flaky {
        calls: AtomicUsize::new(0),
        answers: Mutex::new(answers),
    }
}

#[test]
fn transient_failures_are_retried_three_times() {
    let ok = flaky(vec![
        Err(FetchError::Transient),
        Err(FetchError::Transient),
        Ok(vec![1]),
    ]);
    assert_eq!(fetch_with_retries(&ok, 0, &Cancel::default()), Ok(vec![1]));
    assert_eq!(ok.calls.load(Ordering::SeqCst), 3);

    let down = flaky(vec![Err(FetchError::Transient)]);
    assert_eq!(
        fetch_with_retries(&down, 0, &Cancel::default()),
        Err(FetchError::Transient)
    );
    assert_eq!(down.calls.load(Ordering::SeqCst), 1 + RETRIES as usize);
}

#[test]
fn refusals_are_not_retried_and_a_cancel_stops_at_once() {
    let refused = flaky(vec![Err(FetchError::Failed)]);
    assert_eq!(
        fetch_with_retries(&refused, 0, &Cancel::default()),
        Err(FetchError::Failed)
    );
    assert_eq!(refused.calls.load(Ordering::SeqCst), 1);

    let cancel = Cancel::default();
    cancel.cancel();
    let never = flaky(vec![Ok(vec![])]);
    assert_eq!(
        fetch_with_retries(&never, 0, &cancel),
        Err(FetchError::Cancelled)
    );
    assert_eq!(never.calls.load(Ordering::SeqCst), 0);
}
