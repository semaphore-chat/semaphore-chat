//! U13's end-to-end rig: the real app, headless on lavapipe, against `semaphore-fake-server`.
//!
//!   rig-slice --server <url> [--scenario <file.json>] --script <file.steps> --out <dir>
//!
//! Without `--scenario` (a real backend: `scripts/slice-real.sh`), the clock is the machine's.
//!
//! It runs `rig-shot`'s steps (click, type, press, drag, wait idle, shot, expect label...) and these:
//!
//! ```text
//! app 1280 800                        # opens the app's window
//! wait core session signed-in         # until true, or fails after 15 s
//! wait core text "hello" within 5     # a row on screen contains it
//! expect core count "hello" 1         # checks once, after settling
//! server drop_connections             # POST /__control/drop_connections
//! server post_as {"channelId": "$ID(cc-general)", "authorId": "pri", "text": "hi"}
//! expect requests typingStart >= 1    # what the fake server saw, by operation or socket event
//! expect clipboard "some text"        # what the last copy put there contains this
//! os suspend                          # also resume, network-down, network-up
//! restart                             # quit as closing the window does, start again
//! tick 100                            # move GPUI's headless clock: the stage redraws on a timer
//! snap name                           # one frame, no waiting for stillness (live video)
//! attach rigs/slice/fixtures/notes.txt  # a file into the composer, as a dialog or drop would
//! link-images on                      # the next start loads link previews' images
//! livekit remove $ID(vc-squad) me    # LiveKit's server API removes someone (needs --livekit-http)
//! wait core voice connected           # also frames, muted, deafened, participant ID
//! wait core voice camera on            # camera|screen|screen-audio off|starting|on|failed
//! wait core voice own-frames screen    # our own camera's or screen's preview reached the window
//! video fail-next camera "why"         # the fake camera (or screen) refuses its next start
//! expect stored-session yes           # a refresh token is in the (memory) keyring
//! remember stored-session             # note it; then `expect stored-session rotated` after a
//! expect old-refresh-token refused    # restart, and a replay of the noted one must get 401/403
//! exec "python3 scripts/real-api.py …"  # a shell command (slice-real.sh only)
//! hover-row message "text"            # the pointer over a row's element, as click-row finds it
//! right-click-row message "text"      # a right press on it: the actions menu
//! click-text "row text" "needle"      # a click on the glyphs of `needle` in that row (a link)
//! drag-text "row" "from" "row" "to"   # a drag from the start of `from` in the first row to the
//!                                     # end of `to` in the second: a selection that follows the
//!                                     # rows wherever they are laid out
//! server post_dm_as {"dmGroupId": "…", "authorId": "…", "text": "hi"}   # likewise into a DM
//! server friend_request_as {"fromId": "…"}  # another user asks to be friends
//! notification click "dm:…"           # the OS notification with that tag is clicked
//! link "semaphore://…"                # the OS hands over a link, as a second launch would
//! forget sounds                       # what the speaker heard so far no longer counts
//! window activate                     # the window comes to the front, as a user's click would:
//!                                     # the pane marks what it shows read only then
//! core revoke-other-sessions          # W3: Core::revoke_other_sessions; fails if refused
//! pick-file rigs/slice/fixtures/a.png   # the next file picker answers with this file
//! browser approve                     # plays the browser for the last desktop-login URL opened:
//!                                     # the fake server's approve_desktop, then the loopback callback
//! expect opened-url "desktop-login"   # the last URL the app opened contains this
//! expect settings /voice/mic_quality "music"   # settings.json at that JSON pointer (JSON value)
//! expect link-registrations 1         # the fake link handler was asked to register this often
//! ```
//!
//! W3-player-wire (built with `--features player`): `player toggle NAME` plays or pauses the
//! inline player of the newest attachment with that file name, as its main button does; conditions
//! `player NAME idle|loading|playing|paused|buffering|ended|failed`, `player-frames NAME` (its video
//! reached the window) and `players-open N` (players holding an open file).
//!
//! W4's conditions: `replay off|starting|recording|failed`, `clips N` (the open profile page's
//! library), `dialog capture|share|participant-menu|kick|debug open|closed`, `ringing yes|no|DM_ID`,
//! `ring looping|stopped` (the ring's sound), `cue NAME N` (core asked for the cue at least N
//! times: joined, left, connected, disconnected, ring-start, ring-stop, call-ended), `voice room
//! none|dm ID|channel ID`, `voice server-muted yes|no`, `keep-awake on|off` (the rig's inhibitor),
//! `mic-test running|stopped`, `mic-level heard`, `engine vad N`, `soundboard playing ID|none`,
//! `livekit track ROOM IDENTITY NAME` (LiveKit's server lists it), `float shown|hidden`, `saved NAME` (a download reached the
//! run's `saved/NAME`). `save-as NAME` answers the next save dialog with `saved/NAME`. The step
//! `mic tone on|off` makes the virtual mic play a tone; `clock hold|run` stops the scenario clock
//! counting real time (only `tick` moves it), and starts it again. `tick N` also moves
//! the scenario clock core reads by N, so the app's timers for core's deadlines fire due.
//!
//! W3's conditions: `route PREFIX` (the shell's route, as `settings/voice`, `profile/ID`,
//! `profile-edit`, `home`, `community/ID`, `channel/ID`, `dms`), `theme NAME` (the theme drawn,
//! `light-teal-minimal`), `engine ptt on|off`, `engine preset standard|high|music`, `engine
//! input|output|camera ID|default` (what the voice engine holds), `profile-open ID`, `desktop-sign-in
//! shown|gone`.
//!
//! W2's conditions: `dm ID` (the pane is on that DM), `notified TAG` (the rig's notifier shows
//! it), `withdrawn TAG` (shown, then taken down), `notifications-shown N` (shows since the start),
//! `badge N`, `centre open|closed`, `sound heard|silent` (the virtual speaker), `incoming N` (friend
//! requests to me), `friend ID`, `dms N`.
//!
//! `$SERVER` anywhere in a script is the fake server's URL, for links to it, `$MSG(sc-msg-24)`
//! the UUID the fake server serves that showcase message as (`message_uuid`), and `$ID(u-priya)`
//! the UUID it serves that showcase user, community or custom emoji as (`entity_uuid`).
//!
//! Conditions: `session signed-in|signed-out|failed`, `connection connected|disconnected|offline`,
//! `rows >= N`, `text S`, `no-text S`, `sent S` (acked), `pending S`, `failed S`, `count S N`,
//! `channel ID`, `detached`, `live`, `label NAME`; and W1's: `side-panel none|pins|search|thread`,
//! `editing yes|no`, `picker open|closed`, `pinned S`, `unpinned S`, `edited S`, `removed S`,
//! `reaction S EMOJI COUNT` (with mine among them), `thread-rows >= N`, `thread-sent S`,
//! `subscribed yes|no` (the open thread), `unread-after S` (the divider follows that row),
//! `notice S`, `no-notice`, `pinned-count N` (the header's badge), `composer-text S`,
//! `composer-placeholder S` (exactly), `search-hits >= N`, `element ID`, `no-element ID`.

mod thumbs;
mod w5;
mod w6;
mod w7;
mod w9;
mod w9v;

use anyhow::{Context as _, Result, anyhow, bail};
use gpui_kit::test::TestQueryExt as _;
use gpui_kit::test::TestWindowExt as _;
use gpui_kit::*;
use rig_shot::driver::Driver;
use rig_shot::script;
use semaphore_app::settings::SettingsStore;
use semaphore_app::{AppConfig, AppRoot, OsEvent};
use semaphore_core::model::OsNotification;
use semaphore_core::model::{
    Conversation, LocalShare, MessageRow, SendState, SessionState, VoiceStatus,
};
use semaphore_core::platform::{
    CaptureKind, CaptureSource, Clock, CoreError, Notifier, PickerKind, ScreenCapture, SecretStore,
    Thumbnail,
};
use semaphore_core::{ConnectionState, NetworkState};
use semaphore_fake_server::livekit::LiveKit;
use semaphore_media_livekit::audio::virtual_io::VirtualIo;
use semaphore_media_livekit::testing::FakeVideoSources;
use semaphore_ui::kit::set_reduced_motion;
use semaphore_ui::messages::TimeFormat;
use serde_json::Value;
use std::cell::RefCell;
use std::collections::{HashMap, VecDeque};
use std::io::{Read as _, Write as _};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const DEFAULT_WITHIN: Duration = Duration::from_secs(15);
/// The longest a wait sits without news before looking again. Something always moves within this
/// while work is in flight; it bounds a look at a condition nothing will announce.
const LOOK_EVERY: Duration = Duration::from_millis(100);

/// The keyring stand-in: memory, so nothing touches the machine's secrets.
#[derive(Default)]
struct MemorySecrets(Mutex<HashMap<String, String>>);

impl SecretStore for MemorySecrets {
    fn load(&self, key: String) -> Result<Option<String>, CoreError> {
        Ok(self.0.lock().unwrap().get(&key).cloned())
    }
    fn save(&self, key: String, value: String) -> Result<(), CoreError> {
        self.0.lock().unwrap().insert(key, value);
        Ok(())
    }
    fn delete(&self, key: String) -> Result<(), CoreError> {
        self.0.lock().unwrap().remove(&key);
        Ok(())
    }
}

/// The scenario's time, moving with real time from when the rig started: a pending or failed row
/// shows the same day and minute on every run.
struct ScenarioClock {
    start_ms: i64,
    started: Instant,
    /// `tick` and `clock hold|run`, kept across restarts.
    moves: Arc<ClockMoves>,
}

/// How the scenario clock departs from real time.
/// - `tick N` adds N ms, as it moves GPUI's clock: core's timers (a ring's 30 s, the replay
///   buffer's audio wait) are due by this clock, and the app's timers for them by GPUI's.
/// - `clock hold` stops real time counting until `clock run`, so a step that ticks to just before
///   a deadline isn't pushed past it by a slow machine.
#[derive(Default)]
struct ClockMoves {
    state: Mutex<ClockState>,
}

#[derive(Default)]
struct ClockState {
    ticked_ms: i64,
    /// Real time not counted: the holds so far.
    held_ms: i64,
    /// While held: the real elapsed time it was held at.
    holding_since: Option<i64>,
}

impl ClockMoves {
    fn tick(&self, ms: u64) {
        self.state.lock().unwrap().ticked_ms += ms as i64;
    }

    fn hold(&self, elapsed_ms: i64) {
        let mut state = self.state.lock().unwrap();
        state.holding_since.get_or_insert(elapsed_ms);
    }

    fn run(&self, elapsed_ms: i64) {
        let mut state = self.state.lock().unwrap();
        if let Some(since) = state.holding_since.take() {
            state.held_ms += elapsed_ms - since;
        }
    }

    /// A new app's clock: real time from its start again, not held; the ticks stay.
    fn restart(&self) {
        let mut state = self.state.lock().unwrap();
        state.held_ms = 0;
        state.holding_since = None;
    }

    /// Real elapsed time as the clock counts it, plus the ticks.
    fn counted(&self, elapsed_ms: i64) -> i64 {
        let state = self.state.lock().unwrap();
        let real = state.holding_since.unwrap_or(elapsed_ms) - state.held_ms;
        real + state.ticked_ms
    }
}

impl Clock for ScenarioClock {
    fn now_ms(&self) -> u64 {
        let elapsed = self.started.elapsed().as_millis() as i64;
        (self.start_ms + self.moves.counted(elapsed)) as u64
    }
}

/// Our picker's list, as X11 or Windows would give it: the same every run, so its shot compares.
struct RigScreens;

impl ScreenCapture for RigScreens {
    fn picker(&self) -> PickerKind {
        PickerKind::Listed
    }

    fn sources(&self, thumbnail_px: u32) -> Result<Vec<CaptureSource>, CoreError> {
        let thumbnail = |seed: u8| {
            let (width, height) = (thumbnail_px.max(16), thumbnail_px.max(16) * 9 / 16);
            let mut bgra = Vec::with_capacity((width * height * 4) as usize);
            for y in 0..height {
                for x in 0..width {
                    let shade = (x * 120 / width) as u8;
                    bgra.extend([seed * 40 + shade, 90, (y * 100 / height) as u8 + 60, 255]);
                }
            }
            Some(Thumbnail {
                width,
                height,
                bgra,
            })
        };
        let source = |id: &str, name: &str, kind, seed| CaptureSource {
            id: id.into(),
            name: name.into(),
            kind,
            thumbnail: thumbnail(seed),
        };
        Ok(vec![
            source("screen-1", "Screen 1", CaptureKind::Screen, 1),
            source("screen-2", "Screen 2", CaptureKind::Screen, 2),
            source("window-1", "Terminal", CaptureKind::Window, 3),
        ])
    }
}

