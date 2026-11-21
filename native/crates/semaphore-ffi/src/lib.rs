//! UniFFI exports over `semaphore_core`: the surface a SwiftUI or Compose app holds `Core` through.
//!
//! The records and enums are declared with `#[uniffi::remote]`, which repeats each definition and
//! fails to compile if it stops matching core's. That is the point: a change to the frozen view
//! models that UniFFI can't express, such as a generic or a lifetime, breaks this crate at once.
//!
//! What isn't here: `Backend` and `Realtime`. Their signatures use wire types, and the real ones
//! live in `semaphore-net`, which compiles C (ring) for every target. So this crate stays
//! core-only: `SemaphoreCore::new` builds a core with no services (state and lifecycle work,
//! commands fail with `CoreError::Unavailable`), and a host crate that links `semaphore-net`
//! (`semaphore-mobile`) builds a networked core and hands it over with
//! [`SemaphoreCore::with_runtime`].
//!
//! # Where the work runs
//!
//! A networked core needs a Tokio runtime: reqwest and the socket spawn onto, and register their
//! I/O with, whatever runtime they run in. A foreign caller has none, so every export goes through
//! one of two helpers, and nothing else touches the core:
//!
//! - [`SemaphoreCore::run`] (async exports) spawns the command onto the host's runtime and awaits
//!   its result. Dropping the awaiting future, as a cancelled Kotlin coroutine or Swift task does,
//!   leaves the command running to the end. A command cut in half could leave a sign-in stuck
//!   half way, or drop a rotated refresh token before it is stored.
//! - [`SemaphoreCore::sync`] (sync exports) runs on the caller's thread inside the runtime's
//!   context, because `resume` and `network_changed` reach the socket, which spawns.
//!
//! Without a runtime (a core from `new`) both run the call in place, as before.

use semaphore_core::cache::QueryKey;
use semaphore_core::model::{
    AttachmentKind, AttachmentView, ChannelKind, ChannelModeration, ChannelModerationView,
    ChannelPermissions, ChannelRow, CommunityRow, ConnectionQuality, Conversation, DisplayRole,
    DraftFile, DraftMention, EmojiView, ErrorView, LinkPreviewView, ListOp, LoadState,
    LocalMediaView, LocalShare, MemberList, MemberView, MentionCandidate, MentionKind,
    MessageDraft, MessageLink, MessageRow, ParticipantView, PinnedList, PinnedRow, RailCounts,
    ReactionUsers, ReactionView, ReplyToView, ScreenShareRequest, SearchHit, SearchScope, SegKind,
    SendState, SessionState, ShareResolution, TextSeg, TextStyle, ThreadInfo, UnreadMarker,
    UploadView, UserView, VideoDemand, VideoTrackView, ViewKey, VoiceStatus, VoiceView,
    WebhookView,
};
use semaphore_core::model::{ChannelPreset, RemovalCause, RestoreOutcome};
use semaphore_core::model::{ReplayState, ShareTracks, SoundCue, VoiceRoom};
use semaphore_core::platform::{Clock, EventSink};
use semaphore_core::{ConnectionState, Core, CoreError, CoreEvent, NetworkState, ResyncPlan};
use std::sync::Arc;

uniffi::setup_scaffolding!("semaphore");

// W1: each part exports its commands in an `#[uniffi::export] impl SemaphoreCore` block of its own
// file. UniFFI takes any number of such blocks for one object.
mod account;
mod actions;
mod admin_w5a;
mod admin_w5b;
mod admin_w6;
mod design;
mod dms;
mod gifs_w7;
mod notify;
mod onboarding;
mod profile;
mod reading;
mod social;
mod voice_w4;

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
    pub preset: ChannelPreset,
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
    pub image_host: Option<String>,
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
    pub gif: Option<semaphore_core::model::GifEmbed>,
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
    pub joined_at_ms: Option<i64>,
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
    pub screen_share_audio: bool,
    pub quality: ConnectionQuality,
    pub server_muted: bool,
    pub volume_percent: u32,
    pub screen_share_volume_percent: u32,
}

