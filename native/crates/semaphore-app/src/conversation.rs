//! The middle column for a text conversation: core's rows in the message list, and the composer.
//!
//! Core sends rows as `ListOp`s for the conversation on screen. The pane hands them to the list, keeps
//! a mirror for what the list doesn't expose (the reply quotes it draws, the newest id for read
//! marks, and the rig's checks), and answers what the list and composer ask by calling core.

use crate::runtime::Exec;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::cache::keys;
use semaphore_core::model::{
    ChannelPermissions, ChannelRow, Conversation, ListOp, MentionCandidate, MessageRow,
    SessionState, ViewKey,
};
use semaphore_core::{Core, CoreEvent};
use semaphore_ui::composer::{
    Availability, Composer, ComposerConfig, ComposerEvent, DraftStore, MentionSource,
};
use semaphore_ui::kit::on_core_event;
use semaphore_ui::messages::{
    ListData, ListOptions, ListStatus, MessageList, MessageListEvent, NoMedia, ReplyPreview,
    TimeFormat,
};
use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

/// The web sends `typingStart` at most this often while keys keep coming.
const TYPING_EVERY: Duration = Duration::from_secs(3);

/// `Core::mention_candidates` for the community on screen. The composer asks with the query alone
/// and keeps the candidates whose trigger matches, so this asks for both kinds.
struct CoreMentions {
    core: Arc<Core>,
    community_id: RefCell<Option<String>>,
}

impl MentionSource for CoreMentions {
    fn candidates(&self, query: &str) -> Vec<MentionCandidate> {
        let Some(community_id) = self.community_id.borrow().clone() else {
            return Vec::new();
        };
        let mut candidates = self
            .core
            .mention_candidates(community_id.clone(), query.to_owned());
        candidates.extend(
            self.core
                .mention_candidates(community_id, format!("#{query}")),
        );
        candidates
    }
}

pub struct ConversationPane {
    core: Arc<Core>,
    exec: Exec,
    time: TimeFormat,
    scrollbar: bool,
    window: AnyWindowHandle,
    conversation: Option<Conversation>,
    community_id: Option<String>,
    channel: Option<ChannelRow>,
    list: Option<Entity<MessageList>>,
    composer: Option<Entity<Composer>>,
    drafts: Entity<DraftStore>,
    mentions: Rc<CoreMentions>,
    /// The rows as core sent them, in list order.
    rows: Vec<MessageRow>,
    replies: HashMap<i64, ReplyPreview>,
    last_typing: Option<Instant>,
    marked_read: Option<String>,
    focused: bool,
    list_subscription: Option<Subscription>,
    _subscriptions: Vec<Subscription>,
}

impl ConversationPane {
    pub fn new(
        core: Arc<Core>,
        exec: Exec,
        time: TimeFormat,
        scrollbar: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        on_core_event(cx.entity().downgrade(), Self::on_core, cx);
        Self {
            mentions: Rc::new(CoreMentions {
                core: core.clone(),
                community_id: RefCell::new(None),
            }),
            core,
            exec,
            time,
            scrollbar,
            window: window.window_handle(),
            conversation: None,
            community_id: None,
            channel: None,
            list: None,
            composer: None,
            drafts: cx.new(|_| DraftStore::default()),
            rows: Vec::new(),
            replies: HashMap::new(),
            last_typing: None,
            marked_read: None,
            focused: window.is_window_active(),
            list_subscription: None,
            _subscriptions: Vec::new(),
        }
    }

    pub fn conversation(&self) -> Option<&Conversation> {
        self.conversation.as_ref()
    }

    /// The rows on screen, as core sent them.
    pub fn rows(&self) -> &[MessageRow] {
        &self.rows
    }

    pub fn list(&self) -> Option<&Entity<MessageList>> {
        self.list.as_ref()
    }

    pub fn set_focused(&mut self, focused: bool, cx: &mut Context<Self>) {
        self.focused = focused;
        if focused {
            self.mark_read(cx);
        }
    }

