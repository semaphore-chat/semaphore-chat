//! The composer view, after `MessageInput.tsx`.
//!
//! Editing, undo, IME and the field's accessibility node belong to the kit's `Textarea`. This owns
//! what surrounds it: which conversation it edits, the keys the web gives special meaning, the
//! dropdown, attachments, the reply banner, and whether posting is possible at all.
//!
//! Bound keys reach the field as actions, so the keys that mean something else while the dropdown is
//! open are taken with `capture_action`, which runs before the field's own handlers.

use super::edit::{KeptEmoji, edit_mentions, picked_from_draft};
use super::menu::{AtCaret, MenuData, OnPick, menu};
use super::model::{
    Availability, ComposerEvent, ComposerMode, Draft, DraftStore, MentionSource, PendingAttachment,
    ReplyTarget,
};
use super::palette::{
    BODY_FONT, DRAFT_MAX_FRACTION, FIELD_LINE, FIELD_PAD_X, FIELD_PAD_Y, FIELD_TEXT, ICON_BUTTON,
    NARROW_BELOW, Palette, icon, observed, with_alpha,
};
use super::rules::{
    MentionTrigger, collapse_whitespace, format_role_list, format_time_left, get_current_mention,
    insert_mention, marker_for_shortcut, resolve_mentions, wrap_selection,
};
use gpui_kit::base::Button;
use gpui_kit::component::Sizable as _;
use gpui_kit::component::input::{
    Enter, Escape, IndentInline, InputEvent as FieldEvent, MoveDown, MoveUp, Textarea,
    TextareaState,
};
use gpui_kit::component::spinner::Spinner;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{AttachmentView, Conversation, MentionCandidate, MessageDraft};
use semaphore_design::Icon as DesignIcon;
use std::rc::Rc;
use std::time::{Duration, Instant};

/// `MAX_FILES_PER_MESSAGE` and `MAX_FILE_SIZE` in `constants/messages.ts`.
const MAX_FILES: usize = 10;
const MAX_FILE_BYTES: u64 = 10 * 1024 * 1024;
/// The web's total limit on suggestions.
const MAX_SUGGESTIONS: usize = 10;
const THUMB_SIZE: f32 = 64.;
/// The web's slim layout caps the field at four rows.
const NARROW_MAX_ROWS: usize = 4;
/// `Size::XSmall.input_px()`.
const KIT_PAD_X: f32 = 4.;
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
    palette: Palette,
    /// Draw in the app's theme as it is at each frame, instead of the web's default dark.
    follow_theme: bool,
    availability: Availability,
    max_file_bytes: u64,

    attachments: Vec<PendingAttachment>,
    reply: Option<ReplyTarget>,
    picked: Vec<MentionCandidate>,

    menu: Option<OpenMenu>,
    menu_scroll: ScrollHandle,
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
    actions_open: bool,
    focused: bool,
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