#[derive(Debug, Clone, PartialEq)]
enum Condition {
    Session(String),
    Connection(String),
    Rows(usize),
    Text(String),
    NoText(String),
    Sent(String),
    Pending(String),
    Failed(String),
    Count(String, usize),
    Channel(String),
    Detached,
    Live,
    /// An element with this accessible name exists.
    Label(String),
    /// The call's status: `connected`, `connecting`, `reconnecting`, `disconnected`.
    Voice(String),
    /// Someone in the call has a camera whose frames have reached the window.
    VoiceFrames,
    VoiceMuted(bool),
    VoiceDeafened(bool),
    VoiceParticipant(String),
    /// What we send: `camera`, `screen` or `screen-audio`, as core's `LocalShare` says.
    VoiceLocal {
        what: String,
        state: String,
    },
    /// Our own `camera` or `screen` preview has reached the window.
    VoiceOwnFrames(String),
    /// The fake server has seen at least this many of an operation or socket event.
    Requests(String, usize),
    RequestsExactly(String, usize),
    /// The newest row containing the text has this many attachments.
    Attachments(String, usize),
    /// ... this many of this client's uploads still on it.
    Uploads(String, usize),
    /// ... and the server still waits for this many files.
    PendingFiles(String, usize),
    /// ... and one of its uploads failed.
    UploadFailed(String),
    /// The file store holds this file's bytes, ready to decode.
    FileReady(String),
    /// The image viewer is open.
    Viewer(bool),
    SidePanel(String),
    Editing(bool),
    Picker(bool),
    Pinned(String, bool),
    Edited(String),
    Removed(String),
    Reaction(String, String, u32),
    ThreadRows(usize),
    ThreadSent(String),
    Subscribed(bool),
    UnreadAfter(String),
    Notice(String),
    NoNotice,
    PinnedCount(u32),
    ComposerText(String),
    ComposerPlaceholder(String),
    SearchHits(usize),
    /// W2's.
    Dm(String),
    Notified(String),
    Withdrawn(String),
    NotificationsShown(usize),
    Badge(u32),
    Centre(bool),
    Sound(bool),
    Incoming(usize),
    Friend(String),
    Dms(usize),
    /// An element with this id is drawn (`element ID`), or isn't (`no-element ID`).
    Element(String, bool),
    /// W3's.
    Route(String),
    Theme(String),
    Engine(String, String),
    ProfileOpen(String),
    DesktopSignIn(bool),
    /// W3-player-wire: the inline player of the file with this name is in this phase
    /// (`idle|loading|playing|paused|buffering|ended|failed`).
    Player(String, String),
    /// A frame of that file's video has reached the window.
    PlayerFrames(String),
    /// This many players hold an open file.
    PlayersOpen(usize),
    /// W4's (`w4_holds`).
    W4(W4),
    /// W5's (`w5.rs`, `w5_holds`).
    W5(w5::W5),
    /// UI freeze hubs: WA's, WM's, WU's and WP's.
    W6(w6::W6),
    W7(w7::W7),
    /// W7's per-file thumbnail and box checks (`thumbs.rs`).
    W7T(thumbs::Thumbs),
    W9(w9::W9),
    W9v(w9v::W9V),
}

/// W4's conditions.
#[derive(Debug, Clone, PartialEq)]
enum W4 {
    /// `replay off|starting|recording|failed`: `VoiceView::replay`.
    Replay(String),
    /// `clips N`: the clips the open profile page's library shows (mine on my page, the user's
    /// public ones on theirs).
    Clips(usize),
    /// `dialog capture|share|participant-menu|debug|kick open|closed`.
    Dialog(String, bool),
    /// `ringing yes|no`: core has a call ringing for me; `ringing ID`: this DM's.
    Ringing(bool),
    RingingFor(String),
    /// `ring looping|stopped`: the app's ring sound.
    RingSound(bool),
    /// `cue NAME N`: core asked for this sound cue at least N times
    /// (`joined|left|connected|disconnected|ring-start|ring-stop|call-ended`).
    Cue(String, usize),
    /// `voice room none|dm ID|channel ID`.
    Room(String, Option<String>),
    /// `voice server-muted yes|no`: a moderator muted me.
    ServerMuted(bool),
    /// `keep-awake on|off`: what the app last asked of the (recording) inhibitor.
    KeepAwake(bool),
    /// `mic-test running|stopped`, and `mic-level heard`: the test's meter is above silence.
    MicTest(bool),
    MicLevelHeard,
    /// `engine vad N`: the voice-activity threshold the app gave the engine.
    EngineVad(u8),
    /// `soundboard playing ID|none`: the engine's sound in my call (`LocalMediaView::soundboard`).
    SoundboardPlaying(Option<String>),
    /// `livekit track ROOM IDENTITY NAME`: LiveKit's server lists that participant publishing a
    /// track by that name (needs --livekit-http).
    LiveKitTrack {
        room: String,
        identity: String,
        name: String,
    },
    /// `float shown|hidden`: the float card over the middle column.
    Float(bool),
    /// `saved NAME`: a download reached `<data dir>/saved/NAME`, not empty.
    Saved(String),
}

/// The sound cue a `cue NAME` names.
fn cue_named(name: &str) -> Result<semaphore_core::model::SoundCue> {
    use semaphore_core::model::SoundCue;
    Ok(match name {
        "joined" => SoundCue::UserJoined,
        "left" => SoundCue::UserLeft,
        "connected" => SoundCue::Connected,
        "disconnected" => SoundCue::Disconnected,
        "ring-start" => SoundCue::IncomingRingStart,
        "ring-stop" => SoundCue::IncomingRingStop,
        "call-ended" => SoundCue::CallEnded,
        _ => bail!("unknown sound cue {name}"),
    })
}

/// The inhibitor in the rig: it only remembers. Never the machine's.
#[derive(Default)]
struct RigKeepAwake {
    on: std::sync::atomic::AtomicBool,
}

impl semaphore_core::platform::KeepAwake for RigKeepAwake {
    fn set(&self, on: bool) -> Result<(), CoreError> {
        self.on.store(on, std::sync::atomic::Ordering::Relaxed);
        Ok(())
    }
}

/// The element each `dialog NAME` is drawn as.
fn dialog_element(name: &str) -> Result<&'static str> {
    Ok(match name {
        "capture" => "capture-body",
        "share" => "share-clip",
        "participant-menu" => "participant-menu",
        "kick" => "kick-confirm",
        "debug" => "voice-debug",
        _ => bail!("unknown dialog {name}"),
    })
}

/// What a row step does to the element it finds.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RowGesture {
    Click,
    Hover,
    RightClick,
}

#[derive(Debug, Clone, PartialEq)]
enum Step {
    Shot(script::Step),
    W7(w7::W7Step),
    App {
        width: f32,
        height: f32,
    },
    Wait {
        condition: Condition,
        within: Duration,
    },
    Expect(Condition),
    Server {
        control: String,
        body: String,
    },
    ExpectRequests {
        name: String,
        at_least: usize,
    },
    ExpectClipboard(String),
    /// Clicks a row's control, `("retry", seq)` and the like, on the newest row containing the text.
    /// With an index, the control is one of several on the row: `(name, seq << 8 | index)`.
    ClickRow {
        name: String,
        text: String,
        index: Option<u64>,
        gesture: RowGesture,
    },
    /// A click on the glyphs of `needle` in the newest row containing `text`.
    ClickText {
        text: String,
        needle: String,
    },
    /// A drag from the first glyph of `from.1` in the newest row containing `from.0` to just past
    /// the last glyph of `to.1` in the newest row containing `to.0`.
    DragText {
        from: (String, String),
        to: (String, String),
    },
    /// What the OS watcher would report.
    Os(OsEvent),
    /// Quits the app as closing the window does, then starts it again on the same keyring and data.
    Restart,
    /// Whether a refresh token is stored.
    ExpectStoredSession(bool),
    /// Notes the stored refresh token, for `expect stored-session rotated` and the replay.
    RememberStoredSession,
    /// The stored refresh token is not the one remembered: the server rotated it.
    ExpectStoredSessionRotated,
    /// Presents the remembered (rotated-out) refresh token to the server's refresh endpoint, as
    /// this install, and expects a 401 or 403: reuse detection.
    ExpectOldRefreshRefused,
    /// A shell command, for what the server is told by someone else (`real-api.py`). Fails the
    /// script on a non-zero exit. Only `slice-real.sh`'s script uses it.
    Exec(String),
    /// Moves GPUI's headless clock on: the stage redraws on a timer.
    Tick(u64),
    /// Plays or pauses the inline player of the newest file with this name.
    PlayerToggle(String),
    /// One frame to a PNG, without waiting for the window to stop changing: live video never does.
    Snap(String),
    /// Adds a file to the composer, as the file dialog, a drop or a paste would.
    Attach(PathBuf),
    /// Whether the next start loads link previews' images.
    LinkImages(bool),
    /// Asks LiveKit's server API to remove someone from a room, as a moderator would.
    LiveKitRemove {
        room: String,
        identity: String,
    },
    /// The fake camera or screen refuses its next start with this reason.
    NotificationClick(String),
    Link(String),
    /// W5: `navigate PATH`: the shell goes to that app path (`Route::parse`), as a click would.
    Navigate(String),
    /// W5: `click-label LABEL`: clicks the element whose accessible label is exactly this (for
    /// rows whose ids carry a server-made id, like a new sound's preview button).
    ClickLabel(String),
    ForgetSounds,
    ActivateWindow,
    VideoFailNext {
        screen: bool,
        why: String,
    },
    /// W3: `Core::revoke_other_sessions`, as the sessions tab's "Sign out other sessions" will.
    /// Fails the script if the server refuses.
    RevokeOtherSessions,
    /// The next file picker answers with this file.
    PickFile(PathBuf),
    /// Plays the browser for the last desktop-login URL the app opened.
    BrowserApprove,
    ExpectOpenedUrl(String),
    ExpectSettings {
        pointer: String,
        value: String,
    },
    ExpectLinkRegistrations(usize),
    /// W4: `mic tone on|off`.
    MicTone(bool),
    /// W4: `save-as NAME`: the next save dialog answers `<data dir>/saved/NAME`.
    SaveAs(String),
    /// W4: `clock hold|run`: the scenario clock stops counting real time, or counts it again.
    ClockHold(bool),
}

