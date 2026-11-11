//! Voice calls: participants, video tracks and tiles.

use super::UserView;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum VoiceStatus {
    #[default]
    Disconnected,
    Connecting,
    Connected,
    Reconnecting,
}

/// A video track. Frames never pass through core: the media crate gives them, by this sid, to
/// whatever the app connected as its video sink.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VideoTrackView {
    pub track_sid: String,
    pub width: u32,
    pub height: u32,
}

/// A connection's health, as the three-bar indicator shows it.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum ConnectionQuality {
    #[default]
    Unknown,
    Excellent,
    Good,
    Poor,
    Lost,
}

/// A video tile on screen right now. A track with no demand is paused at the SFU, so it costs no
/// downlink and no decode. The engine picks the layer from this: decoding the top layer costs about
/// a core per tile, and core has no business knowing what a layer is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VideoDemand {
    pub track_sid: String,
    /// Tile size in physical pixels.
    pub width_px: u32,
    pub height_px: u32,
    /// The main view: a focused share gets its top layer whatever its size, as on the web, because
    /// the top layer is the only one that carries the full frame rate.
    pub focused: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ParticipantView {
    pub identity: String,
    pub user: UserView,
    pub is_self: bool,
    pub speaking: bool,
    pub muted: bool,
    pub deafened: bool,
    pub camera: Option<VideoTrackView>,
    pub screen_share: Option<VideoTrackView>,
    pub quality: ConnectionQuality,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct VoiceView {
    pub status: VoiceStatus,
    pub channel_id: Option<String>,
    pub muted: bool,
    pub deafened: bool,
    pub participants: Vec<ParticipantView>,
    /// Which attempt a rejoin is on while one runs, for "Reconnecting voice (3)...".
    pub reconnect_attempt: Option<u32>,
    /// Why a rejoin keeps failing, or, once `Disconnected`, why the call ended.
    pub error: Option<String>,
    /// What we send besides the mic: camera, screen and the screen's audio.
    pub local: LocalMediaView,
}

/// One thing we may send, as its button shows it.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub enum LocalShare {
    #[default]
    Off,
    /// Asked for and not yet sent: a camera opening, the screen picker open.
    Starting,
    On,
    /// It didn't start, or stopped on its own, and why. Asking again retries.
    Failed {
        message: String,
    },
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct LocalMediaView {
    pub camera: LocalShare,
    pub screen: LocalShare,
    /// The system audio that goes with the screen. Its failing leaves the screen on.
    pub screen_audio: LocalShare,
    /// Whether this call lets us send a camera, and a screen with its audio: the room's publish
    /// permissions, as the media engine reports them. False until it has.
    pub may_camera: bool,
    pub may_share: bool,
}

/// How big a screen share is sent: the box it's scaled to fit, keeping its shape, or its own size.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum ShareResolution {
    Native,
    P2160,
    P1440,
    #[default]
    P1080,
    P720,
    P480,
}

/// What to share and how.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScreenShareRequest {
    /// A source from `ScreenCapture::sources`, or `None` where the platform's own picker chooses
    /// (`PickerKind::System`: the portal on Wayland).
    pub source_id: Option<String>,
    pub resolution: ShareResolution,
    /// Frames a second: 15, 30 or 60.
    pub fps: u32,
    /// Share the system's audio too: everything except our own call.
    pub audio: bool,
}

impl Default for ScreenShareRequest {
    /// The web's defaults: 1080p at 60 fps, with audio.
    fn default() -> Self {
        Self {
            source_id: None,
            resolution: ShareResolution::P1080,
            fps: 60,
            audio: true,
        }
    }
}
