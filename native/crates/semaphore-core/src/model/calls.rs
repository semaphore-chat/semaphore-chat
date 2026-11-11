//! W4: DM calls ringing, sound cues and moderator voice actions.

use super::UserView;

/// How long an incoming call rings before it gives up, as on the web.
pub const RING_MS: u64 = 30_000;

/// A DM or group DM call ringing for me. One at a time: a newer ring replaces it. It stops on
/// accept, decline (local only: the caller isn't told), `expires_at_ms`, my joining that call on any
/// device, the caller giving up (the call's presence empties), or sign-out.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IncomingCallView {
    pub dm_group_id: String,
    /// The group's name as the DM list shows it, or the caller's name when it isn't known.
    pub group_name: String,
    pub caller: UserView,
    pub started_at_ms: u64,
    /// `started_at_ms + RING_MS`. The host calls `Core::expire_incoming_call` then: core has no
    /// timers.
    pub expires_at_ms: u64,
}

/// A sound core decided to play (`CoreEvent::Sound`). The host maps each to the web's file.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SoundCue {
    /// Someone else joined the call I'm in (`voiceUserJoined`).
    UserJoined,
    /// Someone else left it (`voiceUserLeft`).
    UserLeft,
    /// I joined a call (`connected`).
    Connected,
    /// I left one, or it ended (`disconnected`).
    Disconnected,
    /// A call started ringing: loop `incomingCall` until `IncomingRingStop`.
    IncomingRingStart,
    IncomingRingStop,
    /// The DM call I was in ended because everyone else left (`callEnded`).
    CallEnded,
}

/// What this user may do to others in a voice channel, from their community roles (as the web's
/// `useCanPerformAction`). The server still refuses someone they don't outrank.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct VoiceModerationCaps {
    /// MUTE_PARTICIPANT: server mute and lift it.
    pub can_server_mute: bool,
    /// KICK_USER: remove from the community, which ends their call.
    pub can_kick: bool,
}