fn condition(words: &[&str]) -> Result<Condition> {
    let number = |value: &str| -> Result<usize> {
        value
            .parse()
            .map_err(|_| anyhow!("{value} is not a number"))
    };
    Ok(match words {
        ["session", state] => Condition::Session((*state).into()),
        ["connection", state] => Condition::Connection((*state).into()),
        ["rows", ">=", count] => Condition::Rows(number(count)?),
        ["text", text] => Condition::Text((*text).into()),
        ["no-text", text] => Condition::NoText((*text).into()),
        ["sent", text] => Condition::Sent((*text).into()),
        ["pending", text] => Condition::Pending((*text).into()),
        ["failed", text] => Condition::Failed((*text).into()),
        ["count", text, count] => Condition::Count((*text).into(), number(count)?),
        ["channel", id] => Condition::Channel((*id).into()),
        ["detached"] => Condition::Detached,
        ["live"] => Condition::Live,
        ["label", label] => Condition::Label((*label).into()),
        ["voice", "frames"] => Condition::VoiceFrames,
        ["voice", "muted"] => Condition::VoiceMuted(true),
        ["voice", "unmuted"] => Condition::VoiceMuted(false),
        ["voice", "deafened"] => Condition::VoiceDeafened(true),
        ["voice", "undeafened"] => Condition::VoiceDeafened(false),
        ["voice", "participant", identity] => Condition::VoiceParticipant((*identity).into()),
        [
            "voice",
            what @ ("camera" | "screen" | "screen-audio"),
            state,
        ] => Condition::VoiceLocal {
            what: (*what).into(),
            state: (*state).into(),
        },
        ["voice", "own-frames", what @ ("camera" | "screen")] => {
            Condition::VoiceOwnFrames((*what).into())
        }
        ["requests", name, ">=", count] => Condition::Requests((*name).into(), number(count)?),
        ["requests", name, "==", count] => {
            Condition::RequestsExactly((*name).into(), number(count)?)
        }
        ["attachments", text, count] => Condition::Attachments((*text).into(), number(count)?),
        ["uploads", text, count] => Condition::Uploads((*text).into(), number(count)?),
        ["pending-files", text, count] => Condition::PendingFiles((*text).into(), number(count)?),
        ["upload-failed", text] => Condition::UploadFailed((*text).into()),
        ["file-ready", file_id] => Condition::FileReady((*file_id).into()),
        ["viewer", "open"] => Condition::Viewer(true),
        ["viewer", "closed"] => Condition::Viewer(false),
        ["side-panel", kind @ ("none" | "pins" | "search" | "thread")] => {
            Condition::SidePanel((*kind).into())
        }
        ["editing", "yes"] => Condition::Editing(true),
        ["editing", "no"] => Condition::Editing(false),
        ["picker", "open"] => Condition::Picker(true),
        ["picker", "closed"] => Condition::Picker(false),
        ["pinned", text] => Condition::Pinned((*text).into(), true),
        ["unpinned", text] => Condition::Pinned((*text).into(), false),
        ["edited", text] => Condition::Edited((*text).into()),
        ["removed", text] => Condition::Removed((*text).into()),
        ["reaction", text, emoji, count] => {
            Condition::Reaction((*text).into(), (*emoji).into(), number(count)? as u32)
        }
        ["thread-rows", ">=", count] => Condition::ThreadRows(number(count)?),
        ["thread-sent", text] => Condition::ThreadSent((*text).into()),
        ["subscribed", "yes"] => Condition::Subscribed(true),
        ["subscribed", "no"] => Condition::Subscribed(false),
        ["unread-after", text] => Condition::UnreadAfter((*text).into()),
        ["notice", text] => Condition::Notice((*text).into()),
        ["no-notice"] => Condition::NoNotice,
        ["pinned-count", count] => Condition::PinnedCount(number(count)? as u32),
        ["composer-text", text] => Condition::ComposerText((*text).into()),
        ["composer-placeholder", text] => Condition::ComposerPlaceholder((*text).into()),
        ["search-hits", ">=", count] => Condition::SearchHits(number(count)?),
        ["element", id] => Condition::Element((*id).into(), true),
        ["no-element", id] => Condition::Element((*id).into(), false),
        ["dm", id] => Condition::Dm((*id).into()),
        ["notified", tag] => Condition::Notified((*tag).into()),
        ["withdrawn", tag] => Condition::Withdrawn((*tag).into()),
        ["notifications-shown", count] => Condition::NotificationsShown(number(count)?),
        ["badge", count] => Condition::Badge(number(count)? as u32),
        ["centre", "open"] => Condition::Centre(true),
        ["centre", "closed"] => Condition::Centre(false),
        ["sound", "heard"] => Condition::Sound(true),
        ["sound", "silent"] => Condition::Sound(false),
        ["incoming", count] => Condition::Incoming(number(count)?),
        ["friend", id] => Condition::Friend((*id).into()),
        ["dms", count] => Condition::Dms(number(count)?),
        ["route", route] => Condition::Route((*route).into()),
        ["theme", name] => Condition::Theme((*name).into()),
        [
            "engine",
            key @ ("ptt" | "preset" | "input" | "output" | "camera"),
            value,
        ] => Condition::Engine((*key).into(), (*value).into()),
        ["profile-open", id] => Condition::ProfileOpen((*id).into()),
        ["desktop-sign-in", "shown"] => Condition::DesktopSignIn(true),
        ["desktop-sign-in", "gone"] => Condition::DesktopSignIn(false),
        ["voice", status] => Condition::Voice((*status).into()),
        ["player", name, phase] => Condition::Player((*name).into(), (*phase).into()),
        ["player-frames", name] => Condition::PlayerFrames((*name).into()),
        ["players-open", count] => Condition::PlayersOpen(number(count)?),
        [
            "replay",
            state @ ("off" | "starting" | "recording" | "failed"),
        ] => Condition::W4(W4::Replay((*state).into())),
        ["clips", count] => Condition::W4(W4::Clips(number(count)?)),
        ["w5", rest @ ..] => Condition::W5(w5::parse(rest)?),
        ["w6", rest @ ..] => Condition::W6(w6::parse(rest)?),
        ["w7", rest @ ..] => Condition::W7(w7::parse(rest)?),
        ["w7t", rest @ ..] => Condition::W7T(thumbs::parse(rest)?),
        ["w9", rest @ ..] => Condition::W9(w9::parse(rest)?),
        ["w9v", rest @ ..] => Condition::W9v(w9v::parse(rest)?),
        ["ringing", yes @ ("yes" | "no")] => Condition::W4(W4::Ringing(*yes == "yes")),
        ["ringing", dm] => Condition::W4(W4::RingingFor((*dm).into())),
        ["ring", state @ ("looping" | "stopped")] => {
            Condition::W4(W4::RingSound(*state == "looping"))
        }
        ["cue", name, count] => {
            cue_named(name)?;
            Condition::W4(W4::Cue((*name).into(), number(count)?))
        }
        ["voice", "room", "none"] => Condition::W4(W4::Room("none".into(), None)),
        ["voice", "room", kind @ ("dm" | "channel"), id] => {
            Condition::W4(W4::Room((*kind).into(), Some((*id).into())))
        }
        ["voice", "server-muted", yes @ ("yes" | "no")] => {
            Condition::W4(W4::ServerMuted(*yes == "yes"))
        }
        ["keep-awake", on @ ("on" | "off")] => Condition::W4(W4::KeepAwake(*on == "on")),
        ["mic-test", state @ ("running" | "stopped")] => {
            Condition::W4(W4::MicTest(*state == "running"))
        }
        ["mic-level", "heard"] => Condition::W4(W4::MicLevelHeard),
        ["engine", "vad", threshold] => Condition::W4(W4::EngineVad(
            threshold
                .parse()
                .map_err(|_| anyhow!("{threshold} is not a threshold"))?,
        )),
        ["soundboard", "playing", "none"] => Condition::W4(W4::SoundboardPlaying(None)),
        ["soundboard", "playing", id] => Condition::W4(W4::SoundboardPlaying(Some((*id).into()))),
        ["livekit", "track", room, identity, name] => Condition::W4(W4::LiveKitTrack {
            room: (*room).into(),
            identity: (*identity).into(),
            name: (*name).into(),
        }),
        ["float", state @ ("shown" | "hidden")] => Condition::W4(W4::Float(*state == "shown")),
        ["saved", name] => Condition::W4(W4::Saved((*name).into())),
        ["dialog", name, state @ ("open" | "closed")] => {
            dialog_element(name)?;
            Condition::W4(W4::Dialog((*name).into(), *state == "open"))
        }
        _ => bail!("not a condition: {}", words.join(" ")),
    })
}

/// `$MSG(sc-cc-pit-caption)` is the UUID the fake server serves that showcase message as.
fn message_ids(source: &str) -> String {
    let source = expand(source, "$MSG(", semaphore_fake_server::message_uuid);
    expand(&source, "$ID(", semaphore_fake_server::entity_uuid)
}

/// Every `<open>readable)` in `source`, through `map`.
fn expand(source: &str, open: &str, map: fn(&str) -> String) -> String {
    let mut out = String::with_capacity(source.len());
    let mut rest = source;
    while let Some(start) = rest.find(open) {
        let from = start + open.len();
        let Some(len) = rest[from..].find(')') else {
            break;
        };
        out.push_str(&rest[..start]);
        out.push_str(&map(&rest[from..from + len]));
        rest = &rest[from + len + 1..];
    }
    out.push_str(rest);
    out
}

fn parse(source: &str) -> Result<Vec<Step>> {
    let mut steps = Vec::new();
    for (index, line) in source.lines().enumerate() {
        let at = |error: anyhow::Error| anyhow!("line {}: {error}", index + 1);
        let words = script::words(line).map_err(|error| at(anyhow!(error)))?;
        if words.is_empty() {
            continue;
        }
        let words: Vec<&str> = words.iter().map(String::as_str).collect();
        let step = match words.as_slice() {
            ["app", width, height] => Step::App {
                width: width.parse().map_err(|_| at(anyhow!("width")))?,
                height: height.parse().map_err(|_| at(anyhow!("height")))?,
            },
            ["wait", "core", rest @ ..] => {
                let (rest, within) = match rest {
                    [head @ .., "within", seconds] => (
                        head,
                        Duration::from_secs(seconds.parse().map_err(|_| at(anyhow!("within")))?),
                    ),
                    _ => (rest, DEFAULT_WITHIN),
                };
                Step::Wait {
                    condition: condition(rest).map_err(at)?,
                    within,
                }
            }
            ["expect", "core", rest @ ..] => Step::Expect(condition(rest).map_err(at)?),
            ["server", control] => Step::Server {
                control: (*control).into(),
                body: String::new(),
            },
            ["server", control, body] => Step::Server {
                control: (*control).into(),
                body: (*body).into(),
            },
            ["expect", "requests", name, ">=", count] => Step::ExpectRequests {
                name: (*name).into(),
                at_least: count.parse().map_err(|_| at(anyhow!("count")))?,
            },
            ["expect", "clipboard", text] => Step::ExpectClipboard((*text).into()),
            ["os", "suspend"] => Step::Os(OsEvent::Suspending),
            ["os", "resume"] => Step::Os(OsEvent::Resumed),
            ["os", "network-down"] => Step::Os(OsEvent::Network(NetworkState::Unavailable)),
            ["os", "network-up"] => Step::Os(OsEvent::Network(NetworkState::Available)),
            ["restart"] => Step::Restart,
            ["w7", rest @ ..] => Step::W7(w7::parse_step(rest).map_err(at)?),
            ["tick", ms] => Step::Tick(ms.parse().map_err(|_| at(anyhow!("tick ms")))?),
            ["player", "toggle", name] => Step::PlayerToggle((*name).into()),
            ["snap", name] => Step::Snap((*name).into()),
            ["attach", path] => Step::Attach(PathBuf::from(path)),
            ["link-images", "on"] => Step::LinkImages(true),
            ["link-images", "off"] => Step::LinkImages(false),
            ["livekit", "remove", room, identity] => Step::LiveKitRemove {
                room: (*room).into(),
                identity: (*identity).into(),
            },
            ["video", "fail-next", what @ ("camera" | "screen"), why] => Step::VideoFailNext {
                screen: *what == "screen",
                why: (*why).into(),
            },
            ["expect", "stored-session", "yes"] => Step::ExpectStoredSession(true),
            ["expect", "stored-session", "no"] => Step::ExpectStoredSession(false),
            ["remember", "stored-session"] => Step::RememberStoredSession,
            ["expect", "stored-session", "rotated"] => Step::ExpectStoredSessionRotated,
            ["expect", "old-refresh-token", "refused"] => Step::ExpectOldRefreshRefused,
            ["exec", command] => Step::Exec((*command).into()),
            ["notification", "click", tag] => Step::NotificationClick((*tag).into()),
            ["link", url] => Step::Link((*url).into()),
            ["navigate", path] => Step::Navigate(message_ids(path)),
            ["click-label", label] => Step::ClickLabel((*label).into()),
            ["forget", "sounds"] => Step::ForgetSounds,
            ["mic", "tone", on @ ("on" | "off")] => Step::MicTone(*on == "on"),
            ["save-as", name] => Step::SaveAs((*name).into()),
            ["clock", state @ ("hold" | "run")] => Step::ClockHold(*state == "hold"),
            ["core", "revoke-other-sessions"] => Step::RevokeOtherSessions,
            ["pick-file", path] => Step::PickFile(PathBuf::from(path)),
            ["browser", "approve"] => Step::BrowserApprove,
            ["expect", "opened-url", text] => Step::ExpectOpenedUrl((*text).into()),
            ["expect", "settings", pointer, value] => Step::ExpectSettings {
                pointer: (*pointer).into(),
                value: (*value).into(),
            },
            ["expect", "link-registrations", count] => {
                Step::ExpectLinkRegistrations(count.parse().map_err(|_| at(anyhow!("count")))?)
            }
            ["window", "activate"] => Step::ActivateWindow,
            ["click-text", text, needle] => Step::ClickText {
                text: (*text).into(),
                needle: (*needle).into(),
            },
            ["drag-text", from_text, from_needle, to_text, to_needle] => Step::DragText {
                from: ((*from_text).into(), (*from_needle).into()),
                to: ((*to_text).into(), (*to_needle).into()),
            },
            [
                verb @ ("click-row" | "hover-row" | "right-click-row"),
                name,
                text,
                rest @ ..,
            ] if rest.len() <= 1 => Step::ClickRow {
                name: (*name).into(),
                text: (*text).into(),
                index: match rest {
                    [index] => Some(index.parse().map_err(|_| at(anyhow!("index")))?),
                    _ => None,
                },
                gesture: match *verb {
                    "hover-row" => RowGesture::Hover,
                    "right-click-row" => RowGesture::RightClick,
                    _ => RowGesture::Click,
                },
            },
            _ => Step::Shot(script::step(&words).map_err(|error| at(anyhow!(error)))?),
        };
        steps.push(step);
    }
    Ok(steps)
}

