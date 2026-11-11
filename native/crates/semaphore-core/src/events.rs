//! Socket event to state: the generated `ServerEvent`, then the rule for each event, either
//! "invalidate these queries" or a direct update, the same three patterns as the web client's
//! `socket-hub/handlers` (`docs-site/docs/architecture/websocket-patterns.md`).
//!
//! [`rule`] is the web's table, held to `fixtures/cache/socket-rules.json` by a test, so a handler
//! changing there fails here at the next re-export. Reading `rule` tells you what an event means
//! on the web; the reducer below says what core does about it. Core caches fewer queries than the
//! web, and invalidating one it doesn't hold is a no-op, so the table stays whole. Direct updates
//! to queries it doesn't hold (notifications, peer reads, presence) have nothing to change.

use crate::cache::keys;
use crate::client::{Core, Effect, State};
use crate::lifecycle::ConnectionState;
use crate::model::{Conversation, SignOutReason, UserView, ViewKey};
use crate::realtime::RealtimeEvent;
use crate::store::Window;
use semaphore_wire::enums::NotificationType;
use semaphore_wire::events::ServerEvent;
use semaphore_wire::types::{self as wire, MessageDto, ReauthenticateResultDto};

/// How long someone shows as typing with no further signal: the web's `useTypingUsers`.
pub const TYPING_TIMEOUT_MS: u64 = 8_000;

/// What an event touches, by query `_id`. `op:param` means only that query's entry for an id in
/// the payload.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct EventRule {
    pub invalidate: &'static [&'static str],
    pub set: &'static [&'static str],
    pub remove: &'static [&'static str],
    pub reset: &'static [&'static str],
}

const CHANNEL_PERMISSIONS: [&str; 4] = [
    "channelPermissionsControllerGetMyChannelPermissions",
    "channelPermissionsControllerGetMyCommunityChannelPermissions",
    "channelPermissionsControllerGetOverwrites",
    "channelPermissionsControllerListChannelPermissions",
];
const CONTEXT_MESSAGES: [&str; 2] = [
    "messagesControllerFindAllForChannel:channelId",
    "messagesControllerFindAllForGroup:groupId",
];
const VOICE_FALLBACK: &[&str] = &[
    "dmVoicePresenceControllerGetDmPresence",
    "userVoicePresenceControllerGetMyVoiceChannels",
    "voicePresenceControllerGetChannelPresence",
];

const fn invalidates(invalidate: &'static [&'static str]) -> EventRule {
    EventRule {
        invalidate,
        set: &[],
        remove: &[],
        reset: &[],
    }
}

const fn sets(set: &'static [&'static str]) -> EventRule {
    EventRule {
        invalidate: &[],
        set,
        remove: &[],
        reset: &[],
    }
}

const NEW_MESSAGE_RULE: EventRule = EventRule {
    invalidate: &["directMessagesControllerFindUserDmGroups"],
    set: &[
        CONTEXT_MESSAGES[0],
        CONTEXT_MESSAGES[1],
        "readReceiptsControllerGetUnreadCounts",
    ],
    remove: &[],
    reset: &CONTEXT_MESSAGES,
};
const REACTION_RULE: EventRule = sets(&[
    CONTEXT_MESSAGES[0],
    CONTEXT_MESSAGES[1],
    "threadsControllerGetReplies:parentMessageId",
]);
const PIN_RULE: EventRule = EventRule {
    invalidate: &["moderationControllerGetPinnedMessages:channelId"],
    set: &["messagesControllerFindAllForChannel:channelId"],
    remove: &[],
    reset: &[],
};
const PRESENCE_RULE: EventRule = sets(&[
    "presenceControllerGetBulkPresence",
    "presenceControllerGetUserPresence:userId",
]);
const MODERATION_REMOVED_RULE: EventRule = invalidates(&[
    "communityControllerFindAllMine",
    "membershipControllerGetMembers",
]);
const TIMEOUT_RULE: EventRule = invalidates(&[
    CHANNEL_PERMISSIONS[0],
    CHANNEL_PERMISSIONS[1],
    CHANNEL_PERMISSIONS[2],
    CHANNEL_PERMISSIONS[3],
    "membershipControllerGetMembers",
    "moderationControllerGetTimeoutStatus",
]);
const ROLE_ASSIGNMENT_RULE: EventRule = invalidates(&[
    CHANNEL_PERMISSIONS[0],
    CHANNEL_PERMISSIONS[1],
    CHANNEL_PERMISSIONS[2],
    CHANNEL_PERMISSIONS[3],
    "membershipControllerFindAllForCommunity",
    "membershipControllerGetMembers",
    "rolesControllerGetCommunityRoles",
    "rolesControllerGetMyRolesForChannel",
    "rolesControllerGetMyRolesForCommunity",
]);
const ROLE_CHANGE_RULE: EventRule = invalidates(&[
    CHANNEL_PERMISSIONS[0],
    CHANNEL_PERMISSIONS[1],
    CHANNEL_PERMISSIONS[2],
    CHANNEL_PERMISSIONS[3],
    "membershipControllerFindAllForCommunity",
    "rolesControllerGetCommunityRoles",
    "rolesControllerGetMyRolesForChannel",
    "rolesControllerGetMyRolesForCommunity",
]);

