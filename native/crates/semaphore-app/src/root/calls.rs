//! W4: calls in the app: the incoming call banner and its ring timer, DM call controls and the DM
//! stage, the participant menu (volume, server mute, kick), the soundboard, the frame's call slot
//! (B11: the call bar, the call surface and the voice notice) and the voice debug panel
//! (Ctrl+Shift+D).
//!
//! - **The ring's timer.** Core has no timers: a ring carries `expires_at_ms`, and this arms a
//!   GPUI timer for it (by core's clock), calling `Core::expire_incoming_call` when it's due. A
//!   newer ring replaces the timer; no ring drops it. Signing out drops it with `Calls`.
//! - **Sounds.** Core decides the cues (`CoreEvent::Sound`); `Sounds` plays them, the ring on a
//!   loop until core stops it.
//! - **The call slot.** Away from the call view, the call bar, with the call surface above it while
//!   someone shares or has a camera on (or you share). Nothing is received until Watch: the
//!   watched tracks are this session's (`Calls::watched`), and the surface asks core for exactly
//!   those. Out of a call, the voice notice: a failed join (set here) or `VoiceView::ended`.
//! - **What's kept:** the DM stage's split, in the settings; volumes per user (`Settings::user_volumes`, and `screen_share_volumes` for the
//!   audio of their screen shares), applied on every join.

use super::AppRoot;
use super::prejoin::was_left;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::CoreEvent;
use semaphore_core::model::{
    IncomingCallView, SessionState, ViewKey, VoiceJoinOptions, VoiceRoom, VoiceStatus,
};
use semaphore_ui::kit::{CallSlot, CallStack};
use semaphore_ui::nav::Route;
use semaphore_ui::shell::lounge::call::{
    CallBar, CallBarModel, CallPhase, CallSurface, SurfaceActions, VoiceNoticeBar,
    VoiceNoticeModel, ended_notice, join_failed_notice, shows_surface, surface_tiles,
};
use semaphore_ui::theme::SemTheme as _;
use semaphore_ui::voice::{
    DebugActions, IncomingActions, IncomingProps, ParticipantMenu, ParticipantMenuEvent,
    ParticipantMenuModel, SoundboardBar, TileDemand, VoiceController, incoming_call_banner,
    voice_debug_panel,
};
use std::cell::Cell;
use std::rc::Rc;
use std::sync::Arc;
use std::time::Duration;

actions!(semaphore_app, [ToggleVoiceDebug]);

/// How often the debug panel asks for fresh stats while it's open.
const DEBUG_REFRESH: Duration = Duration::from_secs(1);
/// A due timer core still thinks early (clock skew) tries again this soon.
const RETRY_EARLY: Duration = Duration::from_millis(50);
/// The DM stage's share of the column when none is saved, and the bounds a drag keeps to.
pub const DM_STAGE_DEFAULT: f32 = 0.5;
const DM_STAGE_MIN: f32 = 0.2;
const DM_STAGE_MAX: f32 = 0.8;

/// The window whose debug panel Ctrl+Shift+D toggles.
struct DebugTarget(WeakEntity<AppRoot>);

impl Global for DebugTarget {}

/// Ctrl+Shift+D, anywhere in the window, focused or not: a global handler, since nothing may hold
/// focus (a dialog just closed).
pub fn init(cx: &mut App) {
    cx.bind_keys([KeyBinding::new("ctrl-shift-d", ToggleVoiceDebug, None)]);
    cx.on_action(|_: &ToggleVoiceDebug, cx: &mut App| {
        let target = cx
            .try_global::<DebugTarget>()
            .map(|target| target.0.clone());
        if let Some(root) = target {
            root.update(cx, |root, cx| root.toggle_voice_debug(cx)).ok();
        }
    });
}

/// This root is the one Ctrl+Shift+D is for (the app has one window).
pub(super) fn target_debug_panel(cx: &mut Context<AppRoot>) {
    let root = cx.entity().downgrade();
    cx.set_global(DebugTarget(root));
}

/// This session's call UI. Rebuilt empty on sign-out (`drop_calls`).
#[derive(Default)]
pub(super) struct Calls {
    /// The ring's expiry this timer is for, and the timer.
    ring_timer: Option<(u64, Task<()>)>,
    /// Accept was pressed and the join hasn't finished.
    accepting: bool,
    /// Why the last accept failed.
    incoming_error: Option<String>,
    menu: Option<(Entity<ParticipantMenu>, Subscription)>,
    soundboard_open: bool,
    /// The tracks the call surface shows (Watch), by sid. Cleared when the call ends.
    watched: std::collections::BTreeSet<String>,
    /// What the surface last asked core for, so a frame that asks the same sends nothing.
    surface_demands: Rc<std::cell::RefCell<Option<Vec<TileDemand>>>>,
    /// The frames' count when Watch was last pressed, for the rig (`surface-frames`).
    watch_generation: u64,
    /// The voice notice, while it shows.
    notice: Option<SlotNotice>,
    /// The `VoiceView::ended` the notice last took (so a dismissed one stays dismissed).
    ended_seen: Option<semaphore_core::model::VoiceEnded>,
    /// Draws the frame again as the watched pictures' frames come in.
    video_redraw: Option<Task<()>>,
    debug: Option<Task<()>>,
    /// The DM stage's drag, while it runs: the column's top and height.
    dm_drag: Rc<Cell<Option<(f32, f32)>>>,
    /// The DM stage's split while dragging, saved on release.
    dm_ratio: Rc<Cell<Option<f32>>>,
    /// The server mute about me last handed to the engine.
    server_muted: bool,
}

