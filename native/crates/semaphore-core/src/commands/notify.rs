//! Notifications: the centre, settings, per-channel levels, the tray badge, and the decision to
//! raise an OS notification (`CoreEvent::Notify`, rules in [`crate::notify`]). Unit W2-core.
//!
//! The server keeps a few changes quiet, so core reads again after them: `read-all`, `dismiss`,
//! and the notifications a conversation's read mark reads (`markAsRead` marks a channel's or DM's
//! mentions and messages read with no `notificationRead`). Only a single mark-read is announced.
//!
//! Optimistic changes (mark read, settings, a channel's level) are overlays on what the server last
//! said: a view shows the cache with the overlays on top. A change that fails drops only its own
//! overlay, so it puts back only the fields it wrote, and only where no later change covers them.
//! Each overlay carries its change number; an answer for a change that isn't the newest for its
//! field leaves the overlay to the newer one. Every answer is dropped once the session it began in
//! has ended (`State::session_epoch`).

use crate::cache::{CacheValue, NotificationPages, QueryKey, keys};
use crate::client::{Core, Effect, State};
use crate::model::{
    ChannelNotifyLevelView, Conversation, LoadState, MessageLink, NotificationKind,
    NotificationList, NotificationRow, NotificationSettings, NotificationSettingsPatch,
    NotificationSettingsView, NotifyLevel, NotifySound, OsNotification, UserView, ViewKey,
};
use crate::notify::{NotifyInput, Verdict, decide};
use crate::platform::{CoreError, CoreEvent};
use crate::resync::unavailable;
use crate::store::span_input;
use crate::text::spans_to_text;
use semaphore_wire::enums::{NotificationLevel, NotificationSoundType, NotificationType};
use semaphore_wire::types as wire;
use serde_json::{Map, Value, json};
use std::collections::{HashMap, HashSet, VecDeque};

/// A page of the notification centre, the web's default.
pub const NOTIFICATION_PAGE: u64 = 50;
/// The most the server sends in one page.
const MAX_PAGE: u64 = 100;
/// How many raised notification ids are remembered, to raise each once.
const RAISED_KEPT: usize = 256;
/// How long an OS notification's body gets.
const BODY_CHARS: usize = 200;

/// What W2's commands keep between calls. Forgotten at sign-out.
#[derive(Debug, Default)]
pub(crate) struct W2State {
    /// Notifications shown read before the server agreed, by id: the change, and whether a
    /// `notificationRead` for it arrived meanwhile (the server has spoken: no rollback).
    pending_reads: HashMap<String, PendingRead>,
    /// A mark-all on its way: the badge and the count show 0 meanwhile.
    all_read_pending: Option<u64>,
    /// Settings changes on their way, oldest first.
    settings_overlays: Vec<(u64, NotificationSettingsPatch)>,
    /// The newest settings change the cache holds the answer to.
    settings_applied: u64,
    /// A channel level change on its way, by channel: the change and the level shown.
    level_overlays: HashMap<String, (u64, Option<NotifyLevel>)>,
    level_applied: HashMap<String, u64>,
    /// A next page of notifications is on its way.
    more_loading: bool,
    /// Notification ids raised lately, oldest first.
    raised: VecDeque<String>,
    /// Tags with a notification up, so a read takes them down.
    raised_tags: HashSet<String>,
    /// What was last told to the server about idleness.
    pub idle: bool,
    /// Friendships with a change on its way, and which change.
    pub busy_friendships: HashMap<String, u64>,
}

#[derive(Debug, Clone, Copy)]
struct PendingRead {
    change: u64,
    heard: bool,
}

pub(crate) fn level_from_wire(level: &str) -> NotifyLevel {
    match level {
        "all" => NotifyLevel::All,
        "none" => NotifyLevel::Muted,
        _ => NotifyLevel::Mentions,
    }
}

fn level_to_wire(level: NotifyLevel) -> NotificationLevel {
    match level {
        NotifyLevel::All => NotificationLevel::All,
        NotifyLevel::Mentions => NotificationLevel::Mentions,
        NotifyLevel::Muted => NotificationLevel::None,
    }
}

fn level_wire_str(level: NotifyLevel) -> &'static str {
    match level {
        NotifyLevel::All => "all",
        NotifyLevel::Mentions => "mentions",
        NotifyLevel::Muted => "none",
    }
}

