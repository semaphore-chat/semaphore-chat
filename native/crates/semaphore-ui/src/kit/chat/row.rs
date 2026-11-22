//! `MessageRow`: one message in a compact list (`frontend/src/kit/chat/MessageRow.tsx`).

use super::reaction::is_context_menu_key;
use super::tab_scope::RowTabScope;
use super::{child_id, one_line};
use crate::kit::controls::Button;
use crate::kit::look::{ControlSize, focus_handle, focus_ring, shows_focus};
use crate::kit::surface::{Surface, SurfaceScope, tint_base_token};
use crate::kit::{Avatar, AvatarSize, Icon, ValueAction, with_tip};
use crate::theme::SemTheme;
use crate::theme::color::{blend, hsla_of};
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_design::lounge::{
    AVATAR_MD, BORDER_FOCUS, BORDER_HAIRLINE, BORDER_SELECTED, ICON_XS, RADIUS_FULL, RADIUS_MD,
    SPACE_2XS, SPACE_MD, SPACE_SM, SPACE_XS, STATE_DISABLED, STATE_HOVER, STATE_HOVER_ON_FILL,
    STATE_PRESSED, TEXT_BODY, TEXT_NAME, TEXT_SMALL,
};
use semaphore_design::{LoungeIcon, Rgba};
use std::cell::Cell;
use std::rc::Rc;

/// Where a message is on its way.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum MessageState {
    #[default]
    Sent,
    /// On its way: dimmed, "Sending…".
    Pending,
    /// Not sent: the reason, with Retry and Delete when given.
    Failed,
}

/// How the actions were asked for, and where: the screen picks a Menu at the cursor or anchored
/// to the row. `Touch` is the web's long press; the desktop never sends it.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum OpenActionsRequest {
    Touch {
        position: Point<Pixels>,
    },
    /// A right-click, at this window position.
    Pointer {
        position: Point<Pixels>,
    },
    /// Enter, the Menu key or Shift+F10 on the row: anchor the menu to the row.
    Keyboard,
}

/// What the message list's roving focus gives a row: its focus handle, and whether it is the
/// list's one Tab stop. The list owns which row that is and moves focus between rows.
#[derive(Clone)]
pub struct RowFocus {
    pub handle: FocusHandle,
    pub tab_stop: bool,
}

/// One message in a compact list: the author's avatar, name and time on one line, the words under
/// it, no bubble. Slots for a quote, the body, attachments, reactions and a thread footer, and a
/// toolbar that shows on hover and while focus is in the row. A `continued` row is a follow-on
/// from the same author.
#[derive(IntoElement)]
pub struct MessageRow {
    id: ElementId,
    author: SharedString,
    time: SharedString,
    time_label: Option<SharedString>,
    avatar: Option<ImageSource>,
    avatar_colour: Option<Rgba>,
    continued: bool,
    mentioned: bool,
    highlighted: bool,
    state: MessageState,
    failed_reason: Option<SharedString>,
    retrying: bool,
    edited: bool,
    pinned: bool,
    quote: Option<AnyElement>,
    body: Option<AnyElement>,
    attachments: Option<AnyElement>,
    reactions: Vec<AnyElement>,
    footer: Option<AnyElement>,
    actions: Vec<AnyElement>,
    on_open_actions: Option<ValueAction<OpenActionsRequest>>,
    on_open_author: Option<crate::kit::Action>,
    on_retry: Option<crate::kit::Action>,
    on_delete: Option<crate::kit::Action>,
    focus: Option<RowFocus>,
    on: Option<Surface>,
}

impl MessageRow {
    /// `time` is the short time shown ("8:19 PM").
    pub fn new(
        id: impl Into<ElementId>,
        author: impl Into<SharedString>,
        time: impl Into<SharedString>,
    ) -> Self {
        Self {
            id: id.into(),
            author: author.into(),
            time: time.into(),
            time_label: None,
            avatar: None,
            avatar_colour: None,
            continued: false,
            mentioned: false,
            highlighted: false,
            state: MessageState::Sent,
            failed_reason: None,
            retrying: false,
            edited: false,
            pinned: false,
            quote: None,
            body: None,
            attachments: None,
            reactions: Vec::new(),
            footer: None,
            actions: Vec::new(),
            on_open_actions: None,
            on_open_author: None,
            on_retry: None,
            on_delete: None,
            focus: None,
            on: None,
        }
    }

