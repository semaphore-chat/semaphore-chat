//! One attachment's playback, shared by both views: opening through the owner's
//! [`PlayerOpener`], core's [`MediaPlayer`] commands, and the events that come back.
//!
//! Events arrive on the player's own thread. They go into an [`Inbox`] whose future wakes the
//! view's task, so nothing polls: an idle player in a scrolled-past message costs nothing.

use super::model::{self, Phase};
use crate::voice::VideoFrames;
use gpui_kit::Nv12Frame;
use semaphore_core::player::{
    MediaPlayer, PlaybackSource, PlayerEvent, PlayerEvents, PlayerFactory,
};
use std::future::Future;
use std::ops::Range;
use std::pin::Pin;
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::task::{Context as TaskContext, Poll, Waker};
use std::time::Duration;

/// How the view gets a player. The app opens the desktop engine with the surface as its video
/// sink (`DesktopPlayers::open_with_sink`, through a small `VideoSink` over
/// [`PlayerSurface`]); stories and tests open a fake. `surface` is `None` for audio.
pub trait PlayerOpener: 'static {
    fn open(
        &self,
        source: PlaybackSource,
        events: PlayerEvents,
        surface: Option<PlayerSurface>,
    ) -> Box<dyn MediaPlayer>;

    /// The audio output for players opened after this (`None`: the default). Ignored by
    /// openers with no output of their own.
    fn set_output_device(&self, _device: Option<String>) {}
}

impl<F> PlayerOpener for F
where
    F: Fn(PlaybackSource, PlayerEvents, Option<PlayerSurface>) -> Box<dyn MediaPlayer> + 'static,
{
    fn open(
        &self,
        source: PlaybackSource,
        events: PlayerEvents,
        surface: Option<PlayerSurface>,
    ) -> Box<dyn MediaPlayer> {
        self(source, events, surface)
    }
}

/// Core's [`PlayerFactory`] as an opener, for audio (it has no video sink).
pub struct FactoryOpener(pub Arc<dyn PlayerFactory>);

impl PlayerOpener for FactoryOpener {
    fn open(
        &self,
        source: PlaybackSource,
        events: PlayerEvents,
        _: Option<PlayerSurface>,
    ) -> Box<dyn MediaPlayer> {
        self.0.open(source, events)
    }
}

/// Events from player threads, tagged with the open they belong to, and the waker of the view
/// that drains them.
#[derive(Default)]
pub(crate) struct Inbox {
    events: Mutex<Vec<(u64, PlayerEvent)>>,
    /// A frame landed while nothing redraws every frame (paused, a seek's landing frame, the
    /// first frame as the poster).
    frame: AtomicBool,
    /// The view requests animation frames (video playing): frames need no wake.
    pub(crate) animating: AtomicBool,
    /// The open whose surface may write and remove frames.
    current: AtomicU64,
    waker: Mutex<Option<Waker>>,
}

impl Inbox {
    fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
        mutex.lock().unwrap_or_else(|p| p.into_inner())
    }

    fn push(&self, generation: u64, event: PlayerEvent) {
        Self::lock(&self.events).push((generation, event));
        self.wake();
    }

    fn frame_arrived(&self) {
        if !self.animating.load(Ordering::Acquire) {
            self.frame.store(true, Ordering::Release);
            self.wake();
        }
    }

    fn wake(&self) {
        if let Some(waker) = Self::lock(&self.waker).take() {
            waker.wake();
        }
    }

    fn ready(&self) -> bool {
        self.frame.load(Ordering::Acquire) || !Self::lock(&self.events).is_empty()
    }

    fn take(&self) -> (Vec<(u64, PlayerEvent)>, bool) {
        let events = std::mem::take(&mut *Self::lock(&self.events));
        (events, self.frame.swap(false, Ordering::AcqRel))
    }

    /// Resolves once there are events or a frame to draw.
    pub(crate) fn next(self: &Arc<Self>) -> impl Future<Output = ()> + 'static {
        Next(self.clone())
    }
}

struct Next(Arc<Inbox>);