/// The voice notice in the call slot, and what Retry joins.
#[derive(Clone)]
pub(super) struct SlotNotice {
    pub(super) model: VoiceNoticeModel,
    pub(super) room: Option<VoiceRoom>,
    /// The mute and deafen Retry joins with: the failed join's own, or the call's when it ended.
    pub(super) options: VoiceJoinOptions,
}

/// What the notice's Retry joins: the room, and how the failed join or the ended call had it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum RetryJoin {
    Channel {
        channel_id: String,
        options: VoiceJoinOptions,
    },
    Dm {
        dm_group_id: String,
        options: VoiceJoinOptions,
    },
}

impl SlotNotice {
    /// A join that failed: Retry joins the room the same way.
    fn join_failed(room: VoiceRoom, options: VoiceJoinOptions) -> Self {
        Self {
            model: join_failed_notice(),
            room: Some(room),
            options,
        }
    }

    /// A call that ended on its own: Retry rejoins it muted and deafened as it was.
    fn ended(ended: &semaphore_core::model::VoiceEnded) -> Self {
        Self {
            model: ended_notice(ended),
            room: Some(ended.room.clone()),
            options: ended.options,
        }
    }

    fn retry(&self) -> Option<RetryJoin> {
        Some(match self.room.as_ref()? {
            VoiceRoom::Channel { channel_id, .. } => RetryJoin::Channel {
                channel_id: channel_id.clone(),
                options: self.options,
            },
            VoiceRoom::Dm { dm_group_id } => RetryJoin::Dm {
                dm_group_id: dm_group_id.clone(),
                options: self.options,
            },
        })
    }
}

impl Calls {
    /// Watch: the surface shows this track, and the frame redraws as its frames come in from here.
    fn watch(&mut self, sid: String, generation: u64) {
        self.watch_generation = generation;
        self.watched.insert(sid);
    }

    /// Stop watching: nothing is received until Watch again.
    fn stop_watching(&mut self) {
        self.watched.clear();
    }

    /// `ViewChanged { Voice }`: a leave forgets everything watched; otherwise the tracks that
    /// went stop being watched, a join clears the notice, and an ending shows it.
    fn on_voice(&mut self, voice: &semaphore_core::model::VoiceView) {
        if voice.room.is_none() {
            self.watched.clear();
            *self.surface_demands.borrow_mut() = None;
        } else {
            let present: std::collections::BTreeSet<String> = voice
                .participants
                .iter()
                .flat_map(|person| [&person.camera, &person.screen_share])
                .flatten()
                .map(|track| track.track_sid.clone())
                .collect();
            self.watched.retain(|sid| present.contains(sid));
            // A join (or a call) replaces the notice.
            self.notice = None;
        }
        if voice.ended != self.ended_seen {
            self.ended_seen = voice.ended.clone();
            if let Some(ended) = &voice.ended {
                self.notice = Some(SlotNotice::ended(ended));
            }
        }
    }

    /// A DM join failed: the same notice a channel's failed join shows, with Retry.
    fn dm_join_failed(&mut self, dm_group_id: String, options: VoiceJoinOptions) {
        self.notice = Some(SlotNotice::join_failed(
            VoiceRoom::Dm { dm_group_id },
            options,
        ));
    }
}

impl AppRoot {
    pub(super) fn calls_on_core(&mut self, event: &CoreEvent, cx: &mut Context<Self>) {
        match event {
            CoreEvent::Sound { cue } => {
                if let Some(sounds) = self.inbox.sounds() {
                    sounds.cue(*cue, self.settings.get().voice.output_device.clone());
                }
            }
            CoreEvent::ViewChanged {
                view: ViewKey::IncomingCall,
            } => {
                self.arm_ring_timer(cx);
                cx.notify();
            }
            CoreEvent::ViewChanged {
                view: ViewKey::Soundboard { .. } | ViewKey::VoiceDiagnostics,
            } => self.refresh_stage(cx),
            CoreEvent::ViewChanged {
                view: ViewKey::Voice,
            } => self.call_slot_on_voice(cx),
            _ => {}
        }
    }

    /// Signed out: no ring timer, menu, card or panel of this session stays, and no ring sounds.
    pub(super) fn drop_calls(&mut self) {
        self.calls = Calls::default();
        if let Some(sounds) = self.inbox.sounds() {
            sounds.stop_ring();
        }
    }

