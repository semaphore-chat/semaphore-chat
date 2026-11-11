//! What the pane's lists and composers ask for, answered by calling core: W1's message actions
//! (edit in place, delete and removal, pins, reactions through the emoji picker), links and jumps
//! to a message, and the notice that shows what the server refused, in its own words.

use super::{ConversationPane, FileSource, PaneEvent, TYPING_EVERY, Which, read_files};
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::CoreError;
use semaphore_core::cache::keys;
use semaphore_core::model::{Conversation, MessageRow};
use semaphore_ui::composer::{
    AttachmentSource, Composer, ComposerConfig, ComposerEvent, ComposerMode, PendingAttachment,
    ReplyTarget,
};
use semaphore_ui::emoji::{EmojiPick, EmojiPicker, EmojiPickerEvent};
use semaphore_ui::kit::{Button, Snackbar};
use semaphore_ui::messages::MessageListEvent;
use semaphore_ui::theme::SemTheme as _;
use std::time::{Duration, Instant};

/// How long a row the user jumped to stays tinted.
const FLASH_FOR: Duration = Duration::from_secs(2);

/// A message being edited in place: the edit-mode composer drawn in its row.
pub(crate) struct Editing {
    pub which: Which,
    pub message_id: String,
    pub composer: Entity<Composer>,
    _subscription: Subscription,
}

/// What a pick from the emoji picker goes to.
#[derive(Clone)]
pub(crate) enum PickFor {
    React { message_id: String },
    Insert(WeakEntity<Composer>),
}

/// The emoji picker, open in a popover at `anchor` (window coordinates).
pub(crate) struct OpenPicker {
    pub picker: Entity<EmojiPicker>,
    pub anchor: Point<Pixels>,
    pub target: PickFor,
    _subscription: Subscription,
}

/// A display name, else the username: what the web shows for an author.
pub(crate) fn author_name(row: &MessageRow) -> String {
    row.author
        .display_name
        .clone()
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| row.author.username.clone())
}

impl ConversationPane {
    // ---- What the rig reads. ----

    /// The message being edited in place, if one is.
    pub fn editing_message(&self) -> Option<&str> {
        self.editing
            .as_ref()
            .map(|editing| editing.message_id.as_str())
    }

    pub fn editing_composer(&self) -> Option<&Entity<Composer>> {
        self.editing.as_ref().map(|editing| &editing.composer)
    }

    pub fn picker_open(&self) -> bool {
        self.picker.is_some()
    }

    /// The last refusal shown, until dismissed.
    pub fn notice(&self) -> Option<&str> {
        self.notice.as_deref()
    }

    // ---- The notice. ----

    /// Shows what went wrong, in the server's words.
    pub(crate) fn report(&mut self, what: &str, error: &CoreError, cx: &mut Context<Self>) {
        log::warn!("{what} failed: {error}");
        let message = error.to_string();
        self.notice = Some(if message.is_empty() {
            format!("Couldn't finish {what}.")
        } else {
            message
        });
        cx.notify();
    }

    /// Runs a command whose result arrives as core events, showing a refusal if there is one.
    pub(crate) fn command(
        &mut self,
        what: &'static str,
        window: &Window,
        cx: &mut Context<Self>,
        work: impl std::future::Future<Output = Result<(), CoreError>> + Send + 'static,
    ) {
        self.exec.run(window, cx, work, move |this, result, _, cx| {
            if let Err(error) = result {
                this.report(what, &error, cx);
            }
        });
    }

    pub(crate) fn notice_element(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        let notice = self.notice.clone()?;
        let dismiss = cx.entity().downgrade();
        Some(
            div()
                .id("pane-notice")
                .role(Role::Alert)
                .aria_label(notice.clone())
                .flex_shrink_0()
                .flex()
                .justify_center()
                .px(px(16.))
                .pb(px(8.))
                .child(Snackbar::new(notice).action(
                    Button::new("pane-notice-dismiss", "Dismiss").on_click(move |_, _, cx| {
                        dismiss
                            .update(cx, |pane, cx| {
                                pane.notice = None;
                                cx.notify();
                            })
                            .ok();
                    }),
                ))
                .into_any_element(),
        )
    }

