//! W4's voice state: DM call presence, server mutes, kicks, the replay buffer, the clip library
//! and join-failure reports. Each function names the backend code it mirrors.
//!
//! Kept under its own lock ([`Inner::calls`](crate::Inner)), never held together with `data`.

use crate::{Inner, lock, scenario::entity_uuid};
use chrono::{DateTime, Utc};
use semaphore_wire::types::VoicePresenceUserDto;
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

/// A clip's MP4 (the player's `h264-aac.mp4`: 2 s, 64x64): what every captured or seeded clip's
/// file serves.
pub(crate) const CLIP_MP4: &[u8] = include_bytes!("../fixtures/clip.mp4");

/// `LivekitReplayService.STALE_NOTIFY_MAX_AGE_MS`: a session that ended longer ago than this
/// gets no "missed" stop or fail event.
const STALE_NOTIFY_MAX_AGE: chrono::Duration = chrono::Duration::hours(24);

/// `JOIN_FAILURE_REPORT_LIMIT` reports per `JOIN_FAILURE_REPORT_WINDOW_MS`, per user.
const JOIN_FAILURE_LIMIT: usize = 3;
const JOIN_FAILURE_WINDOW: chrono::Duration = chrono::Duration::seconds(60);

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum SessionStatus {
    Active,
    Stopped,
    Failed(String),
}

/// One `EgressSession` row of the signed-in user.
#[derive(Clone, Debug)]
pub(crate) struct ReplaySession {
    pub id: String,
    pub egress_id: String,
    pub channel_id: String,
    pub started_at: DateTime<Utc>,
    pub ended_at: Option<DateTime<Utc>>,
    pub status: SessionStatus,
    /// Complete segments on disk (10 s each), set by `emit_segments_ready`.
    pub segments: usize,
}

/// One `ReplayClip` row, with its file.
#[derive(Clone, Debug)]
pub(crate) struct Clip {
    pub id: String,
    pub file_id: String,
    pub user_id: String,
    pub channel_id: Option<String>,
    pub duration_seconds: i64,
    pub is_public: bool,
    pub captured_at: DateTime<Utc>,
    pub filename: String,
    pub size: i64,
}

#[derive(Default)]
pub(crate) struct Calls {
    /// DM call presence by DM group, in join order.
    pub dm_voice: BTreeMap<String, Vec<VoicePresenceUserDto>>,
    /// (channel, user) pairs a moderator server-muted; outlives the call, as the backend's key.
    pub server_muted: BTreeSet<(String, String)>,
    /// (community, user) pairs kicked: no longer members.
    pub kicked: BTreeSet<(String, String)>,
    /// The signed-in user's replay sessions, oldest first.
    pub sessions: Vec<ReplaySession>,
    pub clips: Vec<Clip>,
    /// Valid join-failure reports, as the backend logs them.
    pub join_failures: Vec<Value>,
    /// When each user sent a report in the last minute, valid or not (the throttle's count).
    pub join_failure_hits: Vec<(DateTime<Utc>, String)>,
    next: u64,
}

impl Calls {
    /// A fresh id: a UUID, the same on every run for the same sequence of calls.
    pub fn new_id(&mut self, kind: &str) -> String {
        self.next += 1;
        entity_uuid(&format!("fake-{kind}-{}", self.next))
    }

    pub fn next_number(&mut self) -> u64 {
        self.next += 1;
        self.next
    }

    pub fn active_session(&self) -> Option<&ReplaySession> {
        self.sessions
            .iter()
            .rev()
            .find(|session| session.status == SessionStatus::Active)
    }

    pub fn active_session_mut(&mut self) -> Option<&mut ReplaySession> {
        self.sessions
            .iter_mut()
            .rev()
            .find(|session| session.status == SessionStatus::Active)
    }
}

