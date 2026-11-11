//! Attachment playback, the UI-free half: what to play, what a player offers, and the logic every
//! implementation shares. Desktop plays through `semaphore-player` (FFmpeg, libvpx and dav1d from
//! libwebrtc, docs/player.md); a mobile client can supply a platform player behind the same
//! traits later. Nothing here decodes, opens a device or touches the network.
//!
//! - [`Machine`]: the state machine. Commands and decoder signals in, [`Effect`]s out, so the
//!   rules (autoplay once opened, play after the end restarts, a stale seek is ignored) are tested
//!   without codecs.
//! - [`AudioClock`], [`WallClock`], [`frame_action`]: audio is the master clock; video waits for
//!   it, shows, or drops a frame that is more than one frame late. Video with no audio track
//!   runs on the wall clock.
//! - [`Exclusive`]: one player plays at a time, app-wide; starting another pauses it.

use std::ops::Range;
use std::sync::Arc;
use std::time::{Duration, Instant};

/// An attachment to play, as the message's file metadata describes it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlaybackSource {
    pub file_id: String,
    pub filename: String,
    pub mime_type: String,
    /// Bytes, from the attachment's metadata: the range reader needs no HEAD request.
    pub size: u64,
    /// The backend has a poster frame at `/file/{id}/thumbnail`.
    pub has_thumbnail: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MediaKind {
    Video,
    Audio,
    Other,
}

impl PlaybackSource {
    pub fn kind(&self) -> MediaKind {
        let mime = self.mime_type.to_ascii_lowercase();
        if mime.starts_with("video/") {
            MediaKind::Video
        } else if mime.starts_with("audio/") {
            MediaKind::Audio
        } else {
            MediaKind::Other
        }
    }

    /// The download route, relative to the API base. It serves `Range` requests.
    pub fn path(&self) -> String {
        format!("/file/{}", self.file_id)
    }
}

/// Why playback stopped for good. Each maps to what a user can do: download or open externally
/// (unsupported, corrupt), retry (network, device).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PlayerError {
    /// A container or codec this client doesn't play (AVI, HEVC, Theora...).
    Unsupported,
    /// The file doesn't parse.
    Corrupt,
    /// Fetching failed after retries.
    Network,
    /// No audio output could be opened.
    AudioDevice,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PlaybackState {
    /// Opening: probing, reading headers.
    Loading,
    Paused,
    Playing,
    /// Playing, but out of data: waiting for the network.
    Buffering,
    Ended,
    Failed(PlayerError),
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Metadata {
    pub duration: Option<Duration>,
    pub has_video: bool,
    pub has_audio: bool,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, PartialEq)]
pub enum PlayerEvent {
    State(PlaybackState),
    Metadata(Metadata),
    /// The playback position, a few times a second while playing and after each seek.
    Position(Duration),
    /// The fetched parts of the file, as fractions of its bytes (`0.0..=1.0`, sorted, not
    /// overlapping), sent when they change and at most a few times a second. A file read from
    /// memory sends `[0.0..1.0]` once. The state machine ignores it.
    Buffered(Vec<Range<f32>>),
}

/// Where a player reports to. Called from the player's own thread.
pub type PlayerEvents = Arc<dyn Fn(PlayerEvent) + Send + Sync>;

/// One open attachment. Dropping it stops playback and frees everything it holds (the view went
/// away: a channel switch, a scroll, a closed window).
pub trait MediaPlayer: Send {
    fn play(&self);
    fn pause(&self);
    fn seek(&self, to: Duration);
    /// 0.0 to 1.0.
    fn set_volume(&self, volume: f32);
    fn set_muted(&self, muted: bool);
}

/// Opens players. The desktop one shares an output device, a cache and the one-active rule.
pub trait PlayerFactory: Send + Sync {
    fn open(&self, source: PlaybackSource, events: PlayerEvents) -> Box<dyn MediaPlayer>;
}

/// What the state machine is told.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Input {
    Play,
    Pause,
    Seek(Duration),
    /// The decoder read the headers.
    Opened(Metadata),
    Failed(PlayerError),
    /// Playing, and the queues ran dry before the end.
    Starved,
    /// Data again after [`Input::Starved`].
    Fed,
    /// Every enabled stream played to its end.
    Finished,
    /// The decoder finished the seek of this generation.
    SeekLanded(u64),
}

/// What the machine asks of its player.
#[derive(Debug, Clone, PartialEq)]
pub enum Effect {
    StartOutput,
    StopOutput,
    /// Seek the decoder; frames of older generations are to be dropped.
    SeekTo {
        position: Duration,
        generation: u64,
    },
    Emit(PlayerEvent),
}