/// The rule for an event by wire name. An event not listed has no cache handler on the web.
pub fn rule(name: &str) -> Option<EventRule> {
    Some(match name {
        "channelCreated" | "channelDeleted" | "channelsReordered" | "channelUpdated" => {
            invalidates(&["channelsControllerFindAllForCommunity"])
        }
        "channelPermissionsUpdated" => invalidates(&[
            CHANNEL_PERMISSIONS[0],
            CHANNEL_PERMISSIONS[1],
            CHANNEL_PERMISSIONS[2],
            CHANNEL_PERMISSIONS[3],
            "channelsControllerFindAllForCommunity",
            "channelsControllerFindOne:id",
        ]),
        "communityDeleted" | "memberAddedToCommunity" => {
            invalidates(&["communityControllerFindAllMine"])
        }
        "communityUpdated" => invalidates(&[
            "communityControllerFindAllMine",
            "communityControllerFindOne",
        ]),
        "deleteMessage" => EventRule {
            invalidate: &[],
            set: &CONTEXT_MESSAGES,
            remove: &["threadsControllerGetReplies:parentMessageId"],
            reset: &[],
        },
        "dmVoiceCallStarted" => invalidates(VOICE_FALLBACK),
        "dmVoiceUserJoined" | "dmVoiceUserLeft" => EventRule {
            invalidate: VOICE_FALLBACK,
            set: &["dmVoicePresenceControllerGetDmPresence:dmGroupId"],
            remove: &[],
            reset: &[],
        },
        "voiceChannelUserJoined" | "voiceChannelUserLeft" | "voiceChannelUserUpdated" => {
            EventRule {
                invalidate: VOICE_FALLBACK,
                set: &["voicePresenceControllerGetChannelPresence:channelId"],
                remove: &[],
                reset: &[],
            }
        }
        "messagePinned" | "messageUnpinned" => PIN_RULE,
        "newMessage" | "newDirectMessage" => NEW_MESSAGE_RULE,
        "newNotification" => sets(&[
            "notificationsControllerGetNotifications",
            "notificationsControllerGetUnreadCount",
            "readReceiptsControllerGetUnreadCounts",
        ]),
        "notificationRead" => sets(&[
            "notificationsControllerGetNotifications",
            "notificationsControllerGetUnreadCount",
        ]),
        "newThreadReply" => sets(&["threadsControllerGetReplies:parentMessageId"]),
        "reactionAdded" | "reactionRemoved" => REACTION_RULE,
        "readReceiptUpdated" => sets(&[
            "readReceiptsControllerGetDmPeerReads:directMessageGroupId",
            "readReceiptsControllerGetUnreadCounts",
        ]),
        "roleAssigned" | "roleUnassigned" => ROLE_ASSIGNMENT_RULE,
        "roleCreated" => invalidates(&[
            "membershipControllerFindAllForCommunity",
            "rolesControllerGetCommunityRoles",
        ]),
        "roleDeleted" | "roleUpdated" => ROLE_CHANGE_RULE,
        "threadReplyCountUpdated" | "updateMessage" => sets(&CONTEXT_MESSAGES),
        "timeoutRemoved" | "userTimedOut" => TIMEOUT_RULE,
        "userBanned" | "userKicked" => MODERATION_REMOVED_RULE,
        "userOffline" | "userOnline" => PRESENCE_RULE,
        "userProfileUpdated" => {
            invalidates(&["userControllerGetProfile", "userControllerGetUserById:id"])
        }
        _ => return None,
    })
}

