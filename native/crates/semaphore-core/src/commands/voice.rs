//! Voice calls: join, leave, mute, deafen, tokens, presence and the media engine's reports.

use crate::backend::BackendError;
use crate::cache::keys;
use crate::client::{Core, Effect, State};
use crate::model::{
    JoinFailure, JoinFailureClass, LocalMediaView, LocalShare, ParticipantView, ScreenShareRequest,
    UserView, VideoDemand, ViewKey, VoiceModerationCaps, VoiceRoom, VoiceStatus, VoiceView,
};
use crate::platform::CoreError;
use crate::resync::unavailable;
use semaphore_wire::enums::RbacAction;
use semaphore_wire::types as wire;

/// How a join ended: still the one wanted, or replaced (or left) while it ran, with what it had
/// done by then.
enum Joined {
    Current,
    Stale { connected: bool, announced: bool },
}

/// How a failed REST call during a join is filed (the backend's `VoiceJoinErrorClass`).
fn failure_class(error: &BackendError) -> JoinFailureClass {
    match error.status {
        0 => JoinFailureClass::ServerUnreachable,
        401 => JoinFailureClass::Session,
        403 => JoinFailureClass::Permission,
        404 => JoinFailureClass::NotFound,
        500.. => JoinFailureClass::ServerError,
        _ => JoinFailureClass::Unknown,
    }
}

/// A LiveKit address's host, for the debug panel: never its path or query.
fn url_host(url: &str) -> Option<String> {
    let rest = url.split_once("://").map_or(url, |(_, rest)| rest);
    let authority = rest.split(['/', '?', '#']).next()?;
    let host = authority.rsplit('@').next()?;
    let host = if host.starts_with('[') {
        host.split(']').next().map(|h| format!("{h}]"))?
    } else {
        host.split(':').next()?.to_owned()
    };
    (!host.is_empty()).then_some(host)
}

fn room_label(room: &VoiceRoom) -> String {
    match room {
        VoiceRoom::Channel { channel_id, .. } => format!("channel {channel_id}"),
        VoiceRoom::Dm { dm_group_id } => format!("DM {dm_group_id}"),
    }
}

fn voice_token_request(me: &UserView, channel_id: &str) -> wire::CreateTokenDto {
    wire::CreateTokenDto {
        identity: me.id.clone(),
        name: Some(me.username.clone()),
        room_id: channel_id.to_owned(),
        ttl: None,
    }
}

/// A call a camera or share can start in: one that's up, or rejoining (the engine republishes).
fn in_call(status: VoiceStatus) -> bool {
    matches!(status, VoiceStatus::Connected | VoiceStatus::Reconnecting)
}

fn failed(error: &CoreError) -> LocalShare {
    LocalShare::Failed {
        message: error.to_string(),
    }
}

fn left_while_starting() -> CoreError {
    CoreError::Failed {
        message: "the call ended while it was starting".into(),
    }
}

/// The engine was sending it, isn't now, and core still thinks it's on.
fn ended(core: &LocalShare, before: &LocalShare, now: &LocalShare) -> bool {
    *core == LocalShare::On && *before == LocalShare::On && *now != LocalShare::On
}

impl Core {
    pub async fn join_voice(&self, channel_id: String) -> Result<(), CoreError> {
        self.join_room(VoiceRoom::Channel {
            channel_id,
            community_id: None,
        })
        .await
    }

