//! `Composer`: the chrome of a message composer (`frontend/src/kit/chat/Composer.tsx`).
//!
//! The field is the kit's `Textarea`, and its state (`Entity<TextareaState>`: the draft, the caret,
//! undo, the input method) stays with the screen. Bound keys reach the field as actions, so the
//! keys the composer and the screen give a meaning (Enter, ↑, ↓, Tab, Escape) are taken with
//! `capture_action`, which runs before the field's own handlers, as `composer/view.rs` does.

use super::{child_id, one_line};
use crate::kit::look::{focus_ring, shows_focus};
use crate::kit::overlays::type_text;
use crate::kit::surface::{Surface, SurfaceScope, stand_out_fill};
use crate::kit::{Action, Button, ControlSize, Icon, IconButton, IconButtonVariant, IconSize};
use crate::theme::SemTheme;
use gpui_kit::component::Sizable as _;
use gpui_kit::component::Size;
use gpui_kit::component::input::{
    Enter, Escape, IndentInline, MoveDown, MoveUp, Textarea, TextareaState,
};
use gpui_kit::prelude::*;
use gpui_kit::*;
pub use semaphore_design::chat::{ComposerCap, ComposerMode};
use semaphore_design::chat::{cap_rows, has_text_to_send, submit_label};
use semaphore_design::lounge::{
    BORDER_SELECTED, CONTROL_LG, CONTROL_MD, ICON_MD, RADIUS_CARD, RADIUS_ISLAND, SPACE_LG,
    SPACE_MD, SPACE_SM, SPACE_XS, TEXT_BODY, TEXT_BODY_STRONG, TEXT_META, TEXT_SMALL,
};
use semaphore_design::{Icon as I, LoungeIcon};
use std::cell::Cell;
use std::ops::Range;
use std::rc::Rc;

/// A key the screen may take before the composer (`onKeyDown`): the mention list's ↑, ↓, Enter
/// and Tab, Escape to cancel, ↑ in an empty field to edit the last message.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ComposerKey {
    Up,
    Down,
    /// Enter, or Shift+Enter (`shift`).
    Enter {
        shift: bool,
    },
    Tab,
    Escape,
}

type KeyHandler = Rc<dyn Fn(ComposerKey, &mut Window, &mut App) -> bool>;
type PasteHandler = Rc<dyn Fn(Vec<PastedFile>, &mut Window, &mut App)>;

/// A file among what was pasted into the field (`onPasteFiles`): a picture, or a copied file.
#[derive(Debug, Clone, PartialEq)]
pub enum PastedFile {
    Image(Image),
    Path(std::path::PathBuf),
}

/// The files among what was pasted (pictures, copied files); none for plain text.
pub fn pasted_files(item: &ClipboardItem) -> Vec<PastedFile> {
    item.entries()
        .iter()
        .flat_map(|entry| match entry {
            ClipboardEntry::Image(image) => vec![PastedFile::Image(image.clone())],
            ClipboardEntry::ExternalPaths(paths) => paths
                .paths()
                .iter()
                .cloned()
                .map(PastedFile::Path)
                .collect(),
            ClipboardEntry::String(_) => Vec::new(),
        })
        .collect()
}

/// What the composer does to a message other than writing a new one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BannerKind {
    Reply,
    Editing,
}

/// The reply or editing strip above the field, with its cancel button.
pub struct ComposerBanner {
    kind: BannerKind,
    title: SharedString,
    detail: Option<SharedString>,
    cancel_label: SharedString,
    on_cancel: Action,
}

impl ComposerBanner {
    /// `title` ("Replying to aiko"), and the cancel button's name ("Cancel reply").
    pub fn new(
        kind: BannerKind,
        title: impl Into<SharedString>,
        cancel_label: impl Into<SharedString>,
        on_cancel: impl Fn(&mut Window, &mut App) + 'static,
    ) -> Self {
        Self {
            kind,
            title: title.into(),
            detail: None,
            cancel_label: cancel_label.into(),
            on_cancel: Rc::new(on_cancel),
        }
    }

