//! W4: the replay buffer in the app: the capture dialog (from the voice bar's Capture button), the
//! replay audio-wait timer, the clip library on profile pages and the share dialog.
//!
//! - **Capture** (`CaptureReplayDialog`): the buffer's state from `VoiceView::replay` and
//!   `Core::replay_session`; the window's `Players` for the trim's preview (none without the
//!   player feature); the destinations from the call's community's text channels or my DMs;
//!   `Core::capture_replay`, or `Core::download_replay` saved where the user chooses
//!   (`files::ask_save_path`: the config's save dialog, the system's or the rig's queue).
//! - **Clip libraries** (`ClipLibrary`) on profile pages: mine (`Core::clips`) on my page, the
//!   user's public ones (`Core::user_clips`) on theirs, played by the window's `Players`.
//! - **Sharing** a clip (`ShareClipDialog`) to a channel of one of my communities or a DM.
//! - **Toasts** for what the web says with a snackbar ("Recording saved", "Clip shared
//!   successfully"): one at a time at the window's foot, gone after [`TOAST_FOR`].
//! - **The audio wait**: while `VoiceView::replay_audio_wait_until_ms` is set, a timer calls
//!   `Core::expire_replay_audio_wait` at it.
//! - **Sessions**: everything here is the session's. Results that land after a sign-out find their
//!   session's token gone ([`Replay::session`]) and are dropped.

use super::AppRoot;
use crate::files;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{
    ChannelKind, ClipDestination, LoadState, ReplayMinutes, ViewKey, VoiceRoom,
};
use semaphore_core::platform::CoreError;
use semaphore_core::{Core, CoreEvent};
use semaphore_ui::kit::Snackbar;
use semaphore_ui::profile::ProfilePage;
use semaphore_ui::replay::{
    CaptureEvent, CaptureReplayDialog, Choices, ClipEvent, ClipLibrary, DestinationKind,
    PickOption, ShareClipDialog, ShareEvent,
};
use std::rc::Rc;
use std::sync::Arc;
use std::time::Duration;

/// How long a toast stays.
pub const TOAST_FOR: Duration = Duration::from_secs(4);

/// This session's replay UI. Rebuilt empty on sign-out (`drop_replay`).
#[derive(Default)]
pub(super) struct Replay {
    /// This session, for results on their way: they hold a `Weak` of it and are dropped once it's
    /// gone (`drop_replay` makes a new one).
    session: Rc<()>,
    capture: Option<Capture>,
    share: Option<Share>,
    library: Option<Library>,
    /// Clips whose download is on its way.
    downloading: Vec<String>,
    toast: Option<Toast>,
    /// The audio wait the timer is for, and the timer.
    audio_wait: Option<(u64, Task<()>)>,
}

struct Capture {
    dialog: Entity<CaptureReplayDialog>,
    /// Asked for the call's channels or my DMs: kept fresh as they load.
    wants_channels: bool,
    wants_dms: bool,
    _subscription: Subscription,
}

struct Share {
    dialog: Entity<ShareClipDialog>,
    /// The community whose channels are asked for.
    community_id: Option<String>,
    wants_dms: bool,
    _subscription: Subscription,
}

struct Library {
    user_id: String,
    own: bool,
    entity: Entity<ClipLibrary>,
    _subscription: Subscription,
}

struct Toast {
    message: String,
    _timer: Task<()>,
}

/// What a dialog says when the server refused: its words, else what failed.
fn refusal(what: &str, error: &CoreError) -> String {
    match error {
        CoreError::Failed { message } if !message.trim().is_empty() => message.clone(),
        CoreError::Failed { .. } => what.to_owned(),
        CoreError::Unavailable { what: why } => format!("{what}: {why}"),
    }
}

/// A community's text channels as `#name`; `None` while they load.
fn channel_choices(core: &Core, community_id: &str) -> Choices {
    let channels = core.channels(community_id.to_owned());
    let state = core.load_state(ViewKey::Channels {
        community_id: community_id.to_owned(),
    });
    if channels.is_empty() && state == LoadState::Loading {
        return None;
    }
    Some(
        channels
            .into_iter()
            .filter(|channel| channel.kind == ChannelKind::Text)
            .map(|channel| PickOption::new(channel.id, format!("#{}", channel.name)))
            .collect(),
    )
}

