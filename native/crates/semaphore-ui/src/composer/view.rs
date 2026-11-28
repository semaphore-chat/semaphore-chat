//! The composer view, after `MessageInput.tsx`.
//!
//! Editing, undo, IME and the field's accessibility node belong to the kit's `Textarea`. This owns
//! what surrounds it: which conversation it edits, the keys the web gives special meaning, the
//! dropdown, attachments, the reply banner, and whether posting is possible at all.
//!
//! It draws with the kit's chat pieces: the kit `Composer` (the field, attach, the emoji slot, Send,
//! the reply banner, the file tray, the notice, the drop look and the inline editor's hint) and the
//! `SuggestionList` for mentions. The keys the web gives a meaning (the list's ↑ ↓ Enter Tab and
//! Escape, Escape to cancel, ↑ to edit the last message) reach this through the kit's `on_key`, in
//! `useComposerKeys`' order; Ctrl/Cmd+B and I are this view's own key-down.

use super::edit::{KeptEmoji, edit_mentions, picked_from_draft};
use super::model::{
    Availability, ComposerEvent, ComposerMode, Draft, DraftStore, MentionSource, PendingAttachment,
    ReplyTarget,
};
use super::rules::{
    MentionTrigger, collapse_whitespace, format_role_list, format_time_left, get_current_mention,
    insert_mention, marker_for_shortcut, resolve_mentions, wrap_selection,
};
use crate::kit::overlays::type_text;
use crate::kit::{
    AttachmentKind, AttachmentTile, BannerKind, Composer as KitComposer, ComposerBanner,
    ComposerCap, ComposerKey, ComposerMode as KitMode, ComposerNotice, Icon, IconButton,
    IconButtonVariant, IconSize, PastedFile, Politeness, Suggestion, SuggestionList, ToastRequest,
    Toasts, WidthRange, announce,
};
use crate::theme::SemTheme;
use gpui_kit::component::input::{InputEvent as FieldEvent, TextareaState};
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{
    AttachmentView, Conversation, MentionCandidate, MentionKind, MessageDraft,
};
use semaphore_design::lounge::{SPACE_MD, SPACE_SM, TEXT_SMALL};
use semaphore_design::{Icon as DesignIcon, LoungeIcon};
use std::rc::Rc;
use std::time::{Duration, Instant};

/// `MAX_FILES_PER_MESSAGE` and `MAX_FILE_SIZE` in `constants/messages.ts`.
const MAX_FILES: usize = 10;
const MAX_FILE_BYTES: u64 = 10 * 1024 * 1024;
/// The web's total limit on suggestions.
const MAX_SUGGESTIONS: usize = 10;
/// The toast a failed send or a refused file shows (one at a time: a new one replaces it).
const ERROR_TOAST: &str = "composer-error";
/// What the thread's composer says when files are dragged over it, or dropped on it.
const THREAD_NO_FILES: &str = "Files can't be attached to a thread reply";
const SEND_FAILED: &str = "Failed to send message. Please try again.";

pub struct ComposerConfig {
    pub conversation: Conversation,
    pub source: Rc<dyn MentionSource>,
    pub drafts: Entity<DraftStore>,
    pub placeholder: SharedString,
    /// The instance's `maxFileSizeBytes`, when known.
    pub max_file_bytes: Option<u64>,
    pub mode: ComposerMode,
}

struct OpenMenu {
    start: usize,
    end: usize,
    query: String,
    candidates: Vec<MentionCandidate>,
    selected: usize,
}

/// A message on its way, so a failure can put it back.
struct InFlight {
    conversation: Conversation,
    draft: Draft,
}

pub struct Composer {
    text: Entity<TextareaState>,
    /// What the field shows while empty, as last given to it.
    placeholder: SharedString,
    conversation: Conversation,
    source: Rc<dyn MentionSource>,
    drafts: Entity<DraftStore>,
    availability: Availability,
    max_file_bytes: u64,

    attachments: Vec<PendingAttachment>,
    reply: Option<ReplyTarget>,
    picked: Vec<MentionCandidate>,

    menu: Option<OpenMenu>,
    /// What the field held when Esc closed the dropdown. It stays closed until that changes.
    dismissed_at: Option<(SharedString, usize)>,
    /// What the field held when last looked at; caret moves don't come with a `Change`.
    seen: (SharedString, usize),
    /// Whether a preedit was up then. Committing one changes neither the text nor the caret.
    seen_composing: bool,

    in_flight: Option<InFlight>,
    error: Option<SharedString>,
    slowmode: Option<Duration>,
    slowmode_until: Option<Instant>,
    emoji_open: bool,
    /// The server offers GIF search (`ServerInfo::gif_search`): the GIF button shows.
    gifs_enabled: bool,
    /// Files are dragged over the conversation (`set_dropping`), or over this thread composer.
    dropping: bool,
    ticker: Option<Task<()>>,
    mode: ComposerMode,
    /// Edit mode: the message's attachments still kept, whether any was removed, its custom emoji,
    /// and the message it replies to.
    edit_attachments: Vec<AttachmentView>,
    edit_removed_attachment: bool,
    edit_emoji: Vec<KeptEmoji>,
    edit_reply_to: Option<String>,
    _subscriptions: Vec<Subscription>,
}

