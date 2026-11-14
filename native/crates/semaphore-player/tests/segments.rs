//! The replay preview through the real decoders: the committed HLS fixtures (fixtures/ts, made by
//! fixtures/gen.sh) served by a fake [`SegmentFetch`], decoded by [`Media::open_segments`] and
//! played by [`DesktopPlayers`] into the virtual audio device. Three 10 s segments: red with a
//! 440 Hz tone, green with 660 Hz, blue with 880 Hz; a keyframe every 2 s. Run with and without
//! the `aac` feature (on by default; `--no-default-features` turns it off): without it the AAC
//! stream is refused and video plays alone. A segment whose ADTS headers say AAC Main (not LC)
//! is refused the same way, with the video alone.

use semaphore_core::player::{
    MediaPlayer, PlaybackSource, PlaybackState, PlayerError, PlayerEvent,
};
use semaphore_media_livekit::audio::virtual_io::VirtualIo;
use semaphore_player::{
    Cancel, Codec, DesktopPlayers, Error, FetchError, Frame, Kind, Media, Nv12Frame, Opened,
    Opener, SegmentFetch, VideoSink,
};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const S: Duration = Duration::from_secs(1);
const AAC: bool = cfg!(feature = "aac");

fn fixture(name: &str) -> Vec<u8> {
    let path = format!("{}/fixtures/ts/{name}", env!("CARGO_MANIFEST_DIR"));
    std::fs::read(&path).unwrap_or_else(|error| panic!("{path}: {error}"))
}

/// Serves segments from memory and records which were asked for.
struct Segments {
    files: Vec<Result<Vec<u8>, FetchError>>,
    asked: Mutex<Vec<usize>>,
}

impl Segments {
    fn new(files: Vec<Result<Vec<u8>, FetchError>>) -> Arc<Self> {
        Arc::new(Self {
            files,
            asked: Mutex::new(Vec::new()),
        })
    }

    fn fixtures() -> Arc<Self> {
        Self::new(
            ["seg0.ts", "seg1.ts", "seg2.ts"]
                .iter()
                .map(|f| Ok(fixture(f)))
                .collect(),
        )
    }

    fn asked(&self) -> Vec<usize> {
        self.asked.lock().unwrap().clone()
    }
}

impl SegmentFetch for Segments {
    fn fetch(&self, index: usize, _: &Cancel) -> Result<Vec<u8>, FetchError> {
        self.asked.lock().unwrap().push(index);
        self.files
            .get(index)
            .cloned()
            .unwrap_or(Err(FetchError::Failed))
    }
}

fn open(fetch: Arc<Segments>, start: Duration) -> Result<Media, Error> {
    let n = fetch.files.len();
    Media::open_segments(fetch, vec![10 * S; n], start, Cancel::default(), None)
}