    /// Joins a channel's call or a DM's (W4), leaving any other call first. A channel's
    /// `community_id` is filled from the cached channel lists.
    pub(crate) async fn join_room(&self, room: VoiceRoom) -> Result<(), CoreError> {
        let services = self.services().ok_or_else(|| unavailable("voice"))?.clone();
        let media = services.media.clone().ok_or_else(|| unavailable("voice"))?;
        let me = self
            .read(|state| state.me.clone())
            .ok_or_else(|| unavailable("voice while signed out"))?;
        let started = self.now_ms();
        let (muted, deafened, call, room) = self.write(|state, now| {
            let room = match room {
                VoiceRoom::Channel { channel_id, .. } => VoiceRoom::Channel {
                    community_id: state.community_of_channel(&channel_id),
                    channel_id,
                },
                dm => dm,
            };
            // Leaving another channel call that's up: the server hears of it. A DM call has no
            // presence leave, and a join still running leaves its own when it finds it's stale.
            if let Some(VoiceRoom::Channel { channel_id, .. }) = &state.voice.room
                && channel_id != room.id()
                && in_call(state.voice.status)
            {
                state.push_effect(Effect::LeavePresence(channel_id.clone()));
            }
            state.voice.status = VoiceStatus::Connecting;
            state.voice.channel_id = match &room {
                VoiceRoom::Channel { channel_id, .. } => Some(channel_id.clone()),
                VoiceRoom::Dm { .. } => None,
            };
            state.voice.room = Some(room.clone());
            state.voice.reconnect_attempt = None;
            state.voice.error = None;
            // A camera or share belongs to one call.
            state.voice.local = LocalMediaView::default();
            state.media = None;
            state.call += 1;
            state.call_ended_early = None;
            state.view_changed(ViewKey::Voice);
            state.ensure_query(State::room_presence_key(&room));
            state.w4_log(now, format!("joining {}", room_label(&room)));
            (state.voice.muted, state.voice.deafened, state.call, room)
        });
        // The engine remembers these across calls, and what this call starts with is what's shown.
        // Deafen first: undeafening restores a mute this then overrides.
        media.set_deafened(deafened);
        media.set_muted(muted);
        let fail = |error: BackendError| (failure_class(&error), self.backend_failed(error));
        // Whether this join is still the one the user wants: checked after every wait, so a join
        // replaced while it waited neither connects, nor announces itself, nor rings a DM.
        let current =
            || self.read(|state| state.call == call && state.voice.room.as_ref() == Some(&room));
        let stale = |connected: bool, announced: bool| {
            Ok::<_, (JoinFailureClass, CoreError)>(Joined::Stale {
                connected,
                announced,
            })
        };
        let joined = async {
            let info = services
                .backend
                .livekit_controller_get_connection_info()
                .await
                .map_err(fail)?;
            if !current() {
                return stale(false, false);
            }
            let request = voice_token_request(&me, room.id());
            let token = match &room {
                VoiceRoom::Channel { .. } => {
                    services
                        .backend
                        .livekit_controller_generate_token(request)
                        .await
                }
                VoiceRoom::Dm { .. } => {
                    services
                        .backend
                        .livekit_controller_generate_dm_token(request)
                        .await
                }
            }
            .map_err(fail)?;
            let url = token.url.or(info.url).ok_or_else(|| {
                (
                    JoinFailureClass::ServerError,
                    CoreError::Failed {
                        message: "the server gave no LiveKit address".into(),
                    },
                )
            })?;
            let still = self.write(|state, _| {
                let still = state.call == call && state.voice.room.as_ref() == Some(&room);
                if still {
                    state.w4.diagnostics.server_host = url_host(&url);
                    state.w4_platform.engine_call = call;
                }
                still
            });
            if !still {
                return stale(false, false);
            }
            media
                .connect(url, token.token, call)
                .await
                .map_err(|error| (JoinFailureClass::MediaUnreachable, error))?;
            if !current() {
                return stale(true, false);
            }
            match &room {
                VoiceRoom::Channel { channel_id, .. } => {
                    services
                        .backend
                        .voice_presence_controller_join_presence(channel_id.clone())
                        .await
                        .map_err(fail)?;
                    if !current() {
                        return stale(true, true);
                    }
                }
                // LiveKit's webhook lists us too, so a failure here only waits for it.
                VoiceRoom::Dm { dm_group_id } => {
                    if let Err(error) = services
                        .backend
                        .dm_voice_presence_controller_refresh_dm_presence(dm_group_id.clone())
                        .await
                    {
                        log::warn!("announcing DM call presence failed: {error}");
                    }
                    if !current() {
                        return stale(true, false);
                    }
                }
            }
            Ok(Joined::Current)
        }
        .await;
        let leave_presence = |state: &mut crate::client::State| {
            if let VoiceRoom::Channel { channel_id, .. } = &room {
                state.push_effect(Effect::LeavePresence(channel_id.clone()));
            }
        };
        let left = || CoreError::Failed {
            message: "the call was left while joining".into(),
        };
        let (result, disconnect) = self.write(|state, now| {
            let is_current = state.call == call && state.voice.room.as_ref() == Some(&room);
            let joined = match joined {
                Err((class, error)) if !is_current => {
                    // Replaced while it ran: its failure is nobody's.
                    log::info!("a replaced join failed ({class:?}): {error}");
                    return (Err(error), false);
                }
                Err((class, error)) => {
                    state.w4.diagnostics.last_failure = Some(JoinFailure {
                        class,
                        message: error.to_string(),
                        duration_ms: now.saturating_sub(started),
                        at_ms: now,
                    });
                    state.w4_log(now, format!("join failed ({class:?}): {error}"));
                    state.voice = VoiceView::default();
                    state.media = None;
                    state.view_changed(ViewKey::Voice);
                    return (Err(error), false);
                }
                Ok(joined) => joined,
            };
            if let Joined::Stale {
                connected,
                announced,
            } = joined
            {
                // The engine is this join's only while no newer join has connected it: then it
                // leaves the room. A newer join that hasn't connected yet will itself.
                let disconnect = connected && state.w4_platform.engine_call == call;
                // Announced in a channel nobody is in now: the server hears it's left, unless the
                // join that replaced this one is in that same channel.
                let same_room = state
                    .voice
                    .room
                    .as_ref()
                    .is_some_and(|now_in| now_in.id() == room.id());
                if announced && state.me.is_some() && !same_room {
                    leave_presence(state);
                }
                return (Err(left()), disconnect);
            }
            if !is_current {
                return (Err(left()), false);
            }
            let ended = state.call_ended_early.take();
            match ended {
                None => {
                    state.voice.status = VoiceStatus::Connected;
                    state.view_changed(ViewKey::Voice);
                    state.w4_log(now, "connected");
                    // As the web does after a join (`voiceActions.ts`): the roster read at the
                    // start may predate us, and our own join event may not come.
                    state.invalidate(&State::room_presence_key(&room));
                    (Ok(()), false)
                }
                // The engine connected and dropped again before this finished. The server has heard
                // of the join, so it hears of the leave too.
                Some(error) => {
                    state.voice = VoiceView {
                        error: error.clone(),
                        ..VoiceView::default()
                    };
                    state.media = None;
                    leave_presence(state);
                    state.view_changed(ViewKey::Voice);
                    let message = error.unwrap_or_else(|| "the call ended as it started".into());
                    (Err(CoreError::Failed { message }), false)
                }
            }
        });
        if disconnect {
            media.disconnect().await;
        }
        result
    }

