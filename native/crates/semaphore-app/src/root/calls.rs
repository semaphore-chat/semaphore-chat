//! W4: calls in the app: the incoming call banner and its ring timer, DM call controls and the DM
//! stage, the participant menu (volume, server mute, kick), the soundboard, the float card and the
//! voice debug panel (Ctrl+Shift+D).
//!
//! - **The ring's timer.** Core has no timers: a ring carries `expires_at_ms`, and this arms a
//!   GPUI timer for it (by core's clock), calling `Core::expire_incoming_call` when it's due. A
//!   newer ring replaces the timer; no ring drops it. Signing out drops it with `Calls`.
//! - **Sounds.** Core decides the cues (`CoreEvent::Sound`); `Sounds` plays them, the ring on a
//!   loop until core stops it.
//! - **What's kept:** the float card's placement per `viewport_bucket` and the DM stage's split, in
//!   the settings; volumes per user (`Settings::user_volumes`), applied on every join.

use super::AppRoot;
use crate::settings::StoredPlacement;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::CoreEvent;
use semaphore_core::model::{IncomingCallView, SessionState, ViewKey, VoiceRoom, VoiceStatus};
use semaphore_ui::nav::Route;
use semaphore_ui::theme::SemTheme as _;
use semaphore_ui::voice::dock::{PipAnchor, PipPlacement, Point2, Size2, viewport_bucket};
use semaphore_ui::voice::{
    DebugActions, FloatCard, FloatEvent, IncomingActions, IncomingProps, ParticipantMenu,
    ParticipantMenuEvent, ParticipantMenuModel, SoundboardBar, VoiceController,
    incoming_call_banner, voice_debug_panel,
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
    /// Made on the session's first frame with a window; `float_bucket` is the bucket its placement
    /// is from.
    float: Option<(Entity<FloatCard>, Subscription)>,
    float_bucket: Option<&'static str>,
    debug: Option<Task<()>>,
    /// The DM stage's drag, while it runs: the column's top and height.
    dm_drag: Rc<Cell<Option<(f32, f32)>>>,
    /// The DM stage's split while dragging, saved on release.
    dm_ratio: Rc<Cell<Option<f32>>>,
    /// The server mute about me last handed to the engine.
    server_muted: bool,
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
        }
    }

    /// The DM header's call buttons: join this DM's call, the camera on after with `video`.
    pub(super) fn start_dm_call(
        &mut self,
        dm_group_id: String,
        video: bool,
        cx: &mut Context<Self>,
    ) {
        let Some(core) = self.core() else {
            return;
        };
        self.prepare_join();
        let joined = self.fire_and_report(Box::pin(async move {
            core.join_dm_call(dm_group_id).await?;
            if video {
                core.set_camera(true).await?;
            }
            Ok(())
        }));
        cx.spawn(async move |_, _| {
            if let Err(error) = joined.await {
                log::warn!("starting the DM call: {error}");
            }
        })
        .detach();
    }

    // ---- The participant menu. ----

    pub(super) fn open_participant_menu(
        &mut self,
        identity: String,
        position: Point<Pixels>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(core) = self.core() else {
            return;
        };
        let voice = core.voice();
        let Some(participant) = voice
            .participants
            .iter()
            .find(|p| p.identity == identity)
            .cloned()
        else {
            return;
        };
        let channel = match &voice.room {
            Some(VoiceRoom::Channel { channel_id, .. }) => Some(channel_id.clone()),
            _ => None,
        };
        let model = ParticipantMenuModel {
            volume_percent: participant.volume_percent,
            participant,
            caps: channel
                .clone()
                .map(|channel| core.voice_moderation_caps(channel))
                .unwrap_or_default(),
            in_channel: channel.is_some(),
        };
        let menu = cx.new(|cx| ParticipantMenu::new(model, position, window, cx));
        let subscription = cx.subscribe_in(&menu, window, Self::on_participant_menu);
        self.calls.menu = Some((menu, subscription));
        cx.notify();
    }

    fn on_participant_menu(
        &mut self,
        menu: &Entity<ParticipantMenu>,
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
            ParticipantMenuEvent::Kick { user_id, reason } => {
                let Some(Some(community_id)) = core.voice().room.map(|room| match room {
                    VoiceRoom::Channel { community_id, .. } => community_id,
                    VoiceRoom::Dm { .. } => None,
                }) else {
                    return;
                };
                menu.update(cx, |menu, cx| menu.set_kick_busy(true, cx));
                let (user_id, reason) = (user_id.clone(), reason.clone());
                let kicked = self.fire_and_report(Box::pin(async move {
                    core.kick_member(community_id, user_id, reason).await
                }));
                let menu = menu.downgrade();
                cx.spawn(async move |this, cx| {
                    let result = kicked.await;
                    this.update(cx, |this, cx| match result {
                        Ok(()) => {
                            this.calls.menu = None;
                            cx.notify();
                        }
                        Err(error) => {
                            menu.update(cx, |menu, cx| {
                                menu.set_kick_busy(false, cx);
                                menu.set_kick_error(Some(error), cx);
                            })
                            .ok();
                        }
                    })
                    .ok();
                })
                .detach();
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

    // ---- The float card. ----

    /// The call over the middle column while its stage isn't shown, on wide windows.
    pub(super) fn float_card(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        let model = self.stage_model();
        model.voice.room.as_ref()?;
        let width = f32::from(window.viewport_size().width);
        if width < 600. {
            return None;
        }
        let bucket = viewport_bucket(width);
        if self.calls.float.is_none() {
            let frames = self.frames.clone()?;
            let controller: Arc<dyn VoiceController> = self.voice.clone()?;
            let placement = self.stored_placement(bucket);
            let card = cx
                .new(|cx| FloatCard::new(model.clone(), frames, controller, placement, window, cx));
            let subscription = cx.subscribe_in(&card, window, Self::on_float);
            self.calls.float = Some((card, subscription));
            self.calls.float_bucket = Some(bucket);
        }
        let (card, _) = self.calls.float.as_ref()?;
        let card = card.clone();
        if self.calls.float_bucket != Some(bucket) {
            self.calls.float_bucket = Some(bucket);
            let placement = self.stored_placement(bucket);
            card.update(cx, |card, cx| card.set_placement(placement, cx));
        }
        card.update(cx, |card, cx| card.set_model(model, cx));
        Some(card.into_any_element())
    }

    fn stored_placement(&self, bucket: &str) -> PipPlacement {
        self.settings
            .get()
            .float_placements
            .get(bucket)
            .and_then(placement_from_stored)
            .unwrap_or_default()
    }

    fn on_float(
        &mut self,
        _: &Entity<FloatCard>,
        event: &FloatEvent,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        match event {
            FloatEvent::PlacementChanged(placement) => {
                let Some(bucket) = self.calls.float_bucket else {
                    return;
                };
                let stored = stored_from_placement(placement);
                self.update_settings(|settings| {
                    settings.float_placements.insert(bucket.to_owned(), stored);
                });
            }
            FloatEvent::OpenCall => {
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
        }
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
                    .child(stage),
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

/// A saved placement, or `None` when it doesn't parse or isn't usable.
pub fn placement_from_stored(stored: &StoredPlacement) -> Option<PipPlacement> {
    let placement = PipPlacement {
        anchor: PipAnchor::parse(&stored.anchor)?,
        offset: Point2 {
            x: stored.offset_x,
            y: stored.offset_y,
        },
        size: Size2 {
            width: stored.width,
            height: stored.height,
        },
        docked: stored.docked,
        collapsed: stored.collapsed,
    };
    placement.is_valid().then_some(placement)
}

pub fn stored_from_placement(placement: &PipPlacement) -> StoredPlacement {
    StoredPlacement {
        anchor: placement.anchor.name().to_owned(),
        offset_x: placement.offset.x,
        offset_y: placement.offset.y,
        width: placement.size.width,
        height: placement.size.height,
        docked: placement.docked,
        collapsed: placement.collapsed,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::prelude::rust_2024::test;

    #[test]
    fn a_placement_round_trips_through_the_settings_and_a_bad_one_is_dropped() {
        let placement = PipPlacement {
            anchor: PipAnchor::TopLeft,
            offset: Point2 { x: 12., y: 30. },
            size: Size2 {
                width: 400.,
                height: 300.,
            },
            docked: false,
            collapsed: true,
        };
        let stored = stored_from_placement(&placement);
        assert_eq!(placement_from_stored(&stored), Some(placement));
        let json = serde_json::to_string(&stored).unwrap();
        let back: StoredPlacement = serde_json::from_str(&json).unwrap();
        assert_eq!(placement_from_stored(&back), Some(placement));
        let mut bad = stored.clone();
        bad.anchor = "middle".into();
        assert_eq!(placement_from_stored(&bad), None);
        let mut nan = stored;
        nan.width = f32::NAN;
        assert_eq!(placement_from_stored(&nan), None);
    }
}