    /// A line of the message replied to or edited.
    pub fn detail(mut self, detail: impl Into<SharedString>) -> Self {
        self.detail = Some(detail.into());
        self
    }
}

/// Why the reader cannot write here: it takes the place of the field and its buttons.
pub struct ComposerNotice {
    text: SharedString,
    icon: LoungeIcon,
}

impl ComposerNotice {
    /// "You can't send messages in #announcements", with the Info icon.
    pub fn new(text: impl Into<SharedString>) -> Self {
        Self {
            text: text.into(),
            icon: LoungeIcon::Info,
        }
    }

    pub fn icon(mut self, icon: LoungeIcon) -> Self {
        self.icon = icon;
        self
    }
}

/// The chrome of a message composer: a field that grows to a cap and then scrolls, a leading
/// attach button, a trailing emoji slot and Send, with an optional reply or editing strip and a
/// tray of queued files above it. A `notice` replaces the field when the reader cannot write.
/// Holds no message logic: the draft (the field's state), mentions, typing and sending are the
/// screen's.
///
/// Enter sends and Shift+Enter starts a line (`submit_on_enter`, off on touch). While an input
/// method has marked text nothing submits and no key reaches the screen's `on_key`. Otherwise the
/// screen's keys run first and can claim a key.
#[derive(IntoElement)]
pub struct Composer {
    id: ElementId,
    label: SharedString,
    state: Entity<TextareaState>,
    placeholder: Option<SharedString>,
    mode: ComposerMode,
    inline: bool,
    can_send: Option<bool>,
    sending: bool,
    submit_on_enter: bool,
    cap: ComposerCap,
    on_submit: Option<Action>,
    on_cancel: Option<Action>,
    on_key: Option<KeyHandler>,
    on_caret_move: Option<Action>,
    on_paste_files: Option<PasteHandler>,
    on_attach: Option<Action>,
    attach_unavailable: bool,
    on_attach_unavailable_press: Option<Action>,
    emoji: Vec<AnyElement>,
    drop_target: Option<SharedString>,
    banner: Option<ComposerBanner>,
    notice: Option<ComposerNotice>,
    attachments: Vec<AnyElement>,
    suggestions: Option<AnyElement>,
    on: Option<Surface>,
}

impl Composer {
    /// `label` names the field and is its placeholder ("Message #general"); `state` is the
    /// screen's field (a `TextareaState`; the composer sets how far it grows).
    pub fn new(
        id: impl Into<ElementId>,
        label: impl Into<SharedString>,
        state: Entity<TextareaState>,
    ) -> Self {
        Self {
            id: id.into(),
            label: label.into(),
            state,
            placeholder: None,
            mode: ComposerMode::Send,
            inline: false,
            can_send: None,
            sending: false,
            submit_on_enter: true,
            cap: ComposerCap::Desktop,
            on_submit: None,
            on_cancel: None,
            on_key: None,
            on_caret_move: None,
            on_paste_files: None,
            on_attach: None,
            attach_unavailable: false,
            on_attach_unavailable_press: None,
            emoji: Vec::new(),
            drop_target: None,
            banner: None,
            notice: None,
            attachments: Vec::new(),
            suggestions: None,
            on: None,
        }
    }

    /// A placeholder other than the label.
    pub fn placeholder(mut self, placeholder: impl Into<SharedString>) -> Self {
        self.placeholder = Some(placeholder.into());
        self
    }

    /// `Send` ("Send message", the Send icon) or `Save` ("Save changes", a check). Inline in save
    /// mode there is no trailing button but the hint line under the field.
    pub fn mode(mut self, mode: ComposerMode) -> Self {
        self.mode = mode;
        self
    }

    /// Drawn inside a message row (editing in place): no outer padding.
    pub fn inline(mut self) -> Self {
        self.inline = true;
        self
    }

    /// Whether there is something to send. Default: the text is not blank. Pass true when only
    /// attachments are queued. While false Send stays focusable but reads as unavailable.
    pub fn can_send(mut self, can_send: bool) -> Self {
        self.can_send = Some(can_send);
        self
    }