fn draft_rows(window: &Window) -> usize {
    let height: f32 = window.viewport_size().height.into();
    let rows = (height * DRAFT_MAX_FRACTION / FIELD_LINE).floor() as usize;
    if window.viewport_size().width < px(NARROW_BELOW) {
        rows.clamp(1, NARROW_MAX_ROWS)
    } else {
        rows.max(1)
    }
}

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
        let rows = draft_rows(window);
        let placeholder = config.placeholder;
        let text = cx.new(|cx| {
            TextareaState::new(window, cx)
                .auto_grow(1, rows)
                .submit_on_enter(true)
                .placeholder(placeholder.clone())
        });
        let subscriptions = vec![
            cx.subscribe_in(&text, window, Self::on_field_event),
            cx.observe_in(&text, window, |this, _, window, cx| {
                this.field_changed(window, cx)
            }),
            cx.observe_window_bounds(window, |this, window, cx| {
                let rows = draft_rows(window);
                this.text
                    .update(cx, |text, cx| text.set_auto_grow(1, rows, cx));
            }),
        ];
        let mut this = Self {
            text,
            placeholder,
            conversation: config.conversation,
            source: config.source,
            drafts: config.drafts,
            palette: Palette::dark(),
            follow_theme: false,
            availability: Availability::default(),
            max_file_bytes: config.max_file_bytes.unwrap_or(MAX_FILE_BYTES),
            attachments: Vec::new(),
            reply: None,
            picked: Vec::new(),
            menu: None,
            menu_scroll: ScrollHandle::new(),
            dismissed_at: None,
            seen: (SharedString::default(), 0),
            seen_composing: false,
            in_flight: None,
            error: None,
            slowmode: None,
            slowmode_until: None,
            emoji_open: false,
            gifs_enabled: false,
            actions_open: false,
            focused: false,
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

    /// What the empty field shows ("Message #general"). The owner sets it with each conversation.
    /// Draw in the app's theme (`crate::theme::Sem`) from now on.
    pub fn follow_theme(&mut self, cx: &mut Context<Self>) {
        self.follow_theme = true;
        cx.notify();
    }

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
        self.placeholder = placeholder.clone();
        self.text
            .update(cx, |text, cx| text.set_placeholder(placeholder, window, cx));
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
        self.error = self.attachment_problem(&files).map(Into::into);
        if self.error.is_none() {
            self.attachments.extend(files);
            self.save_draft(cx);
        }
        self.focus(window, cx);
        cx.notify();
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
                self.error = Some(if message.is_empty() {
                    SEND_FAILED.into()
                } else {
                    message.into()
                });
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
            FieldEvent::PressEnter { shift: false, .. } if self.is_editing() => {
                self.save_edit(window, cx)
            }
            FieldEvent::PressEnter { shift: false, .. } => self.send(window, cx),
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
            (_, next) => {
                self.menu_scroll.scroll_to_item(0);
                next
            }
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
            self.menu_scroll.scroll_to_item(menu.selected);
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

    fn on_up(&mut self, _: &MoveUp, window: &mut Window, cx: &mut Context<Self>) {
        if self.menu.is_some() {
            self.move_selection(false, cx);
            cx.stop_propagation();
        } else if self.mode == ComposerMode::Send
            && self.value(cx).is_empty()
            && self.attachments.is_empty()
            && !self.is_composing(window, cx)
        {
            cx.emit(ComposerEvent::EditLastMessage);
            cx.stop_propagation();
        }
    }

    fn on_down(&mut self, _: &MoveDown, _: &mut Window, cx: &mut Context<Self>) {
        if self.menu.is_some() {
            self.move_selection(true, cx);
            cx.stop_propagation();
        }
    }

    fn on_enter(&mut self, action: &Enter, window: &mut Window, cx: &mut Context<Self>) {
        if let (Some(open), false) = (&self.menu, action.shift) {
            let selected = open.selected;
            self.pick(selected, window, cx);
            cx.stop_propagation();
        }
    }

    fn on_tab(&mut self, _: &IndentInline, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(open) = &self.menu {
            let selected = open.selected;
            self.pick(selected, window, cx);
            cx.stop_propagation();
        }
    }

    fn on_escape(&mut self, _: &Escape, window: &mut Window, cx: &mut Context<Self>) {
        // Esc during composition belongs to the input method.
        if self.is_composing(window, cx) {
            return;
        }
        if self.menu.is_some() {
            self.dismiss_menu(cx);
            cx.stop_propagation();
        } else if self.is_editing() {
            self.cancel_edit(cx);
            cx.stop_propagation();
        } else if self.reply.is_some() {
            self.cancel_reply(window, cx);
            cx.stop_propagation();
        }
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
            let limit = self.max_file_bytes as f64 / (1024. * 1024.);
            return Some(format!(
                "File \"{}\" exceeds the {limit:.0} MB size limit",
                big.name
            ));
        }
        (self.attachments.len() + files.len() > MAX_FILES)
            .then(|| format!("Maximum {MAX_FILES} files per message"))
    }

    fn attach_disabled_hint(&self) -> String {
        match &self.availability {
            Availability::Open {
                channel_name: Some(name),
                ..
            } => format!("Attaching files is turned off in #{name}"),
            _ => "Attaching files is turned off in this channel".to_owned(),
        }
    }

    /// Files first, then whatever text came with them, as the web's paste lets both through.
    fn on_paste(
        &mut self,
        item: &ClipboardItem,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        let files: Vec<_> = item
            .entries()
            .iter()
            .flat_map(|entry| match entry {
                ClipboardEntry::Image(image) => {
                    vec![PendingAttachment::from_clipboard_image(image.clone())]
                }
                ClipboardEntry::ExternalPaths(paths) => paths
                    .paths()
                    .iter()
                    .map(|path| PendingAttachment::from_path(path))
                    .collect(),
                ClipboardEntry::String(_) => Vec::new(),
            })
            .collect();
        let had_files = !files.is_empty();
        self.add_attachments(files, window, cx);
        had_files && item.text().is_none()
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

    fn notice_copy(&self, cx: &App) -> (DesignIcon, String, Option<String>) {
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
                (DesignIcon::CampaignOutlined, copy, None)
            }
            Availability::NoPermission { channel_name } => (
                DesignIcon::LockOutlined,
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
                (DesignIcon::TimerOutlined, copy, reason.clone())
            }
            Availability::Banned { reason } => (
                DesignIcon::Block,
                "You're banned from this community".to_owned(),
                reason.clone(),
            ),
            Availability::Open { .. } => (DesignIcon::LockOutlined, String::new(), None),
        }
    }

    /// `ComposerUnavailableNotice`: stands in for the composer, at the composer's height.
    fn render_notice(&self, cx: &App) -> AnyElement {
        let p = self.palette;
        let (glyph, copy, reason) = self.notice_copy(cx);
        let label = match &reason {
            Some(reason) => format!("{copy}. Reason: {reason}"),
            None => copy.clone(),
        };
        observed(
            div()
                .id("composer-unavailable")
                .role(Role::Status)
                .aria_label(label)
                .w_full()
                .p(px(16.))
                // The composer's height, borders included, so the chat doesn't jump when the state changes.
                .min_h(px(74.))
                .flex()
                .items_center()
                .gap(px(12.))
                .rounded(px(4.))
                .border_1()
                .border_color(p.paper_border)
                .bg(p.paper)
                .shadow_sm()
                .text_color(p.text_secondary)
                .child(icon(glyph, 20., p.text_secondary))
                .child(
                    div()
                        .min_w_0()
                        .flex()
                        .flex_col()
                        .child(div().text_size(px(14.)).line_height(px(20.)).child(copy))
                        .when_some(reason, |column, reason| {
                            column.child(
                                div()
                                    .text_size(px(12.))
                                    .line_height(px(16.))
                                    .child(format!("Reason: {reason}")),
                            )
                        }),
                ),
        )
        .into_any_element()
    }

    /// MUI's `IconButton`: 40 px, round, with the accent's hover tint.
    fn icon_button(
        &self,
        id: &'static str,
        label: &'static str,
        glyph: DesignIcon,
        color: Hsla,
        disabled: bool,
    ) -> Button {
        self.sized_icon_button(id, label, glyph, color, disabled, ICON_BUTTON, 24.)
    }

    #[allow(clippy::too_many_arguments)]
    fn sized_icon_button(
        &self,
        id: &'static str,
        label: &'static str,
        glyph: DesignIcon,
        color: Hsla,
        disabled: bool,
        side: f32,
        icon_side: f32,
    ) -> Button {
        let p = self.palette;
        Button::new(id)
            .accessibility_label(label)
            .disabled(disabled)
            .size(px(side))
            .flex_none()
            .rounded_full()
            .when(!disabled, |button| {
                button
                    .cursor_pointer()
                    .hover(move |style| style.bg(p.primary_hover))
            })
            .child(icon(
                glyph,
                icon_side,
                if disabled { p.icon_disabled } else { color },
            ))
    }

    fn render_reply(&self, reply: &ReplyTarget, cx: &mut Context<Self>) -> AnyElement {
        let p = self.palette;
        observed(
            div()
                .id("reply-banner")
                .role(Role::Group)
                .aria_label(format!("Replying to {}", reply.author_name))
                .flex()
                .items_center()
                .gap(px(8.))
                .mx(px(8.))
                .mb(px(4.))
                .pl(px(12.))
                .pr(px(4.))
                .py(px(2.))
                .rounded(px(4.))
                .border_l_2()
                .border_color(p.primary)
                .bg(p.hover)
                .text_size(px(12.))
                .line_height(px(20.))
                .text_color(p.text_secondary)
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .overflow_hidden()
                        .child(
                            div()
                                .flex()
                                .gap(px(4.))
                                .whitespace_nowrap()
                                .child("Replying to")
                                .child(
                                    div()
                                        .font_weight(FontWeight::SEMIBOLD)
                                        .text_color(p.primary)
                                        .child(reply.author_name.clone()),
                                ),
                        )
                        .child(div().truncate().child(reply.snippet.clone())),
                )
                .child(
                    self.sized_icon_button(
                        "cancel-reply",
                        "cancel reply",
                        DesignIcon::Close,
                        p.icon,
                        false,
                        30.,
                        18.,
                    )
                    .on_click(cx.listener(|this, _, window, cx| this.cancel_reply(window, cx))),
                ),
        )
        .into_any_element()
    }

    fn render_attachments(&self, cx: &mut Context<Self>) -> AnyElement {
        let p = self.palette;
        let items = self.attachments.iter().enumerate().map(|(index, file)| {
            let remove = cx.listener(move |this: &mut Self, _: &ClickEvent, window, cx| {
                if index < this.attachments.len() {
                    this.attachments.remove(index);
                    this.save_draft(cx);
                    // The button that had focus is gone.
                    this.focus(window, cx);
                    cx.notify();
                }
            });
            let label: SharedString = format!("remove {}", file.name).into();
            let remove_id = ElementId::NamedInteger("remove-attachment".into(), index as u64);
            match &file.preview {
                Some(preview) => div()
                    .relative()
                    .flex_none()
                    .size(px(THUMB_SIZE))
                    .rounded(px(4.))
                    .border_1()
                    .border_color(p.divider)
                    .child(
                        img(preview.clone())
                            .size_full()
                            .rounded(px(4.))
                            .object_fit(ObjectFit::Cover),
                    )
                    .child(
                        Button::new(remove_id)
                            .accessibility_label(label)
                            .absolute()
                            .top(px(2.))
                            .right(px(2.))
                            .size(px(22.))
                            .rounded_full()
                            .bg(with_alpha(black(), 0.6))
                            .hover(|style| style.bg(with_alpha(black(), 0.8)))
                            .cursor_pointer()
                            .on_click(remove)
                            .child(icon(DesignIcon::Close, 16., white())),
                    )
                    .into_any_element(),
                // MUI's `Chip` with the tray's neutral override.
                None => div()
                    .flex_none()
                    .max_w(px(200.))
                    .h(px(32.))
                    .flex()
                    .items_center()
                    .pl(px(5.))
                    .pr(px(4.))
                    .gap(px(5.))
                    .rounded(px(16.))
                    .border_1()
                    .border_color(p.divider)
                    .bg(p.selected)
                    .text_size(px(13.))
                    .text_color(p.text)
                    .child(icon(
                        DesignIcon::InsertDriveFileOutlined,
                        18.,
                        p.text_secondary,
                    ))
                    .child(div().min_w_0().truncate().child(file.name.clone()))
                    .child(
                        Button::new(remove_id)
                            .accessibility_label(label)
                            .flex_none()
                            .size(px(22.))
                            .rounded_full()
                            .cursor_pointer()
                            .on_click(remove)
                            .child(icon(DesignIcon::Close, 16., p.text_secondary)),
                    )
                    .into_any_element(),
            }
        });
        observed(
            div()
                .id("composer-file-tray")
                .role(Role::List)
                .aria_label("Attachments")
                .flex()
                .items_center()
                .gap(px(8.))
                .mx(px(8.))
                .mb(px(4.))
                .p(px(8.))
                .rounded(px(8.))
                .border_1()
                .border_color(p.divider)
                .bg(p.hover)
                .overflow_x_scroll()
                .children(items),
        )
        .into_any_element()
    }

    fn render_field(&self, cx: &mut Context<Self>) -> AnyElement {
        let p = self.palette;
        let focused = self.focused;
        let weak = cx.entity().downgrade();
        // A 2 px outline when focused, as MUI's, in the same box: MUI's sits over the padding, and this
        // one takes its width out of the padding.
        let border = if focused { 2. } else { 1. };
        let field = self.text.clone();
        observed(
            div()
                .id("composer-field")
                .cursor_text()
                // The padding around the text is this frame's, so a click there has to focus the field.
                .on_click(move |_, window, cx| {
                    field.update(cx, |field, cx| field.focus(window, cx));
                })
                .flex_1()
                .min_w_0()
                .rounded(px(4.))
                .border(px(border))
                .border_color(if focused { p.primary } else { p.divider })
                .px(px(FIELD_PAD_X - KIT_PAD_X - border))
                .py(px(FIELD_PAD_Y - border))
                .text_color(p.text)
                .child(
                    Textarea::new(&self.text)
                        // The kit ties an editor's padding to its size, with no way to set it. XSmall has
                        // the least (4 px across, 0 down), and the frame adds the rest.
                        .with_size(gpui_kit::component::Size::XSmall)
                        .text_size(px(FIELD_TEXT))
                        .line_height(px(FIELD_LINE))
                        .appearance(false)
                        .bordered(false)
                        .aria_label("Message")
                        .accessibility_id("composer-input")
                        .on_paste(move |item, window, cx| {
                            weak.update(cx, |this, cx| this.on_paste(item, window, cx))
                                .unwrap_or(false)
                        }),
                ),
        )
        .into_any_element()
    }

    fn render_paper(&self, narrow: bool, cx: &mut Context<Self>) -> AnyElement {
        let p = self.palette;
        let sending = self.in_flight.is_some();
        let may_send = self.may_send(cx);
        let can_attach = self.can_attach();
        let has_content = self.has_content(cx);
        div()
            .w_full()
            .p(px(if narrow { 8. } else { 16. }))
            .flex()
            .items_end()
            .gap(px(if narrow { 4. } else { 8. }))
            .rounded(px(4.))
            .border_1()
            .border_color(p.paper_border)
            .bg(p.paper)
            .shadow_sm()
            .when(narrow, |paper| {
                paper.child(
                    self.icon_button(
                        "composer-actions",
                        "Add attachment or emoji",
                        DesignIcon::Add,
                        p.icon,
                        sending,
                    )
                    .aria_expanded(self.actions_open)
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.actions_open = !this.actions_open;
                        this.dismiss_menu(cx);
                    })),
                )
            })
            .child(self.render_field(cx))
            .when(!narrow, |paper| {
                paper
                    .child(
                        self.icon_button(
                            "composer-emoji",
                            "add emoji",
                            DesignIcon::EmojiEmotionsOutlined,
                            p.icon,
                            sending,
                        )
                        .aria_expanded(self.emoji_open)
                        .on_click(cx.listener(|this, _, _, cx| this.open_emoji(cx))),
                    )
                    .when(self.gifs_enabled, |paper| {
                        paper.child(
                            self.icon_button(
                                "composer-gif",
                                "add gif",
                                DesignIcon::GifBoxOutlined,
                                p.icon,
                                sending,
                            )
                            .on_click(cx.listener(|this, _, _, cx| this.open_gifs(cx))),
                        )
                    })
                    .when(self.mode == ComposerMode::Send, |paper| {
                        paper.child(
                            self.icon_button(
                                "composer-attach",
                                "attach file",
                                DesignIcon::AttachFile,
                                p.icon,
                                sending || !can_attach,
                            )
                            .when(!can_attach, |button| {
                                button.aria_description(self.attach_disabled_hint())
                            })
                            .on_click(cx.listener(|this, _, _, cx| this.open_files(cx))),
                        )
                    })
            })
            // Slim layout: send only once there's something to send, so the field gets the width.
            .when(!narrow || has_content || sending, |paper| {
                let send = self
                    .icon_button(
                        "composer-send",
                        "send",
                        DesignIcon::Send,
                        p.primary,
                        !may_send,
                    )
                    .on_click(cx.listener(|this, _, window, cx| this.send(window, cx)));
                paper.child(if sending {
                    // `CircularProgress` in place of the icon, as long as a message is on its way.
                    Button::new("composer-send")
                        .accessibility_label("send")
                        .disabled(true)
                        .size(px(ICON_BUTTON))
                        .flex_none()
                        .child(
                            Spinner::new()
                                .color(p.primary)
                                .with_size(gpui_kit::component::Size::Large),
                        )
                        .into_any_element()
                } else {
                    send.into_any_element()
                })
            })
            .into_any_element()
    }

    fn mention_overlay(
        &self,
        viewport: Size<Pixels>,
        cx: &mut Context<Self>,
    ) -> Option<impl IntoElement + use<>> {
        let p = self.palette;
        let this = cx.entity().downgrade();
        let on_pick: OnPick = Rc::new(move |index, window, cx| {
            this.update(cx, |this, cx| this.pick(index, window, cx))
                .ok();
        });
        self.menu.as_ref().map(|open| {
            let data = MenuData {
                candidates: &open.candidates,
                selected: open.selected,
                scroll: &self.menu_scroll,
                on_pick,
                avatars: cx.try_global::<crate::kit::AvatarImages>(),
            };
            deferred(AtCaret::new(self.text.clone(), menu(data, viewport, &p))).with_priority(1)
        })
    }

    /// `MessageEditForm`: the field with save and cancel, and the kept attachments as chips.
    fn render_edit(&self, cx: &mut Context<Self>) -> AnyElement {
        let p = self.palette;
        let may_save = self.may_save_edit(cx);
        let field = self.render_field(cx);
        let chips: Vec<_> = self
            .edit_attachments
            .iter()
            .enumerate()
            .map(|(index, file)| {
                let label: SharedString = format!("remove {}", file.filename).into();
                div()
                    .flex_none()
                    .max_w(px(220.))
                    .h(px(24.))
                    .flex()
                    .items_center()
                    .pl(px(8.))
                    .pr(px(2.))
                    .gap(px(4.))
                    .rounded(px(12.))
                    .bg(p.selected)
                    .text_size(px(13.))
                    .text_color(p.text)
                    .child(div().min_w_0().truncate().child(file.filename.clone()))
                    .child(
                        Button::new(ElementId::NamedInteger(
                            "edit-remove-attachment".into(),
                            index as u64,
                        ))
                        .accessibility_label(label)
                        .flex_none()
                        .size(px(20.))
                        .rounded_full()
                        .cursor_pointer()
                        .on_click(cx.listener(move |this, _, window, cx| {
                            this.remove_edit_attachment(index, window, cx)
                        }))
                        .child(icon(
                            DesignIcon::Close,
                            14.,
                            p.text_secondary,
                        )),
                    )
            })
            .collect();
        observed(
            div()
                .id("composer-edit")
                .role(Role::Group)
                .aria_label("Edit message")
                .w_full()
                .flex()
                .flex_col()
                .gap(px(8.))
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(8.))
                        .child(field)
                        .child(
                            self.sized_icon_button(
                                "edit-save",
                                "save edit",
                                DesignIcon::Check,
                                p.primary,
                                !may_save,
                                32.,
                                20.,
                            )
                            .on_click(
                                cx.listener(|this, _, window, cx| this.save_edit(window, cx)),
                            ),
                        )
                        .child(
                            self.sized_icon_button(
                                "edit-cancel",
                                "cancel edit",
                                DesignIcon::Cancel,
                                p.icon,
                                false,
                                32.,
                                20.,
                            )
                            .on_click(cx.listener(|this, _, _, cx| this.cancel_edit(cx))),
                        ),
                )
                .when(!self.edit_attachments.is_empty(), |form| {
                    form.child(div().flex().flex_wrap().gap(px(4.)).children(chips))
                }),
        )
        .into_any_element()
    }

    fn open_emoji(&mut self, cx: &mut Context<Self>) {
        self.emoji_open = true;
        self.actions_open = false;
        cx.emit(ComposerEvent::OpenEmojiPicker);
        cx.notify();
    }

    fn open_gifs(&mut self, cx: &mut Context<Self>) {
        self.actions_open = false;
        cx.emit(ComposerEvent::OpenGifs);
        cx.notify();
    }

    fn open_files(&mut self, cx: &mut Context<Self>) {
        self.actions_open = false;
        cx.emit(ComposerEvent::OpenFilePicker);
        cx.notify();
    }

    /// The slim layout's "Add to message" list: the web's bottom sheet, drawn in place above the field.
    fn render_actions(&self, cx: &mut Context<Self>) -> AnyElement {
        let p = self.palette;
        let can_attach = self.can_attach();
        let row = |id: &'static str, label: &'static str, glyph: DesignIcon, enabled: bool| {
            Button::new(id)
                .role(Role::MenuItem)
                .accessibility_label(label)
                .disabled(!enabled)
                .w_full()
                .h(px(48.))
                .px(px(16.))
                .gap(px(16.))
                .justify_start()
                .when(enabled, |row| {
                    row.cursor_pointer().hover(move |style| style.bg(p.hover))
                })
                .text_size(px(16.))
                .text_color(if enabled { p.text } else { p.icon_disabled })
                .child(icon(
                    glyph,
                    24.,
                    if enabled { p.icon } else { p.icon_disabled },
                ))
                .child(label)
        };
        observed(
            div()
                .id("composer-actions-sheet")
                .role(Role::Menu)
                .aria_label("Add to message")
                .mx(px(8.))
                .mb(px(4.))
                .py(px(4.))
                .rounded(px(8.))
                .border_1()
                .border_color(p.divider)
                .bg(p.paper)
                .child(
                    div()
                        .px(px(16.))
                        .py(px(8.))
                        .text_size(px(14.))
                        .text_color(p.text_secondary)
                        .child("Add to message"),
                )
                .when(self.mode == ComposerMode::Send, |sheet| {
                    sheet.child(
                        row(
                            "composer-attach",
                            "Attach file",
                            DesignIcon::AttachFile,
                            can_attach,
                        )
                        .on_click(cx.listener(|this, _, _, cx| this.open_files(cx))),
                    )
                })
                .when(self.gifs_enabled, |sheet| {
                    sheet.child(
                        row("composer-gif", "GIF", DesignIcon::GifBoxOutlined, true)
                            .on_click(cx.listener(|this, _, _, cx| this.open_gifs(cx))),
                    )
                })
                .child(
                    row(
                        "composer-emoji",
                        "Emoji",
                        DesignIcon::EmojiEmotionsOutlined,
                        true,
                    )
                    .on_click(cx.listener(|this, _, _, cx| this.open_emoji(cx))),
                ),
        )
        .into_any_element()
    }
}