    /// The banner, menu and panel over the shell.
    pub(super) fn calls_overlays(
        &self,
        window: &Window,
        cx: &mut Context<Self>,
    ) -> Vec<AnyElement> {
        let mut overlays = Vec::new();
        let Some(core) = self.core() else {
            return overlays;
        };
        let narrow = f32::from(window.viewport_size().width) < 600.;
        if let Some(call) = core.incoming_call() {
            overlays.push(self.incoming_banner(&call, narrow, cx));
        }
        if let Some((menu, _)) = &self.calls.menu {
            overlays.push(menu.clone().into_any_element());
        }
        if self.calls.debug.is_some() {
            overlays.push(self.debug_panel(narrow, cx));
        }
        overlays
    }

    // ---- The ring. ----

    /// One timer for the ring's expiry, by core's clock. See the module docs.
    fn arm_ring_timer(&mut self, cx: &mut Context<Self>) {
        let Some(core) = self.core() else {
            return;
        };
        let Some(call) = core.incoming_call() else {
            self.calls.ring_timer = None;
            self.calls.accepting = false;
            self.calls.incoming_error = None;
            return;
        };
        if self
            .calls
            .ring_timer
            .as_ref()
            .is_some_and(|(at, _)| *at == call.expires_at_ms)
        {
            return;
        }
        let now = self.config.clock.now_ms();
        let delay = Duration::from_millis(call.expires_at_ms.saturating_sub(now));
        let expires = call.expires_at_ms;
        let task = cx.spawn(async move |this, cx| {
            cx.background_executor().timer(delay).await;
            this.update(cx, |this, cx| this.ring_due(expires, cx)).ok();
        });
        self.calls.ring_timer = Some((expires, task));
    }

    fn ring_due(&mut self, expires: u64, cx: &mut Context<Self>) {
        let Some(core) = self.core() else {
            return;
        };
        core.expire_incoming_call();
        // Still ringing with this expiry: core's clock says it's early. Again shortly.
        if core
            .incoming_call()
            .is_some_and(|call| call.expires_at_ms == expires)
        {
            let task = cx.spawn(async move |this, cx| {
                cx.background_executor().timer(RETRY_EARLY).await;
                this.update(cx, |this, cx| this.ring_due(expires, cx)).ok();
            });
            self.calls.ring_timer = Some((expires, task));
        }
    }

    /// `touch`: a phone-width window, with the larger buttons.
    fn incoming_banner(
        &self,
        call: &IncomingCallView,
        touch: bool,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let root = cx.entity().downgrade();
        let decline = root.clone();
        let props = IncomingProps {
            is_group: call.is_group,
            accepting: self.calls.accepting,
            error: self.calls.incoming_error.clone(),
            touch,
        };
        let banner = incoming_call_banner(
            call,
            &props,
            IncomingActions {
                on_accept: Rc::new(move |_, cx| {
                    root.update(cx, |root, cx| root.accept_call(cx)).ok();
                }),
                on_decline: Rc::new(move |_, cx| {
                    decline
                        .update(cx, |root, cx| {
                            if let Some(core) = root.core() {
                                core.decline_incoming_call();
                            }
                            cx.notify();
                        })
                        .ok();
                }),
            },
            cx,
        );
        div()
            .absolute()
            .top_0()
            .left_0()
            .right_0()
            .occlude()
            .child(banner)
            .into_any_element()
    }

