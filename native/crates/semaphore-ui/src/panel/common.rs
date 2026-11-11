//! What the side panels share: the header, the empty and error blocks, relative times and icon
//! buttons with the web's MUI icons. The thread pane uses these too.

use crate::kit::{Button, Variant, icon_path, spacing, text};
use crate::shell::PHONE;
use crate::theme::SemTheme;
use gpui_kit::base;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_design::Icon as DesignIcon;

/// `TOUCH_TARGETS.MINIMUM`.
pub(crate) const TOUCH_TARGET: f32 = 44.;

/// The panel fills a phone's screen there, so it takes the touch layout.
pub(crate) fn is_phone(window: &Window) -> bool {
    f32::from(window.viewport_size().width) < PHONE
}

/// One of the web's icons at a fixed size.
pub(crate) fn design_icon(icon: DesignIcon, size: f32, color: Hsla) -> Svg {
    svg()
        .path(icon_path(icon))
        .size(px(size))
        .flex_none()
        .text_color(color)
}

/// MuiIconButton `size="small"` with a web icon, or a 44px target on touch.
pub(crate) fn icon_button(
    id: impl Into<ElementId>,
    icon: DesignIcon,
    label: impl Into<SharedString>,
    touch: bool,
    color: Hsla,
    cx: &App,
) -> base::Button {
    let sem = cx.sem();
    let (hover, focus) = (sem.icon_button_hover, sem.action_selected);
    let side = if touch { TOUCH_TARGET } else { 34. };
    base::Button::new(id)
        .accessibility_label(label)
        .size(px(side))
        .flex()
        .flex_shrink_0()
        .items_center()
        .justify_center()
        .rounded_full()
        .cursor_pointer()
        .hover(move |style| style.bg(hover))
        .focus_visible(move |style| style.bg(focus))
        .child(design_icon(icon, 20., color))
}

/// The header every panel draws: a primary-coloured icon, the title, then `actions` at the end.
pub(crate) fn panel_header(
    icon: DesignIcon,
    title: impl Into<SharedString>,
    subtitle: Option<SharedString>,
    actions: Vec<AnyElement>,
    touch: bool,
    cx: &App,
) -> Div {
    let sem = cx.sem();
    div()
        .flex_shrink_0()
        .flex()
        .items_center()
        .justify_between()
        .gap(spacing(1.))
        .px(spacing(2.))
        .py(spacing(if touch { 0.5 } else { 1.5 }))
        .min_h(px(if touch { 56. } else { 64. }))
        .border_b_1()
        .border_color(sem.divider)
        .bg(sem.paper)
        .child(
            div()
                .flex()
                .items_center()
                .gap(spacing(1.))
                .min_w_0()
                .flex_1()
                .child(design_icon(icon, 24., sem.primary))
                .child(
                    text(Variant::H6, title)
                        .text_color(sem.text_primary)
                        .flex_shrink_0(),
                )
                .children(subtitle.map(|subtitle| {
                    text(Variant::Caption, subtitle)
                        .text_color(sem.text_secondary)
                        .min_w_0()
                        .truncate()
                })),
        )
        .child(
            div()
                .flex()
                .flex_shrink_0()
                .items_center()
                .gap(px(4.))
                .children(actions),
        )
}

/// A centred icon, line and hint: the empty states of the pins and thread panels.
pub(crate) fn empty_block(
    icon: DesignIcon,
    title: impl Into<SharedString>,
    hint: impl Into<SharedString>,
    cx: &App,
) -> Div {
    let sem = cx.sem();
    div()
        .flex()
        .flex_col()
        .items_center()
        .justify_center()
        .py(spacing(4.))
        .px(spacing(2.))
        .gap(px(4.))
        .child(design_icon(icon, 48., sem.text_disabled).mb(spacing(1.)))
        .child(
            text(Variant::Body2, title)
                .text_color(sem.text_secondary)
                .text_center(),
        )
        .child(
            text(Variant::Caption, hint)
                .text_color(sem.text_secondary)
                .text_center(),
        )
}

/// `ListState`'s compact error: a tinted icon, a title, a line, and "Try again".
pub(crate) fn error_block(
    id: &'static str,
    title: impl Into<SharedString>,
    description: impl Into<SharedString>,
    on_retry: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
    cx: &App,
) -> AnyElement {
    let sem = cx.sem();
    let tint = sem.error.opacity(if sem.is_dark { 0.16 } else { 0.1 });
    div()
        .id(SharedString::from(format!("{id}-block")))
        .test_support()
        .role(Role::Alert)
        .flex()
        .flex_col()
        .items_center()
        .justify_center()
        .px(px(16.))
        .py(px(24.))
        .child(
            div()
                .size(px(56.))
                .mb(px(12.))
                .flex()
                .items_center()
                .justify_center()
                .rounded_full()
                .bg(tint)
                .child(design_icon(DesignIcon::ErrorOutline, 32., sem.error)),
        )
        .child(
            text(Variant::Subtitle2, title)
                .font_weight(FontWeight(600.))
                .text_color(sem.text_primary)
                .mb(px(4.))
                .text_center(),
        )
        .child(
            text(Variant::Caption, description)
                .text_color(sem.text_secondary)
                .max_w(px(300.))
                .mb(px(12.))
                .text_center(),
        )
        .child(Button::new(id, "Try again").outlined().on_click(on_retry))
        .into_any_element()
}