fn sound_from_wire(sound: &str) -> NotifySound {
    match sound {
        "mention" => NotifySound::Mention,
        "dm" => NotifySound::Dm,
        _ => NotifySound::Default,
    }
}

fn sound_to_wire(sound: NotifySound) -> NotificationSoundType {
    match sound {
        NotifySound::Default => NotificationSoundType::Default,
        NotifySound::Mention => NotificationSoundType::Mention,
        NotifySound::Dm => NotificationSoundType::Dm,
    }
}

pub(crate) fn kind_from_wire(kind: &NotificationType) -> NotificationKind {
    match kind {
        NotificationType::DirectMessage => NotificationKind::DirectMessage,
        NotificationType::ChannelMessage => NotificationKind::ChannelMessage,
        NotificationType::ThreadReply => NotificationKind::ThreadReply,
        _ => NotificationKind::Mention,
    }
}

fn settings_from_wire(dto: &wire::UserNotificationSettingsDto) -> NotificationSettings {
    NotificationSettings {
        desktop_enabled: dto.desktop_enabled,
        play_sound: dto.play_sound,
        sound: sound_from_wire(&dto.sound_type),
        dnd: dto.do_not_disturb,
        dnd_start: dto.dnd_start_time.clone(),
        dnd_end: dto.dnd_end_time.clone(),
        dnd_timezone: dto.dnd_timezone.clone(),
        default_level: level_from_wire(&dto.default_channel_level),
        dm_notifications: dto.dm_notifications,
    }
}

/// An empty string clears an optional text field.
fn text_field(value: &Option<String>) -> Option<Option<String>> {
    value
        .as_ref()
        .map(|text| Some(text.clone()).filter(|text| !text.is_empty()))
}

fn apply_patch(settings: &mut NotificationSettings, patch: &NotificationSettingsPatch) {
    if let Some(value) = patch.desktop_enabled {
        settings.desktop_enabled = value;
    }
    if let Some(value) = patch.play_sound {
        settings.play_sound = value;
    }
    if let Some(value) = patch.sound {
        settings.sound = value;
    }
    if let Some(value) = patch.dnd {
        settings.dnd = value;
    }
    if let Some(value) = text_field(&patch.dnd_start) {
        settings.dnd_start = value;
    }
    if let Some(value) = text_field(&patch.dnd_end) {
        settings.dnd_end = value;
    }
    if let Some(value) = text_field(&patch.dnd_timezone) {
        settings.dnd_timezone = value;
    }
    if let Some(value) = patch.default_level {
        settings.default_level = value;
    }
    if let Some(value) = patch.dm_notifications {
        settings.dm_notifications = value;
    }
}

/// The request body: only the fields the patch sets, a cleared text field as `null`.
fn patch_body(patch: &NotificationSettingsPatch) -> Result<Value, CoreError> {
    let mut body = Map::new();
    let mut put = |name: &str, value: Value| {
        body.insert(name.to_owned(), value);
    };
    if let Some(value) = patch.desktop_enabled {
        put("desktopEnabled", json!(value));
    }
    if let Some(value) = patch.play_sound {
        put("playSound", json!(value));
    }
    if let Some(value) = patch.sound {
        put("soundType", json!(sound_to_wire(value).as_str()));
    }
    if let Some(value) = patch.dnd {
        put("doNotDisturb", json!(value));
    }
    for (name, field, time) in [
        ("dndStartTime", &patch.dnd_start, true),
        ("dndEndTime", &patch.dnd_end, true),
        ("dndTimezone", &patch.dnd_timezone, false),
    ] {
        match text_field(field) {
            None => {}
            Some(None) => put(name, Value::Null),
            Some(Some(text)) => {
                if time && crate::notify::parse_time(Some(&text)).is_none() {
                    return Err(CoreError::Failed {
                        message: format!("{name} must be HH:mm, not {text:?}"),
                    });
                }
                put(name, json!(text));
            }
        }
    }
    if let Some(value) = patch.default_level {
        put("defaultChannelLevel", json!(level_wire_str(value)));
    }
    if let Some(value) = patch.dm_notifications {
        put("dmNotifications", json!(value));
    }
    Ok(Value::Object(body))
}

fn author_view(author: Option<&wire::NotificationAuthorDto>, author_id: &str) -> UserView {
    match author {
        Some(author) => UserView {
            id: author.id.clone(),
            username: author.username.clone(),
            display_name: author.display_name.clone(),
            avatar_file_id: author.avatar_url.clone(),
        },
        None => UserView {
            id: author_id.to_owned(),
            ..UserView::default()
        },
    }
}