    /// Accept: join the ringing call and open its conversation.
    fn accept_call(&mut self, cx: &mut Context<Self>) {
        let (Some(core), Some(call)) = (self.core(), self.core().and_then(|c| c.incoming_call()))
        else {
            return;
        };
        if self.calls.accepting {
            return;
        }
        self.calls.accepting = true;
        self.calls.incoming_error = None;
        self.prepare_join();
        self.shell_navigate(
            Route::DirectMessage {
                dm_group_id: call.dm_group_id.clone(),
            },
            cx,
        );
        let joined =
            self.fire_and_report(Box::pin(async move { core.accept_incoming_call().await }));
        cx.spawn(async move |this, cx| {
            let result = joined.await;
            this.update(cx, |this, cx| {
                this.calls.accepting = false;
                if let Err(error) = result {
                    log::warn!("answering the call: {error}");
                    this.calls.incoming_error = Some(error);
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
        cx.notify();
    }

    /// Runs `work` on the core runtime and hands back its error as text.
    fn fire_and_report(
        &self,
        work: std::pin::Pin<
            Box<
                dyn std::future::Future<Output = Result<(), semaphore_core::platform::CoreError>>
                    + Send,
            >,
        >,
    ) -> impl std::future::Future<Output = Result<(), String>> + use<> {
        let (sender, receiver) = async_channel::bounded(1);
        if let Some(services) = &self.services {
            services.exec.fire(async move {
                let result = work.await.map_err(|error| error.to_string());
                let _ = sender.send(result).await;
            });
        }
        async move {
            receiver
                .recv()
                .await
                .unwrap_or_else(|_| Err("the app is shutting down".into()))
        }
    }

    // ---- Joining. ----

    /// Before any join: the voice settings and the volumes kept per user.
    pub(super) fn prepare_join(&mut self) {
        if let Some(voice) = &self.voice {
            voice.apply_settings(&self.settings.get().voice);
        }
        if let Some(core) = self.core() {
            for (user_id, percent) in &self.settings.get().user_volumes {
                core.set_participant_volume(user_id.clone(), u32::from(*percent));
            }
            for (user_id, percent) in &self.settings.get().screen_share_volumes {
                core.set_screen_share_volume(user_id.clone(), u32::from(*percent));
            }
        }
    }

    /// The DM header's call buttons: join this DM's call, the camera on after with `video`.
    pub(super) fn start_dm_call(
        &mut self,
        dm_group_id: String,
        video: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.start_dm_call_with(dm_group_id, video, None, window, cx);
    }

    /// A DM call, as `options` chose (`None`: the mute and deafen already chosen). A join that
    /// fails is the voice notice's, with Retry, and keeps the options it failed with.
    fn start_dm_call_with(
        &mut self,
        dm_group_id: String,
        video: bool,
        options: Option<VoiceJoinOptions>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(services) = &self.services else {
            return;
        };
        let (core, exec) = (services.core.clone(), services.exec.clone());
        let options = options.unwrap_or_else(|| self.join_options(&core));
        self.prepare_join();
        self.prejoin.joins += 1;
        let join = self.prejoin.joins;
        let joining = core;
        let failed_dm = dm_group_id.clone();
        exec.run(
            window,
            cx,
            async move {
                joining.join_dm_call_with(dm_group_id, options).await?;
                if video && let Err(error) = joining.set_camera(true).await {
                    // The call is up: only its camera failed, which is the stage's to say.
                    log::warn!("starting the DM call's camera: {error}");
                }
                Ok::<_, semaphore_core::platform::CoreError>(())
            },
            move |this, result, _, cx| {
                let Err(error) = result else {
                    return;
                };
                log::warn!("starting the DM call: {error}");
                // Another join since, a leave, or a call that's up anyway: not this one's to say.
                let idle = this
                    .core()
                    .is_none_or(|core| core.voice().status == VoiceStatus::Disconnected);
                if this.prejoin.joins != join || was_left(&error) || !idle {
                    return;
                }
                this.calls.dm_join_failed(failed_dm.clone(), options);
                cx.notify();
            },
        );
    }

    /// What a join from here starts with: the mute and deafen already chosen on the bar or the
    /// stage, captured before a failed join resets them.
    pub(super) fn join_options(&self, core: &semaphore_core::Core) -> VoiceJoinOptions {
        let voice = core.voice();
        VoiceJoinOptions {
            muted: voice.muted || voice.deafened,
            deafened: voice.deafened,
        }
    }

    // ---- The participant menu. ----

    pub(super) fn open_participant_menu(
        &mut self,
        identity: String,
        position: Point<Pixels>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(model) = self.participant_menu_model(&identity) else {
            return;
        };
        let menu = cx.new(|cx| ParticipantMenu::new(model, position, window, cx));
        let subscription = cx.subscribe_in(&menu, window, Self::on_participant_menu);
        self.calls.menu = Some((menu, subscription));
        cx.notify();
    }

    /// What the menu shows for `identity` now; `None` once they're not in the call.
    fn participant_menu_model(&self, identity: &str) -> Option<ParticipantMenuModel> {
        let core = self.core()?;
        let voice = core.voice();
        let participant = voice
            .participants
            .iter()
            .find(|p| p.identity == identity)
            .cloned()?;
        let channel = match &voice.room {
            Some(VoiceRoom::Channel { channel_id, .. }) => Some(channel_id.clone()),
            _ => None,
        };
        Some(ParticipantMenuModel {
            volume_percent: participant.volume_percent,
            screen_share_volume_percent: participant.screen_share_volume_percent,
            participant,
            caps: channel
                .clone()
                .map(|channel| core.voice_moderation_caps(channel))
                .unwrap_or_default(),
            in_channel: channel.is_some(),
        })
    }

    /// The call changed while the menu is open: it follows (their share's volume slider comes and
    /// goes with the share), and it closes once they left.
    pub(super) fn refresh_participant_menu(&mut self, cx: &mut Context<Self>) {
        let Some((menu, _)) = &self.calls.menu else {
            return;
        };
        let identity = menu.read(cx).model().participant.identity.clone();
        match self.participant_menu_model(&identity) {
            Some(model) => {
                if *menu.read(cx).model() != model {
                    menu.update(cx, |menu, cx| menu.set_model(model, cx));
                }
            }
            None => self.calls.menu = None,
        }
    }

    fn on_participant_menu(
        &mut self,
        _: &Entity<ParticipantMenu>,
        event: &ParticipantMenuEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(core) = self.core() else {
            return;
        };
        match event {
            ParticipantMenuEvent::ViewProfile { user_id } => {
                self.calls.menu = None;
                self.open_profile(user_id.clone(), window, cx);
            }
            ParticipantMenuEvent::SetVolume { identity, percent } => {
                core.set_participant_volume(identity.clone(), *percent);
                let (identity, percent) = (identity.clone(), (*percent).min(200) as u8);
                self.update_settings(|settings| {
                    if percent == 100 {
                        settings.user_volumes.remove(&identity);
                    } else {
                        settings.user_volumes.insert(identity, percent);
                    }
                });
            }
            ParticipantMenuEvent::SetScreenShareVolume { identity, percent } => {
                core.set_screen_share_volume(identity.clone(), *percent);
                let (identity, percent) = (identity.clone(), (*percent).min(200) as u8);
                self.update_settings(|settings| {
                    if percent == 100 {
                        settings.screen_share_volumes.remove(&identity);
                    } else {
                        settings.screen_share_volumes.insert(identity, percent);
                    }
                });
            }
            ParticipantMenuEvent::ServerMute { identity, mute } => {
                self.calls.menu = None;
                let (identity, mute) = (identity.clone(), *mute);
                if let Some(services) = &self.services {
                    services.exec.fire(async move {
                        if let Err(error) = core.server_mute(identity, mute).await {
                            log::warn!("server mute: {error}");
                        }
                    });
                }
            }
            ParticipantMenuEvent::Kick { user } => {
                // W5: the moderation kick dialog asks first; the menu closes with it.
                self.calls.menu = None;
                let Some(Some(community_id)) = core.voice().room.map(|room| match room {
                    VoiceRoom::Channel { community_id, .. } => community_id,
                    VoiceRoom::Dm { .. } => None,
                }) else {
                    return;
                };
                self.open_kick(community_id, user.clone(), window, cx);
            }
            ParticipantMenuEvent::Close => {
                self.calls.menu = None;
                cx.notify();
            }
        }
    }

    // ---- The soundboard. ----

    pub(super) fn toggle_soundboard(&mut self, open: bool, cx: &mut Context<Self>) {
        self.calls.soundboard_open = open;
        self.refresh_stage(cx);
    }

    /// What the bar's soundboard button shows: in a community's channel call only.
    pub(super) fn soundboard_bar(&self) -> SoundboardBar {
        let Some(core) = self.core() else {
            return SoundboardBar::default();
        };
        let voice = core.voice();
        match voice.room {
            Some(VoiceRoom::Channel {
                community_id: Some(community_id),
                ..
            }) if voice.status != VoiceStatus::Disconnected => SoundboardBar {
                view: Some(core.soundboard(community_id)),
                open: self.calls.soundboard_open,
            },
            _ => SoundboardBar::default(),
        }
    }

    /// Core's view of a moderator's mute of me, to the engine, which holds the mic muted against
    /// local changes while it lasts. On a change only.
    pub(super) fn apply_server_mute(&mut self, server_muted: bool) {
        if self.calls.server_muted == server_muted {
            return;
        }
        self.calls.server_muted = server_muted;
        if let Some(voice) = &self.voice {
            voice.engine.set_server_muted(server_muted);
        }
    }

    /// The call ended: the popover and the menu go with it.
    pub(super) fn call_ended(&mut self) {
        self.calls.soundboard_open = false;
        self.calls.menu = None;
    }

    // ---- The call slot (B11). ----

    /// The call ended (watched pictures go with it), or one ended on its own (the notice).
    fn call_slot_on_voice(&mut self, cx: &mut Context<Self>) {
        let Some(core) = self.core() else {
            return;
        };
        self.calls.on_voice(&core.voice());
        cx.notify();
    }

    /// A join from the pre-join or a voice room card failed: the notice, with Retry, joining the
    /// same way again.
    pub(super) fn show_join_failed(
        &mut self,
        room: VoiceRoom,
        options: VoiceJoinOptions,
        cx: &mut Context<Self>,
    ) {
        self.calls.notice = Some(SlotNotice::join_failed(room, options));
        cx.notify();
    }

    /// The notice's text, for the rig.
    pub fn voice_notice(&self) -> Option<String> {
        self.calls
            .notice
            .as_ref()
            .map(|notice| notice.model.title.clone())
    }

    /// The frames' count when Watch was last pressed, for the rig.
    pub fn watch_generation(&self) -> u64 {
        self.calls.watch_generation
    }

    /// The tracks the surface shows, for the rig.
    pub fn watched_tracks(&self) -> Vec<String> {
        self.calls.watched.iter().cloned().collect()
    }

    /// What the frame's call slot shows now. `stage_shown`: the call view is on screen, with its
    /// own bar.
    pub(super) fn call_slot(
        &mut self,
        stage_shown: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Option<CallSlot> {
        let model = self.stage_model();
        if stage_shown {
            // The stage asks for its own pictures; the surface asks again when it next shows.
            *self.calls.surface_demands.borrow_mut() = None;
            return None;
        }
        let Some(bar) = CallBarModel::from_stage(&model) else {
            let notice = self.calls.notice.clone()?;
            let root = cx.entity().downgrade();
            let retry = notice.retry().map(|retry| {
                let root = root.clone();
                Rc::new(move |window: &mut Window, cx: &mut App| {
                    let retry = retry.clone();
                    root.update(cx, |root, cx| root.retry_voice(retry, window, cx))
                        .ok();
                }) as Rc<dyn Fn(&mut Window, &mut App)>
            });
            let dismiss = Rc::new(move |_: &mut Window, cx: &mut App| {
                root.update(cx, |root, cx| {
                    root.calls.notice = None;
                    cx.notify();
                })
                .ok();
            });
            return Some(CallSlot::from(VoiceNoticeBar::new(
                notice.model,
                retry,
                dismiss,
            )));
        };
        let controller: Arc<dyn VoiceController> = self.voice.clone()?;
        let tiles = surface_tiles(&model.voice, &self.calls.watched);
        let joining = bar.phase == CallPhase::Connecting;
        let sharing = bar.sharing_screen;
        let mut stack = CallStack::new(CallBar::new(bar, controller.clone()));
        if !joining && shows_surface(&tiles, sharing) {
            self.ensure_video_redraw(window, cx);
            let root = cx.entity().downgrade();
            let (watch_root, stop_root) = (root.clone(), root.clone());
            let (open, share) = (controller.clone(), controller.clone());
            let last = self.calls.surface_demands.clone();
            let demands = controller.clone();
            stack = stack.surface(CallSurface::new(
                tiles,
                sharing,
                self.frames.clone(),
                SurfaceActions {
                    watch: Rc::new(move |sid, _, cx| {
                        let sid = sid.to_owned();
                        watch_root
                            .update(cx, |root, cx| {
                                let generation =
                                    root.frames.as_ref().map_or(0, |frames| frames.generation());
                                root.calls.watch(sid, generation);
                                cx.notify();
                            })
                            .ok();
                    }),
                    stop_watching: Rc::new(move |_, cx| {
                        stop_root
                            .update(cx, |root, cx| {
                                root.calls.stop_watching();
                                cx.notify();
                            })
                            .ok();
                    }),
                    stop_sharing: Rc::new(move |_, _| share.toggle_screen_share()),
                    open_call_view: Rc::new(move |_, _| open.open_call_view()),
                    demands: Rc::new(move |list: Vec<TileDemand>| {
                        let mut last = last.borrow_mut();
                        if last.as_ref() != Some(&list) {
                            demands.set_video_demands(list.clone());
                            *last = Some(list);
                        }
                    }),
                },
            ));
            // The stage asks again for its own when it next shows.
            if let Some(stage) = &self.stage {
                stage.update(cx, |stage, _| stage.forget_demands());
            }
        }
        Some(CallSlot::from(stack))
    }

    /// While the surface shows a watched picture, the frame draws again as its frames come in.
    fn ensure_video_redraw(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.calls.video_redraw.is_some() {
            return;
        }
        let Some(frames) = self.frames.clone() else {
            return;
        };
        let task = cx.spawn_in(window, async move |this, cx| {
            let mut seen = frames.generation();
            loop {
                let busy = this
                    .read_with(cx, |root, _| !root.calls.watched.is_empty())
                    .unwrap_or(false);
                let poll = if busy {
                    Duration::from_millis(8)
                } else {
                    Duration::from_millis(100)
                };
                cx.background_executor().timer(poll).await;
                let now = frames.generation();
                if now != seen {
                    seen = now;
                    let redrawn = this.update(cx, |root, cx| {
                        if !root.calls.watched.is_empty()
                            && let Some(shell) = &root.shell
                        {
                            shell.update(cx, |_, cx| cx.notify());
                        }
                    });
                    if redrawn.is_err() {
                        return;
                    }
                }
            }
        });
        self.calls.video_redraw = Some(task);
    }

    /// The notice's Retry: the same room again, muted and deafened as the join or the ended call
    /// had it (a mic the user turned off never comes back on by itself).
    fn retry_voice(&mut self, retry: RetryJoin, window: &mut Window, cx: &mut Context<Self>) {
        self.calls.notice = None;
        match retry {
            RetryJoin::Channel {
                channel_id,
                options,
            } => self.join_from_card_with(channel_id, options, window, cx),
            RetryJoin::Dm {
                dm_group_id,
                options,
            } => self.start_dm_call_with(dm_group_id, false, Some(options), window, cx),
        }
        cx.notify();
    }

    /// The call bar's room name (and the surface's See all): the call view, the room's route.
    pub(super) fn open_call_view(&mut self, cx: &mut Context<Self>) {
        let Some(core) = self.core() else {
            return;
        };
        let route = match core.voice().room {
            Some(VoiceRoom::Channel {
                channel_id,
                community_id: Some(community_id),
            }) => Route::Channel {
                community_id,
                channel_id,
            },
            Some(VoiceRoom::Dm { dm_group_id }) => Route::DirectMessage { dm_group_id },
            _ => return,
        };
        self.shell_navigate(route, cx);
    }

    // ---- The DM stage. ----

    /// A DM in its own call: the stage above the conversation, split as the web's `StageSplit`,
    /// with a handle to drag. `None` when this DM isn't the call.
    pub(super) fn dm_stage_split(
        root: &Entity<AppRoot>,
        dm_id: &str,
        conversation: AnyElement,
        cx: &mut App,
    ) -> Result<AnyElement, AnyElement> {
        let (stage, ratio, drag, live) = {
            let root = root.read(cx);
            let in_this_call = root.core().is_some_and(|core| {
                matches!(
                    core.voice().room,
                    Some(VoiceRoom::Dm { dm_group_id }) if dm_group_id == dm_id
                )
            });
            let Some(stage) = root.stage.clone().filter(|_| in_this_call) else {
                return Err(conversation);
            };
            let ratio = root
                .calls
                .dm_ratio
                .get()
                .or(root.settings.get().dm_stage_ratio)
                .unwrap_or(DM_STAGE_DEFAULT)
                .clamp(DM_STAGE_MIN, DM_STAGE_MAX);
            (
                stage,
                ratio,
                root.calls.dm_drag.clone(),
                root.calls.dm_ratio.clone(),
            )
        };
        let sem = cx.sem().clone();
        let bounds: Rc<Cell<Option<Bounds<Pixels>>>> = Rc::default();
        let measured = bounds.clone();
        let start = drag.clone();
        let (moving, ending) = (drag.clone(), drag);
        let (moved, ended) = (live.clone(), live);
        let saving = root.downgrade();
        Ok(div()
            .id("dm-stage-split")
            .test_support()
            .relative()
            .size_full()
            .flex()
            .flex_col()
            .child(
                canvas(move |b, _, _| measured.set(Some(b)), |_, _, _, _| {})
                    .absolute()
                    .size_full(),
            )
            .child(
                div()
                    .w_full()
                    .h(relative(ratio))
                    .min_h_0()
                    .flex_shrink_0()
                    // Toasts clear the composer at the pane's foot, not the stage's bar.
                    .child(semaphore_ui::kit::WithoutToastAnchor::new(stage)),
            )
            .child(
                div()
                    .id("dm-stage-handle")
                    .test_support()
                    .role(Role::Splitter)
                    .aria_label("Resize the call")
                    .w_full()
                    .h(px(6.))
                    .flex_shrink_0()
                    .cursor_row_resize()
                    .bg(sem.divider)
                    .hover(move |style| style.bg(sem.primary))
                    .on_mouse_down(MouseButton::Left, move |_, _, cx| {
                        if let Some(b) = bounds.get() {
                            start.set(Some((f32::from(b.top()), f32::from(b.size.height))));
                        }
                        cx.stop_propagation();
                    }),
            )
            .child(div().flex_1().min_h_0().child(conversation))
            .on_mouse_move(move |event, window, _| {
                if let Some((top, height)) = moving.get()
                    && height > 0.
                {
                    let ratio = ((f32::from(event.position.y) - top) / height)
                        .clamp(DM_STAGE_MIN, DM_STAGE_MAX);
                    moved.set(Some(ratio));
                    window.refresh();
                }
            })
            .on_mouse_up(MouseButton::Left, move |_, _, cx| {
                if ending.take().is_some()
                    && let Some(ratio) = ended.take()
                {
                    saving
                        .update(cx, |root, cx| {
                            root.update_settings(|settings| settings.dm_stage_ratio = Some(ratio));
                            cx.notify();
                        })
                        .ok();
                }
            })
            .into_any_element())
    }

    // ---- The debug panel. ----

    pub(super) fn toggle_voice_debug(&mut self, cx: &mut Context<Self>) {
        if self.calls.debug.take().is_some() {
            cx.notify();
            return;
        }
        if !matches!(
            self.core().map(|core| core.session()),
            Some(SessionState::SignedIn { .. })
        ) {
            return;
        }
        // While it's open: fresh stats every second.
        let task = cx.spawn(async move |this, cx| {
            loop {
                let core = this.update(cx, |this, _| this.core()).ok().flatten();
                let Some(core) = core else {
                    return;
                };
                let refreshed = this
                    .update(cx, |this, _| {
                        this.fire_and_report(Box::pin(async move {
                            core.refresh_voice_diagnostics().await;
                            Ok(())
                        }))
                    })
                    .ok();
                if let Some(refreshed) = refreshed {
                    let _ = refreshed.await;
                }
                if this.update(cx, |_, cx| cx.notify()).is_err() {
                    return;
                }
                cx.background_executor().timer(DEBUG_REFRESH).await;
            }
        });
        self.calls.debug = Some(task);
        cx.notify();
    }

    pub fn voice_debug_open(&self) -> bool {
        self.calls.debug.is_some()
    }

    fn debug_panel(&self, narrow: bool, cx: &mut Context<Self>) -> AnyElement {
        let Some(core) = self.core() else {
            return div().into_any_element();
        };
        let diagnostics = core.voice_diagnostics();
        let voice = core.voice();
        let (refresh, copy, close) = (core.clone(), core, cx.entity().downgrade());
        let exec = self.services.as_ref().map(|services| services.exec.clone());
        div()
            .absolute()
            .inset_0()
            .child(voice_debug_panel(
                &diagnostics,
                &voice,
                narrow,
                DebugActions {
                    on_refresh: Rc::new(move |_, _| {
                        if let Some(exec) = &exec {
                            let core = refresh.clone();
                            exec.fire(async move { core.refresh_voice_diagnostics().await });
                        }
                    }),
                    on_copy: Rc::new(move |_, cx| {
                        cx.write_to_clipboard(ClipboardItem::new_string(
                            copy.voice_diagnostics_report(),
                        ));
                    }),
                    on_close: Rc::new(move |_, cx| {
                        close
                            .update(cx, |root, cx| {
                                root.calls.debug = None;
                                cx.notify();
                            })
                            .ok();
                    }),
                },
                cx,
            ))
            .into_any_element()
    }

    /// The rig's view of the sounds: how often core asked for `cue`, and whether the ring loops.
    pub fn cue_played(&self, cue: semaphore_core::model::SoundCue) -> usize {
        self.inbox.sounds().map_or(0, |sounds| sounds.played(cue))
    }

    pub fn ringing(&self) -> bool {
        self.inbox.sounds().is_some_and(|sounds| sounds.ringing())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use semaphore_core::model::{ParticipantView, UserView, VideoTrackView, VoiceEnded, VoiceView};
    use std::prelude::rust_2024::test;

    fn channel_room() -> VoiceRoom {
        VoiceRoom::Channel {
            channel_id: "vc".into(),
            community_id: None,
        }
    }

    fn track(sid: &str) -> VideoTrackView {
        VideoTrackView {
            track_sid: sid.into(),
            width: 640,
            height: 480,
        }
    }

    fn person(id: &str, camera: Option<&str>, screen: Option<&str>) -> ParticipantView {
        ParticipantView {
            identity: id.into(),
            user: UserView {
                id: id.into(),
                username: id.into(),
                ..UserView::default()
            },
            camera: camera.map(track),
            screen_share: screen.map(track),
            ..ParticipantView::default()
        }
    }

    fn ended(options: VoiceJoinOptions) -> VoiceEnded {
        VoiceEnded {
            room: channel_room(),
            while_reconnecting: true,
            error: None,
            options,
        }
    }

    /// "Join muted" failed: Retry starts the call muted, not with the mic open.
    #[test]
    fn retry_after_a_failed_muted_join_joins_muted() {
        let options = VoiceJoinOptions {
            muted: true,
            deafened: false,
        };
        let notice = SlotNotice::join_failed(channel_room(), options);
        assert_eq!(
            notice.retry(),
            Some(RetryJoin::Channel {
                channel_id: "vc".into(),
                options,
            })
        );
    }

    /// Muted in a call that ended: Retry rejoins muted.
    #[test]
    fn retry_after_a_muted_call_ends_joins_muted() {
        let options = VoiceJoinOptions {
            muted: true,
            deafened: false,
        };
        let mut calls = Calls::default();
        calls.on_voice(&VoiceView {
            ended: Some(ended(options)),
            ..VoiceView::default()
        });
        assert_eq!(
            calls.notice.and_then(|notice| notice.retry()),
            Some(RetryJoin::Channel {
                channel_id: "vc".into(),
                options,
            })
        );
    }

    /// A DM join that fails says so with Retry, as a channel's does.
    #[test]
    fn a_failed_dm_join_shows_the_retry_notice() {
        let mut calls = Calls::default();
        calls.dm_join_failed("dm-1".into(), VoiceJoinOptions::default());
        let notice = calls.notice.expect("a notice");
        assert!(notice.model.retry);
        assert_eq!(
            notice.retry(),
            Some(RetryJoin::Dm {
                dm_group_id: "dm-1".into(),
                options: VoiceJoinOptions::default(),
            })
        );
    }

    /// Watch adds and counts frames from there; Stop watching and a leave clear the set.
    #[test]
    fn watch_adds_and_stop_watching_and_a_leave_clear_the_watched_set() {
        let mut calls = Calls::default();
        calls.watch("s1".into(), 4);
        calls.watch("s2".into(), 9);
        assert_eq!(
            calls.watched.iter().cloned().collect::<Vec<_>>(),
            ["s1", "s2"]
        );
        assert_eq!(calls.watch_generation, 9);
        calls.stop_watching();
        assert!(calls.watched.is_empty());
        calls.watch("s1".into(), 1);
        calls.on_voice(&VoiceView::default());
        assert!(calls.watched.is_empty(), "a leave forgets every picture");
        assert!(calls.surface_demands.borrow().is_none());
    }

    /// A track that goes stops being watched, so nothing is received for it.
    #[test]
    fn a_voice_change_drops_the_tracks_that_went() {
        let mut calls = Calls::default();
        calls.watch("cam".into(), 0);
        calls.watch("gone".into(), 0);
        calls.on_voice(&VoiceView {
            room: Some(channel_room()),
            participants: vec![person("pri", Some("cam"), None)],
            ..VoiceView::default()
        });
        assert_eq!(calls.watched.iter().cloned().collect::<Vec<_>>(), ["cam"]);
    }

    /// The surface is handed watched flags for exactly the watched tracks: its demands are those
    /// tiles and no others.
    #[test]
    fn demands_cover_the_watched_tiles_only() {
        let mut calls = Calls::default();
        calls.watch("cam".into(), 0);
        let voice = VoiceView {
            room: Some(channel_room()),
            participants: vec![person("pri", Some("cam"), Some("screen"))],
            ..VoiceView::default()
        };
        let tiles = surface_tiles(&voice, &calls.watched);
        let demanded: Vec<&str> = tiles
            .iter()
            .filter(|tile| tile.watched)
            .map(|tile| tile.id.as_str())
            .collect();
        assert_eq!(demanded, ["cam"], "the screen is offered, not received");
    }
}