    pub async fn leave_voice(&self) -> Result<(), CoreError> {
        let services = self.services().ok_or_else(|| unavailable("voice"))?.clone();
        let channel_id = self.write(|state, _| {
            let channel_id = state.voice.channel_id.take();
            state.voice = VoiceView::default();
            state.media = None;
            state.view_changed(ViewKey::Voice);
            channel_id
        });
        if let Some(media) = &services.media {
            media.disconnect().await;
        }
        if let Some(channel_id) = channel_id {
            services
                .backend
                .voice_presence_controller_leave_presence(channel_id)
                .await
                .map_err(|error| self.backend_failed(error))?;
        }
        Ok(())
    }

    /// Refused while a moderator has me server-muted (W4): only they can lift it.
    pub async fn set_muted(&self, muted: bool) -> Result<(), CoreError> {
        if !muted && self.read(|state| state.me_server_muted()) {
            return Err(CoreError::Failed {
                message: "A moderator muted you in this channel".into(),
            });
        }
        self.write(|state, _| {
            state.voice.muted = muted;
            // Shown now, not when the engine's report comes back.
            if let Some(media) = &mut state.media {
                media.muted = muted;
            }
            state.view_changed(ViewKey::Voice);
        });
        if let Some(media) = self.services().and_then(|services| services.media.as_ref()) {
            media.set_muted(muted);
        }
        Ok(())
    }

