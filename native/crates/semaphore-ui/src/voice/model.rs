//! What the voice UI draws and what it can ask for. `VoiceView` is core's; the rest is here because
//! it's the app's (quality and rejoin from the engine, push-to-talk).

use semaphore_core::model::{LocalShare, ParticipantView, VideoTrackView, VoiceView};
use std::collections::HashMap;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum QualityLevel {
    #[default]
    Unknown,
    Excellent,
    Good,
    Poor,
    Lost,
}

impl QualityLevel {
    /// Bars lit out of three, as `describeConnectionQuality` does on the web.
    pub fn bars(self) -> usize {
        match self {
            Self::Excellent => 3,
            Self::Good => 2,
            Self::Poor | Self::Lost => 1,
            Self::Unknown => 0,
        }
    }

    /// Worth drawing over a tile? Only trouble is: every healthy tile saying so is noise.
    pub fn is_trouble(self) -> bool {
        matches!(self, Self::Poor | Self::Lost)
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PttState {
    pub held: bool,
    pub key_label: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct VoiceStageModel {
    pub voice: VoiceView,
    pub channel_name: String,
    pub is_dm: bool,
    /// By identity.
    pub quality: HashMap<String, QualityLevel>,
    pub local_quality: QualityLevel,
    /// Which attempt an app-level rejoin is on, when one is running.
    pub reconnect_attempt: Option<u32>,
    pub ptt: Option<PttState>,
    /// Name strips stay up, for touch screens, which never hover, and for review screenshots.
    pub always_show_overlays: bool,
}

impl QualityLevel {
    /// Core's quality, as the bars show it.
    pub fn from_core(quality: semaphore_core::model::ConnectionQuality) -> Self {
        use semaphore_core::model::ConnectionQuality as Core;
        match quality {
            Core::Unknown => Self::Unknown,
            Core::Excellent => Self::Excellent,
            Core::Good => Self::Good,
            Core::Poor => Self::Poor,
            Core::Lost => Self::Lost,
        }
    }
}

/// A tile on screen right now, as the media layer needs it: core's `VideoDemand`, which the app hands
/// straight to `Core::set_video_demands`. Anything unlisted gets paused.
pub type TileDemand = semaphore_core::model::VideoDemand;

/// What the buttons and the renderer ask for. The app implements it over the media engine.
pub trait VoiceController: Send + Sync {
    fn set_muted(&self, muted: bool);
    fn set_deafened(&self, deafened: bool);
    fn leave(&self);
    fn set_video_demands(&self, demands: Vec<TileDemand>);
    fn ptt_pressed(&self, _pressed: bool) {}
    fn open_settings(&self) {}
    /// The narrow bar's "more": what doesn't fit on it. Settings, unless the app has more to offer.
    fn open_more(&self) {
        self.open_settings();
    }
    /// Send the camera, or stop.
    fn set_camera(&self, _on: bool) {}
    /// Share a screen or window (the app chooses how to pick one), or stop the share.
    fn toggle_screen_share(&self) {}
    /// W4: the soundboard's button. `open` is what it should be now.
    fn toggle_soundboard(&self, _open: bool) {}
    /// W4: a sound in the soundboard: `Core::play_sound(sound_id)`.
    fn play_sound(&self, _sound_id: String) {}
    /// W4: the soundboard's list failed and the user asked again: `Core::retry_failed`.
    fn retry_soundboard(&self) {}
    /// W4: the bar's (or the narrow bar's "more") Capture, shown while the replay buffer records:
    /// the owner opens the capture dialog.
    fn open_capture(&self) {}
    /// W4: a right-click (or long press) on someone's tile, at `position` in the window: the owner
    /// opens a `ParticipantMenu` there.
    fn open_participant_menu(
        &self,
        _identity: String,
        _position: gpui_kit::Point<gpui_kit::Pixels>,
    ) {
    }
}

/// W4: why the mic can't be turned on, when it can't: a moderator's server mute. (`may_speak` is
/// false until the engine reports, and fakes never do, so it doesn't block the button on its own.)
pub fn mic_blocked_reason(voice: &VoiceView) -> Option<&'static str> {
    voice.server_muted.then_some("A moderator muted you")
}

/// How a camera or screen button looks, from core's `LocalShare` and the call's permission.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShareLook {
    Off,
    /// Asked for, not yet sent: dimmed and not clickable.
    Starting,
    On,
    /// Clicking retries; the bar says why.
    Failed,
    /// The call doesn't allow it: visible, greyed, not clickable.
    NotAllowed,
}

impl ShareLook {
    pub fn of(share: &LocalShare, allowed: bool) -> Self {
        match share {
            // A share already running stays stoppable even if the permission went away.
            LocalShare::On => Self::On,
            _ if !allowed => Self::NotAllowed,
            LocalShare::Off => Self::Off,
            LocalShare::Starting => Self::Starting,
            LocalShare::Failed { .. } => Self::Failed,
        }
    }