/// My DMs and groups, named as the DM list names them; `None` while they load.
fn dm_choices(core: &Core) -> Choices {
    let list = core.dm_list();
    if list.rows.is_empty() && list.state == LoadState::Loading {
        return None;
    }
    Some(
        list.rows
            .iter()
            .map(|row| PickOption::new(row.id.clone(), semaphore_ui::dms::names::dm_title(row)))
            .collect(),
    )
}

/// My communities; `None` while they load.
fn community_choices(core: &Core) -> Choices {
    let communities = core.communities();
    if communities.is_empty() && core.load_state(ViewKey::Communities) == LoadState::Loading {
        return None;
    }
    Some(
        communities
            .into_iter()
            .map(|community| PickOption::new(community.id, community.name))
            .collect(),
    )
}

impl AppRoot {
    pub(super) fn replay_on_core(&mut self, event: &CoreEvent, cx: &mut Context<Self>) {
        let CoreEvent::ViewChanged { view } = event else {
            return;
        };
        let Some(core) = self.core() else {
            return;
        };
        match view {
            ViewKey::Voice => {
                self.schedule_audio_wait(&core, cx);
                self.refresh_capture(&core, cx);
            }
            ViewKey::ReplaySession => self.refresh_capture(&core, cx),
            ViewKey::Clips => {
                if let Some(library) = self.replay.library.as_ref().filter(|l| l.own) {
                    let view = core.clips();
                    library
                        .entity
                        .update(cx, |library, cx| library.set_view(view, cx));
                }
            }
            ViewKey::UserClips { user_id } => {
                if let Some(library) = self
                    .replay
                    .library
                    .as_ref()
                    .filter(|l| !l.own && &l.user_id == user_id)
                {
                    let view = core.user_clips(user_id.clone());
                    library
                        .entity
                        .update(cx, |library, cx| library.set_view(view, cx));
                }
            }
            ViewKey::Channels { community_id } => {
                if let Some(capture) = self.replay.capture.as_ref().filter(|c| c.wants_channels)
                    && Self::call_community(&core).as_deref() == Some(community_id.as_str())
                {
                    let (dialog, choices) =
                        (capture.dialog.clone(), channel_choices(&core, community_id));
                    self.in_window(cx, move |window, cx| {
                        dialog.update(cx, |dialog, cx| dialog.set_channels(choices, window, cx));
                    });
                }
                if let Some(share) = &self.replay.share
                    && share.community_id.as_deref() == Some(community_id.as_str())
                {
                    let (dialog, choices) =
                        (share.dialog.clone(), channel_choices(&core, community_id));
                    let community_id = community_id.clone();
                    self.in_window(cx, move |window, cx| {
                        dialog.update(cx, |dialog, cx| {
                            dialog.set_channels(&community_id, choices, window, cx)
                        });
                    });
                }
            }
            ViewKey::DirectMessages => {
                let choices = dm_choices(&core);
                let capture = self
                    .replay
                    .capture
                    .as_ref()
                    .filter(|capture| capture.wants_dms)
                    .map(|capture| capture.dialog.clone());
                let share = self
                    .replay
                    .share
                    .as_ref()
                    .filter(|share| share.wants_dms)
                    .map(|share| share.dialog.clone());
                if capture.is_some() || share.is_some() {
                    self.in_window(cx, move |window, cx| {
                        if let Some(dialog) = capture {
                            let choices = choices.clone();
                            dialog.update(cx, |dialog, cx| dialog.set_dms(choices, window, cx));
                        }
                        if let Some(dialog) = share {
                            dialog.update(cx, |dialog, cx| dialog.set_dms(choices, window, cx));
                        }
                    });
                }
            }
            ViewKey::Communities => {
                if let Some(share) = &self.replay.share {
                    let (dialog, choices) = (share.dialog.clone(), community_choices(&core));
                    self.in_window(cx, move |window, cx| {
                        dialog.update(cx, |dialog, cx| dialog.set_communities(choices, window, cx));
                    });
                }
            }
            _ => {}
        }
    }