impl Render for Composer {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if self.follow_theme
            && let Some(sem) = cx.try_global::<crate::theme::Sem>()
        {
            self.palette = Palette::for_theme(sem.choice);
        }
        let p = self.palette;
        let viewport = window.viewport_size();
        let narrow = viewport.width < px(NARROW_BELOW);
        self.focused = self.text.read(cx).focus_handle(cx).is_focused(window);
        let root = div()
            .id("composer")
            .relative()
            .w_full()
            .flex()
            .flex_col()
            .font_family(BODY_FONT);
        if !self.can_compose() {
            return root.child(self.render_notice(cx));
        }
        if self.is_editing() {
            return root
                .capture_action(cx.listener(Self::on_up))
                .capture_action(cx.listener(Self::on_down))
                .capture_action(cx.listener(Self::on_enter))
                .capture_action(cx.listener(Self::on_tab))
                .capture_action(cx.listener(Self::on_escape))
                .on_key_down(cx.listener(Self::on_key_down))
                .child(self.render_edit(cx))
                .children(self.mention_overlay(viewport, cx));
        }
        let slowmode = self.slowmode_left(cx);
        let reply = self
            .reply
            .clone()
            .filter(|_| self.mode == ComposerMode::Send);
        let overlay = self.mention_overlay(viewport, cx);
        root.capture_action(cx.listener(Self::on_up))
            .capture_action(cx.listener(Self::on_down))
            .capture_action(cx.listener(Self::on_enter))
            .capture_action(cx.listener(Self::on_tab))
            .capture_action(cx.listener(Self::on_escape))
            .on_key_down(cx.listener(Self::on_key_down))
            .on_drop(cx.listener(|this, paths: &ExternalPaths, window, cx| {
                let files = paths
                    .paths()
                    .iter()
                    .map(|path| PendingAttachment::from_path(path))
                    .collect();
                this.add_attachments(files, window, cx);
            }))
            .drag_over::<ExternalPaths>(move |style, _, _, _| {
                style.border_color(p.primary).border_1()
            })
            .when_some(self.error.clone(), |root, error| {
                root.child(observed(
                    div()
                        .id("composer-error")
                        .role(Role::Alert)
                        .aria_label(error.clone())
                        .mx(px(8.))
                        .mb(px(4.))
                        .text_size(px(12.))
                        .line_height(px(20.))
                        .text_color(p.error)
                        .child(error),
                ))
            })
            .when_some(reply, |root, reply| {
                root.child(self.render_reply(&reply, cx))
            })
            .when(!self.attachments.is_empty(), |root| {
                root.child(self.render_attachments(cx))
            })
            .when(self.actions_open && narrow, |root| {
                root.child(self.render_actions(cx))
            })
            .when_some(slowmode, |root, left| {
                let copy = format!(
                    "Slow mode: you can send again in {}",
                    format_time_left(left)
                );
                root.child(observed(
                    div()
                        .id("composer-slowmode")
                        .role(Role::Status)
                        .aria_label(copy.clone())
                        .flex()
                        .items_center()
                        .gap(px(8.))
                        .mx(px(8.))
                        .mb(px(4.))
                        .text_size(px(12.))
                        .line_height(px(20.))
                        .text_color(p.text_secondary)
                        .child(icon(DesignIcon::TimerOutlined, 16., p.text_secondary))
                        .child(copy),
                ))
            })
            .child(self.render_paper(narrow, cx))
            .children(overlay)
    }
}

#[cfg(feature = "stories")]
impl Composer {
    /// The slim layout's list, open, for a screenshot.
    pub(super) fn open_actions_for_story(&mut self, cx: &mut Context<Self>) {
        self.actions_open = true;
        cx.notify();
    }

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