    pub fn clickable(self) -> bool {
        matches!(self, Self::Off | Self::On | Self::Failed)
    }
}

/// The camera button's accessible name.
pub fn camera_label(look: ShareLook) -> &'static str {
    match look {
        ShareLook::Off => "Turn on camera",
        ShareLook::Starting => "Camera starting",
        ShareLook::On => "Turn off camera",
        ShareLook::Failed => "Retry camera",
        ShareLook::NotAllowed => "Camera not allowed in this call",
    }
}

/// The screen-share button's accessible name.
pub fn screen_label(look: ShareLook) -> &'static str {
    match look {
        ShareLook::Off => "Share screen",
        ShareLook::Starting => "Screen share starting",
        ShareLook::On => "Stop sharing screen",
        ShareLook::Failed => "Retry screen share",
        ShareLook::NotAllowed => "Screen share not allowed in this call",
    }
}

/// The line under the channel's name: a failure first, then what we're sending.
pub fn bar_subtitle(model: &VoiceStageModel) -> String {
    let local = &model.voice.local;
    if let LocalShare::Failed { message } = &local.camera {
        return format!("Camera failed: {message}");
    }
    if let LocalShare::Failed { message } = &local.screen {
        return format!("Screen share failed: {message}");
    }
    match (&local.screen, &local.screen_audio) {
        (LocalShare::On, LocalShare::Failed { message }) => {
            return format!("Sharing your screen (audio failed: {message})");
        }
        (LocalShare::On, _) => return "Sharing your screen".into(),
        (LocalShare::Starting, _) => return "Choosing what to share\u{2026}".into(),
        _ => {}
    }
    if model.voice.server_muted {
        return "Muted by a moderator".into();
    }
    if model.is_dm {
        "DM Voice Call".into()
    } else {
        "Voice Connected".into()
    }
}

/// For stories: every button does nothing.
#[derive(Default)]
pub struct NoController;

