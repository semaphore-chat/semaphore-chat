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
}
