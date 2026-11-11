//! Conversations: opening, paging, sending, reactions, read state and typing.

use super::AROUND_LIMIT;
use crate::client::Core;
use crate::model::{Conversation, MessageDraft};
use crate::platform::CoreError;
use crate::resync::unavailable;
use crate::send::is_optimistic_id;
use crate::store::SendStatus;
use semaphore_wire::enums::MessagePageDirection;
use semaphore_wire::events::{MARK_AS_READ, TYPING_START, TYPING_STOP};
use semaphore_wire::types as wire;
use serde_json::json;

impl Core {
    /// Makes this the conversation on screen, and sends its rows as `ListOp::Reset`. A thread opens
    /// beside the channel it's in. Returns once a first page has loaded, or failed to.
    pub async fn open_conversation(&self, conversation: Conversation) -> Result<(), CoreError> {
        let needs_first_page = self.write(|state, _| {
            let needs = state.open(&conversation);
            let window = state.windows.get_mut(&conversation);
            match window {
                Some(window) if needs && !window.loading_first => {
                    window.loading_first = true;
                    true
                }
                _ => false,
            }
        });
        if !needs_first_page {
            return Ok(());
        }
        let result = self.load_live_edge(&conversation).await;
        self.write(|state, _| {
            if let Some(window) = state.windows.get_mut(&conversation) {
                window.loading_first = false;
            }
        });
        result
    }

    /// Loads older rows, sent as `ListOp::Insert { index: 0, .. }`. A no-op at the start.
    pub async fn load_older(&self, conversation: Conversation) -> Result<(), CoreError> {
        let begun = self.write(|state, _| {
            let window = state.windows.get_mut(&conversation)?;
            if window.loading_older {
                return None;
            }
            let cursor = window.older_cursor()?;
            window.loading_older = true;
            Some((window.begin_fetch(), cursor))
        });
        let Some((epoch, cursor)) = begun else {
            return Ok(());
        };
        let page = self.fetch_page(&conversation, cursor).await;
        self.write(|state, _| {
            if let Some(window) = state.windows.get_mut(&conversation) {
                if let Ok((rows, token)) = &page
                    && window.epoch == epoch
                {
                    window.apply_older_page(rows.clone(), token.clone());
                }
                window.loading_older = false;
                window.end_fetch();
            }
        });
        page.map(|_| ())
    }

    /// Loads newer rows into a window that has moved away from the live edge, sent as a `ListOp::Insert`
    /// at the end. A no-op at the live edge. [`Core::at_live_edge`] turns true with the last page.
    pub async fn load_newer(&self, conversation: Conversation) -> Result<(), CoreError> {
        let begun = self.write(|state, _| {
            let window = state.windows.get_mut(&conversation)?;
            if window.loading_newer || !window.is_detached_from_live_edge() {
                return None;
            }
            let Some(cursor) = window.newer_cursor() else {
                // Nothing the server knows about to start from.
                state.request_reset(&conversation);
                return None;
            };
            window.loading_newer = true;
            Some((window.begin_fetch(), cursor))
        });
        let Some((epoch, cursor)) = begun else {
            return Ok(());
        };
        let page = self
            .fetch_page_toward(
                &conversation,
                Some(cursor),
                Some(MessagePageDirection::Newer),
            )
            .await;
        self.write(|state, _| {
            let mut out_of_room = false;
            if let Some(window) = state.windows.get_mut(&conversation) {
                if let Ok((rows, token)) = &page
                    && window.epoch == epoch
                {
                    out_of_room = !window.apply_newer_page(rows.clone(), token.is_some());
                }
                window.loading_newer = false;
                window.end_fetch();
                window.evict_oldest();
            }
            if out_of_room {
                state.request_reset(&conversation);
            }
        });
        page.map(|_| ())
    }

    /// Whether the newest rows loaded are the newest there are. If not, nothing new lands in this list
    /// until [`Core::load_newer`] reaches the edge or [`Core::jump_to_present`] returns to it. Read it
    /// again after `CoreEvent::MessagesChanged`.
    pub fn at_live_edge(&self, conversation: Conversation) -> bool {
        self.read(|state| {
            state
                .windows
                .get(&conversation)
                .is_none_or(|window| !window.is_detached_from_live_edge())
        })
    }

