//! UniFFI exports over `semaphore_core`: the proof that a SwiftUI or Compose app could hold `Core`.
//!
//! The records and enums are declared with `#[uniffi::remote]`, which repeats each definition and
//! fails to compile if it stops matching core's. That is the point: a change to the frozen view
//! models that UniFFI can't express, such as a generic or a lifetime, breaks this crate at once.
//!
//! What isn't here: `Backend` and `Realtime`. Their signatures use wire types, and a mobile app has
//! still to choose between implementing them natively and linking `semaphore-net`, which needs a C
//! toolchain per target. So `SemaphoreCore::new` builds a core with no services: state and lifecycle
//! work, and commands fail with `CoreError::Unavailable`.

use semaphore_core::cache::QueryKey;
use semaphore_core::model::{
    AttachmentKind, AttachmentView, ChannelKind, ChannelPermissions, ChannelRow, CommunityRow,
    ConnectionQuality, Conversation, DisplayRole, DraftFile, DraftMention, EmojiView, ErrorView,
    LinkPreviewView, ListOp, LoadState, MemberList, MemberView, MentionCandidate, MentionKind,
    MessageDraft, MessageLink, MessageRow, ParticipantView, PinnedList, PinnedRow, RailCounts,
    ReactionUsers, ReactionView, ReplyToView, SearchHit, SearchScope, SegKind, SendState,
    SessionState, TextSeg, TextStyle, ThreadInfo, UnreadMarker, UploadView, UserView, VideoDemand,
    VideoTrackView, ViewKey, VoiceStatus, VoiceView, WebhookView,
};
use semaphore_core::platform::{Clock, EventSink};
use semaphore_core::{ConnectionState, Core, CoreError, CoreEvent, NetworkState, ResyncPlan};
use std::sync::Arc;

uniffi::setup_scaffolding!("semaphore");

// W1: each part exports its commands in an `#[uniffi::export] impl SemaphoreCore` block of its own
// file. UniFFI takes any number of such blocks for one object.
mod actions;
mod reading;

#[uniffi::remote(Enum)]
pub enum Conversation {
    Channel { id: String },
    DirectMessage { id: String },
    Thread { parent_message_id: String },
}

#[uniffi::remote(Record)]
pub struct UserView {
    pub id: String,
    pub username: String,
    pub display_name: Option<String>,
    pub avatar_file_id: Option<String>,
}

#[uniffi::remote(Record)]
pub struct ErrorView {
    pub code: String,
    pub message: String,
    pub retryable: bool,
    pub retry_after_ms: Option<u64>,
}

#[uniffi::remote(Enum)]
pub enum SessionState {
    SignedOut,
    SigningIn,
    SignedIn { me: UserView },
    SignInFailed { error: ErrorView },
}

#[uniffi::remote(Record)]
pub struct CommunityRow {
    pub id: String,
    pub name: String,
    pub avatar_file_id: Option<String>,
    pub unread_count: u32,
    pub mention_count: u32,
}

#[uniffi::remote(Enum)]
pub enum ChannelKind {
    Text,
    Voice,
    Unknown,
}

#[uniffi::remote(Record)]
pub struct ChannelRow {
    pub id: String,
    pub community_id: String,
    pub name: String,
    pub kind: ChannelKind,
    pub is_private: bool,
    pub position: i32,
    pub unread_count: u32,
    pub mention_count: u32,
    pub voice_users: Vec<UserView>,
    pub slowmode_seconds: u32,
    pub permissions: Option<ChannelPermissions>,
}

#[uniffi::remote(Record)]
pub struct ChannelPermissions {
    pub post: bool,
    pub attach: bool,
    pub react: bool,
    pub thread_reply: bool,
    pub connect: bool,
    pub speak: bool,
    pub video: bool,
    pub share: bool,
    pub manage_permissions: bool,
    pub posting_role_names: Vec<String>,
    pub timed_out_until_ms: Option<i64>,
}

#[uniffi::remote(Record)]
pub struct TextStyle {
    pub bold: bool,
    pub italic: bool,
    pub strikethrough: bool,
    pub code: bool,
}

