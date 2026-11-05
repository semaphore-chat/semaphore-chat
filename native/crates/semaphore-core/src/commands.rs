//! What a UI can ask core to do and read back. Frozen by U0; unit U5 fills in the bodies. Until
//! then a command fails with `CoreError::Unavailable` and a read returns "nothing yet".
//!
//! Commands return once core has accepted them. Their results arrive as `CoreEvent`s.

use crate::client::Core;
use crate::model::{
    ChannelRow, CommunityRow, Conversation, MentionCandidate, MessageDraft, SessionState, VoiceView,
};
use crate::platform::CoreError;
use crate::realtime::RealtimeEvent;

fn not_yet(what: &str) -> CoreError {
    CoreError::Unavailable { what: what.into() }
}

impl Core {
    pub async fn sign_in(
        &self,
        _server_url: String,
        _username: String,
        _password: String,
    ) -> Result<(), CoreError> {
        Err(not_yet("sign_in"))
    }

    pub async fn sign_out(&self) -> Result<(), CoreError> {
        Err(not_yet("sign_out"))
    }

    /// Makes this the conversation on screen, and sends its rows as `ListOp::Reset`.
    pub async fn open_conversation(&self, _conversation: Conversation) -> Result<(), CoreError> {
        Err(not_yet("open_conversation"))
    }

    /// Loads older rows, sent as `ListOp::Insert { index: 0, .. }`. A no-op at the start.
    pub async fn load_older(&self, _conversation: Conversation) -> Result<(), CoreError> {
        Err(not_yet("load_older"))
    }

    /// While a selection is held, core keeps that span of rows loaded. `None` releases it.
    pub fn hold_rows(&self, _conversation: Conversation, _seq_range: Option<(i64, i64)>) {}

    /// Adds a pending row at once and returns its client nonce.
    pub async fn send_message(
        &self,
        _conversation: Conversation,
        _draft: MessageDraft,
    ) -> Result<String, CoreError> {
        Err(not_yet("send_message"))
    }

    /// Retries with the same nonce, so the server can't create a second message.
    pub async fn retry_send(&self, _client_nonce: String) -> Result<(), CoreError> {
        Err(not_yet("retry_send"))
    }

    pub async fn toggle_reaction(
        &self,
        _message_id: String,
        _emoji: String,
    ) -> Result<(), CoreError> {
        Err(not_yet("toggle_reaction"))
    }

    pub async fn mark_read(
        &self,
        _conversation: Conversation,
        _message_id: String,
    ) -> Result<(), CoreError> {
        Err(not_yet("mark_read"))
    }

    pub async fn join_voice(&self, _channel_id: String) -> Result<(), CoreError> {
        Err(not_yet("join_voice"))
    }

    pub async fn leave_voice(&self) -> Result<(), CoreError> {
        Err(not_yet("leave_voice"))
    }

    pub async fn set_muted(&self, _muted: bool) -> Result<(), CoreError> {
        Err(not_yet("set_muted"))
    }

    pub async fn set_deafened(&self, _deafened: bool) -> Result<(), CoreError> {
        Err(not_yet("set_deafened"))
    }

    /// The transport hands every event here. Not part of a UI's surface.
    pub fn ingest(&self, _event: RealtimeEvent) {}

    pub fn session(&self) -> SessionState {
        SessionState::default()
    }

    pub fn communities(&self) -> Vec<CommunityRow> {
        Vec::new()
    }

    pub fn channels(&self, _community_id: String) -> Vec<ChannelRow> {
        Vec::new()
    }

    pub fn mention_candidates(
        &self,
        _community_id: String,
        _query: String,
    ) -> Vec<MentionCandidate> {
        Vec::new()
    }

    pub fn voice(&self) -> VoiceView {
        VoiceView::default()
    }
}