    /// The full date and time, read after the short one: "Monday 3 March 2026, 8:19 PM".
    pub fn time_label(mut self, label: impl Into<SharedString>) -> Self {
        self.time_label = Some(label.into());
        self
    }

    pub fn avatar(mut self, image: ImageSource) -> Self {
        self.avatar = Some(image);
        self
    }

    /// The author's own colour, for the avatar.
    pub fn avatar_colour(mut self, colour: Rgba) -> Self {
        self.avatar_colour = Some(colour);
        self
    }

    /// A follow-on from the same author: no avatar or name line; the short time shows in the
    /// gutter on hover and while focus is in the row.
    pub fn continued(mut self, continued: bool) -> Self {
        self.continued = continued;
        self
    }

    /// It mentions the reader: an accent rail and tint.
    pub fn mentioned(mut self, mentioned: bool) -> Self {
        self.mentioned = mentioned;
        self
    }

    /// The jump target: a stronger accent tint while set.
    pub fn highlighted(mut self, highlighted: bool) -> Self {
        self.highlighted = highlighted;
        self
    }

    pub fn state(mut self, state: MessageState) -> Self {
        self.state = state;
        self
    }

    /// Why a failed message was not sent, in place of "Not sent".
    pub fn failed_reason(mut self, reason: impl Into<SharedString>) -> Self {
        self.failed_reason = Some(reason.into());
        self
    }

    /// A retry is on its way: Retry is busy and ignores presses.
    pub fn retrying(mut self, retrying: bool) -> Self {
        self.retrying = retrying;
        self
    }

    pub fn edited(mut self, edited: bool) -> Self {
        self.edited = edited;
        self
    }

    pub fn pinned(mut self, pinned: bool) -> Self {
        self.pinned = pinned;
        self
    }

    pub fn quote(mut self, quote: impl IntoElement) -> Self {
        self.quote = Some(quote.into_any_element());
        self
    }

    /// The words: a MessageText (or, from part 3, an inline Composer to edit).
    pub fn body(mut self, body: impl IntoElement) -> Self {
        self.body = Some(body.into_any_element());
        self
    }

    pub fn attachments(mut self, attachments: impl IntoElement) -> Self {
        self.attachments = Some(attachments.into_any_element());
        self
    }

    /// ReactionChips; they wrap onto more lines.
    pub fn reactions(mut self, reactions: impl IntoIterator<Item = impl IntoElement>) -> Self {
        self.reactions = reactions
            .into_iter()
            .map(IntoElement::into_any_element)
            .collect();
        self
    }

    /// Under everything: the thread replies link.
    pub fn footer(mut self, footer: impl IntoElement) -> Self {
        self.footer = Some(footer.into_any_element());
        self
    }

    /// The hover and focus toolbar's IconButtons. Hidden, it is not drawn at all, so Tab does not
    /// walk the toolbars of other rows.
    pub fn actions(mut self, actions: impl IntoIterator<Item = impl IntoElement>) -> Self {
        self.actions = actions
            .into_iter()
            .map(IntoElement::into_any_element)
            .collect();
        self
    }