fn spans_text(spans: &[wire::SpanDto]) -> String {
    let inputs: Vec<_> = spans.iter().map(span_input).collect();
    spans_to_text(&inputs, None)
}

fn conversation_of(channel_id: &Option<String>, dm_id: &Option<String>) -> Option<Conversation> {
    match (channel_id, dm_id) {
        (Some(id), _) if !id.is_empty() => Some(Conversation::Channel { id: id.clone() }),
        (_, Some(id)) if !id.is_empty() => Some(Conversation::DirectMessage { id: id.clone() }),
        _ => None,
    }
}

/// One tag per conversation, so a newer notification replaces the older.
pub(crate) fn tag_for(conversation: &Conversation) -> Option<String> {
    match conversation {
        Conversation::Channel { id } => Some(format!("channel:{id}")),
        Conversation::DirectMessage { id } => Some(format!("dm:{id}")),
        Conversation::Thread { .. } => None,
    }
}

fn truncate(text: &str, chars: usize) -> String {
    let mut out: String = text.chars().take(chars).collect();
    if text.chars().count() > chars {
        out.push('…');
    }
    out
}

fn dm_title(group: &wire::DmGroupResponseDto, me_id: &str) -> Option<String> {
    if let Some(name) = group.name.as_ref().filter(|name| !name.is_empty()) {
        return Some(name.clone());
    }
    if !group.is_group {
        return None;
    }
    let names: Vec<String> = group
        .members
        .iter()
        .filter(|member| member.user_id != me_id)
        .map(|member| {
            member
                .user
                .display_name
                .clone()
                .filter(|name| !name.is_empty())
                .unwrap_or_else(|| member.user.username.clone())
        })
        .collect();
    (!names.is_empty()).then(|| names.join(", "))
}

impl State {
    /// The settings in effect: the server's, or its defaults while they load, with changes on
    /// their way on top.
    pub(crate) fn effective_settings(&self) -> NotificationSettings {
        let mut settings = self
            .cache
            .notify_settings(&keys::op(keys::NOTIFY_SETTINGS))
            .map(settings_from_wire)
            .unwrap_or_default();
        for (_, patch) in &self.w2.settings_overlays {
            apply_patch(&mut settings, patch);
        }
        settings
    }

    /// A channel's own level as shown: a change on its way, else the server's, else unknown.
    fn shown_level(&self, channel_id: &str) -> Option<Option<NotifyLevel>> {
        if let Some((_, level)) = self.w2.level_overlays.get(channel_id) {
            return Some(*level);
        }
        self.cache
            .channel_level(&keys::scoped(keys::CHANNEL_LEVEL, channel_id))
            .map(|level| level.as_ref().map(|dto| level_from_wire(&dto.level)))
    }

    pub(crate) fn channel_name(&self, channel_id: &str) -> Option<String> {
        self.cache
            .keys_with_op(keys::CHANNELS)
            .iter()
            .find_map(|key| {
                self.cache
                    .channels(key)?
                    .iter()
                    .find(|channel| channel.id == channel_id)
                    .map(|channel| channel.name.clone())
            })
    }

    fn notification_read_shown(&self, dto: &wire::NotificationDto) -> bool {
        dto.read
            || self.w2.pending_reads.contains_key(&dto.id)
            || self.w2.all_read_pending.is_some()
    }

    fn notifications_changed(&mut self) {
        self.view_changed(ViewKey::Notifications);
    }

    pub(crate) fn badge_changed(&mut self) {
        self.view_changed(ViewKey::Badge);
        self.view_changed(ViewKey::Rail);
    }

    /// After the server changed read state without saying so.
    fn recount_notifications(&mut self) {
        let key = keys::op(keys::NOTIFICATION_COUNT);
        if self.invalidate(&key).is_empty() {
            self.ensure_query(key);
        }
    }

    /// Signed in: what notifications need before anything reads them.
    pub(crate) fn w2_signed_in(&mut self) {
        self.ensure_query(keys::op(keys::NOTIFY_SETTINGS));
        self.ensure_query(keys::op(keys::NOTIFICATION_COUNT));
    }