impl EventEmitter<ComposerEvent> for Composer {}

impl Composer {
    /// U-freeze (UG): show the GIF button (the server offers GIF search). Drawn by UG.
    pub fn set_gifs_enabled(&mut self, enabled: bool, cx: &mut Context<Self>) {
        if self.gifs_enabled == enabled {
            return;
        }
        self.gifs_enabled = enabled;
        cx.notify();
    }

    pub fn new(config: ComposerConfig, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let placeholder = config.placeholder;
        // The kit composer draws the placeholder, takes Enter and sets how far the field grows.
        let text = cx.new(|cx| TextareaState::new(window, cx).auto_grow(1, 1));
        let subscriptions = vec![
            cx.subscribe_in(&text, window, Self::on_field_event),
            cx.observe_in(&text, window, |this, _, window, cx| {
                this.field_changed(window, cx)
            }),
        ];
        let mut this = Self {
            text,
            placeholder,
            conversation: config.conversation,
            source: config.source,
            drafts: config.drafts,
            availability: Availability::default(),
            max_file_bytes: config.max_file_bytes.unwrap_or(MAX_FILE_BYTES),
            attachments: Vec::new(),
            reply: None,
            picked: Vec::new(),
            menu: None,
            dismissed_at: None,
            seen: (SharedString::default(), 0),
            seen_composing: false,
            in_flight: None,
            error: None,
            slowmode: None,
            slowmode_until: None,
            emoji_open: false,
            gifs_enabled: false,
            dropping: false,
            ticker: None,
            mode: config.mode,
            edit_attachments: Vec::new(),
            edit_removed_attachment: false,
            edit_emoji: Vec::new(),
            edit_reply_to: None,
            _subscriptions: subscriptions,
        };
        this.load_draft(window, cx);
        this.focus(window, cx);
        this
    }

    // ---- What the owner calls. ----

    /// The text as it stands, preedit included.
    pub fn value(&self, cx: &App) -> SharedString {
        self.text.read(cx).value()
    }

    /// What the empty field shows.
    pub fn placeholder(&self) -> &SharedString {
        &self.placeholder
    }

    #[cfg(test)]
    pub(super) fn field_state(&self) -> Entity<TextareaState> {
        self.text.clone()
    }

    pub fn mode(&self) -> &ComposerMode {
        &self.mode
    }

    /// Edit mode: the message as `Core::edit_draft` gives it, and its attachments. The caret goes
    /// to the end, as the web's `autoFocus` leaves it.
    pub fn set_edit_content(
        &mut self,
        draft: MessageDraft,
        attachments: Vec<AttachmentView>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let (picked, emoji) = picked_from_draft(&draft);
        self.picked = picked;
        self.edit_emoji = emoji;
        self.edit_reply_to = draft.reply_to_message_id.clone();
        self.edit_attachments = attachments;
        self.edit_removed_attachment = false;
        let end = draft.text.len();
        self.text.update(cx, |field, cx| {
            field.set_value(draft.text, window, cx);
            field.set_selected_range(end..end, cx);
        });
        self.field_changed(window, cx);
        self.focus(window, cx);
        cx.notify();
    }

    fn is_editing(&self) -> bool {
        matches!(self.mode, ComposerMode::Edit { .. })
    }

    fn may_save_edit(&self, cx: &App) -> bool {
        !self.value(cx).trim().is_empty() || !self.edit_attachments.is_empty()
    }

    fn save_edit(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let ComposerMode::Edit { message_id } = self.mode.clone() else {
            return;
        };
        if !self.may_save_edit(cx) || self.is_composing(window, cx) {
            return;
        }
        let text = self.value(cx).trim().to_owned();
        let source = self.source.clone();
        let mentions = edit_mentions(&text, &self.picked, &self.edit_emoji, |token| {
            source
                .candidates(&token[1..])
                .into_iter()
                .find(|candidate| candidate.insert_text == token)
        });
        let keep_attachment_ids = self.edit_removed_attachment.then(|| {
            self.edit_attachments
                .iter()
                .map(|attachment| attachment.file_id.clone())
                .collect()
        });
        cx.emit(ComposerEvent::SaveEdit {
            message_id,
            draft: MessageDraft {
                text,
                mentions,
                reply_to_message_id: self.edit_reply_to.clone(),
                files: Vec::new(),
            },
            keep_attachment_ids,
        });
    }

    fn cancel_edit(&mut self, cx: &mut Context<Self>) {
        if let ComposerMode::Edit { message_id } = self.mode.clone() {
            cx.emit(ComposerEvent::CancelEdit { message_id });
        }
    }

    fn remove_edit_attachment(
        &mut self,
        index: usize,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if index < self.edit_attachments.len() {
            self.edit_attachments.remove(index);
            self.edit_removed_attachment = true;
            self.focus(window, cx);
            cx.notify();
        }
    }

