//! Acting on a message: edit, delete, pin and react, and the reads that go with them (pins, who
//! reacted, what this user may moderate). Unit W1-core part A.
//!
//! From the web's `useMessageActions`, `useMessagePermissions` and `PinnedMessagesPanel`, with two
//! differences, both decided for W1 (`docs/parity-plan.md`, "W1 defaults"):
//!
//! - An edit keeps every span's formatting and target. The web's re-parses the edited text and
//!   sends only some span fields, so bold, italic, strike, code, `#channel` and alias mentions
//!   don't survive an edit there. Here mentions travel as id-carrying ranges of the draft
//!   ([`Core::edit_draft`]) and every flag is sent.
//! - A moderator deleting someone else's message removes it (the moderation endpoint), so
//!   moderators keep its text and reason. The author's own delete is a hard delete, as on the web.
//!
//! Edits, pins and reactions show at once and go back if the server refuses. Whatever the server
//! sends last wins: a response, or an event that arrived meanwhile, replaces the local guess.

use crate::cache::keys;
use crate::client::{Core, State, user_view};
use crate::model::{
    ChannelModeration, LoadState, MentionKind, MessageDraft, PinnedList, PinnedRow, ReactionUsers,
    UserView, ViewKey,
};
use crate::platform::CoreError;
use crate::resync::unavailable;
use crate::send::{is_optimistic_id, span_json};
use crate::store::{Row, StoredMessage, project, span_input};
use crate::text::{draft_to_spans, spans_to_text};
use semaphore_wire::enums::{InstanceRole, RbacAction};
use semaphore_wire::types::{self as wire, MessageDto};
use serde_json::Value;
use std::collections::HashMap;

/// How many reactors a tooltip names: the web's `ReactionTooltip`.
pub const REACTION_USERS_SHOWN: usize = 15;
/// How many reaction tooltips are told when their users change.
const WATCHED_REACTIONS: usize = 16;

/// An edit on its way: what the row was, and what core showed instead.
#[derive(Debug, Clone)]
pub(crate) struct PendingEdit {
    original: MessageDto,
    shown: Value,
}

/// What these commands keep between calls. Forgotten at sign-out.
#[derive(Debug, Default)]
pub(crate) struct ActionsState {
    /// By message id. A row here shows `edit_pending`.
    pub pending_edits: HashMap<String, PendingEdit>,
    /// The reaction tooltips read lately, by message id and emoji, newest last.
    watched_reactions: Vec<(String, String)>,
}

fn failed(message: impl Into<String>) -> CoreError {
    CoreError::Failed {
        message: message.into(),
    }
}

fn timestamp(now_ms: u64) -> chrono::DateTime<chrono::Utc> {
    chrono::DateTime::<chrono::Utc>::from_timestamp_millis(now_ms as i64).unwrap_or_default()
}

/// A pinned message as a message: the same fields, plus an author the message doesn't carry.
fn pinned_message(pinned: &wire::PinnedMessageDto) -> Option<MessageDto> {
    serde_json::to_value(pinned)
        .ok()
        .and_then(|value| serde_json::from_value(value).ok())
}

fn same(dto: &MessageDto, shown: &Value) -> bool {
    serde_json::to_value(dto).is_ok_and(|value| value == *shown)
}

fn draft_kind(kind: &str) -> Option<MentionKind> {
    Some(match kind {
        "USER_MENTION" => MentionKind::User,
        "SPECIAL_MENTION" => MentionKind::Special,
        "ALIAS_MENTION" => MentionKind::Alias,
        "CHANNEL_MENTION" => MentionKind::Channel,
        "COMMUNITY_MENTION" => MentionKind::Community,
        "EMOJI" => MentionKind::Emoji,
        _ => return None,
    })
}

impl State {
    /// A message as loaded anywhere: a window, or a channel's pins.
    pub(crate) fn find_message(&self, id: &str) -> Option<MessageDto> {
        self.windows
            .values()
            .find_map(|window| window.find(id))
            .map(|message| message.dto.clone())
            .or_else(|| {
                self.cache.keys_with_op(keys::PINS).iter().find_map(|key| {
                    self.cache
                        .pins(key)?
                        .iter()
                        .find(|pinned| pinned.id == id)
                        .and_then(pinned_message)
                })
            })
    }

