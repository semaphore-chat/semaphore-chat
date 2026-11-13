//! The desktop player: one thread per open attachment, `semaphore-core`'s [`Machine`] deciding,
//! this module doing.
//!
//! - **Threads.** The player's own thread opens the source (which may block on the network),
//!   decodes, and presents video. The output device's callback pulls audio from a lock-free ring
//!   (`rtrb`). The UI only sends commands and receives [`PlayerEvent`]s.
//! - **Bounded queues.** About 300 ms of audio (ring plus what waits for it) and 3 decoded video
//!   frames; decoding stops when both are full, with hard caps of 1 s and 8 frames when one
//!   stream runs ahead of the other in the file.
//! - **Clock.** Audio is the master: samples the device has taken since the last seek or
//!   resume, less its reported delay. Video waits for it, shows, or drops a frame more than one
//!   frame late. Video with no audio runs on the wall clock.
//! - **Seek.** Each seek has a generation. The decoder goes to the keyframe before the target
//!   and frames before it are dropped; the ring is flushed by the audio callback, which
//!   acknowledges the generation, and nothing new is queued until it has. The first frame at the
//!   target shows even when paused, and a [`PlayerEvent::Position`] reports where it landed.
//! - **One active player.** Playing one pauses whichever was playing.
//! - **Unmount.** Dropping a [`Player`] stops its thread, closes the output and removes its
//!   video surface. The device stays open while paused (cheap; reopening costs a glitch).
//! - **Output.** Mono or stereo at 48 kHz (`AudioIo::open_output_channels`); more channels are
//!   cut to the first two. Volume and mute apply in the callback.

use crate::buffered::BufferedReport;
use crate::resample::Resampler;
use crate::segments::SegmentFetch;
use crate::{Error, Frame, Kind, Media, Nv12Image, Source};
use rtrb::{Consumer, Producer, RingBuffer};
use semaphore_core::player::{
    AudioClock, Effect, Exclusive, FrameAction, Input, Machine, MediaPlayer, Metadata,
    PlaybackSource, PlayerError, PlayerEvent, PlayerEvents, PlayerFactory, WallClock, frame_action,
};
use semaphore_media_livekit::audio::{
    AudioIo, AudioStream, ErrorCallback, OutputCallback, SAMPLE_RATE,
};
use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

/// One NV12 frame for the surface, as GPUI's `Nv12Frame` has it.
#[derive(Debug, Clone, Copy)]
pub struct Nv12Frame<'a> {
    pub width: u32,
    pub height: u32,
    pub y: &'a [u8],
    pub y_stride: u32,
    pub uv: &'a [u8],
    pub uv_stride: u32,
}