    pub fn focus(&self, window: &mut Window, cx: &mut Context<Self>) {
        self.text.update(cx, |text, cx| text.focus(window, cx));
    }

    /// Moves to another conversation, keeping this one's draft.
    pub fn set_conversation(
        &mut self,
        conversation: Conversation,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if conversation == self.conversation {
            return;
        }
        self.save_draft(cx);
        self.conversation = conversation;
        self.error = None;
        self.load_draft(window, cx);
        self.focus(window, cx);
        cx.notify();
    }

    /// Files are dragged over the conversation (ChatPane's `on_files_over`): drawn as where they
    /// go, or as why they can't.
    pub fn set_dropping(&mut self, dropping: bool, cx: &mut Context<Self>) {
        if self.dropping != dropping {
            self.dropping = dropping;
            cx.notify();
        }
    }

    /// What the empty field shows ("Message #general"). The owner sets it with each conversation.
    pub fn set_placeholder(
        &mut self,
        placeholder: impl Into<SharedString>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let placeholder = placeholder.into();
        if self.placeholder == placeholder {
            return;
        }
        self.placeholder = placeholder;
        let _ = window;
        cx.notify();
    }

    pub fn set_availability(
        &mut self,
        availability: Availability,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let was_open = self.can_compose();
        self.availability = availability;
        if self.can_compose() && !was_open {
            self.focus(window, cx);
        }
        self.refresh_menu(window, cx);
        self.start_ticker(window, cx);
        cx.notify();
    }

    /// The channel's `slowmodeSeconds`: the gap the server enforces after each message.
    pub fn set_slowmode(&mut self, seconds: Option<u32>, cx: &mut Context<Self>) {
        self.slowmode = seconds
            .filter(|seconds| *seconds > 0)
            .map(|seconds| Duration::from_secs(seconds.into()));
        if self.slowmode.is_none() {
            self.slowmode_until = None;
        }
        cx.notify();
    }

    /// Starts the wait now, for when the server says more time is left than this client knows.
    pub fn start_slowmode_wait(
        &mut self,
        left: Duration,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.slowmode_until = Some(cx.background_executor().now() + left);
        self.start_ticker(window, cx);
        cx.notify();
    }

    pub fn set_reply(
        &mut self,
        reply: Option<ReplyTarget>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.reply = reply.map(|reply| ReplyTarget {
            snippet: collapse_whitespace(&reply.snippet),
            ..reply
        });
        self.save_draft(cx);
        self.focus(window, cx);
        cx.notify();
    }

    /// Adds files, from the file dialog, a drop or a paste. All or none, as `useFileAttachments`.
    pub fn add_attachments(
        &mut self,
        files: Vec<PendingAttachment>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if files.is_empty() {
            return;
        }
        match self.attachment_problem(&files) {
            Some(problem) => self.show_error(problem, window, cx),
            None => {
                self.error = None;
                self.attachments.extend(files);
                self.save_draft(cx);
            }
        }
        self.focus(window, cx);
        cx.notify();
    }

    /// Files pasted into the field: pictures and copied files, as a drop or the file dialog.
    fn add_pasted(&mut self, files: Vec<PastedFile>, window: &mut Window, cx: &mut Context<Self>) {
        let files = files
            .into_iter()
            .map(|file| match file {
                PastedFile::Image(image) => PendingAttachment::from_clipboard_image(image),
                PastedFile::Path(path) => PendingAttachment::from_path(&path),
            })
            .collect();
        self.add_attachments(files, window, cx);
    }

    /// The error as a danger toast (`ChatComposer`'s `onError`); kept until the text changes.
    fn show_error(&mut self, error: String, window: &mut Window, cx: &mut Context<Self>) {
        self.error = Some(error.clone().into());
        if let Some(toasts) = Toasts::of(window, cx) {
            toasts.show(ToastRequest::new(error).id(ERROR_TOAST).danger(), cx);
        }
        cx.notify();
    }

    /// The last error shown, until the text changes or a send goes.
    pub fn error(&self) -> Option<&SharedString> {
        self.error.as_ref()
    }

    /// Inserts where the caret was when the picker opened: the field keeps its selection while blurred.
    pub fn insert_at_caret(&mut self, text: &str, window: &mut Window, cx: &mut Context<Self>) {
        self.text
            .update(cx, |field, cx| field.replace(text.to_owned(), window, cx));
        self.focus(window, cx);
        cx.emit(ComposerEvent::Typing);
    }

    /// Tells the composer whether the picker is showing, for the button's expanded state.
    pub fn set_emoji_picker_open(&mut self, open: bool, cx: &mut Context<Self>) {
        self.emoji_open = open;
        cx.notify();
    }

