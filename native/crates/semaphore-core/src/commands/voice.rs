//! Voice calls: join, leave, mute, deafen, tokens, presence and the media engine's reports.

use crate::cache::keys;
use crate::client::{Core, Effect};
use crate::model::{ParticipantView, UserView, VideoDemand, ViewKey, VoiceStatus, VoiceView};
use crate::platform::CoreError;
use crate::resync::unavailable;
use semaphore_wire::types as wire;

fn voice_token_request(me: &UserView, channel_id: &str) -> wire::CreateTokenDto {
    wire::CreateTokenDto {
        identity: me.id.clone(),
        name: Some(me.username.clone()),
        room_id: channel_id.to_owned(),
        ttl: None,
    }
}

impl Core {
    pub async fn join_voice(&self, channel_id: String) -> Result<(), CoreError> {
        let services = self.services().ok_or_else(|| unavailable("voice"))?.clone();
        let media = services.media.clone().ok_or_else(|| unavailable("voice"))?;
        let me = self
            .read(|state| state.me.clone())
            .ok_or_else(|| unavailable("voice while signed out"))?;
        let (muted, deafened, call) = self.write(|state, _| {
            state.voice.status = VoiceStatus::Connecting;
            state.voice.channel_id = Some(channel_id.clone());
            state.voice.reconnect_attempt = None;
            state.voice.error = None;
            state.media = None;
            state.call += 1;
            state.call_ended_early = None;
            state.view_changed(ViewKey::Voice);
            state.ensure_query(keys::scoped(keys::VOICE_PRESENCE, &channel_id));
            (state.voice.muted, state.voice.deafened, state.call)
        });
        // The engine remembers these across calls, and what this call starts with is what's shown.
        // Deafen first: undeafening restores a mute this then overrides.
        media.set_deafened(deafened);
        media.set_muted(muted);
        let joined = async {
            let info = services
                .backend
                .livekit_controller_get_connection_info()
                .await
                .map_err(|error| self.backend_failed(error))?;
            let token = services
                .backend
                .livekit_controller_generate_token(voice_token_request(&me, &channel_id))
                .await
                .map_err(|error| self.backend_failed(error))?;
            let url = token.url.or(info.url).ok_or_else(|| CoreError::Failed {
                message: "the server gave no LiveKit address".into(),
            })?;
            media.connect(url, token.token, call).await?;
            services
                .backend
                .voice_presence_controller_join_presence(channel_id.clone())
                .await
                .map_err(|error| self.backend_failed(error))?;
            Ok::<_, CoreError>(())
        }
        .await;
        self.write(|state, _| {
            // Another join, a leave or a sign-out came while this one ran: it answers for nothing.
            if state.call != call || state.voice.channel_id.as_deref() != Some(&channel_id) {
                // A leave or sign-out can run before the engine has a room to leave, and this join
                // then finishes after it. No newer join owns the engine, so end what this one
                // started: the room, and the presence entry if there's still a session to say so.
                if state.call == call && joined.is_ok() {
                    state.push_effect(Effect::EndCall);
                    if state.me.is_some() {
                        state.push_effect(Effect::LeavePresence(channel_id.clone()));
                    }
                }
                return joined.clone().and(Err(CoreError::Failed {
                    message: "the call was left while joining".into(),
                }));
            }
            let ended = state.call_ended_early.take();
            match (&joined, ended) {
                (Ok(()), None) => {
                    state.voice.status = VoiceStatus::Connected;
                    state.view_changed(ViewKey::Voice);
                    Ok(())
                }
                // The engine connected and dropped again before this finished. The server has heard
                // of the join, so it hears of the leave too.
                (Ok(()), Some(error)) => {
                    state.voice = VoiceView {
                        error: error.clone(),
                        ..VoiceView::default()
                    };
                    state.media = None;
                    state.push_effect(Effect::LeavePresence(channel_id.clone()));
                    state.view_changed(ViewKey::Voice);
                    Err(CoreError::Failed {
                        message: error.unwrap_or_else(|| "the call ended as it started".into()),
                    })
                }
                (Err(error), _) => {
                    state.voice = VoiceView::default();
                    state.media = None;
                    state.view_changed(ViewKey::Voice);
                    Err(error.clone())
                }
            }
        })
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

    pub async fn set_muted(&self, muted: bool) -> Result<(), CoreError> {
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
        let (me, channel_id) =
            self.read(|state| (state.me.clone(), state.voice.channel_id.clone()));
        let (Some(me), Some(channel_id)) = (me, channel_id) else {
            return Err(unavailable("a voice token outside a call"));
        };
        let token = services
            .backend
            .livekit_controller_generate_token(voice_token_request(&me, &channel_id))
            .await
            .map_err(|error| self.backend_failed(error))?;
        Ok(token.token)
    }

    /// Keeps this client on the channel's roster. The server forgets it 90 s after the last one, so a
    /// host calls this about every 30 s, as the web's heartbeat does. Does nothing unless connected:
    /// a dead room must not keep claiming to be there. A failure is logged, for the next to retry, and
    /// a refresh after expiry re-registers, so nothing else is needed after a rejoin.
    pub async fn refresh_voice_presence(&self) {
        let channel_id = self.read(|state| {
            state
                .voice
                .channel_id
                .clone()
                .filter(|_| state.voice.status == VoiceStatus::Connected)
        });
        let (Some(channel_id), Some(services)) = (channel_id, self.services()) else {
            return;
        };
        if let Err(error) = services
            .backend
            .voice_presence_controller_refresh_presence(channel_id)
            .await
        {
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
            state.media = Some(media);
            state.view_changed(ViewKey::Voice);
        });
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
            let Some(channel_id) = &voice.channel_id else {
                return voice;
            };
            let empty = Vec::new();
            let seen = state
                .media
                .as_ref()
                .map_or(&empty, |media| &media.participants);
            let key = keys::scoped(keys::VOICE_PRESENCE, channel_id);
            let users = state
                .cache
                .voice_presence(&key)
                .map(|presence| presence.users.as_slice())
                .unwrap_or_default();
            let mut participants: Vec<ParticipantView> = users
                .iter()
                .map(|user| {
                    let media = seen.iter().find(|media| media.identity == user.id);
                    ParticipantView {
                        identity: user.id.clone(),
                        user: UserView {
                            id: user.id.clone(),
                            username: user.username.clone(),
                            display_name: user.display_name.clone(),
                            avatar_file_id: user.avatar_url.clone(),
                        },
                        is_self: user.id == state.me_id(),
                        speaking: media.is_some_and(|media| media.speaking),
                        muted: user.is_server_muted || media.is_some_and(|media| media.muted),
                        deafened: user.is_deafened || media.is_some_and(|media| media.deafened),
                        camera: media.and_then(|media| media.camera.clone()),
                        screen_share: media.and_then(|media| media.screen_share.clone()),
                        quality: media.map(|media| media.quality).unwrap_or_default(),
                    }
                })
                .collect();
            participants.extend(
                seen.iter()
                    .filter(|media| !users.iter().any(|user| user.id == media.identity))
                    .cloned(),
            );
            voice.participants = participants;
            if let Some(media) = &state.media {
                voice.muted = media.muted;
                voice.deafened = media.deafened;
                voice.reconnect_attempt = media.reconnect_attempt;
                voice.error = media.error.clone();
            }
            voice
        })
    }
}