/// date-fns' `formatDistanceToNow(.., { addSuffix: true })`, in English, as the web shows it.
pub(crate) fn relative_time(now_ms: i64, then_ms: i64) -> String {
    let seconds = (now_ms - then_ms) as f64 / 1000.;
    let future = seconds < 0.;
    let seconds = seconds.abs();
    let minutes = (seconds / 60.).round() as i64;
    let distance = if seconds < 30. {
        "less than a minute".to_owned()
    } else if minutes < 2 {
        "1 minute".to_owned()
    } else if minutes < 45 {
        format!("{minutes} minutes")
    } else if minutes < 90 {
        "about 1 hour".to_owned()
    } else if minutes < 1440 {
        format!("about {} hours", (minutes as f64 / 60.).round() as i64)
    } else if minutes < 2520 {
        "1 day".to_owned()
    } else if minutes < 43200 {
        format!("{} days", (minutes as f64 / 1440.).round() as i64)
    } else if minutes < 86400 {
        let months = (minutes as f64 / 43200.).round() as i64;
        format!("about {months} month{}", if months == 1 { "" } else { "s" })
    } else if minutes < 525_600 {
        format!(
            "{} months",
            (minutes as f64 / 43200.).round().max(2.) as i64
        )
    } else {
        // A year and up: "about", "over" or "almost", by the months left over.
        let months = minutes / 43200;
        let years = months / 12;
        let rest = months % 12;
        if rest < 3 {
            format!("about {years} year{}", if years == 1 { "" } else { "s" })
        } else if rest < 9 {
            format!("over {years} year{}", if years == 1 { "" } else { "s" })
        } else {
            format!("almost {} years", years + 1)
        }
    };
    if future {
        format!("in {distance}")
    } else {
        format!("{distance} ago")
    }
}

/// The message text a panel previews: the display string on one line, as the web joins spans.
pub(crate) fn preview_text(display: &str, max_chars: Option<usize>) -> String {
    let joined = display.split_whitespace().collect::<Vec<_>>().join(" ");
    match max_chars {
        Some(max) if joined.chars().count() > max => {
            let cut: String = joined.chars().take(max).collect();
            format!("{cut}...")
        }
        _ => joined,
    }
}

/// The clock panels measure times against: the real one, or a fixed instant for stories and tests.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct PanelClock {
    fixed_now_ms: Option<i64>,
}

impl PanelClock {
    pub fn fixed(now_ms: i64) -> Self {
        Self {
            fixed_now_ms: Some(now_ms),
        }
    }

    pub fn now_ms(&self) -> i64 {
        self.fixed_now_ms
            .unwrap_or_else(|| chrono::Utc::now().timestamp_millis())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    const MIN: i64 = 60_000;

    #[test]
    fn relative_times_read_like_date_fns() {
        let now = 1_000_000_000_000;
        assert_eq!(relative_time(now, now - 10_000), "less than a minute ago");
        assert_eq!(relative_time(now, now - MIN), "1 minute ago");
        assert_eq!(relative_time(now, now - 5 * MIN), "5 minutes ago");
        assert_eq!(relative_time(now, now - 60 * MIN), "about 1 hour ago");
        assert_eq!(relative_time(now, now - 5 * 60 * MIN), "about 5 hours ago");
        assert_eq!(relative_time(now, now - 30 * 60 * MIN), "1 day ago");
        assert_eq!(relative_time(now, now - 3 * 1440 * MIN), "3 days ago");
        assert_eq!(
            relative_time(now, now - 40 * 1440 * MIN),
            "about 1 month ago"
        );
        assert_eq!(relative_time(now, now - 100 * 1440 * MIN), "3 months ago");
        assert_eq!(
            relative_time(now, now - 400 * 1440 * MIN),
            "about 1 year ago"
        );
        assert_eq!(
            relative_time(now, now - 700 * 1440 * MIN),
            "almost 2 years ago"
        );
        assert_eq!(relative_time(now, now + 5 * MIN), "in 5 minutes");
    }

    #[test]
    fn previews_join_lines_and_cut_like_the_web() {
        assert_eq!(preview_text("a\n\nb  c", None), "a b c");
        assert_eq!(preview_text("abcdef", Some(3)), "abc...");
        assert_eq!(preview_text("abc", Some(3)), "abc");
    }
}