    /// Shows `conversation`, or keeps showing it with this channel row's permissions.
    pub fn show(
        &mut self,
        conversation: Conversation,
        community_id: Option<String>,
        channel: Option<ChannelRow>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let changed = self.conversation.as_ref() != Some(&conversation);
        let permissions_changed = self.channel.as_ref().map(|row| &row.permissions)
            != channel.as_ref().map(|row| &row.permissions)
            || self.channel.as_ref().map(|row| row.slowmode_seconds)
                != channel.as_ref().map(|row| row.slowmode_seconds);
        self.channel = channel;
        *self.mentions.community_id.borrow_mut() = community_id.clone();
        self.community_id = community_id;
        if changed {
            self.open(conversation, window, cx);
        } else if permissions_changed {
            self.apply_availability(window, cx);
        }
    }

    fn open(&mut self, conversation: Conversation, window: &mut Window, cx: &mut Context<Self>) {
        self.conversation = Some(conversation.clone());
        self.rows.clear();
        self.replies.clear();
        self.marked_read = None;
        let me_id = match self.core.session() {
            SessionState::SignedIn { me } => me.id,
            _ => String::new(),
        };
        let (time, scrollbar) = (self.time, self.scrollbar);
        let list = cx.new(|cx| {
            MessageList::new(
                ListData {
                    me_id,
                    rows: Vec::new(),
                    replies: HashMap::new(),
                    status: ListStatus::Loading,
                },
                Rc::new(NoMedia),
                ListOptions {
                    time,
                    scrollbar,
                    ..ListOptions::default()
                },
                cx,
            )
        });
        let list_events = cx.subscribe_in(&list, window, Self::on_list_event);
        self.list = Some(list);

        self.list_subscription = Some(list_events);
        match &self.composer {
            Some(composer) => {
                composer.update(cx, |composer, cx| {
                    composer.set_conversation(conversation.clone(), window, cx)
                });
            }
            None => {
                let config = ComposerConfig {
                    conversation: conversation.clone(),
                    source: self.mentions.clone(),
                    drafts: self.drafts.clone(),
                    placeholder: self.placeholder(),
                    max_file_bytes: None,
                };
                let composer = cx.new(|cx| Composer::new(config, window, cx));
                self._subscriptions.push(cx.subscribe_in(
                    &composer,
                    window,
                    Self::on_composer_event,
                ));
                self.composer = Some(composer);
            }
        }
        self.apply_availability(window, cx);

        let core = self.core.clone();
        let opening = conversation.clone();
        self.exec.run(
            window,
            cx,
            async move { core.open_conversation(opening).await },
            move |this, result, _, cx| {
                if this.conversation.as_ref() != Some(&conversation) {
                    return;
                }
                if let Err(error) = result {
                    log::warn!("opening {conversation:?} failed: {error}");
                }
                if let Some(list) = &this.list {
                    list.update(cx, |list, cx| list.set_status(ListStatus::Ready, cx));
                }
            },
        );
        cx.notify();
    }

    fn placeholder(&self) -> SharedString {
        match &self.channel {
            Some(channel) => format!("Message #{}", channel.name).into(),
            None => "Type a message...".into(),
        }
    }

    /// `useComposerAvailability`: what this user may do here, failing open while permissions load.
    fn availability(&self, cx: &App) -> Availability {
        let channel_name = self.channel.as_ref().map(|row| row.name.clone());
        let Some(permissions) = self
            .channel
            .as_ref()
            .and_then(|row| row.permissions.as_ref())
        else {
            // Attachments are phase 4: until uploads exist, offering the button would be a lie.
            return Availability::Open {
                can_attach: false,
                channel_name,
            };
        };
        availability_for(
            permissions,
            channel_name,
            now_ms(),
            cx.background_executor().now(),
        )
    }

    fn apply_availability(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let availability = self.availability(cx);
        let slowmode = self.channel.as_ref().map(|row| row.slowmode_seconds);
        if let Some(composer) = &self.composer {
            composer.update(cx, |composer, cx| {
                composer.set_availability(availability, window, cx);
                composer.set_slowmode(slowmode, cx);
            });
        }
    }