/// A POST to the fake server, over a bare socket: the rig needs nothing more than one request.
fn http(server: &str, method: &str, path: &str, body: &str) -> Result<Value> {
    http_with(server, method, path, body, None)
}

fn http_with(
    server: &str,
    method: &str,
    path: &str,
    body: &str,
    bearer: Option<&str>,
) -> Result<Value> {
    let auth = bearer.map_or_else(String::new, |token| {
        format!("Authorization: Bearer {token}\r\n")
    });
    let (status, body) = http_raw(server, method, path, &auth, body)?;
    if status != 200 {
        bail!("{method} {path}: {status} {body}");
    }
    serde_json::from_str(&body).with_context(|| format!("{path} answered {body}"))
}

/// One request with these extra header lines (each ending `\r\n`): the status and the body. The
/// body is read whole, so this is for small, unchunked JSON answers (Nest's and the fake's).
fn http_raw(
    server: &str,
    method: &str,
    path: &str,
    headers: &str,
    body: &str,
) -> Result<(u16, String)> {
    let address = server
        .strip_prefix("http://")
        .ok_or_else(|| anyhow!("the server URL must be http://"))?
        .trim_end_matches('/');
    let mut stream =
        TcpStream::connect(address).with_context(|| format!("connecting {address}"))?;
    stream.set_read_timeout(Some(Duration::from_secs(10)))?;
    let body = if body.is_empty() { "{}" } else { body };
    write!(
        stream,
        "{method} {path} HTTP/1.1\r\nHost: {address}\r\nContent-Type: application/json\r\n{headers}Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )?;
    let mut response = String::new();
    stream.read_to_string(&mut response)?;
    let (head, body) = response
        .split_once("\r\n\r\n")
        .ok_or_else(|| anyhow!("no HTTP response"))?;
    let status = head
        .split(' ')
        .nth(1)
        .and_then(|code| code.parse().ok())
        .ok_or_else(|| anyhow!("{method} {path}: no status in {head}"))?;
    Ok((status, body.to_owned()))
}

/// `exec`'s command, through `sh -c`, with its output on the rig's stderr.
fn exec(command: &str) -> Result<()> {
    let output = std::process::Command::new("sh")
        .args(["-c", command])
        .output()
        .with_context(|| format!("running {command}"))?;
    std::io::stderr().write_all(&output.stdout)?;
    std::io::stderr().write_all(&output.stderr)?;
    if output.status.success() {
        Ok(())
    } else {
        Err(anyhow!("`{command}` failed: {}", output.status))
    }
}

/// The newest `sentAt` in a scenario plus a second: where the fake server's clock starts, so rows
/// show the same day and time on every run.
fn scenario_now_ms(path: &Path) -> Result<i64> {
    let json: Value = serde_json::from_str(&std::fs::read_to_string(path)?)?;
    let mut newest = 0i64;
    for section in [
        "messagesByChannel",
        "messagesByDmGroup",
        "threadRepliesByParent",
    ] {
        for messages in json[section]
            .as_object()
            .into_iter()
            .flat_map(|map| map.values())
        {
            for message in messages.as_array().into_iter().flatten() {
                if let Some(sent) = message["sentAt"].as_str() {
                    let ms = parse_rfc3339_ms(sent).with_context(|| sent.to_owned())?;
                    newest = newest.max(ms);
                }
            }
        }
    }
    Ok(newest + 1000)
}

/// `2026-09-22T18:00:00.000Z` to Unix milliseconds, without a date crate.
fn parse_rfc3339_ms(text: &str) -> Result<i64> {
    let digits = |range: std::ops::Range<usize>| -> Result<i64> {
        text.get(range)
            .and_then(|part| part.parse().ok())
            .ok_or_else(|| anyhow!("not RFC 3339"))
    };
    let (year, month, day) = (digits(0..4)?, digits(5..7)?, digits(8..10)?);
    let (hour, minute, second) = (digits(11..13)?, digits(14..16)?, digits(17..19)?);
    let millis = if text.as_bytes().get(19) == Some(&b'.') {
        digits(20..23)?
    } else {
        0
    };
    // Days from the civil date, after Howard Hinnant's algorithm.
    let (y, m) = if month <= 2 {
        (year - 1, month + 9)
    } else {
        (year, month - 3)
    };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * m + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    Ok(((days * 24 + hour) * 60 + minute) * 60_000 + second * 1000 + millis)
}

struct Rig {
    driver: Driver,
    server: String,
    now_ms: i64,
    app: Option<Entity<AppRoot>>,
    /// The keyring and the data directory, kept across a restart.
    secrets: Arc<MemorySecrets>,
    /// LiveKit's server API, for steps that act on a room as a moderator would.
    livekit: Option<LiveKit>,
    heartbeat: Duration,
    link_images: bool,
    data_dir: PathBuf,
    size: (f32, f32),
    /// Cameras and screens: no real ones in a container, and these can be made to fail.
    video: Arc<FakeVideoSources>,
    /// Our picker's list: two screens and a window.
    screens: Arc<RigScreens>,
    /// The refresh token `remember stored-session` noted.
    remembered: Option<String>,
    /// What the app raised and took down, instead of the desktop's notifications.
    notifier: Arc<RigNotifier>,
    /// Samples the virtual speaker played that weren't silence, since `forget sounds`.
    heard: Arc<std::sync::atomic::AtomicUsize>,
    /// The URLs the app asked the browser to open, instead of a browser.
    opened: Rc<RefCell<Vec<String>>>,
    /// What the next file pickers answer, instead of the system's.
    picks: Rc<RefCell<VecDeque<PathBuf>>>,
    /// Where the next save dialogs answer (`save-as NAME`), instead of the system's; none queued
    /// is a cancel.
    saves: Rc<RefCell<VecDeque<PathBuf>>>,
    /// Who opens semaphore:// links, instead of the OS.
    links: Arc<RigLinks>,
    /// What `tick` and `clock hold|run` did to the scenario clock, kept across restarts; and
    /// the real time the current app's clock started at, for holds.
    clock_moves: Arc<ClockMoves>,
    clock_started: Instant,
    /// What the app asked of the system's sleep inhibitor, instead of the system.
    keep_awake: Arc<RigKeepAwake>,
    /// `mic tone on`: the virtual mic plays a tone instead of silence.
    tone: Arc<std::sync::atomic::AtomicBool>,
}

/// The link handler in the rig: not registered until asked, then registered. Touches nothing.
#[derive(Default)]
struct RigLinks {
    registered: std::sync::atomic::AtomicUsize,
}

impl semaphore_app::desktop::LinkRegistrar for RigLinks {
    fn status(&self) -> semaphore_ui::settings::LinkHandler {
        if self.registered.load(std::sync::atomic::Ordering::Relaxed) > 0 {
            semaphore_ui::settings::LinkHandler::Registered
        } else {
            semaphore_ui::settings::LinkHandler::NotRegistered
        }
    }

    fn register(&self) -> Result<semaphore_ui::settings::LinkHandler, String> {
        self.registered
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        Ok(self.status())
    }

    fn blocked(&self) -> Option<String> {
        None
    }

    fn note(&self) -> Option<String> {
        Some("This is a development build: registering takes semaphore:// links away from an installed Semaphore app until it registers again.".into())
    }
}

/// `challenge`, `state` and `port` from a `/#/desktop-login?…` URL.
fn desktop_login_params(url: &str) -> Result<(String, String, u16)> {
    let query = url
        .split_once("desktop-login?")
        .map(|(_, query)| query)
        .ok_or_else(|| anyhow!("not a desktop-login URL: {url}"))?;
    let field = |name: &str| {
        query
            .split('&')
            .find_map(|pair| pair.strip_prefix(&format!("{name}=")))
            .map(str::to_owned)
            .ok_or_else(|| anyhow!("{url} has no {name}"))
    };
    let port = field("port")?
        .parse()
        .map_err(|_| anyhow!("a bad port in {url}"))?;
    Ok((field("challenge")?, field("state")?, port))
}

/// The app's `Notifier` in the rig: records, shows nothing.
#[derive(Default)]
struct RigNotifier {
    /// Tags in the order shown, and whether each is still up.
    shown: Mutex<Vec<(String, bool)>>,
}

impl Notifier for RigNotifier {
    fn notify(&self, title: String, _body: String) -> Result<(), CoreError> {
        self.shown
            .lock()
            .unwrap()
            .push((format!("plain:{title}"), true));
        Ok(())
    }

    fn show(&self, notification: OsNotification) -> Result<(), CoreError> {
        let mut shown = self.shown.lock().unwrap();
        // A newer one for the tag replaces the older, as the desktop's do.
        for (tag, up) in shown.iter_mut() {
            if *tag == notification.tag {
                *up = false;
            }
        }
        shown.push((notification.tag, true));
        Ok(())
    }

    fn withdraw(&self, tag: &str) {
        for (shown, up) in self.shown.lock().unwrap().iter_mut() {
            if shown == tag {
                *up = false;
            }
        }
    }
}

impl RigNotifier {
    fn is_up(&self, tag: &str) -> bool {
        self.shown
            .lock()
            .unwrap()
            .iter()
            .any(|(shown, up)| shown == tag && *up)
    }

    fn was_shown(&self, tag: &str) -> bool {
        self.shown
            .lock()
            .unwrap()
            .iter()
            .any(|(shown, _)| shown == tag)
    }

    fn count(&self) -> usize {
        self.shown.lock().unwrap().len()
    }
}

impl Rig {
    fn new(
        server: String,
        now_ms: i64,
        data_dir: PathBuf,
        livekit: Option<LiveKit>,
        heartbeat: Duration,
    ) -> Self {
        let mut driver = Driver::new(Arc::new(semaphore_app::files::AppAssets));
        driver.cx.update(|cx| {
            semaphore_app::init(cx);
            set_reduced_motion(true, cx);
        });
        // Core's work arrives from Tokio threads, so the scheduler may wait for it.
        driver.cx.allow_parking();
        Self {
            driver,
            server,
            now_ms,
            app: None,
            secrets: Arc::default(),
            livekit,
            heartbeat,
            link_images: false,
            data_dir,
            size: (1280., 800.),
            video: Arc::default(),
            screens: Arc::new(RigScreens),
            remembered: None,
            notifier: Arc::default(),
            heard: Arc::default(),
            opened: Rc::default(),
            picks: Rc::default(),
            saves: Rc::default(),
            links: Arc::default(),
            clock_moves: Arc::default(),
            clock_started: Instant::now(),
            keep_awake: Arc::default(),
            tone: Arc::default(),
        }
    }

    /// The stored refresh token, if there is one. Never printed.
    fn stored_token(&self) -> Option<String> {
        self.secrets
            .0
            .lock()
            .unwrap()
            .iter()
            .find(|(key, _)| key.starts_with("refresh-token:"))
            .map(|(_, token)| token.clone())
    }

    fn replay_old_refresh(&self) -> Result<()> {
        let old = self
            .remembered
            .as_deref()
            .ok_or_else(|| anyhow!("remember stored-session first"))?;
        let device = self
            .secrets
            .0
            .lock()
            .unwrap()
            .get("device-id")
            .cloned()
            .ok_or_else(|| anyhow!("the app stored no device id"))?;
        let headers = format!(
            "X-Client-Type: desktop-native\r\nX-Device-Id: {device}\r\nUser-Agent: Semaphore-Native/rig\r\n"
        );
        let body = serde_json::json!({ "refreshToken": old }).to_string();
        let (status, answer) =
            http_raw(&self.server, "POST", "/api/auth/refresh", &headers, &body)?;
        if matches!(status, 401 | 403) {
            Ok(())
        } else {
            // The answer may hold new tokens: only its status and error fields are shown.
            let answer: Value = serde_json::from_str(&answer).unwrap_or(Value::Null);
            Err(anyhow!(
                "POST /api/auth/refresh with the rotated-out token (X-Client-Type: desktop-native, \
                 X-Device-Id: {device}) answered {status}, not 401/403: errorCode {}, message {}",
                answer["errorCode"],
                answer["message"]
            ))
        }
    }

    fn stored_session(&self) -> bool {
        self.secrets
            .0
            .lock()
            .unwrap()
            .keys()
            .any(|key| key.starts_with("refresh-token:"))
    }

    /// What closing the window does, then a new start.
    fn restart(&mut self) -> Result<()> {
        let app = self.app()?.clone();
        self.driver
            .cx
            .update(|cx| app.update(cx, |app, _| app.shutdown()));
        if let Some(window) = self.driver.window.take() {
            self.driver
                .cx
                .update_window(window, |_, window, _| window.remove_window())
                .context("closing the window")?;
        }
        self.app = None;
        self.driver.cx.run_until_parked();
        let (width, height) = self.size;
        self.open(width, height)
    }

    fn open(&mut self, width: f32, height: f32) -> Result<()> {
        self.size = (width, height);
        let config = AppConfig {
            secrets: self.secrets.clone(),
            data_dir: self.data_dir.clone(),
            watch_os: false,
            // No sound card in a container, and a rig mustn't use the machine's.
            audio: Some(self.virtual_audio()),
            video_sources: Some(self.video.clone()),
            screen_capture: Some(self.screens.clone()),
            heartbeat: self.heartbeat,
            // On disk in the run's data directory, so a restart reads what the settings saved.
            settings: {
                let mut store = SettingsStore::load(&self.data_dir);
                if store.get().third_party_media != self.link_images {
                    let on = self.link_images;
                    store.update(|settings| settings.third_party_media = on)?;
                }
                store
            },
            clock: {
                // A (re)start counts real time from now, as before; the ticks stay.
                self.clock_started = Instant::now();
                self.clock_moves.restart();
                Arc::new(ScenarioClock {
                    start_ms: self.now_ms,
                    started: self.clock_started,
                    moves: self.clock_moves.clone(),
                })
            },
            server_url: Some(self.server.clone()),
            // The display clock too: every relative age (the notification centre, the DM list,
            // the panels) is measured from this same instant, so shots never depend on the wall
            // clock. Frozen, not counting: only `tick` and `clock hold|run` move core's clock.
            time: TimeFormat::fixed(self.now_ms),
            scrollbar: false,
            notifier: Some(self.notifier.clone()),
            open_url: Some({
                let opened = self.opened.clone();
                Rc::new(move |url: &str, _: &mut App| opened.borrow_mut().push(url.to_owned()))
            }),
            save_path: Some({
                let saves = self.saves.clone();
                Rc::new(move |_: &str, _: &mut App| Task::ready(saves.borrow_mut().pop_front()))
            }),
            pick_files: Some({
                let picks = self.picks.clone();
                Rc::new(move |_, _: &mut App| {
                    let picked = picks.borrow_mut().pop_front().map(|path| vec![path]);
                    Task::ready(picked)
                })
            }),
            links: Some(self.links.clone()),
            // Never the machine's sleep inhibitor: one that only remembers.
            keep_awake: Some(self.keep_awake.clone()),
        };
        let mut app = None;
        let (handle, _) = self.driver.cx.update(|cx| {
            gpui_kit::open_window(
                semaphore_app::window_options(WindowOptions {
                    window_bounds: Some(WindowBounds::Windowed(Bounds {
                        origin: Default::default(),
                        size: size(px(width), px(height)),
                    })),
                    focus: false,
                    show: false,
                    ..Default::default()
                }),
                cx,
                |window, cx| {
                    let (root, built) = semaphore_app::build_root(config, window, cx);
                    app = Some(built);
                    root
                },
            )
        })?;
        self.driver.window = Some(handle);
        self.app = app;
        self.driver.settle()
    }

    /// The virtual devices, with a speaker that counts what isn't silence.
    fn virtual_audio(&self) -> Arc<VirtualIo> {
        let io = Arc::new(VirtualIo::new());
        let heard = self.heard.clone();
        io.set_speaker(Box::new(move |frame: &[i16]| {
            let loud = frame.iter().filter(|&&sample| sample != 0).count();
            heard.fetch_add(loud, std::sync::atomic::Ordering::Relaxed);
        }));
        // `mic tone on`: 440 Hz at a third of full scale, for the mic test and voice activity.
        let tone = self.tone.clone();
        let mut phase = 0f32;
        io.set_mic(Box::new(move |frame: &mut [i16]| {
            let on = tone.load(std::sync::atomic::Ordering::Relaxed);
            for sample in frame.iter_mut() {
                *sample = if on {
                    (phase.sin() * 10_000.) as i16
                } else {
                    0
                };
                phase = (phase + std::f32::consts::TAU * 440. / 48_000.) % std::f32::consts::TAU;
            }
        }));
        io
    }

    /// The inline player of the newest file with this name, in any of the window's lists.
    fn player_named(
        app: &Entity<AppRoot>,
        name: &str,
        cx: &gpui_kit::App,
    ) -> Result<Option<semaphore_ui::player::AttachmentPlayer>> {
        let root = app.read(cx);
        let Some(players) = root.players() else {
            bail!("this app has no players: build rig-slice with --features player");
        };
        Ok(players
            .all()
            .into_iter()
            .rev()
            .find(|player| player.filename(cx) == name))
    }

    /// W4's conditions.
    fn w4_holds(&mut self, condition: &W4) -> Result<bool> {
        use semaphore_core::model::ReplayState;
        if let W4::Dialog(name, open) = condition {
            let id = ElementId::Name(dialog_element(name)?.into());
            let found = self.driver.query(|window| window.try_find(id).is_some())?;
            return Ok(found == *open);
        }
        if let W4::LiveKitTrack {
            room,
            identity,
            name,
        } = condition
        {
            return self.livekit_has_track(room, identity, name);
        }
        if let W4::Saved(name) = condition {
            let path = self.data_dir.join("saved").join(name);
            return Ok(std::fs::metadata(path).is_ok_and(|meta| meta.len() > 0));
        }
        if let W4::KeepAwake(on) = condition {
            return Ok(self
                .keep_awake
                .on
                .load(std::sync::atomic::Ordering::Relaxed)
                == *on);
        }
        if let W4::Float(shown) = condition {
            let found = self.driver.query(|window| {
                window
                    .try_find(ElementId::Name("float-card".into()))
                    .is_some()
                    || window
                        .try_find(ElementId::Name("float-pill".into()))
                        .is_some()
            })?;
            return Ok(found == *shown);
        }
        let app = self.app()?.clone();
        self.driver.cx.update(|cx| {
            let root = app.read(cx);
            let Some(core) = root.core() else {
                return Ok(false);
            };
            Ok(match condition {
                W4::Ringing(yes) => core.incoming_call().is_some() == *yes,
                W4::RingingFor(dm) => core
                    .incoming_call()
                    .is_some_and(|call| call.dm_group_id == *dm),
                W4::RingSound(looping) => root.ringing() == *looping,
                W4::Cue(name, count) => root.cue_played(cue_named(name)?) >= *count,
                W4::Room(kind, id) => {
                    use semaphore_core::model::VoiceRoom;
                    match (kind.as_str(), core.voice().room) {
                        ("none", None) => true,
                        ("dm", Some(VoiceRoom::Dm { dm_group_id })) => Some(dm_group_id) == *id,
                        ("channel", Some(VoiceRoom::Channel { channel_id, .. })) => {
                            Some(channel_id) == *id
                        }
                        _ => false,
                    }
                }
                W4::ServerMuted(yes) => core.voice().server_muted == *yes,
                W4::MicTest(running) => root.mic_test_level().is_some() == *running,
                W4::MicLevelHeard => root.mic_test_level().is_some_and(|level| level > 0.),
                W4::EngineVad(threshold) => root.app_voice().is_some_and(|voice| {
                    voice.vad_applied.load(std::sync::atomic::Ordering::Relaxed) == *threshold
                }),
                W4::SoundboardPlaying(id) => core.voice().local.soundboard == *id,
                W4::Replay(state) => {
                    let now = core.voice().replay;
                    match state.as_str() {
                        "off" => now == ReplayState::Off,
                        "starting" => now == ReplayState::Starting,
                        "recording" => matches!(now, ReplayState::Recording { .. }),
                        "failed" => matches!(now, ReplayState::Failed { .. }),
                        _ => bail!("unknown replay state {state}"),
                    }
                }
                W4::Clips(count) => {
                    let Some(shell) = root.shell() else {
                        return Ok(false);
                    };
                    let semaphore_ui::nav::Route::Profile { user_id } =
                        shell.read(cx).nav().current().clone()
                    else {
                        return Ok(false);
                    };
                    let mine =
                        matches!(core.session(), SessionState::SignedIn { me } if me.id == user_id);
                    let view = if mine {
                        core.clips()
                    } else {
                        core.user_clips(user_id)
                    };
                    view.clips.len() == *count
                }
                W4::Dialog(..)
                | W4::LiveKitTrack { .. }
                | W4::KeepAwake(_)
                | W4::Float(_)
                | W4::Saved(_) => {
                    unreachable!("answered above")
                }
            })
        })
    }

    /// W3-player-wire's step: play or pause, as the player's main button does.
    fn player_toggle(&mut self, name: &str) -> Result<()> {
        self.driver.settle()?;
        let app = self.app()?.clone();
        let player = self
            .driver
            .cx
            .update(|cx| Self::player_named(&app, name, cx))?
            .ok_or_else(|| anyhow!("no player for {name:?} is drawn"))?;
        self.driver.cx.update(|cx| player.toggle(cx));
        self.driver.settle()
    }

    /// W3-player-wire's conditions.
    fn player_holds(&mut self, condition: &Condition) -> Result<Option<bool>> {
        use semaphore_ui::player::Phase;
        if !matches!(
            condition,
            Condition::Player(..) | Condition::PlayerFrames(_) | Condition::PlayersOpen(_)
        ) {
            return Ok(None);
        }
        let app = self.app()?.clone();
        self.driver.cx.update(|cx| {
            Ok(Some(match condition {
                Condition::PlayersOpen(count) => app
                    .read(cx)
                    .players()
                    .is_some_and(|players| players.open_count(cx) == *count),
                Condition::PlayerFrames(name) => {
                    Self::player_named(&app, name, cx)?.is_some_and(|player| player.has_frame(cx))
                }
                Condition::Player(name, phase) => {
                    let Some(player) = Self::player_named(&app, name, cx)? else {
                        return Ok(Some(false));
                    };
                    let now = player.phase(cx);
                    match phase.as_str() {
                        "idle" => now == Phase::Idle,
                        "loading" => now == Phase::Loading,
                        "playing" => now == Phase::Playing,
                        "paused" => now == Phase::Paused,
                        "buffering" => now == Phase::Buffering,
                        "ended" => now == Phase::Ended,
                        "failed" => matches!(now, Phase::Failed(_)),
                        _ => bail!("unknown player phase {phase}"),
                    }
                }
                _ => unreachable!("matched above"),
            }))
        })
    }

    /// W2's conditions.
    fn w2_holds(&mut self, condition: &Condition) -> Result<Option<bool>> {
        let app = self.app()?.clone();
        let notifier = self.notifier.clone();
        let heard = self.heard.load(std::sync::atomic::Ordering::Relaxed);
        Ok(self.driver.cx.update(|cx| {
            let root = app.read(cx);
            let core = root.core();
            Some(match condition {
                Condition::Dm(id) => root
                    .pane()
                    .is_some_and(|pane| semaphore_app::root::inbox::pane_on_dm(pane.read(cx), id)),
                Condition::Notified(tag) => notifier.is_up(tag),
                Condition::Withdrawn(tag) => notifier.was_shown(tag) && !notifier.is_up(tag),
                Condition::NotificationsShown(count) => notifier.count() == *count,
                Condition::Centre(open) => root.centre_open() == *open,
                Condition::Sound(yes) => (heard > 0) == *yes,
                Condition::Badge(count) => core.is_some_and(|core| core.badge_count() == *count),
                Condition::Incoming(count) => {
                    core.is_some_and(|core| core.friends().incoming.len() == *count)
                }
                Condition::Friend(id) => core.is_some_and(|core| {
                    core.friends()
                        .friends
                        .iter()
                        .any(|friend| friend.user.id == *id)
                }),
                Condition::Dms(count) => {
                    core.is_some_and(|core| core.dm_list().rows.len() == *count)
                }
                _ => return None,
            })
        }))
    }

    fn app(&self) -> Result<&Entity<AppRoot>> {
        self.app
            .as_ref()
            .ok_or_else(|| anyhow!("no app is open: `app W H` first"))
    }

    fn rows(&mut self) -> Result<(Vec<MessageRow>, Option<Conversation>, bool)> {
        let app = self.app()?.clone();
        Ok(self.driver.cx.update(|cx| {
            let Some(pane) = app.read(cx).pane() else {
                return (Vec::new(), None, false);
            };
            let pane = pane.read(cx);
            let detached = pane.list().is_some_and(|list| list.read(cx).is_detached());
            (pane.rows().to_vec(), pane.conversation().cloned(), detached)
        }))
    }

    fn holds(&mut self, condition: &Condition) -> Result<bool> {
        if let Condition::Label(label) = condition {
            return self.driver.has_label(label);
        }
        if let Some(answer) = self.player_holds(condition)? {
            return Ok(answer);
        }
        if let Some(answer) = self.voice_holds(condition)? {
            return Ok(answer);
        }
        if let Condition::Requests(name, count) = condition {
            return Ok(self.requests(name)? >= *count);
        }
        if let Condition::RequestsExactly(name, count) = condition {
            return Ok(self.requests(name)? == *count);
        }
        if let Condition::FileReady(file_id) = condition {
            let path = format!("{}file/{file_id}", semaphore_app::files::ASSET_PREFIX);
            return Ok(
                semaphore_app::files::store().have(&path) == semaphore_app::files::Have::Ready
            );
        }
        if let Condition::Viewer(open) = condition {
            let app = self.app()?.clone();
            let showing = self.driver.cx.update(|cx| app.read(cx).viewer_open());
            return Ok(showing == *open);
        }
        if let Condition::Element(id, drawn) = condition {
            let id = ElementId::Name(id.clone().into());
            let found = self.driver.query(|window| window.try_find(id).is_some())?;
            return Ok(found == *drawn);
        }
        if let Some(answer) = self.w1_holds(condition)? {
            return Ok(answer);
        }
        if let Some(answer) = self.w2_holds(condition)? {
            return Ok(answer);
        }
        if let Some(answer) = self.w3_holds(condition)? {
            return Ok(answer);
        }
        if let Condition::W4(w4) = condition {
            return self.w4_holds(w4);
        }
        if let Condition::W5(w5) = condition {
            return self.w5_holds(w5);
        }
        match condition {
            Condition::W6(w6) => return self.w6_holds(w6),
            Condition::W7(w7) => return self.w7_holds(w7),
            Condition::W7T(thumbs) => return self.w7t_holds(thumbs),
            Condition::W9(w9) => return self.w9_holds(w9),
            Condition::W9v(w9v) => return self.w9v_holds(w9v),
            _ => {}
        }
        let app = self.app()?.clone();
        let core = self.driver.cx.update(|cx| app.read(cx).core());
        let Some(core) = core else {
            return Ok(false);
        };
        let (rows, conversation, detached) = self.rows()?;
        fn newest<'a>(rows: &'a [MessageRow], text: &str) -> Option<&'a MessageRow> {
            rows.iter().rev().find(|row| row.display.contains(text))
        }
        fn matching<'a>(
            rows: &'a [MessageRow],
            text: &'a str,
        ) -> impl Iterator<Item = &'a MessageRow> {
            rows.iter().filter(move |row| row.display.contains(text))
        }
        Ok(match condition {
            Condition::Session(state) => match (state.as_str(), core.session()) {
                ("signed-in", SessionState::SignedIn { .. })
                | ("signed-out", SessionState::SignedOut)
                | ("failed", SessionState::SignInFailed { .. }) => true,
                ("signed-in" | "signed-out" | "failed", _) => false,
                (other, _) => bail!("unknown session state {other}"),
            },
            Condition::Connection(state) => {
                let wanted = match state.as_str() {
                    "connected" => ConnectionState::Connected,
                    "disconnected" => ConnectionState::Disconnected,
                    "offline" => ConnectionState::Offline,
                    "suspended" => ConnectionState::Suspended,
                    other => bail!("unknown connection state {other}"),
                };
                core.connection() == wanted
            }
            Condition::Rows(count) => rows.len() >= *count,
            Condition::Text(text) => matching(&rows, text).next().is_some(),
            Condition::NoText(text) => matching(&rows, text).next().is_none(),
            Condition::Sent(text) => matching(&rows, text)
                .any(|row| row.id.is_some() && row.send_state == SendState::Sent),
            Condition::Pending(text) => {
                matching(&rows, text).any(|row| row.send_state == SendState::Pending)
            }
            Condition::Failed(text) => {
                matching(&rows, text).any(|row| matches!(row.send_state, SendState::Failed { .. }))
            }
            Condition::Count(text, count) => matching(&rows, text).count() == *count,
            Condition::Channel(id) => {
                conversation == Some(Conversation::Channel { id: id.clone() })
            }
            Condition::Detached => detached,
            Condition::Live => !detached,
            Condition::Label(_)
            | Condition::Voice(_)
            | Condition::VoiceFrames
            | Condition::VoiceMuted(_)
            | Condition::VoiceDeafened(_)
            | Condition::VoiceParticipant(_)
            | Condition::VoiceLocal { .. }
            | Condition::VoiceOwnFrames(_)
            | Condition::Requests(..)
            | Condition::RequestsExactly(..)
            | Condition::FileReady(_)
            | Condition::Viewer(_)
            | Condition::SidePanel(_)
            | Condition::Editing(_)
            | Condition::Picker(_)
            | Condition::Pinned(..)
            | Condition::Edited(_)
            | Condition::Removed(_)
            | Condition::Reaction(..)
            | Condition::ThreadRows(_)
            | Condition::ThreadSent(_)
            | Condition::Subscribed(_)
            | Condition::UnreadAfter(_)
            | Condition::Notice(_)
            | Condition::NoNotice
            | Condition::PinnedCount(_)
            | Condition::ComposerText(_)
            | Condition::ComposerPlaceholder(_)
            | Condition::SearchHits(_)
            | Condition::Dm(_)
            | Condition::Notified(_)
            | Condition::Withdrawn(_)
            | Condition::NotificationsShown(_)
            | Condition::Badge(_)
            | Condition::Centre(_)
            | Condition::Sound(_)
            | Condition::Incoming(_)
            | Condition::Friend(_)
            | Condition::Dms(_)
            | Condition::Element(..)
            | Condition::Route(_)
            | Condition::Theme(_)
            | Condition::Engine(..)
            | Condition::ProfileOpen(_)
            | Condition::DesktopSignIn(_)
            | Condition::Player(..)
            | Condition::PlayerFrames(_)
            | Condition::PlayersOpen(_)
            | Condition::W4(_)
            | Condition::W5(_)
            | Condition::W6(_)
            | Condition::W7(_)
            | Condition::W7T(_)
            | Condition::W9(_)
            | Condition::W9v(_) => unreachable!("answered above"),
            Condition::Attachments(text, count) => {
                newest(&rows, text).is_some_and(|row| row.attachments.len() == *count)
            }
            Condition::Uploads(text, count) => {
                newest(&rows, text).is_some_and(|row| row.uploads.len() == *count)
            }
            Condition::PendingFiles(text, count) => {
                newest(&rows, text).is_some_and(|row| row.pending_attachments as usize == *count)
            }
            Condition::UploadFailed(text) => newest(&rows, text)
                .is_some_and(|row| row.uploads.iter().any(|upload| upload.failed.is_some())),
        })
    }

    fn wait(&mut self, condition: &Condition, within: Duration) -> Result<()> {
        let activity = {
            let app = self.app()?.clone();
            self.driver.cx.update(|cx| app.read(cx).activity())
        };
        let deadline = Instant::now() + within;
        loop {
            let seen = activity.current();
            self.driver.settle()?;
            if self.holds(condition)? {
                return Ok(());
            }
            let now = Instant::now();
            if now >= deadline {
                let (rows, conversation, _) = self.rows()?;
                let tail: Vec<String> = rows
                    .iter()
                    .rev()
                    .take(5)
                    .map(|row| {
                        format!(
                            "{:?} {:?} (attachments {}, uploads {}, pending {})",
                            row.send_state,
                            row.display,
                            row.attachments.len(),
                            row.uploads.len(),
                            row.pending_attachments
                        )
                    })
                    .collect();
                bail!(
                    "still waiting after {within:?} for {condition:?} (on {conversation:?}, last rows {tail:?})"
                );
            }
            activity.wait_past(seen, LOOK_EVERY.min(deadline - now));
        }
    }

    /// W1's conditions: the pane's side panel, editor, picker, thread and divider, and its rows.
    fn w1_holds(&mut self, condition: &Condition) -> Result<Option<bool>> {
        let app = self.app()?.clone();
        Ok(self.driver.cx.update(|cx| {
            let root = app.read(cx);
            let core = root.core();
            // Signed out there's no pane (it's built per session): the conditions on it are
            // false, the rest are someone else's to answer.
            let Some(pane) = root.pane() else {
                return w1_condition(condition).then_some(false);
            };
            let pane = pane.read(cx);
            let newest = |text: &str| {
                pane.rows()
                    .iter()
                    .rev()
                    .find(|row| row.display.contains(text))
                    .cloned()
            };
            Some(match condition {
                Condition::SidePanel(kind) => pane.side_panel_kind() == kind,
                Condition::Editing(yes) => pane.editing_message().is_some() == *yes,
                Condition::Picker(open) => pane.picker_open() == *open,
                Condition::Pinned(text, pinned) => {
                    newest(text).is_some_and(|row| row.pinned == *pinned)
                }
                Condition::Edited(text) => {
                    newest(text).is_some_and(|row| row.edited && !row.edit_pending)
                }
                Condition::Removed(text) => newest(text).is_some_and(|row| row.removed),
                Condition::Reaction(text, emoji, count) => newest(text).is_some_and(|row| {
                    row.reactions
                        .iter()
                        .any(|r| r.emoji == *emoji && r.count == *count && r.me)
                }),
                Condition::ThreadRows(count) => pane.thread_rows().len() >= *count,
                Condition::ThreadSent(text) => pane.thread_rows().iter().any(|row| {
                    row.display.contains(text.as_str())
                        && row.id.is_some()
                        && row.send_state == SendState::Sent
                }),
                Condition::Subscribed(yes) => match (pane.thread_parent(), &core) {
                    (Some(parent), Some(core)) => {
                        let info = core.thread_info(parent.to_owned());
                        info.state == semaphore_core::model::LoadState::Ready
                            && info.subscribed == *yes
                    }
                    _ => false,
                },
                Condition::UnreadAfter(text) => {
                    let divider = pane.list().and_then(|list| list.read(cx).unread_divider());
                    match (divider, newest(text)) {
                        (Some(divider), Some(row)) => divider.after_seq == row.seq,
                        _ => false,
                    }
                }
                Condition::Notice(text) => pane.notice().is_some_and(|n| n.contains(text.as_str())),
                Condition::NoNotice => pane.notice().is_none(),
                Condition::ComposerText(text) => pane
                    .composer()
                    .is_some_and(|composer| composer.read(cx).value(cx).contains(text.as_str())),
                Condition::ComposerPlaceholder(text) => pane
                    .composer()
                    .is_some_and(|composer| composer.read(cx).placeholder() == text.as_str()),
                Condition::SearchHits(count) => pane
                    .search_panel()
                    .is_some_and(|panel| panel.read(cx).hits().len() >= *count),
                Condition::PinnedCount(count) => root
                    .shell()
                    .is_some_and(|shell| shell.read(cx).pinned_count == *count),
                _ => return None,
            })
        }))
    }

    /// Plays the browser for the last desktop-login URL the app opened: the signed-in user approves
    /// in the browser (the fake server's `approve_desktop`), and the browser follows the redirect to
    /// the app's loopback listener with the code and the state.
    fn browser_approve(&mut self) -> Result<()> {
        let url = self
            .opened
            .borrow()
            .iter()
            .rev()
            .find(|url| url.contains("desktop-login"))
            .cloned()
            .ok_or_else(|| anyhow!("the app opened no desktop-login URL"))?;
        let (challenge, state, port) = desktop_login_params(&url)?;
        let approved = http(
            &self.server,
            "POST",
            "/__control/approve_desktop",
            &serde_json::json!({ "challenge": challenge }).to_string(),
        )?;
        let code = approved["code"]
            .as_str()
            .ok_or_else(|| anyhow!("approve_desktop gave no code: {approved}"))?;
        let mut stream = TcpStream::connect(("127.0.0.1", port))
            .with_context(|| format!("the app's loopback listener on {port}"))?;
        stream.set_read_timeout(Some(Duration::from_secs(10)))?;
        write!(
            stream,
            "GET /callback?code={code}&state={state} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"
        )?;
        let mut answer = String::new();
        stream.read_to_string(&mut answer)?;
        if !answer.starts_with("HTTP/1.1 200") {
            bail!(
                "the loopback listener answered {}",
                answer.lines().next().unwrap_or("")
            );
        }
        self.driver.settle()
    }

    /// W3's conditions.
    fn w3_holds(&mut self, condition: &Condition) -> Result<Option<bool>> {
        let app = self.app()?.clone();
        Ok(self.driver.cx.update(|cx| {
            let root = app.read(cx);
            Some(match condition {
                Condition::Route(prefix) => root.shell().is_some_and(|shell| {
                    route_name(shell.read(cx).nav().current()).starts_with(prefix.as_str())
                }),
                Condition::Theme(name) => cx
                    .try_global::<semaphore_ui::theme::Sem>()
                    .is_some_and(|sem| sem.choice.name() == *name),
                Condition::Engine(key, value) => {
                    let Some(voice) = root.app_voice() else {
                        return Some(false);
                    };
                    let choices = voice.engine.choices();
                    let device = |device: &Option<String>| {
                        device.clone().unwrap_or_else(|| "default".to_owned()) == *value
                    };
                    match key.as_str() {
                        "ptt" => choices.ptt_mode == (value == "on"),
                        "preset" => format!("{:?}", choices.preset).to_lowercase() == *value,
                        "input" => device(&choices.input_device),
                        "output" => device(&choices.output_device),
                        _ => device(&choices.camera_device),
                    }
                }
                Condition::ProfileOpen(id) => root.profile_open(cx).as_deref() == Some(id.as_str()),
                Condition::DesktopSignIn(shown) => root.desktop_sign_in().is_some() == *shown,
                _ => return None,
            })
        }))
    }
}