/// Where a player's video goes: the UI adapts it to GPUI's `VideoUploader` and a
/// `VideoSurfaceId` (one surface per player), so this crate needs no GPUI. Called from the
/// player's thread.
pub trait VideoSink: Send + Sync {
    fn upload(&self, frame: &Nv12Frame<'_>);
    /// The player went away: free the surface.
    fn remove(&self);
}

/// Opens what a player plays: an attachment's bytes ([`crate::range::http_opener`] in the app,
/// bytes in tests), or the replay buffer's segments. Runs on the player's thread, so it may
/// block; the [`Cancel`] is set when the player goes away, and a source should give up its reads
/// then.
///
/// The [`BufferedReport`] is where a byte source says which parts of the file it holds: a range
/// source after each block lands or is evicted ([`crate::range::RangeSource::with_buffered`]),
/// a source in memory once with [`BufferedReport::full`]. Segments report themselves.
pub type Opener = Arc<
    dyn Fn(&PlaybackSource, &Cancel, &BufferedReport) -> Result<Opened, PlayerError> + Send + Sync,
>;

/// What an [`Opener`] opened.
pub enum Opened {
    /// A file's bytes, demuxed by FFmpeg.
    Bytes(Box<dyn Source>),
    /// The replay buffer's HLS: one MPEG-TS segment per entry of `durations` (the playlist's
    /// `#EXTINF` lengths, in order), fetched through `fetch` by index, opened at `start` on that
    /// timeline (the first segment fetched is the one holding it). See [`crate::segments`].
    Segments {
        fetch: Arc<dyn SegmentFetch>,
        durations: Vec<Duration>,
        start: Duration,
    },
}

/// Set when a player is dropped: its source stops waiting for the network.
#[derive(Debug, Clone, Default)]
pub struct Cancel(Arc<AtomicBool>);

impl Cancel {
    pub fn cancel(&self) {
        self.0.store(true, Ordering::SeqCst);
    }

    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

const AUDIO_TARGET: Duration = Duration::from_millis(300);
const AUDIO_CAP: Duration = Duration::from_secs(1);
const VIDEO_TARGET: usize = 3;
const VIDEO_CAP: usize = 8;
const POSITION_EVERY: Duration = Duration::from_millis(250);
const DEFAULT_FRAME: Duration = Duration::from_millis(40);

enum Command {
    Play,
    Pause,
    Seek(Duration),
    Stop,
}

#[derive(Default)]
struct Registry {
    exclusive: Exclusive,
    players: HashMap<u64, mpsc::Sender<Command>>,
}

struct Shared {
    audio: Arc<dyn AudioIo>,
    device: Mutex<Option<String>>,
    opener: Opener,
    registry: Mutex<Registry>,
    next: AtomicU64,
}

impl Shared {
    fn registry(&self) -> MutexGuard<'_, Registry> {
        self.registry.lock().unwrap_or_else(|p| p.into_inner())
    }
}

/// Opens players that share an output device, a source opener and the one-active rule.
#[derive(Clone)]
pub struct DesktopPlayers {
    shared: Arc<Shared>,
}

impl DesktopPlayers {
    pub fn new(audio: Arc<dyn AudioIo>, opener: Opener) -> Self {
        Self {
            shared: Arc::new(Shared {
                audio,
                device: Mutex::new(None),
                opener,
                registry: Mutex::new(Registry::default()),
                next: AtomicU64::new(1),
            }),
        }
    }

    /// The output the voice settings chose (`None`: the default). Applies to players opened
    /// after.
    pub fn set_output_device(&self, device: Option<String>) {
        *self.shared.device.lock().unwrap_or_else(|p| p.into_inner()) = device;
    }

    /// The player currently playing, if any.
    pub fn active(&self) -> Option<u64> {
        self.shared.registry().exclusive.active()
    }

    /// A player whose video goes to `sink` (`None`: audio only).
    pub fn open_with_sink(
        &self,
        source: PlaybackSource,
        events: PlayerEvents,
        sink: Option<Arc<dyn VideoSink>>,
    ) -> Player {
        let id = self.shared.next.fetch_add(1, Ordering::Relaxed);
        let (commands, receiver) = mpsc::channel();
        let controls = Arc::new(Controls {
            volume: AtomicU32::new(1.0f32.to_bits()),
            muted: AtomicBool::new(false),
        });
        self.shared.registry().players.insert(id, commands.clone());
        let device = self
            .shared
            .device
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .clone();
        let cancel = Cancel::default();
        let context = Context {
            cancel: cancel.clone(),
            id,
            shared: self.shared.clone(),
            source,
            events,
            sink,
            controls: controls.clone(),
            device,
        };
        let spawned = std::thread::Builder::new()
            .name(format!("player-{id}"))
            .spawn(move || run(context, receiver));
        if let Err(error) = spawned {
            log::warn!("player: cannot start its thread: {error}");
        }
        Player {
            id,
            commands,
            controls,
            cancel,
            shared: self.shared.clone(),
        }
    }
}

impl PlayerFactory for DesktopPlayers {
    /// Audio only: a video surface needs [`DesktopPlayers::open_with_sink`].
    fn open(&self, source: PlaybackSource, events: PlayerEvents) -> Box<dyn MediaPlayer> {
        Box::new(self.open_with_sink(source, events, None))
    }
}

struct Controls {
    volume: AtomicU32,
    muted: AtomicBool,
}

impl Controls {
    fn gain(&self) -> f32 {
        if self.muted.load(Ordering::Relaxed) {
            0.0
        } else {
            f32::from_bits(self.volume.load(Ordering::Relaxed))
        }
    }
}

/// The handle a view holds. Dropping it stops the player.
pub struct Player {
    id: u64,
    commands: mpsc::Sender<Command>,
    controls: Arc<Controls>,
    cancel: Cancel,
    shared: Arc<Shared>,
}

impl Player {
    pub fn id(&self) -> u64 {
        self.id
    }
}

impl MediaPlayer for Player {
    fn play(&self) {
        {
            let mut registry = self.shared.registry();
            if let Some(previous) = registry.exclusive.activate(self.id)
                && let Some(other) = registry.players.get(&previous)
            {
                let _ = other.send(Command::Pause);
            }
        }
        let _ = self.commands.send(Command::Play);
    }