fn context(channel_id: &Option<String>, group_id: &Option<String>) -> Option<Conversation> {
    match (channel_id, group_id) {
        (Some(id), _) if !id.is_empty() => Some(Conversation::Channel { id: id.clone() }),
        (_, Some(id)) if !id.is_empty() => Some(Conversation::DirectMessage { id: id.clone() }),
        _ => None,
    }
}

fn presence_user_view(user: &wire::VoicePresenceUserDto) -> UserView {
    UserView {
        id: user.id.clone(),
        username: user.username.clone(),
        display_name: user.display_name.clone(),
        avatar_file_id: user.avatar_url.clone(),
    }
}

impl State {
    /// Everything in `rule(name).invalidate` that isn't scoped to one id: the handlers whose whole
    /// effect is a refetch.
    fn invalidate_for(&mut self, name: &str) {
        let Some(rule) = rule(name) else {
            return;
        };
        for op in rule.invalidate {
            let op = op.split(':').next().unwrap_or(op);
            self.invalidate(&keys::op(op));
        }
    }

    fn community_of_channel(&self, channel_id: &str) -> Option<String> {
        self.cache
            .keys_with_op(keys::CHANNELS)
            .iter()
            .find_map(|key| {
                let channels = self.cache.channels(key)?;
                channels
                    .iter()
                    .find(|channel| channel.id == channel_id)
                    .map(|channel| channel.community_id.clone())
            })
    }

    /// Unread counts changed for this context.
    fn unread_views_changed(&mut self, context_id: &str) {
        self.view_changed(ViewKey::Communities);
        self.view_changed(ViewKey::Rail);
        if let Some(community_id) = self.community_of_channel(context_id) {
            self.view_changed(ViewKey::Channels { community_id });
        }
    }

    /// Adds to a context's unread entry, or starts one. Nothing to change if the list isn't loaded.
    fn bump_unread(
        &mut self,
        conversation: &Conversation,
        context_id: &str,
        unread: i64,
        mention: i64,
    ) {
        let key = keys::op(keys::UNREAD);
        self.note_direct_update(&key);
        let Some(counts) = self.cache.unread_counts_mut(&key) else {
            return;
        };
        match counts
            .iter_mut()
            .find(|count| count_id(count) == Some(context_id))
        {
            Some(count) => {
                count.unread_count += unread;
                count.mention_count = (count.mention_count + mention).max(0);
            }
            // Taking away from an entry that isn't there: nothing to take from.
            None if mention < 0 => return,
            None => counts.push(wire::UnreadCountDto {
                channel_id: matches!(conversation, Conversation::Channel { .. })
                    .then(|| context_id.to_owned()),
                direct_message_group_id: matches!(conversation, Conversation::DirectMessage { .. })
                    .then(|| context_id.to_owned()),
                last_read_at: None,
                last_read_message_id: None,
                mention_count: mention.max(0),
                unread_count: unread,
            }),
        }
        self.unread_views_changed(context_id);
    }