/// An error the way the routes answer it: status, code, message.
pub(crate) type Refusal = (u16, &'static str, String);

fn refuse(status: u16, code: &'static str, message: &str) -> Refusal {
    (status, code, message.to_owned())
}

/// A user as voice presence lists them (`PUBLIC_USER_SELECT`, then `?? undefined`).
pub(crate) fn voice_user(inner: &Inner, user_id: &str) -> VoicePresenceUserDto {
    let user = inner.scenario.user(user_id);
    VoicePresenceUserDto {
        avatar_url: user.and_then(|user| user.avatar_url.clone()),
        display_name: user.and_then(|user| user.display_name.clone()),
        id: user_id.to_owned(),
        is_deafened: false,
        is_server_muted: false,
        joined_at: inner.now(),
        username: user.map_or_else(|| user_id.to_owned(), |user| user.username.clone()),
    }
}

// ----- DM calls --------------------------------------------------------------------------------

/// The DM group's members, or the backend's 403 (`assertDmMember`) when `user_id` isn't one or
/// the group doesn't exist.
pub(crate) fn dm_members_for(
    inner: &Inner,
    group_id: &str,
    user_id: &str,
) -> Result<Vec<String>, Refusal> {
    let members = crate::social::dm_member_ids(&lock(&inner.data), group_id);
    match members {
        Some(members) if members.iter().any(|member| member == user_id) => Ok(members),
        _ => Err(refuse(
            403,
            "FORBIDDEN",
            "You are not a member of this DM group",
        )),
    }
}

/// `GET /dm-groups/{id}/voice-presence`: who is in the call, by join time.
pub(crate) fn dm_presence(inner: &Inner, group_id: &str) -> Value {
    let users = lock(&inner.calls)
        .dm_voice
        .get(group_id)
        .cloned()
        .unwrap_or_default();
    json!({ "dmGroupId": group_id, "count": users.len(), "users": users })
}

/// `VoicePresenceService.handleWebhookDmParticipantJoined`, which the REST refresh also reaches
/// when the user isn't listed: registers them, then tells the DM group's room (every member's
/// sockets, the joiner's own included) `dmVoiceCallStarted` if they're the first, otherwise
/// `dmVoiceUserJoined`. Already listed: nothing (a TTL refresh). `members` is who the room
/// reaches.
pub(crate) fn dm_join(inner: &Inner, group_id: &str, user_id: &str, members: &[String]) {
    let user = voice_user(inner, user_id);
    let first = {
        let mut calls = lock(&inner.calls);
        let users = calls.dm_voice.entry(group_id.to_owned()).or_default();
        if users.iter().any(|listed| listed.id == user_id) {
            return;
        }
        let first = users.is_empty();
        users.push(user.clone());
        first
    };
    if first {
        inner.emit_to_users(
            members,
            "dmVoiceCallStarted",
            json!({
                "dmGroupId": group_id,
                "startedBy": user_id,
                "starter": {
                    "id": user.id,
                    "username": user.username,
                    "displayName": user.display_name,
                    "avatarUrl": user.avatar_url,
                },
            }),
        );
    } else {
        inner.emit_to_users(
            members,
            "dmVoiceUserJoined",
            json!({ "dmGroupId": group_id, "user": user }),
        );
    }
}

/// `VoicePresenceService.leaveDmVoice` (LiveKit's `participant_left`; there's no REST leave):
/// `dmVoiceUserLeft` to the DM group's room. Not listed: nothing. Whether they were.
pub(crate) fn dm_leave(inner: &Inner, group_id: &str, user_id: &str, members: &[String]) -> bool {
    let user = {
        let mut calls = lock(&inner.calls);
        let Some(users) = calls.dm_voice.get_mut(group_id) else {
            return false;
        };
        let Some(index) = users.iter().position(|listed| listed.id == user_id) else {
            return false;
        };
        let user = users.remove(index);
        if users.is_empty() {
            calls.dm_voice.remove(group_id);
        }
        user
    };
    inner.emit_to_users(
        members,
        "dmVoiceUserLeft",
        json!({ "dmGroupId": group_id, "userId": user_id, "user": user }),
    );
    true
}

// ----- Server mute and kick --------------------------------------------------------------------

pub(crate) fn is_server_muted(inner: &Inner, channel_id: &str, user_id: &str) -> bool {
    lock(&inner.calls)
        .server_muted
        .contains(&(channel_id.to_owned(), user_id.to_owned()))
}

/// `LivekitController.muteParticipant` after its checks: remembers the mute (or lifts it), and
/// when the user is in the channel's presence, updates them and sends `voiceChannelUserUpdated`
/// to the channel (`updateServerMuteState`; nobody there: no event).
pub(crate) fn set_server_muted(inner: &Inner, channel_id: &str, user_id: &str, mute: bool) {
    {
        let mut calls = lock(&inner.calls);
        let key = (channel_id.to_owned(), user_id.to_owned());
        if mute {
            calls.server_muted.insert(key);
        } else {
            calls.server_muted.remove(&key);
        }
    }
    let updated = {
        let mut data = lock(&inner.data);
        data.voice
            .get_mut(channel_id)
            .and_then(|users| users.iter_mut().find(|user| user.id == user_id))
            .map(|user| {
                user.is_server_muted = mute;
                user.clone()
            })
    };
    if let Some(user) = updated {
        inner.broadcast(
            "voiceChannelUserUpdated",
            json!({ "channelId": channel_id, "userId": user_id, "user": user }),
        );
    }
}

/// The checks `LivekitAccessService.assertMayServerMute` makes, as far as the fake knows ranks:
/// the channel must exist, and nobody outranks themselves.
pub(crate) fn may_server_mute(
    inner: &Inner,
    channel_id: &str,
    target: &str,
) -> Result<(), Refusal> {
    if inner.scenario.channel(channel_id).is_none() {
        return Err(refuse(404, "NOT_FOUND", "Channel not found"));
    }
    if target == inner.scenario.me.id {
        return Err(refuse(
            403,
            "FORBIDDEN",
            "You can only server mute someone you outrank",
        ));
    }
    Ok(())
}

pub(crate) fn is_member(inner: &Inner, community_id: &str, user_id: &str) -> bool {
    let listed = inner
        .created_members(community_id)
        .map(|members| members.iter().any(|member| member.user_id == user_id))
        .or_else(|| {
            inner
                .scenario
                .memberships
                .get(community_id)
                .map(|members| members.iter().any(|member| member.user_id == user_id))
        })
        .unwrap_or(false);
    listed && !is_kicked(inner, community_id, user_id)
}

pub(crate) fn is_kicked(inner: &Inner, community_id: &str, user_id: &str) -> bool {
    lock(&inner.calls)
        .kicked
        .contains(&(community_id.to_owned(), user_id.to_owned()))
}

/// `ModerationService.kickUser`: `canModerate` (nobody moderates themselves), membership, then
/// `userKicked` to the user, their removal from the community's voice channels
/// (`removeUserFromCommunityVoice`: `voiceChannelUserLeft` for each) and `userKicked` to the
/// community's other members.
pub(crate) fn kick(
    inner: &Inner,
    community_id: &str,
    user_id: &str,
    reason: Option<String>,
) -> Result<(), Refusal> {
    let me = inner.scenario.me.id.clone();
    if user_id == me {
        return Err(refuse(
            403,
            "FORBIDDEN",
            "Cannot kick a user with equal or higher role",
        ));
    }
    if !is_member(inner, community_id, user_id) {
        return Err(refuse(
            404,
            "NOT_FOUND",
            "User is not a member of this community",
        ));
    }
    lock(&inner.calls)
        .kicked
        .insert((community_id.to_owned(), user_id.to_owned()));
    // An absent reason is `undefined` there: no field.
    let mut payload = json!({
        "communityId": community_id,
        "userId": user_id,
        "moderatorId": me,
    });
    if let Some(reason) = reason {
        payload["reason"] = Value::from(reason);
    }
    inner.emit_to_user(user_id, "userKicked", payload.clone());
    let voice_channels: Vec<String> = inner
        .scenario
        .community(community_id)
        .map(|community| {
            community
                .channels
                .iter()
                .filter(|channel| channel.type_ == semaphore_wire::enums::ChannelType::Voice)
                .map(|channel| channel.id.clone())
                .collect()
        })
        .unwrap_or_default();
    for channel_id in voice_channels {
        let left = {
            let mut data = lock(&inner.data);
            data.voice.get_mut(&channel_id).and_then(|users| {
                let index = users.iter().position(|user| user.id == user_id)?;
                Some(users.remove(index))
            })
        };
        if let Some(user) = left {
            inner.broadcast(
                "voiceChannelUserLeft",
                json!({ "channelId": channel_id, "userId": user_id, "user": user }),
            );
        }
    }
    inner.emit_to_others(user_id, "userKicked", payload);
    Ok(())
}

// ----- Replay buffer ---------------------------------------------------------------------------

fn session_ids(session: &ReplaySession) -> Value {
    json!({
        "sessionId": session.id,
        "egressId": session.egress_id,
        "channelId": session.channel_id,
    })
}

/// `LivekitReplayService.startReplayBuffer`: the caller must be in the channel's call (the
/// backend finds their LiveKit participant with the tracks), an active session is stopped first
/// without an event, and the new one starts with no segments.
pub(crate) fn start_replay(inner: &Inner, channel_id: &str) -> Result<Value, Refusal> {
    let me = inner.scenario.me.id.clone();
    let in_call = lock(&inner.data)
        .voice
        .get(channel_id)
        .is_some_and(|users| users.iter().any(|user| user.id == me));
    if !in_call {
        return Err(refuse(
            403,
            "FORBIDDEN",
            "You can only record your own tracks",
        ));
    }
    let now = inner.now();
    let mut calls = lock(&inner.calls);
    if let Some(active) = calls.active_session_mut() {
        active.status = SessionStatus::Stopped;
        active.ended_at = Some(now);
        active.segments = 0;
    }
    let id = calls.new_id("replay-session");
    let egress_id = format!("EG_fake{:06}", calls.next_number());
    calls.sessions.push(ReplaySession {
        id: id.clone(),
        egress_id: egress_id.clone(),
        channel_id: channel_id.to_owned(),
        started_at: now,
        ended_at: None,
        status: SessionStatus::Active,
        segments: 0,
    });
    Ok(json!({ "sessionId": id, "egressId": egress_id, "status": "active" }))
}

/// `stopReplayBuffer`: no event (LiveKit's later `egress_ended` finds the row stopped).
pub(crate) fn stop_replay(inner: &Inner) -> Result<Value, Refusal> {
    let now = inner.now();
    let mut calls = lock(&inner.calls);
    let Some(session) = calls.active_session_mut() else {
        return Err(refuse(
            404,
            "NOT_FOUND",
            "No active replay found. Start screen sharing to record a replay.",
        ));
    };
    session.status = SessionStatus::Stopped;
    session.ended_at = Some(now);
    session.segments = 0;
    Ok(json!({ "sessionId": session.id, "egressId": session.egress_id, "status": "stopped" }))
}

/// `recoverStaleSession` without LiveKit (whose egress is never running here): with no session
/// at all, or one that ended over a day ago, a plain 404; otherwise the stop or fail event the
/// client missed, then a 404 that says the recording ended.
fn recover_stale(inner: &Inner) -> Refusal {
    let recent = lock(&inner.calls).sessions.last().cloned();
    let Some(session) = recent else {
        return refuse(
            404,
            "NOT_FOUND",
            "No active replay found. Start screen sharing first.",
        );
    };
    let ended = session.ended_at.unwrap_or(session.started_at);
    if inner.now() - ended > STALE_NOTIFY_MAX_AGE {
        return refuse(
            404,
            "NOT_FOUND",
            "No active replay found. Start screen sharing first.",
        );
    }
    let me = inner.scenario.me.id.clone();
    let mut payload = session_ids(&session);
    match &session.status {
        SessionStatus::Failed(error) => {
            payload["error"] = Value::from(error.clone());
            inner.emit_to_user(&me, "replayBufferFailed", payload);
        }
        _ => inner.emit_to_user(&me, "replayBufferStopped", payload),
    }
    refuse(
        404,
        "NOT_FOUND",
        "Your replay recording has ended — start screen sharing again to capture.",
    )
}

/// `getSessionInfo`: no active session is `hasActiveSession: false` (after the heal's missed
/// event), an active one without segments says so, and one with segments has its times.
pub(crate) fn session_info(inner: &Inner) -> Value {
    let active = lock(&inner.calls).active_session().cloned();
    let Some(session) = active else {
        let _ = recover_stale(inner);
        return json!({ "hasActiveSession": false });
    };
    if session.segments == 0 {
        return json!({
            "hasActiveSession": true,
            "sessionId": session.id,
            "totalSegments": 0,
            "totalDurationSeconds": 0,
        });
    }
    json!({
        "hasActiveSession": true,
        "sessionId": session.id,
        "totalSegments": session.segments,
        "totalDurationSeconds": session.segments * 10,
        "bufferStartTime": session.started_at,
        "bufferEndTime": inner.now(),
    })
}

/// A segment's file name, as LiveKit's egress writes them (`{time}-segment_00000.ts`).
fn segment_name(session: &ReplaySession, index: usize) -> String {
    format!(
        "{}-segment_{index:05}.ts",
        session.started_at.format("%Y-%m-%dT%H%M%S")
    )
}

/// `getPlaylistContent`: the HLS playlist of every complete segment.
pub(crate) fn playlist(inner: &Inner) -> Result<String, Refusal> {
    let Some(session) = lock(&inner.calls).active_session().cloned() else {
        return Err(refuse(
            404,
            "NOT_FOUND",
            "No active replay found. Start screen sharing first.",
        ));
    };
    if session.segments == 0 {
        return Err(refuse(
            400,
            "BAD_REQUEST",
            "Your replay is still warming up. Please wait a few seconds and try again.",
        ));
    }
    let mut lines = vec![
        "#EXTM3U".to_owned(),
        "#EXT-X-VERSION:3".to_owned(),
        "#EXT-X-TARGETDURATION:10".to_owned(),
        "#EXT-X-MEDIA-SEQUENCE:0".to_owned(),
        "#EXT-X-PLAYLIST-TYPE:EVENT".to_owned(),
    ];
    for index in 0..session.segments {
        lines.push("#EXTINF:10.0,".to_owned());
        lines.push(format!(
            "/api/livekit/replay/preview/segment/{}",
            segment_name(&session, index)
        ));
    }
    lines.push("#EXT-X-ENDLIST".to_owned());
    Ok(lines.join("\n"))
}

/// `ReplaySegmentsService.getSegmentPath`'s checks, then the segment's bytes: MPEG-TS null
/// packets, 54 of them (10 152 bytes, over the 10 kB a complete segment has), the first byte
/// after each sync byte carrying the segment's index so two segments differ.
pub(crate) fn segment(inner: &Inner, file: &str) -> Result<Vec<u8>, Refusal> {
    let Some(session) = lock(&inner.calls).active_session().cloned() else {
        return Err(refuse(
            404,
            "NOT_FOUND",
            "No active replay found. Start screen sharing first.",
        ));
    };
    let valid = file.ends_with(".ts")
        && file.len() > 3
        && file[..file.len() - 3]
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    if !valid || file.contains("..") || file.contains('/') {
        return Err(refuse(
            400,
            "BAD_REQUEST",
            "That replay segment is not valid.",
        ));
    }
    let Some(index) = (0..session.segments).find(|index| segment_name(&session, *index) == file)
    else {
        return Err(refuse(
            404,
            "NOT_FOUND",
            "That part of the replay is no longer available.",
        ));
    };
    let mut bytes = Vec::with_capacity(188 * 54);
    for _ in 0..54 {
        let mut packet = [0xffu8; 188];
        packet[0] = 0x47;
        packet[1] = 0x1f;
        packet[2] = 0xff;
        packet[3] = 0x10;
        packet[4] = index as u8;
        bytes.extend_from_slice(&packet);
    }
    Ok(bytes)
}

/// A capture's request, already validated as `CaptureReplayDto` is.
pub(crate) struct Capture {
    pub duration_minutes: Option<i64>,
    pub start_seconds: Option<i64>,
    pub end_seconds: Option<i64>,
    pub destination: String,
    pub target_channel_id: Option<String>,
    pub target_dm_id: Option<String>,
}

/// Validates a capture body as `CaptureReplayDto`'s decorators do. A `durationMinutes` is only
/// checked when neither `startSeconds` nor `endSeconds` is truthy (`ValidateIf`), so a `0` start
/// still checks it.
pub(crate) fn parse_capture(body: &Value) -> Result<Capture, String> {
    let present = |name: &str| body.get(name).filter(|value| !value.is_null());
    let truthy = |name: &str| {
        present(name).is_some_and(|value| match value {
            Value::Bool(flag) => *flag,
            Value::Number(number) => number.as_f64() != Some(0.0),
            Value::String(text) => !text.is_empty(),
            _ => true,
        })
    };
    let integer = |name: &str, min: i64| -> Result<Option<i64>, String> {
        match present(name) {
            None => Ok(None),
            Some(value) => {
                let number = value
                    .as_i64()
                    .or_else(|| value.as_str().and_then(|text| text.parse().ok()))
                    .ok_or_else(|| format!("{name} must be an integer number"))?;
                if number < min {
                    return Err(format!("{name} must not be less than {min}"));
                }
                Ok(Some(number))
            }
        }
    };
    let duration_minutes = match present("durationMinutes") {
        Some(value) if !truthy("startSeconds") && !truthy("endSeconds") => {
            match value
                .as_i64()
                .filter(|minutes| [1, 2, 5, 10].contains(minutes))
            {
                Some(minutes) => Some(minutes),
                None => return Err("Duration must be 1, 2, 5, or 10 minutes".to_owned()),
            }
        }
        Some(value) => value.as_i64(),
        None => None,
    };
    let (start_seconds, end_seconds) = if duration_minutes.filter(|m| *m != 0).is_none() {
        (integer("startSeconds", 0)?, integer("endSeconds", 1)?)
    } else {
        (
            present("startSeconds").and_then(Value::as_i64),
            present("endSeconds").and_then(Value::as_i64),
        )
    };
    let destination = body
        .get("destination")
        .and_then(Value::as_str)
        .filter(|destination| ["library", "dm", "channel"].contains(destination))
        .ok_or("Destination must be library, dm, or channel")?
        .to_owned();
    let uuid_field = |name: &str| -> Result<Option<String>, String> {
        let value = body.get(name).and_then(Value::as_str);
        match value {
            Some(id) if uuid::Uuid::parse_str(id).is_ok() && id.len() == 36 => {
                Ok(Some(id.to_owned()))
            }
            _ => Err(format!("{name} must be a UUID")),
        }
    };
    let target_channel_id = if destination == "channel" {
        uuid_field("targetChannelId")?
    } else {
        body.get("targetChannelId")
            .and_then(Value::as_str)
            .map(str::to_owned)
    };
    let target_dm_id = if destination == "dm" {
        uuid_field("targetDirectMessageGroupId")?
    } else {
        body.get("targetDirectMessageGroupId")
            .and_then(Value::as_str)
            .map(str::to_owned)
    };
    Ok(Capture {
        duration_minutes,
        start_seconds,
        end_seconds,
        destination,
        target_channel_id,
        target_dm_id,
    })
}

/// Stores a clip's file (`REPLAY_CLIP`, `video/mp4`, the fixture's bytes) and its row.
pub(crate) fn store_clip(
    inner: &Inner,
    user_id: &str,
    channel_id: Option<String>,
    duration_seconds: i64,
    is_public: bool,
    id: Option<String>,
) -> Clip {
    let now = inner.now();
    let (clip_id, file_id) = {
        let mut calls = lock(&inner.calls);
        let clip_id = id.unwrap_or_else(|| calls.new_id("clip"));
        (clip_id, calls.new_id("clip-file"))
    };
    let filename = format!("replay-{}.mp4", now.timestamp_millis());
    lock(&inner.data).files.insert(
        file_id.clone(),
        crate::StoredFile {
            uploaded_by: user_id.to_owned(),
            resource_type: "REPLAY_CLIP".to_owned(),
            filename: filename.clone(),
            mime_type: "video/mp4".to_owned(),
            bytes: CLIP_MP4.to_vec(),
        },
    );
    let clip = Clip {
        id: clip_id,
        file_id,
        user_id: user_id.to_owned(),
        channel_id,
        duration_seconds,
        is_public,
        captured_at: now,
        filename,
        size: CLIP_MP4.len() as i64,
    };
    lock(&inner.calls).clips.push(clip.clone());
    clip
}

/// `ClipMessageListener.handleClipMessageCreate`: a message with the clip's file, as its author,
/// announced as any new message is. Its id.
fn post_clip_message(
    inner: &Inner,
    clip: &Clip,
    destination: &str,
    target_channel_id: Option<&str>,
    target_dm_id: Option<&str>,
) -> Option<String> {
    let target = match (destination, target_channel_id, target_dm_id) {
        ("channel", Some(channel), _) => crate::messages::PostTarget::Channel(channel),
        ("dm", _, Some(group)) => crate::messages::PostTarget::DirectMessage(group),
        _ => return None,
    };
    let size_mb = (clip.size as f64 / 1024.0 / 1024.0).round() as i64;
    let extras = crate::messages::PostExtras {
        attachments: vec![semaphore_wire::types::AttachmentDto {
            file_type: semaphore_wire::enums::FileType::Video,
            filename: clip.filename.clone(),
            has_thumbnail: false,
            id: clip.file_id.clone(),
            mime_type: "video/mp4".to_owned(),
            size: clip.size,
        }],
        ..Default::default()
    };
    let message = crate::messages::post_as(
        inner,
        target,
        &clip.user_id,
        &format!("Replay clip - {}s ({size_mb}MB)", clip.duration_seconds),
        true,
        extras,
    );
    Some(message.id)
}

/// Whether a capture or a share may post where it asks, as the clip services check: the channel
/// must exist (the fake's user may post in every channel), and a DM must be theirs.
fn check_destination(
    inner: &Inner,
    destination: &str,
    target_channel_id: Option<&str>,
    target_dm_id: Option<&str>,
    messages: (&str, &str),
) -> Result<(), Refusal> {
    if destination == "channel"
        && let Some(channel) = target_channel_id
        && inner.scenario.channel(channel).is_none()
    {
        return Err((404, "NOT_FOUND", messages.0.to_owned()));
    }
    if destination == "dm"
        && let Some(group) = target_dm_id
    {
        let me = inner.scenario.me.id.clone();
        let member = crate::social::dm_member_ids(&lock(&inner.data), group)
            .is_some_and(|members| members.contains(&me));
        if !member {
            return Err((403, "FORBIDDEN", messages.1.to_owned()));
        }
    }
    Ok(())
}

/// `streamReplay`: the active session (or the heal's 404) and at least one segment, as for a
/// capture; the bytes are the fixture MP4, and nothing is stored.
pub(crate) fn stream_replay(inner: &Inner) -> Result<Vec<u8>, Refusal> {
    let active = lock(&inner.calls).active_session().cloned();
    let Some(session) = active else {
        return Err(recover_stale(inner));
    };
    if session.segments == 0 {
        return Err(refuse(
            400,
            "BAD_REQUEST",
            "Your replay is still warming up. Keep sharing your screen for a few seconds, then try again.",
        ));
    }
    Ok(CLIP_MP4.to_vec())
}

/// `captureReplay`: the active session (or the heal's 404), at least one segment, the range
/// (custom when both ends are given, otherwise the last N minutes, 1 by default), then the clip,
/// and only then the destination's checks, as the backend orders them: a refused destination
/// leaves the clip in the library. Durations are the segments' (10 s each), clamped as the
/// backend clamps them.
pub(crate) fn capture(inner: &Inner, capture: Capture) -> Result<Value, Refusal> {
    let active = lock(&inner.calls).active_session().cloned();
    let Some(session) = active else {
        return Err(recover_stale(inner));
    };
    if session.segments == 0 {
        return Err(refuse(
            400,
            "BAD_REQUEST",
            "Your replay is still warming up. Keep sharing your screen for a few seconds, then try again.",
        ));
    }
    let available = session.segments as i64;
    let (duration, requested) = match (capture.start_seconds, capture.end_seconds) {
        (Some(start), Some(end)) => {
            if start >= end {
                return Err(refuse(
                    400,
                    "BAD_REQUEST",
                    "Start time must be before end time",
                ));
            }
            let start_index = start / 10;
            let end_index = (end + 9) / 10;
            let clamped_start = start_index.min((available - 1).max(0));
            let clamped_end = end_index.min(available);
            if clamped_start >= clamped_end {
                return Err(refuse(
                    400,
                    "BAD_REQUEST",
                    "That part of the replay is no longer available. Try a more recent time range.",
                ));
            }
            let start_offset = start - clamped_start * 10;
            let exact = end.min(clamped_end * 10) - start;
            // A start past the buffer clamps to its last segment and leaves no length: the
            // backend hands ffmpeg that negative duration; the fake refuses it as out of range.
            if exact <= 0 {
                return Err(refuse(
                    400,
                    "BAD_REQUEST",
                    "That part of the replay is no longer available. Try a more recent time range.",
                ));
            }
            let segments = clamped_end - clamped_start;
            let duration = if start_offset > 0 || exact != segments * 10 {
                exact
            } else {
                segments * 10
            };
            (duration, end - start)
        }
        _ => {
            let minutes = capture.duration_minutes.filter(|m| *m != 0).unwrap_or(1);
            ((minutes * 6).min(available) * 10, minutes * 60)
        }
    };
    let me = inner.scenario.me.id.clone();
    let clip = store_clip(
        inner,
        &me,
        Some(session.channel_id.clone()),
        duration,
        false,
        None,
    );
    check_destination(
        inner,
        &capture.destination,
        capture.target_channel_id.as_deref(),
        capture.target_dm_id.as_deref(),
        (
            "That channel could not be found.",
            "You don't have permission to post in that conversation.",
        ),
    )?;
    let message_id = post_clip_message(
        inner,
        &clip,
        &capture.destination,
        capture.target_channel_id.as_deref(),
        capture.target_dm_id.as_deref(),
    );
    let mut body = json!({
        "clipId": clip.id,
        "fileId": clip.file_id,
        "durationSeconds": clip.duration_seconds,
        "requestedDurationSeconds": requested,
        "sizeBytes": clip.size,
        "downloadUrl": format!("/file/{}", clip.file_id),
    });
    if let Some(message_id) = message_id {
        body["messageId"] = Value::from(message_id);
    }
    Ok(body)
}

/// LiveKit ending the egress (`handleEgressEnded`): the active session becomes stopped or
/// failed, its segments go, and its owner hears `replayBufferStopped` or `replayBufferFailed`.
/// No active session: nothing. Whether there was one.
pub(crate) fn end_replay(inner: &Inner, error: Option<String>) -> bool {
    let now = inner.now();
    let ended = {
        let mut calls = lock(&inner.calls);
        let Some(session) = calls.active_session_mut() else {
            return false;
        };
        session.status = match &error {
            Some(error) => SessionStatus::Failed(error.clone()),
            None => SessionStatus::Stopped,
        };
        session.ended_at = Some(now);
        session.segments = 0;
        session.clone()
    };
    let me = inner.scenario.me.id.clone();
    let mut payload = session_ids(&ended);
    match error {
        Some(error) => {
            payload["error"] = Value::from(error);
            inner.emit_to_user(&me, "replayBufferFailed", payload);
        }
        None => inner.emit_to_user(&me, "replayBufferStopped", payload),
    }
    true
}

/// Segments reaching the disk: the active session now has `segments` complete ones, and its
/// owner hears `egressSegmentsReady` (`checkAndNotifySegmentsReady`). No active session: nothing.
pub(crate) fn segments_ready(inner: &Inner, segments: usize) -> bool {
    let ready = {
        let mut calls = lock(&inner.calls);
        let Some(session) = calls.active_session_mut() else {
            return false;
        };
        session.segments = segments;
        session.clone()
    };
    let me = inner.scenario.me.id.clone();
    inner.emit_to_user(
        &me,
        "egressSegmentsReady",
        json!({ "sessionId": ready.id, "channelId": ready.channel_id }),
    );
    true
}

// ----- Clip library ----------------------------------------------------------------------------

/// `ClipResponseDto`.
pub(crate) fn clip_json(clip: &Clip) -> Value {
    json!({
        "id": clip.id,
        "fileId": clip.file_id,
        "channelId": clip.channel_id,
        "durationSeconds": clip.duration_seconds,
        "isPublic": clip.is_public,
        "capturedAt": clip.captured_at,
        "downloadUrl": format!("/file/{}", clip.file_id),
        "sizeBytes": clip.size,
        "filename": clip.filename,
    })
}

/// A user's clips, newest first; `public_only` for someone else's profile.
pub(crate) fn clips_of(inner: &Inner, user_id: &str, public_only: bool) -> Value {
    let mut clips: Vec<Clip> = lock(&inner.calls)
        .clips
        .iter()
        .filter(|clip| clip.user_id == user_id && (!public_only || clip.is_public))
        .cloned()
        .collect();
    clips.sort_by_key(|clip| std::cmp::Reverse(clip.captured_at));
    Value::Array(clips.iter().map(clip_json).collect())
}

fn clip_not_found() -> Refusal {
    refuse(404, "NOT_FOUND", "Clip not found or access denied")
}

/// `updateClip`: one of mine, with `isPublic` when it's given.
pub(crate) fn update_clip(
    inner: &Inner,
    clip_id: &str,
    is_public: Option<bool>,
) -> Result<Value, Refusal> {
    let me = inner.scenario.me.id.clone();
    let mut calls = lock(&inner.calls);
    let clip = calls
        .clips
        .iter_mut()
        .find(|clip| clip.id == clip_id && clip.user_id == me)
        .ok_or_else(clip_not_found)?;
    if let Some(is_public) = is_public {
        clip.is_public = is_public;
    }
    Ok(clip_json(clip))
}

/// `deleteClip`: the row and its file.
pub(crate) fn delete_clip(inner: &Inner, clip_id: &str) -> Result<(), Refusal> {
    let me = inner.scenario.me.id.clone();
    let file_id = {
        let mut calls = lock(&inner.calls);
        let index = calls
            .clips
            .iter()
            .position(|clip| clip.id == clip_id && clip.user_id == me)
            .ok_or_else(clip_not_found)?;
        calls.clips.remove(index).file_id
    };
    lock(&inner.data).files.remove(&file_id);
    Ok(())
}

/// `shareClip`: one of mine, posted where it's sent.
pub(crate) fn share_clip(
    inner: &Inner,
    clip_id: &str,
    destination: &str,
    target_channel_id: Option<&str>,
    target_dm_id: Option<&str>,
) -> Result<Value, Refusal> {
    let me = inner.scenario.me.id.clone();
    let clip = lock(&inner.calls)
        .clips
        .iter()
        .find(|clip| clip.id == clip_id && clip.user_id == me)
        .cloned()
        .ok_or_else(clip_not_found)?;
    check_destination(
        inner,
        destination,
        target_channel_id,
        target_dm_id,
        (
            "Target channel not found",
            "You are not a member of the target DM group",
        ),
    )?;
    let message_id = post_clip_message(inner, &clip, destination, target_channel_id, target_dm_id)
        .ok_or_else(|| {
            refuse(
                500,
                "INTERNAL",
                "CLIP_MESSAGE_CREATE listener returned no messageId (was the error suppressed?)",
            )
        })?;
    Ok(json!({ "messageId": message_id, "clipId": clip.id, "destination": destination }))
}

// ----- Join failures ---------------------------------------------------------------------------

/// `JoinFailureThrottleGuard`: counts this report, before it's validated, and is `false` past
/// `JOIN_FAILURE_LIMIT` in the last minute (of the fake's clock).
pub(crate) fn throttle_join_failure(inner: &Inner, user_id: &str) -> bool {
    let now = inner.now();
    let mut calls = lock(&inner.calls);
    calls
        .join_failure_hits
        .retain(|(at, _)| now - *at < JOIN_FAILURE_WINDOW);
    calls.join_failure_hits.push((now, user_id.to_owned()));
    calls
        .join_failure_hits
        .iter()
        .filter(|(_, user)| user == user_id)
        .count()
        <= JOIN_FAILURE_LIMIT
}

/// `reportJoinFailure` logs a valid report; the fake keeps it for `FakeServer::join_failures`.
pub(crate) fn keep_join_failure(inner: &Inner, report: Value) {
    lock(&inner.calls).join_failures.push(report);
}

/// Validates a join-failure report as `ReportJoinFailureDto` does, truncating `message` (500),
/// `os` and `appVersion` (64) as its transforms do. The report as kept.
pub(crate) fn parse_join_failure(body: &Value) -> Result<Value, String> {
    const CLASSES: &[&str] = &[
        "media_unreachable",
        "server_unreachable",
        "permission",
        "not_found",
        "session",
        "server_error",
        "unknown",
    ];
    const CANDIDATES: &[&str] = &["host", "srflx", "prflx", "relay"];
    const PLATFORMS: &[&str] = &["web", "electron"];
    let one_of = |name: &str, allowed: &[&str]| -> Result<String, String> {
        body.get(name)
            .and_then(Value::as_str)
            .filter(|value| allowed.contains(value))
            .map(str::to_owned)
            .ok_or_else(|| {
                format!(
                    "{name} must be one of the following values: {}",
                    allowed.join(", ")
                )
            })
    };
    let truncated = |name: &str, max: usize, required: bool| -> Result<Option<String>, String> {
        match body.get(name) {
            None | Some(Value::Null) if !required => Ok(None),
            Some(Value::String(text)) => Ok(Some(text.chars().take(max).collect())),
            _ => Err(format!("{name} must be a string")),
        }
    };
    let error_class = one_of("errorClass", CLASSES)?;
    let message = truncated("message", 500, true)?;
    let duration_ms = body
        .get("durationMs")
        .and_then(Value::as_i64)
        .ok_or("durationMs must be an integer number")?;
    if !(0..=600_000).contains(&duration_ms) {
        return Err("durationMs must not be less than 0 or greater than 600000".to_owned());
    }
    let candidate_types = match body.get("candidateTypes") {
        None | Some(Value::Null) => None,
        Some(Value::Array(items)) => {
            if items.len() > CANDIDATES.len() {
                return Err("candidateTypes must contain no more than 4 elements".to_owned());
            }
            if !items
                .iter()
                .all(|item| item.as_str().is_some_and(|kind| CANDIDATES.contains(&kind)))
            {
                return Err(
                    "each value in candidateTypes must be one of the following values: host, srflx, prflx, relay"
                        .to_owned(),
                );
            }
            Some(items.clone())
        }
        Some(_) => return Err("candidateTypes must be an array".to_owned()),
    };
    let platform = one_of("platform", PLATFORMS)?;
    let os = truncated("os", 64, false)?;
    let app_version = truncated("appVersion", 64, true)?;
    let channel_id = match body.get("channelId") {
        None | Some(Value::Null) => None,
        Some(Value::String(id)) if id.chars().count() <= 64 => Some(id.clone()),
        Some(Value::String(_)) => {
            return Err("channelId must be shorter than or equal to 64 characters".to_owned());
        }
        Some(_) => return Err("channelId must be a string".to_owned()),
    };
    let is_dm = body
        .get("isDm")
        .and_then(Value::as_bool)
        .ok_or("isDm must be a boolean value")?;
    Ok(json!({
        "errorClass": error_class,
        "message": message,
        "durationMs": duration_ms,
        "candidateTypes": candidate_types,
        "platform": platform,
        "os": os,
        "appVersion": app_version,
        // Logged without the channel for a DM, as the controller does.
        "channelId": if is_dm { None } else { channel_id },
        "isDm": is_dm,
    }))
}

/// The `seed_clip` control's body: `userId` (default the signed-in user), `id`, `channelId`,
/// `durationSeconds` (default 30), `isPublic` (default false).
pub(crate) fn seed_clip_from(inner: &Inner, request: &Value) -> Result<Clip, &'static str> {
    let field = |name: &str| request.get(name).and_then(Value::as_str).map(str::to_owned);
    let user_id = field("userId").unwrap_or_else(|| inner.scenario.me.id.clone());
    if inner.scenario.user(&user_id).is_none() {
        return Err("userId is not a user of the scenario");
    }
    Ok(store_clip(
        inner,
        &user_id,
        field("channelId"),
        request
            .get("durationSeconds")
            .and_then(Value::as_i64)
            .unwrap_or(30),
        request
            .get("isPublic")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        field("id"),
    ))
}