    /// Changes a message wherever it's loaded.
    fn edit_everywhere(&mut self, id: &str, change: impl Fn(&mut MessageDto)) {
        for window in self.windows.values_mut() {
            if window.edit(id, &change) {
                window.note_update(id, None);
            }
        }
    }

    /// Replaces a message wherever it's loaded, with what the server sent.
    fn replace_everywhere(&mut self, dto: &MessageDto) {
        for window in self.windows.values_mut() {
            window.note_update(&dto.id, Some(dto.clone()));
            window.update(dto.clone(), None);
        }
    }

    /// Whether what's loaded of a message is still what core showed for it.
    fn still_shown(&self, id: &str, shown: &Value) -> bool {
        self.windows
            .values()
            .find_map(|window| window.find(id))
            .is_some_and(|message| same(&message.dto, shown))
    }

    fn is_instance_owner(&self) -> bool {
        self.cache
            .profile(&keys::op(keys::PROFILE))
            .is_some_and(|profile| profile.role == InstanceRole::Owner)
    }

    /// What this user may do to others' messages in a channel, once their roles there are known.
    /// An instance owner may do everything, as `RbacGuard` lets them.
    pub(crate) fn moderation_of(&self, channel_id: &str) -> Option<ChannelModeration> {
        if self.is_instance_owner() {
            return Some(ChannelModeration {
                pin: true,
                unpin: true,
                remove_any: true,
            });
        }
        let roles = self
            .cache
            .channel_roles(&keys::scoped(keys::CHANNEL_ROLES, channel_id))?;
        let has = |action: &RbacAction| {
            roles
                .roles
                .iter()
                .any(|role| role.actions.iter().any(|held| held == action))
        };
        Some(ChannelModeration {
            pin: has(&RbacAction::PinMessage),
            unpin: has(&RbacAction::UnpinMessage),
            remove_any: has(&RbacAction::DeleteAnyMessage),
        })
    }

    /// A removed message as this reader may see it, the server's rule (`blankRemovedMessage`)
    /// applied again to what comes over the socket: the server blanks only what it answers over
    /// REST, so an event about a removed message could carry its text to anyone.
    pub(crate) fn blank_for_reader(&self, dto: &mut MessageDto) {
        if dto.deleted_at.is_none() {
            return;
        }
        let may_see = dto
            .channel_id
            .as_deref()
            .and_then(|channel_id| self.moderation_of(channel_id))
            .is_some_and(|moderation| moderation.remove_any);
        if may_see {
            return;
        }
        dto.spans.clear();
        dto.attachments.clear();
        dto.reactions.clear();
        dto.link_previews = None;
        dto.pending_attachments = Some(0);
        dto.reply_to_id = None;
        dto.reply_to = None;
        dto.deleted_by = None;
        dto.deleted_by_reason = None;
    }

    /// Takes a message out of its channel's pins, if they're loaded.
    pub(crate) fn drop_from_pins(&mut self, channel_id: Option<&str>, message_id: &str) {
        let Some(channel_id) = channel_id else {
            return;
        };
        let key = keys::scoped(keys::PINS, channel_id);
        self.note_direct_update(&key);
        let Some(pins) = self.cache.pins_mut(&key) else {
            return;
        };
        let before = pins.len();
        pins.retain(|pinned| pinned.id != message_id);
        if pins.len() != before {
            self.view_changed(ViewKey::Pins {
                channel_id: channel_id.to_owned(),
            });
        }
    }

    /// A `deleteMessage` for a reader who may see removed messages in that channel: the row turns
    /// removed, keeping its text, and is read again to learn which it was. False when the reader
    /// may not, or the row isn't loaded: then it goes, as on the web.
    pub(crate) fn removal_kept(
        &mut self,
        payload: &wire::DeleteMessagePayloadDto,
        now: u64,
    ) -> bool {
        let Some(channel_id) = payload.channel_id.as_deref() else {
            return false;
        };
        let id = &payload.message_id;
        let loaded = self
            .windows
            .values()
            .any(|window| window.find(id).is_some());
        let allowed = self.moderation_of(channel_id).is_some_and(|m| m.remove_any);
        if !allowed {
            // For the next one: the roles weren't asked for yet, or say no.
            self.ensure_query(keys::scoped(keys::CHANNEL_ROLES, channel_id));
        }
        if !loaded || !allowed {
            return false;
        }
        let at = timestamp(now);
        self.edit_everywhere(id, |dto| {
            if dto.deleted_at.is_none() {
                dto.deleted_at = Some(at);
            }
        });
        self.push_effect(crate::client::Effect::RefetchMessage(id.clone()));
        true
    }