    /// `handleNewMessage`.
    fn on_new_message(&mut self, dto: MessageDto) {
        let Some(conversation) = context(&dto.channel_id, &dto.direct_message_group_id) else {
            return;
        };
        let context_id = match &conversation {
            Conversation::Channel { id } | Conversation::DirectMessage { id } => id.clone(),
            Conversation::Thread { .. } => return,
        };
        let detached = self
            .windows
            .get(&conversation)
            .is_some_and(Window::is_detached_from_live_edge);
        let is_mine = !self.me_id().is_empty() && dto.author_id.as_deref() == Some(self.me_id());
        if is_mine && let Some(nonce) = &dto.client_nonce {
            self.sends.remove(nonce);
            // The echo can beat the ack: either one means the message exists to upload against.
            self.uploads_may_start(nonce, &dto.id);
        }
        if let Some(window) = self.windows.get_mut(&conversation) {
            // A detached window doesn't take it, but a page on its way may be the one that reattaches
            // the window, and may predate it.
            window.note_upsert(&dto.id, Some(dto.clone()));
            if !detached {
                window.reconcile_echo(dto.clone());
                window.evict_oldest();
            }
        }
        if dto.direct_message_group_id.is_some() {
            self.invalidate_for("newMessage");
        }
        if is_mine {
            // Own message while detached: sending implies "take me to the present".
            if detached {
                self.request_reset(&conversation);
            }
            return;
        }
        // It would be cleared moments later by the read mark, as a badge flash. Not while detached:
        // the message isn't visible, so the bump is the only sign one arrived.
        if !detached && self.focused && self.is_on_screen(&conversation) {
            return;
        }
        self.bump_unread(&conversation, &context_id, 1, 0);
    }

    /// `handleUpdateMessage`, and the thread window for a reply.
    fn on_update_message(&mut self, mut dto: MessageDto) {
        self.blank_for_reader(&mut dto);
        let id = dto.id.clone();
        let targets = [
            context(&dto.channel_id, &dto.direct_message_group_id),
            dto.parent_message_id
                .clone()
                .map(|parent_message_id| Conversation::Thread { parent_message_id }),
        ];
        for conversation in targets.into_iter().flatten() {
            if let Some(window) = self.windows.get_mut(&conversation) {
                window.note_update(&id, Some(dto.clone()));
                window.update(dto.clone(), None);
            }
        }
    }

    /// `handleDeleteMessage`, except for a reader who may see removed messages: the payload doesn't
    /// say whether a moderator removed the message (the row stays, text and all) or it was deleted
    /// (it goes), so for them the row turns removed and is read again.
    fn on_delete_message(&mut self, payload: wire::DeleteMessagePayloadDto, now: u64) {
        self.drop_from_pins(payload.channel_id.as_deref(), &payload.message_id);
        if self.removal_kept(&payload, now) {
            return;
        }
        self.remove_message(&payload);
    }

    /// The row goes, wherever it's loaded. The payload doesn't say if this was a reply, so threads
    /// are checked too.
    pub(crate) fn remove_message(&mut self, payload: &wire::DeleteMessagePayloadDto) {
        let thread = Conversation::Thread {
            parent_message_id: payload.message_id.clone(),
        };
        // A thread on screen empties, so a UI hears of it. Otherwise it's just forgotten.
        if self.is_on_screen(&thread) {
            if let Some(window) = self.windows.get_mut(&thread) {
                window.apply_thread(Vec::new());
            }
        } else {
            self.windows.remove(&thread);
        }
        for (conversation, window) in &mut self.windows {
            let in_context = context(&payload.channel_id, &payload.direct_message_group_id)
                .as_ref()
                == Some(conversation);
            if in_context || matches!(conversation, Conversation::Thread { .. }) {
                window.note_delete(&payload.message_id);
                window.delete(&payload.message_id);
            }
        }
    }

    /// Changes a row in its conversation and in a thread, wherever it's loaded.
    fn edit_rows(
        &mut self,
        conversation: Option<Conversation>,
        parent_message_id: Option<&str>,
        message_id: &str,
        change: impl Fn(&mut MessageDto),
    ) {
        let thread = parent_message_id.map(|parent| Conversation::Thread {
            parent_message_id: parent.to_owned(),
        });
        for conversation in [conversation, thread].into_iter().flatten() {
            if let Some(window) = self.windows.get_mut(&conversation)
                && window.edit(message_id, &change)
            {
                window.note_update(message_id, None);
            }
        }
    }