#[uniffi::remote(Enum)]
pub enum SegKind {
    Text,
    Link { url: String },
    UserMention { user_id: String },
    SpecialMention { kind: String },
    CommunityMention { community_id: String },
    AliasMention { alias_id: String },
    ChannelMention { channel_id: String },
    Emoji { emoji_id: String, name: String },
    CodeBlock,
}

#[uniffi::remote(Record)]
pub struct TextSeg {
    pub end: u32,
    pub kind: SegKind,
    pub style: TextStyle,
}

#[uniffi::remote(Enum)]
pub enum AttachmentKind {
    Image,
    Video,
    Audio,
    Document,
    Other,
}

#[uniffi::remote(Record)]
pub struct AttachmentView {
    pub file_id: String,
    pub filename: String,
    pub mime_type: String,
    pub size_bytes: u64,
    pub kind: AttachmentKind,
    pub has_thumbnail: bool,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

#[uniffi::remote(Record)]
pub struct ReactionView {
    pub emoji: String,
    pub count: u32,
    pub me: bool,
    pub user_ids: Vec<String>,
    pub custom_emoji_id: Option<String>,
}

#[uniffi::remote(Record)]
pub struct ReplyToView {
    pub message_id: String,
    pub author: UserView,
    pub text: String,
    pub deleted: bool,
}

#[uniffi::remote(Record)]
pub struct WebhookView {
    pub id: String,
    pub name: String,
    pub avatar_url: Option<String>,
}

#[uniffi::remote(Record)]
pub struct LinkPreviewView {
    pub url: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub image_url: Option<String>,
    pub site_name: Option<String>,
    pub favicon_url: Option<String>,
    pub author_name: Option<String>,
}

#[uniffi::remote(Enum)]
pub enum SendState {
    Sent,
    Pending,
    Failed { error: ErrorView },
}

#[uniffi::remote(Record)]
pub struct MessageRow {
    pub seq: i64,
    pub id: Option<String>,
    pub client_nonce: Option<String>,
    pub author: UserView,
    pub sent_at_ms: i64,
    pub edited: bool,
    pub mine: bool,
    pub edit_pending: bool,
    pub removed: bool,
    pub removed_by: Option<UserView>,
    pub removed_reason: Option<String>,
    pub display: String,
    pub segs: Vec<TextSeg>,
    pub attachments: Vec<AttachmentView>,
    pub reactions: Vec<ReactionView>,
    pub reply_count: u32,
    pub last_reply_at_ms: Option<i64>,
    pub reply_to: Option<ReplyToView>,
    pub link_previews: Vec<LinkPreviewView>,
    pub pinned: bool,
    pub pinned_by: Option<UserView>,
    pub pinned_at_ms: Option<i64>,
    pub webhook: Option<WebhookView>,
    pub send_state: SendState,
    pub pending_attachments: u32,
    pub uploads: Vec<UploadView>,
    pub revision: u64,
}

#[uniffi::remote(Record)]
pub struct UploadView {
    pub name: String,
    pub size_bytes: u64,
    pub sent_bytes: u64,
    pub failed: Option<ErrorView>,
}

#[uniffi::remote(Record)]
pub struct DraftFile {
    pub name: String,
    pub mime_type: String,
    pub bytes: Vec<u8>,
}

#[uniffi::remote(Enum)]
pub enum ListOp {
    Reset { rows: Vec<MessageRow> },
    Insert { index: u32, rows: Vec<MessageRow> },
    Remove { index: u32, count: u32 },
    Replace { index: u32, rows: Vec<MessageRow> },
}

#[uniffi::remote(Enum)]
pub enum MentionKind {
    User,
    Special,
    Alias,
    Channel,
    Community,
    Emoji,
}

#[uniffi::remote(Record)]
pub struct MentionCandidate {
    pub kind: MentionKind,
    pub id: String,
    pub label: String,
    pub insert_text: String,
    pub avatar_file_id: Option<String>,
}

#[uniffi::remote(Record)]
pub struct DraftMention {
    pub start: u32,
    pub end: u32,
    pub kind: MentionKind,
    pub id: String,
}

#[uniffi::remote(Record)]
pub struct MessageDraft {
    pub text: String,
    pub mentions: Vec<DraftMention>,
    pub reply_to_message_id: Option<String>,
    pub files: Vec<DraftFile>,
}

#[uniffi::remote(Record)]
pub struct EmojiView {
    pub id: String,
    pub name: String,
    pub file_id: String,
}

#[uniffi::remote(Record)]
pub struct DisplayRole {
    pub name: String,
    pub position: i32,
}

#[uniffi::remote(Record)]
pub struct MemberView {
    pub user: UserView,
    pub status: Option<String>,
    pub online: bool,
    pub display_role: Option<DisplayRole>,
}

#[uniffi::remote(Record)]
pub struct MemberList {
    pub members: Vec<MemberView>,
    pub truncated: bool,
}

#[uniffi::remote(Record)]
pub struct RailCounts {
    pub dm_unread: u32,
    pub notifications_unread: u32,
}

#[uniffi::remote(Enum)]
pub enum VoiceStatus {
    Disconnected,
    Connecting,
    Connected,
    Reconnecting,
}

#[uniffi::remote(Record)]
pub struct VideoTrackView {
    pub track_sid: String,
    pub width: u32,
    pub height: u32,
}

#[uniffi::remote(Enum)]
pub enum ConnectionQuality {
    Unknown,
    Excellent,
    Good,
    Poor,
    Lost,
}

#[uniffi::remote(Record)]
pub struct VideoDemand {
    pub track_sid: String,
    pub width_px: u32,
    pub height_px: u32,
    pub focused: bool,
}

#[uniffi::remote(Record)]
pub struct ParticipantView {
    pub identity: String,
    pub user: UserView,
    pub is_self: bool,
    pub speaking: bool,
    pub muted: bool,
    pub deafened: bool,
    pub camera: Option<VideoTrackView>,
    pub screen_share: Option<VideoTrackView>,
    pub quality: ConnectionQuality,
}

#[uniffi::remote(Record)]
pub struct VoiceView {
    pub status: VoiceStatus,
    pub channel_id: Option<String>,
    pub muted: bool,
    pub deafened: bool,
    pub participants: Vec<ParticipantView>,
    pub reconnect_attempt: Option<u32>,
    pub error: Option<String>,
}

#[uniffi::remote(Enum)]
pub enum ViewKey {
    Session,
    Communities,
    Channels { community_id: String },
    Mentionables { community_id: String },
    Members { community_id: String },
    Rail,
    Voice,
    Typing { conversation: Conversation },
    Pins { channel_id: String },
    ReactionUsers { message_id: String, emoji: String },
    Thread { parent_message_id: String },
    UnreadMarker { conversation: Conversation },
}

#[uniffi::remote(Enum)]
pub enum LoadState {
    Loading,
    Ready,
    Failed { error: ErrorView },
}

#[uniffi::remote(Record)]
pub struct ReactionUsers {
    pub users: Vec<UserView>,
    pub more: u32,
}

#[uniffi::remote(Record)]
pub struct PinnedRow {
    pub row: MessageRow,
    pub parent_message_id: Option<String>,
}

#[uniffi::remote(Record)]
pub struct PinnedList {
    pub state: LoadState,
    pub rows: Vec<PinnedRow>,
}

#[uniffi::remote(Record)]
pub struct ThreadInfo {
    pub state: LoadState,
    pub subscribed: bool,
    pub reply_count: u32,
    pub last_reply_at_ms: Option<i64>,
}

#[uniffi::remote(Enum)]
pub enum SearchScope {
    Channel { id: String },
    DirectMessage { id: String },
    Community { id: String },
}

#[uniffi::remote(Record)]
pub struct SearchHit {
    pub row: MessageRow,
    pub conversation: Conversation,
    pub parent_message_id: Option<String>,
    pub channel_name: Option<String>,
}

#[uniffi::remote(Record)]
pub struct UnreadMarker {
    pub after_message_id: String,
    pub after_seq: Option<i64>,
    pub unread_count: u32,
    pub mention_count: u32,
}

#[uniffi::remote(Record)]
pub struct MessageLink {
    pub community_id: Option<String>,
    pub conversation: Conversation,
    pub message_id: Option<String>,
}

#[uniffi::remote(Record)]
pub struct QueryKey {
    pub segments: Vec<String>,
}

#[uniffi::remote(Enum)]
pub enum ConnectionState {
    Disconnected,
    Connected,
    Suspended,
    Offline,
}

#[uniffi::remote(Enum)]
pub enum NetworkState {
    Available,
    Unavailable,
}

#[uniffi::remote(Record)]
pub struct ResyncPlan {
    pub reconnect_socket: bool,
    pub refresh_token: bool,
    pub stale_queries: Vec<QueryKey>,
}

#[uniffi::remote(Enum)]
pub enum CoreEvent {
    ConnectionChanged {
        state: ConnectionState,
    },
    QueriesInvalidated {
        keys: Vec<QueryKey>,
    },
    ViewChanged {
        view: ViewKey,
    },
    MessagesChanged {
        conversation: Conversation,
        ops: Vec<ListOp>,
    },
}

#[uniffi::remote(Error)]
pub enum CoreError {
    Unavailable { what: String },
    Failed { message: String },
}

/// Pushed out of core to the app, across the language boundary.
#[uniffi::export(with_foreign)]
pub trait CoreListener: Send + Sync {
    fn on_event(&self, event: CoreEvent);
}

/// Wall clock in Unix milliseconds, from the platform.
#[uniffi::export(with_foreign)]
pub trait WallClock: Send + Sync {
    fn now_ms(&self) -> u64;
}

struct ListenerSink(Arc<dyn CoreListener>);

impl EventSink for ListenerSink {
    fn on_event(&self, event: CoreEvent) {
        self.0.on_event(event);
    }
}

struct ForeignClock(Arc<dyn WallClock>);

impl Clock for ForeignClock {
    fn now_ms(&self) -> u64 {
        self.0.now_ms()
    }
}

/// `Core`, as a foreign language holds it.
#[derive(uniffi::Object)]
pub struct SemaphoreCore {
    core: Core,
}

#[uniffi::export]
impl SemaphoreCore {
    #[uniffi::constructor]
    pub fn new(clock: Arc<dyn WallClock>, listener: Arc<dyn CoreListener>) -> Arc<Self> {
        Arc::new(Self {
            core: Core::new(
                Arc::new(ForeignClock(clock)),
                Arc::new(ListenerSink(listener)),
            ),
        })
    }