    /// `newNotification`: into the centre if it's loaded, and raised if [`decide`] says so.
    pub(crate) fn w2_on_new_notification(
        &mut self,
        event: &wire::NewNotificationPayloadDto,
        now: u64,
    ) {
        let key = keys::op(keys::NOTIFICATIONS);
        self.note_direct_update(&key);
        let me_id = self.me_id().to_owned();
        if let Some(pages) = self.cache.notifications_mut(&key)
            && !pages.rows.iter().any(|row| row.id == event.notification_id)
        {
            pages.rows.insert(
                0,
                wire::NotificationDto {
                    author: event.author.clone(),
                    author_id: event.author_id.clone(),
                    channel_id: event.channel_id.clone(),
                    community_id: event.community_id.clone(),
                    created_at: event.created_at,
                    direct_message_group_id: event.direct_message_group_id.clone(),
                    dismissed: false,
                    id: event.notification_id.clone(),
                    message: event.message.clone(),
                    message_id: event.message_id.clone(),
                    parent_message_id: None,
                    read: event.read,
                    type_: event.type_.clone(),
                    user_id: me_id,
                },
            );
            pages.total += 1;
            self.notifications_changed();
        }
        self.badge_changed();
        self.raise_if_due(event, now);
    }

    fn raise_if_due(&mut self, event: &wire::NewNotificationPayloadDto, now: u64) {
        let Some(conversation) = conversation_of(&event.channel_id, &event.direct_message_group_id)
        else {
            return;
        };
        let kind = kind_from_wire(&event.type_);
        let settings = self.effective_settings();
        let channel_level = match &conversation {
            Conversation::Channel { id } => self.shown_level(id).flatten(),
            _ => None,
        };
        let me_id = self.me_id().to_owned();
        let verdict = decide(&NotifyInput {
            kind,
            author_id: &event.author_id,
            read: event.read,
            conversation: &conversation,
            parent_message_id: None,
            me_id: &me_id,
            already_raised: self.w2.raised.contains(&event.notification_id),
            settings: &settings,
            channel_level,
            window_focused: self.focused,
            main_conversation: self.main_conversation.as_ref(),
            thread_conversation: self.thread_conversation.as_ref(),
            now_ms: now,
        });
        let Verdict::Raise { sound } = verdict else {
            log::debug!("not raising {}: {verdict:?}", event.notification_id);
            return;
        };
        let Some(tag) = tag_for(&conversation) else {
            return;
        };
        let author = event
            .author
            .as_ref()
            .map(|author| {
                author
                    .display_name
                    .clone()
                    .filter(|name| !name.is_empty())
                    .unwrap_or_else(|| author.username.clone())
            })
            .unwrap_or_else(|| "Someone".to_owned());
        let channel_name = event.channel_name.clone().or_else(|| {
            event
                .channel_id
                .as_deref()
                .and_then(|id| self.channel_name(id))
        });
        let text = event
            .message
            .as_ref()
            .map(|message| spans_text(&message.spans))
            .unwrap_or_default();
        let in_channel = channel_name
            .as_ref()
            .map(|name| format!(" in #{name}"))
            .unwrap_or_default();
        let (title, fallback) = match kind {
            NotificationKind::Mention => {
                (format!("{author} mentioned you{in_channel}"), "New mention")
            }
            NotificationKind::DirectMessage => {
                let group = event.direct_message_group_id.as_deref().and_then(|id| {
                    self.cache
                        .dm_groups(&keys::op(keys::DMS))
                        .and_then(|groups| groups.iter().find(|group| group.id == id))
                        .and_then(|group| dm_title(group, &me_id))
                });
                (group.unwrap_or_else(|| author.clone()), "New message")
            }
            NotificationKind::ChannelMessage => (format!("{author}{in_channel}"), "New message"),
            NotificationKind::ThreadReply => (
                format!("{author} replied in a thread{in_channel}"),
                "New reply",
            ),
        };
        let body = if text.trim().is_empty() {
            fallback.to_owned()
        } else {
            truncate(text.trim(), BODY_CHARS)
        };
        self.w2.raised.push_back(event.notification_id.clone());
        if self.w2.raised.len() > RAISED_KEPT {
            self.w2.raised.pop_front();
        }
        self.w2.raised_tags.insert(tag.clone());
        self.push_event(CoreEvent::Notify {
            notification: OsNotification {
                id: event.notification_id.clone(),
                tag,
                title,
                body,
                link: MessageLink {
                    community_id: event.community_id.clone(),
                    conversation,
                    message_id: event.message_id.clone(),
                },
                parent_message_id: None,
                sound,
            },
        });
    }