    pub async fn set_deafened(&self, deafened: bool) -> Result<(), CoreError> {
        let channel_id = self.write(|state, _| {
            state.voice.deafened = deafened;
            if let Some(media) = &mut state.media {
                media.deafened = deafened;
            }
            state.view_changed(ViewKey::Voice);
            state.voice.channel_id.clone()
        });
        if let Some(media) = self.services().and_then(|services| services.media.as_ref()) {
            media.set_deafened(deafened);
        }
        if let (Some(channel_id), Some(services)) = (channel_id, self.services()) {
            let body = wire::UpdateDeafenStateDto {
                is_deafened: deafened,
            };
            services
                .backend
                .voice_presence_controller_update_deafen_state(channel_id, body)
                .await
                .map_err(|error| self.backend_failed(error))?;
        }
        Ok(())
    }

    /// Sends the camera, or stops it. Only during a call. `local.camera` shows `Starting` at once,
    /// then `On`, or `Failed` with why, which asking again retries.
    pub async fn set_camera(&self, on: bool) -> Result<(), CoreError> {
        let media = self
            .services()
            .and_then(|services| services.media.clone())
            .ok_or_else(|| unavailable("camera"))?;
        let ask = self.write(|state, _| {
            if !in_call(state.voice.status) {
                return None;
            }
            state.camera_ask += 1;
            state.voice.local.camera = if on {
                LocalShare::Starting
            } else {
                LocalShare::Off
            };
            state.view_changed(ViewKey::Voice);
            Some((state.call, state.camera_ask))
        });
        let (call, ask) = ask.ok_or_else(|| unavailable("the camera outside a call"))?;
        let result = media.set_camera(on).await;
        self.write(|state, _| {
            if state.call != call || !in_call(state.voice.status) {
                return Err(left_while_starting());
            }
            if state.camera_ask == ask {
                state.voice.local.camera = match (&result, on) {
                    (Ok(()), true) => LocalShare::On,
                    (Ok(()), false) => LocalShare::Off,
                    (Err(error), _) => failed(error),
                };
                state.view_changed(ViewKey::Voice);
            }
            result.clone()
        })
    }

    /// Starts sharing a screen or window, replacing any share. Only during a call. `local.screen`
    /// shows `Starting` while the picker is open, then `On`, or `Failed` with why (a cancelled
    /// picker included), which asking again retries. With `audio`, `local.screen_audio` says whether
    /// the system audio started too; the screen is shared either way.
    pub async fn start_screen_share(&self, request: ScreenShareRequest) -> Result<(), CoreError> {
        let media = self
            .services()
            .and_then(|services| services.media.clone())
            .ok_or_else(|| unavailable("screen share"))?;
        let audio = request.audio;
        let ask = self.write(|state, _| {
            if !in_call(state.voice.status) {
                return None;
            }
            state.screen_ask += 1;
            state.voice.local.screen = LocalShare::Starting;
            state.voice.local.screen_audio = if audio {
                LocalShare::Starting
            } else {
                LocalShare::Off
            };
            state.view_changed(ViewKey::Voice);
            Some((state.call, state.screen_ask))
        });
        let (call, ask) = ask.ok_or_else(|| unavailable("a screen share outside a call"))?;
        let result = media.start_screen_share(request).await;
        self.write(|state, _| {
            if state.call != call || !in_call(state.voice.status) {
                return Err(left_while_starting());
            }
            if state.screen_ask == ask {
                let local = &mut state.voice.local;
                match &result {
                    Ok(started) => {
                        local.screen = LocalShare::On;
                        local.screen_audio = match &started.audio {
                            None => LocalShare::Off,
                            Some(Ok(())) => LocalShare::On,
                            Some(Err(message)) => LocalShare::Failed {
                                message: message.clone(),
                            },
                        };
                    }
                    Err(error) => {
                        local.screen = failed(error);
                        local.screen_audio = LocalShare::Off;
                    }
                }
                state.view_changed(ViewKey::Voice);
            }
            result.clone().map(|_| ())
        })
    }