#[uniffi::remote(Record)]
pub struct VoiceView {
    pub status: VoiceStatus,
    pub channel_id: Option<String>,
    pub room: Option<VoiceRoom>,
    pub muted: bool,
    pub deafened: bool,
    pub participants: Vec<ParticipantView>,
    pub reconnect_attempt: Option<u32>,
    pub error: Option<String>,
    pub local: LocalMediaView,
    pub server_muted: bool,
    pub replay: ReplayState,
    pub replay_audio_wait_until_ms: Option<u64>,
}

#[uniffi::remote(Enum)]
pub enum LocalShare {
    Off,
    Starting,
    On,
    Failed { message: String },
}

#[uniffi::remote(Record)]
pub struct LocalMediaView {
    pub camera: LocalShare,
    pub screen: LocalShare,
    pub screen_audio: LocalShare,
    pub may_camera: bool,
    pub may_share: bool,
    pub may_speak: bool,
    pub screen_tracks: Option<ShareTracks>,
    pub soundboard: Option<String>,
}

#[uniffi::remote(Enum)]
pub enum ShareResolution {
    Native,
    P2160,
    P1440,
    P1080,
    P720,
    P480,
}

#[uniffi::remote(Record)]
pub struct ScreenShareRequest {
    pub source_id: Option<String>,
    pub resolution: ShareResolution,
    pub fps: u32,
    pub audio: bool,
}

#[uniffi::remote(Enum)]
pub enum ViewKey {
    Session,
    Communities,
    Channels {
        community_id: String,
    },
    Mentionables {
        community_id: String,
    },
    Members {
        community_id: String,
    },
    Rail,
    Voice,
    Typing {
        conversation: Conversation,
    },
    Pins {
        channel_id: String,
    },
    ReactionUsers {
        message_id: String,
        emoji: String,
    },
    Thread {
        parent_message_id: String,
    },
    UnreadMarker {
        conversation: Conversation,
    },
    ChannelModeration {
        channel_id: String,
    },
    DirectMessages,
    Friends,
    Notifications,
    NotificationSettings,
    ChannelNotifyLevel {
        channel_id: String,
    },
    Badge,
    Profile {
        user_id: String,
    },
    ProfileEdit,
    Sessions,
    Appearance,
    InvitePreview {
        code: String,
    },
    BrowserSignIn,
    InstancePermissions,
    IncomingCall,
    Soundboard {
        community_id: String,
    },
    Clips,
    UserClips {
        user_id: String,
    },
    ReplaySession,
    Search {
        scope: SearchScope,
        query: String,
    },
    DmPeerReads {
        dm_group_id: String,
    },
    SeenBy {
        conversation: Conversation,
        message_id: String,
    },
    VoiceDiagnostics,
    CommunitySettings {
        community_id: String,
    },
    PrivateMembers {
        channel_id: String,
    },
    AliasGroups {
        community_id: String,
    },
    AliasGroup {
        group_id: String,
    },
    CustomEmoji {
        community_id: String,
    },
    Webhooks {
        channel_id: String,
    },
    Invites,
    CommunityPermissions {
        community_id: String,
    },
    Roles {
        community_id: String,
    },
    RoleMembers {
        community_id: String,
        role_id: String,
    },
    MemberRoles {
        community_id: String,
        user_id: String,
    },
    ChannelOverwrites {
        channel_id: String,
    },
    ModerationTarget {
        community_id: String,
        user_id: String,
    },
    Bans {
        community_id: String,
    },
    Timeouts {
        community_id: String,
    },
    ModerationLog {
        community_id: String,
    },
    AdminDashboard,
    InstanceSettings,
    AdminUsers {
        query: semaphore_core::model::AdminUserQuery,
    },
    AdminUser {
        user_id: String,
    },
    AdminUserRoles {
        user_id: String,
    },
    AdminStorage {
        min_percent: u32,
    },
    AdminCommunities {
        search: String,
    },
    AdminCommunity {
        community_id: String,
    },
    AdminInvites,
    InstanceRoles,
    InstanceRoleUsers {
        role_id: String,
    },
    Gifs {
        query: String,
    },
}

