//! DMs, friendships and notifications (W2): the store, and the rules the backend follows.
//!
//! The rules are those of `backend/src/{direct-messages,friends,notifications,read-receipts}`;
//! each function says which. Every row lives in [`Social`], under the data lock, and the HTTP
//! routes (`http/{dms,social,notify}.rs`) and the socket handlers are thin around it.

use crate::scenario::{Scenario, entity_uuid};
use crate::{Data, Inner};
use chrono::{DateTime, Utc};
use semaphore_wire::enums::{NotificationType, SpanType};
use semaphore_wire::types::{
    ChannelNotificationOverrideDto, DmGroupLastMessageDto, DmGroupMemberDto, DmGroupMemberUserDto,
    DmGroupResponseDto, FriendshipWithUsersDto, MessageDto, NewNotificationPayloadDto,
    NotificationAuthorDto, NotificationDto, NotificationMessageDto, UserEntity,
    UserNotificationSettingsDto,
};
use serde_json::Value;
use std::collections::BTreeMap;

/// A socket event for one user, queued while the data lock is held and sent after it is dropped.
pub(crate) struct Emit {
    pub user: String,
    pub event: &'static str,
    pub payload: Value,
}

/// Everything W2 adds to the mutable state.
pub(crate) struct Social {
    /// Every DM group, including those `me` left (they stop being listed for them).
    pub dm_groups: Vec<DmGroupResponseDto>,
    pub friendships: Vec<FriendshipWithUsersDto>,
    /// Every user's notifications, in the order they were created.
    pub notifications: Vec<NotificationDto>,
    /// By user. A user with no row gets the defaults the first time anyone reads them, as the
    /// backend's `getUserSettings` upserts.
    pub settings: BTreeMap<String, UserNotificationSettingsDto>,
    pub overrides: Vec<ChannelNotificationOverrideDto>,
    next_id: u64,
}

impl Social {
    pub fn seed(scenario: &Scenario) -> Self {
        Self {
            dm_groups: scenario.dm_groups.clone(),
            friendships: scenario.friendships.clone(),
            notifications: scenario.notifications.clone(),
            settings: scenario
                .notification_settings
                .iter()
                .map(|settings| (settings.user_id.clone(), settings.clone()))
                .collect(),
            overrides: scenario.channel_overrides.clone(),
            next_id: 0,
        }
    }

    /// A new row id: a UUID, the same on every run.
    pub fn new_id(&mut self, kind: &str) -> String {
        self.next_id += 1;
        entity_uuid(&format!("fake-{kind}-{:06}", self.next_id))
    }

    /// The user's settings, with the defaults stored first if they have none.
    pub fn settings_for(
        &mut self,
        user_id: &str,
        now: DateTime<Utc>,
    ) -> &mut UserNotificationSettingsDto {
        if !self.settings.contains_key(user_id) {
            let id = self.new_id("settings");
            self.settings
                .insert(user_id.to_owned(), default_settings(id, user_id, now));
        }
        self.settings
            .get_mut(user_id)
            .expect("the row was just stored")
    }

    /// `override ?? defaultChannelLevel`, as `shouldNotify` resolves it.
    pub fn channel_level(&mut self, user_id: &str, channel_id: &str, now: DateTime<Utc>) -> String {
        let default = self
            .settings_for(user_id, now)
            .default_channel_level
            .clone();
        self.overrides
            .iter()
            .find(|row| row.user_id == user_id && row.channel_id == channel_id)
            .map_or(default, |row| row.level.clone())
    }
}

/// The schema's defaults for a user who never set anything.
pub(crate) fn default_settings(
    id: String,
    user_id: &str,
    now: DateTime<Utc>,
) -> UserNotificationSettingsDto {
    UserNotificationSettingsDto {
        created_at: now,
        default_channel_level: "mentions".to_owned(),
        desktop_enabled: true,
        dm_notifications: true,
        dnd_end_time: None,
        dnd_start_time: None,
        dnd_timezone: None,
        do_not_disturb: false,
        id,
        play_sound: true,
        sound_type: "default".to_owned(),
        updated_at: now,
        user_id: user_id.to_owned(),
    }
}

/// What a path id must be: the backend types them as UUIDs (`ParseUUIDPipe`, hyphenated only).
/// The scenarios that keep readable ids (everything but the showcase) name them in their own
/// rows, so an id the store knows passes whatever it looks like.
pub(crate) fn valid_id(id: &str, known: bool) -> bool {
    known || (id.len() == 36 && uuid::Uuid::parse_str(id).is_ok())
}