    /// Stops the screen share and its audio. Does nothing when there's none.
    pub async fn stop_screen_share(&self) -> Result<(), CoreError> {
        self.write(|state, _| {
            state.screen_ask += 1;
            state.voice.local.screen = LocalShare::Off;
            state.voice.local.screen_audio = LocalShare::Off;
            state.view_changed(ViewKey::Voice);
        });
        if let Some(media) = self.services().and_then(|services| services.media.as_ref()) {
            media.stop_screen_share().await;
        }
        Ok(())
    }

    /// Which video tiles are on screen. Goes straight to the media engine, which chooses layers.
    pub fn set_video_demands(&self, demands: Vec<VideoDemand>) {
        if let Some(media) = self.services().and_then(|services| services.media.as_ref()) {
            media.set_video_demands(demands);
        }
    }

    /// A new token for the call in progress, for the engine to rejoin with. The one it connected with
    /// may have expired by then.
    pub async fn voice_token(&self) -> Result<String, CoreError> {
        let services = self.services().ok_or_else(|| unavailable("voice"))?;
        let (me, room) = self.read(|state| (state.me.clone(), state.voice.room.clone()));
        let (Some(me), Some(room)) = (me, room) else {
            return Err(unavailable("a voice token outside a call"));
        };
        let request = voice_token_request(&me, room.id());
        let token = match room {
            VoiceRoom::Channel { .. } => {
                services
                    .backend
                    .livekit_controller_generate_token(request)
                    .await
            }
            VoiceRoom::Dm { .. } => {
                services
                    .backend
                    .livekit_controller_generate_dm_token(request)
                    .await
            }
        }
        .map_err(|error| self.backend_failed(error))?;
        Ok(token.token)
    }

    /// Keeps this client on the channel's roster. The server forgets it 90 s after the last one, so a
    /// host calls this about every 30 s, as the web's heartbeat does. Does nothing unless connected:
    /// a dead room must not keep claiming to be there. A failure is logged, for the next to retry, and
    /// a refresh after expiry re-registers, so nothing else is needed after a rejoin.
    pub async fn refresh_voice_presence(&self) {
        let room = self.read(|state| {
            state
                .voice
                .room
                .clone()
                .filter(|_| state.voice.status == VoiceStatus::Connected)
        });
        let (Some(room), Some(services)) = (room, self.services()) else {
            return;
        };
        let refreshed = match room {
            VoiceRoom::Channel { channel_id, .. } => services
                .backend
                .voice_presence_controller_refresh_presence(channel_id)
                .await
                .map(|_| ()),
            VoiceRoom::Dm { dm_group_id } => services
                .backend
                .dm_voice_presence_controller_refresh_dm_presence(dm_group_id)
                .await
                .map(|_| ()),
        };
        if let Err(error) = refreshed {
            log::warn!("refreshing voice presence failed: {error}");
        }
    }

    /// The media engine hands what it sees here, whenever it changes, with the number of the
    /// `connect` it belongs to. Not part of a UI's surface.
    ///
    /// A report carrying another call's number is ignored: it is from a call that's over. A
    /// `Disconnected` carrying this call's number ends it, whether or not core saw it connect: the
    /// engine's reports coalesce, so a call that connects and drops between two of them shows up as
    /// a `Disconnected` alone.
    pub fn ingest_media(&self, call: u64, media: VoiceView) {
        self.write(|state, _| {
            // Too late for a call that's over, or from some other call.
            if call != state.call
                || state.voice.status == VoiceStatus::Disconnected
                || state.media.as_ref() == Some(&media)
            {
                return;
            }
            match (media.status, state.voice.status) {
                // Still joining: `join_voice` finishes the job when `connect` returns.
                (VoiceStatus::Disconnected, VoiceStatus::Connecting) => {
                    state.call_ended_early = Some(media.error);
                    return;
                }
                (VoiceStatus::Disconnected, _) => {
                    let channel_id = state.voice.channel_id.take();
                    state.voice = VoiceView {
                        error: media.error,
                        ..VoiceView::default()
                    };
                    state.media = None;
                    if let Some(channel_id) = channel_id {
                        state.push_effect(Effect::LeavePresence(channel_id));
                    }
                    state.view_changed(ViewKey::Voice);
                    return;
                }
                (
                    VoiceStatus::Connected | VoiceStatus::Reconnecting,
                    VoiceStatus::Connected | VoiceStatus::Reconnecting,
                ) => {
                    state.voice.status = media.status;
                }
                _ => {}
            }
            // A share the engine was sending and no longer is ended on its own: the shared window
            // closed, the system's "stop sharing". Only an `On` it reported counts, so a report from
            // before a start finished doesn't turn the start off.
            let before = state.media.as_ref().map(|media| media.local.clone());
            if let Some(before) = before {
                let local = &mut state.voice.local;
                if ended(&local.camera, &before.camera, &media.local.camera) {
                    local.camera = media.local.camera.clone();
                }
                if ended(&local.screen, &before.screen, &media.local.screen) {
                    local.screen = media.local.screen.clone();
                    local.screen_audio = LocalShare::Off;
                }
            }
            let sound_before = state
                .media
                .as_ref()
                .and_then(|media| media.local.soundboard.clone());
            let sound_now = media.local.soundboard.clone();
            state.media = Some(media);
            state.view_changed(ViewKey::Voice);
            // The soundboard's `playing` follows the engine's sound: tell its view.
            if sound_before != sound_now
                && let Some(VoiceRoom::Channel {
                    community_id: Some(community_id),
                    ..
                }) = state.voice.room.clone()
            {
                state.view_changed(ViewKey::Soundboard { community_id });
            }
        });
    }

