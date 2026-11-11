//! DM calls: joining one, and the incoming call that rings. Unit W4-core.
//!
//! A DM call's room is the DM group's id. Joining takes `dm-token`, connects, then refreshes the
//! DM's presence at once (the server registers us then if LiveKit's webhook hasn't yet) and on the
//! host's heartbeat; there's no presence leave for a DM. One call runs at a time: joining a DM call
//! leaves a channel call first, and the reverse.
//!
//! Ringing (`dmVoiceCallStarted` from someone else, for a DM whose call we're not in or joining)
//! keeps the newest ring only, and stops on accept, decline (local only), `expires_at_ms`, our
//! joining that call on any device, the call's presence emptying, or sign-out. Chosen for the owner
//! (2026-11-11), who may overrule: decline tells nobody (the server has no way to, #638); group
//! DMs ring every member. Two members starting at once can both be announced as the starter
//! (#662): a ring for the DM whose call we're in or joining is ignored.
//!
//! [`State::w4_settle`] runs after every change, before events go out: it stops a ring our call
//! answers, and derives the keep-awake changes, the sound cues and the replay buffer from what
//! changed.

use std::collections::{BTreeSet, HashMap, VecDeque};
use std::sync::Arc;

use crate::cache::keys;
use crate::client::{Core, Effect, State};
use crate::model::{
    Conversation, ErrorView, IncomingCallView, JoinFailure, LoadState, MediaDiagnostics,
    MessageLink, OsNotification, RING_MS, ReplayState, SoundCue, UserView, ViewKey,
    VoiceDiagnosticEvent, VoiceRoom, VoiceStatus,
};
use crate::platform::{CoreError, CoreEvent, KeepAwake};
use crate::resync::unavailable;
use semaphore_wire::types as wire;

/// The most lines the debug panel's log keeps.
const DIAGNOSTIC_EVENTS: usize = 50;

/// W4's state of one session.
#[derive(Default)]
pub struct W4State {
    pub(crate) incoming: Option<IncomingCallView>,
    /// Soundboard files read so far, by file id. A sound is at most 1 MiB.
    pub(crate) sound_bytes: HashMap<String, Vec<u8>>,
    /// The sound starting now, with its community.
    pub(crate) sound_playing: Option<(String, String)>,
    /// Why the last play failed, with its community.
    pub(crate) sound_error: Option<(String, ErrorView)>,
    /// The server may be recording a replay buffer for us: a stop is owed once the share ends.
    pub(crate) replay_live: bool,
    /// The video track the buffer was last started for, so a buffer that stopped or failed isn't
    /// started again for the same share.
    pub(crate) replay_done_for: Option<String>,
    pub(crate) clips_busy: Vec<String>,
    pub(crate) clips_error: Option<ErrorView>,
    pub(crate) diagnostics: Diagnostics,
}

/// What the voice debug panel shows.
#[derive(Default)]
pub(crate) struct Diagnostics {
    pub(crate) server_host: Option<String>,
    pub(crate) media: Option<MediaDiagnostics>,
    pub(crate) last_failure: Option<JoinFailure>,
    pub(crate) events: VecDeque<VoiceDiagnosticEvent>,
}

/// W4's platform seams, and what `w4_settle` compares against. They outlive sessions, so a
/// sign-out's ending of the call and the ring is seen as a change.
#[derive(Default)]
pub struct W4Platform {
    pub(crate) keep_awake: Option<Arc<dyn KeepAwake>>,
    /// What `keep_awake` was last set to.
    pub(crate) awake: bool,
    pub(crate) awake_changes: u64,
    pub(crate) ringing: bool,
    pub(crate) last_status: VoiceStatus,
    /// Everyone but me in the call's room, by room id, once its presence was known while connected.
    pub(crate) roster: Option<(String, BTreeSet<String>)>,
}

fn notification_tag(dm_group_id: &str) -> String {
    format!("dm-call-{dm_group_id}")
}

fn name_of(user: &UserView) -> String {
    user.display_name
        .clone()
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| user.username.clone())
}

impl State {
    /// Who the server lists in this room's call, once read.
    pub(crate) fn room_presence(
        &self,
        room: &VoiceRoom,
    ) -> Option<&Vec<wire::VoicePresenceUserDto>> {
        match room {
            VoiceRoom::Channel { channel_id, .. } => self
                .cache
                .voice_presence(&keys::scoped(keys::VOICE_PRESENCE, channel_id))
                .map(|presence| &presence.users),
            VoiceRoom::Dm { dm_group_id } => self
                .cache
                .dm_voice_presence(&keys::scoped(keys::DM_VOICE_PRESENCE, dm_group_id))
                .map(|presence| &presence.users),
        }
    }

