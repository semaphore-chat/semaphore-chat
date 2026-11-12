//! What the roles views are drawn with: cards, rows, the reason a control is off, the confirm
//! dialog, loading rows and a user's line.

use crate::dms::face::user_face;
use crate::kit::{
    Alert, Button, ButtonTone, Dialog, IconButton, Severity, Skeleton, Variant, spacing, text,
    with_tip,
};
use crate::panel::common::design_icon;
use crate::theme::SemTheme;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{ErrorView, UserView};
use semaphore_design::Icon as DesignIcon;
use std::rc::Rc;

pub(super) type Observed = gpui_kit::base::ObservedElement<Stateful<Div>>;

pub(super) fn phone(window: &Window) -> bool {
    crate::panel::common::is_phone(window)
}

/// MUI's `Card` with a title: one section.
pub(super) fn card(title: impl Into<SharedString>, body: impl IntoElement, cx: &App) -> Div {
    let sem = cx.sem();
    div()
        .w_full()
        .flex()
        .flex_col()
        .rounded(px(8.))
        .border_1()
        .border_color(sem.divider)
        .bg(sem.paper)
        .child(
            div()
                .px(spacing(2.))
                .py(spacing(1.5))
                .border_b_1()
                .border_color(sem.divider)
                .child(text(Variant::Subtitle1, title).text_color(sem.text_primary)),
        )
        .child(
            div()
                .p(spacing(2.))
                .flex()
                .flex_col()
                .gap(spacing(1.))
                .child(body),
        )
}

/// A list row with the web's divider border.
pub(super) fn row(id: impl Into<ElementId>, label: impl Into<SharedString>, cx: &App) -> Observed {
    let sem = cx.sem();
    div()
        .id(id)
        .test_support()
        .role(Role::ListItem)
        .aria_label(label.into())
        .w_full()
        .flex()
        .gap(spacing(1.5))
        .px(spacing(1.5))
        .py(spacing(1.))
        .rounded(px(4.))
        .border_1()
        .border_color(sem.divider)
}

pub(super) fn list(id: impl Into<ElementId>, label: impl Into<SharedString>) -> Observed {
    div()
        .id(id)
        .test_support()
        .role(Role::List)
        .aria_label(label.into())
        .w_full()
        .flex()
        .flex_col()
        .gap(spacing(1.))
}

/// Why something is off: a lock and the reason, where a tooltip wouldn't reach a phone.
pub(super) fn locked_note(
    id: impl Into<ElementId>,
    reason: impl Into<SharedString>,
    cx: &App,
) -> Observed {
    let sem = cx.sem();
    let reason = reason.into();
    div()
        .id(id)
        .test_support()
        .role(Role::Note)
        .aria_label(reason.clone())
        .flex()
        .items_center()
        .gap(spacing(1.))
        .child(design_icon(
            DesignIcon::LockOutlined,
            16.,
            sem.text_secondary,
        ))
        .child(
            text(Variant::Caption, reason)
                .flex_1()
                .min_w_0()
                .text_color(sem.text_secondary),
        )
}

/// An icon button, off with its reason as a tooltip when `locked` says why.
pub(super) fn action_icon(
    id: impl Into<SharedString>,
    icon: DesignIcon,
    label: impl Into<SharedString>,
    locked: Option<String>,
    color: Option<Hsla>,
    on_click: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
) -> AnyElement {
    let id = id.into();
    let disabled = locked.is_some();
    let mut button = IconButton::new(id.clone(), icon, label.into())
        .small()
        .disabled(disabled);
    if let Some(color) = color.filter(|_| !disabled) {
        button = button.color(color);
    }
    if !disabled {
        button = button.on_click(on_click);
    }
    match locked {
        Some(reason) => with_tip(div().id(SharedString::from(format!("{id}-locked"))), reason)
            .test_support()
            .child(button)
            .into_any_element(),
        None => button.into_any_element(),
    }
}

/// A button that is off with its reason under it, when `locked` says why.
pub(super) fn locked_button(
    button: Button,
    id: impl Into<ElementId>,
    locked: Option<String>,
    narrow: bool,
    cx: &App,
) -> AnyElement {
    match locked {
        None => button.into_any_element(),
        Some(reason) => div()
            .flex()
            .flex_col()
            .when(narrow, |c| c.items_start())
            .when(!narrow, |c| c.items_end())
            .gap(px(4.))
            .child(button.disabled(true))
            .child(locked_note(id, reason, cx).max_w(px(280.)))
            .into_any_element(),
    }
}