    // ---- The lists. ----

    pub(crate) fn on_list_event(
        &mut self,
        which: Which,
        event: &MessageListEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let core = self.core.clone();
        let paged = self.conversation_of(which);
        match event.clone() {
            MessageListEvent::LoadOlder => {
                if let Some(conversation) = paged {
                    self.exec.fire(async move {
                        log_failure("loading older rows", core.load_older(conversation).await);
                    });
                }
            }
            MessageListEvent::LoadNewer => {
                if let Some(conversation) = paged {
                    self.exec.fire(async move {
                        log_failure("loading newer rows", core.load_newer(conversation).await);
                    });
                }
            }
            MessageListEvent::JumpToPresent => {
                if let Some(conversation) = paged {
                    self.exec.fire(async move {
                        log_failure(
                            "jumping to the present",
                            core.jump_to_present(conversation).await,
                        );
                    });
                }
            }
            MessageListEvent::HoldRows(range) => {
                if let Some(conversation) = paged {
                    core.hold_rows(conversation, range);
                }
            }
            MessageListEvent::OpenLink { url } => self.open_link(url, window, cx),
            MessageListEvent::OpenProfile { user_id } => {
                cx.emit(PaneEvent::OpenProfile {
                    user_id: user_id.clone(),
                })
            }
            MessageListEvent::OpenReply { message_id } => {
                let Some(conversation) = self.conversation.clone() else {
                    return;
                };
                let target = message_id.clone();
                self.exec.run(
                    window,
                    cx,
                    async move { core.open_conversation_at(conversation, message_id).await },
                    move |this, result, _, cx| match result {
                        Err(error) => this.report("opening the message answered", &error, cx),
                        // Already loaded: core sends nothing, and the list scrolls there itself.
                        Ok(()) => this.scroll_to(Which::Main, &target, false, cx),
                    },
                );
            }
            MessageListEvent::ToggleReaction { message_id, emoji } => {
                self.command("reacting", window, cx, async move {
                    core.toggle_reaction(message_id, emoji).await
                })
            }
            MessageListEvent::RetrySend { client_nonce } => {
                self.command("retrying a send", window, cx, async move {
                    core.retry_send(client_nonce).await
                })
            }
            MessageListEvent::DiscardFailed { client_nonce } => self.exec.fire(async move {
                log_failure(
                    "discarding a failed send",
                    core.discard_failed_send(client_nonce).await,
                );
            }),
            MessageListEvent::OpenAttachment { file_id } => {
                let attachment = self
                    .rows_of(which)
                    .iter()
                    .flat_map(|row| row.attachments.iter())
                    .find(|attachment| attachment.file_id == file_id)
                    .cloned();
                if let Some(attachment) = attachment {
                    (self.open_attachment)(attachment, window, cx);
                }
            }
            MessageListEvent::RetryUpload {
                client_nonce,
                index,
            } => self.command("retrying an upload", window, cx, async move {
                core.retry_upload(client_nonce, index).await
            }),
            MessageListEvent::RemoveUpload {
                client_nonce,
                index,
            } => self.exec.fire(async move {
                log_failure(
                    "removing an upload",
                    core.remove_upload(client_nonce, index).await,
                );
            }),
            MessageListEvent::OpenThread { message_id } => self.open_thread(message_id, window, cx),
            MessageListEvent::Reply { message_id } => {
                let row = self
                    .rows_of(which)
                    .iter()
                    .find(|row| row.id.as_deref() == Some(message_id.as_str()))
                    .cloned();
                if let (Some(row), Some(composer)) = (row, self.composer.clone()) {
                    let reply = ReplyTarget {
                        message_id,
                        author_name: author_name(&row),
                        snippet: row.display.clone(),
                    };
                    composer.update(cx, |composer, cx| {
                        composer.set_reply(Some(reply), window, cx)
                    });
                }
            }
            MessageListEvent::Edit { message_id } => self.start_edit(which, message_id, window, cx),
            MessageListEvent::Delete { message_id, reason } => {
                self.command("deleting the message", window, cx, async move {
                    core.delete_message(message_id, reason).await
                })
            }
            MessageListEvent::Pin { message_id } => {
                self.command("pinning the message", window, cx, async move {
                    core.pin_message(message_id, None).await
                })
            }
            MessageListEvent::Unpin { message_id } => {
                self.command("unpinning the message", window, cx, async move {
                    core.unpin_message(message_id, None).await
                })
            }
            MessageListEvent::OpenReactionPicker { message_id, anchor } => {
                self.open_picker(PickFor::React { message_id }, anchor, window, cx)
            }
            MessageListEvent::ReactionHovered { message_id, emoji } => {
                self.hovered_reaction = Some((which, message_id.clone(), emoji.clone()));
                self.refresh_reaction_users(&message_id, &emoji, cx);
            }
        }
    }