/// A route as `route` conditions name it.
fn route_name(route: &semaphore_ui::nav::Route) -> String {
    use semaphore_ui::nav::Route;
    match route {
        Route::Home => "home".into(),
        Route::Settings { tab } => format!("settings/{}", tab.key()),
        Route::Profile { user_id } => format!("profile/{user_id}"),
        Route::ProfileEdit => "profile-edit".into(),
        Route::CommunitySettings { community_id, tab } => {
            format!("community-settings/{community_id}/{}", tab.key())
        }
        Route::Community { community_id } => format!("community/{community_id}"),
        Route::Channel { channel_id, .. } => format!("channel/{channel_id}"),
        Route::DirectMessages => "dms".into(),
        Route::DirectMessage { dm_group_id } => format!("dm/{dm_group_id}"),
        other => other.path(),
    }
}

/// The conditions `w1_holds` reads off the pane.
fn w1_condition(condition: &Condition) -> bool {
    matches!(
        condition,
        Condition::SidePanel(_)
            | Condition::Editing(_)
            | Condition::Picker(_)
            | Condition::Pinned(..)
            | Condition::Edited(_)
            | Condition::Removed(_)
            | Condition::Reaction(..)
            | Condition::ThreadRows(_)
            | Condition::ThreadSent(_)
            | Condition::Subscribed(_)
            | Condition::UnreadAfter(_)
            | Condition::Notice(_)
            | Condition::NoNotice
            | Condition::ComposerText(_)
            | Condition::ComposerPlaceholder(_)
            | Condition::SearchHits(_)
            | Condition::PinnedCount(_)
    )
}

