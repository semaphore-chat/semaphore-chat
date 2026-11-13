//! The real pipeline on the committed fixtures: decode thread, audio ring into the virtual audio
//! device (a clock, no sound card), video into a fake surface that records each upload. Nothing
//! reaches the host's speakers or display. Waits are on events, each with a deadline.

use semaphore_core::player::{
    MediaPlayer, PlaybackSource, PlaybackState, PlayerError, PlayerEvent, PlayerFactory,
};
use semaphore_media_livekit::audio::virtual_io::VirtualIo;
use semaphore_player::{DesktopPlayers, Nv12Frame, Opener, Player, VideoSink};
use std::io::Cursor;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const DEADLINE: Duration = Duration::from_secs(15);

fn fixture(name: &str) -> Vec<u8> {
    let path = format!("{}/fixtures/{name}", env!("CARGO_MANIFEST_DIR"));
    std::fs::read(&path).unwrap_or_else(|error| panic!("{path}: {error}"))
}

/// Each upload's centre colour (Y, Cb, Cr).
#[derive(Default)]
struct Surface {
    uploads: Mutex<Vec<[f64; 3]>>,
    removed: AtomicBool,
}

impl VideoSink for Surface {
    fn upload(&self, frame: &Nv12Frame<'_>) {
        let (x, y) = (frame.width as usize / 2, frame.height as usize / 2);
        let luma = frame.y[y * frame.y_stride as usize + x];
        let at = (y / 2) * frame.uv_stride as usize + (x / 2) * 2;
        let colour = [
            f64::from(luma),
            f64::from(frame.uv[at]),
            f64::from(frame.uv[at + 1]),
        ];
        self.uploads.lock().unwrap().push(colour);
    }

    fn remove(&self) {
        self.removed.store(true, Ordering::SeqCst);
    }
}

impl Surface {
    fn count(&self) -> usize {
        self.uploads.lock().unwrap().len()
    }

    fn last(&self) -> [f64; 3] {
        *self.uploads.lock().unwrap().last().expect("an upload")
    }
}

const RED: [f64; 3] = [81.0, 90.0, 240.0];
const BLUE: [f64; 3] = [41.0, 240.0, 110.0];

fn assert_colour(what: &str, got: [f64; 3], want: [f64; 3]) {
    assert!(
        got.iter().zip(want).all(|(g, w)| (g - w).abs() <= 14.0),
        "{what}: {got:?}, want about {want:?}"
    );
}

struct Rig {
    players: DesktopPlayers,
    speaker: Arc<Mutex<Vec<i16>>>,
}

impl Rig {
    fn new() -> Self {
        let io = VirtualIo::new();
        let speaker = Arc::new(Mutex::new(Vec::new()));
        let heard = speaker.clone();
        io.set_speaker(Box::new(move |frame| {
            heard.lock().unwrap().extend_from_slice(frame);
        }));
        let opener: Opener = Arc::new(
            |source: &PlaybackSource,
             _: &semaphore_player::Cancel,
             buffered: &semaphore_player::BufferedReport| {
                if source.file_id == "missing" {
                    return Err(PlayerError::Network);
                }
                buffered.full();
                Ok(semaphore_player::Opened::Bytes(Box::new(Cursor::new(
                    fixture(&source.file_id),
                ))))
            },
        );
        Self {
            players: DesktopPlayers::new(Arc::new(io), opener),
            speaker,
        }
    }

    fn open(&self, file: &str, sink: Option<Arc<Surface>>) -> (Player, Receiver<PlayerEvent>) {
        let (tx, rx) = mpsc::channel();
        let tx = Mutex::new(tx);
        let events = Arc::new(move |event: PlayerEvent| {
            let _ = tx.lock().unwrap().send(event);
        });
        let sink = sink.map(|s| s as Arc<dyn VideoSink>);
        (self.players.open_with_sink(source(file), events, sink), rx)
    }

    /// What the speaker played, from the first to the last non-silent sample.
    fn heard(&self) -> Vec<i16> {
        let all = self.speaker.lock().unwrap().clone();
        let first = all.iter().position(|s| *s != 0).unwrap_or(0);
        let last = all.iter().rposition(|s| *s != 0).map_or(0, |i| i + 1);
        all[first..last.max(first)].to_vec()
    }
}

fn source(file: &str) -> PlaybackSource {
    PlaybackSource {
        file_id: file.into(),
        filename: file.into(),
        mime_type: "video/webm".into(),
        size: 0,
        has_thumbnail: false,
    }
}