    fn on_core(&mut self, event: &CoreEvent, cx: &mut Context<Self>) {
        let Some(conversation) = self.conversation.clone() else {
            return;
        };
        match event {
            CoreEvent::MessagesChanged {
                conversation: changed,
                ops,
            } if *changed == conversation => {
                if let Some(list) = &self.list {
                    let ops = ops.clone();
                    list.update(cx, |list, cx| {
                        for op in ops {
                            list.apply(op, cx);
                        }
                    });
                }
                if self.apply_to_mirror(ops)
                    && let Some(list) = &self.list
                {
                    let replies = self.replies.clone();
                    list.update(cx, |list, cx| list.set_replies(replies, cx));
                }
                let detached = !self.core.at_live_edge(conversation);
                if let Some(list) = &self.list {
                    list.update(cx, |list, cx| {
                        list.set_detached(detached, cx);
                        list.set_status(ListStatus::Ready, cx);
                    });
                }
                self.mark_read(cx);
            }
            // Mention candidates arrive after the query that asked: show them.
            CoreEvent::ViewChanged {
                view: ViewKey::Mentionables { .. } | ViewKey::Members { .. },
            } => self.refresh_composer(cx),
            _ => {}
        }
    }

    /// Re-reads the composer's suggestions and availability, in a frame of its own.
    fn refresh_composer(&mut self, cx: &mut Context<Self>) {
        let (Some(composer), window) = (self.composer.clone(), self.window) else {
            return;
        };
        let availability = self.availability(cx);
        cx.defer(move |cx| {
            window
                .update(cx, |_, window, cx| {
                    composer.update(cx, |composer, cx| {
                        composer.set_availability(availability, window, cx)
                    });
                })
                .ok();
        });
    }

    /// Applies ops to the mirror. True if the reply quotes changed.
    fn apply_to_mirror(&mut self, ops: &[ListOp]) -> bool {
        let mut replies_changed = false;
        let note = |rows: &[MessageRow], replies: &mut HashMap<i64, ReplyPreview>| -> bool {
            let mut noted = false;
            for row in rows {
                if let Some(reply) = &row.reply_to {
                    let author = reply
                        .author
                        .display_name
                        .clone()
                        .filter(|name| !name.is_empty())
                        .unwrap_or_else(|| reply.author.username.clone());
                    replies.insert(
                        row.seq,
                        ReplyPreview {
                            author,
                            text: reply.text.clone(),
                            deleted: reply.deleted,
                        },
                    );
                    noted = true;
                }
            }
            noted
        };
        for op in ops {
            match op {
                ListOp::Reset { rows } => {
                    self.replies.clear();
                    note(rows, &mut self.replies);
                    replies_changed = true;
                    self.rows.clone_from(rows);
                }
                ListOp::Insert { index, rows } => {
                    replies_changed |= note(rows, &mut self.replies);
                    let at = (*index as usize).min(self.rows.len());
                    self.rows.splice(at..at, rows.iter().cloned());
                }
                ListOp::Remove { index, count } => {
                    let start = (*index as usize).min(self.rows.len());
                    let end = (start + *count as usize).min(self.rows.len());
                    self.rows.drain(start..end);
                }
                ListOp::Replace { index, rows } => {
                    replies_changed |= note(rows, &mut self.replies);
                    for (offset, row) in rows.iter().enumerate() {
                        if let Some(slot) = self.rows.get_mut(*index as usize + offset) {
                            slot.clone_from(row);
                        }
                    }
                }
            }
        }
        replies_changed
    }

    /// Marks the newest message read while the window has focus and the list is at the live edge,
    /// as the web does for what's on screen.
    fn mark_read(&mut self, _: &mut Context<Self>) {
        let Some(conversation) = self.conversation.clone() else {
            return;
        };
        if !self.focused || !self.core.at_live_edge(conversation.clone()) {
            return;
        }
        let Some(newest) = self.rows.iter().rev().find_map(|row| row.id.clone()) else {
            return;
        };
        if self.marked_read.as_ref() == Some(&newest) {
            return;
        }
        self.marked_read = Some(newest.clone());
        let core = self.core.clone();
        self.exec.fire(async move {
            if let Err(error) = core.mark_read(conversation, newest).await {
                log::debug!("marking read: {error}");
            }
        });
    }