    /// Who reacted, for the tooltip of the reaction under the pointer.
    pub(crate) fn refresh_reaction_users(
        &mut self,
        message_id: &str,
        emoji: &str,
        cx: &mut Context<Self>,
    ) {
        let Some((which, hovered_id, hovered_emoji)) = self.hovered_reaction.clone() else {
            return;
        };
        if hovered_id != message_id || hovered_emoji != emoji {
            return;
        }
        let users = self
            .core
            .reaction_users(hovered_id.clone(), hovered_emoji.clone());
        if let Some(list) = self.list_of(which) {
            list.update(cx, |list, cx| {
                list.set_reaction_users(hovered_id, hovered_emoji, users, cx)
            });
        }
    }

    // ---- Edit in place. ----

    /// Opens the edit composer in the row of `message_id`, in the list it's in. Anything already
    /// being edited is put away first.
    pub(crate) fn start_edit(
        &mut self,
        which: Which,
        message_id: String,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(row) = self
            .rows_of(which)
            .iter()
            .find(|row| row.id.as_deref() == Some(message_id.as_str()))
            .cloned()
        else {
            return;
        };
        let Some(draft) = self.core.edit_draft(message_id.clone()) else {
            return;
        };
        let conversation = match which {
            Which::Main | Which::Parent => self.conversation.clone(),
            Which::Thread => self.conversation_of(Which::Thread),
        };
        let Some(conversation) = conversation else {
            return;
        };
        self.finish_edit(window, cx);
        let config = ComposerConfig {
            conversation,
            source: self.mentions.clone(),
            drafts: self.drafts.clone(),
            placeholder: "Edit message".into(),
            max_file_bytes: None,
            mode: ComposerMode::Edit {
                message_id: message_id.clone(),
            },
        };
        let attachments = row.attachments.clone();
        let composer = cx.new(|cx| {
            let mut composer = Composer::new(config, window, cx);
            composer.follow_theme(cx);
            composer.set_edit_content(draft, attachments, window, cx);
            composer
        });
        let subscription = cx.subscribe_in(&composer, window, Self::on_composer_event);
        if let Some(list) = self.list_of(which) {
            let view: AnyView = composer.clone().into();
            list.update(cx, |list, cx| list.set_editing(Some((row.seq, view)), cx));
        }
        self.editing = Some(Editing {
            which,
            message_id,
            composer,
            _subscription: subscription,
        });
        cx.notify();
    }

    /// Puts the edit composer away, and the caret back in the composer the edit came from.
    pub(crate) fn finish_edit(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(editing) = self.editing.take() else {
            return;
        };
        if let Some(list) = self.list_of(editing.which) {
            list.update(cx, |list, cx| list.set_editing(None, cx));
        }
        let back = match editing.which {
            Which::Thread => self.thread.as_ref().map(|thread| thread.composer.clone()),
            _ => self.composer.clone(),
        };
        if let Some(composer) = back {
            composer.update(cx, |composer, cx| composer.focus(window, cx));
        }
        cx.notify();
    }

    /// Up in an empty composer: the newest message of mine that can be edited, in that list.
    fn edit_last(&mut self, which: Which, window: &mut Window, cx: &mut Context<Self>) {
        let newest = self
            .rows_of(which)
            .iter()
            .rev()
            .find(|row| {
                row.mine
                    && !row.removed
                    && row.send_state == semaphore_core::model::SendState::Sent
                    && row.id.is_some()
            })
            .and_then(|row| row.id.clone());
        if let Some(message_id) = newest {
            self.start_edit(which, message_id, window, cx);
        }
    }