    /// `handleReadReceiptUpdated`. A read mark for a DM arrives twice: once with no `userId`, to
    /// the reader's other devices, and once with one, to everyone in the room.
    fn on_read_receipt(&mut self, payload: wire::ReadReceiptUpdatedPayloadDto) {
        let is_peer = payload
            .user_id
            .as_deref()
            .is_some_and(|user_id| user_id != self.me_id());
        if is_peer {
            return;
        }
        let Some(conversation) = context(&payload.channel_id, &payload.direct_message_group_id)
        else {
            return;
        };
        let (Conversation::Channel { id: context_id }
        | Conversation::DirectMessage { id: context_id }) = &conversation
        else {
            return;
        };
        let key = keys::op(keys::UNREAD);
        self.note_direct_update(&key);
        let Some(counts) = self.cache.unread_counts_mut(&key) else {
            return;
        };
        let read_at = Some(payload.last_read_at);
        let read_message = Some(payload.last_read_message_id.clone());
        match counts
            .iter_mut()
            .find(|count| count_id(count) == Some(context_id))
        {
            Some(count) => {
                count.unread_count = 0;
                count.mention_count = 0;
                count.last_read_at = read_at;
                count.last_read_message_id = read_message;
            }
            None => counts.push(wire::UnreadCountDto {
                channel_id: payload.channel_id.clone(),
                direct_message_group_id: payload.direct_message_group_id.clone(),
                last_read_at: read_at,
                last_read_message_id: read_message,
                mention_count: 0,
                unread_count: 0,
            }),
        }
        let context_id = context_id.clone();
        self.unread_views_changed(&context_id);
    }

    /// The hybrid pattern: an update if this channel's presence is loaded, a refetch if not.
    fn on_voice_presence(
        &mut self,
        channel_id: &str,
        name: &str,
        change: impl FnOnce(&mut Vec<wire::VoicePresenceUserDto>),
    ) {
        let key = keys::scoped(keys::VOICE_PRESENCE, channel_id);
        self.note_direct_update(&key);
        if let Some(presence) = self.cache.voice_presence_mut(&key) {
            change(&mut presence.users);
            presence.count = presence.users.len() as i64;
            if let Some(community_id) = self.community_of_channel(channel_id) {
                self.view_changed(ViewKey::Channels { community_id });
            }
            self.view_changed(ViewKey::Voice);
        } else {
            self.invalidate_for(name);
        }
    }

    /// Direct, as these fire on every connect and disconnect in the instance. Nothing to change until
    /// a members read has loaded the map.
    fn on_presence(&mut self, user_id: &str, online: bool) {
        let key = keys::op(keys::PRESENCE);
        self.note_direct_update(&key);
        if let Some(presence) = self.cache.presence_mut(&key) {
            presence.insert(user_id.to_owned(), online);
            self.members_changed(Some(user_id));
        }
    }

    fn on_typing(&mut self, payload: wire::UserTypingPayloadDto, now: u64) {
        if payload.user_id == self.me_id() {
            return;
        }
        let Some(conversation) = context(&payload.channel_id, &payload.direct_message_group_id)
        else {
            return;
        };
        let users = self.typing.entry(conversation.clone()).or_default();
        users.retain(|(user, at)| {
            *user != payload.user_id && now.saturating_sub(*at) < TYPING_TIMEOUT_MS
        });
        if payload.is_typing {
            users.push((payload.user_id, now));
        }
        self.view_changed(ViewKey::Typing { conversation });
    }

    /// A payload this build can't read. Whatever it would have changed may now be wrong, so refetch
    /// what its rule touches: that recovers everything but the moment.
    fn on_malformed(&mut self, name: &str, payload: &serde_json::Value, error: &str) {
        log::warn!("malformed {name} payload, invalidating its queries: {error}");
        let Some(rule) = rule(name) else {
            return;
        };
        let scope = ["channelId", "directMessageGroupId", "dmGroupId"]
            .iter()
            .find_map(|field| payload.get(field)?.as_str());
        for op in rule.invalidate.iter().chain(rule.set) {
            let (op, scoped) = match op.split_once(':') {
                Some((op, _)) => (op, true),
                None => (*op, false),
            };
            match (scoped, scope) {
                (true, Some(id)) if op != keys::THREAD_REPLIES => {
                    self.invalidate(&keys::scoped(op, id));
                }
                _ => {
                    self.invalidate(&keys::op(op));
                }
            }
        }
    }

