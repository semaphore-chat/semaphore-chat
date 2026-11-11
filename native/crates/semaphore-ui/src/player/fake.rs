//! A scripted [`MediaPlayer`] for stories and tests: it records every call, answers with the
//! states and positions its [`Script`] says, and paints solid-colour frames. No decoding, no
//! threads: events are sent from inside the calls, as a real player sends them from its thread.

use super::session::{PlayerOpener, PlayerSurface};
use gpui_kit::Nv12Frame;
use semaphore_core::player::{
    MediaPlayer, Metadata, PlaybackSource, PlaybackState, PlayerError, PlayerEvent, PlayerEvents,
};
use std::ops::Range;
use std::rc::Rc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// A call the view made.
#[derive(Debug, Clone, PartialEq)]
pub enum Call {
    Open(String),
    Play,
    Pause,
    Seek(Duration),
    Volume(f32),
    Muted(bool),
}

/// What the fake answers.
#[derive(Debug, Clone)]
pub struct Script {
    /// What opening finds: `None` stays loading for good.
    pub open: Option<Result<Metadata, PlayerError>>,
    /// The state `play()` reports (Playing, or Buffering, Paused, Ended to show those).
    pub on_play: PlaybackState,
    /// Where it says it is once opened.
    pub position: Duration,
    pub buffered: Vec<Range<f32>>,
    /// A frame of this colour lands on the surface when opened (video only).
    pub colour: Option<[u8; 3]>,
}

impl Script {
    /// A 2:05 clip, 1280x720 with sound, that plays from 0:00, a third fetched.
    pub fn video() -> Self {
        Self {
            open: Some(Ok(Metadata {
                duration: Some(Duration::from_secs(125)),
                has_video: true,
                has_audio: true,
                width: 1280,
                height: 720,
            })),
            on_play: PlaybackState::Playing,
            position: Duration::ZERO,
            buffered: vec![0.0..0.35],
            colour: Some([38, 98, 160]),
        }
    }

    /// A 3:04 track.
    pub fn audio() -> Self {
        Self {
            open: Some(Ok(Metadata {
                duration: Some(Duration::from_secs(184)),
                has_video: false,
                has_audio: true,
                width: 0,
                height: 0,
            })),
            colour: None,
            ..Self::video()
        }
    }

    pub fn failing(error: PlayerError) -> Self {
        Self {
            open: Some(Err(error)),
            ..Self::video()
        }
    }

    pub fn loading() -> Self {
        Self {
            open: None,
            ..Self::video()
        }
    }

    pub fn at(mut self, position: Duration, on_play: PlaybackState) -> Self {
        self.position = position;
        self.on_play = on_play;
        self
    }

    pub fn duration(mut self, duration: Duration) -> Self {
        if let Some(Ok(meta)) = &mut self.open {
            meta.duration = Some(duration);
        }
        self
    }

    pub fn buffered(mut self, ranges: Vec<Range<f32>>) -> Self {
        self.buffered = ranges;
        self
    }
}

/// What the latest open was handed, so a test can speak as the player's thread.
#[derive(Clone)]
pub struct FakeHandle {
    pub events: PlayerEvents,
    pub surface: Option<PlayerSurface>,
}

impl FakeHandle {
    pub fn emit(&self, event: PlayerEvent) {
        (self.events)(event);
    }

    pub fn frame(&self, colour: [u8; 3]) {
        if let Some(surface) = &self.surface {
            push_solid(surface, colour, 64, 36);
        }
    }
}

/// Opens [`FakePlayer`]s that follow a script and log into one list.
#[derive(Clone)]
pub struct FakeOpener {
    pub script: Arc<Mutex<Script>>,
    pub calls: Arc<Mutex<Vec<Call>>>,
    pub last: Arc<Mutex<Option<FakeHandle>>>,
}

impl FakeOpener {
    pub fn new(script: Script) -> Self {
        Self {
            script: Arc::new(Mutex::new(script)),
            calls: Arc::default(),
            last: Arc::default(),
        }
    }