    // ---- The composers. ----

    pub(crate) fn on_composer_event(
        &mut self,
        composer: &Entity<Composer>,
        event: &ComposerEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let core = self.core.clone();
        let mode = composer.read(cx).mode().clone();
        match event.clone() {
            ComposerEvent::Send {
                conversation,
                draft,
                attachments,
            } => {
                self.last_typing = None;
                if mode == ComposerMode::Send {
                    let stop_for = conversation.clone();
                    let typing_core = core.clone();
                    self.exec.fire(async move {
                        let _ = typing_core.send_typing(stop_for, false).await;
                    });
                }
                let composer = composer.downgrade();
                let handle = self.exec.handle().clone();
                // What can cross threads: a path to read, or the bytes a paste brought.
                let attachments: Vec<FileSource> = attachments
                    .iter()
                    .map(|file| match &file.source {
                        AttachmentSource::Path(path) => {
                            FileSource::Path(file.name.to_string(), path.clone())
                        }
                        AttachmentSource::Image(image) => {
                            FileSource::Bytes(file.name.to_string(), image.bytes.clone())
                        }
                    })
                    .collect();
                self.exec.run(
                    window,
                    cx,
                    async move {
                        // Reading the files is blocking work, off the async workers too.
                        let files = handle
                            .spawn_blocking(move || read_files(&attachments))
                            .await
                            .map_err(|error| CoreError::Failed {
                                message: error.to_string(),
                            })??;
                        let mut draft = draft;
                        draft.files = files;
                        core.send_message(conversation, draft).await
                    },
                    move |_, result, window, cx| {
                        let result = result.map(|_| ()).map_err(|error| error.to_string());
                        composer
                            .update(cx, |composer, cx| composer.send_settled(result, window, cx))
                            .ok();
                    },
                );
            }
            ComposerEvent::Typing => {
                // Only the conversation's own composer says someone is typing, as on the web.
                if mode != ComposerMode::Send {
                    return;
                }
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
                let anchor = window.mouse_position();
                self.open_picker(PickFor::Insert(composer.downgrade()), anchor, window, cx);
                composer.update(cx, |composer, cx| composer.set_emoji_picker_open(true, cx));
            }
            ComposerEvent::OpenFilePicker => {
                let picked = crate::pick_files(
                    crate::PickRequest {
                        multiple: true,
                        prompt: "Attach",
                    },
                    cx,
                );
                let composer = composer.downgrade();
                cx.spawn_in(window, async move |_, cx| {
                    let Some(paths) = picked.await else {
                        return;
                    };
                    let files: Vec<PendingAttachment> = paths
                        .iter()
                        .map(|path| PendingAttachment::from_path(path))
                        .collect();
                    composer
                        .update_in(cx, |composer, window, cx| {
                            composer.add_attachments(files, window, cx)
                        })
                        .ok();
                })
                .detach();
            }
            ComposerEvent::EditLastMessage => {
                let which = if mode == ComposerMode::Thread {
                    Which::Thread
                } else {
                    Which::Main
                };
                self.edit_last(which, window, cx);
            }
            ComposerEvent::SaveEdit {
                message_id,
                draft,
                keep_attachment_ids,
            } => {
                // Core shows the edit at once and puts it back if the server refuses.
                self.finish_edit(window, cx);
                self.command("editing the message", window, cx, async move {
                    core.edit_message(message_id, draft, keep_attachment_ids)
                        .await
                });
            }
            ComposerEvent::CancelEdit { .. } => self.finish_edit(window, cx),
        }
    }

    // ---- The emoji picker. ----