    /// Answers a `Send`. On failure the message comes back to its conversation, unless the user has
    /// already started another there, and the error shows.
    pub fn send_settled(
        &mut self,
        result: Result<(), String>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(sent) = self.in_flight.take() else {
            return;
        };
        match result {
            Ok(()) => {
                if let Some(gap) = self.slowmode {
                    self.start_slowmode_wait(gap, window, cx);
                }
            }
            Err(message) => {
                let error = if message.is_empty() {
                    SEND_FAILED.to_owned()
                } else {
                    message
                };
                self.show_error(error, window, cx);
                if sent.conversation == self.conversation {
                    let empty = self.value(cx).is_empty()
                        && self.attachments.is_empty()
                        && self.reply.is_none();
                    if empty {
                        self.apply_draft(sent.draft, window, cx);
                    }
                } else {
                    self.drafts.update(cx, |drafts, _| {
                        if drafts.get(&sent.conversation).is_none() {
                            drafts.put(sent.conversation, sent.draft);
                        }
                    });
                }
            }
        }
        cx.notify();
    }

    // ---- Drafts. ----

    fn current_draft(&self, cx: &App) -> Draft {
        let text = self.text.read(cx);
        Draft {
            text: text.value().to_string(),
            selection: text.selected_range(),
            attachments: self.attachments.clone(),
            reply: self.reply.clone(),
            picked: self.picked.clone(),
        }
    }

    fn save_draft(&self, cx: &mut Context<Self>) {
        // An edit isn't the conversation's draft.
        if self.is_editing() {
            return;
        }
        let draft = self.current_draft(cx);
        let conversation = self.conversation.clone();
        self.drafts
            .update(cx, |drafts, _| drafts.put(conversation, draft));
    }

    fn load_draft(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.is_editing() {
            return;
        }
        let draft = self
            .drafts
            .read(cx)
            .get(&self.conversation)
            .cloned()
            .unwrap_or_default();
        self.apply_draft(draft, window, cx);
    }

    fn apply_draft(&mut self, draft: Draft, window: &mut Window, cx: &mut Context<Self>) {
        self.attachments = draft.attachments;
        self.reply = draft.reply;
        self.picked = draft.picked;
        self.dismissed_at = None;
        let selection = draft.selection;
        self.text.update(cx, |field, cx| {
            field.set_value(draft.text, window, cx);
            field.set_selected_range(selection, cx);
        });
        self.field_changed(window, cx);
    }

    // ---- The field. ----

    fn is_composing(&self, window: &mut Window, cx: &mut App) -> bool {
        self.text
            .update(cx, |field, cx| field.marked_text_range(window, cx))
            .is_some()
    }

    fn on_field_event(
        &mut self,
        _: &Entity<TextareaState>,
        event: &FieldEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        match event {
            FieldEvent::Change => {
                self.error = None;
                self.field_changed(window, cx);
                if !self.value(cx).is_empty() {
                    cx.emit(ComposerEvent::Typing);
                }
            }
            // The kit composer takes Enter before the field sees it.
            FieldEvent::PressEnter { .. } => {}
            FieldEvent::Focus | FieldEvent::Blur => cx.notify(),
        }
    }

    /// The field notifies on anything, a caret blink included, so this looks before it works.
    fn field_changed(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let field = self.text.read(cx);
        let now = (field.value(), field.cursor());
        let composing = self.is_composing(window, cx);
        if now != self.seen || composing != self.seen_composing {
            self.seen = now;
            self.seen_composing = composing;
            self.dismissed_at = None;
            self.refresh_menu(window, cx);
            self.save_draft(cx);
            cx.notify();
        }
    }

    fn refresh_menu(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let (value, cursor) = self.seen.clone();
        let current = if !self.can_compose()
            || self.is_composing(window, cx)
            || self
                .dismissed_at
                .as_ref()
                .is_some_and(|at| *at == self.seen)
        {
            None
        } else {
            get_current_mention(&value, cursor)
        };
        let next = current.and_then(|current| {
            let candidates: Vec<_> = self
                .source
                .candidates(&current.query)
                .into_iter()
                .filter(|candidate| {
                    candidate.insert_text.starts_with(match current.trigger {
                        MentionTrigger::At => '@',
                        MentionTrigger::Hash => '#',
                    })
                })
                .take(MAX_SUGGESTIONS)
                .collect();
            (!candidates.is_empty()).then_some(OpenMenu {
                start: current.start,
                end: current.end,
                selected: 0,
                query: current.query,
                candidates,
            })
        });
        // The web keeps the highlight while the same list stays open.
        self.menu = match (self.menu.take(), next) {
            (Some(old), Some(mut new)) if old.start == new.start && old.query == new.query => {
                new.selected = old.selected.min(new.candidates.len() - 1);
                Some(new)
            }
            (_, next) => next,
        };
        cx.notify();
    }

    fn move_selection(&mut self, down: bool, cx: &mut Context<Self>) {
        if let Some(menu) = &mut self.menu {
            let len = menu.candidates.len();
            menu.selected = if down {
                (menu.selected + 1) % len
            } else {
                (menu.selected + len - 1) % len
            };
            cx.notify();
        }
    }

    fn pick(&mut self, index: usize, window: &mut Window, cx: &mut Context<Self>) {
        let Some(open) = self.menu.take() else {
            return;
        };
        let Some(candidate) = open.candidates.get(index).cloned() else {
            return;
        };
        let (value, _) = self.seen.clone();
        let (new_text, caret) = insert_mention(&value, open.end, &candidate.insert_text);
        self.picked.push(candidate);
        self.replace_keeping_undo(new_text, caret..caret, window, cx);
    }