    pub(crate) fn room_presence_key(room: &VoiceRoom) -> crate::cache::QueryKey {
        match room {
            VoiceRoom::Channel { channel_id, .. } => keys::scoped(keys::VOICE_PRESENCE, channel_id),
            VoiceRoom::Dm { dm_group_id } => keys::scoped(keys::DM_VOICE_PRESENCE, dm_group_id),
        }
    }

    /// A moderator server-muted me in the channel call I'm in.
    pub(crate) fn me_server_muted(&self) -> bool {
        let me = self.me_id();
        self.voice
            .room
            .as_ref()
            .and_then(|room| self.room_presence(room))
            .is_some_and(|users| {
                users
                    .iter()
                    .any(|user| user.id == me && user.is_server_muted)
            })
    }

    pub(crate) fn w4_log(&mut self, now: u64, message: impl Into<String>) {
        let events = &mut self.w4.diagnostics.events;
        if events.len() == DIAGNOSTIC_EVENTS {
            events.pop_front();
        }
        events.push_back(VoiceDiagnosticEvent {
            at_ms: now,
            message: message.into(),
        });
        self.view_changed(ViewKey::VoiceDiagnostics);
    }

    /// The name a DM goes by: the group's own, its other members', or `fallback`.
    fn dm_name(&self, dm_group_id: &str, fallback: String) -> String {
        let me = self.me_id();
        let Some(group) = self
            .cache
            .dm_groups(&keys::op(keys::DMS))
            .and_then(|groups| groups.iter().find(|group| group.id == dm_group_id))
        else {
            return fallback;
        };
        if let Some(name) = group.name.clone().filter(|name| !name.is_empty()) {
            return name;
        }
        let names: Vec<String> = group
            .members
            .iter()
            .filter(|member| member.user_id != me)
            .map(|member| {
                member
                    .user
                    .display_name
                    .clone()
                    .filter(|name| !name.is_empty())
                    .unwrap_or_else(|| member.user.username.clone())
            })
            .collect();
        if names.is_empty() {
            fallback
        } else {
            names.join(", ")
        }
    }

    /// `dmVoiceCallStarted`.
    pub(crate) fn w4_ring(&mut self, event: &wire::DmVoiceCallStartedPayloadDto, now: u64) {
        if self.me.is_none() || event.started_by == self.me_id() {
            return;
        }
        if let Some(VoiceRoom::Dm { dm_group_id }) = &self.voice.room
            && *dm_group_id == event.dm_group_id
        {
            return;
        }
        let caller = UserView {
            id: event.starter.id.clone(),
            username: event.starter.username.clone(),
            display_name: event.starter.display_name.clone(),
            avatar_file_id: event.starter.avatar_url.clone(),
        };
        let caller_name = name_of(&caller);
        let group_name = self.dm_name(&event.dm_group_id, caller_name.clone());
        if let Some(previous) = self.w4.incoming.take()
            && previous.dm_group_id != event.dm_group_id
        {
            self.push_event(CoreEvent::WithdrawNotifications {
                tag: notification_tag(&previous.dm_group_id),
            });
        }
        let tag = notification_tag(&event.dm_group_id);
        self.push_event(CoreEvent::Notify {
            notification: OsNotification {
                id: tag.clone(),
                tag,
                title: format!("{caller_name} is calling"),
                body: "Incoming voice call".into(),
                link: MessageLink {
                    community_id: None,
                    conversation: Conversation::DirectMessage {
                        id: event.dm_group_id.clone(),
                    },
                    message_id: None,
                },
                parent_message_id: None,
                // The ring is its sound.
                sound: None,
            },
        });
        self.w4.incoming = Some(IncomingCallView {
            dm_group_id: event.dm_group_id.clone(),
            group_name,
            caller,
            started_at_ms: now,
            expires_at_ms: now + RING_MS,
        });
        self.view_changed(ViewKey::IncomingCall);
        // To name a group DM that isn't listed yet: `w4_dms_arrived` renames the ring.
        self.ensure_query(keys::op(keys::DMS));
        // To tell when the caller gives up.
        self.ensure_query(keys::scoped(keys::DM_VOICE_PRESENCE, &event.dm_group_id));
    }

    /// The DM list arrived: a ring named after its caller takes its group's name.
    pub(crate) fn w4_dms_arrived(&mut self) {
        let Some(call) = self.w4.incoming.clone() else {
            return;
        };
        let name = self.dm_name(&call.dm_group_id, call.group_name.clone());
        if name != call.group_name
            && let Some(incoming) = &mut self.w4.incoming
        {
            incoming.group_name = name;
            self.view_changed(ViewKey::IncomingCall);
        }
    }

    pub(crate) fn w4_stop_ring(&mut self) {
        if let Some(call) = self.w4.incoming.take() {
            self.push_event(CoreEvent::WithdrawNotifications {
                tag: notification_tag(&call.dm_group_id),
            });
            self.view_changed(ViewKey::IncomingCall);
        }
    }