pub(crate) fn member_user(user: &UserEntity) -> DmGroupMemberUserDto {
    DmGroupMemberUserDto {
        avatar_url: user.avatar_url.clone(),
        display_name: user.display_name.clone(),
        id: user.id.clone(),
        username: user.username.clone(),
    }
}

fn author_of(user: &UserEntity) -> NotificationAuthorDto {
    NotificationAuthorDto {
        avatar_url: user.avatar_url.clone(),
        display_name: user.display_name.clone(),
        id: user.id.clone(),
        username: user.username.clone(),
    }
}

pub(crate) fn new_member(
    social: &mut Social,
    user: &UserEntity,
    now: DateTime<Utc>,
) -> DmGroupMemberDto {
    DmGroupMemberDto {
        id: social.new_id("dmm"),
        joined_at: now,
        user: member_user(user),
        user_id: user.id.clone(),
    }
}

// ----- DMs -------------------------------------------------------------------------------------

/// The newest message of the group, thread replies included (they carry the group's id, and the
/// backend's `lastMessage` takes the newest `Message` row with it).
fn last_message(data: &Data, group_id: &str) -> Option<DmGroupLastMessageDto> {
    data.dm_messages
        .get(group_id)
        .into_iter()
        .flatten()
        .chain(
            data.threads
                .values()
                .flatten()
                .filter(|reply| reply.direct_message_group_id.as_deref() == Some(group_id)),
        )
        .max_by(|a, b| (a.sent_at, &a.id).cmp(&(b.sent_at, &b.id)))
        .map(|message| DmGroupLastMessageDto {
            author_id: message.author_id.clone(),
            id: message.id.clone(),
            sent_at: message.sent_at,
            spans: message.spans.clone(),
        })
}

/// The group as the backend returns it: the newest message read from the store, not the one the
/// scenario named.
pub(crate) fn dm_view(data: &Data, group: &DmGroupResponseDto) -> DmGroupResponseDto {
    DmGroupResponseDto {
        last_message: last_message(data, &group.id).or_else(|| group.last_message.clone()),
        ..group.clone()
    }
}

/// `findUserDmGroups`: the user's groups, most recent activity first.
pub(crate) fn dm_groups_for(data: &Data, user_id: &str) -> Vec<DmGroupResponseDto> {
    let mut groups: Vec<DmGroupResponseDto> = data
        .social
        .dm_groups
        .iter()
        .filter(|group| group.members.iter().any(|member| member.user_id == user_id))
        .map(|group| dm_view(data, group))
        .collect();
    groups.sort_by_key(|group| std::cmp::Reverse(group.created_at));
    groups.sort_by_key(|group| {
        std::cmp::Reverse(
            group
                .last_message
                .as_ref()
                .map_or(group.created_at, |last| last.sent_at),
        )
    });
    groups
}

/// A group as JSON, with the `null`s the backend sends for a missing name and last message.
pub(crate) fn dm_json(group: &DmGroupResponseDto) -> Value {
    let mut value = serde_json::to_value(group).expect("a DM group serializes");
    for key in ["name", "lastMessage"] {
        if let Some(object) = value.as_object_mut() {
            object.entry(key).or_insert(Value::Null);
        }
    }
    value
}

/// Who a DM's events go to; `None` for a group the store doesn't know (an id the tests invented),
/// which keeps the old behaviour of telling every socket.
pub(crate) fn dm_member_ids(data: &Data, group_id: &str) -> Option<Vec<String>> {
    data.social
        .dm_groups
        .iter()
        .find(|group| group.id == group_id)
        .map(|group| {
            group
                .members
                .iter()
                .map(|member| member.user_id.clone())
                .collect()
        })
}

// ----- notifications ---------------------------------------------------------------------------

fn community_of(inner: &Inner, notification: &NotificationDto) -> Option<String> {
    notification.community_id.clone().or_else(|| {
        notification
            .channel_id
            .as_deref()
            .and_then(|channel| inner.scenario.channel(channel))
            .map(|channel| channel.community_id.clone())
    })
}