    /// A message is on its way: Send is busy and ignores presses; the field stays editable.
    pub fn sending(mut self, sending: bool) -> Self {
        self.sending = sending;
        self
    }

    /// Enter sends and Shift+Enter starts a line. Off on touch, where Enter is a new line.
    pub fn submit_on_enter(mut self, submit_on_enter: bool) -> Self {
        self.submit_on_enter = submit_on_enter;
        self
    }

    /// How far the field grows before it scrolls: 2, 4 or 10 lines.
    pub fn cap(mut self, cap: ComposerCap) -> Self {
        self.cap = cap;
        self
    }

    /// Send, or save: the trailing button, the hint's "save", or Enter. Not called while it
    /// cannot send, while sending, or while an input method has marked text.
    pub fn on_submit(mut self, handler: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_submit = Some(Rc::new(handler));
        self
    }

    /// Leaves the edit unchanged: the hint's "cancel" (inline save mode). Escape is the screen's
    /// (`on_key`).
    pub fn on_cancel(mut self, handler: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_cancel = Some(Rc::new(handler));
        self
    }

    /// The screen's own keys, called before the composer's and the field's. Return true to claim
    /// the key: nothing else happens with it. Never called while an input method has marked text.
    pub fn on_key(
        mut self,
        handler: impl Fn(ComposerKey, &mut Window, &mut App) -> bool + 'static,
    ) -> Self {
        self.on_key = Some(Rc::new(handler));
        self
    }

    /// The caret or the selection moved (typing, keys, a press): a suggestion list follows it.
    pub fn on_caret_move(mut self, handler: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_caret_move = Some(Rc::new(handler));
        self
    }