    fn ringing_for(&self, dm_group_id: &str) -> bool {
        self.w4
            .incoming
            .as_ref()
            .is_some_and(|call| call.dm_group_id == dm_group_id)
    }

    /// The ringing DM's presence is known or changed: nobody but me left means the caller gave up.
    pub(crate) fn w4_ring_presence(&mut self, dm_group_id: &str) {
        if !self.ringing_for(dm_group_id) {
            return;
        }
        let me = self.me_id().to_owned();
        let empty = self
            .cache
            .dm_voice_presence(&keys::scoped(keys::DM_VOICE_PRESENCE, dm_group_id))
            .is_some_and(|presence| presence.users.iter().all(|user| user.id == me));
        if empty {
            self.w4_stop_ring();
        }
    }

    /// `dmVoiceUserJoined` and `dmVoiceUserLeft`: the hybrid pattern, as for channels.
    pub(crate) fn w4_dm_presence(
        &mut self,
        dm_group_id: &str,
        user_id: &str,
        joined: Option<wire::VoicePresenceUserDto>,
        name: &str,
    ) {
        let key = keys::scoped(keys::DM_VOICE_PRESENCE, dm_group_id);
        self.note_direct_update(&key);
        let cached = match self.cache.dm_voice_presence_mut(&key) {
            Some(presence) => {
                match &joined {
                    Some(user) => {
                        if !presence.users.iter().any(|known| known.id == user.id) {
                            presence.users.push(user.clone());
                        }
                    }
                    None => presence.users.retain(|known| known.id != user_id),
                }
                presence.count = presence.users.len() as i64;
                self.view_changed(ViewKey::Voice);
                true
            }
            None => {
                self.invalidate_for(name);
                false
            }
        };
        if joined.is_some() {
            // Answered on another of my devices.
            if user_id == self.me_id() && self.ringing_for(dm_group_id) {
                self.w4_stop_ring();
            }
        } else if cached {
            self.w4_ring_presence(dm_group_id);
        } else if self
            .w4
            .incoming
            .as_ref()
            .is_some_and(|call| call.dm_group_id == dm_group_id && call.caller.id == user_id)
        {
            self.w4_stop_ring();
        }
    }

    /// The session is ending: take its ring down.
    pub(crate) fn w4_signed_out(&mut self) {
        self.w4_stop_ring();
    }

    /// Runs after every change. See the module docs.
    pub(crate) fn w4_settle(&mut self) {
        if let (Some(call), Some(VoiceRoom::Dm { dm_group_id })) =
            (&self.w4.incoming, &self.voice.room)
            && call.dm_group_id == *dm_group_id
        {
            self.w4_stop_ring();
        }
        let ringing = self.w4.incoming.is_some();
        if ringing != self.w4_platform.ringing {
            self.w4_platform.ringing = ringing;
            self.push_event(CoreEvent::Sound {
                cue: if ringing {
                    SoundCue::IncomingRingStart
                } else {
                    SoundCue::IncomingRingStop
                },
            });
        }

        let status = self.voice.status;
        let last = self.w4_platform.last_status;
        if status != last {
            self.w4_platform.last_status = status;
            self.view_changed(ViewKey::VoiceDiagnostics);
            match (last, status) {
                (VoiceStatus::Connecting, VoiceStatus::Connected) => {
                    self.push_event(CoreEvent::Sound {
                        cue: SoundCue::Connected,
                    });
                }
                (VoiceStatus::Connected | VoiceStatus::Reconnecting, VoiceStatus::Disconnected) => {
                    self.push_event(CoreEvent::Sound {
                        cue: SoundCue::Disconnected,
                    });
                }
                _ => {}
            }
        }

        let on = status != VoiceStatus::Disconnected;
        if on != self.w4_platform.awake && self.w4_platform.keep_awake.is_some() {
            self.w4_platform.awake = on;
            self.w4_platform.awake_changes += 1;
            let n = self.w4_platform.awake_changes;
            self.push_effect(Effect::KeepAwake { on, n });
        }

        self.w4_roster();
        self.w4_replay();
    }