    pub(crate) fn open_picker(
        &mut self,
        target: PickFor,
        anchor: Point<Pixels>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.close_picker(cx);
        let custom = self
            .community_id
            .clone()
            .map(|community_id| self.core.custom_emojis(community_id))
            .unwrap_or_default();
        let media: std::rc::Rc<dyn semaphore_ui::messages::MediaSource> = self.media.clone();
        let picker = cx.new(|cx| EmojiPicker::new(custom, media, window, cx));
        picker.update(cx, |picker, cx| picker.focus_search(window, cx));
        let subscription = cx.subscribe_in(&picker, window, Self::on_picker_event);
        self.picker = Some(OpenPicker {
            picker,
            anchor,
            target,
            _subscription: subscription,
        });
        cx.notify();
    }

    pub(crate) fn close_picker(&mut self, cx: &mut Context<Self>) {
        let Some(open) = self.picker.take() else {
            return;
        };
        if let PickFor::Insert(composer) = &open.target {
            composer
                .update(cx, |composer, cx| composer.set_emoji_picker_open(false, cx))
                .ok();
        }
        cx.notify();
    }

    fn on_picker_event(
        &mut self,
        _: &Entity<EmojiPicker>,
        event: &EmojiPickerEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(target) = self.picker.as_ref().map(|open| open.target.clone()) else {
            return;
        };
        self.close_picker(cx);
        let EmojiPickerEvent::Picked(pick) = event else {
            return;
        };
        match target {
            PickFor::React { message_id } => {
                let core = self.core.clone();
                let emoji = pick.reaction_key();
                self.command("reacting", window, cx, async move {
                    core.add_reaction(message_id, emoji).await
                });
            }
            PickFor::Insert(composer) => {
                let text = match pick {
                    EmojiPick::Unicode(emoji) => emoji.clone(),
                    EmojiPick::Custom { name, .. } => format!(":{name}:"),
                };
                composer
                    .update(cx, |composer, cx| {
                        composer.insert_at_caret(&text, window, cx)
                    })
                    .ok();
            }
        }
    }

    /// The community's emoji changed while the picker is open.
    pub(crate) fn refresh_picker_emoji(&mut self, cx: &mut Context<Self>) {
        let (Some(open), Some(community_id)) = (&self.picker, self.community_id.clone()) else {
            return;
        };
        let custom = self.core.custom_emojis(community_id);
        open.picker
            .update(cx, |picker, cx| picker.set_custom(custom, cx));
    }

    pub(crate) fn picker_element(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        let open = self.picker.as_ref()?;
        let close = cx.entity().downgrade();
        Some(
            deferred(
                anchored()
                    .position(open.anchor)
                    .snap_to_window_with_margin(px(8.))
                    .child(
                        div()
                            .id("emoji-picker-popover")
                            // The web popover's size; the picker fills what it's given.
                            .w(px(300.))
                            .h(px(400.))
                            .bg(cx.sem().paper)
                            .border_1()
                            .border_color(cx.sem().divider)
                            .occlude()
                            .rounded(px(4.))
                            .shadow_lg()
                            .on_mouse_down_out(move |_, _, cx| {
                                close.update(cx, |pane, cx| pane.close_picker(cx)).ok();
                            })
                            .child(open.picker.clone()),
                    ),
            )
            .with_priority(2)
            .into_any_element(),
        )
    }

    // ---- Links and jumps. ----

    /// A link in a message: one to a message on this server opens it here, anything else goes to
    /// the system's browser.
    pub(crate) fn open_link(&mut self, url: String, window: &mut Window, cx: &mut Context<Self>) {
        let ours = (self.server_url)()
            .and_then(|server| semaphore_core::links::parse_message_link(&server, &url));
        let Some(link) = ours else {
            crate::open_url(&url, cx);
            return;
        };
        let core = self.core.clone();
        let target = link.message_id.clone();
        let community_id = link.community_id.clone().or(self.community_id.clone());
        self.exec.run(
            window,
            cx,
            async move { core.open_message_link(url, None).await },
            move |this, result, _, cx| match result {
                Err(error) => this.report("opening the link", &error, cx),
                Ok(conversation) => this.landed(conversation, community_id, target, cx),
            },
        );
    }