#[uniffi::remote(Record)]
pub struct ChannelModeration {
    pub pin: bool,
    pub unpin: bool,
    pub remove_any: bool,
}

#[uniffi::remote(Record)]
pub struct ChannelModerationView {
    pub state: LoadState,
    pub allowed: ChannelModeration,
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
pub enum RestoreOutcome {
    SignedIn,
    NoSession,
    Refused,
    Unreachable { error: ErrorView },
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
    Notify {
        notification: semaphore_core::model::OsNotification,
    },
    WithdrawNotifications {
        tag: String,
    },
    DesktopSignedIn {
        ip_address: Option<String>,
        at_ms: i64,
    },
    Sound {
        cue: SoundCue,
    },
    CommunityRemoved {
        community_id: String,
        name: String,
        cause: RemovalCause,
    },
    ChannelRemoved {
        community_id: String,
        channel_id: String,
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
    /// The host's runtime, for a networked core. `None` for a core from `new`.
    runtime: Option<tokio::runtime::Handle>,
}

/// What an async export returns when its command can't run, because the host's runtime has shut
/// down. A runtime that shuts down never runs a task it was handed after that.
pub trait Abandoned {
    fn abandoned() -> Self;
}

impl<T> Abandoned for Result<T, CoreError> {
    fn abandoned() -> Self {
        Err(CoreError::Unavailable {
            what: "the core has shut down".to_owned(),
        })
    }
}

impl Abandoned for () {
    fn abandoned() -> Self {}
}

impl<T> Abandoned for Option<T> {
    fn abandoned() -> Self {
        None
    }
}

/// The views some async exports return: what each shows with nothing loaded.
macro_rules! abandoned_by_default {
    ($($view:ty),* $(,)?) => {
        $(impl Abandoned for $view {
            fn abandoned() -> Self {
                <$view>::default()
            }
        })*
    };
}

abandoned_by_default!(
    semaphore_core::model::RoleMembersView,
    semaphore_core::model::NotificationSettingsView,
    semaphore_core::model::InvitePreviewView,
    semaphore_core::model::InstanceRoleUsersView,
    semaphore_core::model::InstanceRolesView,
    semaphore_core::model::InstancePermissionsView,
    semaphore_core::model::ClipsView,
    semaphore_core::model::AliasGroupsView,
    semaphore_core::model::AdminUserView,
    semaphore_core::model::AdminInvitesView,
    semaphore_core::model::AdminCommunityView,
    semaphore_core::model::AdminCommunitiesView,
);

impl SemaphoreCore {
    /// A networked core for a host that links the transports (`semaphore-mobile`). Spawns core's
    /// driver on `runtime` at once, so the exported `drive` does nothing for this core; and every
    /// command runs there from now on (see the module docs).
    ///
    /// Also runs the retry timer desktop runs next to its driver (`semaphore-app`'s
    /// `services.rs`): failed queries a view shows come back when their wait is over, re-read or
    /// not (`semaphore_core::retry`). Both tasks end with the runtime.
    ///
    /// Not exported: a foreign caller can't hold a `Core` or a runtime.
    pub fn with_runtime(core: Core, runtime: tokio::runtime::Handle) -> Arc<Self> {
        let driver = core.clone();
        runtime.spawn(async move { driver.drive().await });
        let retrying = core.clone();
        runtime.spawn(async move {
            loop {
                // Never longer than `MAX_TIMER_MS`, so a failure recorded meanwhile is seen in
                // time; with nothing failed it only looks.
                let due_in = retrying
                    .retry_due_queries()
                    .unwrap_or(semaphore_core::retry::MAX_TIMER_MS)
                    .clamp(1, semaphore_core::retry::MAX_TIMER_MS);
                tokio::time::sleep(std::time::Duration::from_millis(due_in)).await;
            }
        });
        Arc::new(Self {
            core,
            runtime: Some(runtime),
        })
    }

    /// The core itself, for the host crate's own Rust code.
    pub fn core(&self) -> &Core {
        &self.core
    }