    /// One event from the server.
    pub fn apply_event(&mut self, name: &str, payload: serde_json::Value, now: u64) {
        match ServerEvent::decode(name, payload) {
            ServerEvent::NewMessage(event) | ServerEvent::NewDirectMessage(event) => {
                self.on_new_message(event.message);
            }
            ServerEvent::UpdateMessage(event) => self.on_update_message(event.message),
            ServerEvent::DeleteMessage(event) => self.on_delete_message(event, now),
            ServerEvent::NewThreadReply(event) => {
                let conversation = Conversation::Thread {
                    parent_message_id: event.parent_message_id,
                };
                let is_mine = event.reply.author_id.as_deref() == Some(self.me_id());
                if is_mine && let Some(nonce) = &event.reply.client_nonce {
                    self.sends.remove(nonce);
                    self.uploads_may_start(nonce, &event.reply.id);
                }
                if let Some(window) = self.windows.get_mut(&conversation) {
                    window.note_upsert(&event.reply.id, Some(event.reply.clone()));
                    window.reconcile_echo(event.reply);
                }
            }
            ServerEvent::ReactionAdded(event) => {
                let reaction = event.reaction;
                self.reaction_users_changed(Some(&event.message_id));
                self.edit_rows(
                    context(&event.channel_id, &event.direct_message_group_id),
                    event.parent_message_id.as_deref(),
                    &event.message_id,
                    |dto| match dto.reactions.iter_mut().find(|r| r.emoji == reaction.emoji) {
                        Some(existing) => *existing = reaction.clone(),
                        None => dto.reactions.push(reaction.clone()),
                    },
                );
            }
            ServerEvent::ReactionRemoved(event) => {
                let reactions = event.reactions;
                self.reaction_users_changed(Some(&event.message_id));
                self.edit_rows(
                    context(&event.channel_id, &event.direct_message_group_id),
                    event.parent_message_id.as_deref(),
                    &event.message_id,
                    |dto| dto.reactions = reactions.clone(),
                );
            }
            ServerEvent::MessagePinned(event) => {
                let conversation = Conversation::Channel {
                    id: event.channel_id,
                };
                self.edit_rows(Some(conversation), None, &event.message_id, |dto| {
                    dto.pinned = true;
                    dto.pinned_by = Some(event.pinned_by.clone());
                    dto.pinned_at = Some(event.pinned_at);
                });
                self.invalidate_for(name);
            }
            ServerEvent::MessageUnpinned(event) => {
                let conversation = Conversation::Channel {
                    id: event.channel_id,
                };
                self.edit_rows(Some(conversation), None, &event.message_id, |dto| {
                    dto.pinned = false;
                    dto.pinned_by = None;
                    dto.pinned_at = None;
                });
                self.invalidate_for(name);
            }
            ServerEvent::ThreadReplyCountUpdated(event) => {
                self.edit_rows(
                    context(&event.channel_id, &event.direct_message_group_id),
                    None,
                    &event.parent_message_id,
                    |dto| {
                        dto.reply_count = event.reply_count;
                        dto.last_reply_at = event.last_reply_at;
                    },
                );
            }
            ServerEvent::ReadReceiptUpdated(event) => self.on_read_receipt(event),
            ServerEvent::NewNotification(event) => {
                if !event.read {
                    let key = keys::op(keys::NOTIFICATION_COUNT);
                    self.note_direct_update(&key);
                    if let Some(count) = self.cache.notification_count_mut(&key) {
                        *count += 1;
                        self.view_changed(ViewKey::Rail);
                    }
                }
                let is_mention = matches!(
                    event.type_,
                    NotificationType::UserMention
                        | NotificationType::SpecialMention
                        | NotificationType::DirectMessage
                );
                let conversation = context(&event.channel_id, &event.direct_message_group_id);
                if let Some(conversation) = conversation
                    && is_mention
                    && !event.read
                {
                    let (Conversation::Channel { id } | Conversation::DirectMessage { id }) =
                        &conversation
                    else {
                        return;
                    };
                    let id = id.clone();
                    self.mention_notifications
                        .insert(event.notification_id, conversation.clone());
                    self.bump_unread(&conversation, &id, 0, 1);
                }
            }
            ServerEvent::NotificationRead(event) => {
                // Refetched, not counted down: another device reading the same one would count twice.
                self.invalidate(&keys::op(keys::NOTIFICATION_COUNT));
                if let Some(conversation) =
                    self.mention_notifications.remove(&event.notification_id)
                    && let Conversation::Channel { id } | Conversation::DirectMessage { id } =
                        &conversation
                {
                    let id = id.clone();
                    self.bump_unread(&conversation, &id, 0, -1);
                }
            }
            ServerEvent::VoiceChannelUserJoined(event) => {
                let user = event.user;
                self.on_voice_presence(&event.channel_id, name, |users| {
                    if !users.iter().any(|existing| existing.id == user.id) {
                        users.push(user);
                    }
                });
            }
            ServerEvent::VoiceChannelUserLeft(event) => {
                let user_id = event.user_id;
                self.on_voice_presence(&event.channel_id, name, |users| {
                    users.retain(|existing| existing.id != user_id);
                });
            }
            ServerEvent::VoiceChannelUserUpdated(event) => {
                let user = event.user;
                self.on_voice_presence(&event.channel_id, name, |users| {
                    if let Some(existing) = users.iter_mut().find(|existing| existing.id == user.id)
                    {
                        *existing = user;
                    }
                });
            }
            // DM presence isn't cached here, so these are the cold path of the hybrid rule.
            ServerEvent::DmVoiceCallStarted(_)
            | ServerEvent::DmVoiceUserJoined(_)
            | ServerEvent::DmVoiceUserLeft(_) => self.invalidate_for(name),
            ServerEvent::UserProfileUpdated(event) => {
                if event.user_id == self.me_id() {
                    self.invalidate(&keys::op(keys::PROFILE));
                }
                self.invalidate(&keys::scoped(keys::USER, &event.user_id));
            }
            ServerEvent::UserTyping(event) => self.on_typing(event, now),
            ServerEvent::TokenExpiring(event) => {
                self.token_expires_at_ms = Some(event.expires_at.timestamp_millis().max(0) as u64);
                self.push_effect(Effect::RefreshToken);
            }
            ServerEvent::UserOnline(event) => self.on_presence(&event.user_id, true),
            ServerEvent::UserOffline(event) => self.on_presence(&event.user_id, false),
            // These have no cache handler on the web either.
            ServerEvent::SessionTerminated(_)
            | ServerEvent::EgressSegmentsReady(_)
            | ServerEvent::ReplayBufferFailed(_)
            | ServerEvent::ReplayBufferStopped(_) => {}
            // Who's listed changed. The rules hold the web's keys, and this read has its own.
            ServerEvent::MemberAddedToCommunity(_)
            | ServerEvent::UserBanned(_)
            | ServerEvent::UserKicked(_) => {
                self.invalidate_for(name);
                self.invalidate(&keys::op(keys::MEMBERS));
            }
            ServerEvent::ChannelCreated(_)
            | ServerEvent::ChannelDeleted(_)
            | ServerEvent::ChannelPermissionsUpdated(_)
            | ServerEvent::ChannelsReordered(_)
            | ServerEvent::ChannelUpdated(_)
            | ServerEvent::CommunityDeleted(_)
            | ServerEvent::CommunityUpdated(_)
            | ServerEvent::RoleAssigned(_)
            | ServerEvent::RoleCreated(_)
            | ServerEvent::RoleDeleted(_)
            | ServerEvent::RoleUnassigned(_)
            | ServerEvent::RoleUpdated(_)
            | ServerEvent::TimeoutRemoved(_)
            | ServerEvent::UserTimedOut(_) => self.invalidate_for(name),
            ServerEvent::Unknown { name, .. } => log::debug!("ignoring unknown event {name}"),
            ServerEvent::Malformed {
                name,
                payload,
                error,
            } => {
                self.on_malformed(&name, &payload, &error);
            }
        }
    }