    pub fn connection(&self) -> ConnectionState {
        self.core.connection()
    }

    pub fn suspend(&self) {
        self.core.suspend();
    }

    pub fn resume(&self) -> ResyncPlan {
        self.core.resume()
    }

    pub fn network_changed(&self, network: NetworkState) -> ResyncPlan {
        self.core.network_changed(network)
    }

    pub fn set_focused(&self, focused: bool) {
        self.core.set_focused(focused);
    }

    pub fn session(&self) -> SessionState {
        self.core.session()
    }

    pub fn communities(&self) -> Vec<CommunityRow> {
        self.core.communities()
    }

    pub fn channels(&self, community_id: String) -> Vec<ChannelRow> {
        self.core.channels(community_id)
    }

    pub fn mention_candidates(&self, community_id: String, query: String) -> Vec<MentionCandidate> {
        self.core.mention_candidates(community_id, query)
    }

    pub fn typing_users(&self, conversation: Conversation) -> Vec<UserView> {
        self.core.typing_users(conversation)
    }

    pub fn voice(&self) -> VoiceView {
        self.core.voice()
    }

    pub fn members(&self, community_id: String) -> Option<MemberList> {
        self.core.members(community_id)
    }

    pub fn rail_counts(&self) -> RailCounts {
        self.core.rail_counts()
    }