    /// Signed out: no dialog, library or timer of this session stays, and nothing on its way
    /// lands in the next one.
    pub(super) fn drop_replay(&mut self) {
        self.replay = Replay::default();
    }

    /// The capture and share dialogs over the shell, and the toast.
    pub(super) fn replay_overlays(&self, _cx: &mut Context<Self>) -> Vec<AnyElement> {
        let mut overlays: Vec<AnyElement> = Vec::new();
        if let Some(capture) = &self.replay.capture {
            overlays.push(capture.dialog.clone().into_any_element());
        }
        if let Some(share) = &self.replay.share {
            overlays.push(share.dialog.clone().into_any_element());
        }
        if let Some(toast) = &self.replay.toast {
            overlays.push(
                div()
                    .absolute()
                    .left_0()
                    .right_0()
                    .bottom(px(24.))
                    .px(px(16.))
                    .flex()
                    .justify_center()
                    .child(
                        div()
                            .id("replay-toast")
                            .test_support()
                            .role(Role::Status)
                            .aria_label(SharedString::from(toast.message.clone()))
                            .child(Snackbar::new(toast.message.clone())),
                    )
                    .into_any_element(),
            );
        }
        overlays
    }

    /// The toast, for the rig.
    /// The capture dialog's trim preview, while one is open (rigs).
    pub fn trim_preview(&self, cx: &App) -> Option<Entity<semaphore_ui::replay::TrimPreview>> {
        let capture = self.replay.capture.as_ref()?;
        let trim = capture.dialog.read(cx).trim().clone();
        trim.read(cx).preview_entity().cloned()
    }

    pub fn replay_toast(&self) -> Option<&str> {
        self.replay
            .toast
            .as_ref()
            .map(|toast| toast.message.as_str())
    }

    /// The voice bar's (or the "more" sheet's) Capture: open the capture dialog.
    pub(super) fn open_capture(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(core) = self.core() else {
            return;
        };
        if self.replay.capture.is_some() {
            return;
        }
        let dialog = cx.new(|cx| CaptureReplayDialog::new(window, cx));
        let voice = core.voice();
        let session = core.replay_session();
        let players = self.players.clone();
        dialog.update(cx, |dialog, cx| {
            dialog.set_players(players, cx);
            dialog.set_state(voice.replay, session, cx);
        });
        let subscription = cx.subscribe_in(&dialog, window, Self::on_capture);
        self.replay.capture = Some(Capture {
            dialog,
            wants_channels: false,
            wants_dms: false,
            _subscription: subscription,
        });
        cx.notify();
    }

    /// A profile page was made for `user_id` (`own`: mine): give it its clip library.
    pub(super) fn replay_profile_opened(
        &mut self,
        page: &Entity<ProfilePage>,
        user_id: &str,
        own: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(core) = self.core() else {
            return;
        };
        let players = self.players.clone();
        let entity = cx.new(|cx| ClipLibrary::new(own, players, cx));
        let view = if own {
            core.clips()
        } else {
            core.user_clips(user_id.to_owned())
        };
        let downloading = self.replay.downloading.clone();
        entity.update(cx, |library, cx| {
            library.set_view(view, cx);
            library.set_downloading(downloading, cx);
        });
        let subscription = cx.subscribe_in(&entity, window, Self::on_clips);
        page.update(cx, |page, cx| page.set_clips(entity.clone(), cx));
        self.replay.library = Some(Library {
            user_id: user_id.to_owned(),
            own,
            entity,
            _subscription: subscription,
        });
    }

    // ---- Capture. ----

    /// The call's community, for "Share to channel"; `None` in a DM call or out of one.
    fn call_community(core: &Core) -> Option<String> {
        match core.voice().room {
            Some(VoiceRoom::Channel { community_id, .. }) => community_id,
            _ => None,
        }
    }

    fn refresh_capture(&mut self, core: &Core, cx: &mut Context<Self>) {
        let Some(capture) = &self.replay.capture else {
            return;
        };
        let (voice, session) = (core.voice(), core.replay_session());
        capture
            .dialog
            .update(cx, |dialog, cx| dialog.set_state(voice.replay, session, cx));
    }