impl Future for Next {
    type Output = ();

    fn poll(self: Pin<&mut Self>, cx: &mut TaskContext<'_>) -> Poll<()> {
        if self.0.ready() {
            return Poll::Ready(());
        }
        *Inbox::lock(&self.0.waker) = Some(cx.waker().clone());
        // Something may have landed between the check and storing the waker.
        if self.0.ready() {
            Poll::Ready(())
        } else {
            Poll::Pending
        }
    }
}

/// The video sink for one attachment: frames go into the call tiles' [`VideoFrames`] under
/// `player:<file_id>`, through GPUI's `VideoUploader` (or the RGBA fallback). Safe from any
/// thread. A surface from an earlier open (before a Retry) writes and removes nothing.
///
/// The app adapts the engine's sink to it, without this crate depending on the engine:
///
/// ```ignore
/// struct Sink(PlayerSurface);
/// impl semaphore_player::VideoSink for Sink {
///     fn upload(&self, f: &semaphore_player::Nv12Frame<'_>) {
///         self.0.upload(&gpui::Nv12Frame { width: f.width, height: f.height, y: f.y,
///             y_stride: f.y_stride, uv: f.uv, uv_stride: f.uv_stride });
///     }
///     fn remove(&self) { self.0.remove() }
/// }
/// ```
#[derive(Clone)]
pub struct PlayerSurface {
    frames: Arc<VideoFrames>,
    key: Arc<str>,
    inbox: Arc<Inbox>,
    generation: u64,
}

impl PlayerSurface {
    pub fn key(&self) -> &str {
        &self.key
    }

    fn current(&self) -> bool {
        self.inbox.current.load(Ordering::Acquire) == self.generation
    }

    pub fn upload(&self, frame: &Nv12Frame<'_>) {
        if self.current() {
            self.frames.push(&self.key, frame);
            self.inbox.frame_arrived();
        }
    }

    /// The player went away: free the surface.
    pub fn remove(&self) {
        if self.current() {
            self.frames.end(&self.key);
            self.inbox.frame_arrived();
        }
    }
}

/// One attachment's player and what it last said.
pub(crate) struct Playback {
    pub source: PlaybackSource,
    opener: Rc<dyn PlayerOpener>,
    /// Video only: where frames go.
    frames: Option<Arc<VideoFrames>>,
    player: Option<Box<dyn MediaPlayer>>,
    pub inbox: Arc<Inbox>,
    generation: u64,
    pub phase: Phase,
    pub position: Duration,
    pub duration: Option<Duration>,
    pub buffered: Vec<Range<f32>>,
    pub has_video: bool,
    /// The decoder's frame size, once opened.
    pub natural: Option<(u32, u32)>,
    pub volume: f32,
    pub muted: bool,
}

impl Playback {
    pub fn new(
        source: PlaybackSource,
        opener: Rc<dyn PlayerOpener>,
        frames: Option<Arc<VideoFrames>>,
    ) -> Self {
        Self {
            source,
            opener,
            has_video: frames.is_some(),
            frames,
            player: None,
            inbox: Arc::default(),
            generation: 0,
            phase: Phase::Idle,
            position: Duration::ZERO,
            duration: None,
            buffered: Vec::new(),
            natural: None,
            volume: 1.0,
            muted: false,
        }
    }

    pub fn key(&self) -> String {
        model::surface_key(&self.source.id())
    }

    pub fn has_frame(&self) -> bool {
        self.frames
            .as_ref()
            .is_some_and(|frames| frames.has_frame(&self.key()))
    }

    pub fn frames(&self) -> Option<&Arc<VideoFrames>> {
        self.frames.as_ref()
    }