    fn pause(&self) {
        let _ = self.commands.send(Command::Pause);
    }

    fn seek(&self, to: Duration) {
        let _ = self.commands.send(Command::Seek(to));
    }

    fn set_volume(&self, volume: f32) {
        let volume = if volume.is_finite() {
            volume.clamp(0.0, 1.0)
        } else {
            1.0
        };
        self.controls
            .volume
            .store(volume.to_bits(), Ordering::Relaxed);
    }

    fn set_muted(&self, muted: bool) {
        self.controls.muted.store(muted, Ordering::Relaxed);
    }
}

impl Drop for Player {
    fn drop(&mut self) {
        self.cancel.cancel();
        let _ = self.commands.send(Command::Stop);
        let mut registry = self.shared.registry();
        registry.players.remove(&self.id);
        registry.exclusive.release(self.id);
    }
}

struct Context {
    cancel: Cancel,
    id: u64,
    shared: Arc<Shared>,
    source: PlaybackSource,
    events: PlayerEvents,
    sink: Option<Arc<dyn VideoSink>>,
    controls: Arc<Controls>,
    device: Option<String>,
}

fn player_error(error: Error) -> PlayerError {
    match error {
        Error::UnsupportedContainer | Error::UnsupportedCodec | Error::PixelFormat => {
            PlayerError::Unsupported
        }
        Error::Io => PlayerError::Network,
        Error::Invalid | Error::Decode | Error::OutOfMemory | Error::BadStream => {
            PlayerError::Corrupt
        }
    }
}

fn run(context: Context, commands: mpsc::Receiver<Command>) {
    let sink = context.sink.clone();
    let buffered = BufferedReport::new(context.events.clone());
    let opened =
        (context.shared.opener)(&context.source, &context.cancel, &buffered).and_then(|opened| {
            match opened {
                Opened::Bytes(source) => Media::open(source),
                Opened::Segments {
                    fetch,
                    durations,
                    start,
                } => Media::open_segments(
                    fetch,
                    durations,
                    start,
                    context.cancel.clone(),
                    Some(buffered.clone()),
                ),
            }
            .map_err(player_error)
        });
    match opened {
        Ok(media) => Engine::new(context, media).run(&commands),
        Err(error) => {
            let mut machine = Machine::new();
            for effect in machine.handle(Input::Failed(error)) {
                if let Effect::Emit(event) = effect {
                    (context.events)(event);
                }
            }
            // Stay until the view lets go, so a late command has somewhere to land.
            while let Ok(command) = commands.recv() {
                if matches!(command, Command::Stop) {
                    break;
                }
            }
        }
    }
    if let Some(sink) = sink {
        sink.remove();
    }
}

/// Shared with the output callback.
struct OutState {
    paused: AtomicBool,
    /// Sample frames taken from the ring since the last flush.
    played: AtomicU64,
    delay_ms: AtomicU32,
    flush_request: AtomicU64,
    flush_ack: AtomicU64,
}

struct Output {
    _stream: AudioStream,
    producer: Producer<i16>,
    capacity: usize,
    state: Arc<OutState>,
}

struct SeekPending {
    target: Duration,
    generation: u64,
    landed: bool,
}

struct Engine {
    context: Context,
    media: Media,
    machine: Machine,
    video: Option<usize>,
    audio: Option<usize>,
    /// What the output is opened with: 1 or 2.
    channels: usize,
    output: Option<Output>,
    output_failed: bool,
    resampler: Option<(u32, Resampler)>,
    converted: Vec<f32>,
    pending: VecDeque<i16>,
    queue: VecDeque<Nv12Image>,
    spare: Vec<Nv12Image>,
    frame_duration: Duration,
    frame_measured: bool,
    last_video_pts: Option<Duration>,
    base: Duration,
    wall: WallClock,
    playing: bool,
    eof: bool,
    seek: Option<SeekPending>,
    last_position: Option<Instant>,
    flush_generation: u64,
    stopped: bool,
}

fn pts(us: Option<i64>) -> Option<Duration> {
    us.map(|us| Duration::from_micros(u64::try_from(us).unwrap_or(0)))
}

impl Engine {
    fn new(context: Context, mut media: Media) -> Self {
        let streams = media.streams();
        let mut video = None;
        let mut audio = None;
        let mut channels = 1;
        let mut size = (0, 0);
        for (index, stream) in streams.iter().enumerate() {
            match stream.kind {
                Kind::Video if video.is_none() && media.enable(index).is_ok() => {
                    video = Some(index);
                    size = (stream.width, stream.height);
                }
                Kind::Audio if audio.is_none() && media.enable(index).is_ok() => {
                    audio = Some(index);
                    channels = stream.channels.clamp(1, 2) as usize;
                }
                _ => {}
            }
        }
        let duration = media.duration();
        // Zero for a file; segments open where they were asked to.
        let initial = media.initial_position();
        let mut engine = Self {
            context,
            media,
            machine: Machine::new(),
            video,
            audio,
            channels,
            output: None,
            output_failed: false,
            resampler: None,
            converted: Vec::new(),
            pending: VecDeque::new(),
            queue: VecDeque::new(),
            spare: Vec::new(),
            frame_duration: DEFAULT_FRAME,
            frame_measured: false,
            last_video_pts: None,
            base: initial,
            wall: WallClock::new(initial),
            playing: false,
            eof: false,
            seek: None,
            last_position: None,
            flush_generation: 0,
            stopped: false,
        };
        let input = if video.is_none() && audio.is_none() {
            Input::Failed(PlayerError::Unsupported)
        } else {
            Input::Opened(Metadata {
                duration,
                has_video: video.is_some(),
                has_audio: audio.is_some(),
                width: size.0,
                height: size.1,
            })
        };
        // Show the first frame as the poster once opened, as a paused seek to the start would.
        let opened = matches!(input, Input::Opened(_));
        engine.input(input);
        if opened && video.is_some() {
            engine.seek = Some(SeekPending {
                target: initial,
                generation: 0,
                landed: false,
            });
        }
        engine
    }