/// A notification as the list sends it (`full`: author, message and community), or as the read
/// and dismiss routes do (the bare row, which is what the backend returns there).
pub(crate) fn notification_json(
    inner: &Inner,
    notification: &NotificationDto,
    full: bool,
) -> Value {
    let community = community_of(inner, notification);
    let mut value = serde_json::to_value(notification).expect("a notification serializes");
    let object = value.as_object_mut().expect("an object");
    if full {
        object.insert(
            "communityId".to_owned(),
            community.map_or(Value::Null, Value::from),
        );
        for key in ["author", "message"] {
            object.entry(key).or_insert(Value::Null);
        }
    } else {
        for key in ["author", "message", "communityId"] {
            object.remove(key);
        }
    }
    value
}

/// The `newNotification` payload (`emitNotificationToUser`).
pub(crate) fn notification_payload(inner: &Inner, notification: &NotificationDto) -> Value {
    let channel = notification
        .channel_id
        .as_deref()
        .and_then(|channel| inner.scenario.channel(channel));
    serde_json::to_value(NewNotificationPayloadDto {
        author: notification.author.clone(),
        author_id: notification.author_id.clone(),
        channel_id: notification.channel_id.clone(),
        channel_name: channel.map(|channel| channel.name.clone()),
        community_id: community_of(inner, notification),
        created_at: notification.created_at,
        direct_message_group_id: notification.direct_message_group_id.clone(),
        message: notification.message.clone(),
        message_id: notification.message_id.clone(),
        notification_id: notification.id.clone(),
        read: notification.read,
        type_: notification.type_.clone(),
    })
    .expect("a payload serializes")
}

fn create_notification(
    inner: &Inner,
    data: &mut Data,
    user_id: &str,
    kind: NotificationType,
    message: &MessageDto,
    author: &UserEntity,
) -> Emit {
    let notification = NotificationDto {
        author: Some(author_of(author)),
        author_id: author.id.clone(),
        channel_id: message.channel_id.clone(),
        community_id: message
            .channel_id
            .as_deref()
            .and_then(|channel| inner.scenario.channel(channel))
            .map(|channel| channel.community_id.clone()),
        created_at: inner.now(),
        direct_message_group_id: message.direct_message_group_id.clone(),
        dismissed: false,
        id: data.social.new_id("notification"),
        message: Some(NotificationMessageDto {
            channel_id: message.channel_id.clone(),
            direct_message_group_id: message.direct_message_group_id.clone(),
            id: message.id.clone(),
            spans: message.spans.clone(),
        }),
        message_id: Some(message.id.clone()),
        parent_message_id: None,
        read: false,
        type_: kind,
        user_id: user_id.to_owned(),
    };
    let payload = notification_payload(inner, &notification);
    data.social.notifications.push(notification);
    Emit {
        user: user_id.to_owned(),
        event: "newNotification",
        payload,
    }
}

/// `processMessageForNotifications`, for the cases the fake models:
///
/// - a DM message notifies every other member of the group (`DIRECT_MESSAGE`), unless their
///   `dmNotifications` is off;
/// - a channel message with a `USER_MENTION` span notifies the mentioned user (`USER_MENTION`),
///   never the author, and not a user whose level for the channel is `none`.
///
/// `@here`/`@channel`/alias mentions, `CHANNEL_MESSAGE` for level `all` and thread-reply
/// notifications are not made. Thread replies notify nobody here.
pub(crate) fn notify_message(inner: &Inner, data: &mut Data, message: &MessageDto) -> Vec<Emit> {
    let Some(author_id) = message.author_id.as_deref() else {
        return Vec::new();
    };
    if message.parent_message_id.is_some() || message.deleted_at.is_some() {
        return Vec::new();
    }
    let Some(author) = inner.scenario.user(author_id) else {
        return Vec::new();
    };
    let now = inner.now();
    let mut emits = Vec::new();

    if let Some(group_id) = message.direct_message_group_id.as_deref() {
        let members = dm_member_ids(data, group_id).unwrap_or_default();
        for user_id in members.iter().filter(|user| user.as_str() != author_id) {
            if !data.social.settings_for(user_id, now).dm_notifications {
                continue;
            }
            emits.push(create_notification(
                inner,
                data,
                user_id,
                NotificationType::DirectMessage,
                message,
                author,
            ));
        }
        return emits;
    }

    let Some(channel_id) = message.channel_id.as_deref() else {
        return emits;
    };
    let community_members: Option<Vec<&str>> = inner
        .scenario
        .channel(channel_id)
        .and_then(|channel| inner.scenario.memberships.get(&channel.community_id))
        .filter(|members| !members.is_empty())
        .map(|members| members.iter().map(|m| m.user_id.as_str()).collect());
    let mut mentioned: Vec<&str> = Vec::new();
    for span in &message.spans {
        // A sent span's type is kept as the text it came as, so compare by text.
        if span.type_.as_str() != SpanType::UserMention.as_str() {
            continue;
        }
        let Some(user_id) = span.user_id.as_deref() else {
            continue;
        };
        if user_id == author_id
            || mentioned.contains(&user_id)
            || inner.scenario.user(user_id).is_none()
            || community_members
                .as_ref()
                .is_some_and(|members| !members.contains(&user_id))
        {
            continue;
        }
        mentioned.push(user_id);
    }
    for user_id in mentioned {
        if data.social.channel_level(user_id, channel_id, now) == "none" {
            continue;
        }
        emits.push(create_notification(
            inner,
            data,
            user_id,
            NotificationType::UserMention,
            message,
            author,
        ));
    }
    emits
}