    /// The reaction tooltips that show this message, or all of them, should read again.
    pub(crate) fn reaction_users_changed(&mut self, message_id: Option<&str>) {
        let watched: Vec<(String, String)> = self
            .actions
            .watched_reactions
            .iter()
            .filter(|(id, _)| message_id.is_none_or(|message_id| id == message_id))
            .cloned()
            .collect();
        for (message_id, emoji) in watched {
            self.view_changed(ViewKey::ReactionUsers { message_id, emoji });
        }
    }

    /// Adds or takes away this user's reaction on a loaded message.
    fn set_my_reaction(&mut self, message_id: &str, emoji: &str, mine: bool) {
        let me = self.me_id().to_owned();
        self.edit_everywhere(message_id, |dto| {
            match dto.reactions.iter_mut().find(|r| r.emoji == emoji) {
                Some(reaction) => {
                    reaction.user_ids.retain(|id| *id != me);
                    if mine {
                        reaction.user_ids.push(me.clone());
                    }
                }
                None if mine => dto.reactions.push(wire::ReactionDto {
                    emoji: emoji.to_owned(),
                    user_ids: vec![me.clone()],
                }),
                None => {}
            }
            dto.reactions
                .retain(|reaction| !reaction.user_ids.is_empty());
        });
        self.reaction_users_changed(Some(message_id));
    }
}

impl Core {
    /// The message as an editable draft: its text, with each mention and custom emoji as a range
    /// that keeps its id, and formatting as the composer's markers. `None` if it isn't loaded.
    /// Pass the draft, changed, to [`Core::edit_message`].
    pub fn edit_draft(&self, message_id: String) -> Option<MessageDraft> {
        self.read(|state| {
            let dto = state.find_message(&message_id)?;
            let channel_name = |id: &str| -> Option<String> {
                state
                    .cache
                    .keys_with_op(keys::CHANNELS)
                    .iter()
                    .find_map(|key| {
                        state
                            .cache
                            .channels(key)?
                            .iter()
                            .find(|channel| channel.id == id)
                            .map(|channel| channel.name.clone())
                    })
            };
            let mut draft = MessageDraft {
                reply_to_message_id: dto.reply_to_id.clone(),
                ..MessageDraft::default()
            };
            for span in &dto.spans {
                let input = span_input(span);
                let label = spans_to_text(std::slice::from_ref(&input), Some(&channel_name));
                let id = match input.kind.as_str() {
                    "USER_MENTION" => input.user_id.clone(),
                    "SPECIAL_MENTION" => input.special_kind.clone(),
                    "ALIAS_MENTION" => input.alias_id.clone(),
                    "CHANNEL_MENTION" => input.channel_id.clone(),
                    "COMMUNITY_MENTION" => input.community_id.clone(),
                    "EMOJI" => input.emoji_id.clone(),
                    _ => None,
                };
                let start = draft.text.len() as u32;
                draft.text.push_str(&label);
                if let (Some(kind), Some(id)) = (draft_kind(&input.kind), id)
                    && !label.is_empty()
                {
                    draft.mentions.push(crate::model::DraftMention {
                        start,
                        end: draft.text.len() as u32,
                        kind,
                        id,
                    });
                }
            }
            Some(draft)
        })
    }

