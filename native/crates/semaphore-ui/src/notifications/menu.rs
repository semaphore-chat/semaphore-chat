//! The channel header's level button and menu, after `ChannelNotificationMenu.tsx`.

use super::{ChannelNotifyEvent, ChannelNotifyMenu};
use crate::kit::{IconButton, Spinner, Variant, spacing, text, with_tip};
use crate::panel::common::design_icon;
use crate::theme::SemTheme;
use gpui_kit::base;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{LoadState, NotifyLevel};
use semaphore_design::Icon as DesignIcon;

/// How the web names a level.
pub fn level_label(level: NotifyLevel) -> &'static str {
    match level {
        NotifyLevel::All => "All messages",
        NotifyLevel::Mentions => "Only @mentions",
        NotifyLevel::Muted => "Nothing",
    }
}

/// The button's tooltip and name: "Notification settings: Only @mentions (default)".
pub fn level_tooltip(own: Option<NotifyLevel>, default: NotifyLevel) -> String {
    match own {
        Some(level) => format!("Notification settings: {}", level_label(level)),
        None => format!("Notification settings: {} (default)", level_label(default)),
    }
}

fn level_icon(level: NotifyLevel) -> DesignIcon {
    match level {
        NotifyLevel::All => DesignIcon::NotificationsActive,
        NotifyLevel::Mentions => DesignIcon::AlternateEmail,
        NotifyLevel::Muted => DesignIcon::NotificationsOff,
    }
}

impl ChannelNotifyMenu {
    /// What applies: the channel's own level, or the default.
    fn effective(&self) -> NotifyLevel {
        self.view.level.unwrap_or(self.default_level)
    }

    fn choose(&mut self, level: Option<NotifyLevel>, cx: &mut Context<Self>) {
        self.open = false;
        if level != self.view.level {
            cx.emit(ChannelNotifyEvent::SetLevel(level));
        }
        cx.notify();
    }

    fn item(
        &self,
        id: &'static str,
        level: Option<NotifyLevel>,
        icon: DesignIcon,
        primary: String,
        secondary: String,
        cx: &mut Context<Self>,
    ) -> impl IntoElement + use<> {
        let sem = cx.sem();
        let selected = level.is_some() && level == self.view.level;
        let (hover, selected_bg) = (sem.action_hover, sem.action_selected);
        let icon = if selected { DesignIcon::Check } else { icon };
        base::Button::new(id)
            .role(Role::MenuItemRadio)
            .accessibility_label(format!("{primary}: {secondary}"))
            .selected(selected)
            .disabled(self.busy)
            .w_full()
            .px(px(16.))
            .py(px(6.))
            .flex()
            .items_center()
            .gap(spacing(1.5))
            .cursor_pointer()
            .when(selected, |row| row.bg(selected_bg))
            .hover(move |style| style.bg(hover))
            .focus_visible(move |style| style.bg(hover))
            .child(design_icon(icon, 20., sem.action_active))
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .flex()
                    .flex_col()
                    .child(text(Variant::Body1, primary).text_color(sem.text_primary))
                    .child(text(Variant::Body2, secondary).text_color(sem.text_secondary)),
            )
            .on_click(cx.listener(move |menu, _, _, cx| menu.choose(level, cx)))
    }

    fn menu(&self, cx: &mut Context<Self>) -> impl IntoElement + use<> {
        let sem = cx.sem().clone();
        let title = match &self.channel_name {
            Some(name) => format!("Notifications for #{name}"),
            None => "Notifications for this channel".to_owned(),
        };
        let use_default = self.view.level.is_some().then(|| {
            div()
                .flex()
                .flex_col()
                .child(div().my(px(4.)).h(px(1.)).bg(sem.divider))
                .child(self.item(
                    "notify-level-default",
                    None,
                    DesignIcon::NotificationsPaused,
                    "Use Default".to_owned(),
                    format!("Currently: {}", level_label(self.default_level)),
                    cx,
                ))
        });
        div()
            .id("notify-level-menu")
            .test_support()
            .role(Role::Menu)
            .aria_label(title.clone())
            .w(px(300.))
            .py(px(8.))
            .rounded(px(4.))
            .bg(sem.paper)
            .border_1()
            .border_color(sem.divider)
            .shadow_lg()
            .occlude()
            .on_mouse_down_out(cx.listener(|menu, _, _, cx| {
                menu.open = false;
                cx.notify();
            }))
            .child(
                text(Variant::Subtitle2, title)
                    .px(px(16.))
                    .py(px(6.))
                    .font_weight(FontWeight(700.))
                    .text_color(sem.text_primary)
                    .truncate(),
            )
            .child(div().my(px(4.)).h(px(1.)).bg(sem.divider))
            .child(self.item(
                "notify-level-all",
                Some(NotifyLevel::All),
                DesignIcon::NotificationsActive,
                "All Messages".to_owned(),
                "Every message in this channel".to_owned(),
                cx,
            ))
            .child(self.item(
                "notify-level-mentions",
                Some(NotifyLevel::Mentions),
                DesignIcon::AlternateEmail,
                "Only @mentions".to_owned(),
                "When someone mentions you".to_owned(),
                cx,
            ))
            .child(self.item(
                "notify-level-muted",
                Some(NotifyLevel::Muted),
                DesignIcon::NotificationsOff,
                "Nothing".to_owned(),
                "No notifications from this channel".to_owned(),
                cx,
            ))
            .children(use_default)
    }
}

impl Render for ChannelNotifyMenu {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let sem = cx.sem().clone();
        let loading = matches!(self.view.state, LoadState::Loading);
        let tooltip = level_tooltip(self.view.level, self.default_level);
        let button: AnyElement = if loading {
            div()
                .id("notify-level-loading")
                .test_support()
                .role(Role::ProgressIndicator)
                .aria_label("Loading notification settings")
                .size(px(34.))
                .flex()
                .items_center()
                .justify_center()
                .child(Spinner::new("notify-level-spinner").size(20.))
                .into_any_element()
        } else {
            with_tip(
                div().id("notify-level-tip").child(
                    IconButton::new(
                        "notify-level-button",
                        level_icon(self.effective()),
                        tooltip.clone(),
                    )
                    .small_with_large_icon()
                    .color(sem.action_active)
                    .selected(self.open)
                    .disabled(self.busy)
                    .on_click(cx.listener(|menu, _, _, cx| {
                        menu.open = !menu.open;
                        cx.notify();
                    })),
                ),
                tooltip,
            )
            .into_any_element()
        };
        let menu = self.open.then(|| self.menu(cx));
        div()
            .id("notify-level")
            .relative()
            .flex_shrink_0()
            .child(button)
            .children(menu.map(|menu| {
                div().absolute().top(px(38.)).right_0().child(
                    deferred(
                        anchored()
                            .anchor(Anchor::TopRight)
                            .snap_to_window()
                            .child(menu),
                    )
                    .with_priority(1),
                )
            }))
    }
}