    fn on_capture(
        &mut self,
        dialog: &Entity<CaptureReplayDialog>,
        event: &CaptureEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(core) = self.core() else {
            return;
        };
        match event.clone() {
            CaptureEvent::NeedDestinations(DestinationKind::Channel) => {
                let choices = match Self::call_community(&core) {
                    Some(community_id) => channel_choices(&core, &community_id),
                    None => Some(Vec::new()),
                };
                if let Some(capture) = &mut self.replay.capture {
                    capture.wants_channels = true;
                }
                dialog.update(cx, |dialog, cx| dialog.set_channels(choices, window, cx));
            }
            CaptureEvent::NeedDestinations(DestinationKind::Dm) => {
                if let Some(capture) = &mut self.replay.capture {
                    capture.wants_dms = true;
                }
                let choices = dm_choices(&core);
                dialog.update(cx, |dialog, cx| dialog.set_dms(choices, window, cx));
            }
            CaptureEvent::Capture(request) => {
                let Some(exec) = self.services.as_ref().map(|s| s.exec.clone()) else {
                    return;
                };
                dialog.update(cx, |dialog, cx| {
                    dialog.set_failed(None, cx);
                    dialog.set_busy(true, cx);
                });
                let (session, weak) = (Rc::downgrade(&self.replay.session), dialog.downgrade());
                exec.run(
                    window,
                    cx,
                    async move { core.capture_replay(request).await },
                    move |root, result, _, cx| {
                        if session.upgrade().is_none() {
                            return;
                        }
                        match result {
                            Ok(_) => {
                                root.close_capture(&weak, cx);
                                root.show_toast("Recording saved", cx);
                            }
                            Err(error) => {
                                let message = refusal("Failed to capture replay", &error);
                                weak.update(cx, |dialog, cx| {
                                    dialog.set_busy(false, cx);
                                    dialog.set_failed(Some(message), cx);
                                })
                                .ok();
                            }
                        }
                    },
                );
            }
            CaptureEvent::DownloadOnly { minutes } => {
                let now_ms = self.config.clock.now_ms();
                let name = format!("replay-{now_ms}.mp4");
                let chosen = files::ask_save_path(&name, cx);
                let weak = dialog.downgrade();
                let session = Rc::downgrade(&self.replay.session);
                cx.spawn_in(window, async move |this, cx| {
                    let Some(path) = chosen.await else {
                        return;
                    };
                    this.update_in(cx, |root, window, cx| {
                        if session.upgrade().is_some() {
                            root.download_replay(weak, minutes, path, window, cx);
                        }
                    })
                    .ok();
                })
                .detach();
            }
            CaptureEvent::Retry => core.retry_failed(),
            CaptureEvent::Close => self.close_capture(&dialog.downgrade(), cx),
        }
    }

    /// "Download only", once the user chose where: the stream, written there.
    fn download_replay(
        &mut self,
        dialog: WeakEntity<CaptureReplayDialog>,
        minutes: ReplayMinutes,
        path: std::path::PathBuf,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let (Some(core), Some(exec)) = (
            self.core(),
            self.services.as_ref().map(|services| services.exec.clone()),
        ) else {
            return;
        };
        dialog
            .update(cx, |dialog, cx| {
                dialog.set_failed(None, cx);
                dialog.set_busy(true, cx);
            })
            .ok();
        let session = Rc::downgrade(&self.replay.session);
        exec.run(
            window,
            cx,
            async move {
                let bytes = core
                    .download_replay(minutes)
                    .await
                    .map_err(|error| error.to_string())?;
                files::write_file(path, bytes).await
            },
            move |root, result, _, cx| {
                if session.upgrade().is_none() {
                    return;
                }
                match result {
                    Ok(()) => {
                        root.close_capture(&dialog, cx);
                        root.show_toast("Replay clip downloaded successfully!", cx);
                    }
                    Err(error) => {
                        log::warn!("downloading the replay: {error}");
                        dialog
                            .update(cx, |dialog, cx| {
                                dialog.set_busy(false, cx);
                                dialog
                                    .set_failed(Some("Failed to download replay clip".into()), cx);
                            })
                            .ok();
                    }
                }
            },
        );
    }