    /// `notificationRead`, from any device: the row is read, and no rollback may undo it.
    pub(crate) fn w2_on_notification_read(&mut self, notification_id: &str) {
        let key = keys::op(keys::NOTIFICATIONS);
        self.note_direct_update(&key);
        if let Some(pending) = self.w2.pending_reads.get_mut(notification_id) {
            pending.heard = true;
        }
        if let Some(row) = self
            .cache
            .notifications_mut(&key)
            .and_then(|pages| pages.rows.iter_mut().find(|row| row.id == notification_id))
        {
            row.read = true;
            self.notifications_changed();
        }
        self.badge_changed();
    }

    /// This user read a channel or DM, here or on another device. The server marked its mentions
    /// and messages read and said nothing about them.
    pub(crate) fn w2_on_context_read(&mut self, conversation: &Conversation) {
        let key = keys::op(keys::NOTIFICATIONS);
        self.note_direct_update(&key);
        let (channel, dm) = match conversation {
            Conversation::Channel { id } => (Some(id.as_str()), None),
            Conversation::DirectMessage { id } => (None, Some(id.as_str())),
            Conversation::Thread { .. } => return,
        };
        let mut changed = false;
        if let Some(pages) = self.cache.notifications_mut(&key) {
            for row in pages.rows.iter_mut().filter(|row| {
                let here = match (channel, dm) {
                    (Some(id), _) => row.channel_id.as_deref() == Some(id),
                    (_, Some(id)) => row.direct_message_group_id.as_deref() == Some(id),
                    _ => false,
                };
                here && !row.read && row.type_ != NotificationType::ThreadReply
            }) {
                row.read = true;
                changed = true;
            }
        }
        if changed {
            self.notifications_changed();
        }
        self.recount_notifications();
        if let Some(tag) = tag_for(conversation)
            && self.w2.raised_tags.remove(&tag)
        {
            self.push_event(CoreEvent::WithdrawNotifications { tag });
        }
    }

    pub(crate) fn notification_list(&mut self) -> NotificationList {
        let key = keys::op(keys::NOTIFICATIONS);
        self.ensure_query(key.clone());
        self.ensure_query(keys::op(keys::NOTIFICATION_COUNT));
        let state = self.query_load_state(&key);
        let Some(pages) = self.cache.notifications(&key) else {
            return NotificationList {
                state,
                ..NotificationList::default()
            };
        };
        let rows = pages
            .rows
            .iter()
            .filter(|row| !row.dismissed)
            .filter_map(|row| {
                let conversation = conversation_of(&row.channel_id, &row.direct_message_group_id)?;
                Some(NotificationRow {
                    id: row.id.clone(),
                    kind: kind_from_wire(&row.type_),
                    author: author_view(row.author.as_ref(), &row.author_id),
                    link: MessageLink {
                        community_id: row.community_id.clone(),
                        conversation,
                        message_id: row.message_id.clone(),
                    },
                    parent_message_id: row.parent_message_id.clone(),
                    channel_name: row
                        .channel_id
                        .as_deref()
                        .and_then(|id| self.channel_name(id)),
                    preview: row
                        .message
                        .as_ref()
                        .map(|message| spans_text(&message.spans))
                        .unwrap_or_default(),
                    created_at_ms: row.created_at.timestamp_millis(),
                    read: self.notification_read_shown(row),
                })
            })
            .collect();
        NotificationList {
            state,
            rows,
            unread_count: self.badge(),
            has_more: (pages.rows.len() as i64) < pages.total,
        }
    }

    pub(crate) fn badge(&self) -> u32 {
        if self.me.is_none() || self.w2.all_read_pending.is_some() {
            return 0;
        }
        self.cache
            .notification_count(&keys::op(keys::NOTIFICATION_COUNT))
            .map_or(0, |count| (*count).max(0) as u32)
    }