    fn run(mut self, commands: &mpsc::Receiver<Command>) {
        while !self.stopped {
            let wait = self.wait();
            match commands.recv_timeout(wait) {
                Ok(command) => {
                    self.command(command);
                    while let Ok(command) = commands.try_recv() {
                        self.command(command);
                    }
                }
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => break,
            }
            if self.stopped {
                break;
            }
            self.pump();
        }
        self.release();
    }

    fn command(&mut self, command: Command) {
        match command {
            Command::Play => self.input(Input::Play),
            Command::Pause => self.input(Input::Pause),
            Command::Seek(to) => self.input(Input::Seek(to)),
            Command::Stop => self.stopped = true,
        }
    }

    fn input(&mut self, input: Input) {
        let effects = self.machine.handle(input);
        for effect in effects {
            self.effect(effect);
        }
    }

    fn effect(&mut self, effect: Effect) {
        match effect {
            Effect::Emit(event) => (self.context.events)(event),
            Effect::StartOutput => self.start(),
            Effect::StopOutput => self.stop(),
            Effect::SeekTo {
                position,
                generation,
            } => self.seek_to(position, generation),
        }
    }

    fn release(&self) {
        self.context
            .shared
            .registry()
            .exclusive
            .release(self.context.id);
    }

    fn start(&mut self) {
        self.playing = true;
        self.wall.start(Instant::now());
        if self.audio.is_some() && self.output.is_none() && !self.output_failed {
            match self.open_output() {
                Ok(output) => self.output = Some(output),
                Err(error) => {
                    log::warn!("player: cannot open the audio output: {error}");
                    self.output_failed = true;
                    self.input(Input::Failed(PlayerError::AudioDevice));
                    return;
                }
            }
        }
        if let Some(output) = &self.output {
            output.state.paused.store(false, Ordering::Relaxed);
        }
    }

    fn stop(&mut self) {
        self.playing = false;
        self.wall.stop(Instant::now());
        if let Some(output) = &self.output {
            output.state.paused.store(true, Ordering::Relaxed);
        }
        self.release();
    }