    /// Drops the capture dialog if it's still this one.
    fn close_capture(&mut self, dialog: &WeakEntity<CaptureReplayDialog>, cx: &mut Context<Self>) {
        if self
            .replay
            .capture
            .as_ref()
            .is_some_and(|capture| capture.dialog.entity_id() == dialog.entity_id())
        {
            self.replay.capture = None;
            cx.notify();
        }
    }

    // ---- The clip library. ----

    fn on_clips(
        &mut self,
        _: &Entity<ClipLibrary>,
        event: &ClipEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let (Some(core), Some(exec)) = (
            self.core(),
            self.services.as_ref().map(|services| services.exec.clone()),
        ) else {
            return;
        };
        match event.clone() {
            ClipEvent::SetPublic { clip_id, public } => exec.fire(async move {
                // A failure shows in the library (`ClipsView::error`).
                if let Err(error) = core.set_clip_public(clip_id, public).await {
                    log::warn!("changing a clip's visibility: {error}");
                }
            }),
            ClipEvent::Delete { clip_id } => exec.fire(async move {
                if let Err(error) = core.delete_clip(clip_id).await {
                    log::warn!("deleting a clip: {error}");
                }
            }),
            ClipEvent::Download {
                clip_id,
                file_id,
                filename,
            } => {
                if self.replay.downloading.contains(&clip_id) {
                    return;
                }
                let chosen = files::ask_save_path(&filename, cx);
                let session = Rc::downgrade(&self.replay.session);
                cx.spawn_in(window, async move |this, cx| {
                    let Some(path) = chosen.await else {
                        return;
                    };
                    this.update_in(cx, |root, window, cx| {
                        if session.upgrade().is_some() {
                            root.download_clip(clip_id, file_id, path, window, cx);
                        }
                    })
                    .ok();
                })
                .detach();
            }
            ClipEvent::Share { clip_id } => self.open_share(clip_id, window, cx),
            ClipEvent::Retry => core.retry_failed(),
        }
    }

    fn download_clip(
        &mut self,
        clip_id: String,
        file_id: String,
        path: std::path::PathBuf,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let (Some(core), Some(exec)) = (
            self.core(),
            self.services.as_ref().map(|services| services.exec.clone()),
        ) else {
            return;
        };
        self.replay.downloading.push(clip_id.clone());
        self.push_downloading(cx);
        let session = Rc::downgrade(&self.replay.session);
        exec.run(
            window,
            cx,
            async move {
                let bytes = core
                    .file(file_id, false)
                    .await
                    .map_err(|error| error.to_string())?;
                files::write_file(path, bytes).await
            },
            move |root, result, _, cx| {
                if session.upgrade().is_none() {
                    return;
                }
                root.replay.downloading.retain(|id| id != &clip_id);
                root.push_downloading(cx);
                if let Err(error) = result {
                    log::warn!("downloading a clip: {error}");
                    root.show_toast("Failed to download clip", cx);
                }
            },
        );
    }

    fn push_downloading(&mut self, cx: &mut Context<Self>) {
        if let Some(library) = &self.replay.library {
            let downloading = self.replay.downloading.clone();
            library
                .entity
                .update(cx, |library, cx| library.set_downloading(downloading, cx));
        }
    }

    // ---- Sharing. ----

    fn open_share(&mut self, clip_id: String, window: &mut Window, cx: &mut Context<Self>) {
        let Some(core) = self.core() else {
            return;
        };
        let dialog = cx.new(|cx| ShareClipDialog::new(clip_id, window, cx));
        let communities = community_choices(&core);
        dialog.update(cx, |dialog, cx| {
            dialog.set_communities(communities, window, cx)
        });
        let subscription = cx.subscribe_in(&dialog, window, Self::on_share);
        self.replay.share = Some(Share {
            dialog,
            community_id: None,
            wants_dms: false,
            _subscription: subscription,
        });
        cx.notify();
    }