/// `markContextNotificationsAsRead`: the user's unread notifications of this channel or DM that
/// are mentions, DMs or channel messages. Silent: no `notificationRead`.
pub(crate) fn mark_context_read(
    data: &mut Data,
    user_id: &str,
    channel_id: Option<&str>,
    dm_id: Option<&str>,
) -> usize {
    if channel_id.is_none() && dm_id.is_none() {
        return 0;
    }
    let mut changed = 0;
    for notification in &mut data.social.notifications {
        let kinds_match = if dm_id.is_some() {
            matches!(
                notification.type_,
                NotificationType::UserMention
                    | NotificationType::SpecialMention
                    | NotificationType::DirectMessage
            )
        } else {
            matches!(
                notification.type_,
                NotificationType::UserMention
                    | NotificationType::SpecialMention
                    | NotificationType::ChannelMessage
            )
        };
        let context_matches = match channel_id {
            Some(channel) => notification.channel_id.as_deref() == Some(channel),
            None => notification.direct_message_group_id.as_deref() == dm_id,
        };
        if notification.user_id == user_id && !notification.read && kinds_match && context_matches {
            notification.read = true;
            changed += 1;
        }
    }
    changed
}

/// The user's unread notifications, which is what `/api/notifications/unread-count` counts.
pub(crate) fn unread_count(data: &Data, user_id: &str) -> i64 {
    data.social
        .notifications
        .iter()
        .filter(|notification| notification.user_id == user_id && !notification.read)
        .count() as i64
}

/// Send queued events, after the data lock is dropped.
pub(crate) fn flush(inner: &Inner, emits: Vec<Emit>) {
    for emit in emits {
        inner.emit_to_user(&emit.user, emit.event, emit.payload);
    }
}

/// The `friend_request_as` control: `from` asks the signed-in user to be friends, as their own
/// client's `sendFriendRequest` would. Like the backend, nothing goes over the socket: the request
/// shows when the friends list is read next. `id`, when given, is the readable id the row is served
/// as (`entity_uuid`), so a script can name it. `Err` if `from` isn't a user, is `me`, or a row
/// between them exists already.
pub(crate) fn friend_request_as(
    inner: &Inner,
    from: &str,
    id: Option<&str>,
) -> Result<String, &'static str> {
    let me = inner.scenario.me.clone();
    let Some(other) = inner.scenario.user(from).cloned() else {
        return Err("fromId is not a user of the scenario");
    };
    if other.id == me.id {
        return Err("fromId is the signed-in user");
    }
    let now = inner.now();
    let mut data = crate::lock(&inner.data);
    let exists = data.social.friendships.iter().any(|row| {
        (row.user_a_id == me.id && row.user_b_id == other.id)
            || (row.user_a_id == other.id && row.user_b_id == me.id)
    });
    if exists {
        return Err("a friendship or request between them exists already");
    }
    let id = match id {
        Some(readable) => entity_uuid(readable),
        None => data.social.new_id("friendship"),
    };
    data.social.friendships.push(FriendshipWithUsersDto {
        created_at: now,
        id: id.clone(),
        status: semaphore_wire::enums::FriendshipStatus::Pending,
        user_a_id: other.id.clone(),
        user_a: other,
        user_b_id: me.id.clone(),
        user_b: me,
    });
    Ok(id)
}