    pub fn custom_emojis(&self, community_id: String) -> Vec<EmojiView> {
        self.core.custom_emojis(community_id)
    }

    pub fn at_live_edge(&self, conversation: Conversation) -> bool {
        self.core.at_live_edge(conversation)
    }

    pub fn hold_rows(&self, conversation: Conversation, start: i64, end: i64) {
        self.core.hold_rows(conversation, Some((start, end)));
    }

    pub fn release_rows(&self, conversation: Conversation) {
        self.core.hold_rows(conversation, None);
    }

    /// Runs background work. An app calls this once, and leaves it running for the core's life.
    pub async fn drive(&self) {
        self.core.drive().await;
    }

    pub fn shutdown(&self) {
        self.core.shutdown();
    }

    pub async fn sign_in(
        &self,
        server_url: String,
        username: String,
        password: String,
    ) -> Result<(), CoreError> {
        self.core.sign_in(server_url, username, password).await
    }

    pub async fn sign_out(&self) -> Result<(), CoreError> {
        self.core.sign_out().await
    }

    pub async fn open_conversation(&self, conversation: Conversation) -> Result<(), CoreError> {
        self.core.open_conversation(conversation).await
    }

    pub async fn load_older(&self, conversation: Conversation) -> Result<(), CoreError> {
        self.core.load_older(conversation).await
    }