    /// Files were pasted into the field (a picture, copied files): they go to the screen, and
    /// whatever text came with them pastes as usual. A paste of files alone inserts nothing.
    pub fn on_paste_files(
        mut self,
        handler: impl Fn(Vec<PastedFile>, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.on_paste_files = Some(Rc::new(handler));
        self
    }

    /// Shows the leading attach button ("Attach a file").
    pub fn on_attach(mut self, handler: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_attach = Some(Rc::new(handler));
        self
    }

    /// The reader may not attach files here: the attach button stays named and focusable, reads
    /// as unavailable and does not call `on_attach`.
    pub fn attach_unavailable(mut self, unavailable: bool) -> Self {
        self.attach_unavailable = unavailable;
        self
    }

    /// A press on the attach button while it is unavailable (`onAttachUnavailablePress`): say why.
    pub fn on_attach_unavailable_press(
        mut self,
        handler: impl Fn(&mut Window, &mut App) + 'static,
    ) -> Self {
        self.on_attach_unavailable_press = Some(Rc::new(handler));
        self
    }

    /// The trailing slot inside the field, before Send: the emoji and GIF buttons.
    pub fn emoji(mut self, buttons: impl IntoIterator<Item = impl IntoElement>) -> Self {
        self.emoji = buttons
            .into_iter()
            .map(IntoElement::into_any_element)
            .collect();
        self
    }

    /// Files are dragged over the conversation (ChatPane's `on_files_over`): the composer is
    /// drawn as where they go, with `label` ("Drop files to attach them").
    pub fn drop_target(mut self, label: impl Into<SharedString>) -> Self {
        self.drop_target = Some(label.into());
        self
    }

    /// Replying or editing: a strip above the field with a cancel button.
    pub fn banner(mut self, banner: ComposerBanner) -> Self {
        self.banner = Some(banner);
        self
    }

    /// The reader cannot write: the notice takes the place of the field and its buttons.
    pub fn notice(mut self, notice: ComposerNotice) -> Self {
        self.notice = Some(notice);
        self
    }

    /// Files queued with the message (AttachmentTiles with `on_remove`): a tray above the field.
    pub fn attachments(mut self, tiles: impl IntoIterator<Item = impl IntoElement>) -> Self {
        self.attachments = tiles
            .into_iter()
            .map(IntoElement::into_any_element)
            .collect();
        self
    }

    /// The open suggestion list (a SuggestionList): drawn over the conversation, just above the
    /// composer, across its width. Not under a `notice`.
    pub fn suggestions(mut self, list: impl IntoElement) -> Self {
        self.suggestions = Some(list.into_any_element());
        self
    }

    pub fn on_surface(mut self, on: Surface) -> Self {
        self.on = Some(on);
        self
    }
}

/// Whether the field holds an input method's marked text (a composition not yet committed).
pub(crate) fn composing(state: &Entity<TextareaState>, window: &mut Window, cx: &mut App) -> bool {
    state
        .update(cx, |field, cx| field.marked_text_range(window, cx))
        .is_some()
}

/// What the caret watch last saw, and who to tell when it changes.
struct CaretWatch {
    /// The field's entity: a new `state` under the same composer id gets a new watch.
    field: u64,
    seen: (SharedString, Range<usize>),
    handler: Option<Action>,
    _observe: Option<Subscription>,
}

fn caret_of(state: &Entity<TextareaState>, cx: &App) -> (SharedString, Range<usize>) {
    let field = state.read(cx);
    (field.value(), field.selected_range())
}

/// Calls `handler` whenever `state`'s text or selection changes, for as long as the watch lives.
fn observe_caret(
    watch: WeakEntity<CaretWatch>,
    state: &Entity<TextareaState>,
    window: &mut Window,
    cx: &mut App,
) -> Subscription {
    window.observe(state, cx, move |field, window, cx| {
        let Some(watch) = watch.upgrade() else {
            return;
        };
        let now = caret_of(&field, cx);
        let handler = watch.update(cx, |watch: &mut CaretWatch, _| {
            (watch.seen != now).then(|| {
                watch.seen = now;
                watch.handler.clone()
            })
        });
        if let Some(Some(handler)) = handler {
            handler(window, cx);
        }
    })
}

/// Calls `handler` whenever the field's text or selection changes, for as long as the composer
/// is drawn.
fn watch_caret(
    id: &ElementId,
    state: &Entity<TextareaState>,
    handler: Option<Action>,
    window: &mut Window,
    cx: &mut App,
) {
    let watch = window.use_keyed_state(child_id(id, "caret"), cx, |window, cx| CaretWatch {
        field: state.entity_id().as_u64(),
        seen: caret_of(state, cx),
        handler: None,
        _observe: Some(observe_caret(cx.weak_entity(), state, window, cx)),
    });
    if watch.read(cx).field != state.entity_id().as_u64() {
        let observe = observe_caret(watch.downgrade(), state, window, cx);
        watch.update(cx, |watch, cx| {
            watch.field = state.entity_id().as_u64();
            watch.seen = caret_of(state, cx);
            watch._observe = Some(observe);
        });
    }
    watch.update(cx, |watch, _| watch.handler = handler);
}

/// Sets the field to grow from one line to `rows`, once per field and change of the cap.
fn apply_cap(
    id: &ElementId,
    state: &Entity<TextareaState>,
    rows: usize,
    window: &mut Window,
    cx: &mut App,
) {
    let applied = window
        .use_keyed_state(child_id(id, "rows"), cx, |_, _| {
            Rc::new(Cell::new((0u64, 0usize)))
        })
        .read(cx)
        .clone();
    let wanted = (state.entity_id().as_u64(), rows);
    if applied.replace(wanted) != wanted {
        state.update(cx, |field, cx| field.set_auto_grow(1, rows, cx));
    }
}

impl RenderOnce for Composer {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let sem = cx.sem().clone();
        let p = sem.roles;
        let on = Surface::or_current(self.on, cx);
        let inside = on.inside_fill();
        let fill = stand_out_fill(&sem, on);
        let secondary = sem.role.text_secondary;
        let state = self.state.clone();

        let root = div()
            .id(self.id.clone())
            .test_support()
            .relative()
            .flex()
            .flex_col()
            .gap(px(SPACE_SM))
            .w_full()
            .min_w_0()
            .when(!self.inline, |root| {
                root.pt(px(SPACE_SM)).px(px(SPACE_MD)).pb(px(SPACE_MD))
            });