/// Enables video, and audio when the build decodes AAC; checks AAC is refused otherwise.
fn enable_all(media: &mut Media) {
    let streams = media.streams();
    for (i, stream) in streams.iter().enumerate() {
        match (stream.kind, stream.codec) {
            (Kind::Video, Codec::H264) => media.enable(i).unwrap(),
            (Kind::Audio, Codec::Aac) if AAC => media.enable(i).unwrap(),
            (Kind::Audio, _) => assert_eq!(media.enable(i), Err(Error::UnsupportedCodec)),
            _ => {}
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum Colour {
    Red,
    Green,
    Blue,
}

/// The centre pixel of an I420 frame, by its chroma.
fn colour(y: u8, u: u8, v: u8) -> Option<Colour> {
    let near = |a: u8, b: u8| (i32::from(a) - i32::from(b)).abs() <= 16;
    if near(y, 81) && near(u, 90) && near(v, 240) {
        Some(Colour::Red)
    } else if near(y, 81) && near(u, 91) && near(v, 81) {
        Some(Colour::Green)
    } else if near(y, 41) && near(u, 240) && near(v, 110) {
        Some(Colour::Blue)
    } else {
        None
    }
}

#[derive(Default)]
struct Decoded {
    /// (pts, colour) in output order.
    video: Vec<(Duration, Option<Colour>)>,
    /// Channel 0 of each audio frame: (pts, samples).
    audio: Vec<(Duration, Vec<f32>)>,
    rate: u32,
    channels: u32,
}

fn decode(media: &mut Media, limit: usize) -> Decoded {
    let mut out = Decoded::default();
    for _ in 0..limit {
        match media.next_frame().unwrap() {
            Some(Frame::Video(f)) => {
                let (x, y) = (f.width as usize / 2, f.height as usize / 2);
                let p =
                    |i: usize, xx: usize, yy: usize| f.planes[i].data[yy * f.planes[i].stride + xx];
                let c = colour(p(0, x, y), p(1, x / 2, y / 2), p(2, x / 2, y / 2));
                out.video.push((us(f.pts_us), c));
            }
            Some(Frame::Audio(f)) => {
                out.rate = f.sample_rate;
                out.channels = f.channels;
                let mono = f
                    .samples
                    .chunks_exact(f.channels as usize)
                    .map(|c| c[0])
                    .collect();
                out.audio.push((us(f.pts_us), mono));
            }
            None => break,
        }
    }
    out
}

fn us(pts: Option<i64>) -> Duration {
    Duration::from_micros(u64::try_from(pts.expect("a pts")).unwrap_or(0))
}

/// Zero crossings a second of the audio between `from` and `to`, at `rate`.
fn crossings(audio: &[(Duration, Vec<f32>)], from: Duration, to: Duration, rate: u32) -> f64 {
    let samples: Vec<f32> = audio
        .iter()
        .filter(|(at, _)| *at >= from && *at < to)
        .flat_map(|(_, s)| s.iter().copied())
        .collect();
    let c = samples
        .windows(2)
        .filter(|w| (w[0] < 0.0) != (w[1] < 0.0))
        .count();
    c as f64 / (samples.len() as f64 / f64::from(rate))
}

fn colour_at(video: &[(Duration, Option<Colour>)], at: Duration) -> Option<Colour> {
    video.iter().find(|(t, _)| *t >= at).and_then(|(_, c)| *c)
}

#[test]
fn the_streams_and_the_timeline_come_from_the_playlist_and_the_first_segment() {
    let media = open(Segments::fixtures(), Duration::ZERO).unwrap();
    assert_eq!(media.container(), "mpegts");
    assert_eq!(media.duration(), Some(30 * S));
    assert_eq!(media.initial_position(), Duration::ZERO);
    let streams = media.streams();
    assert_eq!(streams.len(), 2);
    assert_eq!(
        (streams[0].kind, streams[0].codec),
        (Kind::Video, Codec::H264)
    );
    assert_eq!((streams[0].width, streams[0].height), (64, 64));
    assert_eq!(
        (streams[1].kind, streams[1].codec),
        (Kind::Audio, Codec::Aac)
    );
    assert_eq!((streams[1].sample_rate, streams[1].channels), (48_000, 2));
}

#[test]
fn all_three_segments_play_in_order_with_their_colours_and_tones() {
    let fetch = Segments::fixtures();
    let mut media = open(fetch.clone(), Duration::ZERO).unwrap();
    enable_all(&mut media);
    let out = decode(&mut media, 10_000);

    let mut times: Vec<Duration> = out.video.iter().map(|(t, _)| *t).collect();
    assert_eq!(times.len(), 300, "10 fps for 30 s");
    times.sort();
    assert_eq!(times[0], Duration::ZERO);
    assert_eq!(times[299], Duration::from_millis(29_900));
    assert!(
        times
            .windows(2)
            .all(|w| w[1] - w[0] == Duration::from_millis(100)),
        "one frame each 100 ms, no gap or overlap at the boundaries"
    );
    for (at, want) in [
        (0.0, Colour::Red),
        (9.9, Colour::Red),
        (10.0, Colour::Green),
        (19.9, Colour::Green),
        (20.0, Colour::Blue),
        (29.9, Colour::Blue),
    ] {
        assert_eq!(
            colour_at(&out.video, Duration::from_secs_f64(at)),
            Some(want),
            "at {at} s"
        );
    }
    assert_eq!(fetch.asked(), [0, 1, 2], "each segment fetched once");

    if AAC {
        assert_eq!((out.rate, out.channels), (48_000, 2));
        let audio_start = out.audio[0].0;
        assert!(
            audio_start < Duration::from_millis(50),
            "audio starts with the video: {audio_start:?}"
        );
        for (from, to, tone) in [(1.0, 9.0, 440.0), (11.0, 19.0, 660.0), (21.0, 29.0, 880.0)] {
            let c = crossings(
                &out.audio,
                Duration::from_secs_f64(from),
                Duration::from_secs_f64(to),
                out.rate,
            );
            assert!(
                (c - 2.0 * tone).abs() < 2.0 * tone * 0.02,
                "{from}-{to} s: {c} crossings/s, want {}",
                2.0 * tone
            );
        }
        let samples: usize = out.audio.iter().map(|(_, s)| s.len()).sum();
        let seconds = samples as f64 / 48_000.0;
        assert!((seconds - 30.0).abs() < 0.3, "{seconds} s of audio");
    } else {
        assert!(out.audio.is_empty());
    }
    assert_eq!(media.skipped_packets(), 0);
}

#[test]
fn a_seek_lands_in_the_right_segment_from_the_keyframe_before_it() {
    let mut media = open(Segments::fixtures(), Duration::ZERO).unwrap();
    enable_all(&mut media);
    media.seek(Duration::from_millis(15_300)).unwrap();
    let out = decode(&mut media, 200);
    let first = out.video.iter().map(|(t, _)| *t).min().unwrap();
    assert_eq!(first, 14 * S, "decoding starts at the keyframe at 14 s");
    assert_eq!(
        colour_at(&out.video, Duration::from_millis(15_300)),
        Some(Colour::Green)
    );
    if AAC {
        assert!(out.audio[0].0 >= 14 * S - Duration::from_millis(30));
        assert!(out.audio[0].0 <= 14 * S + Duration::from_millis(30));
    }

    // And back into the first segment.
    media.seek(Duration::from_millis(4_000)).unwrap();
    let out = decode(&mut media, 20);
    assert_eq!(out.video.iter().map(|(t, _)| *t).min(), Some(4 * S));
    assert_eq!(colour_at(&out.video, 4 * S), Some(Colour::Red));
}

#[test]
fn a_seek_to_a_boundary_and_past_the_end() {
    let mut media = open(Segments::fixtures(), Duration::ZERO).unwrap();
    enable_all(&mut media);
    media.seek(20 * S).unwrap();
    let out = decode(&mut media, 10);
    assert_eq!(out.video.iter().map(|(t, _)| *t).min(), Some(20 * S));
    assert_eq!(colour_at(&out.video, 20 * S), Some(Colour::Blue));

    media.seek(99 * S).unwrap();
    let out = decode(&mut media, 10_000);
    assert!(
        out.video.iter().all(|(t, _)| *t >= 28 * S),
        "the last keyframe, then the end"
    );
    assert!(media.next_frame().unwrap().is_none());
}

#[test]
fn opening_at_a_later_start_fetches_that_segment_first() {
    let fetch = Segments::fixtures();
    let mut media = open(fetch.clone(), Duration::from_secs(21)).unwrap();
    assert_eq!(media.initial_position(), Duration::from_secs(21));
    assert_eq!(fetch.asked(), [2]);
    enable_all(&mut media);
    let out = decode(&mut media, 10_000);
    assert_eq!(out.video.iter().map(|(t, _)| *t).min(), Some(20 * S));
    assert_eq!(
        colour_at(&out.video, Duration::from_secs(21)),
        Some(Colour::Blue)
    );
    assert_eq!(fetch.asked(), [2], "the last segment: nothing to prefetch");
}

#[test]
fn the_next_segment_is_prefetched_and_a_looped_range_is_fetched_once() {
    let fetch = Segments::fixtures();
    let mut media = open(fetch.clone(), Duration::ZERO).unwrap();
    enable_all(&mut media);
    // Into segment 1: segment 2 is asked for before it's needed.
    media.seek(12 * S).unwrap();
    decode(&mut media, 5);
    let deadline = Instant::now() + Duration::from_secs(10);
    while !fetch.asked().contains(&2) {
        assert!(
            Instant::now() < deadline,
            "no prefetch: {:?}",
            fetch.asked()
        );
        std::thread::yield_now();
    }
    for _ in 0..3 {
        media.seek(8 * S).unwrap();
        decode(&mut media, 60);
    }
    let mut asked = fetch.asked();
    asked.sort_unstable();
    assert_eq!(asked, [0, 1, 2]);
}

#[test]
fn m2ts_packets_play_like_plain_ts() {
    let fetch = Segments::new(vec![
        Ok(fixture("seg0.ts")),
        Ok(fixture("seg1-m2ts.ts")),
        Ok(fixture("seg2.ts")),
    ]);
    let mut media = open(fetch, 10 * S).unwrap();
    enable_all(&mut media);
    let out = decode(&mut media, 10_000);
    assert_eq!(out.video.iter().map(|(t, _)| *t).min(), Some(10 * S));
    assert_eq!(
        colour_at(&out.video, Duration::from_secs(15)),
        Some(Colour::Green)
    );
    assert_eq!(
        colour_at(&out.video, Duration::from_secs(25)),
        Some(Colour::Blue)
    );
    assert_eq!(out.video.len(), 200);
}

#[test]
fn opus_in_ts_is_listed_and_refused_while_the_video_plays() {
    let fetch = Segments::new(vec![Ok(fixture("h264-opus.ts"))]);
    let mut media =
        Media::open_segments(fetch, vec![2 * S], Duration::ZERO, Cancel::default(), None).unwrap();
    let streams = media.streams();
    assert_eq!(
        (streams[1].kind, streams[1].codec),
        (Kind::Audio, Codec::Opus)
    );
    assert_eq!(media.enable(1), Err(Error::UnsupportedCodec));
    media.enable(0).unwrap();
    let out = decode(&mut media, 1000);
    assert_eq!(out.video.len(), 20);
    assert!(out.audio.is_empty());
}

#[test]
fn aac_main_in_ts_is_listed_and_refused_while_the_video_plays() {
    // The ADTS headers say Main (object type 1), which no build may decode (docs/player.md).
    let fetch = Segments::new(vec![Ok(fixture("h264-aac-main.ts"))]);
    let mut media =
        Media::open_segments(fetch, vec![2 * S], Duration::ZERO, Cancel::default(), None).unwrap();
    let streams = media.streams();
    assert_eq!(
        (streams[0].kind, streams[0].codec),
        (Kind::Video, Codec::H264)
    );
    assert_eq!(
        (streams[1].kind, streams[1].codec),
        (Kind::Audio, Codec::Aac)
    );
    assert_eq!(media.enable(1), Err(Error::UnsupportedCodec));
    assert!(media.enable(0).is_ok());
    let out = decode(&mut media, 1000);
    assert_eq!(out.video.len(), 20, "the video still plays");
    assert!(out.audio.is_empty());
    assert_eq!(colour_at(&out.video, Duration::ZERO), Some(Colour::Red));
    assert_eq!(
        colour_at(&out.video, Duration::from_millis(1500)),
        Some(Colour::Blue)
    );
}

#[test]
fn the_engine_says_a_main_preview_has_no_sound() {
    let fetch = Segments::new(vec![Ok(fixture("h264-aac-main.ts"))]);
    let (players, speaker) = players_for(fetch, Duration::ZERO, vec![2 * S]);
    let surface = Arc::new(Surface::default());
    let (events, rx) = events();
    let player = players.open_with_sink(
        source(),
        events,
        Some(surface.clone() as Arc<dyn VideoSink>),
    );
    let seen = until(&rx, "metadata", |e| matches!(e, PlayerEvent::Metadata(_)));
    let metadata = seen
        .iter()
        .find_map(|e| match e {
            PlayerEvent::Metadata(m) => Some(m.clone()),
            _ => None,
        })
        .unwrap();
    assert!(metadata.has_video);
    assert!(!metadata.has_audio, "AAC Main is not decodable sound");
    player.play();
    until(&rx, "the end", |e| {
        *e == PlayerEvent::State(PlaybackState::Ended)
    });
    assert!(surface.uploads.lock().unwrap().len() >= 19);
    assert_eq!(
        speaker.lock().unwrap().len(),
        0,
        "nothing reaches the speaker"
    );
}

#[test]
fn an_unreadable_segment_is_skipped_and_a_truncated_one_plays_what_it_has() {
    let garbage = vec![0x5Au8; 50_000];
    let fetch = Segments::new(vec![
        Ok(fixture("seg0.ts")),
        Ok(garbage),
        Ok(fixture("seg2.ts")),
    ]);
    let mut media = open(fetch, Duration::ZERO).unwrap();
    enable_all(&mut media);
    let out = decode(&mut media, 10_000);
    assert_eq!(out.video.len(), 200, "segments 0 and 2");
    assert!(out.video.iter().all(|(t, _)| *t < 10 * S || *t >= 20 * S));
    assert!(media.skipped_packets() >= 1);

    let seg1 = fixture("seg1.ts");
    let half = seg1[..seg1.len() / 2].to_vec();
    let fetch = Segments::new(vec![
        Ok(fixture("seg0.ts")),
        Ok(half),
        Ok(fixture("seg2.ts")),
    ]);
    let mut media = open(fetch, Duration::ZERO).unwrap();
    enable_all(&mut media);
    let out = decode(&mut media, 10_000);
    let middle = out
        .video
        .iter()
        .filter(|(t, _)| *t >= 10 * S && *t < 20 * S)
        .count();
    assert!(
        middle > 0 && middle < 100,
        "{middle} frames of the cut segment"
    );
    assert_eq!(
        colour_at(&out.video, Duration::from_secs(25)),
        Some(Colour::Blue)
    );
}

#[test]
fn fetch_failures_are_io_errors_and_bad_input_is_refused() {
    let fetch = Segments::new(vec![Err(FetchError::Failed)]);
    assert_eq!(open(fetch, Duration::ZERO).err(), Some(Error::Io));

    let fetch = Segments::new(vec![Ok(fixture("seg0.ts")), Err(FetchError::Failed)]);
    let mut media = open(fetch, Duration::ZERO).unwrap();
    enable_all(&mut media);
    let error = loop {
        match media.next_frame() {
            Ok(Some(_)) => {}
            Ok(None) => panic!("ended without the second segment"),
            Err(error) => break error,
        }
    };
    assert_eq!(error, Error::Io);

    let fetch = Segments::new(vec![Ok(b"#EXTM3U\n".repeat(100))]);
    assert_eq!(
        open(fetch, Duration::ZERO).err(),
        Some(Error::UnsupportedContainer)
    );
    let none = Media::open_segments(
        Segments::fixtures(),
        vec![],
        Duration::ZERO,
        Cancel::default(),
        None,
    );
    assert_eq!(none.err(), Some(Error::Invalid));
}

// The engine: the segments through DesktopPlayers, as the trim preview will open them.

#[derive(Default)]
struct Surface {
    uploads: Mutex<Vec<Option<Colour>>>,
    removed: AtomicBool,
}

impl VideoSink for Surface {
    fn upload(&self, frame: &Nv12Frame<'_>) {
        let (x, y) = (frame.width as usize / 2, frame.height as usize / 2);
        let luma = frame.y[y * frame.y_stride as usize + x];
        let at = (y / 2) * frame.uv_stride as usize + (x / 2) * 2;
        let c = colour(luma, frame.uv[at], frame.uv[at + 1]);
        self.uploads.lock().unwrap().push(c);
    }

    fn remove(&self) {
        self.removed.store(true, Ordering::SeqCst);
    }
}

fn source() -> PlaybackSource {
    PlaybackSource::replay_buffer("s1", Duration::ZERO)
}

fn players(fetch: Arc<Segments>, start: Duration) -> (DesktopPlayers, Arc<Mutex<Vec<i16>>>) {
    players_for(fetch, start, vec![10 * S; 3])
}

fn players_for(
    fetch: Arc<Segments>,
    start: Duration,
    durations: Vec<Duration>,
) -> (DesktopPlayers, Arc<Mutex<Vec<i16>>>) {
    let io = VirtualIo::new();
    let speaker = Arc::new(Mutex::new(Vec::new()));
    let heard = speaker.clone();
    io.set_speaker(Box::new(move |frame| {
        heard.lock().unwrap().extend_from_slice(frame)
    }));
    let opener: Opener = Arc::new(
        move |_: &PlaybackSource, _: &Cancel, _: &semaphore_player::BufferedReport| {
            Ok(Opened::Segments {
                fetch: fetch.clone(),
                durations: durations.clone(),
                start,
            })
        },
    );
    (DesktopPlayers::new(Arc::new(io), opener), speaker)
}

fn until(
    rx: &Receiver<PlayerEvent>,
    what: &str,
    mut done: impl FnMut(&PlayerEvent) -> bool,
) -> Vec<PlayerEvent> {
    let deadline = Instant::now() + Duration::from_secs(30);
    let mut seen = Vec::new();
    loop {
        match rx.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
            Ok(event) => {
                let matched = done(&event);
                seen.push(event);
                if matched {
                    return seen;
                }
            }
            Err(_) => panic!("no {what} within the deadline; saw {seen:?}"),
        }
    }
}

fn events() -> (
    Arc<dyn Fn(PlayerEvent) + Send + Sync>,
    Receiver<PlayerEvent>,
) {
    let (tx, rx) = mpsc::channel();
    let tx = Mutex::new(tx);
    (
        Arc::new(move |e| {
            let _ = tx.lock().unwrap().send(e);
        }),
        rx,
    )
}

#[test]
fn the_engine_opens_at_the_start_shows_its_poster_and_plays_to_the_end() {
    let (players, speaker) = players(Segments::fixtures(), Duration::from_secs(27));
    let surface = Arc::new(Surface::default());
    let (events, rx) = events();
    let player = players.open_with_sink(
        source(),
        events,
        Some(surface.clone() as Arc<dyn VideoSink>),
    );
    let opening = until(&rx, "metadata", |e| matches!(e, PlayerEvent::Metadata(_)));
    // The opened segment is reported fetched (before the metadata: the open fetches it).
    assert!(
        opening
            .iter()
            .any(|e| matches!(e, PlayerEvent::Buffered(r) if *r == [0.6666667..1.0])),
        "{opening:?}"
    );
    let seen = opening;
    let metadata = seen
        .iter()
        .find_map(|e| match e {
            PlayerEvent::Metadata(m) => Some(m.clone()),
            _ => None,
        })
        .unwrap();
    assert_eq!(metadata.duration, Some(30 * S));
    assert!(metadata.has_video);
    assert_eq!(metadata.has_audio, AAC);
    assert_eq!((metadata.width, metadata.height), (64, 64));
    // The poster: the frame at the start, not at zero.
    let seen = until(&rx, "the poster's position", |e| {
        matches!(e, PlayerEvent::Position(_))
    });
    assert!(
        seen.contains(&PlayerEvent::Position(Duration::from_secs(27))),
        "{seen:?}"
    );
    assert_eq!(
        surface.uploads.lock().unwrap().first().copied().flatten(),
        Some(Colour::Blue)
    );

    player.play();
    until(&rx, "the end", |e| {
        *e == PlayerEvent::State(PlaybackState::Ended)
    });
    assert!(surface.uploads.lock().unwrap().len() >= 25);
    if AAC {
        let heard = speaker.lock().unwrap().iter().filter(|s| **s != 0).count();
        assert!(heard > 48_000 * 2, "about 3 s of stereo: {heard}");
    }
    drop(player);
    let deadline = Instant::now() + Duration::from_secs(5);
    while !surface.removed.load(Ordering::SeqCst) {
        assert!(Instant::now() < deadline, "surface not removed");
        std::thread::yield_now();
    }
}

#[test]
fn the_engine_seeks_across_segments_while_paused() {
    let (players, _) = players(Segments::fixtures(), Duration::ZERO);
    let surface = Arc::new(Surface::default());
    let (events, rx) = events();
    let player = players.open_with_sink(
        source(),
        events,
        Some(surface.clone() as Arc<dyn VideoSink>),
    );
    until(&rx, "the poster", |e| matches!(e, PlayerEvent::Position(_)));
    player.seek(Duration::from_millis(12_500));
    until(&rx, "the seek's landing", |e| {
        *e == PlayerEvent::Position(Duration::from_millis(12_500))
    });
    assert_eq!(
        surface.uploads.lock().unwrap().last().copied().flatten(),
        Some(Colour::Green)
    );
}

#[test]
fn a_failed_fetch_is_a_network_error() {
    let (players, _) = players(Segments::new(vec![Err(FetchError::Failed)]), Duration::ZERO);
    let (events, rx) = events();
    let _player = players.open_with_sink(source(), events, None);
    until(&rx, "the failure", |e| {
        *e == PlayerEvent::State(PlaybackState::Failed(PlayerError::Network))
    });
}