    fn on_list_event(
        &mut self,
        _: &Entity<MessageList>,
        event: &MessageListEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(conversation) = self.conversation.clone() else {
            return;
        };
        let core = self.core.clone();
        match event.clone() {
            MessageListEvent::LoadOlder => self.exec.fire(async move {
                log_failure("loading older rows", core.load_older(conversation).await);
            }),
            MessageListEvent::LoadNewer => self.exec.fire(async move {
                log_failure("loading newer rows", core.load_newer(conversation).await);
            }),
            MessageListEvent::JumpToPresent => self.exec.fire(async move {
                log_failure(
                    "jumping to the present",
                    core.jump_to_present(conversation).await,
                );
            }),
            MessageListEvent::HoldRows(range) => core.hold_rows(conversation, range),
            MessageListEvent::OpenLink { url } => cx.open_url(&url),
            MessageListEvent::OpenReply { message_id } => {
                let target = message_id.clone();
                self.exec.run(
                    window,
                    cx,
                    async move { core.open_conversation_at(conversation, message_id).await },
                    move |this, result, _, cx| {
                        if let Err(error) = result {
                            log::warn!("opening the message answered: {error}");
                            return;
                        }
                        // Already loaded: core sends nothing, and the list scrolls there itself.
                        let seq = this
                            .rows
                            .iter()
                            .find(|row| row.id.as_deref() == Some(target.as_str()))
                            .map(|row| row.seq);
                        if let (Some(seq), Some(list)) = (seq, &this.list) {
                            list.update(cx, |list, cx| {
                                list.scroll_to_seq(seq, 0.);
                                cx.notify();
                            });
                        }
                    },
                );
            }
            MessageListEvent::ToggleReaction { message_id, emoji } => self.exec.fire(async move {
                log_failure("reacting", core.toggle_reaction(message_id, emoji).await);
            }),
            MessageListEvent::RetrySend { client_nonce } => self.exec.fire(async move {
                log_failure("retrying a send", core.retry_send(client_nonce).await);
            }),
            MessageListEvent::DiscardFailed { client_nonce } => self.exec.fire(async move {
                log_failure(
                    "discarding a failed send",
                    core.discard_failed_send(client_nonce).await,
                );
            }),
            MessageListEvent::OpenAttachment { file_id } => {
                log::info!("opening attachment {file_id}: attachments are phase 4");
            }
            MessageListEvent::OpenThread { message_id } => {
                log::info!("opening the thread of {message_id}: the thread pane is a follow-up");
            }
        }
    }

    fn on_composer_event(
        &mut self,
        composer: &Entity<Composer>,
        event: &ComposerEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let core = self.core.clone();
        match event.clone() {
            ComposerEvent::Send {
                conversation,
                draft,
                attachments,
            } => {
                if !attachments.is_empty() {
                    composer.update(cx, |composer, cx| {
                        composer.send_settled(
                            Err("Attachments can't be sent from this build yet.".into()),
                            window,
                            cx,
                        )
                    });
                    return;
                }
                self.last_typing = None;
                let stop_for = conversation.clone();
                let typing_core = core.clone();
                self.exec.fire(async move {
                    let _ = typing_core.send_typing(stop_for, false).await;
                });
                let composer = composer.downgrade();
                self.exec.run(
                    window,
                    cx,
                    async move { core.send_message(conversation, draft).await },
                    move |_, result, window, cx| {
                        let result = result.map(|_| ()).map_err(|error| error.to_string());
                        composer
                            .update(cx, |composer, cx| composer.send_settled(result, window, cx))
                            .ok();
                    },
                );
            }
            ComposerEvent::Typing => {
                let Some(conversation) = self.conversation.clone() else {
                    return;
                };
                let now = Instant::now();
                if self
                    .last_typing
                    .is_some_and(|last| now.duration_since(last) < TYPING_EVERY)
                {
                    return;
                }
                self.last_typing = Some(now);
                self.exec.fire(async move {
                    let _ = core.send_typing(conversation, true).await;
                });
            }
            ComposerEvent::TimeoutEnded => {
                if let Some(community_id) = &self.community_id {
                    core.invalidate(&keys::scoped(keys::CAPABILITIES, community_id));
                }
            }
            ComposerEvent::OpenEmojiPicker => {
                log::info!("the emoji picker is phase 4");
                composer.update(cx, |composer, cx| composer.set_emoji_picker_open(false, cx));
            }
            ComposerEvent::OpenFilePicker => log::info!("attachments are phase 4"),
            ComposerEvent::EditLastMessage => log::info!("editing is a follow-up"),
        }
    }