    pub fn rc(script: Script) -> (Rc<dyn PlayerOpener>, Self) {
        let opener = Self::new(script);
        (Rc::new(opener.clone()), opener)
    }

    pub fn calls(&self) -> Vec<Call> {
        self.calls.lock().unwrap().clone()
    }

    pub fn clear(&self) {
        self.calls.lock().unwrap().clear();
    }

    /// The latest open's events and surface.
    pub fn handle(&self) -> FakeHandle {
        self.last.lock().unwrap().clone().expect("opened")
    }

    pub fn set_script(&self, script: Script) {
        *self.script.lock().unwrap() = script;
    }
}

impl PlayerOpener for FakeOpener {
    fn open(
        &self,
        source: PlaybackSource,
        events: PlayerEvents,
        surface: Option<PlayerSurface>,
    ) -> Box<dyn MediaPlayer> {
        self.calls
            .lock()
            .unwrap()
            .push(Call::Open(source.file_id.clone()));
        *self.last.lock().unwrap() = Some(FakeHandle {
            events: events.clone(),
            surface: surface.clone(),
        });
        let script = self.script.lock().unwrap().clone();
        let opened = match &script.open {
            Some(Ok(meta)) => {
                events(PlayerEvent::Metadata(meta.clone()));
                events(PlayerEvent::Buffered(script.buffered.clone()));
                events(PlayerEvent::Position(script.position));
                if let (Some(colour), Some(surface)) = (script.colour, &surface) {
                    push_solid(surface, colour, meta.width.max(2), meta.height.max(2));
                }
                true
            }
            Some(Err(error)) => {
                events(PlayerEvent::State(PlaybackState::Failed(error.clone())));
                false
            }
            None => false,
        };
        Box::new(FakePlayer {
            events,
            calls: self.calls.clone(),
            opened,
            on_play: script.on_play,
        })
    }
}

pub struct FakePlayer {
    events: PlayerEvents,
    calls: Arc<Mutex<Vec<Call>>>,
    opened: bool,
    on_play: PlaybackState,
}

impl FakePlayer {
    fn log(&self, call: Call) {
        self.calls.lock().unwrap().push(call);
    }
}

impl MediaPlayer for FakePlayer {
    fn play(&self) {
        self.log(Call::Play);
        if self.opened {
            (self.events)(PlayerEvent::State(self.on_play.clone()));
        }
    }

    fn pause(&self) {
        self.log(Call::Pause);
        if self.opened {
            (self.events)(PlayerEvent::State(PlaybackState::Paused));
        }
    }

    fn seek(&self, to: Duration) {
        self.log(Call::Seek(to));
        if self.opened {
            (self.events)(PlayerEvent::Position(to));
        }
    }

    fn set_volume(&self, volume: f32) {
        self.log(Call::Volume(volume));
    }

    fn set_muted(&self, muted: bool) {
        self.log(Call::Muted(muted));
    }
}

/// A `width` x `height` NV12 frame of one colour (BT.601 limited range, the surface's matrix).
pub fn push_solid(surface: &PlayerSurface, [r, g, b]: [u8; 3], width: u32, height: u32) {
    let (width, height) = (width & !1, height & !1);
    let (r, g, b) = (f32::from(r), f32::from(g), f32::from(b));
    let y = (16. + (65.481 * r + 128.553 * g + 24.966 * b) / 255.).round() as u8;
    let u = (128. + (-37.797 * r - 74.203 * g + 112. * b) / 255.).round() as u8;
    let v = (128. + (112. * r - 93.786 * g - 18.214 * b) / 255.).round() as u8;
    let luma = vec![y; (width * height) as usize];
    let chroma: Vec<u8> = [u, v].repeat((width * height / 4) as usize);
    surface.upload(&Nv12Frame {
        width,
        height,
        y: &luma,
        y_stride: width,
        uv: &chroma,
        uv_stride: width,
    });
}