    /// Sounds for others joining and leaving the call I'm in. The first presence seen while
    /// connected is only remembered: whoever was there first makes no sound.
    fn w4_roster(&mut self) {
        let Some(room) = self.voice.room.clone() else {
            self.w4_platform.roster = None;
            return;
        };
        match self.voice.status {
            VoiceStatus::Connected => {}
            VoiceStatus::Reconnecting => return,
            _ => {
                self.w4_platform.roster = None;
                return;
            }
        }
        let me = self.me_id().to_owned();
        let Some(others) = self.room_presence(&room).map(|users| {
            users
                .iter()
                .filter(|user| user.id != me)
                .map(|user| user.id.clone())
                .collect::<BTreeSet<_>>()
        }) else {
            return;
        };
        if let Some((id, before)) = &self.w4_platform.roster
            && id == room.id()
        {
            let joined = others.difference(before).next().is_some();
            let left = before.difference(&others).next().is_some();
            let dm = matches!(room, VoiceRoom::Dm { .. });
            if joined {
                self.push_event(CoreEvent::Sound {
                    cue: SoundCue::UserJoined,
                });
            }
            if left {
                let cue = if dm && others.is_empty() {
                    SoundCue::CallEnded
                } else {
                    SoundCue::UserLeft
                };
                self.push_event(CoreEvent::Sound { cue });
            }
        }
        self.w4_platform.roster = Some((room.id().to_owned(), others));
    }

    /// Starts the replay buffer once our share in a channel call is published (with its audio
    /// track, when it has one), and stops it once the share or the call ends.
    fn w4_replay(&mut self) {
        let in_channel = matches!(self.voice.room, Some(VoiceRoom::Channel { .. }))
            && matches!(
                self.voice.status,
                VoiceStatus::Connected | VoiceStatus::Reconnecting
            );
        let sharing = self.voice.local.screen == crate::model::LocalShare::On;
        let tracks = self
            .media
            .as_ref()
            .and_then(|media| media.local.screen_tracks.clone())
            .filter(|_| in_channel && sharing);
        let Some(tracks) = tracks else {
            self.w4.replay_done_for = None;
            if self.w4.replay_live {
                self.w4.replay_live = false;
                self.push_effect(Effect::StopReplay);
            }
            if self.voice.replay != ReplayState::Off {
                self.voice.replay = ReplayState::Off;
                self.view_changed(ViewKey::Voice);
            }
            return;
        };
        let audio_pending = self.voice.local.screen_audio == crate::model::LocalShare::On
            && tracks.audio_sid.is_none();
        if audio_pending || self.w4.replay_done_for.as_deref() == Some(tracks.video_sid.as_str()) {
            return;
        }
        self.w4.replay_done_for = Some(tracks.video_sid);
        self.w4.replay_live = true;
        self.voice.replay = ReplayState::Starting;
        self.view_changed(ViewKey::Voice);
        self.push_effect(Effect::StartReplay(self.call));
    }

    /// Whether a list this core reads has arrived, as `Core::load_state` says it.
    pub(crate) fn load_of(&self, key: &crate::cache::QueryKey) -> LoadState {
        if let Some(error) = self.failed_queries.get(key) {
            return LoadState::Failed {
                error: error.clone(),
            };
        }
        if self.cache.get(key).is_some() {
            LoadState::Ready
        } else {
            LoadState::Loading
        }
    }
}

impl Core {
    /// The platform's sleep inhibitor, held while a call runs.
    pub fn set_keep_awake(&self, keep_awake: Arc<dyn KeepAwake>) {
        self.write(|state, _| state.w4_platform.keep_awake = Some(keep_awake));
    }

    pub(crate) fn set_awake(&self, on: bool) {
        let keep_awake = self.read(|state| state.w4_platform.keep_awake.clone());
        if let Some(keep_awake) = keep_awake
            && let Err(error) = keep_awake.set(on)
        {
            log::warn!("keeping the system awake ({on}) failed: {error}");
        }
    }

    /// Joins this DM or group DM's call, leaving any other call first. Fails as `join_voice` does;
    /// a blocked 1:1 DM is the server's refusal.
    pub async fn join_dm_call(&self, dm_group_id: String) -> Result<(), CoreError> {
        self.join_room(VoiceRoom::Dm { dm_group_id }).await
    }

    /// The call ringing now, if any (`ViewKey::IncomingCall`).
    pub fn incoming_call(&self) -> Option<IncomingCallView> {
        self.read(|state| state.w4.incoming.clone())
    }

    /// Answers the ringing call: stops the ring and joins it (`join_dm_call`).
    pub async fn accept_incoming_call(&self) -> Result<(), CoreError> {
        let call = self.write(|state, _| {
            let call = state.w4.incoming.clone();
            state.w4_stop_ring();
            call
        });
        let call = call.ok_or_else(|| unavailable("answering with no call ringing"))?;
        self.join_dm_call(call.dm_group_id).await
    }

    /// Stops the ring. The caller isn't told.
    pub fn decline_incoming_call(&self) {
        self.write(|state, _| state.w4_stop_ring());
    }

    /// The host calls this at the ring's `expires_at_ms`: a ring past it stops. Does nothing
    /// otherwise, so calling it early or twice is harmless.
    pub fn expire_incoming_call(&self) {
        self.write(|state, now| {
            if state
                .w4
                .incoming
                .as_ref()
                .is_some_and(|call| now >= call.expires_at_ms)
            {
                state.w4_stop_ring();
            }
        });
    }
}