/// Events until one matches, or panics at the deadline.
fn until(
    rx: &Receiver<PlayerEvent>,
    what: &str,
    mut done: impl FnMut(&PlayerEvent) -> bool,
) -> Vec<PlayerEvent> {
    let deadline = Instant::now() + DEADLINE;
    let mut seen = Vec::new();
    loop {
        let left = deadline.saturating_duration_since(Instant::now());
        match rx.recv_timeout(left) {
            Ok(event) => {
                let matched = done(&event);
                seen.push(event);
                if matched {
                    return seen;
                }
            }
            Err(_) => panic!("timed out waiting for {what}; saw {seen:?}"),
        }
    }
}

fn state(want: PlaybackState) -> impl FnMut(&PlayerEvent) -> bool {
    move |event| matches!(event, PlayerEvent::State(s) if *s == want)
}

fn crossings_per_second(samples: &[i16], rate: f64) -> f64 {
    let c = samples
        .windows(2)
        .filter(|w| (w[0] < 0) != (w[1] < 0))
        .count();
    c as f64 / (samples.len() as f64 / rate)
}

fn plays_to_the_end(file: &str) {
    let rig = Rig::new();
    let surface = Arc::new(Surface::default());
    let (player, rx) = rig.open(file, Some(surface.clone()));
    let opening = until(&rx, "paused with the poster", state(PlaybackState::Paused));
    assert_eq!(
        opening
            .iter()
            .filter(|e| matches!(e, PlayerEvent::Buffered(_)))
            .collect::<Vec<_>>(),
        [&PlayerEvent::Buffered(vec![0.0..1.0])]
    );
    player.play();
    let events = until(&rx, "the end", state(PlaybackState::Ended));
    let buffered: Vec<_> = events
        .iter()
        .filter(|e| matches!(e, PlayerEvent::Buffered(_)))
        .collect();
    assert!(
        buffered.is_empty(),
        "a file in memory reports [0.0..1.0] once, on open: {buffered:?}"
    );

    let positions: Vec<Duration> = events
        .iter()
        .filter_map(|e| match e {
            PlayerEvent::Position(p) => Some(*p),
            _ => None,
        })
        .collect();
    assert!(
        positions.windows(2).all(|w| w[0] <= w[1]),
        "{file}: positions {positions:?}"
    );
    let end = *positions.last().expect("positions");
    assert!(
        end >= Duration::from_millis(1800),
        "{file}: ended at {end:?}"
    );

    // The poster, then the 20 frames, less any dropped as late (none should be at 10 fps).
    let uploads = surface.count();
    assert!((19..=21).contains(&uploads), "{file}: {uploads} uploads");
    assert_colour(file, surface.uploads.lock().unwrap()[0], RED);
    assert_colour(file, surface.last(), BLUE);

    let heard = rig.heard();
    let seconds = heard.len() as f64 / 48_000.0;
    assert!((seconds - 2.0).abs() <= 0.1, "{file}: heard {seconds} s");
    let rate = crossings_per_second(&heard, 48_000.0);
    assert!(
        (rate - 880.0).abs() <= 44.0,
        "{file}: {rate} crossings a second"
    );
    drop(player);
}

#[test]
fn vp9_and_opus_play_through_the_real_pipeline() {
    plays_to_the_end("vp9-opus.webm");
}

#[test]
fn av1_and_opus_play_through_the_real_pipeline() {
    plays_to_the_end("av1-opus.mkv");
}

#[cfg(feature = "aac")]
#[test]
fn h264_and_aac_play_through_the_real_pipeline() {
    plays_to_the_end("h264-aac.mp4");
}

#[test]
fn audio_only_plays_without_a_surface_and_resamples_to_48k() {
    let rig = Rig::new();
    let (tx, rx) = mpsc::channel();
    let tx = Mutex::new(tx);
    let player = rig.players.open(
        source("sine.wav"),
        Arc::new(move |e| {
            let _ = tx.lock().unwrap().send(e);
        }),
    );
    player.play();
    until(&rx, "the end", state(PlaybackState::Ended));
    // 16 kHz in, 48 kHz out: a second of tone is 48 000 samples at 880 crossings a second.
    let heard = rig.heard();
    assert!(
        heard.len().abs_diff(48_000) <= 2400,
        "{} samples",
        heard.len()
    );
    let rate = crossings_per_second(&heard, 48_000.0);
    assert!((rate - 880.0).abs() <= 44.0, "{rate} crossings a second");
}

