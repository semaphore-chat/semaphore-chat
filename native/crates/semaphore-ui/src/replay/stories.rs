//! The replay stories: the capture dialog in every buffer state and destination, the trim at
//! its limits, the clip library (loading, failed, empty, mine, another user's, a long name, busy,
//! the delete confirm) and the share dialog's states. Phone widths come from the shot script.

use super::model::{Handle, PickOption};
use super::{CaptureReplayDialog, CaptureTarget, ClipLibrary, DestinationKind, ShareClipDialog};
use crate::dms::stories::dialog_framed;
use crate::player::Players;
use crate::player::fake::{FakeOpener, Script};
use crate::stories::Story;
use crate::theme::SemTheme as _;
use crate::voice::VideoFrames;
use gpui_kit::*;
use semaphore_core::model::{
    Clip, ClipsView, ErrorView, LoadState, ReplaySessionView, ReplayState,
};

/// 2026-11-08 15:04 UTC.
const CAPTURED: i64 = 1_794_150_240_000;

const LONG_NAME: &str = "replay-2026-11-08 ranked finals, overtime round with the comeback and \
                         the whole lobby screaming in voice (keep this one forever).mp4";

fn recording() -> ReplayState {
    ReplayState::Recording {
        session_id: "s1".into(),
    }
}

fn session(seconds: u32) -> ReplaySessionView {
    ReplaySessionView {
        state: LoadState::Ready,
        active: true,
        total_segments: seconds.div_ceil(10),
        total_seconds: seconds,
        start_ms: Some(CAPTURED),
        end_ms: Some(CAPTURED + i64::from(seconds) * 1000),
    }
}

fn channels() -> Vec<PickOption> {
    vec![
        PickOption::new("c-general", "#general"),
        PickOption::new("c-clips", "#clips-and-highlights"),
        PickOption::new("c-dev", "#dev-chat"),
    ]
}

fn dms() -> Vec<PickOption> {
    vec![
        PickOption::new("dm-ava", "ava_chen"),
        PickOption::new("dm-crew", "ben_ortiz, cleo, dmitri_k"),
    ]
}

fn error(message: &str) -> ErrorView {
    ErrorView {
        code: "failed".into(),
        message: message.into(),
        retryable: true,
        retry_after_ms: None,
    }
}

/// How a capture story sets the dialog up.
struct Capture {
    state: ReplayState,
    session: ReplaySessionView,
    target: CaptureTarget,
    pick: Option<&'static str>,
    lists: bool,
    trim: Option<(u32, u32)>,
    trim_on: bool,
    busy: bool,
    failed: Option<&'static str>,
}

impl Capture {
    fn new() -> Self {
        Self {
            state: recording(),
            session: session(252),
            target: CaptureTarget::Library,
            pick: None,
            lists: true,
            trim: None,
            trim_on: false,
            busy: false,
            failed: None,
        }
    }

    fn story(self, window: &mut Window, cx: &mut App) -> AnyView {
        let dialog = cx.new(|cx| {
            let mut dialog = CaptureReplayDialog::new(window, cx);
            dialog.set_state(self.state, self.session, cx);
            dialog.set_target(self.target, cx);
            if self.lists {
                dialog.set_channels(Some(channels()), window, cx);
                dialog.set_dms(Some(dms()), window, cx);
            }
            if let Some(id) = self.pick {
                dialog.pick(self.target, id, window, cx);
            }
            dialog.set_trim_on(self.trim_on, cx);
            if let Some((start, end)) = self.trim {
                dialog.trim().update(cx, |trim, cx| {
                    trim.set_handle(Handle::Start, start, cx);
                    trim.set_handle(Handle::End, end, cx);
                });
            }
            dialog.set_busy(self.busy, cx);
            dialog.set_failed(self.failed.map(str::to_owned), cx);
            dialog
        });
        dialog_framed(dialog.into(), cx)
    }
}

pub(crate) fn clip(id: &str, name: &str, seconds: u32, public: bool, age_hours: i64) -> Clip {
    Clip {
        id: id.into(),
        file_id: format!("f-{id}"),
        channel_id: None,
        duration_seconds: seconds,
        is_public: public,
        captured_at_ms: CAPTURED - age_hours * 3_600_000,
        download_url: format!("/file/f-{id}"),
        size_bytes: u64::from(seconds) * 780_000,
        filename: name.into(),
        mime_type: "video/mp4".into(),
        has_thumbnail: false,
    }
}

pub(crate) fn clips() -> Vec<Clip> {
    vec![
        clip("c1", "replay-1762614240.mp4", 60, true, 0),
        clip("c2", LONG_NAME, 300, false, 5),
        clip("c3", "boss-fight-no-hit.mp4", 134, true, 26),
        clip("c4", "replay-1762400000.mp4", 600, false, 60),
    ]
}