#[derive(Debug, Clone)]
pub struct Machine {
    state: PlaybackState,
    /// Asked to play before the headers were read: start once they are.
    autoplay: bool,
    generation: u64,
    seeking: Option<u64>,
}

impl Default for Machine {
    fn default() -> Self {
        Self::new()
    }
}

impl Machine {
    pub fn new() -> Self {
        Self {
            state: PlaybackState::Loading,
            autoplay: false,
            generation: 0,
            seeking: None,
        }
    }

    pub fn state(&self) -> &PlaybackState {
        &self.state
    }

    /// The current seek generation: a frame decoded under an older one belongs to a position the
    /// user has left.
    pub fn generation(&self) -> u64 {
        self.generation
    }

    /// A seek is still in flight.
    pub fn seeking(&self) -> bool {
        self.seeking.is_some()
    }

    pub fn handle(&mut self, input: Input) -> Vec<Effect> {
        use PlaybackState as S;
        let mut effects = Vec::new();
        if matches!(self.state, S::Failed(_)) {
            return effects;
        }
        let next = match (&self.state, input) {
            (S::Loading, Input::Play) => {
                self.autoplay = true;
                None
            }
            (S::Loading, Input::Pause) => {
                self.autoplay = false;
                None
            }
            (S::Loading, Input::Opened(meta)) => {
                effects.push(Effect::Emit(PlayerEvent::Metadata(meta)));
                if self.autoplay {
                    effects.push(Effect::StartOutput);
                    Some(S::Playing)
                } else {
                    Some(S::Paused)
                }
            }
            (S::Loading, Input::Seek(_)) => None,
            (_, Input::Failed(error)) => {
                if matches!(self.state, S::Playing | S::Buffering) {
                    effects.push(Effect::StopOutput);
                }
                Some(S::Failed(error))
            }
            (S::Paused, Input::Play) => {
                effects.push(Effect::StartOutput);
                Some(S::Playing)
            }
            (S::Ended, Input::Play) => {
                effects.push(self.seek_effect(Duration::ZERO));
                effects.push(Effect::StartOutput);
                Some(S::Playing)
            }
            (S::Playing | S::Buffering, Input::Pause) => {
                effects.push(Effect::StopOutput);
                Some(S::Paused)
            }
            (S::Playing | S::Buffering | S::Paused, Input::Seek(to)) => {
                effects.push(self.seek_effect(to));
                None
            }
            (S::Ended, Input::Seek(to)) => {
                effects.push(self.seek_effect(to));
                Some(S::Paused)
            }
            (S::Playing, Input::Starved) => Some(S::Buffering),
            (S::Buffering, Input::Fed) => Some(S::Playing),
            (S::Playing | S::Buffering, Input::Finished) => {
                effects.push(Effect::StopOutput);
                Some(S::Ended)
            }
            (_, Input::SeekLanded(generation)) => {
                if self.seeking == Some(generation) {
                    self.seeking = None;
                }
                None
            }
            _ => None,
        };
        if let Some(next) = next
            && next != self.state
        {
            self.state = next.clone();
            effects.push(Effect::Emit(PlayerEvent::State(next)));
        }
        effects
    }

    fn seek_effect(&mut self, position: Duration) -> Effect {
        self.generation += 1;
        self.seeking = Some(self.generation);
        Effect::SeekTo {
            position,
            generation: self.generation,
        }
    }
}

/// Playback position from the audio output: where playback started (after a seek or a resume)
/// plus the samples the device has taken, less those still in its buffer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AudioClock {
    base: Duration,
    rate: u32,
}

impl AudioClock {
    pub fn new(base: Duration, rate: u32) -> Self {
        Self {
            base,
            rate: rate.max(1),
        }
    }

    /// `played`: sample frames handed to the device since `base`; `delay`: how far ahead of the
    /// speaker those are. Never before `base`.
    pub fn position(&self, played: u64, delay: Duration) -> Duration {
        let played = Duration::from_secs_f64(played as f64 / f64::from(self.rate));
        (self.base + played).saturating_sub(delay).max(self.base)
    }

    pub fn base(&self) -> Duration {
        self.base
    }
}

/// The clock for video with no audio track: runs while started.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WallClock {
    base: Duration,
    started: Option<Instant>,
}

impl WallClock {
    pub fn new(base: Duration) -> Self {
        Self {
            base,
            started: None,
        }
    }

    pub fn start(&mut self, now: Instant) {
        if self.started.is_none() {
            self.started = Some(now);
        }
    }