    /// Replaces a message's text with `draft`'s, at once; the row shows `edit_pending` until the
    /// server answers, and goes back if it refuses. Only the author may edit. `draft.files` must be
    /// empty: an edit can't add files. `keep_attachment_ids` lists the attachments to keep (any
    /// left out are removed); `None` keeps them all.
    pub async fn edit_message(
        &self,
        message_id: String,
        draft: MessageDraft,
        keep_attachment_ids: Option<Vec<String>>,
    ) -> Result<(), CoreError> {
        let services = self.services().ok_or_else(|| unavailable("editing"))?;
        if !draft.files.is_empty() {
            return Err(failed("an edit can't add files"));
        }
        if is_optimistic_id(&message_id) {
            return Err(failed("this message hasn't been sent yet"));
        }
        let mut spans: Vec<Value> = draft_to_spans(&draft).iter().map(span_json).collect();
        if spans.is_empty() {
            // The web's rule: an edit always has a span.
            spans.push(serde_json::json!({ "type": "PLAINTEXT", "text": draft.text }));
        }
        let wire_spans: Vec<wire::CreateMessageSpanDto> =
            serde_json::from_value(Value::Array(spans.clone()))
                .map_err(|error| failed(format!("the edit can't be sent: {error}")))?;
        let shown_spans: Vec<wire::SpanDto> = serde_json::from_value(Value::Array(spans))
            .map_err(|error| failed(format!("the edit can't be shown: {error}")))?;
        let attachments = self.write(|state, now| {
            let original = state
                .find_message(&message_id)
                .ok_or_else(|| failed("that message isn't loaded"))?;
            if original.author_id.as_deref() != Some(state.me_id()) {
                return Err(failed("only the author can edit a message"));
            }
            if original.deleted_at.is_some() {
                return Err(failed("this message was removed"));
            }
            let keep = keep_attachment_ids.clone().unwrap_or_else(|| {
                original
                    .attachments
                    .iter()
                    .map(|file| file.id.clone())
                    .collect()
            });
            let mut shown = original.clone();
            shown.spans = shown_spans.clone();
            shown.edited_at = Some(timestamp(now));
            shown.attachments.retain(|file| keep.contains(&file.id));
            let shown_value = serde_json::to_value(&shown).unwrap_or_default();
            state.replace_everywhere(&shown);
            state.actions.pending_edits.insert(
                message_id.clone(),
                PendingEdit {
                    original,
                    shown: shown_value,
                },
            );
            Ok(keep)
        })?;
        let body = wire::UpdateMessageDto {
            attachments,
            channel_id: None,
            direct_message_group_id: None,
            pending_attachments: None,
            reply_to_id: None,
            spans: wire_spans,
        };
        let result = services
            .backend
            .messages_controller_update(message_id.clone(), body)
            .await
            .map_err(|error| self.backend_failed(error));
        self.write(|state, _| {
            let Some(pending) = state.actions.pending_edits.remove(&message_id) else {
                return;
            };
            let still_shown = state.still_shown(&message_id, &pending.shown);
            match &result {
                Ok(dto) if still_shown => state.replace_everywhere(dto),
                Err(_) if still_shown => state.replace_everywhere(&pending.original),
                // Something newer from the server replaced it meanwhile, and stands. The row is
                // sent again, to clear `edit_pending`.
                _ => state.edit_everywhere(&message_id, |_| {}),
            }
        });
        result.map(|_| ())
    }

    /// Deletes a message. The author's own goes for everyone (a hard delete). Someone else's, in a
    /// channel where this user may remove messages, is removed: moderators keep seeing its text
    /// and `reason`. Nothing changes until the server agrees.
    pub async fn delete_message(
        &self,
        message_id: String,
        reason: Option<String>,
    ) -> Result<(), CoreError> {
        let services = self.services().ok_or_else(|| unavailable("deleting"))?;
        if is_optimistic_id(&message_id) {
            return Err(failed("this message hasn't been sent yet"));
        }
        let (dto, mine) = self.read(|state| {
            let dto = state.find_message(&message_id);
            let mine = dto
                .as_ref()
                .is_some_and(|dto| dto.author_id.as_deref() == Some(state.me_id()));
            (dto, mine)
        });
        let dto = dto.ok_or_else(|| failed("that message isn't loaded"))?;
        if mine {
            services
                .backend
                .messages_controller_remove(message_id.clone())
                .await
                .map_err(|error| self.backend_failed(error))?;
            self.write(|state, _| {
                let payload = wire::DeleteMessagePayloadDto {
                    channel_id: dto.channel_id.clone(),
                    direct_message_group_id: dto.direct_message_group_id.clone(),
                    message_id: message_id.clone(),
                };
                state.drop_from_pins(dto.channel_id.as_deref(), &message_id);
                state.remove_message(&payload);
            });
            return Ok(());
        }
        let channel_id = dto
            .channel_id
            .clone()
            .ok_or_else(|| failed("only the author can delete this message"))?;
        if !self.moderation(&channel_id).await?.remove_any {
            return Err(failed("you can't remove other people's messages here"));
        }
        services
            .backend
            .moderation_controller_delete_message_as_mod(
                message_id.clone(),
                wire::DeleteMessageAsModDto {
                    reason: reason.clone(),
                },
            )
            .await
            .map_err(|error| self.backend_failed(error))?;
        self.write(|state, now| {
            let me = state.me_id().to_owned();
            let at = timestamp(now);
            state.edit_everywhere(&message_id, |dto| {
                dto.deleted_at = Some(at);
                dto.deleted_by = Some(me.clone());
                dto.deleted_by_reason = reason.clone();
            });
            state.drop_from_pins(Some(&channel_id), &message_id);
        });
        Ok(())
    }