/// The page a library sits in: the background, padded and scrolling like the profile page.
struct LibraryFrame {
    library: Entity<ClipLibrary>,
}

impl Render for LibraryFrame {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .id("library-frame")
            .size_full()
            .overflow_y_scroll()
            .bg(cx.sem().background_default)
            .p(px(16.))
            .child(self.library.clone())
    }
}

pub(crate) struct Library {
    own: bool,
    view: ClipsView,
    downloading: Vec<String>,
    confirm: Option<(&'static str, bool)>,
}

impl Library {
    pub(crate) fn new(own: bool, view: ClipsView) -> Self {
        Self {
            own,
            view,
            downloading: Vec::new(),
            confirm: None,
        }
    }

    pub(crate) fn ready(own: bool, clips: Vec<Clip>) -> Self {
        Self::new(
            own,
            ClipsView {
                state: LoadState::Ready,
                clips,
                ..ClipsView::default()
            },
        )
    }

    fn story(self, window: &mut Window, cx: &mut App) -> AnyView {
        let library = self.entity(window, cx);
        cx.new(|_| LibraryFrame { library }).into()
    }

    /// The library alone, for a profile page's story.
    pub(crate) fn entity(self, window: &mut Window, cx: &mut App) -> Entity<ClipLibrary> {
        let (opener, _) = FakeOpener::rc(Script::video());
        let players = Players::new(opener, VideoFrames::for_window(window));
        cx.new(|cx| {
            let mut library = ClipLibrary::new(self.own, Some(players), cx);
            library.set_view(self.view, cx);
            library.set_downloading(self.downloading, cx);
            if let Some((id, asked)) = self.confirm {
                library.ask_delete(id, cx);
                if asked {
                    library.confirm_delete(cx);
                }
            }
            library
        })
    }
}

struct Share {
    kind: DestinationKind,
    communities: Option<Vec<PickOption>>,
    community: Option<&'static str>,
    channels: Option<Vec<PickOption>>,
    pick: Option<&'static str>,
    busy: bool,
    failed: Option<&'static str>,
}

impl Share {
    fn new() -> Self {
        Self {
            kind: DestinationKind::Channel,
            communities: Some(vec![
                PickOption::new("k-games", "Game Night"),
                PickOption::new("k-work", "Launch Crew"),
            ]),
            community: None,
            channels: None,
            pick: None,
            busy: false,
            failed: None,
        }
    }

