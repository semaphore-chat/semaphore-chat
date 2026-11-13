//! DM calls: joining one, and the incoming call that rings. Unit W4-core.
//!
//! A DM call's room is the DM group's id. Joining takes `dm-token`, connects, then refreshes the
//! DM's presence at once (the server registers us then if LiveKit's webhook hasn't yet) and on the
//! host's heartbeat; there's no presence leave for a DM. One call runs at a time: joining a DM call
//! leaves a channel call first, and the reverse.
//!
//! Ringing (`dmVoiceCallStarted` from someone else, for a DM whose call we're not in or joining)
//! keeps the newest ring only, and stops on accept, decline, `expires_at_ms`, our joining that
//! call on any device, the call's presence emptying (`dmVoiceCallEnded`), a decline by this
//! account on another device (`dmVoiceCallDeclined` naming us), or sign-out. Declining also tells
//! the server, best-effort (`POST /dm-groups/{id}/voice-presence/decline`); a failure is only
//! logged. In a 1:1, the other person's decline ends the caller's call there, and a group DM rings
//! every member. Two members starting at once can both be announced as the starter (#662): a ring
//! for the DM whose call we're in or joining is ignored.
//!
//! [`State::w4_settle`] runs after every change, before events go out: it stops a ring our call
//! answers, and derives the keep-awake changes, the sound cues and the replay buffer from what
//! changed.

use std::collections::{BTreeSet, HashMap, VecDeque};
use std::sync::Arc;

use crate::cache::keys;
use crate::client::{Core, Effect, State};
use crate::model::{
    Conversation, ErrorView, IncomingCallView, JoinFailure, LoadState, LocalShare,
    MediaDiagnostics, MessageLink, OsNotification, REPLAY_AUDIO_WAIT_MS, RING_MS, ReplayState,
    SoundCue, UserView, ViewKey, VoiceDiagnosticEvent, VoiceRoom, VoiceStatus,
};
use crate::platform::{CoreError, CoreEvent, KeepAwake};
use crate::resync::unavailable;
use semaphore_wire::types as wire;

/// The most lines the debug panel's log keeps.
const DIAGNOSTIC_EVENTS: usize = 50;

/// One presence entry, whichever shape its room kind sends: a channel's REST answer carries
/// `canModerate` (unused here, W5's remove-from-call menu), a DM's has no such field.
pub(crate) struct PresenceUser<'a> {
    pub id: &'a str,
    pub username: &'a str,
    pub display_name: Option<&'a str>,
    pub avatar_url: Option<&'a str>,
    pub is_server_muted: bool,
    pub is_deafened: bool,
}

/// A room's presence list, borrowed from the cache, in its own shape.
#[derive(Clone)]
pub(crate) enum PresenceUsers<'a> {
    Channel(std::slice::Iter<'a, wire::ChannelVoicePresenceUserDto>),
    Dm(std::slice::Iter<'a, wire::VoicePresenceUserDto>),
}

impl<'a> PresenceUsers<'a> {
    pub(crate) fn channel(users: &'a [wire::ChannelVoicePresenceUserDto]) -> Self {
        PresenceUsers::Channel(users.iter())
    }
}

impl<'a> Iterator for PresenceUsers<'a> {
    type Item = PresenceUser<'a>;

    fn next(&mut self) -> Option<Self::Item> {
        Some(match self {
            PresenceUsers::Channel(users) => {
                let user = users.next()?;
                PresenceUser {
                    id: &user.id,
                    username: &user.username,
                    display_name: user.display_name.as_deref(),
                    avatar_url: user.avatar_url.as_deref(),
                    is_server_muted: user.is_server_muted,
                    is_deafened: user.is_deafened,
                }
            }
            PresenceUsers::Dm(users) => {
                let user = users.next()?;
                PresenceUser {
                    id: &user.id,
                    username: &user.username,
                    display_name: user.display_name.as_deref(),
                    avatar_url: user.avatar_url.as_deref(),
                    is_server_muted: user.is_server_muted,
                    is_deafened: user.is_deafened,
                }
            }
        })
    }
}

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
    /// Buffers the server ended while ours was starting, with why: the start's own session among
    /// them means it ended as it began.
    pub(crate) replay_ended: Vec<(String, Option<String>)>,
    /// A replay start or stop is running, and the one asked for since.
    pub(crate) replay_running: bool,
    pub(crate) replay_pending: Option<ReplayOp>,
    /// The share's video track waiting for its audio track, and until when.
    pub(crate) replay_audio_wait: Option<(String, u64)>,
    /// The video track whose audio wait ran out: it records without.
    pub(crate) replay_audio_waived: Option<String>,
    pub(crate) clips_busy: Vec<String>,
    /// Participant volumes set this session, by identity.
    pub(crate) volumes: HashMap<String, u32>,
    /// Screen-share audio volumes set this session, by identity. The mic's is `volumes`.
    pub(crate) screen_share_volumes: HashMap<String, u32>,
    /// Set while a query's answer that's older than a change to its data is applied.
    pub(crate) answer_dirty: bool,
    pub(crate) clips_error: Option<ErrorView>,
    pub(crate) diagnostics: Diagnostics,
}