    /// After a `deleteMessage`, for a reader who may see removed messages: the row as the server
    /// now shows it, or gone if it was deleted.
    pub(crate) async fn refetch_message(&self, message_id: String) {
        let Some(services) = self.services() else {
            return;
        };
        let result = services
            .backend
            .messages_controller_find_one(message_id.clone())
            .await;
        self.write(|state, _| {
            let dto = state.find_message(&message_id);
            match result {
                Ok(fresh) if fresh.deleted_at.is_some() => state.replace_everywhere(&fresh),
                // Gone (404), or unreadable: it goes, as it would on the web.
                _ => {
                    if let Some(dto) = dto {
                        state.remove_message(&wire::DeleteMessagePayloadDto {
                            channel_id: dto.channel_id,
                            direct_message_group_id: dto.direct_message_group_id,
                            message_id,
                        });
                    }
                }
            }
        });
    }

    /// What this user may do to others' messages in a channel, reading their roles if needed.
    async fn moderation(&self, channel_id: &str) -> Result<ChannelModeration, CoreError> {
        if let Some(moderation) = self.read(|state| state.moderation_of(channel_id)) {
            return Ok(moderation);
        }
        let services = self.services().ok_or_else(|| unavailable("roles"))?;
        let roles = services
            .backend
            .roles_controller_get_my_roles_for_channel(channel_id.to_owned())
            .await
            .map_err(|error| self.backend_failed(error))?;
        Ok(self.write(|state, now| {
            let key = keys::scoped(keys::CHANNEL_ROLES, channel_id);
            state.cache.set(
                key.clone(),
                crate::cache::CacheValue::ChannelRoles(roles),
                now,
            );
            state.query_changed(&key);
            state.moderation_of(channel_id).unwrap_or_default()
        }))
    }

    /// What this user may do to others' messages in a channel. `None` until their roles there
    /// arrive: `ViewChanged(ChannelModeration)` says when to read again. Show no moderator actions
    /// meanwhile.
    pub fn channel_moderation(&self, channel_id: String) -> Option<ChannelModeration> {
        self.write(|state, _| {
            if !state.is_instance_owner() {
                state.ensure_query(keys::scoped(keys::CHANNEL_ROLES, &channel_id));
            }
            state.moderation_of(&channel_id)
        })
    }

    /// Pins a channel message, at once; it goes back if the server refuses. `reason` goes to the
    /// moderation log.
    pub async fn pin_message(
        &self,
        message_id: String,
        reason: Option<String>,
    ) -> Result<(), CoreError> {
        self.set_pinned(message_id, true, reason).await
    }

    /// Unpins a channel message, at once, and takes it out of the pins list; both go back if the
    /// server refuses.
    pub async fn unpin_message(
        &self,
        message_id: String,
        reason: Option<String>,
    ) -> Result<(), CoreError> {
        self.set_pinned(message_id, false, reason).await
    }

