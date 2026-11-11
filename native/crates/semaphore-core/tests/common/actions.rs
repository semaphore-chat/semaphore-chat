//! [`FakeBackend`] for W1 part A: edit, delete, read one, pins, moderator removal, channel roles
//! and reactions. Each call is recorded; one can be held open, or made to fail once.

use super::{CHANNEL, FakeBackend, ME, not_found};
use semaphore_core::backend::{BackendError, BackendResult, ModerationBackend};
use semaphore_wire::enums::ErrorCode;
use semaphore_wire::types::{self as wire, MessageDto};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::sync::Mutex;
use tokio::sync::oneshot;

#[derive(Default)]
pub struct ActionsFake {
    /// Each call, as `"<op> <id>"`, in order.
    pub calls: Mutex<Vec<String>>,
    /// The next call of this op fails with this.
    pub fail: Mutex<HashMap<&'static str, BackendError>>,
    /// The next call waits for this to fire, after it's recorded.
    pub gate: Mutex<Option<oneshot::Receiver<()>>>,
    /// What `pins <channel>` answers: `PinnedMessageDto`s as JSON.
    pub pins: Mutex<HashMap<String, Vec<Value>>>,
    /// The RBAC actions this user's roles hold in every channel. Empty: no moderator.
    pub role_actions: Mutex<Vec<&'static str>>,
    /// What `find_one` answers by id; an id not here is a 404.
    pub found: Mutex<HashMap<String, MessageDto>>,
    /// What `find_one` fails with, once, instead.
    pub find_one_error: Mutex<Option<BackendError>>,
    /// Each update's body, as sent on the wire.
    pub update_bodies: Mutex<Vec<Value>>,
}

pub fn refusal(status: u16, code: &str) -> BackendError {
    BackendError {
        status,
        code: ErrorCode::Unknown(code.into()),
        message: format!("refused: {code}"),
        retryable: false,
        retry_after_ms: None,
    }
}

impl FakeBackend {
    /// Records a call, fails it if asked, and waits on the gate if one is set.
    async fn action(&self, op: &'static str, id: &str) -> BackendResult<()> {
        self.actions
            .calls
            .lock()
            .unwrap()
            .push(format!("{op} {id}"));
        let gate = self.actions.gate.lock().unwrap().take();
        if let Some(gate) = gate {
            let _ = gate.await;
        }
        match self.actions.fail.lock().unwrap().remove(op) {
            Some(error) => Err(error),
            None => Ok(()),
        }
    }

    pub fn action_calls(&self) -> Vec<String> {
        self.actions.calls.lock().unwrap().clone()
    }

    /// Holds the next action call until the returned sender fires.
    pub fn hold_next_action(&self) -> oneshot::Sender<()> {
        let (tx, rx) = oneshot::channel();
        *self.actions.gate.lock().unwrap() = Some(rx);
        tx
    }

    pub fn fail_next(&self, op: &'static str, error: BackendError) {
        self.actions.fail.lock().unwrap().insert(op, error);
    }

    fn stored(&self, id: &str) -> Option<MessageDto> {
        self.messages
            .lock()
            .unwrap()
            .values()
            .flatten()
            .find(|message| message.id == id)
            .cloned()
    }

    fn change_stored(&self, id: &str, change: impl FnOnce(&mut MessageDto)) -> Option<MessageDto> {
        let mut messages = self.messages.lock().unwrap();
        let message = messages
            .values_mut()
            .flatten()
            .find(|message| message.id == id)?;
        change(message);
        Some(message.clone())
    }

    pub async fn fake_update(
        &self,
        id: String,
        body: wire::UpdateMessageDto,
    ) -> BackendResult<MessageDto> {
        self.actions
            .update_bodies
            .lock()
            .unwrap()
            .push(serde_json::to_value(&body).unwrap());
        self.action("update", &id).await?;
        let spans: Vec<wire::SpanDto> =
            serde_json::from_value(serde_json::to_value(&body.spans).unwrap()).unwrap();
        self.change_stored(&id, |message| {
            message.spans = spans;
            message.edited_at = Some("2026-09-22T19:00:00Z".parse().unwrap());
            // As the backend: absent leaves them, a list keeps those named.
            if let Some(keep) = &body.attachments {
                message.attachments.retain(|file| keep.contains(&file.id));
            }
        })
        .ok_or_else(not_found)
    }

    pub async fn fake_remove(&self, id: String) -> BackendResult<()> {
        self.action("remove", &id).await?;
        self.messages
            .lock()
            .unwrap()
            .values_mut()
            .for_each(|rows| rows.retain(|message| message.id != id));
        Ok(())
    }