    fn open_output(&self) -> Result<Output, String> {
        let capacity = SAMPLE_RATE as usize * self.channels / 2;
        let (producer, consumer) = RingBuffer::<i16>::new(capacity);
        let state = Arc::new(OutState {
            paused: AtomicBool::new(!self.playing),
            played: AtomicU64::new(0),
            delay_ms: AtomicU32::new(0),
            flush_request: AtomicU64::new(self.flush_generation),
            flush_ack: AtomicU64::new(self.flush_generation),
        });
        let callback = output_callback(
            consumer,
            state.clone(),
            self.context.controls.clone(),
            self.channels,
        );
        let quiet: ErrorCallback = Arc::new(|error| log::warn!("player: audio output: {error}"));
        let stream = self.context.shared.audio.open_output_channels(
            self.context.device.as_deref(),
            self.channels as u16,
            callback,
            quiet,
        )?;
        Ok(Output {
            _stream: stream,
            producer,
            capacity,
            state,
        })
    }

    fn seek_to(&mut self, position: Duration, generation: u64) {
        if let Err(error) = self.media.seek(position) {
            self.input(Input::Failed(player_error(error)));
            return;
        }
        while let Some(frame) = self.queue.pop_front() {
            self.spare.push(frame);
        }
        self.pending.clear();
        self.resampler = None;
        self.flush_generation = generation;
        if let Some(output) = &self.output {
            output
                .state
                .flush_request
                .store(generation, Ordering::Release);
        }
        self.base = position;
        self.wall = WallClock::new(position);
        if self.playing {
            self.wall.start(Instant::now());
        }
        self.eof = false;
        self.last_video_pts = None;
        self.seek = Some(SeekPending {
            target: position,
            generation,
            landed: false,
        });
    }

    fn flushed(&self) -> bool {
        self.output.as_ref().is_none_or(|output| {
            output.state.flush_ack.load(Ordering::Acquire) == self.flush_generation
        })
    }

    /// Audio queued, in sample frames.
    fn audio_queued(&self) -> usize {
        let ring = self
            .output
            .as_ref()
            .map_or(0, |o| o.capacity - o.producer.slots());
        (ring + self.pending.len()) / self.channels
    }

    fn frames_for(duration: Duration) -> usize {
        (duration.as_secs_f64() * f64::from(SAMPLE_RATE)) as usize
    }

    /// Decoding is wanted now.
    fn active(&self) -> bool {
        self.playing || self.seek.as_ref().is_some_and(|s| !s.landed)
    }

    fn wants_more(&self) -> bool {
        if self.eof || !self.active() {
            return false;
        }
        let audio_queued = self.audio_queued();
        let audio_short = self.audio.is_some() && audio_queued < Self::frames_for(AUDIO_TARGET);
        let video_short = self.video.is_some() && self.queue.len() < VIDEO_TARGET;
        let audio_full = audio_queued >= Self::frames_for(AUDIO_CAP);
        let video_full = self.queue.len() >= VIDEO_CAP;
        (audio_short || video_short) && !audio_full && !video_full
    }

    fn wait(&self) -> Duration {
        if self.wants_more() {
            return Duration::ZERO;
        }
        if !self.active() {
            return Duration::from_secs(1);
        }
        // Playing: the next frame's due time, or a short tick for the ring and the position.
        let tick = Duration::from_millis(10);
        match (self.queue.front(), self.clock()) {
            (Some(front), Some(clock)) => match pts(front.pts_us) {
                Some(due) if due > clock => (due - clock).min(tick),
                _ => Duration::ZERO,
            },
            _ => tick,
        }
    }

    fn clock(&self) -> Option<Duration> {
        if self.audio.is_some() && !self.output_failed {
            let Some(output) = &self.output else {
                return Some(self.base);
            };
            if !self.flushed() {
                return None;
            }
            let played = output.state.played.load(Ordering::Acquire);
            let delay =
                Duration::from_millis(u64::from(output.state.delay_ms.load(Ordering::Relaxed)));
            return Some(AudioClock::new(self.base, SAMPLE_RATE).position(played, delay));
        }
        Some(self.wall.position(Instant::now()))
    }