    /// Loading until it arrives, failed if the last read failed.
    pub(crate) fn query_load_state(&self, key: &QueryKey) -> LoadState {
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
    /// The first page of the centre, or as many rows as are loaded now, for a refetch.
    pub(crate) async fn fetch_notifications(&self) -> Result<CacheValue, CoreError> {
        let backend = &self
            .services()
            .ok_or_else(|| unavailable("the backend"))?
            .backend;
        let wanted = self.read(|state| {
            state
                .cache
                .notifications(&keys::op(keys::NOTIFICATIONS))
                .map_or(0, |pages| pages.rows.len() as u64)
                .max(NOTIFICATION_PAGE)
        });
        let mut rows: Vec<wire::NotificationDto> = Vec::new();
        let mut total;
        loop {
            let limit = (wanted - rows.len() as u64).min(MAX_PAGE);
            let page = backend
                .notifications_controller_get_notifications(
                    Some(limit),
                    Some(rows.len() as u64),
                    None,
                )
                .await
                .map_err(|error| self.backend_failed(error))?;
            total = page.total;
            let got = page.notifications.len() as u64;
            for row in page.notifications {
                if !rows.iter().any(|known| known.id == row.id) {
                    rows.push(row);
                }
            }
            if got < limit || rows.len() as u64 >= wanted || rows.len() as i64 >= total {
                break;
            }
        }
        Ok(CacheValue::Notifications(NotificationPages { rows, total }))
    }

    pub(crate) async fn fetch_notify_settings(&self) -> Result<CacheValue, CoreError> {
        let backend = &self
            .services()
            .ok_or_else(|| unavailable("the backend"))?
            .backend;
        Ok(CacheValue::NotifySettings(
            backend
                .notifications_controller_get_settings()
                .await
                .map_err(|error| self.backend_failed(error))?,
        ))
    }

    pub(crate) async fn fetch_channel_level(
        &self,
        channel_id: String,
    ) -> Result<CacheValue, CoreError> {
        let backend = &self
            .services()
            .ok_or_else(|| unavailable("the backend"))?
            .backend;
        Ok(CacheValue::ChannelLevel(
            backend
                .notifications_controller_get_channel_override(channel_id)
                .await
                .map_err(|error| self.backend_failed(error))?,
        ))
    }

    /// The services, and the session this call belongs to.
    pub(crate) fn begin(&self, what: &str) -> Result<(crate::client::Services, u64), CoreError> {
        let services = self.services().ok_or_else(|| unavailable(what))?.clone();
        let epoch = self.read(|state| state.me.is_some().then_some(state.session_epoch));
        let epoch = epoch.ok_or_else(|| CoreError::Failed {
            message: "signed out".into(),
        })?;
        Ok((services, epoch))
    }

    /// The notification centre's first page, and what's loaded since. `ViewKey::Notifications` says
    /// when to read again.
    pub fn notifications(&self) -> NotificationList {
        self.write(|state, _| state.notification_list())
    }

    /// Reads the next page. Nothing to do when `has_more` is false, or while a page is on its way.
    pub async fn load_more_notifications(&self) -> Result<(), CoreError> {
        let (services, epoch) = self.begin("notifications")?;
        let key = keys::op(keys::NOTIFICATIONS);
        let offset = self.write(|state, _| {
            if state.w2.more_loading {
                return None;
            }
            let pages = state.cache.notifications(&key)?;
            if pages.rows.len() as i64 >= pages.total {
                return None;
            }
            let offset = pages.rows.len() as u64;
            state.w2.more_loading = true;
            Some(offset)
        });
        let Some(offset) = offset else {
            return Ok(());
        };
        let result = services
            .backend
            .notifications_controller_get_notifications(Some(NOTIFICATION_PAGE), Some(offset), None)
            .await
            .map_err(|error| self.backend_failed(error));
        self.write(|state, _| {
            if state.session_epoch != epoch {
                return;
            }
            state.w2.more_loading = false;
            let Ok(page) = &result else {
                return;
            };
            state.note_direct_update(&key);
            if let Some(pages) = state.cache.notifications_mut(&key) {
                // Rows that arrived meanwhile push the older ones down: this page may repeat some.
                for row in &page.notifications {
                    if !pages.rows.iter().any(|known| known.id == row.id) {
                        pages.rows.push(row.clone());
                    }
                }
                pages.total = page.total.max(pages.rows.len() as i64);
            }
            state.notifications_changed();
        });
        result.map(|_| ())
    }

    /// Shown read at once; back if the server refuses, unless the server said meanwhile that it is
    /// read.
    pub async fn mark_notification_read(&self, notification_id: String) -> Result<(), CoreError> {
        let (services, epoch) = self.begin("notifications")?;
        let change = self.write(|state, _| {
            let change = state.next_change();
            state.w2.pending_reads.insert(
                notification_id.clone(),
                PendingRead {
                    change,
                    heard: false,
                },
            );
            state.notifications_changed();
            change
        });
        let result = services
            .backend
            .notifications_controller_mark_as_read(notification_id.clone())
            .await
            .map_err(|error| self.backend_failed(error));
        self.write(|state, _| {
            if state.session_epoch != epoch {
                return;
            }
            let pending = state.w2.pending_reads.get(&notification_id).copied();
            let latest = pending.is_some_and(|pending| pending.change == change);
            if latest {
                state.w2.pending_reads.remove(&notification_id);
            }
            if result.is_ok() || pending.is_some_and(|pending| pending.heard) {
                let key = keys::op(keys::NOTIFICATIONS);
                state.note_direct_update(&key);
                if let Some(row) = state
                    .cache
                    .notifications_mut(&key)
                    .and_then(|pages| pages.rows.iter_mut().find(|row| row.id == notification_id))
                {
                    row.read = true;
                }
            }
            state.notifications_changed();
            state.recount_notifications();
        });
        result.map(|_| ())
    }

    /// Every notification read. The count shows 0 at once; back if the server refuses.
    pub async fn mark_all_notifications_read(&self) -> Result<(), CoreError> {
        let (services, epoch) = self.begin("notifications")?;
        let change = self.write(|state, _| {
            let change = state.next_change();
            state.w2.all_read_pending = Some(change);
            state.notifications_changed();
            state.badge_changed();
            change
        });
        let result = services
            .backend
            .notifications_controller_mark_all_as_read()
            .await
            .map_err(|error| self.backend_failed(error));
        self.write(|state, _| {
            if state.session_epoch != epoch {
                return;
            }
            if state.w2.all_read_pending == Some(change) {
                state.w2.all_read_pending = None;
            }
            if result.is_ok() {
                let key = keys::op(keys::NOTIFICATIONS);
                state.note_direct_update(&key);
                if let Some(pages) = state.cache.notifications_mut(&key) {
                    for row in &mut pages.rows {
                        row.read = true;
                    }
                }
                for tag in std::mem::take(&mut state.w2.raised_tags) {
                    state.push_event(CoreEvent::WithdrawNotifications { tag });
                }
            }
            state.notifications_changed();
            state.badge_changed();
            state.recount_notifications();
        });
        result.map(|_| ())
    }

    /// Takes it off the list once the server agrees.
    pub async fn dismiss_notification(&self, notification_id: String) -> Result<(), CoreError> {
        let (services, epoch) = self.begin("notifications")?;
        let result = services
            .backend
            .notifications_controller_dismiss_notification(notification_id.clone())
            .await
            .map_err(|error| self.backend_failed(error));
        self.write(|state, _| {
            if state.session_epoch != epoch || result.is_err() {
                return;
            }
            let key = keys::op(keys::NOTIFICATIONS);
            state.note_direct_update(&key);
            if let Some(row) = state
                .cache
                .notifications_mut(&key)
                .and_then(|pages| pages.rows.iter_mut().find(|row| row.id == notification_id))
            {
                row.dismissed = true;
            }
            state.notifications_changed();
            state.recount_notifications();
        });
        result.map(|_| ())
    }

    /// `ViewKey::NotificationSettings` says when to read again.
    pub fn notification_settings(&self) -> NotificationSettingsView {
        self.write(|state, _| {
            let key = keys::op(keys::NOTIFY_SETTINGS);
            state.ensure_query(key.clone());
            NotificationSettingsView {
                state: state.query_load_state(&key),
                settings: state.effective_settings(),
            }
        })
    }

    /// Changes the fields the patch sets. Shown at once; back if the server refuses. The DND times
    /// are `HH:mm`, and an empty string clears one; the timezone should be set with them, as the web
    /// sends the device's own.
    pub async fn update_notification_settings(
        &self,
        patch: NotificationSettingsPatch,
    ) -> Result<(), CoreError> {
        let body = patch_body(&patch)?;
        let (services, epoch) = self.begin("notification settings")?;
        let change = self.write(|state, _| {
            let change = state.next_change();
            state.w2.settings_overlays.push((change, patch));
            state.view_changed(ViewKey::NotificationSettings);
            change
        });
        let result = services
            .backend
            .notifications_controller_update_settings(body)
            .await
            .map_err(|error| self.backend_failed(error));
        self.write(|state, now| {
            if state.session_epoch != epoch {
                return;
            }
            state
                .w2
                .settings_overlays
                .retain(|(overlay, _)| *overlay != change);
            if let Ok(dto) = &result
                && change > state.w2.settings_applied
            {
                state.w2.settings_applied = change;
                let key = keys::op(keys::NOTIFY_SETTINGS);
                state.note_direct_update(&key);
                state
                    .cache
                    .set(key, CacheValue::NotifySettings(dto.clone()), now);
            }
            state.view_changed(ViewKey::NotificationSettings);
        });
        result.map(|_| ())
    }

    /// `ViewKey::ChannelNotifyLevel` says when to read again.
    pub fn channel_notify_level(&self, channel_id: String) -> ChannelNotifyLevelView {
        self.write(|state, _| {
            let key = keys::scoped(keys::CHANNEL_LEVEL, &channel_id);
            state.ensure_query(key.clone());
            state.ensure_query(keys::op(keys::NOTIFY_SETTINGS));
            let level = state.shown_level(&channel_id).flatten();
            ChannelNotifyLevelView {
                state: if state.w2.level_overlays.contains_key(&channel_id) {
                    LoadState::Ready
                } else {
                    state.query_load_state(&key)
                },
                level,
                effective: level.unwrap_or(state.effective_settings().default_level),
            }
        })
    }

    /// Gives a channel its own level, or (`None`) puts it back to the default. Shown at once; back
    /// if the server refuses.
    pub async fn set_channel_notify_level(
        &self,
        channel_id: String,
        level: Option<NotifyLevel>,
    ) -> Result<(), CoreError> {
        let (services, epoch) = self.begin("channel notification levels")?;
        let change = self.write(|state, _| {
            let change = state.next_change();
            state
                .w2
                .level_overlays
                .insert(channel_id.clone(), (change, level));
            state.view_changed(ViewKey::ChannelNotifyLevel {
                channel_id: channel_id.clone(),
            });
            change
        });
        let result = match level {
            Some(level) => services
                .backend
                .notifications_controller_set_channel_override(
                    channel_id.clone(),
                    wire::UpdateChannelOverrideDto {
                        level: level_to_wire(level),
                    },
                )
                .await
                .map(Some),
            None => services
                .backend
                .notifications_controller_delete_channel_override(channel_id.clone())
                .await
                .map(|()| None),
        }
        .map_err(|error| self.backend_failed(error));
        self.write(|state, now| {
            if state.session_epoch != epoch {
                return;
            }
            if state
                .w2
                .level_overlays
                .get(&channel_id)
                .is_some_and(|(overlay, _)| *overlay == change)
            {
                state.w2.level_overlays.remove(&channel_id);
            }
            let applied = state
                .w2
                .level_applied
                .entry(channel_id.clone())
                .or_default();
            if let Ok(dto) = &result
                && change > *applied
            {
                *applied = change;
                let key = keys::scoped(keys::CHANNEL_LEVEL, &channel_id);
                state.note_direct_update(&key);
                state
                    .cache
                    .set(key.clone(), CacheValue::ChannelLevel(dto.clone()), now);
                state.failed_queries.remove(&key);
            }
            state.view_changed(ViewKey::ChannelNotifyLevel {
                channel_id: channel_id.clone(),
            });
        });
        result.map(|_| ())
    }

    /// The tray and dock badge: unread notifications, as the web's `useAppBadge`. 0 when signed
    /// out. `ViewKey::Badge` says when to read again.
    pub fn badge_count(&self) -> u32 {
        self.write(|state, _| {
            state.ensure_query(keys::op(keys::NOTIFICATION_COUNT));
            state.badge()
        })
    }

    pub(crate) async fn send_idle(&self, idle: bool) {
        if let Some(services) = self.services()
            && let Err(error) = services
                .realtime
                .emit(
                    semaphore_wire::events::PRESENCE_ONLINE.to_owned(),
                    json!({ "idle": idle }),
                )
                .await
        {
            log::debug!("presenceOnline not sent: {error}");
        }
    }

    pub(crate) fn queue_idle(&self, idle: bool) {
        self.write(|state, _| {
            if state.w2.idle == idle || state.me.is_none() {
                return;
            }
            state.w2.idle = idle;
            state.push_effect(Effect::Idle(idle));
        });
        if let Some(services) = self.services() {
            services.realtime.set_idle(idle);
        }
    }
}