    /// W4: a moderator's server mute of someone in the channel call I'm in, or lifting it. Lifting
    /// gives their mic back without turning it on. Refused by the server for someone I don't
    /// outrank, which a client can't tell beforehand (#663); its message is the error. The change
    /// shows when presence says so (`voiceChannelUserUpdated`).
    pub async fn server_mute(&self, identity: String, mute: bool) -> Result<(), CoreError> {
        let services = self.services().ok_or_else(|| unavailable("server mute"))?;
        let channel_id = self
            .read(|state| match &state.voice.room {
                Some(VoiceRoom::Channel { channel_id, .. }) => Some(channel_id.clone()),
                _ => None,
            })
            .ok_or_else(|| unavailable("server mute outside a channel call"))?;
        services
            .backend
            .livekit_controller_mute_participant(
                channel_id,
                wire::MuteParticipantDto {
                    mute,
                    participant_identity: identity,
                },
            )
            .await
            .map_err(|error| self.backend_failed(error))?;
        Ok(())
    }

    /// W4: removes a member from the community (the voice menu's "Kick", after a confirm), which
    /// ends their call. There's no removal from a call alone (#663). `reason` is optional, as on
    /// the web.
    pub async fn kick_member(
        &self,
        community_id: String,
        user_id: String,
        reason: Option<String>,
    ) -> Result<(), CoreError> {
        let reason = reason
            .map(|reason| reason.trim().to_owned())
            .filter(|reason| !reason.is_empty());
        // W5: shown on the member's moderation menu (`AdminActionKind::Kick`), and the lists and
        // log read again after.
        let op = Core::target_op(&community_id, &user_id, crate::model::AdminActionKind::Kick);
        let refresh = vec![
            crate::cache::keys::scoped(crate::cache::keys::MEMBERS, &community_id),
            crate::cache::keys::scoped(super::moderation::keys::LOGS, &community_id),
            super::moderation::key2(super::moderation::keys::USER_ROLES, &community_id, &user_id),
        ];
        self.w5b_change(
            &[op],
            "kicking a member",
            Ok(()),
            async move |services| {
                services
                    .backend
                    .moderation_controller_kick_user(
                        community_id,
                        user_id,
                        wire::KickUserDto { reason },
                    )
                    .await
            },
            &refresh,
        )
        .await
        .map(|_| ())
    }