impl Rig {
    fn revoke_other_sessions(&mut self) -> Result<()> {
        let app = self.app()?.clone();
        let core = self
            .driver
            .cx
            .update(|cx| app.read(cx).core())
            .ok_or_else(|| anyhow!("no core: not signed in"))?;
        // On a runtime of its own, so the rig's thread can wait for it while the app's runs on.
        let revoked = std::thread::spawn(move || {
            tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .map_err(|error| anyhow!("a runtime for the command: {error}"))?
                .block_on(core.revoke_other_sessions())
                .map_err(|error| anyhow!("revoke_other_sessions failed: {error}"))
        })
        .join()
        .map_err(|_| anyhow!("revoke_other_sessions panicked"))??;
        eprintln!("rig-slice: revoke_other_sessions ended {revoked} session(s)");
        self.driver.settle()
    }

    fn voice_holds(&mut self, condition: &Condition) -> Result<Option<bool>> {
        let app = self.app()?.clone();
        let answer = self.driver.cx.update(|cx| {
            let root = app.read(cx);
            let core = root.core()?;
            let voice = core.voice();
            Some(match condition {
                Condition::Voice(status) => {
                    let wanted = match status.as_str() {
                        "connected" => VoiceStatus::Connected,
                        "connecting" => VoiceStatus::Connecting,
                        "reconnecting" => VoiceStatus::Reconnecting,
                        "disconnected" => VoiceStatus::Disconnected,
                        _ => return Some(Err(anyhow!("unknown voice status {status}"))),
                    };
                    Ok(voice.status == wanted)
                }
                Condition::VoiceFrames => {
                    let stage = root.stage()?.read(cx);
                    Ok(voice.participants.iter().any(|participant| {
                        participant
                            .camera
                            .as_ref()
                            .is_some_and(|track| stage.frames().has_frame(&track.track_sid))
                    }))
                }
                Condition::VoiceMuted(muted) => Ok(voice.muted == *muted),
                Condition::VoiceDeafened(deafened) => Ok(voice.deafened == *deafened),
                Condition::VoiceParticipant(identity) => Ok(voice
                    .participants
                    .iter()
                    .any(|participant| &participant.identity == identity)),
                Condition::VoiceLocal { what, state } => {
                    let share = match what.as_str() {
                        "camera" => &voice.local.camera,
                        "screen" => &voice.local.screen,
                        _ => &voice.local.screen_audio,
                    };
                    Ok(match state.as_str() {
                        "off" => *share == LocalShare::Off,
                        "starting" => *share == LocalShare::Starting,
                        "on" => *share == LocalShare::On,
                        "failed" => matches!(share, LocalShare::Failed { .. }),
                        _ => return Some(Err(anyhow!("unknown share state {state}"))),
                    })
                }
                Condition::VoiceOwnFrames(what) => {
                    let stage = root.stage()?.read(cx);
                    Ok(voice.participants.iter().any(|participant| {
                        let track = if what == "camera" {
                            &participant.camera
                        } else {
                            &participant.screen_share
                        };
                        participant.is_self
                            && track
                                .as_ref()
                                .is_some_and(|track| stage.frames().has_frame(&track.track_sid))
                    }))
                }
                _ => return None,
            })
        });
        match answer {
            Some(result) => result.map(Some),
            None if matches!(
                condition,
                Condition::Voice(_)
                    | Condition::VoiceFrames
                    | Condition::VoiceMuted(_)
                    | Condition::VoiceDeafened(_)
                    | Condition::VoiceParticipant(_)
                    | Condition::VoiceLocal { .. }
                    | Condition::VoiceOwnFrames(_)
            ) =>
            {
                Ok(Some(false))
            }
            None => Ok(None),
        }
    }