impl VoiceController for NoController {
    fn set_muted(&self, _: bool) {}
    fn set_deafened(&self, _: bool) {}
    fn leave(&self) {}
    fn set_video_demands(&self, _: Vec<TileDemand>) {}
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TileContent {
    Avatar,
    Camera(VideoTrackView),
    Screen(VideoTrackView),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Tile {
    pub key: String,
    pub participant: ParticipantView,
    pub content: TileContent,
}

impl Tile {
    pub fn track_sid(&self) -> Option<&str> {
        match &self.content {
            TileContent::Avatar => None,
            TileContent::Camera(track) | TileContent::Screen(track) => Some(&track.track_sid),
        }
    }

    pub fn is_screen(&self) -> bool {
        matches!(self.content, TileContent::Screen(_))
    }
}

/// One tile per stream, and an avatar for anyone with none, in the order the view lists people.
pub fn build_tiles(voice: &VoiceView) -> Vec<Tile> {
    let mut tiles = Vec::new();
    for participant in &voice.participants {
        let before = tiles.len();
        if let Some(track) = &participant.camera {
            tiles.push(Tile {
                key: format!("{}-camera", participant.identity),
                participant: participant.clone(),
                content: TileContent::Camera(track.clone()),
            });
        }
        if let Some(track) = &participant.screen_share {
            tiles.push(Tile {
                key: format!("{}-screen", participant.identity),
                participant: participant.clone(),
                content: TileContent::Screen(track.clone()),
            });
        }
        if tiles.len() == before {
            tiles.push(Tile {
                key: format!("{}-avatar", participant.identity),
                participant: participant.clone(),
                content: TileContent::Avatar,
            });
        }
    }
    tiles
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StageLayout {
    /// Nobody to show.
    Empty,
    /// Alone with nothing shared: says so, with your own tile in the corner.
    Solo,
    Grid,
    /// One tile large, the rest in a strip. A screen share goes here by default, as it needs the
    /// room to be readable.
    Stage {
        main: String,
    },
}

pub fn choose_layout(tiles: &[Tile], pinned: Option<&str>) -> StageLayout {
    if tiles.is_empty() {
        return StageLayout::Empty;
    }
    if tiles.len() == 1 && tiles[0].participant.is_self && !tiles[0].is_screen() {
        return StageLayout::Solo;
    }
    if let Some(key) = pinned
        && tiles.iter().any(|tile| tile.key == key)
    {
        return StageLayout::Stage {
            main: key.to_owned(),
        };
    }
    match tiles.iter().find(|tile| tile.is_screen()) {
        Some(screen) => StageLayout::Stage {
            main: screen.key.clone(),
        },
        None => StageLayout::Grid,
    }
}

/// The web's `getGridCols`, with its phone branch.
pub fn grid_columns(tile_count: usize, narrow: bool, portrait: bool) -> usize {
    if narrow {
        return match tile_count {
            0 | 1 => 1,
            2..=4 if portrait => 1,
            _ => 2,
        };
    }
    match tile_count {
        0 | 1 => 1,
        2..=4 => 2,
        5..=9 => 3,
        _ => 4,
    }
}

/// `stringToColor` from the web client, so a person is the same hue on both.
pub fn tile_hue(identity: &str) -> f32 {
    // JS: `hash = c + ((hash << 5) - hash)`. `<<` truncates to 32 bits; the rest stays a double.
    let mut hash: i64 = 0;
    for unit in identity.encode_utf16() {
        let shifted = i64::from((hash as i32).wrapping_shl(5));
        hash = i64::from(unit) + shifted - hash;
    }
    (hash.unsigned_abs() % 360) as f32
}

pub fn initial(name: &str) -> String {
    name.chars()
        .next()
        .map(|c| c.to_uppercase().collect())
        .unwrap_or_default()
}

pub fn display_name(participant: &ParticipantView) -> &str {
    participant
        .user
        .display_name
        .as_deref()
        .unwrap_or(&participant.user.username)
}

#[cfg(test)]
mod tests {
    use super::*;
    use semaphore_core::model::UserView;

    fn person(id: &str, is_self: bool) -> ParticipantView {
        ParticipantView {
            identity: id.into(),
            user: UserView {
                id: id.into(),
                username: id.into(),
                display_name: None,
                avatar_file_id: None,
            },
            is_self,
            ..Default::default()
        }
    }

    fn track(sid: &str) -> VideoTrackView {
        VideoTrackView {
            track_sid: sid.into(),
            width: 1280,
            height: 720,
        }
    }

    #[test]
    fn a_camera_and_a_share_are_two_tiles_and_no_stream_is_an_avatar() {
        let mut a = person("a", true);
        a.camera = Some(track("cam"));
        a.screen_share = Some(track("scr"));
        let voice = VoiceView {
            participants: vec![a, person("b", false)],
            ..Default::default()
        };
        let tiles = build_tiles(&voice);
        let keys: Vec<_> = tiles.iter().map(|t| t.key.as_str()).collect();
        assert_eq!(keys, ["a-camera", "a-screen", "b-avatar"]);
        assert_eq!(tiles[1].track_sid(), Some("scr"));
        assert_eq!(tiles[2].track_sid(), None);
    }

    #[test]
    fn layouts_follow_what_is_on_screen() {
        assert_eq!(choose_layout(&[], None), StageLayout::Empty);
        let solo = build_tiles(&VoiceView {
            participants: vec![person("me", true)],
            ..Default::default()
        });
        assert_eq!(choose_layout(&solo, None), StageLayout::Solo);

        let mut sharer = person("b", false);
        sharer.screen_share = Some(track("scr"));
        let voice = VoiceView {
            participants: vec![person("me", true), sharer, person("c", false)],
            ..Default::default()
        };
        let tiles = build_tiles(&voice);
        assert_eq!(
            choose_layout(&tiles, None),
            StageLayout::Stage {
                main: "b-screen".into()
            }
        );
        assert_eq!(
            choose_layout(&tiles, Some("c-avatar")),
            StageLayout::Stage {
                main: "c-avatar".into()
            }
        );
        assert_eq!(
            choose_layout(&tiles, Some("someone-who-left")),
            StageLayout::Stage {
                main: "b-screen".into()
            },
            "a stale pin falls back"
        );

        let plain = build_tiles(&VoiceView {
            participants: vec![person("me", true), person("c", false)],
            ..Default::default()
        });
        assert_eq!(choose_layout(&plain, None), StageLayout::Grid);
    }

    #[test]
    fn columns_match_the_web_thresholds() {
        let desktop: Vec<_> = [1, 2, 4, 5, 9, 10, 25]
            .iter()
            .map(|n| grid_columns(*n, false, false))
            .collect();
        assert_eq!(desktop, [1, 2, 2, 3, 3, 4, 4]);
        assert_eq!(grid_columns(4, true, true), 1);
        assert_eq!(grid_columns(4, true, false), 2);
        assert_eq!(grid_columns(5, true, true), 2);
    }

    /// Expected values are the web client's `stringToColor` loop run with JS's number semantics
    /// (`<<` truncating to 32 bits, everything else a double).
    #[test]
    fn hues_match_the_web_client() {
        assert_eq!(tile_hue("alice"), TILE_HUE_ALICE);
        assert_eq!(tile_hue("ben.smith"), TILE_HUE_BEN);
    }

    const TILE_HUE_ALICE: f32 = 0.0;
    const TILE_HUE_BEN: f32 = 72.0;

    #[test]
    fn your_own_screen_share_takes_the_stage() {
        let mut me = person("me", true);
        me.screen_share = Some(track("own-screen"));
        let alone = build_tiles(&VoiceView {
            participants: vec![me.clone()],
            ..Default::default()
        });
        assert_eq!(
            choose_layout(&alone, None),
            StageLayout::Stage {
                main: "me-screen".into()
            },
            "not the solo card"
        );
        let with_others = build_tiles(&VoiceView {
            participants: vec![me, person("b", false)],
            ..Default::default()
        });
        assert_eq!(
            choose_layout(&with_others, None),
            StageLayout::Stage {
                main: "me-screen".into()
            }
        );
    }

    #[test]
    fn buttons_follow_the_share_and_the_permission() {
        let failed = LocalShare::Failed {
            message: "no".into(),
        };
        assert_eq!(ShareLook::of(&LocalShare::Off, true), ShareLook::Off);
        assert_eq!(
            ShareLook::of(&LocalShare::Starting, true),
            ShareLook::Starting
        );
        assert_eq!(ShareLook::of(&LocalShare::On, true), ShareLook::On);
        assert_eq!(ShareLook::of(&failed, true), ShareLook::Failed);
        assert_eq!(
            ShareLook::of(&LocalShare::Off, false),
            ShareLook::NotAllowed
        );
        assert_eq!(ShareLook::of(&failed, false), ShareLook::NotAllowed);
        assert_eq!(ShareLook::of(&LocalShare::On, false), ShareLook::On);
        assert!(!ShareLook::Starting.clickable());
        assert!(!ShareLook::NotAllowed.clickable());
        assert!(ShareLook::Failed.clickable());
        assert_eq!(camera_label(ShareLook::On), "Turn off camera");
        assert_eq!(screen_label(ShareLook::Off), "Share screen");
    }

    #[test]
    fn the_subtitle_says_what_failed_then_what_is_sent() {
        let mut model = VoiceStageModel::default();
        assert_eq!(bar_subtitle(&model), "Voice Connected");
        model.voice.local.screen = LocalShare::Starting;
        assert_eq!(bar_subtitle(&model), "Choosing what to share\u{2026}");
        model.voice.local.screen = LocalShare::On;
        assert_eq!(bar_subtitle(&model), "Sharing your screen");
        model.voice.local.screen_audio = LocalShare::Failed {
            message: "no PipeWire".into(),
        };
        assert_eq!(
            bar_subtitle(&model),
            "Sharing your screen (audio failed: no PipeWire)"
        );
        model.voice.local.camera = LocalShare::Failed {
            message: "no camera".into(),
        };
        assert_eq!(bar_subtitle(&model), "Camera failed: no camera");
    }

    #[test]
    fn only_trouble_shows_on_a_tile() {
        assert!(QualityLevel::Poor.is_trouble());
        assert!(!QualityLevel::Good.is_trouble());
        assert_eq!(QualityLevel::Good.bars(), 2);
    }
}