#[test]
fn a_paused_seek_lands_within_a_frame_on_the_right_colour() {
    let rig = Rig::new();
    let surface = Arc::new(Surface::default());
    let (player, rx) = rig.open("vp9-opus.webm", Some(surface.clone()));
    until(&rx, "paused", state(PlaybackState::Paused));
    // The poster: the first frame, shown on open, reported as a landing at zero.
    until(&rx, "the poster", |e| {
        *e == PlayerEvent::Position(Duration::ZERO)
    });
    assert_eq!(surface.count(), 1);
    assert_colour("poster", surface.last(), RED);
    for (target, colour) in [(1500, BLUE), (500, RED), (1900, BLUE), (0, RED)] {
        let before = surface.count();
        player.seek(Duration::from_millis(target));
        let events = until(&rx, "the landing", |e| {
            matches!(e, PlayerEvent::Position(_))
        });
        let PlayerEvent::Position(landed) = events.last().unwrap() else {
            unreachable!()
        };
        let off = landed.as_millis().abs_diff(u128::from(target));
        assert!(off <= 100, "seek to {target} ms landed at {landed:?}");
        assert_eq!(
            surface.count(),
            before + 1,
            "one frame shown for the seek to {target}"
        );
        assert_colour(&format!("seek to {target} ms"), surface.last(), colour);
    }
    assert!(rig.heard().is_empty(), "nothing plays while paused");
}

#[test]
fn a_seek_while_playing_flushes_and_plays_on_from_there() {
    let rig = Rig::new();
    let surface = Arc::new(Surface::default());
    let (player, rx) = rig.open("vp9-opus.webm", Some(surface.clone()));
    player.play();
    until(
        &rx,
        "some playing",
        |e| matches!(e, PlayerEvent::Position(p) if *p >= Duration::from_millis(300)),
    );
    player.seek(Duration::from_millis(1500));
    until(&rx, "the end", state(PlaybackState::Ended));
    assert_colour("after the seek", surface.last(), BLUE);
    // About 0.3 s before the seek and 0.5 s after it, not the whole 2 s.
    let seconds = rig.heard().len() as f64 / 48_000.0;
    assert!(seconds < 1.4, "heard {seconds} s");
}

#[test]
fn pausing_stops_frames_sound_and_the_clock() {
    let rig = Rig::new();
    let surface = Arc::new(Surface::default());
    let (player, rx) = rig.open("vp9-opus.webm", Some(surface.clone()));
    player.play();
    until(
        &rx,
        "half a second",
        |e| matches!(e, PlayerEvent::Position(p) if *p >= Duration::from_millis(500)),
    );
    player.pause();
    until(&rx, "paused", state(PlaybackState::Paused));
    let (uploads, heard) = (surface.count(), rig.speaker.lock().unwrap().len());
    // A window in which nothing may happen: no position, no frame, only silence.
    let quiet = rx.recv_timeout(Duration::from_millis(400));
    assert!(quiet.is_err(), "an event while paused: {quiet:?}");
    assert_eq!(surface.count(), uploads);
    let after = rig.speaker.lock().unwrap()[heard..].to_vec();
    assert!(after.iter().all(|s| *s == 0), "sound while paused");

    player.play();
    until(&rx, "the end", state(PlaybackState::Ended));
    assert_colour("resumed to the end", surface.last(), BLUE);
}

#[test]
fn playing_one_pauses_the_other() {
    let rig = Rig::new();
    let (first, first_rx) = rig.open("sine.flac", None);
    let (second, second_rx) = rig.open("vorbis.ogg", None);
    first.play();
    until(
        &first_rx,
        "the first playing",
        state(PlaybackState::Playing),
    );
    second.play();
    until(
        &second_rx,
        "the second playing",
        state(PlaybackState::Playing),
    );
    until(&first_rx, "the first paused", state(PlaybackState::Paused));
    assert_eq!(rig.players.active(), Some(second.id()));
    drop(second);
    assert_eq!(rig.players.active(), None);
}

#[test]
fn dropping_the_player_stops_it_and_removes_its_surface() {
    let rig = Rig::new();
    let surface = Arc::new(Surface::default());
    let (player, rx) = rig.open("vp9-opus.webm", Some(surface.clone()));
    player.play();
    until(&rx, "playing", state(PlaybackState::Playing));
    drop(player);
    let deadline = Instant::now() + DEADLINE;
    while !surface.removed.load(Ordering::SeqCst) {
        assert!(Instant::now() < deadline, "the surface was never removed");
        std::thread::yield_now();
    }
    let uploads = surface.count();
    assert!(rx.recv_timeout(Duration::from_millis(200)).is_err() || surface.count() == uploads);
}

#[test]
fn failures_are_reported_as_what_a_user_can_do() {
    let rig = Rig::new();
    let (_avi, rx) = rig.open("mpeg4-mp3.avi", None);
    until(
        &rx,
        "unsupported",
        state(PlaybackState::Failed(PlayerError::Unsupported)),
    );
    let (_truncated, rx) = rig.open("truncated.mp4", None);
    until(
        &rx,
        "corrupt",
        state(PlaybackState::Failed(PlayerError::Corrupt)),
    );
    let (_missing, rx) = rig.open("missing", None);
    until(
        &rx,
        "network",
        state(PlaybackState::Failed(PlayerError::Network)),
    );
}
