//! REST, as core sees it. `semaphore-net` implements this over the generated `semaphore-api`
//! client, so core never depends on reqwest. Single-flight token refresh lives in that
//! implementation.
//!
//! **Not frozen yet.** Its signatures use `semaphore-wire` types, which exist once U1 lands. U5
//! adds the methods, each named after its `operationId` in snake case, so a generated trait can
//! replace this one later. Everything else core calls goes through them:
//!
//! - Session: `AuthController_login`, `AuthController_refresh`, `AuthController_logout`,
//!   `UserController_getProfile`
//! - Navigation: `CommunityController_findAllMine`, `ChannelsController_findAllForCommunity`,
//!   `ChannelPermissionsController_getMyCommunityChannelPermissions`,
//!   `ReadReceiptsController_getUnreadCounts`
//! - Messages: `MessagesController_findAllForChannel`, `MessagesController_findAroundForChannel`,
//!   `MessagesController_findAllForGroup`, `MessagesController_create`,
//!   `MessagesController_createDirectMessage`, `MessagesController_addReaction`,
//!   `MessagesController_removeReaction`, `ReadReceiptsController_markAsRead`
//! - Composer: `MembershipController_searchCommunityMembers`,
//!   `ChannelsController_getMentionableChannels`, `CustomEmojiController_listCommunityEmojis`
//! - Voice: `LivekitController_getConnectionInfo`, `LivekitController_generateToken`,
//!   `VoicePresenceController_getChannelPresence`, `VoicePresenceController_joinPresence`,
//!   `VoicePresenceController_refreshPresence`, `VoicePresenceController_leavePresence`,
//!   `VoicePresenceController_updateDeafenState`
//! - Files: `FileController_getFile`, `FileController_getFileThumbnail`

pub trait Backend: Send + Sync {}