    fn pump(&mut self) {
        while self.wants_more() {
            match self.media.next_frame() {
                Ok(Some(Frame::Video(frame))) => {
                    let mut image = self.spare.pop().unwrap_or_default();
                    if let Err(error) = frame.to_nv12(&mut image) {
                        self.input(Input::Failed(player_error(error)));
                        return;
                    }
                    self.take_video(image);
                }
                Ok(Some(Frame::Audio(frame))) => {
                    let (rate, channels, pts) = (
                        frame.sample_rate,
                        frame.channels as usize,
                        pts(frame.pts_us),
                    );
                    let samples = frame.samples.to_vec();
                    self.take_audio(&samples, rate, channels, pts);
                }
                Ok(None) => {
                    self.eof = true;
                    self.finish_audio();
                    self.land_if_nothing_comes();
                }
                Err(error) => {
                    self.input(Input::Failed(player_error(error)));
                    return;
                }
            }
            if matches!(
                self.machine.state(),
                semaphore_core::player::PlaybackState::Failed(_)
            ) {
                return;
            }
        }
        self.push_audio();
        self.watch_supply();
        if self.playing {
            self.present();
            self.report_position(false);
            self.check_end();
        }
    }

    fn take_video(&mut self, image: Nv12Image) {
        let at = pts(image.pts_us).unwrap_or(Duration::ZERO);
        // The shortest gap seen between frames: the frame duration, for dropping late ones.
        if let Some(previous) = self.last_video_pts
            && at > previous
        {
            let delta = (at - previous).clamp(Duration::from_millis(5), Duration::from_millis(200));
            if !self.frame_measured || delta < self.frame_duration {
                self.frame_duration = delta;
                self.frame_measured = true;
            }
        }
        self.last_video_pts = Some(at);
        if let Some(seek) = &self.seek
            && at + self.frame_duration / 2 < seek.target
        {
            // Before the seek's target: decoded only to reach it.
            self.spare.push(image);
            return;
        }
        let landing = self.seek.as_ref().is_some_and(|s| !s.landed);
        if landing {
            if !self.playing {
                // Paused: show the frame the seek landed on at once.
                if let Some(sink) = &self.context.sink {
                    sink.upload(&nv12(&image));
                }
                self.spare.push(image);
            } else {
                self.queue.push_back(image);
            }
            self.land(at);
            return;
        }
        self.queue.push_back(image);
    }

    fn land(&mut self, at: Duration) {
        let Some(seek) = self.seek.as_mut() else {
            return;
        };
        seek.landed = true;
        let generation = seek.generation;
        if generation > 0 {
            self.input(Input::SeekLanded(generation));
        }
        (self.context.events)(PlayerEvent::Position(at));
        self.last_position = Some(Instant::now());
    }

    /// A seek past the last frame, or audio only: land where it was asked.
    fn land_if_nothing_comes(&mut self) {
        if let Some(seek) = &self.seek
            && !seek.landed
        {
            let target = seek.target;
            self.land(target);
        }
    }

    fn take_audio(&mut self, samples: &[f32], rate: u32, channels: usize, at: Option<Duration>) {
        if channels == 0 || rate == 0 {
            return;
        }
        let mut start = 0;
        if let (Some(seek), Some(at)) = (&self.seek, at)
            && at < seek.target
        {
            let skip = ((seek.target - at).as_secs_f64() * f64::from(rate)) as usize;
            start = skip.min(samples.len() / channels);
        }
        let out = self.channels;
        let mut picked = Vec::with_capacity((samples.len() / channels - start) * out);
        for frame in samples.chunks_exact(channels).skip(start) {
            if out == 1 {
                picked.push(frame.iter().sum::<f32>() / channels as f32);
            } else {
                picked.push(frame[0]);
                picked.push(*frame.get(1).unwrap_or(&frame[0]));
            }
        }
        let resampler = match &mut self.resampler {
            Some((from, resampler)) if *from == rate => resampler,
            slot => {
                *slot = Some((rate, Resampler::new(rate, SAMPLE_RATE, out)));
                &mut slot.as_mut().expect("just set").1
            }
        };
        self.converted.clear();
        resampler.process(&picked, &mut self.converted);
        self.pending.extend(
            self.converted
                .iter()
                .map(|s| (s * 32767.0).clamp(-32768.0, 32767.0) as i16),
        );
        if self.video.is_none() && self.seek.as_ref().is_some_and(|s| !s.landed) {
            let target = self.seek.as_ref().map_or(Duration::ZERO, |s| s.target);
            self.land(target);
        }
    }

