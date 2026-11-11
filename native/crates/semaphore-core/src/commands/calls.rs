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
//! (2026-11-11), who may overrule: decline tells nobody; group DMs ring every member.

use std::sync::Arc;

use crate::client::Core;
use crate::model::IncomingCallView;
use crate::platform::{CoreError, KeepAwake};
use crate::resync::unavailable;

/// W4's state. `keep_awake` outlives sessions; the rest goes at sign-out.
#[derive(Default)]
pub struct W4State {
    pub(crate) incoming: Option<IncomingCallView>,
}

/// W4's signed-out platform seams.
#[derive(Default)]
pub struct W4Platform {
    /// Never set the same way twice in a row: W4-core keeps what it last set beside it.
    pub(crate) keep_awake: Option<Arc<dyn KeepAwake>>,
}

impl Core {
    /// The platform's sleep inhibitor, held while a call runs.
    pub fn set_keep_awake(&self, keep_awake: Arc<dyn KeepAwake>) {
        self.write(|state, _| state.w4_platform.keep_awake = Some(keep_awake));
    }

    /// Joins this DM or group DM's call, leaving any other call first. Fails as `join_voice` does;
    /// a blocked 1:1 DM is the server's refusal.
    pub async fn join_dm_call(&self, _dm_group_id: String) -> Result<(), CoreError> {
        Err(unavailable("DM calls"))
    }

    /// The call ringing now, if any (`ViewKey::IncomingCall`).
    pub fn incoming_call(&self) -> Option<IncomingCallView> {
        self.read(|state| state.w4.incoming.clone())
    }

    /// Answers the ringing call: stops the ring and joins it (`join_dm_call`).
    pub async fn accept_incoming_call(&self) -> Result<(), CoreError> {
        Err(unavailable("answering a call"))
    }

    /// Stops the ring. The caller isn't told.
    pub fn decline_incoming_call(&self) {}

    /// The host calls this at the ring's `expires_at_ms`: a ring past it stops. Does nothing
    /// otherwise, so calling it early or twice is harmless.
    pub fn expire_incoming_call(&self) {}
}