        // The reader cannot write: the notice alone.
        if let Some(notice) = self.notice {
            return root.child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(SPACE_SM))
                    .min_h(px(CONTROL_LG))
                    .py(px(SPACE_SM))
                    .px(px(SPACE_LG))
                    .rounded(px(RADIUS_ISLAND))
                    .bg(fill)
                    .text_color(secondary)
                    .child(
                        Icon::lounge(notice.icon)
                            .size(ICON_MD)
                            .color(secondary)
                            .into_any_element(),
                    )
                    .child(
                        type_text(TEXT_BODY, notice.text.clone())
                            .id(child_id(&self.id, "notice"))
                            .test_support()
                            .role(Role::Status)
                            .aria_label(notice.text)
                            .flex_1()
                            .min_w_0(),
                    ),
            );
        }

        apply_cap(&self.id, &state, cap_rows(self.cap), window, cx);
        watch_caret(&self.id, &state, self.on_caret_move.clone(), window, cx);

        let value = state.read(cx).value();
        let can_send = self.can_send;
        let sendable = can_send.unwrap_or_else(|| has_text_to_send(&value));
        let sending = self.sending;
        let submit: Action = {
            let state = state.clone();
            let on_submit = self.on_submit.clone();
            Rc::new(move |window, cx| {
                let sendable =
                    can_send.unwrap_or_else(|| has_text_to_send(&state.read(cx).value()));
                if !sendable || sending || composing(&state, window, cx) {
                    return;
                }
                if let Some(on_submit) = &on_submit {
                    on_submit(window, cx);
                }
            })
        };
        // An edit in place has no Save button: the hint under the field saves and cancels.
        let hinted = self.inline && self.mode == ComposerMode::Save;

        // The screen's keys first, then the composer's; neither while an input method composes.
        let screen_key = {
            let state = state.clone();
            let on_key = self.on_key.clone();
            move |key: ComposerKey, window: &mut Window, cx: &mut App| -> Option<bool> {
                if composing(&state, window, cx) {
                    return None;
                }
                let claimed = on_key
                    .as_ref()
                    .is_some_and(|on_key| on_key(key, window, cx));
                if claimed {
                    cx.stop_propagation();
                }
                Some(claimed)
            }
        };
        let submit_on_enter = self.submit_on_enter;
        let on_enter = {
            let screen_key = screen_key.clone();
            let submit = submit.clone();
            move |action: &Enter, window: &mut Window, cx: &mut App| {
                match screen_key(
                    ComposerKey::Enter {
                        shift: action.shift,
                    },
                    window,
                    cx,
                ) {
                    // The input method owns this Enter: take it so the field cannot put a line
                    // over the marked text, and nothing submits.
                    None => {
                        if submit_on_enter {
                            cx.stop_propagation();
                        }
                    }
                    Some(true) => {}
                    Some(false) => {
                        if submit_on_enter && !action.shift {
                            // Enter sends and never makes a line, even when there is nothing to
                            // send.
                            cx.stop_propagation();
                            submit(window, cx);
                        }
                    }
                }
            }
        };
        let plain = |key: ComposerKey| {
            let screen_key = screen_key.clone();
            move |window: &mut Window, cx: &mut App| {
                screen_key(key, window, cx);
            }
        };
        let (up, down, tab, escape) = (
            plain(ComposerKey::Up),
            plain(ComposerKey::Down),
            plain(ComposerKey::Tab),
            plain(ComposerKey::Escape),
        );

        let focus = state.read(cx).focus_handle(cx);
        let ring = shows_focus(&focus, window);
        let empty = value.is_empty();
        let placeholder = self.placeholder.unwrap_or_else(|| self.label.clone());
        // The text sits centred on the in-field buttons at one line; the Textarea's own padding
        // at its smallest size is taken out of the frame's.
        let pad_y = px((CONTROL_MD - TEXT_BODY.line_height) / 2.);
        let pad_x = px(SPACE_SM) - Size::XSmall.input_px();
        let on_paste_files = self.on_paste_files.clone();
        let field = div()
            .relative()
            .flex_1()
            .min_w_0()
            .py(pad_y)
            .px(pad_x)
            .text_color(sem.role.text)
            .child(
                Textarea::new(&state)
                    .with_size(Size::XSmall)
                    .appearance(false)
                    .bordered(false)
                    .text_size(px(TEXT_BODY.size))
                    .line_height(px(TEXT_BODY.line_height))
                    .font_family(TEXT_BODY.family)
                    .aria_label(self.label.clone())
                    .when_some(on_paste_files, |field, on_paste_files| {
                        field.on_paste(move |item, window, cx| {
                            let files = pasted_files(item);
                            if files.is_empty() {
                                return false;
                            }
                            let text = item.text().is_some();
                            on_paste_files(files, window, cx);
                            // Text that came with the files still pastes.
                            !text
                        })
                    }),
            )
            .children(empty.then(|| {
                one_line(TEXT_BODY, placeholder)
                    .absolute()
                    .top(pad_y)
                    .left(px(SPACE_SM))
                    .right(px(SPACE_SM))
                    .text_color(sem.role.text_dim)
            }))
            // The field's own keys, on its box: another text field in the emoji or the attach
            // slot (a popover's search) is not under this and keeps them.
            .capture_action(move |action: &Enter, window, cx| on_enter(action, window, cx))
            .capture_action(move |_: &MoveUp, window, cx| up(window, cx))
            .capture_action(move |_: &MoveDown, window, cx| down(window, cx))
            .capture_action(move |_: &IndentInline, window, cx| tab(window, cx))
            .capture_action(move |_: &Escape, window, cx| escape(window, cx));

        let attach = self.on_attach.map(|on_attach| {
            let unavailable = self.attach_unavailable;
            let why = self.on_attach_unavailable_press.clone();
            IconButton::new(child_id(&self.id, "attach"), I::AttachFile, "Attach a file")
                .lounge_icon(LoungeIcon::Paperclip)
                .variant(IconButtonVariant::Soft)
                .unavailable(unavailable)
                .on_surface(inside)
                .on_click(move |_, window, cx| {
                    if !unavailable {
                        on_attach(window, cx);
                    }
                })
                .when_some(why, |button, why| {
                    button.on_unavailable_press(move |_, window, cx| why(window, cx))
                })
        });
        let field_box = div()
            .id(child_id(&self.id, "field"))
            .test_support()
            .relative()
            .flex_1()
            .min_w_0()
            .flex()
            .items_end()
            .gap(px(SPACE_XS))
            .min_h(px(CONTROL_LG))
            .p(px(SPACE_XS))
            .rounded(px(RADIUS_ISLAND))
            .bg(fill)
            .cursor_text()
            .on_click({
                let state = state.clone();
                move |_, window, cx| state.update(cx, |field, cx| field.focus(window, cx))
            })
            .children(attach)
            .child(field)
            .child(SurfaceScope::new(
                inside,
                div()
                    .flex()
                    .items_center()
                    .gap(px(SPACE_XS))
                    .children(self.emoji),
            ))
            .when(ring, |field_box| {
                field_box.child(focus_ring(&p, RADIUS_ISLAND, 0.))
            });

        let send = (!hinted).then(|| {
            let submit = submit.clone();
            let (icon, lounge) = match self.mode {
                ComposerMode::Send => (I::Send, LoungeIcon::Send),
                ComposerMode::Save => (I::Check, LoungeIcon::Check),
            };
            IconButton::new(child_id(&self.id, "submit"), icon, submit_label(self.mode))
                .lounge_icon(lounge)
                .variant(IconButtonVariant::Primary)
                .size(ControlSize::Lg)
                .unavailable(!sendable)
                .loading(sending)
                .on_surface(on)
                .on_click(move |_, window, cx| submit(window, cx))
        });

        let hint = hinted.then(|| {
            let words = |text: &'static str| type_text(TEXT_SMALL, text);
            let submit = submit.clone();
            div()
                .flex()
                .flex_wrap()
                .items_center()
                .gap_x(px(SPACE_XS))
                .min_w_0()
                .text_color(secondary)
                .when_some(self.on_cancel, |hint, on_cancel| {
                    hint.when(submit_on_enter, |hint| hint.child(words("escape to")))
                        .child(
                            Button::new(
                                child_id(&self.id, "hint-cancel"),
                                if submit_on_enter { "cancel" } else { "Cancel" },
                            )
                            .text()
                            .size(ControlSize::Sm)
                            .accessibility_label("Cancel editing")
                            .on_click(move |_, window, cx| on_cancel(window, cx)),
                        )
                        .child(words("•"))
                })
                .when(submit_on_enter, |hint| hint.child(words("enter to")))
                .child(
                    Button::new(
                        child_id(&self.id, "hint-save"),
                        if submit_on_enter { "save" } else { "Save" },
                    )
                    .text()
                    .size(ControlSize::Sm)
                    .accessibility_label(submit_label(ComposerMode::Save))
                    .loading(sending)
                    .unavailable(!sendable)
                    .on_click(move |_, window, cx| submit(window, cx)),
                )
        });

        let banner = self.banner.map(|banner| {
            let on_cancel = banner.on_cancel;
            div()
                .flex()
                .items_center()
                .gap(px(SPACE_SM))
                .min_w_0()
                .min_h(px(CONTROL_LG))
                .pt(px(SPACE_XS))
                .pr(px(SPACE_XS))
                .pb(px(SPACE_XS))
                .pl(px(SPACE_MD))
                .rounded(px(RADIUS_CARD))
                .bg(fill)
                .text_color(secondary)
                .child(
                    Icon::lounge(match banner.kind {
                        BannerKind::Reply => LoungeIcon::Reply,
                        BannerKind::Editing => LoungeIcon::Pencil,
                    })
                    .size(IconSize::Sm.px())
                    .color(secondary)
                    .into_any_element(),
                )
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .flex()
                        .flex_col()
                        .child(
                            one_line(TEXT_META, banner.title)
                                .font_weight(FontWeight(f32::from(TEXT_BODY_STRONG.weight)))
                                .text_color(sem.role.text),
                        )
                        .children(banner.detail.map(|detail| one_line(TEXT_META, detail))),
                )
                .child(
                    IconButton::new(
                        child_id(&self.id, "banner-cancel"),
                        I::Close,
                        banner.cancel_label,
                    )
                    .lounge_icon(LoungeIcon::X)
                    .small()
                    .on_surface(inside)
                    .on_click(move |_, window, cx| on_cancel(window, cx)),
                )
        });

        let tray = (!self.attachments.is_empty()).then(|| {
            div()
                .flex()
                .flex_wrap()
                .gap(px(SPACE_SM))
                .min_w_0()
                .children(self.attachments)
        });

        let above = self.suggestions.map(|list| {
            div()
                .absolute()
                .bottom(relative(1.))
                .left(px(if self.inline { 0. } else { SPACE_MD }))
                .right(px(if self.inline { 0. } else { SPACE_MD }))
                .child(list)
        });

        let drop = self.drop_target.map(|label| {
            div()
                .absolute()
                .inset_0()
                .flex()
                .items_center()
                .justify_center()
                .gap(px(SPACE_SM))
                .rounded(px(RADIUS_ISLAND))
                .border(px(BORDER_SELECTED))
                .border_dashed()
                .border_color(sem.role.accent)
                .bg(sem.role.surface)
                .text_color(sem.role.text)
                .child(
                    Icon::lounge(LoungeIcon::Paperclip)
                        .size(ICON_MD)
                        .color(secondary)
                        .into_any_element(),
                )
                .child(
                    type_text(TEXT_BODY_STRONG, label.clone())
                        .id(child_id(&self.id, "drop"))
                        .test_support()
                        .aria_label(label),
                )
        });

        root.children(banner)
            .children(tray)
            .child(
                div()
                    .flex()
                    .items_end()
                    .gap(px(SPACE_SM))
                    .min_w_0()
                    .child(field_box)
                    .children(send),
            )
            .children(hint)
            .children(above)
            .children(drop)
    }
}