    /// The row's actions were asked for: a right-click, or Enter, the Menu key or Shift+F10 on the
    /// row itself.
    pub fn on_open_actions(
        mut self,
        handler: impl Fn(OpenActionsRequest, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.on_open_actions = Some(Rc::new(handler));
        self
    }

    /// The name (and the avatar, for the pointer) opens the author's profile.
    pub fn on_open_author(mut self, handler: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_open_author = Some(Rc::new(handler));
        self
    }

    pub fn on_retry(mut self, handler: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_retry = Some(Rc::new(handler));
        self
    }

    pub fn on_delete(mut self, handler: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_delete = Some(Rc::new(handler));
        self
    }

    /// The list's roving focus.
    pub fn focus(mut self, focus: RowFocus) -> Self {
        self.focus = Some(focus);
        self
    }

    pub fn on_surface(mut self, on: Surface) -> Self {
        self.on = Some(on);
        self
    }
}

/// The row's accessible name: who wrote it and when, on a continued row too.
pub(crate) fn row_name(author: &str, time: &str, time_label: Option<&str>) -> String {
    match time_label {
        Some(label) => format!("{author}, {time}, {label}"),
        None => format!("{author}, {time}"),
    }
}

/// Whether a key on the row itself asks for its actions: Enter (no modifiers, not held), the Menu
/// key or Shift+F10.
pub(crate) fn asks_for_actions(event: &KeyDownEvent) -> bool {
    let keystroke = &event.keystroke;
    let m = keystroke.modifiers;
    let plain_enter = keystroke.key == "enter"
        && !m.shift
        && !m.alt
        && !m.control
        && !m.platform
        && !event.is_held;
    plain_enter || is_context_menu_key(keystroke)
}

impl RenderOnce for MessageRow {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let sem = cx.sem().clone();
        let p = sem.roles;
        let on = Surface::or_current(self.on, cx);
        let under = tint_base_token(&p, on);
        let rest = if self.highlighted {
            Some(hsla_of(blend(p.accent, under, STATE_HOVER_ON_FILL)))
        } else if self.mentioned {
            Some(hsla_of(blend(p.accent, under, STATE_PRESSED)))
        } else {
            None
        };
        let hover = rest.unwrap_or_else(|| hsla_of(blend(p.text, under, STATE_HOVER)));

        // The row's own handle: the list's when it joins roving focus. A lone row takes no focus.
        let joins_list = self.focus.is_some();
        let handle = self.focus.as_ref().map(|focus| focus.handle.clone());
        let tab_stop = self.focus.as_ref().is_some_and(|focus| focus.tab_stop);
        let focus_within = handle
            .as_ref()
            .is_some_and(|handle| handle.contains_focused(window, cx));
        let ring = handle
            .as_ref()
            .is_some_and(|handle| shows_focus(handle, window));
        let hovered = window
            .use_keyed_state(child_id(&self.id, "hovered"), cx, |_, _| {
                Rc::new(Cell::new(false))
            })
            .read(cx)
            .clone();
        // The quiet parts (toolbar, a continued row's gutter time) show on hover and focus.
        let toolbar_hovered = window
            .use_keyed_state(child_id(&self.id, "toolbar-hovered"), cx, |_, _| {
                Rc::new(Cell::new(false))
            })
            .read(cx)
            .clone();
        let revealed = hovered.get() || toolbar_hovered.get() || focus_within;
        // Its controls are Tab stops in the list's Tab stop row and in a row focus is in.
        let tab_active = !joins_list || tab_stop || focus_within;

        let pending = self.state == MessageState::Pending;
        let failed = self.state == MessageState::Failed;
        let secondary = sem.role.text_secondary;
        let meta = |text: &'static str| {
            one_line(TEXT_SMALL, text)
                .flex_shrink_0()
                .text_color(secondary)
        };
        let mut marks: Vec<AnyElement> = Vec::new();
        if self.edited {
            marks.push(meta("(edited)").into_any_element());
        }
        if self.pinned {
            marks.push(
                div()
                    .id(child_id(&self.id, "pinned"))
                    .test_support()
                    .role(Role::Image)
                    .aria_label("Pinned")
                    .flex_shrink_0()
                    .child(Icon::lounge(LoungeIcon::Pin).size(ICON_XS).color(secondary))
                    .into_any_element(),
            );
        }
        if pending {
            marks.push(meta("Sending…").into_any_element());
        }

        let avatar = || {
            Avatar::new(self.author.clone())
                .size(AvatarSize::Md)
                .decorative(true)
                .image(self.avatar.clone())
                .colour(self.avatar_colour)
        };
        let gutter = div()
            .flex_none()
            .w(px(AVATAR_MD))
            .flex()
            .justify_end()
            .child(if self.continued {
                // Centred on the first body line.
                div()
                    .pt(px((TEXT_BODY.line_height - TEXT_SMALL.line_height) / 2.))
                    .when(!revealed, |time| time.invisible())
                    .child(timed(
                        &self.id,
                        &self.time,
                        self.time_label.as_ref(),
                        secondary,
                    ))
                    .into_any_element()
            } else if let Some(open) = self.on_open_author.clone() {
                // A pointer shortcut to the name's place; not a Tab stop of its own.
                div()
                    .id(child_id(&self.id, "avatar"))
                    .test_support()
                    .cursor_pointer()
                    .rounded(px(RADIUS_FULL))
                    .on_click(move |_, window, cx| open(window, cx))
                    .child(avatar())
                    .into_any_element()
            } else {
                avatar().into_any_element()
            });