    /// Replaces a detached window's rows with the live edge, as `ListOp::Reset`. If a selection holds
    /// the rows, that happens when it lets go. A no-op at the live edge.
    pub async fn jump_to_present(&self, conversation: Conversation) -> Result<(), CoreError> {
        if self.at_live_edge(conversation.clone()) {
            return Ok(());
        }
        self.load_live_edge(&conversation).await
    }

    /// Makes this the conversation on screen with a message's rows loaded, for a reply or a pin to jump
    /// to. If they're loaded already nothing is fetched, and the UI scrolls to the row. Otherwise rows
    /// come as `ListOp::Reset`, and if they don't reach the live edge the window is detached: see
    /// [`Core::at_live_edge`]. Fails if a selection holds the rows it would replace: release it first.
    /// A thread reads to its end, so it only opens.
    pub async fn open_conversation_at(
        &self,
        conversation: Conversation,
        message_id: String,
    ) -> Result<(), CoreError> {
        if matches!(conversation, Conversation::Thread { .. }) {
            return self.open_conversation(conversation).await;
        }
        let services = self.services().ok_or_else(|| unavailable("the backend"))?;
        let begun = self.write(|state, _| {
            state.open(&conversation);
            let window = state.windows.get_mut(&conversation)?;
            if window.holds_id(&message_id) {
                return Some(Ok(None));
            }
            if window.is_held() {
                return Some(Err(CoreError::Failed {
                    message: "a selection holds the rows".into(),
                }));
            }
            // Whatever is on its way for the rows these replace no longer matters.
            window.epoch += 1;
            Some(Ok(Some(window.begin_fetch())))
        });
        let epoch = match begun {
            Some(Ok(Some(epoch))) => epoch,
            Some(Err(error)) => return Err(error),
            _ => return Ok(()),
        };
        let page = match &conversation {
            Conversation::Channel { id } => {
                services
                    .backend
                    .messages_controller_find_around_for_channel(
                        id.clone(),
                        message_id,
                        Some(AROUND_LIMIT),
                    )
                    .await
            }
            Conversation::DirectMessage { id } => {
                services
                    .backend
                    .messages_controller_find_around_for_group(
                        id.clone(),
                        message_id,
                        Some(AROUND_LIMIT),
                    )
                    .await
            }
            Conversation::Thread { .. } => unreachable!("a thread returned above"),
        }
        .map_err(|error| self.backend_failed(error));
        self.write(|state, _| {
            let Some(window) = state.windows.get_mut(&conversation) else {
                return;
            };
            if let Ok(page) = &page
                && window.epoch == epoch
            {
                let present = |token: &Option<String>| {
                    token.as_ref().filter(|token| !token.is_empty()).cloned()
                };
                window.apply_around_page(
                    page.messages.clone(),
                    present(&page.older_continuation_token),
                    present(&page.newer_continuation_token).is_some(),
                );
            }
            window.end_fetch();
        });
        page.map(|_| ())
    }

    /// While a selection is held, core keeps that span of rows loaded. `None` releases it, and a
    /// reset that was waiting on it then runs.
    pub fn hold_rows(&self, conversation: Conversation, seq_range: Option<(i64, i64)>) {
        self.write(|state, _| {
            let Some(window) = state.windows.get_mut(&conversation) else {
                return;
            };
            window.hold(seq_range);
            if seq_range.is_none() && window.reset_deferred {
                window.reset_deferred = false;
                state.request_reset(&conversation);
            }
        });
    }

    /// Adds a pending row at once and returns its client nonce.
    pub async fn send_message(
        &self,
        conversation: Conversation,
        draft: MessageDraft,
    ) -> Result<String, CoreError> {
        self.begin_send(conversation, draft)
    }

    /// Retries with the same nonce, so the server can't create a second message.
    pub async fn retry_send(&self, client_nonce: String) -> Result<(), CoreError> {
        self.services().ok_or_else(|| unavailable("sending"))?;
        self.begin_retry(&client_nonce);
        Ok(())
    }