    /// Runs an async command on the host's runtime and waits for it; see the module docs. The
    /// task outlives the returned future: dropping that only stops waiting.
    pub(crate) async fn run<F, Fut, R>(&self, command: F) -> R
    where
        F: FnOnce(Core) -> Fut,
        Fut: std::future::Future<Output = R> + Send + 'static,
        R: Abandoned + Send + 'static,
    {
        let core = self.core.clone();
        match &self.runtime {
            None => command(core).await,
            Some(runtime) => {
                let task = {
                    // Building the future may itself reach the runtime.
                    let _entered = runtime.enter();
                    runtime.spawn(command(core))
                };
                match task.await {
                    Ok(result) => result,
                    Err(error) if error.is_panic() => std::panic::resume_unwind(error.into_panic()),
                    Err(_) => R::abandoned(),
                }
            }
        }
    }

    /// Runs a sync call on the caller's thread, inside the host's runtime when there is one.
    pub(crate) fn sync<R>(&self, call: impl FnOnce(&Core) -> R) -> R {
        let _entered = self.runtime.as_ref().map(tokio::runtime::Handle::enter);
        call(&self.core)
    }
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
            runtime: None,
        })
    }

    pub fn connection(&self) -> ConnectionState {
        self.sync(move |core| core.connection())
    }

    pub fn suspend(&self) {
        self.sync(move |core| {
            core.suspend();
        })
    }

    pub fn resume(&self) -> ResyncPlan {
        self.sync(move |core| core.resume())
    }

    pub fn network_changed(&self, network: NetworkState) -> ResyncPlan {
        self.sync(move |core| core.network_changed(network))
    }

    pub fn set_focused(&self, focused: bool) {
        self.sync(move |core| {
            core.set_focused(focused);
        })
    }

    pub fn session(&self) -> SessionState {
        self.sync(move |core| core.session())
    }

    pub fn communities(&self) -> Vec<CommunityRow> {
        self.sync(move |core| core.communities())
    }

    pub fn channels(&self, community_id: String) -> Vec<ChannelRow> {
        self.sync(move |core| core.channels(community_id))
    }

    pub fn mention_candidates(&self, community_id: String, query: String) -> Vec<MentionCandidate> {
        self.sync(move |core| core.mention_candidates(community_id, query))
    }

    pub fn typing_users(&self, conversation: Conversation) -> Vec<UserView> {
        self.sync(move |core| core.typing_users(conversation))
    }

    pub fn voice(&self) -> VoiceView {
        self.sync(move |core| core.voice())
    }

    pub fn members(&self, community_id: String) -> Option<MemberList> {
        self.sync(move |core| core.members(community_id))
    }

    pub fn rail_counts(&self) -> RailCounts {
        self.sync(move |core| core.rail_counts())
    }

    /// Whether a list has arrived (`Communities`, `Channels`, `Members`), so a UI can tell an
    /// empty list from one still loading. Anything else reads as `Ready`.
    pub fn load_state(&self, view: ViewKey) -> LoadState {
        self.sync(move |core| core.load_state(view))
    }

    pub fn custom_emojis(&self, community_id: String) -> Vec<EmojiView> {
        self.sync(move |core| core.custom_emojis(community_id))
    }

    pub fn at_live_edge(&self, conversation: Conversation) -> bool {
        self.sync(move |core| core.at_live_edge(conversation))
    }

    pub fn hold_rows(&self, conversation: Conversation, start: i64, end: i64) {
        self.sync(move |core| {
            core.hold_rows(conversation, Some((start, end)));
        })
    }

    pub fn release_rows(&self, conversation: Conversation) {
        self.sync(move |core| {
            core.hold_rows(conversation, None);
        })
    }

    /// Runs background work. An app calls this once, and leaves it running for the core's life.
    /// A networked core (`semaphore-mobile`'s) already drives itself: this returns at once.
    pub async fn drive(&self) {
        if self.runtime.is_none() {
            self.run(|core| async move { core.drive().await }).await;
        }
    }

    /// Ends `drive`. A networked core (`semaphore-mobile`'s) belongs to its host, whose own
    /// `shutdown` stops the driver, the socket and the runtime in order: here it is refused, so
    /// nothing is left half running.
    pub fn shutdown(&self) -> Result<(), CoreError> {
        if self.runtime.is_some() {
            return Err(CoreError::Unavailable {
                what: "shutting down a networked core: its host does (MobileHost.shutdown)".into(),
            });
        }
        self.sync(move |core| {
            core.shutdown();
        });
        Ok(())
    }

    pub async fn sign_in(
        &self,
        server_url: String,
        username: String,
        password: String,
    ) -> Result<(), CoreError> {
        self.run(move |core| async move { core.sign_in(server_url, username, password).await })
            .await
    }

    /// Resumes the session stored for `server_url` at an earlier run, with no password. A host
    /// that remembers the last server (`semaphore-mobile`) calls this at start.
    pub async fn restore_session(&self, server_url: String) -> Result<RestoreOutcome, CoreError> {
        self.run(move |core| async move { core.restore_session(server_url).await })
            .await
    }

    pub async fn sign_out(&self) -> Result<(), CoreError> {
        self.run(move |core| async move { core.sign_out().await })
            .await
    }

    pub async fn open_conversation(&self, conversation: Conversation) -> Result<(), CoreError> {
        self.run(move |core| async move { core.open_conversation(conversation).await })
            .await
    }

    pub async fn load_older(&self, conversation: Conversation) -> Result<(), CoreError> {
        self.run(move |core| async move { core.load_older(conversation).await })
            .await
    }

    pub async fn load_newer(&self, conversation: Conversation) -> Result<(), CoreError> {
        self.run(move |core| async move { core.load_newer(conversation).await })
            .await
    }

    pub async fn jump_to_present(&self, conversation: Conversation) -> Result<(), CoreError> {
        self.run(move |core| async move { core.jump_to_present(conversation).await })
            .await
    }

    pub async fn open_conversation_at(
        &self,
        conversation: Conversation,
        message_id: String,
    ) -> Result<(), CoreError> {
        self.run(
            move |core| async move { core.open_conversation_at(conversation, message_id).await },
        )
        .await
    }

    pub async fn send_message(
        &self,
        conversation: Conversation,
        draft: MessageDraft,
    ) -> Result<String, CoreError> {
        self.run(move |core| async move { core.send_message(conversation, draft).await })
            .await
    }

    pub async fn retry_send(&self, client_nonce: String) -> Result<(), CoreError> {
        self.run(move |core| async move { core.retry_send(client_nonce).await })
            .await
    }

    pub async fn discard_failed_send(&self, client_nonce: String) -> Result<(), CoreError> {
        self.run(move |core| async move { core.discard_failed_send(client_nonce).await })
            .await
    }

    pub async fn retry_upload(&self, client_nonce: String, index: u32) -> Result<(), CoreError> {
        self.run(move |core| async move { core.retry_upload(client_nonce, index).await })
            .await
    }

    pub async fn remove_upload(&self, client_nonce: String, index: u32) -> Result<(), CoreError> {
        self.run(move |core| async move { core.remove_upload(client_nonce, index).await })
            .await
    }

    pub async fn file(&self, file_id: String, thumbnail: bool) -> Result<Vec<u8>, CoreError> {
        self.run(move |core| async move { core.file(file_id, thumbnail).await })
            .await
    }

    pub async fn join_voice(&self, channel_id: String) -> Result<(), CoreError> {
        self.run(move |core| async move { core.join_voice(channel_id).await })
            .await
    }

    pub async fn join_voice_with(
        &self,
        channel_id: String,
        options: semaphore_core::model::VoiceJoinOptions,
    ) -> Result<(), CoreError> {
        self.run(move |core| async move { core.join_voice_with(channel_id, options).await })
            .await
    }

    pub fn voice_prejoin(
        &self,
        community_id: String,
        channel_id: String,
    ) -> semaphore_core::model::VoicePreJoinView {
        self.sync(move |core| core.voice_prejoin(community_id, channel_id))
    }

    pub async fn leave_voice(&self) -> Result<(), CoreError> {
        self.run(move |core| async move { core.leave_voice().await })
            .await
    }

    pub fn set_video_demands(&self, demands: Vec<VideoDemand>) {
        self.sync(move |core| {
            core.set_video_demands(demands);
        })
    }

    pub fn ingest_media(&self, call: u64, media: VoiceView) {
        self.sync(move |core| {
            core.ingest_media(call, media);
        })
    }

    pub async fn voice_token(&self) -> Result<String, CoreError> {
        self.run(move |core| async move { core.voice_token().await })
            .await
    }

    pub async fn refresh_voice_presence(&self) {
        self.run(move |core| async move {
            core.refresh_voice_presence().await;
        })
        .await
    }

    pub async fn set_muted(&self, muted: bool) -> Result<(), CoreError> {
        self.run(move |core| async move { core.set_muted(muted).await })
            .await
    }

    pub async fn set_deafened(&self, deafened: bool) -> Result<(), CoreError> {
        self.run(move |core| async move { core.set_deafened(deafened).await })
            .await
    }

    pub async fn set_camera(&self, on: bool) -> Result<(), CoreError> {
        self.run(move |core| async move { core.set_camera(on).await })
            .await
    }

    pub async fn start_screen_share(&self, request: ScreenShareRequest) -> Result<(), CoreError> {
        self.run(move |core| async move { core.start_screen_share(request).await })
            .await
    }

    pub async fn stop_screen_share(&self) -> Result<(), CoreError> {
        self.run(move |core| async move { core.stop_screen_share().await })
            .await
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

    /// Every export goes through `run` or `sync`, so a networked core's commands run on its
    /// runtime: a direct `self.core.x()` would work in these tests (no runtime needed without
    /// services) and panic or race in the app. A source check, because no test of a service-less
    /// core can tell the difference.
    #[test]
    fn every_export_goes_through_run_or_sync() {
        let parts = [
            ("lib.rs", include_str!("lib.rs")),
            ("account.rs", include_str!("account.rs")),
            ("actions.rs", include_str!("actions.rs")),
            ("admin_w5a.rs", include_str!("admin_w5a.rs")),
            ("admin_w5b.rs", include_str!("admin_w5b.rs")),
            ("admin_w6.rs", include_str!("admin_w6.rs")),
            ("design.rs", include_str!("design.rs")),
            ("dms.rs", include_str!("dms.rs")),
            ("gifs_w7.rs", include_str!("gifs_w7.rs")),
            ("notify.rs", include_str!("notify.rs")),
            ("onboarding.rs", include_str!("onboarding.rs")),
            ("profile.rs", include_str!("profile.rs")),
            ("reading.rs", include_str!("reading.rs")),
            ("social.rs", include_str!("social.rs")),
            ("voice_w4.rs", include_str!("voice_w4.rs")),
        ];
        let listed = std::fs::read_dir(concat!(env!("CARGO_MANIFEST_DIR"), "/src"))
            .unwrap()
            .count();
        assert_eq!(listed, parts.len(), "a new part file must be listed here");
        let needle = ["self", ".core"].concat();
        // Split, so this file's own test doesn't match itself.
        let export = ["#[uniffi", "::export"].concat();
        let (mut asyncs, mut runs, mut syncs) = (0, 0, 0);
        for (name, source) in parts {
            // The tests below this line build cores of their own. Each file keeps them at its end,
            // so nothing exported is cut off with them.
            let (source, tests) = source.split_once("#[cfg(test)]").unwrap_or((source, ""));
            assert!(
                !tests.contains(export.as_str()),
                "{name}: an export after the test module is never checked; keep the tests last"
            );
            let direct = source.matches(needle.as_str()).count();
            // lib.rs: `run`'s clone, `sync`'s call and the `core()` accessor, all outside the
            // exported blocks.
            let allowed = if name == "lib.rs" { 3 } else { 0 };
            assert_eq!(direct, allowed, "{name} reaches the core directly");
            asyncs += source.matches("pub async fn ").count();
            runs += source.matches("self.run(").count();
            syncs += source.matches("self.sync(").count();
        }
        assert_eq!(asyncs, runs, "every async export awaits `self.run`");
        // Exact, so an export the check stops seeing fails here: change these with the exports.
        assert_eq!(asyncs, 133, "async exports found");
        assert_eq!(syncs, 99, "sync exports found");
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