    pub async fn fake_find_one(&self, id: String) -> BackendResult<MessageDto> {
        self.action("find_one", &id).await?;
        if let Some(error) = self.actions.find_one_error.lock().unwrap().take() {
            return Err(error);
        }
        self.actions
            .found
            .lock()
            .unwrap()
            .get(&id)
            .cloned()
            .ok_or_else(not_found)
    }

    pub async fn fake_react(
        &self,
        op: &'static str,
        id: String,
        emoji: String,
        add: bool,
    ) -> BackendResult<wire::MessageReactionsDto> {
        self.action(op, &format!("{id} {emoji}")).await?;
        let message = self
            .change_stored(&id, |message| {
                match message.reactions.iter_mut().find(|r| r.emoji == emoji) {
                    Some(reaction) => {
                        reaction.user_ids.retain(|user| user != ME);
                        if add {
                            reaction.user_ids.push(ME.into());
                        }
                    }
                    None if add => message.reactions.push(wire::ReactionDto {
                        emoji: emoji.clone(),
                        user_ids: vec![ME.into()],
                    }),
                    None => {}
                }
                message.reactions.retain(|r| !r.user_ids.is_empty());
            })
            .ok_or_else(not_found)?;
        Ok(wire::MessageReactionsDto {
            channel_id: message.channel_id,
            deleted_at: message.deleted_at,
            direct_message_group_id: message.direct_message_group_id,
            id: message.id,
            parent_message_id: message.parent_message_id,
            reactions: message.reactions,
        })
    }

    /// A message as the pins route sends it, with its author.
    pub fn pinned_json(message: &MessageDto) -> Value {
        let mut value = serde_json::to_value(message).unwrap();
        value["author"] = match &message.author_id {
            Some(id) => json!({
                "id": id, "username": id, "displayName": format!("{id} shown"), "avatarUrl": null,
            }),
            None => Value::Null,
        };
        value
    }

    pub fn set_pins(&self, rows: &[MessageDto]) {
        let pins = rows.iter().map(Self::pinned_json).collect();
        self.actions
            .pins
            .lock()
            .unwrap()
            .insert(CHANNEL.into(), pins);
    }

    pub fn make_moderator(&self) {
        *self.actions.role_actions.lock().unwrap() =
            vec!["PIN_MESSAGE", "UNPIN_MESSAGE", "DELETE_ANY_MESSAGE"];
    }
}

#[async_trait::async_trait]
impl ModerationBackend for FakeBackend {
    async fn moderation_controller_pin_message(
        &self,
        message_id: String,
        _body: wire::PinMessageDto,
    ) -> BackendResult<wire::SuccessMessageDto> {
        self.action("pin", &message_id).await?;
        self.change_stored(&message_id, |message| message.pinned = true);
        Ok(wire::SuccessMessageDto {
            message: "pinned".into(),
            success: true,
        })
    }

    async fn moderation_controller_unpin_message(
        &self,
        message_id: String,
        _body: wire::UnpinMessageDto,
    ) -> BackendResult<wire::SuccessMessageDto> {
        self.action("unpin", &message_id).await?;
        self.change_stored(&message_id, |message| message.pinned = false);
        Ok(wire::SuccessMessageDto {
            message: "unpinned".into(),
            success: true,
        })
    }

    async fn moderation_controller_get_pinned_messages(
        &self,
        channel_id: String,
    ) -> BackendResult<Vec<wire::PinnedMessageDto>> {
        self.action("pins", &channel_id).await?;
        let pins = self
            .actions
            .pins
            .lock()
            .unwrap()
            .get(&channel_id)
            .cloned()
            .unwrap_or_default();
        Ok(serde_json::from_value(Value::Array(pins)).unwrap())
    }

    async fn moderation_controller_delete_message_as_mod(
        &self,
        message_id: String,
        body: wire::DeleteMessageAsModDto,
    ) -> BackendResult<wire::SuccessMessageDto> {
        let reason = body.reason.unwrap_or_default();
        self.action("remove_as_mod", &format!("{message_id} {reason}"))
            .await?;
        let _ = self.stored(&message_id);
        Ok(wire::SuccessMessageDto {
            message: "removed".into(),
            success: true,
        })
    }

    async fn roles_controller_get_my_roles_for_channel(
        &self,
        channel_id: String,
    ) -> BackendResult<wire::UserRolesResponseDto> {
        self.action("roles", &channel_id).await?;
        let actions = self.actions.role_actions.lock().unwrap().clone();
        let roles = if actions.is_empty() {
            json!([])
        } else {
            json!([{
                "id": "role-mod", "name": "Moderator", "position": 1, "isDefault": false,
                "createdAt": "2026-09-22T18:00:00Z", "actions": actions,
            }])
        };
        Ok(serde_json::from_value(json!({
            "userId": ME, "resourceId": channel_id, "resourceType": "CHANNEL", "roles": roles,
        }))
        .unwrap())
    }
}