    async fn set_pinned(
        &self,
        message_id: String,
        pinned: bool,
        reason: Option<String>,
    ) -> Result<(), CoreError> {
        let services = self.services().ok_or_else(|| unavailable("pins"))?;
        let begun = self.write(|state, now| {
            let dto = state
                .find_message(&message_id)
                .ok_or_else(|| failed("that message isn't loaded"))?;
            let channel_id = dto
                .channel_id
                .clone()
                .ok_or_else(|| failed("only channel messages can be pinned"))?;
            let me = state.me_id().to_owned();
            let at = timestamp(now);
            state.edit_everywhere(&message_id, |dto| {
                dto.pinned = pinned;
                dto.pinned_by = pinned.then(|| me.clone());
                dto.pinned_at = pinned.then_some(at);
            });
            // An unpin leaves the pins list at once; kept to put back.
            let key = keys::scoped(keys::PINS, &channel_id);
            let unlisted = if pinned {
                None
            } else {
                state.note_direct_update(&key);
                let pins = state.cache.pins_mut(&key);
                let found = pins.and_then(|pins| {
                    let index = pins.iter().position(|pin| pin.id == message_id)?;
                    Some((index, pins.remove(index)))
                });
                if found.is_some() {
                    state.view_changed(ViewKey::Pins {
                        channel_id: channel_id.clone(),
                    });
                }
                found
            };
            let shown = state
                .find_message(&message_id)
                .and_then(|dto| serde_json::to_value(dto).ok());
            Ok((dto, channel_id, unlisted, shown))
        })?;
        let (original, channel_id, unlisted, shown) = begun;
        let result = if pinned {
            services
                .backend
                .moderation_controller_pin_message(
                    message_id.clone(),
                    wire::PinMessageDto { reason },
                )
                .await
        } else {
            services
                .backend
                .moderation_controller_unpin_message(
                    message_id.clone(),
                    wire::UnpinMessageDto { reason },
                )
                .await
        }
        .map_err(|error| self.backend_failed(error));
        self.write(|state, _| {
            let key = keys::scoped(keys::PINS, &channel_id);
            match &result {
                Ok(_) => {
                    state.invalidate(&key);
                }
                Err(_) => {
                    if shown
                        .as_ref()
                        .is_some_and(|shown| state.still_shown(&message_id, shown))
                    {
                        let (was, by, at) = (
                            original.pinned,
                            original.pinned_by.clone(),
                            original.pinned_at,
                        );
                        state.edit_everywhere(&message_id, |dto| {
                            dto.pinned = was;
                            dto.pinned_by = by.clone();
                            dto.pinned_at = at;
                        });
                    }
                    if let Some((index, pin)) = unlisted
                        && let Some(pins) = state.cache.pins_mut(&key)
                        && !pins.iter().any(|listed| listed.id == pin.id)
                    {
                        pins.insert(index.min(pins.len()), pin);
                        state.view_changed(ViewKey::Pins {
                            channel_id: channel_id.clone(),
                        });
                    }
                }
            }
        });
        result.map(|_| ())
    }

    /// A channel's pinned messages, oldest pin first. Fetched on first read; re-read after
    /// `ViewChanged(Pins)`.
    pub fn pinned_messages(&self, channel_id: String) -> PinnedList {
        self.write(|state, _| {
            let key = keys::scoped(keys::PINS, &channel_id);
            state.ensure_query(key.clone());
            let Some(pins) = state.cache.pins(&key).cloned() else {
                let state_now = match state.failed_queries.get(&key) {
                    Some(error) => LoadState::Failed {
                        error: error.clone(),
                    },
                    None => LoadState::Loading,
                };
                return PinnedList {
                    state: state_now,
                    rows: Vec::new(),
                };
            };
            let me_id = state.me_id().to_owned();
            let embedded: HashMap<String, UserView> = pins
                .iter()
                .filter_map(|pin| pin.author.as_ref())
                .map(|author| {
                    let view = UserView {
                        id: author.id.clone(),
                        username: author.username.clone(),
                        display_name: author.display_name.clone(),
                        avatar_file_id: author.avatar_url.clone(),
                    };
                    (author.id.clone(), view)
                })
                .collect();
            let mut missing = Vec::new();
            let rows = {
                let cache = &state.cache;
                let me = state.me.clone();
                let mut author = |id: &str| -> Option<UserView> {
                    if id == me_id {
                        return me.clone();
                    }
                    let known = cache.user(&keys::scoped(keys::USER, id)).map(user_view);
                    if known.is_none() && !embedded.contains_key(id) {
                        missing.push(id.to_owned());
                    }
                    known.or_else(|| embedded.get(id).cloned())
                };
                let uploads = HashMap::new();
                pins.iter()
                    .filter_map(|pin| Some((pinned_message(pin)?, pin.parent_message_id.clone())))
                    .enumerate()
                    .map(|(index, (dto, parent_message_id))| {
                        let row = Row {
                            seq: index as i64,
                            revision: 0,
                            message: StoredMessage::from_server(dto),
                        };
                        PinnedRow {
                            row: project(&row, &me_id, &mut author, &uploads),
                            parent_message_id,
                        }
                    })
                    .collect()
            };
            for id in missing {
                state.ensure_query(keys::scoped(keys::USER, &id));
            }
            PinnedList {
                state: LoadState::Ready,
                rows,
            }
        })
    }