    /// Replaces the text so that Ctrl+Z still works, unlike `set_value`.
    fn replace_keeping_undo(
        &mut self,
        text: String,
        selection: std::ops::Range<usize>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.text.update(cx, |field, cx| {
            field.replace_all(text, window, cx);
            field.set_selected_range(selection, cx);
        });
        self.focus(window, cx);
        self.field_changed(window, cx);
    }

    // ---- Keys. ----

    /// The kit composer's keys, in `useComposerKeys`' order: the open list, then Escape, then ↑.
    /// Never called while an input method composes. True claims the key.
    fn on_composer_key(
        &mut self,
        key: ComposerKey,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        let selected = self.menu.as_ref().map(|open| open.selected);
        match (key, selected) {
            (ComposerKey::Up, Some(_)) => self.move_selection(false, cx),
            (ComposerKey::Down, Some(_)) => self.move_selection(true, cx),
            (ComposerKey::Enter { shift: false } | ComposerKey::Tab, Some(selected)) => {
                self.pick(selected, window, cx)
            }
            (ComposerKey::Escape, Some(_)) => self.dismiss_menu(cx),
            (ComposerKey::Escape, None) if self.is_editing() => self.cancel_edit(cx),
            (ComposerKey::Escape, None) if self.reply.is_some() => self.cancel_reply(window, cx),
            (ComposerKey::Up, None)
                if self.mode == ComposerMode::Send
                    && self.value(cx).is_empty()
                    && self.attachments.is_empty() =>
            {
                cx.emit(ComposerEvent::EditLastMessage)
            }
            _ => return false,
        }
        true
    }

    /// Closes the dropdown until the text or the caret changes.
    fn dismiss_menu(&mut self, cx: &mut Context<Self>) {
        if self.menu.take().is_some() {
            self.dismissed_at = Some(self.seen.clone());
        }
        cx.notify();
    }

    fn cancel_reply(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.reply = None;
        self.save_draft(cx);
        self.focus(window, cx);
        cx.notify();
    }

    fn on_key_down(&mut self, event: &KeyDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        let keys = &event.keystroke;
        let modifiers = keys.modifiers;
        if !modifiers.secondary(cx) || modifiers.alt || modifiers.shift {
            return;
        }
        // An input method owns every key while it composes.
        if self.is_composing(window, cx) {
            return;
        }
        let Some(marker) = marker_for_shortcut(&keys.key) else {
            return;
        };
        cx.stop_propagation();
        let field = self.text.read(cx);
        let wrapped = wrap_selection(&field.value(), field.selected_range(), marker);
        self.replace_keeping_undo(wrapped.text, wrapped.selection, window, cx);
    }

    // ---- Sending. ----

    fn can_compose(&self) -> bool {
        matches!(self.availability, Availability::Open { .. })
    }

    fn can_attach(&self) -> bool {
        self.mode == ComposerMode::Send
            && matches!(
                self.availability,
                Availability::Open {
                    can_attach: true,
                    ..
                }
            )
    }

    fn slowmode_left(&self, cx: &App) -> Option<Duration> {
        let until = self.slowmode_until?;
        let now = cx.background_executor().now();
        (until > now).then(|| until - now)
    }

    fn has_content(&self, cx: &App) -> bool {
        !self.value(cx).trim().is_empty() || !self.attachments.is_empty()
    }

    fn may_send(&self, cx: &App) -> bool {
        self.can_compose()
            && self.in_flight.is_none()
            && self.slowmode_left(cx).is_none()
            && self.has_content(cx)
    }

    fn send(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.is_editing() {
            return self.save_edit(window, cx);
        }
        // An input method that lets Enter through is confirming a candidate, not sending.
        if !self.may_send(cx) || self.is_composing(window, cx) {
            return;
        }
        let snapshot = self.current_draft(cx);
        let text = snapshot.text.trim().to_owned();
        let source = self.source.clone();
        let mentions = resolve_mentions(&text, &snapshot.picked, |token| {
            source
                .candidates(&token[1..])
                .into_iter()
                .find(|candidate| candidate.insert_text == token)
        });
        let draft = MessageDraft {
            text,
            mentions,
            reply_to_message_id: snapshot
                .reply
                .as_ref()
                .map(|reply| reply.message_id.clone()),
            files: Vec::new(),
        };
        let attachments = snapshot.attachments.clone();
        let conversation = self.conversation.clone();
        self.in_flight = Some(InFlight {
            conversation: conversation.clone(),
            draft: snapshot,
        });
        self.apply_draft(Draft::default(), window, cx);
        self.error = None;
        self.focus(window, cx);
        cx.emit(ComposerEvent::Send {
            conversation,
            draft,
            attachments,
        });
        cx.notify();
    }