    /// Opens (again), dropping any earlier player, and plays once the headers are read.
    fn open(&mut self) {
        self.player = None;
        self.generation += 1;
        let generation = self.generation;
        self.inbox.current.store(generation, Ordering::Release);
        if let Some(frames) = &self.frames {
            frames.end(&self.key());
        }
        self.phase = Phase::Loading;
        self.position = Duration::ZERO;
        self.buffered.clear();
        let inbox = self.inbox.clone();
        let events: PlayerEvents = Arc::new(move |event| inbox.push(generation, event));
        let surface = self.frames.as_ref().map(|frames| PlayerSurface {
            frames: frames.clone(),
            key: self.key().into(),
            inbox: self.inbox.clone(),
            generation,
        });
        let player = self.opener.open(self.source.clone(), events, surface);
        if self.volume < 1.0 {
            player.set_volume(self.volume);
        }
        if self.muted {
            player.set_muted(true);
        }
        player.play();
        self.player = Some(player);
    }

    /// Play or pause, whatever that means now. Opening is the first play.
    pub fn toggle(&mut self) {
        match &self.phase {
            Phase::Idle => self.open(),
            Phase::Playing | Phase::Buffering => self.command(|p| p.pause()),
            Phase::Paused | Phase::Ended => self.command(|p| p.play()),
            Phase::Loading | Phase::Failed(_) => {}
        }
    }

    /// Stops for good and goes back to the first state, freeing the player and its surface (a
    /// sign-out). The next play opens again.
    pub fn close(&mut self) {
        self.player = None;
        self.generation += 1;
        self.inbox.current.store(u64::MAX, Ordering::Release);
        if let Some(frames) = &self.frames {
            frames.end(&self.key());
        }
        self.phase = Phase::Idle;
        self.position = Duration::ZERO;
        self.buffered.clear();
    }

    /// Opens a failed source again.
    pub fn retry(&mut self) {
        self.open();
    }

    pub fn seek(&mut self, to: Duration) {
        if !self.phase.is_open() {
            return;
        }
        let to = self.duration.map_or(to, |d| to.min(d));
        self.position = to;
        self.command(|p| p.seek(to));
    }

    pub fn seek_by(&mut self, forward: bool) {
        let to = model::seek_by(self.position, forward, model::SEEK_STEP, self.duration);
        self.seek(to);
    }

    /// Moving the volume unmutes, as the web's slider does.
    pub fn set_volume(&mut self, volume: f32) {
        let volume = volume.clamp(0., 1.);
        self.volume = volume;
        let unmute = self.muted && volume > 0.;
        if unmute {
            self.muted = false;
        }
        self.command(|p| {
            p.set_volume(volume);
            if unmute {
                p.set_muted(false);
            }
        });
    }

    pub fn toggle_mute(&mut self) {
        self.muted = !self.muted;
        let muted = self.muted;
        self.command(|p| p.set_muted(muted));
    }

    fn command(&self, f: impl FnOnce(&dyn MediaPlayer)) {
        if let Some(player) = &self.player {
            f(player.as_ref());
        }
    }

    /// Applies what the current player said. True when anything (a frame included) changed.
    pub fn drain(&mut self) -> bool {
        let (events, frame) = self.inbox.take();
        let mut changed = frame;
        for (generation, event) in events {
            if generation == self.generation {
                self.apply(event);
                changed = true;
            }
        }
        changed
    }

    fn apply(&mut self, event: PlayerEvent) {
        match event {
            PlayerEvent::State(state) => {
                self.phase = state.into();
                if self.phase == Phase::Ended
                    && let Some(duration) = self.duration
                {
                    self.position = duration;
                }
            }
            PlayerEvent::Metadata(meta) => {
                self.duration = meta.duration;
                self.has_video = meta.has_video;
                if meta.width > 0 && meta.height > 0 {
                    self.natural = Some((meta.width, meta.height));
                }
            }
            PlayerEvent::Position(position) => self.position = position,
            PlayerEvent::Buffered(ranges) => self.buffered = ranges,
        }
    }
}

impl Drop for Playback {
    fn drop(&mut self) {
        // No open is current any more: a late frame from the player's thread writes nothing,
        // and the surface goes now rather than when that thread gets round to it.
        self.inbox.current.store(u64::MAX, Ordering::Release);
        self.player = None;
        if let Some(frames) = &self.frames {
            frames.end(&self.key());
        }
    }
}