    /// Throws a failed send away: its row goes, as a `ListOp::Remove`, and it can't be retried. A send
    /// still pending, or one that has settled, is left alone. If the failed send had really reached
    /// the server, its message still arrives as anyone's would.
    pub async fn discard_failed_send(&self, client_nonce: String) -> Result<(), CoreError> {
        self.write(|state, _| {
            let Some(send) = state.sends.get(&client_nonce) else {
                return;
            };
            if send.in_flight || send.parked_since.is_some() {
                return;
            }
            let (conversation, client_id) = (send.conversation.clone(), send.client_id.clone());
            let window = state.windows.get_mut(&conversation);
            let row = window.as_deref().and_then(|window| window.find(&client_id));
            // Pending with no attempt running: a retry has been queued.
            if row.is_some_and(|row| !matches!(row.send, SendStatus::Failed(_))) {
                return;
            }
            if let Some(window) = window {
                window.remove_optimistic(&client_id);
            }
            state.sends.remove(&client_nonce);
            // Its files go with it, bytes and all: the message was never made.
            state.uploads.remove(&client_nonce);
        });
        Ok(())
    }

    /// Adds my reaction, or removes it if it's there. The contract types this request's id as a
    /// UUID, so unlike a send it can't carry a scenario's readable id.
    pub async fn toggle_reaction(
        &self,
        message_id: String,
        emoji: String,
    ) -> Result<(), CoreError> {
        let services = self.services().ok_or_else(|| unavailable("reactions"))?;
        let parsed = message_id.parse().map_err(|error| CoreError::Failed {
            message: format!("message id {message_id}: {error}"),
        })?;
        let mine = self.read(|state| {
            state
                .windows
                .values()
                .find_map(|window| window.find(&message_id))
                .is_some_and(|message| {
                    message.dto.reactions.iter().any(|reaction| {
                        reaction.emoji == emoji
                            && reaction.user_ids.iter().any(|id| id == state.me_id())
                    })
                })
        });
        // Its event updates the row: this client's own reaction comes back like anyone's.
        if mine {
            let body = wire::RemoveReactionDto {
                emoji,
                message_id: parsed,
            };
            services
                .backend
                .messages_controller_remove_reaction(body)
                .await
                .map_err(|error| self.backend_failed(error))?;
        } else {
            let body = wire::AddReactionDto {
                emoji,
                message_id: parsed,
            };
            services
                .backend
                .messages_controller_add_reaction(body)
                .await
                .map_err(|error| self.backend_failed(error))?;
        }
        Ok(())
    }

    /// Over the socket, as the web's visible-range marks are, because the REST path types the id
    /// as a UUID. A pending row's id means nothing to the server, so it's never sent.
    pub async fn mark_read(
        &self,
        conversation: Conversation,
        message_id: String,
    ) -> Result<(), CoreError> {
        let services = self.services().ok_or_else(|| unavailable("read marks"))?;
        if is_optimistic_id(&message_id) {
            return Ok(());
        }
        let payload = match &conversation {
            Conversation::Channel { id } => {
                json!({ "lastReadMessageId": message_id, "channelId": id })
            }
            Conversation::DirectMessage { id } => {
                json!({ "lastReadMessageId": message_id, "directMessageGroupId": id })
            }
            // Read state is per channel: a thread has none of its own.
            Conversation::Thread { .. } => return Ok(()),
        };
        services
            .realtime
            .emit(MARK_AS_READ.to_owned(), payload)
            .await
            .map_err(|error| CoreError::Failed {
                message: error.to_string(),
            })
    }

    /// The user is typing here (`started`), or stopped. The owner debounces: the web sends a start at
    /// most every few seconds while keys arrive, and a stop when the draft is sent or cleared. Over
    /// the socket; nothing happens while it's down, because typing is worthless late.
    pub async fn send_typing(
        &self,
        conversation: Conversation,
        started: bool,
    ) -> Result<(), CoreError> {
        let services = self.services().ok_or_else(|| unavailable("typing"))?;
        let payload = match &conversation {
            Conversation::Channel { id } => json!({ "channelId": id }),
            Conversation::DirectMessage { id } => json!({ "directMessageGroupId": id }),
            Conversation::Thread { .. } => return Ok(()),
        };
        let name = if started { TYPING_START } else { TYPING_STOP };
        services
            .realtime
            .emit(name.to_owned(), payload)
            .await
            .map_err(|error| CoreError::Failed {
                message: error.to_string(),
            })
    }
}