    fn attachment_problem(&self, files: &[PendingAttachment]) -> Option<String> {
        if !self.can_attach() {
            return Some(self.attach_disabled_hint());
        }
        if let Some(big) = files.iter().find(|file| {
            file.size_bytes
                .is_some_and(|size| size > self.max_file_bytes)
        }) {
            return Some(format!(
                "File \"{}\" exceeds the {} size limit",
                big.name,
                crate::format::file_size(self.max_file_bytes)
            ));
        }
        (self.attachments.len() + files.len() > MAX_FILES)
            .then(|| format!("Maximum {MAX_FILES} files per message"))
    }

    fn attach_disabled_hint(&self) -> String {
        if self.mode == ComposerMode::Thread {
            return THREAD_NO_FILES.to_owned();
        }
        match &self.availability {
            Availability::Open {
                channel_name: Some(name),
                ..
            } => format!("Attaching files is turned off in #{name}"),
            _ => "Attaching files is turned off in this channel".to_owned(),
        }
    }

    // ---- The clock. ----

    /// One tick a second while a countdown shows, and none otherwise.
    fn start_ticker(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.ticker.is_some() {
            return;
        }
        self.ticker = Some(cx.spawn_in(window, async move |this, cx| {
            loop {
                cx.background_executor().timer(Duration::from_secs(1)).await;
                let keep_going = this.update_in(cx, |this, window, cx| this.tick(window, cx));
                if !matches!(keep_going, Ok(true)) {
                    break;
                }
            }
        }));
    }

    fn tick(&mut self, window: &mut Window, cx: &mut Context<Self>) -> bool {
        let now = cx.background_executor().now();
        if self.slowmode_until.is_some_and(|until| until <= now) {
            self.slowmode_until = None;
        }
        let mut counting = self.slowmode_until.is_some();
        if let Availability::TimedOut {
            until: Some(until), ..
        } = self.availability
        {
            if until <= now {
                self.set_availability(Availability::default(), window, cx);
                cx.emit(ComposerEvent::TimeoutEnded);
            } else {
                counting = true;
            }
        }
        if !counting {
            self.ticker = None;
        }
        cx.notify();
        counting
    }

    // ---- Drawing. ----

    /// Why the reader cannot write, as `ComposerUnavailableNotice` words it, with the web
    /// Lounge's icon for each kind.
    fn notice_copy(&self, cx: &App) -> (LoungeIcon, String, Option<String>) {
        let in_channel = |name: &Option<String>| match name {
            Some(name) => format!("#{name}"),
            None => "This channel".to_owned(),
        };
        match &self.availability {
            Availability::ReadOnly {
                channel_name,
                posting_roles,
            } => {
                let copy = if posting_roles.is_empty() {
                    format!("{} is read-only.", in_channel(channel_name))
                } else {
                    format!(
                        "{} is read-only. Only {} can post.",
                        in_channel(channel_name),
                        format_role_list(posting_roles)
                    )
                };
                (LoungeIcon::Megaphone, copy, None)
            }
            Availability::NoPermission { channel_name } => (
                LoungeIcon::Lock,
                match channel_name {
                    Some(name) => format!("You can't send messages in #{name}"),
                    None => "You can't send messages in this channel".to_owned(),
                },
                None,
            ),
            Availability::TimedOut { until, reason } => {
                let now = cx.background_executor().now();
                let copy = match until {
                    Some(until) => format!(
                        "Timed out, {} left",
                        format_time_left(until.saturating_duration_since(now))
                    ),
                    None => "You're timed out in this community".to_owned(),
                };
                (LoungeIcon::Shield, copy, reason.clone())
            }
            Availability::Banned { reason } => (
                LoungeIcon::Lock,
                "You're banned from this community".to_owned(),
                reason.clone(),
            ),
            Availability::Open { .. } => (LoungeIcon::Lock, String::new(), None),
        }
    }

    fn notice(&self, cx: &App) -> ComposerNotice {
        let (icon, copy, reason) = self.notice_copy(cx);
        let text = match reason {
            Some(reason) => format!("{copy}. Reason: {reason}"),
            None => copy,
        };
        ComposerNotice::new(text).icon(icon)
    }

    fn open_emoji(&mut self, cx: &mut Context<Self>) {
        self.emoji_open = true;
        cx.emit(ComposerEvent::OpenEmojiPicker);
        cx.notify();
    }

    fn open_gifs(&mut self, cx: &mut Context<Self>) {
        cx.emit(ComposerEvent::OpenGifs);
        cx.notify();
    }

    fn open_files(&mut self, cx: &mut Context<Self>) {
        cx.emit(ComposerEvent::OpenFilePicker);
        cx.notify();
    }

    fn remove_attachment(&mut self, index: usize, window: &mut Window, cx: &mut Context<Self>) {
        if index < self.attachments.len() {
            self.attachments.remove(index);
            self.save_draft(cx);
            // The button that had focus is gone.
            self.focus(window, cx);
            cx.notify();
        }
    }

    /// The field's name: what it is for ("Message #general"), as the kit's label and placeholder.
    fn label(&self) -> SharedString {
        if self.placeholder.is_empty() {
            if self.is_editing() {
                "Edit message".into()
            } else {
                "Message".into()
            }
        } else {
            self.placeholder.clone()
        }
    }