    fn finish_audio(&mut self) {
        if let Some((_, resampler)) = &mut self.resampler {
            self.converted.clear();
            resampler.finish(&mut self.converted);
            self.pending.extend(
                self.converted
                    .iter()
                    .map(|s| (s * 32767.0).clamp(-32768.0, 32767.0) as i16),
            );
        }
    }

    fn push_audio(&mut self) {
        if !self.flushed() {
            return;
        }
        let Some(output) = &mut self.output else {
            return;
        };
        while let Some(&sample) = self.pending.front() {
            if output.producer.push(sample).is_err() {
                break;
            }
            self.pending.pop_front();
        }
    }

    /// Playing audio ran dry before the end (the source is slow): buffering until it refills.
    fn watch_supply(&mut self) {
        use semaphore_core::player::PlaybackState as S;
        if self.audio.is_none() || self.output.is_none() || !self.flushed() {
            return;
        }
        let queued = self.audio_queued();
        match self.machine.state() {
            S::Playing if queued == 0 && !self.eof => self.input(Input::Starved),
            S::Buffering if queued > 0 || self.eof => self.input(Input::Fed),
            _ => {}
        }
    }

    fn present(&mut self) {
        let Some(clock) = self.clock() else {
            return;
        };
        while let Some(front) = self.queue.front() {
            let at = pts(front.pts_us).unwrap_or(Duration::ZERO);
            match frame_action(at, clock, self.frame_duration) {
                FrameAction::Wait(_) => break,
                FrameAction::Show => {
                    if let Some(sink) = &self.context.sink {
                        sink.upload(&nv12(front));
                    }
                    if let Some(image) = self.queue.pop_front() {
                        self.spare.push(image);
                    }
                }
                FrameAction::Drop => {
                    if let Some(image) = self.queue.pop_front() {
                        self.spare.push(image);
                    }
                }
            }
        }
        self.spare.truncate(VIDEO_CAP);
    }

    fn report_position(&mut self, force: bool) {
        let due = self
            .last_position
            .is_none_or(|last| last.elapsed() >= POSITION_EVERY);
        if (force || due)
            && let Some(clock) = self.clock()
        {
            (self.context.events)(PlayerEvent::Position(clock));
            self.last_position = Some(Instant::now());
        }
    }

    fn check_end(&mut self) {
        let audio_done = self.audio.is_none()
            || self.output_failed
            || (self.pending.is_empty()
                && self
                    .output
                    .as_ref()
                    .is_none_or(|o| o.producer.slots() == o.capacity));
        if self.eof && self.queue.is_empty() && audio_done {
            self.report_position(true);
            self.input(Input::Finished);
        }
    }
}

fn nv12(image: &Nv12Image) -> Nv12Frame<'_> {
    Nv12Frame {
        width: image.width,
        height: image.height,
        y: &image.y,
        y_stride: image.y_stride,
        uv: &image.uv,
        uv_stride: image.uv_stride,
    }
}

/// Runs on the device's thread: flushes on a new seek generation, plays silence while paused,
/// applies the gain, counts what it took.
fn output_callback(
    mut consumer: Consumer<i16>,
    state: Arc<OutState>,
    controls: Arc<Controls>,
    channels: usize,
) -> OutputCallback {
    let mut seen = state.flush_ack.load(Ordering::Acquire);
    Box::new(move |buffer: &mut [i16], delay_ms| {
        state.delay_ms.store(delay_ms, Ordering::Relaxed);
        let wanted = state.flush_request.load(Ordering::Acquire);
        if wanted != seen {
            while consumer.pop().is_ok() {}
            state.played.store(0, Ordering::Release);
            seen = wanted;
            state.flush_ack.store(wanted, Ordering::Release);
        }
        if state.paused.load(Ordering::Relaxed) {
            buffer.fill(0);
            return;
        }
        let gain = controls.gain();
        let available = consumer.slots().min(buffer.len());
        let available = available - available % channels;
        for out in buffer[..available].iter_mut() {
            let sample = consumer.pop().unwrap_or(0);
            *out = (f32::from(sample) * gain) as i16;
        }
        buffer[available..].fill(0);
        state
            .played
            .fetch_add((available / channels) as u64, Ordering::Release);
    })
}