    fn story(self, window: &mut Window, cx: &mut App) -> AnyView {
        let dialog = cx.new(|cx| {
            let mut dialog = ShareClipDialog::new("c1", window, cx);
            dialog.set_communities(self.communities, window, cx);
            if let Some(community) = self.community {
                dialog.pick_community(community, window, cx);
                dialog.set_channels(community, self.channels, window, cx);
            }
            dialog.set_kind(self.kind, cx);
            if self.kind == DestinationKind::Dm {
                dialog.set_dms(Some(dms()), window, cx);
            }
            if let Some(id) = self.pick {
                dialog.pick(self.kind, id, window, cx);
            }
            dialog.set_busy(self.busy, cx);
            dialog.set_failed(self.failed.map(str::to_owned), cx);
            dialog
        });
        dialog_framed(dialog.into(), cx)
    }
}

pub fn stories() -> Vec<Story> {
    vec![
        // The capture dialog.
        Story::new("replay-capture", |_, window, cx| {
            Capture::new().story(window, cx)
        }),
        Story::new("replay-capture-not-recording", |_, window, cx| {
            Capture {
                state: ReplayState::Off,
                session: ReplaySessionView {
                    state: LoadState::Ready,
                    ..ReplaySessionView::default()
                },
                ..Capture::new()
            }
            .story(window, cx)
        }),
        Story::new("replay-capture-starting", |_, window, cx| {
            Capture {
                state: ReplayState::Starting,
                session: ReplaySessionView::default(),
                ..Capture::new()
            }
            .story(window, cx)
        }),
        Story::new("replay-capture-warming-up", |_, window, cx| {
            Capture {
                session: session(0),
                trim_on: true,
                ..Capture::new()
            }
            .story(window, cx)
        }),
        Story::new("replay-capture-failed", |_, window, cx| {
            Capture {
                state: ReplayState::Failed {
                    message: "The recorder stopped unexpectedly".into(),
                },
                ..Capture::new()
            }
            .story(window, cx)
        }),
        Story::new("replay-capture-channel", |_, window, cx| {
            Capture {
                target: CaptureTarget::Channel,
                pick: Some("c-clips"),
                ..Capture::new()
            }
            .story(window, cx)
        }),
        Story::new("replay-capture-channel-loading", |_, window, cx| {
            Capture {
                target: CaptureTarget::Channel,
                lists: false,
                ..Capture::new()
            }
            .story(window, cx)
        }),
        Story::new("replay-capture-dm-unpicked", |_, window, cx| {
            Capture {
                target: CaptureTarget::Dm,
                failed: Some("Please select a DM conversation"),
                ..Capture::new()
            }
            .story(window, cx)
        }),
        Story::new("replay-capture-busy", |_, window, cx| {
            Capture {
                busy: true,
                ..Capture::new()
            }
            .story(window, cx)
        }),
        Story::new("replay-capture-error", |_, window, cx| {
            Capture {
                failed: Some(
                    "That part of the replay is no longer available. Try a more recent time range.",
                ),
                ..Capture::new()
            }
            .story(window, cx)
        }),
        // The trim.
        Story::new("replay-trim", |_, window, cx| {
            Capture {
                trim_on: true,
                ..Capture::new()
            }
            .story(window, cx)
        }),
        Story::new("replay-trim-limits", |_, window, cx| {
            Capture {
                trim_on: true,
                trim: Some((0, 252)),
                ..Capture::new()
            }
            .story(window, cx)
        }),
        Story::new("replay-trim-shortest", |_, window, cx| {
            Capture {
                trim_on: true,
                trim: Some((251, 252)),
                ..Capture::new()
            }
            .story(window, cx)
        }),
        Story::new("replay-trim-long-buffer", |_, window, cx| {
            Capture {
                session: session(1500),
                trim_on: true,
                trim: Some((640, 815)),
                ..Capture::new()
            }
            .story(window, cx)
        }),
        Story::new("replay-trim-loading", |_, window, cx| {
            Capture {
                session: ReplaySessionView::default(),
                trim_on: true,
                ..Capture::new()
            }
            .story(window, cx)
        }),
        Story::new("replay-trim-download", |_, window, cx| {
            Capture {
                trim_on: true,
                target: CaptureTarget::Download,
                ..Capture::new()
            }
            .story(window, cx)
        }),
        // The library.
        Story::new("replay-library-loading", |_, window, cx| {
            Library::new(true, ClipsView::default()).story(window, cx)
        }),
        Story::new("replay-library-failed", |_, window, cx| {
            Library::new(
                true,
                ClipsView {
                    state: LoadState::Failed {
                        error: error("Network error"),
                    },
                    ..ClipsView::default()
                },
            )
            .story(window, cx)
        }),
        Story::new("replay-library-empty", |_, window, cx| {
            Library::ready(true, Vec::new()).story(window, cx)
        }),
        Story::new("replay-library-empty-other", |_, window, cx| {
            Library::ready(false, Vec::new()).story(window, cx)
        }),
        Story::new("replay-library-mine", |_, window, cx| {
            Library {
                downloading: vec!["c3".into()],
                ..Library::new(
                    true,
                    ClipsView {
                        state: LoadState::Ready,
                        clips: clips(),
                        busy: vec!["c4".into()],
                        error: Some(error("Couldn't update that clip. Try again.")),
                    },
                )
            }
            .story(window, cx)
        }),
        Story::new("replay-library-other", |_, window, cx| {
            Library::ready(
                false,
                clips().into_iter().filter(|clip| clip.is_public).collect(),
            )
            .story(window, cx)
        }),
        Story::new("replay-library-delete", |_, window, cx| {
            Library {
                confirm: Some(("c2", false)),
                ..Library::ready(true, clips())
            }
            .story(window, cx)
        }),
        Story::new("replay-library-deleting", |_, window, cx| {
            Library {
                confirm: Some(("c2", true)),
                ..Library::new(
                    true,
                    ClipsView {
                        state: LoadState::Ready,
                        clips: clips(),
                        busy: vec!["c2".into()],
                        error: None,
                    },
                )
            }
            .story(window, cx)
        }),
        // The share dialog.
        Story::new("replay-share", |_, window, cx| {
            Share::new().story(window, cx)
        }),
        Story::new("replay-share-loading", |_, window, cx| {
            Share {
                communities: None,
                ..Share::new()
            }
            .story(window, cx)
        }),
        Story::new("replay-share-channel", |_, window, cx| {
            Share {
                community: Some("k-games"),
                channels: Some(channels()),
                pick: Some("c-general"),
                ..Share::new()
            }
            .story(window, cx)
        }),
        Story::new("replay-share-no-channels", |_, window, cx| {
            Share {
                community: Some("k-work"),
                channels: Some(Vec::new()),
                ..Share::new()
            }
            .story(window, cx)
        }),
        Story::new("replay-share-dm", |_, window, cx| {
            Share {
                kind: DestinationKind::Dm,
                pick: Some("dm-crew"),
                busy: true,
                ..Share::new()
            }
            .story(window, cx)
        }),
        Story::new("replay-share-failed", |_, window, cx| {
            Share {
                community: Some("k-games"),
                channels: Some(channels()),
                failed: Some("You don't have permission to post in this channel"),
                ..Share::new()
            }
            .story(window, cx)
        }),
    ]
}