    /// Adds this user's reaction, at once; it goes back if the server refuses. A no-op if it's
    /// there already. `emoji` is the character, or `custom:{emojiId}` for a community emoji.
    pub async fn add_reaction(&self, message_id: String, emoji: String) -> Result<(), CoreError> {
        self.react(message_id, emoji, true).await
    }

    /// Takes this user's reaction away, at once; it comes back if the server refuses.
    pub async fn remove_reaction(
        &self,
        message_id: String,
        emoji: String,
    ) -> Result<(), CoreError> {
        self.react(message_id, emoji, false).await
    }

    /// Whether this user has reacted with `emoji` on a loaded message.
    pub(crate) fn reacted(&self, message_id: &str, emoji: &str) -> bool {
        self.read(|state| {
            state.find_message(message_id).is_some_and(|dto| {
                dto.reactions.iter().any(|reaction| {
                    reaction.emoji == emoji
                        && reaction.user_ids.iter().any(|id| id == state.me_id())
                })
            })
        })
    }

    async fn react(&self, message_id: String, emoji: String, add: bool) -> Result<(), CoreError> {
        let services = self.services().ok_or_else(|| unavailable("reactions"))?;
        // The contract types this request's id as a UUID, so unlike a send it can't carry a
        // scenario's readable id.
        let parsed = message_id
            .parse()
            .map_err(|error| failed(format!("message id {message_id}: {error}")))?;
        if self.reacted(&message_id, &emoji) == add {
            return Ok(());
        }
        self.write(|state, _| state.set_my_reaction(&message_id, &emoji, add));
        let result = if add {
            services
                .backend
                .messages_controller_add_reaction(wire::AddReactionDto {
                    emoji: emoji.clone(),
                    message_id: parsed,
                })
                .await
        } else {
            services
                .backend
                .messages_controller_remove_reaction(wire::RemoveReactionDto {
                    emoji: emoji.clone(),
                    message_id: parsed,
                })
                .await
        }
        .map_err(|error| self.backend_failed(error));
        self.write(|state, _| match &result {
            Ok(answer) => {
                let reactions = answer.reactions.clone();
                state.edit_everywhere(&answer.id, |dto| dto.reactions = reactions.clone());
                state.reaction_users_changed(Some(&answer.id));
            }
            Err(_) => state.set_my_reaction(&message_id, &emoji, !add),
        });
        result.map(|_| ())
    }

    /// Who reacted with `emoji`, named, up to [`REACTION_USERS_SHOWN`]. Names not cached yet are
    /// fetched and show as ids meanwhile: re-read after `ViewChanged(ReactionUsers)`.
    pub fn reaction_users(&self, message_id: String, emoji: String) -> ReactionUsers {
        self.write(|state, _| {
            let watched = &mut state.actions.watched_reactions;
            watched.retain(|(id, e)| !(*id == message_id && *e == emoji));
            watched.push((message_id.clone(), emoji.clone()));
            if watched.len() > WATCHED_REACTIONS {
                watched.remove(0);
            }
            let ids: Vec<String> = state
                .find_message(&message_id)
                .and_then(|dto| {
                    dto.reactions
                        .into_iter()
                        .find(|reaction| reaction.emoji == emoji)
                })
                .map(|reaction| reaction.user_ids)
                .unwrap_or_default();
            let shown = ids.len().min(REACTION_USERS_SHOWN);
            let mut users = Vec::with_capacity(shown);
            for id in &ids[..shown] {
                let key = keys::scoped(keys::USER, id);
                if id != state.me_id() && state.cache.user(&key).is_none() {
                    state.ensure_query(key);
                }
                users.push(state.user_or_stub(id));
            }
            ReactionUsers {
                users,
                more: (ids.len() - shown) as u32,
            }
        })
    }
}