    /// One thing the transport reported.
    pub fn apply_realtime(&mut self, event: RealtimeEvent, now: u64) {
        match event {
            RealtimeEvent::Connected { .. } => {
                if self.connection != ConnectionState::Suspended {
                    self.set_connection(ConnectionState::Connected);
                }
                // The first connection follows nothing, so there's no gap to close.
                if std::mem::replace(&mut self.had_connection, true) {
                    self.start_resync();
                }
                // Whatever failed may have failed for want of this connection.
                self.retry_failed_queries();
                self.release_parked_sends();
            }
            RealtimeEvent::Disconnected { reason } => {
                log::debug!("socket disconnected: {reason}");
                // Offline and suspended win, because they explain the drop and carry their own way back.
                if self.connection == ConnectionState::Connected {
                    self.set_connection(ConnectionState::Disconnected);
                }
            }
            RealtimeEvent::ConnectError { message } => {
                log::debug!("socket connect error: {message}");
                self.expire_parked_sends(now);
            }
            RealtimeEvent::Event { name, payload } => self.apply_event(&name, payload, now),
            // The socket survived, so no event was lost and nothing goes stale.
            RealtimeEvent::Resumed => {
                self.set_connection(ConnectionState::Connected);
                self.had_connection = true;
                self.release_parked_sends();
            }
            // The session can't be recovered, so end it as a sign-out would, without a logout call.
            RealtimeEvent::AuthLost { reason } => {
                log::warn!(
                    "session lost: {}",
                    reason.as_deref().unwrap_or("no reason given")
                );
                self.reset_signed_out();
                self.sign_out_reason = Some(SignOutReason::Expired);
            }
            RealtimeEvent::Reauthenticated { result } => {
                match serde_json::from_value::<ReauthenticateResultDto>(result) {
                    Ok(ReauthenticateResultDto {
                        ok: true,
                        expires_at: Some(expires_at),
                        ..
                    }) => {
                        self.token_expires_at_ms =
                            Some(expires_at.timestamp_millis().max(0) as u64);
                    }
                    Ok(result) => log::warn!("reauthentication refused: {:?}", result.error),
                    Err(error) => log::warn!("unreadable reauthentication result: {error}"),
                }
            }
        }
    }
}