        let name: AnyElement = match self.on_open_author.clone() {
            Some(open) => {
                let name_id = child_id(&self.id, "name");
                let name_focus = focus_handle(&name_id, window, cx);
                let name_ring = shows_focus(&name_focus, window);
                base::Button::new(name_id)
                    .track_focus(&name_focus)
                    .when(!tab_active, |name| name.tab_stop(false))
                    .accessibility_label(self.author.clone())
                    .relative()
                    .min_w_0()
                    .flex_shrink(1.)
                    .justify_start()
                    .cursor_pointer()
                    .rounded(px(semaphore_design::lounge::RADIUS_SM))
                    .hover(|style| style.underline())
                    .on_click(move |_, window, cx| open(window, cx))
                    .child(one_line(TEXT_NAME, self.author.clone()))
                    .when(name_ring, |name| {
                        name.child(focus_ring(&p, semaphore_design::lounge::RADIUS_SM, 0.))
                    })
                    .into_any_element()
            }
            None => one_line(TEXT_NAME, self.author.clone())
                .flex_shrink(1.)
                .into_any_element(),
        };

        let header = (!self.continued).then(|| {
            div()
                .flex()
                .items_baseline()
                .gap(px(SPACE_SM))
                .min_w_0()
                .child(name)
                .child(timed(
                    &self.id,
                    &self.time,
                    self.time_label.as_ref(),
                    secondary,
                ))
                .children(std::mem::take(&mut marks))
        });
        let continued_marks = (self.continued && !marks.is_empty()).then(|| {
            div()
                .flex()
                .items_baseline()
                .gap(px(SPACE_SM))
                .children(marks)
        });

        let failed_line = failed.then(|| {
            let reason = self
                .failed_reason
                .clone()
                .unwrap_or_else(|| SharedString::from("Not sent"));
            div()
                .flex()
                .flex_wrap()
                .items_center()
                .gap(px(SPACE_SM))
                .child(
                    div()
                        .id(child_id(&self.id, "failed"))
                        .test_support()
                        .role(Role::Alert)
                        .aria_label(reason.clone())
                        .flex()
                        .items_start()
                        .gap(px(SPACE_XS))
                        .min_w_0()
                        .text_color(sem.role.danger)
                        .child(
                            div()
                                .flex_none()
                                .pt(px((TEXT_SMALL.line_height - ICON_XS) / 2.))
                                .child(
                                    Icon::lounge(LoungeIcon::CircleAlert)
                                        .size(ICON_XS)
                                        .color(sem.role.danger),
                                ),
                        )
                        .child(crate::kit::overlays::type_text(TEXT_SMALL, reason).min_w_0()),
                )
                .children(self.on_retry.clone().map(|retry| {
                    Button::new(child_id(&self.id, "retry"), "Retry")
                        .text()
                        .size(ControlSize::Sm)
                        .loading(self.retrying)
                        .on_click(move |_, window, cx| retry(window, cx))
                }))
                .children(self.on_delete.clone().map(|delete| {
                    Button::new(child_id(&self.id, "delete"), "Delete")
                        .quiet_danger()
                        .size(ControlSize::Sm)
                        .on_click(move |_, window, cx| delete(window, cx))
                }))
        });

        let slot = |content: AnyElement| div().flex().min_w_0().child(content);
        let column = div()
            .flex_1()
            .min_w_0()
            .flex()
            .flex_col()
            .gap(px(SPACE_2XS))
            .children(header)
            .children(continued_marks)
            .children(self.quote.map(slot))
            .children(self.body.map(slot))
            .children(self.attachments.map(slot))
            .children(failed_line)
            .when(!self.reactions.is_empty(), |column| {
                column.child(
                    div()
                        .flex()
                        .flex_wrap()
                        .gap(px(SPACE_XS))
                        .mt(px(SPACE_XS))
                        .children(self.reactions),
                )
            })
            .children(self.footer.map(slot));