    /// The open mention list, as the kit's SuggestionList.
    fn suggestions(&self, cx: &mut Context<Self>) -> Option<SuggestionList> {
        let open = self.menu.as_ref()?;
        let options = open
            .candidates
            .iter()
            .map(|candidate| {
                let key = format!("{:?}:{}", candidate.kind, candidate.id);
                // A person reads as their name over their handle; anything else as what is
                // inserted over what it does ("@here", "Notify online members").
                if candidate.kind == MentionKind::User {
                    return Suggestion::new(key, candidate.label.clone())
                        .detail(candidate.insert_text.clone())
                        .avatar(None, semaphore_design::person_colour(Some(&candidate.id)))
                        .avatar_file(candidate.avatar_file_id.as_deref());
                }
                let suggestion = Suggestion::new(key, candidate.insert_text.clone())
                    .detail(candidate.label.clone());
                match candidate.kind {
                    MentionKind::User => suggestion,
                    MentionKind::Alias => suggestion.icon(LoungeIcon::Users),
                    MentionKind::Special => suggestion.icon(LoungeIcon::Megaphone),
                    MentionKind::Channel => suggestion.icon(LoungeIcon::Hash),
                    MentionKind::Community | MentionKind::Emoji => suggestion,
                }
            })
            .collect();
        let this = cx.entity().downgrade();
        Some(
            SuggestionList::new(
                "mention-list",
                "Mention suggestions",
                options,
                Some(open.selected),
            )
            .on_pick(move |index, window, cx| {
                this.update(cx, |this, cx| this.pick(index, window, cx))
                    .ok();
            }),
        )
    }

    /// The queued files (send) or the message's kept files (edit), each with Remove.
    fn tray(&self, cx: &mut Context<Self>) -> Vec<AttachmentTile> {
        let this = cx.entity().downgrade();
        if self.is_editing() {
            return self
                .edit_attachments
                .iter()
                .enumerate()
                .map(|(index, file)| {
                    let this = this.clone();
                    AttachmentTile::new(
                        ElementId::NamedInteger("composer-kept".into(), index as u64),
                        AttachmentKind::File,
                        file.filename.clone(),
                    )
                    .detail(crate::format::file_size(file.size_bytes))
                    .on_remove(move |window, cx| {
                        this.update(cx, |this, cx| {
                            this.remove_edit_attachment(index, window, cx)
                        })
                        .ok();
                    })
                })
                .collect();
        }
        if self.mode != ComposerMode::Send {
            return Vec::new();
        }
        self.attachments
            .iter()
            .enumerate()
            .map(|(index, file)| {
                let this = this.clone();
                let tile = AttachmentTile::new(
                    ElementId::NamedInteger("composer-file".into(), index as u64),
                    AttachmentKind::File,
                    file.name.clone(),
                );
                let tile = match file.size_bytes {
                    Some(bytes) => tile.detail(crate::format::file_size(bytes)),
                    None => tile,
                };
                tile.on_remove(move |window, cx| {
                    this.update(cx, |this, cx| this.remove_attachment(index, window, cx))
                        .ok();
                })
            })
            .collect()
    }

    /// The emoji slot: the GIF button (when the server has GIF search) and the emoji button.
    fn slot(&self, cx: &mut Context<Self>) -> Vec<IconButton> {
        let this = cx.entity().downgrade();
        let gif = self.gifs_enabled.then(|| {
            let this = this.clone();
            IconButton::new("composer-gif", DesignIcon::GifBoxOutlined, "Send a GIF")
                .lounge_icon(LoungeIcon::ImagePlay)
                .variant(IconButtonVariant::Soft)
                .on_click(move |_, _, cx| {
                    this.update(cx, |this, cx| this.open_gifs(cx)).ok();
                })
        });
        let emoji = IconButton::new(
            "composer-emoji",
            DesignIcon::EmojiEmotionsOutlined,
            "Add emoji",
        )
        .lounge_icon(LoungeIcon::Smile)
        .variant(IconButtonVariant::Soft)
        .selected(self.emoji_open)
        .on_click(move |_, _, cx| {
            this.update(cx, |this, cx| this.open_emoji(cx)).ok();
        });
        gif.into_iter().chain([emoji]).collect()
    }

    /// The slow-mode wait, a quiet line above the field (the web Lounge has none yet).
    fn slowmode_line(&self, cx: &App) -> Option<AnyElement> {
        let left = self.slowmode_left(cx)?;
        let copy = format!(
            "Slow mode: you can send again in {}",
            format_time_left(left)
        );
        let secondary = cx.sem().role.text_secondary;
        Some(
            div()
                .flex()
                .items_center()
                .gap(px(SPACE_SM))
                .px(px(SPACE_MD))
                .pt(px(SPACE_SM))
                .text_color(secondary)
                .child(
                    Icon::lounge(LoungeIcon::Info)
                        .size(IconSize::Sm.px())
                        .color(secondary)
                        .into_any_element(),
                )
                .child(
                    type_text(TEXT_SMALL, copy.clone())
                        .id("composer-slowmode")
                        .test_support()
                        .role(Role::Status)
                        .aria_label(copy),
                )
                .into_any_element(),
        )
    }