/// The server's message for the last change.
pub(super) fn server_error(error: Option<&ErrorView>) -> Option<Alert> {
    error.map(|error| Alert::new(Severity::Error, error.message.clone()))
}

/// The web's `ConfirmDialog`: a sentence, Cancel, and the action (red when `danger`).
pub(super) struct Confirm {
    pub id: &'static str,
    pub title: String,
    pub message: String,
    pub confirm: &'static str,
    pub danger: bool,
    pub busy: bool,
    pub error: Option<ErrorView>,
}

impl Confirm {
    pub fn dialog(
        self,
        on_confirm: impl Fn(&mut Window, &mut App) + 'static,
        on_cancel: impl Fn(&mut Window, &mut App) + 'static,
    ) -> Dialog {
        let on_cancel = Rc::new(on_cancel);
        let close = on_cancel.clone();
        let confirm = if self.danger {
            Button::new(
                SharedString::from(format!("{}-confirm", self.id)),
                self.confirm,
            )
            .contained()
            .tone(ButtonTone::Danger)
        } else {
            Button::new(
                SharedString::from(format!("{}-confirm", self.id)),
                self.confirm,
            )
            .contained()
        };
        Dialog::new(self.title)
            .body(
                div()
                    .flex()
                    .flex_col()
                    .gap(spacing(1.5))
                    .children(server_error(self.error.as_ref()))
                    .child(text(Variant::Body2, self.message)),
            )
            .action(
                Button::new(SharedString::from(format!("{}-cancel", self.id)), "Cancel")
                    .disabled(self.busy)
                    .on_click(move |_, window, cx| on_cancel(window, cx)),
            )
            .action(
                confirm
                    .loading(self.busy)
                    .on_click(move |_, window, cx| on_confirm(window, cx)),
            )
            .on_close(move |window, cx| close(window, cx))
    }
}

/// Skeleton rows while a list loads.
pub(super) fn loading_rows(id: &'static str, label: &'static str, rows: usize) -> AnyElement {
    div()
        .id(id)
        .test_support()
        .role(Role::ProgressIndicator)
        .aria_label(label)
        .flex()
        .flex_col()
        .gap(spacing(1.))
        .children((0..rows).map(|index| {
            div()
                .flex()
                .items_center()
                .gap(spacing(2.))
                .px(spacing(1.5))
                .py(spacing(1.))
                .child(Skeleton::rect((id, index * 2), px(24.), 24.))
                .child(
                    div()
                        .flex_1()
                        .flex()
                        .flex_col()
                        .gap(px(6.))
                        .child(Skeleton::rect((id, index * 2 + 1), relative(0.4), 16.)),
                )
        }))
        .into_any_element()
}

/// A muted line where a list would be.
pub(super) fn empty_line(content: impl Into<SharedString>, cx: &App) -> Div {
    div().py(spacing(2.)).flex().justify_center().child(
        text(Variant::Body2, content)
            .text_color(cx.sem().text_secondary)
            .text_center(),
    )
}

/// A user's face, username and display name.
pub(super) fn user_line(user: &UserView, cx: &App) -> Div {
    let sem = cx.sem();
    let display = user
        .display_name
        .as_deref()
        .map(str::trim)
        .filter(|name| !name.is_empty() && *name != user.username);
    div()
        .flex_1()
        .min_w_0()
        .flex()
        .items_center()
        .gap(spacing(1.5))
        .child(user_face(user, 36., None, cx))
        .child(
            div()
                .flex_1()
                .min_w_0()
                .flex()
                .flex_col()
                .child(
                    text(Variant::Body1, user.username.clone())
                        .font_weight(FontWeight(500.))
                        .truncate()
                        .text_color(sem.text_primary),
                )
                .children(display.map(|name| {
                    text(Variant::Body2, name.to_owned())
                        .truncate()
                        .text_color(sem.text_secondary)
                })),
        )
}

/// A chip in a colour of its own: the outlined `Chip color=…` of the web.
pub(super) fn tone_chip(label: impl Into<SharedString>, color: Hsla) -> crate::kit::Chip {
    crate::kit::Chip::new(label).colors(color.opacity(0.12), color, color)
}