    fn on_share(
        &mut self,
        dialog: &Entity<ShareClipDialog>,
        event: &ShareEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(core) = self.core() else {
            return;
        };
        match event.clone() {
            ShareEvent::PickCommunity { community_id } => {
                if let Some(share) = &mut self.replay.share {
                    share.community_id = Some(community_id.clone());
                }
                let choices = channel_choices(&core, &community_id);
                dialog.update(cx, |dialog, cx| {
                    dialog.set_channels(&community_id, choices, window, cx)
                });
            }
            ShareEvent::NeedDms => {
                if let Some(share) = &mut self.replay.share {
                    share.wants_dms = true;
                }
                let choices = dm_choices(&core);
                dialog.update(cx, |dialog, cx| dialog.set_dms(choices, window, cx));
            }
            ShareEvent::Share {
                clip_id,
                destination,
            } => {
                let Some(exec) = self.services.as_ref().map(|s| s.exec.clone()) else {
                    return;
                };
                if destination == ClipDestination::Library {
                    return;
                }
                dialog.update(cx, |dialog, cx| {
                    dialog.set_failed(None, cx);
                    dialog.set_busy(true, cx);
                });
                let (session, weak) = (Rc::downgrade(&self.replay.session), dialog.downgrade());
                exec.run(
                    window,
                    cx,
                    async move { core.share_clip(clip_id, destination).await },
                    move |root, result, _, cx| {
                        if session.upgrade().is_none() {
                            return;
                        }
                        match result {
                            Ok(()) => {
                                root.close_share(&weak, cx);
                                root.show_toast("Clip shared successfully", cx);
                            }
                            Err(error) => {
                                let message = refusal("Failed to share clip", &error);
                                weak.update(cx, |dialog, cx| {
                                    dialog.set_busy(false, cx);
                                    dialog.set_failed(Some(message), cx);
                                })
                                .ok();
                            }
                        }
                    },
                );
            }
            ShareEvent::Close => self.close_share(&dialog.downgrade(), cx),
        }
    }

    fn close_share(&mut self, dialog: &WeakEntity<ShareClipDialog>, cx: &mut Context<Self>) {
        if self
            .replay
            .share
            .as_ref()
            .is_some_and(|share| share.dialog.entity_id() == dialog.entity_id())
        {
            self.replay.share = None;
            cx.notify();
        }
    }

    // ---- Toasts, timers, posters. ----

    fn show_toast(&mut self, message: &str, cx: &mut Context<Self>) {
        let timer = cx.spawn(async move |this, cx| {
            cx.background_executor().timer(TOAST_FOR).await;
            this.update(cx, |root, cx| {
                root.replay.toast = None;
                cx.notify();
            })
            .ok();
        });
        self.replay.toast = Some(Toast {
            message: message.to_owned(),
            _timer: timer,
        });
        cx.notify();
    }

    /// While a share's audio track is awaited, `Core::expire_replay_audio_wait` at its deadline.
    fn schedule_audio_wait(&mut self, core: &Arc<Core>, cx: &mut Context<Self>) {
        let until = core.voice().replay_audio_wait_until_ms;
        let scheduled = self.replay.audio_wait.as_ref().map(|(at, _)| *at);
        if until == scheduled {
            return;
        }
        let Some(until) = until else {
            self.replay.audio_wait = None;
            return;
        };
        let delay = Duration::from_millis(until.saturating_sub(self.config.clock.now_ms()));
        let core = Arc::downgrade(core);
        let timer = cx.spawn(async move |_, cx| {
            cx.background_executor().timer(delay).await;
            if let Some(core) = core.upgrade() {
                core.expire_replay_audio_wait();
            }
        });
        self.replay.audio_wait = Some((until, timer));
    }

    /// Runs `update` with the window, after the event being handled (core events come without
    /// one): the dialogs' pickers need it.
    fn in_window(
        &self,
        cx: &mut Context<Self>,
        update: impl FnOnce(&mut Window, &mut App) + 'static,
    ) {
        let handle = self.window;
        cx.defer(move |cx| {
            handle.update(cx, |_, window, cx| update(window, cx)).ok();
        });
    }
}