    /// Before a screenshot: no file still on its way, so what's drawn doesn't depend on timing. A
    /// frame can ask for files the last one didn't, so draw until a still frame asks for nothing.
    fn quiet_files(&mut self, step: &script::Step) -> Result<()> {
        if !matches!(step, script::Step::Shot { .. }) {
            return Ok(());
        }
        for _ in 0..10 {
            self.files_arrived()?;
            self.driver.wait_idle()?;
            if semaphore_app::files::store().fetching() == 0 {
                return Ok(());
            }
        }
        bail!("drawing kept asking for more files")
    }

    fn files_arrived(&mut self) -> Result<()> {
        let deadline = Instant::now() + DEFAULT_WITHIN;
        let store = semaphore_app::files::store();
        loop {
            self.driver.settle()?;
            if store.fetching() == 0 {
                return Ok(());
            }
            if Instant::now() >= deadline {
                bail!("files were still loading after {DEFAULT_WITHIN:?}");
            }
            let activity = {
                let app = self.app()?.clone();
                self.driver.cx.update(|cx| app.read(cx).activity())
            };
            let seen = activity.current();
            activity.wait_past(seen, LOOK_EVERY);
        }
    }

    fn attach(&mut self, path: &Path) -> Result<()> {
        let app = self.app()?.clone();
        let file = semaphore_ui::composer::PendingAttachment::from_path(path);
        self.driver.update(|window, cx| {
            let composer = app
                .read(cx)
                .pane()
                .and_then(|pane| pane.read(cx).composer().cloned());
            if let Some(composer) = composer {
                composer.update(cx, |composer, cx| {
                    composer.add_attachments(vec![file], window, cx)
                });
            }
        })
    }

    fn snap(&mut self, out: &Path) -> Result<()> {
        self.driver.settle()?;
        let window = self
            .driver
            .window
            .ok_or_else(|| anyhow!("no window is open"))?;
        let image = self
            .driver
            .cx
            .capture_screenshot(window)
            .context("offscreen rendering is unavailable")?;
        image
            .save(out)
            .with_context(|| format!("writing {}", out.display()))?;
        println!("{} {}x{}", out.display(), image.width(), image.height());
        Ok(())
    }

    /// LiveKit's server API: does `identity` in `room` publish a track named `name`?
    fn livekit_has_track(&self, room: &str, identity: &str, name: &str) -> Result<bool> {
        let livekit = self
            .livekit
            .as_ref()
            .ok_or_else(|| anyhow!("--livekit-http is needed for livekit conditions"))?;
        let token = livekit.admin_token(room);
        let body = serde_json::json!({ "room": room }).to_string();
        let listed = http_with(
            &livekit.url,
            "POST",
            "/twirp/livekit.RoomService/ListParticipants",
            &body,
            Some(&token),
        )?;
        Ok(listed["participants"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|participant| participant["identity"] == identity)
            .flat_map(|participant| participant["tracks"].as_array().into_iter().flatten())
            .any(|track| track["name"] == name))
    }

    fn livekit_remove(&self, room: &str, identity: &str) -> Result<()> {
        let livekit = self
            .livekit
            .as_ref()
            .ok_or_else(|| anyhow!("--livekit-http is needed for livekit steps"))?;
        let token = livekit.admin_token(room);
        let body = serde_json::json!({ "room": room, "identity": identity }).to_string();
        http_with(
            &livekit.url,
            "POST",
            "/twirp/livekit.RoomService/RemoveParticipant",
            &body,
            Some(&token),
        )
        .map(|_| ())
    }

    fn click_row(
        &mut self,
        name: &str,
        text: &str,
        index: Option<u64>,
        gesture: RowGesture,
    ) -> Result<()> {
        self.driver.settle()?;
        let (rows, _, _) = self.rows()?;
        let seq = rows
            .iter()
            .rev()
            .find(|row| row.display.contains(text))
            .map(|row| row.seq)
            .ok_or_else(|| anyhow!("no row contains {text:?}"))?;
        let id = ElementId::NamedInteger(
            name.to_owned().into(),
            match index {
                Some(index) => (seq as u64) << 8 | index,
                None => seq as u64,
            },
        );
        self.driver.update(|window, cx| match gesture {
            RowGesture::Click => window.click(id, cx),
            RowGesture::Hover => window.hover(id, cx),
            RowGesture::RightClick => window.right_click(id, cx),
        })
    }

    fn click_text(&mut self, text: &str, needle: &str) -> Result<()> {
        self.driver.settle()?;
        // A few glyphs in, so the point is on the needle and not its edge.
        let at = self.text_point(text, needle, |byte, len| byte + len.min(3))?;
        self.driver.update(|window, cx| window.drag(at, at, cx))
    }

    fn drag_text(&mut self, from: &(String, String), to: &(String, String)) -> Result<()> {
        self.driver.settle()?;
        let start = self.text_point(&from.0, &from.1, |byte, _| byte)?;
        let end = self.text_point(&to.0, &to.1, |byte, len| byte + len)?;
        self.driver.update(|window, cx| window.drag(start, end, cx))
    }

    /// Where the byte `at(start of needle, its length)` of `needle` in the newest row containing
    /// `text` is painted.
    fn text_point(
        &mut self,
        text: &str,
        needle: &str,
        at: impl Fn(usize, usize) -> usize,
    ) -> Result<Point<Pixels>> {
        let (rows, _, _) = self.rows()?;
        let row = rows
            .iter()
            .rev()
            .find(|row| row.display.contains(text))
            .ok_or_else(|| anyhow!("no row contains {text:?}"))?;
        let byte = row
            .display
            .find(needle)
            .ok_or_else(|| anyhow!("{text:?} has no {needle:?}"))?;
        let pos = semaphore_ui::messages::Pos {
            seq: row.seq,
            byte: at(byte, needle.len()) as u32,
        };
        let app = self.app()?.clone();
        self.driver
            .cx
            .update(|cx| {
                let list = app.read(cx).pane()?.read(cx).list()?.clone();
                list.read(cx).point_of(pos)
            })
            .ok_or_else(|| anyhow!("{needle:?} isn't painted"))
    }

    fn requests(&self, name: &str) -> Result<usize> {
        let answer = http(&self.server, "POST", "/__control/requests", "")?;
        Ok(answer["requests"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|record| {
                record["operation"].as_str() == Some(name) || record["event"].as_str() == Some(name)
            })
            .count())
    }