    pub async fn load_newer(&self, conversation: Conversation) -> Result<(), CoreError> {
        self.core.load_newer(conversation).await
    }

    pub async fn jump_to_present(&self, conversation: Conversation) -> Result<(), CoreError> {
        self.core.jump_to_present(conversation).await
    }

    pub async fn open_conversation_at(
        &self,
        conversation: Conversation,
        message_id: String,
    ) -> Result<(), CoreError> {
        self.core
            .open_conversation_at(conversation, message_id)
            .await
    }

    pub async fn send_message(
        &self,
        conversation: Conversation,
        draft: MessageDraft,
    ) -> Result<String, CoreError> {
        self.core.send_message(conversation, draft).await
    }

    pub async fn retry_send(&self, client_nonce: String) -> Result<(), CoreError> {
        self.core.retry_send(client_nonce).await
    }

    pub async fn discard_failed_send(&self, client_nonce: String) -> Result<(), CoreError> {
        self.core.discard_failed_send(client_nonce).await
    }

    pub async fn retry_upload(&self, client_nonce: String, index: u32) -> Result<(), CoreError> {
        self.core.retry_upload(client_nonce, index).await
    }

    pub async fn remove_upload(&self, client_nonce: String, index: u32) -> Result<(), CoreError> {
        self.core.remove_upload(client_nonce, index).await
    }

    pub async fn file(&self, file_id: String, thumbnail: bool) -> Result<Vec<u8>, CoreError> {
        self.core.file(file_id, thumbnail).await
    }

    pub async fn join_voice(&self, channel_id: String) -> Result<(), CoreError> {
        self.core.join_voice(channel_id).await
    }

    pub async fn leave_voice(&self) -> Result<(), CoreError> {
        self.core.leave_voice().await
    }

    pub fn set_video_demands(&self, demands: Vec<VideoDemand>) {
        self.core.set_video_demands(demands);
    }

    pub fn ingest_media(&self, call: u64, media: VoiceView) {
        self.core.ingest_media(call, media);
    }

    pub async fn voice_token(&self) -> Result<String, CoreError> {
        self.core.voice_token().await
    }

    pub async fn refresh_voice_presence(&self) {
        self.core.refresh_voice_presence().await;
    }

    pub async fn set_muted(&self, muted: bool) -> Result<(), CoreError> {
        self.core.set_muted(muted).await
    }

    pub async fn set_deafened(&self, deafened: bool) -> Result<(), CoreError> {
        self.core.set_deafened(deafened).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    struct FixedClock;
    impl WallClock for FixedClock {
        fn now_ms(&self) -> u64 {
            1_000
        }
    }

    #[derive(Default)]
    struct Listener(Mutex<Vec<CoreEvent>>);
    impl CoreListener for Listener {
        fn on_event(&self, event: CoreEvent) {
            self.0.lock().unwrap().push(event);
        }
    }

    #[test]
    fn events_reach_a_foreign_listener_through_the_exported_object() {
        let listener = Arc::new(Listener::default());
        let core = SemaphoreCore::new(Arc::new(FixedClock), listener.clone());
        core.suspend();
        assert_eq!(core.connection(), ConnectionState::Suspended);
        assert!(core.resume().reconnect_socket);
        let seen = listener.0.lock().unwrap();
        assert_eq!(
            *seen,
            vec![
                CoreEvent::ConnectionChanged {
                    state: ConnectionState::Suspended
                },
                CoreEvent::ConnectionChanged {
                    state: ConnectionState::Disconnected
                },
            ]
        );
    }

    #[test]
    fn with_no_services_a_read_is_empty() {
        let core = SemaphoreCore::new(Arc::new(FixedClock), Arc::new(Listener::default()));
        assert!(core.communities().is_empty());
        assert_eq!(core.session(), SessionState::SignedOut);
    }
}