        let toolbar = (!self.actions.is_empty() && revealed).then(|| {
            div()
                .id(child_id(&self.id, "toolbar"))
                .test_support()
                .role(Role::Toolbar)
                .aria_label(format!("Actions for {}'s message", self.author))
                .absolute()
                .occlude()
                .on_hover(move |is_hovered, window, _| {
                    if toolbar_hovered.replace(*is_hovered) != *is_hovered {
                        window.refresh();
                    }
                })
                .top(px(-SPACE_MD))
                .right(px(SPACE_MD))
                .flex()
                .gap(px(SPACE_2XS))
                .p(px(SPACE_2XS))
                .rounded(px(RADIUS_FULL))
                .bg(sem.role.surface)
                .border(px(BORDER_HAIRLINE))
                .border_color(sem.role.hairline)
                .child(SurfaceScope::new(
                    Surface::Surface,
                    div().flex().gap(px(SPACE_2XS)).children(self.actions),
                ))
        });

        let on_open_actions = self.on_open_actions;
        let keys_handle = handle.clone();
        let row = div()
            .id(self.id.clone())
            .test_support()
            .role(Role::Article)
            .aria_label(row_name(
                &self.author,
                &self.time,
                self.time_label.as_deref(),
            ))
            .when(pending, |row| row.aria_description("busy"))
            .when_some(handle.clone(), |row, handle| {
                row.track_focus(&handle.tab_stop(tab_stop))
            })
            .relative()
            .flex()
            .gap(px(SPACE_MD))
            .min_w_0()
            .w_full()
            .pt(px(if self.continued { SPACE_2XS } else { SPACE_SM }))
            .px(px(SPACE_MD))
            .pb(px(SPACE_2XS))
            .rounded(px(RADIUS_MD))
            .when_some(rest, |row, rest| row.bg(rest))
            .hover(move |style| style.bg(hover))
            .on_hover(move |is_hovered, window, _| {
                if hovered.replace(*is_hovered) != *is_hovered {
                    window.refresh();
                }
            })
            .when(self.mentioned, |row| {
                row.child(
                    div()
                        .absolute()
                        .left_0()
                        .top_0()
                        .bottom_0()
                        .w(px(BORDER_SELECTED))
                        .rounded_l(px(RADIUS_MD))
                        .bg(sem.role.accent),
                )
            })
            .when_some(on_open_actions.clone(), |row, open| {
                row.on_mouse_down(MouseButton::Right, move |event, window, cx| {
                    cx.stop_propagation();
                    open(
                        OpenActionsRequest::Pointer {
                            position: event.position,
                        },
                        window,
                        cx,
                    );
                })
            })
            .when_some(
                on_open_actions.zip(keys_handle),
                |row, (open, keys_handle)| {
                    row.on_key_down(move |event, window, cx| {
                        // Only on the row itself: Enter on a control inside is that control's.
                        if keys_handle.is_focused(window) && asks_for_actions(event) {
                            cx.stop_propagation();
                            open(OpenActionsRequest::Keyboard, window, cx);
                        }
                    })
                },
            )
            .child(gutter)
            .child(div().flex_1().min_w_0().flex().child(if pending {
                column.opacity(STATE_DISABLED)
            } else {
                column
            }))
            .children(toolbar)
            .when(ring, |row| {
                row.child(focus_ring(&p, RADIUS_MD, -BORDER_FOCUS))
            });
        RowTabScope::new(tab_active, row)
    }
}

/// The time, with the full date as its tooltip when the row has one.
fn timed(
    row: &ElementId,
    time: &SharedString,
    label: Option<&SharedString>,
    colour: Hsla,
) -> AnyElement {
    let text = one_line(TEXT_SMALL, time.clone())
        .flex_shrink_0()
        .text_color(colour);
    match label {
        Some(label) => with_tip(text.id(child_id(row, "time")).test_support(), label.clone())
            .into_any_element(),
        None => text.into_any_element(),
    }
}