    /// W4: what I may do to others in this voice channel, from my roles for it (read when missing;
    /// `ViewKey::ChannelModeration` says when they're in). All false until then. An instance owner
    /// may do both.
    pub fn voice_moderation_caps(&self, channel_id: String) -> VoiceModerationCaps {
        self.write(|state, _| {
            if state.is_instance_owner() {
                return VoiceModerationCaps {
                    can_server_mute: true,
                    can_kick: true,
                };
            }
            let key = keys::scoped(keys::CHANNEL_ROLES, &channel_id);
            state.ensure_query(key.clone());
            let Some(roles) = state.cache.channel_roles(&key) else {
                return VoiceModerationCaps::default();
            };
            let has = |action: RbacAction| {
                roles
                    .roles
                    .iter()
                    .any(|role| role.actions.contains(&action))
            };
            VoiceModerationCaps {
                can_server_mute: has(RbacAction::MuteParticipant),
                can_kick: has(RbacAction::KickUser),
            }
        })
    }

    /// W4: how loud a participant plays here, 0 to 200 percent. Straight to the media engine,
    /// which remembers it.
    pub fn set_participant_volume(&self, identity: String, percent: u32) {
        let percent = percent.min(200);
        self.write(|state, _| {
            state.w4.volumes.insert(identity.clone(), percent);
            state.view_changed(ViewKey::Voice);
        });
        if let Some(media) = self.services().and_then(|services| services.media.as_ref()) {
            media.set_participant_volume(identity, percent);
        }
    }

    pub(crate) async fn leave_presence(&self, channel_id: String) {
        let Some(services) = self.services() else {
            return;
        };
        if let Err(error) = services
            .backend
            .voice_presence_controller_leave_presence(channel_id)
            .await
        {
            log::warn!("leaving voice presence failed: {error}");
        }
    }

    /// Who's in the room comes from voice presence, so a name and an avatar are there from the start.
    /// Who's speaking, tracks and quality come from the media engine. Either can say someone is muted
    /// or deafened: presence knows a server mute, the engine a muted track. Someone the engine sees
    /// before presence does is listed too.
    pub fn voice(&self) -> VoiceView {
        self.read(|state| {
            let mut voice = state.voice.clone();
            let Some(room) = &voice.room else {
                return voice;
            };
            let empty = Vec::new();
            let seen = state
                .media
                .as_ref()
                .map_or(&empty, |media| &media.participants);
            let mut participants: Vec<ParticipantView> = state
                .room_presence(room)
                .into_iter()
                .flatten()
                .map(|user| {
                    let media = seen.iter().find(|media| media.identity.as_str() == user.id);
                    ParticipantView {
                        identity: user.id.to_owned(),
                        user: UserView {
                            id: user.id.to_owned(),
                            username: user.username.to_owned(),
                            display_name: user.display_name.map(str::to_owned),
                            avatar_file_id: user.avatar_url.map(str::to_owned),
                        },
                        is_self: user.id == state.me_id(),
                        speaking: media.is_some_and(|media| media.speaking),
                        muted: user.is_server_muted || media.is_some_and(|media| media.muted),
                        deafened: user.is_deafened || media.is_some_and(|media| media.deafened),
                        camera: media.and_then(|media| media.camera.clone()),
                        screen_share: media.and_then(|media| media.screen_share.clone()),
                        quality: media.map(|media| media.quality).unwrap_or_default(),
                        server_muted: user.is_server_muted,
                        volume_percent: 100,
                    }
                })
                .collect();
            let present: std::collections::HashSet<&str> = state
                .room_presence(room)
                .into_iter()
                .flatten()
                .map(|user| user.id)
                .collect();
            participants.extend(
                seen.iter()
                    .filter(|media| !present.contains(media.identity.as_str()))
                    .cloned(),
            );
            for participant in &mut participants {
                participant.volume_percent = state
                    .w4
                    .volumes
                    .get(&participant.identity)
                    .copied()
                    .unwrap_or(100);
            }
            voice.participants = participants;
            if let Some(media) = &state.media {
                voice.muted = media.muted;
                voice.deafened = media.deafened;
                voice.reconnect_attempt = media.reconnect_attempt;
                voice.error = media.error.clone();
                voice.local.may_camera = media.local.may_camera;
                voice.local.may_share = media.local.may_share;
                voice.local.may_speak = media.local.may_speak;
                voice.local.screen_tracks = media.local.screen_tracks.clone();
                voice.local.soundboard = media.local.soundboard.clone();
            }
            voice.server_muted = state.me_server_muted();
            voice
        })
    }
}