fn count_id(count: &wire::UnreadCountDto) -> Option<&str> {
    count
        .channel_id
        .as_deref()
        .filter(|id| !id.is_empty())
        .or(count.direct_message_group_id.as_deref())
}

impl Core {
    /// A burst from the transport, as one change: a host draining its channel on wakeup gets one
    /// `MessagesChanged` per conversation, however many events there were.
    pub fn ingest_batch(&self, events: Vec<RealtimeEvent>) {
        self.write(|state, now| {
            for event in events {
                state.apply_realtime(event, now);
            }
            state.trim_windows();
        });
    }

    /// Who's typing here now, by wall clock: expiry needs no timer in core, but a UI that wants it
    /// to disappear on time re-reads after [`TYPING_TIMEOUT_MS`].
    pub fn typing_users(&self, conversation: Conversation) -> Vec<UserView> {
        let now = self.now_ms();
        self.write(|state, _| {
            let ids: Vec<String> = state
                .typing
                .get(&conversation)
                .map(|users| {
                    users
                        .iter()
                        .filter(|(_, at)| now.saturating_sub(*at) < TYPING_TIMEOUT_MS)
                        .map(|(id, _)| id.clone())
                        .collect()
                })
                .unwrap_or_default();
            ids.iter().map(|id| state.user_or_stub(id)).collect()
        })
    }

    /// Every voice user in this cached presence, for diagnostics and views.
    pub(crate) fn presence_users(state: &State, channel_id: &str) -> Vec<UserView> {
        state
            .cache
            .voice_presence(&keys::scoped(keys::VOICE_PRESENCE, channel_id))
            .map(|presence| presence.users.iter().map(presence_user_view).collect())
            .unwrap_or_default()
    }
}