    fn typing_line(&self) -> Option<String> {
        let conversation = self.conversation.clone()?;
        let names: Vec<String> = self
            .core
            .typing_users(conversation)
            .into_iter()
            .map(|user| {
                user.display_name
                    .filter(|name| !name.is_empty())
                    .unwrap_or(user.username)
            })
            .collect();
        match names.as_slice() {
            [] => None,
            [one] => Some(format!("{one} is typing...")),
            [one, two] => Some(format!("{one} and {two} are typing...")),
            _ => Some("Several people are typing...".into()),
        }
    }
}

fn log_failure(what: &str, result: Result<(), semaphore_core::CoreError>) {
    if let Err(error) = result {
        log::warn!("{what} failed: {error}");
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_millis() as i64)
}

/// `useComposerAvailability` over a channel's permissions. `now` is the app clock the composer
/// counts a timeout down on.
pub fn availability_for(
    permissions: &ChannelPermissions,
    channel_name: Option<String>,
    now_ms: i64,
    now: Instant,
) -> Availability {
    if let Some(until_ms) = permissions.timed_out_until_ms
        && until_ms > now_ms
    {
        return Availability::TimedOut {
            until: Some(now + Duration::from_millis((until_ms - now_ms) as u64)),
            reason: None,
        };
    }
    if !permissions.post {
        if permissions.posting_role_names.is_empty() {
            return Availability::NoPermission { channel_name };
        }
        return Availability::ReadOnly {
            channel_name,
            posting_roles: permissions.posting_role_names.clone(),
        };
    }
    Availability::Open {
        // Phase 4 brings uploads; until then the button stays away.
        can_attach: false,
        channel_name,
    }
}

impl Render for ConversationPane {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        let palette = semaphore_ui::messages::palette::Palette::dark();
        let typing = self.typing_line();
        div()
            .id("conversation")
            .size_full()
            .flex()
            .flex_col()
            .min_h_0()
            .child(
                div()
                    .flex_1()
                    .min_h_0()
                    .when_some(self.list.clone(), |this, list| this.child(list)),
            )
            .child(
                div()
                    .h(px(20.))
                    .px(px(16.))
                    .flex_shrink_0()
                    .text_size(px(12.))
                    .text_color(palette.text_secondary)
                    .when_some(typing, |this, typing| this.child(typing)),
            )
            .when_some(self.composer.clone(), |this, composer| {
                this.child(div().flex_shrink_0().child(composer))
            })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::prelude::rust_2024::test;

    fn permissions() -> ChannelPermissions {
        ChannelPermissions {
            post: true,
            ..ChannelPermissions::default()
        }
    }

    #[test]
    fn availability_follows_the_permissions_and_fails_open_on_attachments_only() {
        let now = Instant::now();
        assert!(matches!(
            availability_for(&permissions(), None, 1_000, now),
            Availability::Open {
                can_attach: false,
                ..
            }
        ));
        let read_only = ChannelPermissions {
            post: false,
            posting_role_names: vec!["Mods".into()],
            ..ChannelPermissions::default()
        };
        assert!(matches!(
            availability_for(&read_only, None, 1_000, now),
            Availability::ReadOnly { posting_roles, .. } if posting_roles == ["Mods"]
        ));
        let none = ChannelPermissions::default();
        assert!(matches!(
            availability_for(&none, None, 1_000, now),
            Availability::NoPermission { .. }
        ));
        let timed_out = ChannelPermissions {
            timed_out_until_ms: Some(61_000),
            ..permissions()
        };
        let Availability::TimedOut {
            until: Some(until), ..
        } = availability_for(&timed_out, None, 1_000, now)
        else {
            panic!("expected a timeout");
        };
        assert_eq!(until - now, Duration::from_secs(60));
        // A timeout in the past is over.
        let over = ChannelPermissions {
            timed_out_until_ms: Some(500),
            ..permissions()
        };
        assert!(matches!(
            availability_for(&over, None, 1_000, now),
            Availability::Open { .. }
        ));
    }
}