    fn run(&mut self, steps: &[Step], out_dir: &Path) -> Result<()> {
        for (index, step) in steps.iter().enumerate() {
            let started = Instant::now();
            let result = match step {
                Step::App { width, height } => self.open(*width, *height),
                Step::Shot(step) => self
                    .quiet_files(step)
                    .and_then(|()| self.driver.run_generic(step, out_dir))
                    .and_then(|known| {
                        if known {
                            Ok(())
                        } else {
                            bail!("{step:?} is a story step; rig-slice opens the app instead")
                        }
                    }),
                Step::Wait { condition, within } => self.wait(condition, *within),
                Step::Expect(condition) => {
                    self.driver.settle()?;
                    if self.holds(condition)? {
                        Ok(())
                    } else {
                        let (rows, _, _) = self.rows()?;
                        let tail: Vec<&str> = rows
                            .iter()
                            .rev()
                            .take(5)
                            .map(|row| row.display.as_str())
                            .collect();
                        Err(anyhow!("expected {condition:?}; last rows {tail:?}"))
                    }
                }
                Step::Server { control, body } => {
                    http(&self.server, "POST", &format!("/__control/{control}"), body).map(|_| ())
                }
                Step::ExpectRequests { name, at_least } => {
                    let seen = self.requests(name)?;
                    if seen >= *at_least {
                        Ok(())
                    } else {
                        Err(anyhow!(
                            "expected {name} at least {at_least} times, saw {seen}"
                        ))
                    }
                }
                Step::ClickText { text, needle } => self.click_text(text, needle),
                Step::DragText { from, to } => self.drag_text(from, to),
                Step::ClickRow {
                    name,
                    text,
                    index,
                    gesture,
                } => self.click_row(name, text, *index, *gesture),
                Step::Os(event) => {
                    let app = self.app()?.clone();
                    self.driver.cx.update(|cx| app.read(cx).os_event(*event));
                    Ok(())
                }
                Step::Restart => self.restart(),
                Step::W7(step) => self.w7_run(step),
                Step::ClockHold(hold) => {
                    let elapsed = self.clock_started.elapsed().as_millis() as i64;
                    if *hold {
                        self.clock_moves.hold(elapsed);
                    } else {
                        self.clock_moves.run(elapsed);
                    }
                    Ok(())
                }
                Step::SaveAs(name) => {
                    let directory = self.data_dir.join("saved");
                    std::fs::create_dir_all(&directory)?;
                    self.saves.borrow_mut().push_back(directory.join(name));
                    Ok(())
                }
                Step::MicTone(on) => {
                    self.tone.store(*on, std::sync::atomic::Ordering::Relaxed);
                    Ok(())
                }
                Step::Tick(ms) => {
                    // Core's clock moves with GPUI's, so a timer the app set for core fires due.
                    self.clock_moves.tick(*ms);
                    self.driver.cx.advance_clock(Duration::from_millis(*ms));
                    self.driver.settle()
                }
                Step::PlayerToggle(name) => self.player_toggle(name),
                Step::LiveKitRemove { room, identity } => self.livekit_remove(room, identity),
                Step::VideoFailNext { screen, why } => {
                    let slot = if *screen {
                        &self.video.fail_next_screen
                    } else {
                        &self.video.fail_next_camera
                    };
                    *slot.lock().unwrap() = Some(why.clone());
                    Ok(())
                }
                Step::Snap(name) => self.snap(&out_dir.join(format!("{name}.png"))),
                Step::Attach(path) => self.attach(path),
                Step::LinkImages(on) => {
                    self.link_images = *on;
                    Ok(())
                }
                Step::RememberStoredSession => {
                    self.remembered = Some(
                        self.stored_token()
                            .ok_or_else(|| anyhow!("no refresh token is stored"))?,
                    );
                    Ok(())
                }
                Step::ExpectStoredSessionRotated => {
                    let remembered = self
                        .remembered
                        .as_deref()
                        .ok_or_else(|| anyhow!("remember stored-session first"))?;
                    match self.stored_token() {
                        None => Err(anyhow!("no refresh token is stored")),
                        Some(now) if now == remembered => {
                            Err(anyhow!("the stored refresh token was not rotated"))
                        }
                        Some(_) => Ok(()),
                    }
                }
                Step::ExpectOldRefreshRefused => self.replay_old_refresh(),
                Step::Exec(command) => exec(command),
                Step::NotificationClick(tag) => {
                    let app = self.app()?.clone();
                    self.driver.update(|window, cx| {
                        app.update(cx, |root, cx| root.open_notification(tag, window, cx))
                    })
                }
                Step::Link(url) => {
                    let link = semaphore_ui::nav::parse_deep_link(url)
                        .ok_or_else(|| anyhow!("not a link the app takes: {url}"))?;
                    let app = self.app()?.clone();
                    self.driver
                        .update(|_, cx| app.update(cx, |root, cx| root.open_link(link, cx)))
                }
                Step::Navigate(path) => {
                    let route = semaphore_ui::nav::Route::parse(path);
                    let app = self.app()?.clone();
                    self.driver.update(|_, cx| {
                        let shell = app.read(cx).shell().cloned();
                        if let Some(shell) = shell {
                            shell.update(cx, |shell, cx| shell.navigate(route, cx));
                        }
                    })
                }
                Step::ClickLabel(label) => {
                    self.driver.settle()?;
                    let id = self
                        .driver
                        .query(|window| {
                            window
                                .try_find_by_label(label)
                                .and_then(|found| found.path().last().cloned())
                        })?
                        .ok_or_else(|| anyhow!("nothing is labelled {label:?}"))?;
                    self.driver.update(|window, cx| window.click(id, cx))
                }
                Step::ActivateWindow => self
                    .driver
                    .update(|window, _| window.activate_window())
                    .and_then(|()| self.driver.settle()),
                Step::RevokeOtherSessions => self.revoke_other_sessions(),
                Step::PickFile(path) => {
                    let path = std::fs::canonicalize(path)
                        .with_context(|| format!("no file {}", path.display()))?;
                    self.picks.borrow_mut().push_back(path);
                    Ok(())
                }
                Step::BrowserApprove => self.browser_approve(),
                Step::ExpectOpenedUrl(text) => {
                    let last = self.opened.borrow().last().cloned();
                    match last {
                        Some(url) if url.contains(text.as_str()) => Ok(()),
                        other => Err(anyhow!(
                            "the last URL opened is {other:?}, not one with {text:?}"
                        )),
                    }
                }
                Step::ExpectSettings { pointer, value } => {
                    let path = self.data_dir.join(semaphore_app::settings::SETTINGS_FILE);
                    let saved: Value = serde_json::from_str(
                        &std::fs::read_to_string(&path)
                            .with_context(|| format!("reading {}", path.display()))?,
                    )?;
                    let wanted: Value =
                        serde_json::from_str(value).unwrap_or_else(|_| Value::from(value.as_str()));
                    match saved.pointer(pointer) {
                        Some(found) if *found == wanted => Ok(()),
                        found => Err(anyhow!(
                            "settings.json {pointer} is {found:?}, not {wanted}"
                        )),
                    }
                }
                Step::ExpectLinkRegistrations(count) => {
                    let done = self
                        .links
                        .registered
                        .load(std::sync::atomic::Ordering::Relaxed);
                    if done == *count {
                        Ok(())
                    } else {
                        Err(anyhow!("{done} link registrations, not {count}"))
                    }
                }
                Step::ForgetSounds => {
                    self.heard.store(0, std::sync::atomic::Ordering::Relaxed);
                    Ok(())
                }
                Step::ExpectStoredSession(wanted) => {
                    if self.stored_session() == *wanted {
                        Ok(())
                    } else {
                        Err(anyhow!("expected a stored session: {wanted}"))
                    }
                }
                Step::ExpectClipboard(text) => {
                    let copied = self
                        .driver
                        .cx
                        .update(|cx| cx.read_from_clipboard())
                        .and_then(|item| item.text())
                        .unwrap_or_default();
                    if copied.contains(text.as_str()) {
                        Ok(())
                    } else {
                        Err(anyhow!("the clipboard has {copied:?}, not {text:?}"))
                    }
                }
            };
            result.with_context(|| format!("step {}: {step:?}", index + 1))?;
            println!(
                "step {:>2} {:>5} ms  {step:?}",
                index + 1,
                started.elapsed().as_millis()
            );
        }
        Ok(())
    }
}

/// Log lines to stderr at `SEMAPHORE_LOG`, as the app does.
struct StderrLog(log::LevelFilter);

impl log::Log for StderrLog {
    fn enabled(&self, metadata: &log::Metadata) -> bool {
        metadata.level() <= self.0
    }
    fn log(&self, record: &log::Record) {
        if self.enabled(record.metadata()) {
            eprintln!("{} {}: {}", record.level(), record.target(), record.args());
        }
    }
    fn flush(&self) {}
}

fn optional_flag(args: &mut Vec<String>, flag: &str) -> Result<Option<String>> {
    if args.iter().any(|arg| arg == flag) {
        take_flag(args, flag).map(Some)
    } else {
        Ok(None)
    }
}

fn take_flag(args: &mut Vec<String>, flag: &str) -> Result<String> {
    let index = args
        .iter()
        .position(|arg| arg == flag)
        .ok_or_else(|| anyhow!("{flag} is required"))?;
    if index + 1 >= args.len() {
        bail!("{flag} needs a value");
    }
    args.remove(index);
    Ok(args.remove(index))
}

fn main() -> Result<()> {
    let level = std::env::var("SEMAPHORE_LOG")
        .ok()
        .and_then(|level| level.parse().ok())
        .unwrap_or(log::LevelFilter::Warn);
    if log::set_boxed_logger(Box::new(StderrLog(level))).is_ok() {
        log::set_max_level(level);
    }
    let mut args: Vec<String> = std::env::args().skip(1).collect();
    let server = take_flag(&mut args, "--server")?;
    // Without a scenario (a real server), the clock is the machine's.
    let scenario = optional_flag(&mut args, "--scenario")?.map(PathBuf::from);
    let script_path = take_flag(&mut args, "--script")?;
    let out_dir = PathBuf::from(take_flag(&mut args, "--out")?);
    let heartbeat = Duration::from_millis(
        optional_flag(&mut args, "--heartbeat-ms")?
            .map(|ms| ms.parse())
            .transpose()?
            .unwrap_or(30_000),
    );
    let livekit = match (
        optional_flag(&mut args, "--livekit-http")?,
        optional_flag(&mut args, "--livekit-key")?,
        optional_flag(&mut args, "--livekit-secret")?,
    ) {
        (Some(url), Some(key), Some(secret)) => Some(LiveKit { url, key, secret }),
        (None, None, None) => None,
        _ => bail!("--livekit-http, --livekit-key and --livekit-secret go together"),
    };
    let source = message_ids(
        &std::fs::read_to_string(&script_path)
            .with_context(|| script_path.clone())?
            .replace("$SERVER", server.trim_end_matches('/')),
    );
    let steps = parse(&source).with_context(|| script_path.clone())?;
    let now_ms = match &scenario {
        Some(scenario) => scenario_now_ms(scenario)?,
        None => std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?
            .as_millis() as i64,
    };
    std::fs::create_dir_all(&out_dir)?;
    // A fresh data directory per run: no server remembered from the last one.
    let data_dir = out_dir.join("app-data");
    if data_dir.exists() {
        std::fs::remove_dir_all(&data_dir)?;
    }
    let mut rig = Rig::new(server, now_ms, data_dir, livekit, heartbeat);
    let result = rig.run(&steps, &out_dir);
    if let Some(app) = rig.app.clone() {
        rig.driver
            .cx
            .update(|cx| app.update(cx, |app, _| app.shutdown()));
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::prelude::rust_2024::test;

    #[test]
    fn parses_its_own_steps_and_rig_shots() {
        let steps = parse(
            r#"
            app 1280 800
            wait core session signed-in
            wait core text "hello there" within 5
            expect core count "hi" 1
            server drop_connections
            server post_as "{\"text\": \"x\"}"
            expect requests typingStart >= 1
            expect clipboard "copied"
            click auth-login
            shot one
            drag-text "are we" "are" "yeah i'll" "friday"
            "#,
        )
        .unwrap();
        assert_eq!(steps.len(), 11);
        assert_eq!(
            steps[10],
            Step::DragText {
                from: ("are we".into(), "are".into()),
                to: ("yeah i'll".into(), "friday".into()),
            }
        );
        assert!(parse("drag-text \"a\" \"b\" \"c\"").is_err());
        assert_eq!(
            steps[2],
            Step::Wait {
                condition: Condition::Text("hello there".into()),
                within: Duration::from_secs(5),
            }
        );
        assert!(matches!(steps[8], Step::Shot(script::Step::Click { .. })));
        assert!(parse("wait core nonsense").is_err());
    }

    #[test]
    fn reads_rfc3339_like_the_server_writes_it() {
        assert_eq!(parse_rfc3339_ms("1970-01-01T00:00:00.000Z").unwrap(), 0);
        assert_eq!(
            parse_rfc3339_ms("2026-09-22T18:00:00.000Z").unwrap(),
            1_790_100_000_000
        );
    }
}