/// A replay buffer call to make (`W4State::replay_pending`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ReplayOp {
    Start(u64),
    Stop,
}

/// At most one join-failure report a minute, as the web's `JOIN_FAILURE_REPORT_INTERVAL_MS`: a
/// rejoin backoff storm sends one.
pub(crate) const JOIN_FAILURE_REPORT_INTERVAL_MS: u64 = 60_000;

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
    /// The join whose `connect` the engine was last given.
    pub(crate) engine_call: u64,
    /// The clock at the change being settled.
    pub(crate) now_ms: u64,
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
    pub(crate) fn room_presence(&self, room: &VoiceRoom) -> Option<PresenceUsers<'_>> {
        match room {
            VoiceRoom::Channel { channel_id, .. } => self
                .cache
                .voice_presence(&keys::scoped(keys::VOICE_PRESENCE, channel_id))
                .map(|presence| PresenceUsers::channel(&presence.users)),
            VoiceRoom::Dm { dm_group_id } => self
                .cache
                .dm_voice_presence(&keys::scoped(keys::DM_VOICE_PRESENCE, dm_group_id))
                .map(|presence| PresenceUsers::Dm(presence.users.iter())),
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
                    .into_iter()
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

    /// Whether the DM list says this is a group DM.
    fn dm_is_group(&self, dm_group_id: &str) -> bool {
        self.cache
            .dm_groups(&keys::op(keys::DMS))
            .and_then(|groups| groups.iter().find(|group| group.id == dm_group_id))
            .is_some_and(|group| group.is_group)
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
        let is_group = self.dm_is_group(&event.dm_group_id);
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
            is_group,
            started_at_ms: now,
            expires_at_ms: now + RING_MS,
        });
        self.view_changed(ViewKey::IncomingCall);
        // To name a group DM that isn't listed yet: `w4_dms_arrived` renames the ring.
        self.ensure_query(keys::op(keys::DMS));
        // To tell when the caller gives up. A read already out began before this call did: its
        // answer can't say the caller left, so it's read again after.
        let key = keys::scoped(keys::DM_VOICE_PRESENCE, &event.dm_group_id);
        if let Some(dirty) = self.fetching.get_mut(&key) {
            *dirty = true;
        }
        self.ensure_query(key);
    }

    /// The DM list arrived: a ring named after its caller takes its group's name.
    pub(crate) fn w4_dms_arrived(&mut self) {
        let Some(call) = self.w4.incoming.clone() else {
            return;
        };
        let name = self.dm_name(&call.dm_group_id, call.group_name.clone());
        let is_group = self.dm_is_group(&call.dm_group_id);
        if (name != call.group_name || is_group != call.is_group)
            && let Some(incoming) = &mut self.w4.incoming
        {
            incoming.group_name = name;
            incoming.is_group = is_group;
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
        if !self.ringing_for(dm_group_id) || self.w4.answer_dirty {
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

    /// `dmVoiceCallDeclined`. This account declining on any device stops this device's ring. In a
    /// 1:1, the other person declining ends the caller's call, as a phone call ends when the other
    /// side says no (`declineEndsMyCall`); a group call keeps going, as one person declining is
    /// only about them. The server says whether it is a group, so a cache that hasn't loaded
    /// can't be wrong here.
    pub(crate) fn w4_declined(&mut self, event: &wire::DmVoiceCallDeclinedPayloadDto) {
        if event.user_id == self.me_id() {
            if self.ringing_for(&event.dm_group_id) {
                self.w4_stop_ring();
            }
            return;
        }
        if event.is_group {
            return;
        }
        if let Some(VoiceRoom::Dm { dm_group_id }) = &self.voice.room
            && *dm_group_id == event.dm_group_id
        {
            // The caller waited in this room for an answer that won't come.
            self.w5a_end_call();
        }
    }

    /// `dmVoiceCallEnded`: the call's presence emptied, so every device still ringing for it
    /// stops. A call this device is in doesn't end here: its own presence would have kept the
    /// call from reading empty.
    pub(crate) fn w4_ended(&mut self, dm_group_id: &str) {
        if self.ringing_for(dm_group_id) {
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
                .filter(|user| user.id != me.as_str())
                .map(|user| user.id.to_owned())
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
    /// track, when it has one, or once `REPLAY_AUDIO_WAIT_MS` has passed without it or the engine
    /// says its audio failed), and stops it once the share or the call ends.
    fn w4_replay(&mut self) {
        let in_channel = matches!(self.voice.room, Some(VoiceRoom::Channel { .. }))
            && matches!(
                self.voice.status,
                VoiceStatus::Connected | VoiceStatus::Reconnecting
            );
        let sharing = self.voice.local.screen == LocalShare::On;
        let media_local = self.media.as_ref().map(|media| &media.local);
        let audio_failed = media_local
            .is_some_and(|local| matches!(local.screen_audio, LocalShare::Failed { .. }));
        let tracks = media_local
            .and_then(|local| local.screen_tracks.clone())
            .filter(|_| in_channel && sharing);
        let Some(tracks) = tracks else {
            self.w4.replay_done_for = None;
            self.w4.replay_audio_waived = None;
            self.w4_audio_wait(None);
            if self.w4.replay_live {
                self.w4.replay_live = false;
                self.w4_replay_op(ReplayOp::Stop);
            }
            if self.voice.replay != ReplayState::Off {
                self.voice.replay = ReplayState::Off;
                self.view_changed(ViewKey::Voice);
            }
            return;
        };
        if self.w4.replay_done_for.as_deref() == Some(tracks.video_sid.as_str()) {
            self.w4_audio_wait(None);
            return;
        }
        let audio_pending = self.voice.local.screen_audio == LocalShare::On
            && tracks.audio_sid.is_none()
            && !audio_failed
            && self.w4.replay_audio_waived.as_deref() != Some(tracks.video_sid.as_str());
        if audio_pending {
            let waiting_for_this = self
                .w4
                .replay_audio_wait
                .as_ref()
                .is_some_and(|(video, _)| *video == tracks.video_sid);
            if !waiting_for_this {
                let until = self.w4_platform.now_ms + REPLAY_AUDIO_WAIT_MS;
                self.w4_audio_wait(Some((tracks.video_sid, until)));
            }
            return;
        }
        self.w4_audio_wait(None);
        self.w4.replay_done_for = Some(tracks.video_sid);
        self.w4.replay_live = true;
        self.w4.replay_ended.clear();
        self.voice.replay = ReplayState::Starting;
        self.view_changed(ViewKey::Voice);
        self.w4_replay_op(ReplayOp::Start(self.call));
    }

    fn w4_audio_wait(&mut self, wait: Option<(String, u64)>) {
        let until = wait.as_ref().map(|(_, until)| *until);
        self.w4.replay_audio_wait = wait;
        if self.voice.replay_audio_wait_until_ms != until {
            self.voice.replay_audio_wait_until_ms = until;
            self.view_changed(ViewKey::Voice);
        }
    }

    /// Replay starts and stops run one at a time, as the web's `useReplayBuffer` does: while one
    /// runs, the latest asked for waits, and replaces any other waiting.
    pub(crate) fn w4_replay_op(&mut self, op: ReplayOp) {
        if self.w4.replay_running {
            self.w4.replay_pending = Some(op);
            return;
        }
        self.w4.replay_running = true;
        self.push_effect(match op {
            ReplayOp::Start(call) => Effect::StartReplay(call),
            ReplayOp::Stop => Effect::StopReplay,
        });
    }

    /// A replay start or stop finished: the one waiting, if any, runs.
    pub(crate) fn w4_replay_op_done(&mut self) {
        self.w4.replay_running = false;
        if let Some(op) = self.w4.replay_pending.take() {
            self.w4_replay_op(op);
        }
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
        self.join_room(VoiceRoom::Dm { dm_group_id }, None).await
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

    /// Stops the ring and tells the server, best-effort: the caller's 1:1 call ends there
    /// (`dmVoiceCallDeclined` goes to the DM's room) and this account's other devices stop
    /// ringing. The failure is only logged: the ring has already stopped here. With no ring there
    /// is nothing to tell anyone.
    pub fn decline_incoming_call(&self) {
        self.write(|state, _| {
            let Some(call) = state.w4.incoming.clone() else {
                return;
            };
            state.w4_stop_ring();
            if state.me.is_some() {
                state.push_effect(Effect::DeclineDmCall {
                    dm_group_id: call.dm_group_id,
                    epoch: state.session_epoch,
                });
            }
        });
    }

    /// [`Core::decline_incoming_call`]'s request, in the background. A session that ended meanwhile
    /// has nobody to tell.
    pub(crate) async fn decline_dm_call(&self, dm_group_id: String, epoch: u64) {
        let Some(services) = self.services().cloned() else {
            return;
        };
        if self.read(|state| state.session_epoch) != epoch {
            return;
        }
        if let Err(error) = services
            .backend
            .dm_voice_presence_controller_decline_dm_voice_call(dm_group_id)
            .await
        {
            log::warn!("declining the DM call failed: {error}");
        }
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
