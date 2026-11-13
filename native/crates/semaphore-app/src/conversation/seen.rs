//! WP's half of the conversation pane: "Seen by" (the hovered message's readers, a DM's read
//! watermarks). Hub file from the UI freeze: `actions.rs` sends `SeenByHovered` here; WP fills
//! the body and the feeds.
//!
//! The main list keeps `set_seen_by`'s answer for whatever `MessageList::seen_by_target()` is
//! when it's called, so every feed here checks the target first:
//!
//! - **Asked when the target moves** (a new own message, the conversation opened, rows loaded):
//!   `seen_on_core` runs after each core event, after the list took its ops.
//! - **Asked again** on `SeenByHovered { Some(id) }` for the target, and on core's `ViewChanged`
//!   for the asked message's `SeenBy` (or its DM's `DmPeerReads`): a peer's `readReceiptUpdated`
//!   moves a DM's line without a hover. A channel's readers are read once per message and only
//!   read again on a new connection (the backend sends no event for channel receipts).
//! - **An answer for another message is dropped**: the id asked for is remembered and must still
//!   be the target when the answer is handed over (`SeenByView::message_id` lets the list check
//!   the same).
//! - Threads have no readers, so only the main list is fed. `set_dm_peer_reads` isn't fed: the
//!   list draws nothing from it.

use super::{ConversationPane, Which};
use gpui_kit::*;
use semaphore_core::CoreEvent;
use semaphore_core::model::{Conversation, ViewKey};

/// What was last asked for the main list: the conversation and the message.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct SeenAsk {
    /// The list it was asked for: opening a conversation makes a new, empty one.
    list: Option<EntityId>,
    asked: Option<(Conversation, String)>,
}

impl SeenAsk {
    /// Whether an answer for `message_id` in `conversation` is the one to ask (again): `force` asks
    /// for the current target even when it was asked already.
    fn should_ask(&self, conversation: &Conversation, target: &str, force: bool) -> bool {
        force
            || self
                .asked
                .as_ref()
                .is_none_or(|(c, id)| c != conversation || id != target)
    }

    /// Whether a core view change is for what was asked.
    fn concerns(&self, view: &ViewKey) -> bool {
        let Some((conversation, asked)) = &self.asked else {
            return false;
        };
        match view {
            ViewKey::SeenBy {
                conversation: of,
                message_id,
            } => of == conversation && message_id == asked,
            ViewKey::DmPeerReads { dm_group_id } => {
                matches!(conversation, Conversation::DirectMessage { id } if id == dm_group_id)
            }
            _ => false,
        }
    }
}

impl ConversationPane {
    /// `MessageListEvent::SeenByHovered` from the `which` list: feed `MessageList::set_seen_by`
    /// from `Core::seen_by` while `message_id` is `Some`.
    pub(super) fn seen_by_hovered(
        &mut self,
        which: Which,
        message_id: Option<String>,
        cx: &mut Context<Self>,
    ) {
        if which != Which::Main || message_id.is_none() {
            return;
        }
        let target = self
            .list
            .as_ref()
            .and_then(|list| list.read(cx).seen_by_target());
        if target.is_some() && target == message_id {
            self.feed_seen(true, cx);
        }
    }

    /// After every core event the pane handled: the target may have moved, or its readers changed.
    pub(super) fn seen_on_core(&mut self, event: &CoreEvent, cx: &mut Context<Self>) {
        match event {
            CoreEvent::MessagesChanged { conversation, .. }
                if self.conversation.as_ref() == Some(conversation) =>
            {
                self.feed_seen(false, cx)
            }
            CoreEvent::ViewChanged { view } if self.seen.concerns(view) => self.feed_seen(true, cx),
            _ => {}
        }
    }

    /// Asks core for the main list's target, and hands the answer over only while that is still
    /// the target. With no target, forgets what was asked.
    fn feed_seen(&mut self, force: bool, cx: &mut Context<Self>) {
        let (Some(list), Some(conversation)) = (self.list.clone(), self.conversation.clone())
        else {
            self.seen = SeenAsk::default();
            return;
        };
        if matches!(conversation, Conversation::Thread { .. }) {
            return;
        }
        if self.seen.list != Some(list.entity_id()) {
            self.seen = SeenAsk {
                list: Some(list.entity_id()),
                asked: None,
            };
        }
        // Bounded: each pass asks for the target as it is now; a target that moved while asking
        // (it can't on this thread, but the rule is the list's) is asked once more.
        for _ in 0..2 {
            let Some(target) = list.read(cx).seen_by_target() else {
                self.seen.asked = None;
                return;
            };
            if !self.seen.should_ask(&conversation, &target, force) {
                return;
            }
            self.seen.asked = Some((conversation.clone(), target.clone()));
            let view = self.core.seen_by(conversation.clone(), target.clone());
            if list.read(cx).seen_by_target().as_deref() == Some(target.as_str()) {
                list.update(cx, |list, cx| list.set_seen_by(Some(view), cx));
                return;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    // `gpui_kit::*` exports a `test` attribute too.
    use core::prelude::v1::test;

    fn dm(id: &str) -> Conversation {
        Conversation::DirectMessage { id: id.into() }
    }

    #[test]
    fn asks_once_per_target_unless_forced() {
        let mut ask = SeenAsk::default();
        assert!(ask.should_ask(&dm("d"), "m1", false));
        ask.asked = Some((dm("d"), "m1".into()));
        assert!(!ask.should_ask(&dm("d"), "m1", false));
        assert!(ask.should_ask(&dm("d"), "m1", true));
        // A newer own message, or another conversation's same id, is a new question.
        assert!(ask.should_ask(&dm("d"), "m2", false));
        assert!(ask.should_ask(&dm("e"), "m1", false));
    }

    #[test]
    fn only_the_asked_messages_views_concern_it() {
        let mut ask = SeenAsk::default();
        let seen = |conversation: Conversation, id: &str| ViewKey::SeenBy {
            conversation,
            message_id: id.into(),
        };
        assert!(!ask.concerns(&seen(dm("d"), "m1")));
        ask.asked = Some((dm("d"), "m2".into()));
        // The old message's readers changing is not this line's business.
        assert!(!ask.concerns(&seen(dm("d"), "m1")));
        assert!(ask.concerns(&seen(dm("d"), "m2")));
        assert!(!ask.concerns(&seen(dm("e"), "m2")));
        assert!(ask.concerns(&ViewKey::DmPeerReads {
            dm_group_id: "d".into()
        }));
        assert!(!ask.concerns(&ViewKey::DmPeerReads {
            dm_group_id: "e".into()
        }));
        ask.asked = Some((Conversation::Channel { id: "c".into() }, "m2".into()));
        assert!(!ask.concerns(&ViewKey::DmPeerReads {
            dm_group_id: "c".into()
        }));
        assert!(ask.concerns(&seen(Conversation::Channel { id: "c".into() }, "m2")));
    }
}