    pub fn stop(&mut self, now: Instant) {
        self.base = self.position(now);
        self.started = None;
    }

    pub fn position(&self, now: Instant) -> Duration {
        match self.started {
            Some(started) => self.base + now.saturating_duration_since(started),
            None => self.base,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FrameAction {
    /// Due now.
    Show,
    /// Early by this much.
    Wait(Duration),
    /// More than one frame late: showing it would only delay the next.
    Drop,
}

/// What to do with a decoded video frame at presentation time `pts`, given the master clock.
pub fn frame_action(pts: Duration, clock: Duration, frame_duration: Duration) -> FrameAction {
    if pts > clock {
        FrameAction::Wait(pts - clock)
    } else if clock - pts > frame_duration {
        FrameAction::Drop
    } else {
        FrameAction::Show
    }
}

/// One player plays at a time, app-wide.
#[derive(Debug, Default, Clone)]
pub struct Exclusive {
    active: Option<u64>,
}

impl Exclusive {
    /// `player` starts; returns the one to pause, if another was playing.
    pub fn activate(&mut self, player: u64) -> Option<u64> {
        self.active
            .replace(player)
            .filter(|previous| *previous != player)
    }

    /// `player` paused, ended or went away.
    pub fn release(&mut self, player: u64) {
        if self.active == Some(player) {
            self.active = None;
        }
    }

    pub fn active(&self) -> Option<u64> {
        self.active
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn states(effects: &[Effect]) -> Vec<PlaybackState> {
        effects
            .iter()
            .filter_map(|e| match e {
                Effect::Emit(PlayerEvent::State(s)) => Some(s.clone()),
                _ => None,
            })
            .collect()
    }

    fn opened() -> Input {
        Input::Opened(Metadata {
            duration: Some(Duration::from_secs(2)),
            has_video: true,
            has_audio: true,
            width: 64,
            height: 64,
        })
    }

    #[test]
    fn opens_paused_unless_play_was_asked_for() {
        let mut machine = Machine::new();
        let effects = machine.handle(opened());
        assert_eq!(states(&effects), [PlaybackState::Paused]);
        assert!(!effects.contains(&Effect::StartOutput));

        let mut machine = Machine::new();
        assert!(machine.handle(Input::Play).is_empty());
        let effects = machine.handle(opened());
        assert!(matches!(effects[0], Effect::Emit(PlayerEvent::Metadata(_))));
        assert!(effects.contains(&Effect::StartOutput));
        assert_eq!(states(&effects), [PlaybackState::Playing]);
    }

    #[test]
    fn play_pause_start_and_stop_the_output() {
        let mut machine = Machine::new();
        machine.handle(opened());
        assert_eq!(
            machine.handle(Input::Play),
            [
                Effect::StartOutput,
                Effect::Emit(PlayerEvent::State(PlaybackState::Playing))
            ]
        );
        assert_eq!(
            machine.handle(Input::Pause),
            [
                Effect::StopOutput,
                Effect::Emit(PlayerEvent::State(PlaybackState::Paused))
            ]
        );
        assert!(
            machine.handle(Input::Pause).is_empty(),
            "pausing twice does nothing"
        );
    }

    #[test]
    fn seeks_move_the_generation_and_stale_landings_are_ignored() {
        let mut machine = Machine::new();
        machine.handle(opened());
        let first = machine.handle(Input::Seek(Duration::from_millis(500)));
        assert_eq!(
            first,
            [Effect::SeekTo {
                position: Duration::from_millis(500),
                generation: 1
            }]
        );
        machine.handle(Input::Seek(Duration::from_millis(1500)));
        assert_eq!(machine.generation(), 2);
        machine.handle(Input::SeekLanded(1));
        assert!(
            machine.seeking(),
            "generation 1 landing doesn't end generation 2's seek"
        );
        machine.handle(Input::SeekLanded(2));
        assert!(!machine.seeking());
        assert_eq!(
            machine.state(),
            &PlaybackState::Paused,
            "a seek keeps play or pause"
        );
    }

    #[test]
    fn the_end_stops_output_and_play_restarts_from_zero() {
        let mut machine = Machine::new();
        machine.handle(opened());
        machine.handle(Input::Play);
        let effects = machine.handle(Input::Finished);
        assert_eq!(effects[0], Effect::StopOutput);
        assert_eq!(machine.state(), &PlaybackState::Ended);
        let effects = machine.handle(Input::Play);
        assert_eq!(
            effects[0],
            Effect::SeekTo {
                position: Duration::ZERO,
                generation: 1
            }
        );
        assert_eq!(effects[1], Effect::StartOutput);
        assert_eq!(machine.state(), &PlaybackState::Playing);
    }

    #[test]
    fn seeking_after_the_end_leaves_it_paused_there() {
        let mut machine = Machine::new();
        machine.handle(opened());
        machine.handle(Input::Play);
        machine.handle(Input::Finished);
        machine.handle(Input::Seek(Duration::from_secs(1)));
        assert_eq!(machine.state(), &PlaybackState::Paused);
    }

    #[test]
    fn starving_buffers_and_feeding_resumes() {
        let mut machine = Machine::new();
        machine.handle(opened());
        machine.handle(Input::Play);
        assert_eq!(
            states(&machine.handle(Input::Starved)),
            [PlaybackState::Buffering]
        );
        assert_eq!(
            states(&machine.handle(Input::Fed)),
            [PlaybackState::Playing]
        );
        assert!(machine.handle(Input::Fed).is_empty());
        machine.handle(Input::Pause);
        assert!(
            machine.handle(Input::Starved).is_empty(),
            "paused can't starve"
        );
    }

    #[test]
    fn a_failure_is_final() {
        let mut machine = Machine::new();
        machine.handle(opened());
        machine.handle(Input::Play);
        let effects = machine.handle(Input::Failed(PlayerError::Network));
        assert_eq!(effects[0], Effect::StopOutput);
        assert_eq!(
            machine.state(),
            &PlaybackState::Failed(PlayerError::Network)
        );
        assert!(machine.handle(Input::Play).is_empty());
        assert!(machine.handle(Input::Seek(Duration::ZERO)).is_empty());

        let mut loading = Machine::new();
        assert_eq!(
            states(&loading.handle(Input::Failed(PlayerError::Unsupported))),
            [PlaybackState::Failed(PlayerError::Unsupported)]
        );
    }

    #[test]
    fn the_audio_clock_counts_played_samples_less_the_device_buffer() {
        let clock = AudioClock::new(Duration::from_millis(1500), 48_000);
        assert_eq!(
            clock.position(0, Duration::ZERO),
            Duration::from_millis(1500)
        );
        assert_eq!(
            clock.position(48_000, Duration::from_millis(40)),
            Duration::from_millis(2460)
        );
        assert_eq!(
            clock.position(960, Duration::from_millis(40)),
            Duration::from_millis(1500),
            "never before where it started"
        );
    }

    #[test]
    fn the_wall_clock_runs_only_while_started() {
        let t0 = Instant::now();
        let mut clock = WallClock::new(Duration::from_secs(1));
        assert_eq!(
            clock.position(t0 + Duration::from_secs(5)),
            Duration::from_secs(1)
        );
        clock.start(t0);
        assert_eq!(
            clock.position(t0 + Duration::from_millis(250)),
            Duration::from_millis(1250)
        );
        clock.stop(t0 + Duration::from_millis(500));
        assert_eq!(
            clock.position(t0 + Duration::from_secs(9)),
            Duration::from_millis(1500)
        );
    }

    #[test]
    fn frames_wait_show_or_drop_against_the_clock() {
        let frame = Duration::from_millis(100);
        let ms = Duration::from_millis;
        assert_eq!(
            frame_action(ms(1000), ms(960), frame),
            FrameAction::Wait(ms(40))
        );
        assert_eq!(frame_action(ms(1000), ms(1000), frame), FrameAction::Show);
        assert_eq!(frame_action(ms(1000), ms(1099), frame), FrameAction::Show);
        assert_eq!(frame_action(ms(1000), ms(1101), frame), FrameAction::Drop);
    }

    #[test]
    fn one_player_at_a_time() {
        let mut exclusive = Exclusive::default();
        assert_eq!(exclusive.activate(1), None);
        assert_eq!(
            exclusive.activate(1),
            None,
            "the same player again pauses nothing"
        );
        assert_eq!(exclusive.activate(2), Some(1));
        exclusive.release(1);
        assert_eq!(
            exclusive.active(),
            Some(2),
            "an old player can't release the new one"
        );
        exclusive.release(2);
        assert_eq!(exclusive.active(), None);
    }

    #[test]
    fn sources_know_their_kind_and_route() {
        let source = PlaybackSource {
            file_id: "f1".into(),
            filename: "clip.webm".into(),
            mime_type: "Video/WebM".into(),
            size: 10,
            has_thumbnail: false,
        };
        assert_eq!(source.kind(), MediaKind::Video);
        assert_eq!(source.path(), "/file/f1");
        let audio = PlaybackSource {
            mime_type: "audio/ogg".into(),
            ..source
        };
        assert_eq!(audio.kind(), MediaKind::Audio);
    }
}