    /// A pin or a search hit: opens its conversation at the message (at its parent, then the
    /// thread, for a thread reply), and tints it once it's on screen.
    pub(crate) fn jump(
        &mut self,
        conversation: Conversation,
        community_id: Option<String>,
        message_id: String,
        parent_message_id: Option<String>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let core = self.core.clone();
        let at = parent_message_id
            .clone()
            .unwrap_or_else(|| message_id.clone());
        let opening = conversation.clone();
        self.exec.run(
            window,
            cx,
            async move { core.open_conversation_at(opening, at).await },
            move |this, result, window, cx| {
                if let Err(error) = result {
                    this.report("opening the message", &error, cx);
                    return;
                }
                match parent_message_id {
                    Some(parent) => {
                        this.landed(conversation.clone(), community_id, Some(parent.clone()), cx);
                        this.open_thread_in(parent, conversation, window, cx);
                        if let Some(thread) = &mut this.thread {
                            thread.flash = Some(message_id);
                        }
                        this.flash_if_loaded(cx);
                    }
                    None => this.landed(conversation, community_id, Some(message_id), cx),
                }
            },
        );
    }

    /// Core has opened `conversation` at a message: show that conversation, and the message in it.
    fn landed(
        &mut self,
        conversation: Conversation,
        community_id: Option<String>,
        message_id: Option<String>,
        cx: &mut Context<Self>,
    ) {
        if self.conversation.as_ref() != Some(&conversation) {
            match (&conversation, community_id) {
                (Conversation::Channel { id }, Some(community_id)) => {
                    cx.emit(PaneEvent::Navigate {
                        community_id,
                        channel_id: id.clone(),
                    })
                }
                (Conversation::DirectMessage { id }, _) => {
                    cx.emit(PaneEvent::OpenDm { dm_id: id.clone() })
                }
                _ => {
                    log::warn!("a jump to {conversation:?} with no community to show it in");
                    return;
                }
            }
        }
        if let Some(message_id) = message_id {
            self.flash = Some((conversation, message_id));
            self.flash_if_loaded(cx);
        }
    }

    /// Scrolls to and tints a message waiting for its rows, once they're here.
    pub(crate) fn flash_if_loaded(&mut self, cx: &mut Context<Self>) {
        if let Some((conversation, message_id)) = self.flash.clone()
            && self.conversation.as_ref() == Some(&conversation)
            && self
                .rows
                .iter()
                .any(|row| row.id.as_deref() == Some(message_id.as_str()))
        {
            self.flash = None;
            self.scroll_to(Which::Main, &message_id, true, cx);
        }
        let waiting = self
            .thread
            .as_ref()
            .and_then(|thread| thread.flash.clone())
            .filter(|message_id| {
                self.rows_of(Which::Thread)
                    .iter()
                    .any(|row| row.id.as_deref() == Some(message_id.as_str()))
            });
        if let Some(message_id) = waiting {
            if let Some(thread) = &mut self.thread {
                thread.flash = None;
            }
            self.scroll_to(Which::Thread, &message_id, true, cx);
        }
    }

    /// Scrolls a list to a loaded message, and tints it for a moment if `flash`.
    pub(crate) fn scroll_to(
        &mut self,
        which: Which,
        message_id: &str,
        flash: bool,
        cx: &mut Context<Self>,
    ) {
        let Some(seq) = self
            .rows_of(which)
            .iter()
            .find(|row| row.id.as_deref() == Some(message_id))
            .map(|row| row.seq)
        else {
            return;
        };
        let Some(list) = self.list_of(which) else {
            return;
        };
        list.update(cx, |list, cx| {
            // A row already on screen stays where it is, and the list keeps following new ones.
            let shown = list
                .painted_blocks()
                .iter()
                .any(|(painted, _)| *painted == seq);
            if !shown {
                list.scroll_to_seq(seq, 0.);
            }
            if flash {
                list.set_highlight(Some(seq), cx);
            }
            cx.notify();
        });
        if flash {
            let list = list.downgrade();
            self.flash_timer = Some(cx.spawn(async move |_, cx| {
                cx.background_executor().timer(FLASH_FOR).await;
                list.update(cx, |list, cx| list.set_highlight(None, cx))
                    .ok();
            }));
        }
    }
}

fn log_failure(what: &str, result: Result<(), CoreError>) {
    if let Err(error) = result {
        log::warn!("{what} failed: {error}");
    }
}
