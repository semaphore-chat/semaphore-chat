//! What the moderation views are drawn with: cards, rows, chips, and the reason field and its
//! counter.

use super::format::{Tone, reason_counter, reason_error};
use crate::dms::face::user_face;
use crate::dms::names::user_name;
use crate::kit::{Chip, Skeleton, Variant, floating_label, notched, spacing, text};
use crate::panel::common::design_icon;
use crate::theme::{Sem, SemTheme};
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::component::Sizable as _;
use gpui_kit::component::input::{Textarea, TextareaState};
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::UserView;
use semaphore_design::Icon as DesignIcon;

pub(super) type Observed = gpui_kit::base::ObservedElement<Stateful<Div>>;

pub(super) fn tone_color(tone: Tone, sem: &Sem) -> Hsla {
    match tone {
        Tone::Error => sem.error,
        Tone::Success => sem.success,
        Tone::Warning => sem.warning,
        Tone::Primary => sem.primary,
        Tone::Neutral => sem.text_secondary,
    }
}

/// The web's outlined `Chip color=…`.
pub(super) fn tone_chip(label: impl Into<SharedString>, color: Hsla) -> Chip {
    Chip::new(label).colors(color.opacity(0.12), color, color)
}

/// MUI's `Paper` section with a title (and what sits at its right).
pub(super) fn card(
    id: impl Into<ElementId>,
    title: impl Into<SharedString>,
    trailing: Option<AnyElement>,
    body: impl IntoElement,
    cx: &App,
) -> Observed {
    let sem = cx.sem();
    let title = title.into();
    div()
        .id(id)
        .test_support()
        .role(Role::Region)
        .aria_label(title.clone())
        .w_full()
        .min_w_0()
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
                .flex()
                .flex_wrap()
                .items_center()
                .justify_between()
                .gap(spacing(1.))
                .border_b_1()
                .border_color(sem.divider)
                .child(
                    text(Variant::Subtitle1, title)
                        .min_w_0()
                        .text_color(sem.text_primary),
                )
                .children(trailing),
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

/// A list's container, for its accessible name.
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

/// A list row with the web's divider border.
pub(super) fn row(id: impl Into<ElementId>, label: impl Into<SharedString>, cx: &App) -> Observed {
    let sem = cx.sem();
    div()
        .id(id)
        .test_support()
        .role(Role::ListItem)
        .aria_label(label.into())
        .w_full()
        .min_w_0()
        .flex()
        .items_start()
        .gap(spacing(1.5))
        .px(spacing(1.5))
        .py(spacing(1.))
        .rounded(px(4.))
        .border_1()
        .border_color(sem.divider)
}

/// A muted line where a list would be.
pub(super) fn empty_line(content: impl Into<SharedString>, cx: &App) -> Div {
    div().py(spacing(2.)).flex().justify_center().child(
        text(Variant::Body2, content)
            .text_color(cx.sem().text_secondary)
            .text_center(),
    )
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
                .child(Skeleton::circle((id, index * 3), 32.))
                .child(
                    div()
                        .flex_1()
                        .flex()
                        .flex_col()
                        .gap(px(6.))
                        .child(Skeleton::rect((id, index * 3 + 1), relative(0.5), 16.))
                        .child(Skeleton::rect((id, index * 3 + 2), relative(0.3), 12.)),
                )
        }))
        .into_any_element()
}

/// A face and the name the web shows, cut to fit.
pub(super) fn face_and_name(user: &UserView, size: f32, cx: &App) -> Div {
    let sem = cx.sem();
    div()
        .min_w_0()
        .flex()
        .items_center()
        .gap(spacing(1.))
        .child(user_face(user, size, None, cx))
        .child(
            text(Variant::Subtitle2, user_name(user))
                .min_w_0()
                .truncate()
                .text_color(sem.text_primary),
        )
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

/// The reason field: an outlined text area with "Reason (optional)" and a counter that turns red
/// past the cap.
pub(super) fn reason_field(
    id: &'static str,
    state: &Entity<TextareaState>,
    disabled: bool,
    window: &Window,
    cx: &App,
) -> Div {
    let sem = cx.sem();
    let value = state.read(cx).value().to_string();
    let error = reason_error(&value);
    let focused = state.read(cx).focus_handle(cx).is_focused(window);
    let border = if error.is_some() {
        sem.error
    } else if disabled {
        sem.action_disabled_bg
    } else if focused {
        sem.input_border_focused
    } else {
        sem.input_border
    };
    let label_color = if error.is_some() {
        sem.error
    } else if focused {
        sem.primary
    } else {
        sem.text_secondary
    };
    let helper_color = if error.is_some() {
        sem.error
    } else {
        sem.text_secondary
    };
    div()
        .w_full()
        .flex()
        .flex_col()
        .child(notched(
            div()
                .w_full()
                .rounded(px(4.))
                .border_1()
                .border_color(border)
                .px(px(10.))
                .pt(px(14.))
                .pb(px(10.))
                .child(
                    Textarea::new(state)
                        .with_size(gpui_kit::component::Size::XSmall)
                        .text_size(px(16.))
                        .appearance(false)
                        .bordered(false)
                        .disabled(disabled)
                        .aria_label("Reason (optional)")
                        .accessibility_id(id),
                ),
            floating_label(
                "Reason (optional)".into(),
                false,
                true,
                label_color,
                sem.paper,
            ),
        ))
        .child(
            div()
                .px(px(14.))
                .pt(px(3.))
                .flex()
                .justify_between()
                .gap(spacing(1.))
                .text_color(helper_color)
                .child(text(Variant::Caption, error.unwrap_or_default()).min_w_0())
                .child(text(Variant::Caption, reason_counter(&value)).flex_none()),
        )
}