    /// The thread's composer is its own drop zone (the conversation's is the ChatPane): files
    /// dragged over it show why they can't go, and a drop says so.
    fn thread_drop(&self, root: Stateful<Div>, cx: &mut Context<Self>) -> Stateful<Div> {
        if self.mode != ComposerMode::Thread {
            return root;
        }
        // A drag that ends with neither a drop nor an exit: the first move without the button
        // held, or a release, clears the look (as ChatPane does).
        let clear = cx.listener(|this, event: &MouseMoveEvent, _, cx| {
            if event.pressed_button.is_none() {
                this.set_dropping(false, cx);
            }
        });
        root.on_drag_move(
            cx.listener(|this, event: &DragMoveEvent<ExternalPaths>, _, cx| {
                let inside = event.bounds.contains(&event.event.position);
                this.set_dropping(inside, cx);
            }),
        )
        .on_file_drop_exit(cx.listener(|this, _, _, cx| this.set_dropping(false, cx)))
        .on_mouse_move(clear)
        .on_mouse_up(
            MouseButton::Left,
            cx.listener(|this, _, _, cx| this.set_dropping(false, cx)),
        )
        .on_drop(cx.listener(|this, paths: &ExternalPaths, window, cx| {
            this.set_dropping(false, cx);
            let files = paths
                .paths()
                .iter()
                .map(|path| PendingAttachment::from_path(path))
                .collect();
            this.add_attachments(files, window, cx);
        }))
    }
}

impl Render for Composer {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let this = cx.entity().downgrade();
        let phone = WidthRange::current(window).is_phone();
        let root = div()
            .id("composer-host")
            .relative()
            .w_full()
            .min_w_0()
            .flex()
            .flex_col();
        let composer =
            KitComposer::new("composer", self.label(), self.text.clone()).cap(if phone {
                ComposerCap::Phone
            } else {
                ComposerCap::Desktop
            });
        if !self.can_compose() {
            return root.child(composer.notice(self.notice(cx)));
        }
        let editing = self.is_editing();
        let sendable = if editing {
            self.may_save_edit(cx)
        } else {
            self.has_content(cx) && self.slowmode_left(cx).is_none()
        };
        let keys = this.clone();
        let submit = this.clone();
        let paste = this.clone();
        let mut composer = composer
            .can_send(sendable)
            .sending(self.in_flight.is_some())
            .on_key(move |key, window, cx| {
                keys.update(cx, |this, cx| this.on_composer_key(key, window, cx))
                    .unwrap_or(false)
            })
            .on_submit(move |window, cx| {
                submit.update(cx, |this, cx| this.send(window, cx)).ok();
            })
            .emoji(self.slot(cx))
            .attachments(self.tray(cx));
        if editing {
            let cancel = this.clone();
            composer = composer
                .mode(KitMode::Save)
                .inline()
                .on_cancel(move |_, cx| {
                    cancel.update(cx, |this, cx| this.cancel_edit(cx)).ok();
                });
        }
        if self.mode == ComposerMode::Send {
            let files = this.clone();
            let hint = self.attach_disabled_hint();
            composer = composer
                .on_attach(move |_, cx| {
                    files.update(cx, |this, cx| this.open_files(cx)).ok();
                })
                .attach_unavailable(!self.can_attach())
                .on_attach_unavailable_press(move |window, cx| {
                    announce(hint.clone(), Politeness::Polite, window, cx)
                })
                .on_paste_files(move |files, window, cx| {
                    paste
                        .update(cx, |this, cx| this.add_pasted(files, window, cx))
                        .ok();
                });
            if let Some(reply) = &self.reply {
                let cancel = this.clone();
                composer = composer.banner(
                    ComposerBanner::new(
                        BannerKind::Reply,
                        format!("Replying to {}", reply.author_name),
                        "Cancel reply",
                        move |window, cx| {
                            cancel
                                .update(cx, |this, cx| this.cancel_reply(window, cx))
                                .ok();
                        },
                    )
                    .detail(reply.snippet.clone()),
                );
            }
        }
        if self.dropping {
            composer = composer.drop_target(if self.can_attach() {
                "Drop files to attach them".to_owned()
            } else {
                self.attach_disabled_hint()
            });
        }
        if let Some(list) = self.suggestions(cx) {
            composer = composer.suggestions(list);
        }
        let root = self
            .thread_drop(root, cx)
            .on_key_down(cx.listener(Self::on_key_down));
        root.children(self.slowmode_line(cx)).child(composer)
    }
}

#[cfg(feature = "stories")]
impl Composer {
    /// A preedit in the field, as an input method would leave it, for a screenshot.
    pub(super) fn compose_for_story(
        &mut self,
        text: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.text.update(cx, |field, cx| {
            field.replace_and_mark_text_in_range(
                None,
                text,
                Some(0..text.encode_utf16().count()),
                window,
                cx,
            );
        });
        self.field_changed(window, cx);
    }
}
