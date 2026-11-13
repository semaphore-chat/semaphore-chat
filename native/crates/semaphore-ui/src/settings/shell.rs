//! The shell: a nav column beside the open tab, as the web's `FormPageShell`; on a phone a list of
//! the tabs to tap into, with a back button. Also the pieces every tab is drawn with.

use super::{SettingsScreen, SettingsShellEvent, SettingsTab};
use crate::kit::{Button, ButtonSize, ListRow, Switch, Variant, spacing, text};
use crate::panel::common::{design_icon, icon_button, is_phone};
use crate::theme::SemTheme;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_design::Icon as DesignIcon;

fn tab_icon(tab: SettingsTab) -> DesignIcon {
    match tab {
        SettingsTab::Notifications => DesignIcon::Notifications,
        SettingsTab::VoiceVideo => DesignIcon::VolumeUp,
        SettingsTab::Appearance => DesignIcon::Palette,
        SettingsTab::Sessions => DesignIcon::Devices,
        SettingsTab::DesktopApp => DesignIcon::DesktopWindows,
    }
}

impl SettingsScreen {
    fn pick(&mut self, tab: SettingsTab, cx: &mut Context<Self>) {
        self.tab = tab;
        self.phone_open = true;
        cx.emit(SettingsShellEvent::TabChanged(tab));
        cx.notify();
    }

    fn content(&self) -> AnyView {
        match self.tab {
            SettingsTab::Notifications => self.notifications.clone().into(),
            SettingsTab::VoiceVideo => self.voice.clone().into(),
            SettingsTab::Appearance => self.appearance.clone().into(),
            SettingsTab::Sessions => self.sessions.clone().into(),
            SettingsTab::DesktopApp => self.desktop.clone().into(),
        }
    }

    fn nav(&self, phone: bool, cx: &mut Context<Self>) -> AnyElement {
        let sem = cx.sem().clone();
        let header = div()
            .flex()
            .items_center()
            .justify_between()
            .gap(spacing(1.))
            .px(spacing(2.))
            .min_h(px(if phone { 56. } else { 64. }))
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(spacing(1.))
                    .child(design_icon(DesignIcon::Settings, 24., sem.primary))
                    .child(text(Variant::H6, "Settings").text_color(sem.text_primary)),
            )
            .child(
                icon_button(
                    "settings-close",
                    DesignIcon::Close,
                    "Close settings",
                    phone,
                    sem.action_active,
                    cx,
                )
                .on_click(cx.listener(|_, _, _, cx| cx.emit(SettingsShellEvent::Close))),
            );
        let rows = SettingsTab::ALL.into_iter().map(|tab| {
            let view = cx.weak_entity();
            let mut row = ListRow::new(
                SharedString::from(format!("settings-tab-{}", tab.key())),
                tab.label(),
            )
            .leading(design_icon(tab_icon(tab), 22., sem.action_active))
            .selected(!phone && tab == self.tab)
            .on_click(move |_, cx| {
                view.update(cx, |screen, cx| screen.pick(tab, cx)).ok();
            });
            if phone {
                row = row.trailing(design_icon(
                    DesignIcon::ChevronRight,
                    22.,
                    sem.text_secondary,
                ));
            }
            row
        });
        div()
            .id("settings-nav")
            .test_support()
            .role(Role::Navigation)
            .aria_label("Settings sections")
            .flex()
            .flex_col()
            .size_full()
            .child(header)
            .child(div().px(spacing(1.)).flex().flex_col().children(rows))
            .into_any_element()
    }
}

impl Render for SettingsScreen {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let sem = cx.sem().clone();
        let root = div()
            .id("settings-screen")
            .test_support()
            .role(Role::Region)
            .aria_label("Settings")
            .size_full()
            .flex()
            .bg(sem.background_default);
        if !is_phone(window) {
            return root
                .child(
                    div()
                        .w(px(260.))
                        .flex_shrink_0()
                        .h_full()
                        .bg(sem.paper)
                        .border_r_1()
                        .border_color(sem.divider)
                        .child(self.nav(false, cx)),
                )
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .h_full()
                        .flex()
                        .justify_center()
                        .child(
                            div()
                                .w_full()
                                .max_w(px(820.))
                                .h_full()
                                .child(self.content()),
                        ),
                );
        }
        if !self.phone_open {
            return root.child(div().size_full().bg(sem.paper).child(self.nav(true, cx)));
        }
        let bar = div()
            .flex_shrink_0()
            .flex()
            .items_center()
            .gap(spacing(1.))
            .px(spacing(1.))
            .min_h(px(56.))
            .border_b_1()
            .border_color(sem.divider)
            .bg(sem.paper)
            .child(
                icon_button(
                    "settings-back",
                    DesignIcon::ArrowBack,
                    "Back to settings",
                    true,
                    sem.action_active,
                    cx,
                )
                .on_click(cx.listener(|screen, _, _, cx| {
                    screen.phone_open = false;
                    cx.notify();
                })),
            )
            .child(
                text(Variant::H6, self.tab.label())
                    .flex_1()
                    .min_w_0()
                    .truncate()
                    .text_color(sem.text_primary),
            );
        root.flex_col()
            .child(bar)
            .child(div().flex_1().min_h_0().child(self.content()))
    }
}

// ---- What every tab is drawn with. ----

/// A tab's page: its heading with an icon (and actions at the right), over its scrolling body,
/// as `NotificationSettingsSection` draws its own.
pub(super) fn tab_page(
    id: &'static str,
    icon: DesignIcon,
    title: &'static str,
    actions: Vec<AnyElement>,
    body: impl IntoElement,
    cx: &App,
) -> AnyElement {
    let sem = cx.sem();
    let heading = div()
        .flex()
        .items_center()
        .gap(spacing(1.))
        .pb(spacing(2.))
        .mb(spacing(2.))
        .border_b_1()
        .border_color(sem.divider)
        .child(design_icon(icon, 24., sem.text_primary))
        .child(
            text(Variant::H6, title)
                .flex_1()
                .min_w_0()
                .text_color(sem.text_primary),
        )
        .children(actions);
    div()
        .id(id)
        .test_support()
        .role(Role::Region)
        .aria_label(title)
        .size_full()
        .flex()
        .flex_col()
        .bg(sem.paper)
        .child(
            div()
                .id(SharedString::from(format!("{id}-scroll")))
                .test_support()
                .flex_1()
                .min_h_0()
                .overflow_y_scroll()
                .p(spacing(3.))
                .child(heading)
                .child(body),
        )
        .into_any_element()
}

/// A section's title, and the web's caption under it.
pub(super) fn section(title: &'static str, cx: &App) -> Div {
    div()
        .flex()
        .flex_col()
        .gap(spacing(1.))
        .child(text(Variant::Subtitle2, title).text_color(cx.sem().text_primary))
}

pub(super) fn caption(content: impl Into<SharedString>, cx: &App) -> Div {
    text(Variant::Caption, content).text_color(cx.sem().text_secondary)
}

/// A switch with its label and caption beside it, as `FormControlLabel` lays them out: the kit's
/// switch draws no label of its own.
pub(super) fn switch_row(
    switch: Switch,
    label: impl Into<SharedString>,
    caption: Option<SharedString>,
    cx: &App,
) -> Div {
    let sem = cx.sem();
    div().flex().items_start().gap(px(4.)).child(switch).child(
        div()
            .flex_1()
            .min_w_0()
            .pt(px(if caption.is_some() { 1. } else { 8. }))
            .flex()
            .flex_col()
            .child(text(Variant::Body1, label).text_color(sem.text_primary))
            .children(
                caption
                    .map(|caption| text(Variant::Caption, caption).text_color(sem.text_secondary)),
            ),
    )
}

/// The web's exclusive `ToggleButtonGroup`: the chosen one filled, the rest outlined.
pub(super) fn segmented<T: Copy + PartialEq + 'static>(
    id: &'static str,
    options: &[(T, &'static str)],
    chosen: T,
    on_pick: impl Fn(T, &mut Window, &mut App) + 'static,
) -> Div {
    let on_pick = std::rc::Rc::new(on_pick);
    div()
        .flex()
        .flex_wrap()
        .gap(spacing(1.))
        .children(options.iter().map(|&(value, label)| {
            let on_pick = on_pick.clone();
            let button = Button::new(
                SharedString::from(format!("{id}-{}", label.to_lowercase().replace(' ', "-"))),
                label,
            )
            .size(ButtonSize::Small)
            .on_click(move |_, window, cx| on_pick(value, window, cx));
            if value == chosen {
                button.contained()
            } else {
                button.outlined()
            }
        }))
}

/// A label and its value on one line, the value at the right: the web's "App Version:" rows.
pub(super) fn info_row(label: &'static str, value: impl Into<SharedString>, cx: &App) -> Div {
    let sem = cx.sem();
    div()
        .flex()
        .justify_between()
        .gap(spacing(2.))
        .child(
            text(Variant::Body2, label)
                .text_color(sem.text_secondary)
                .flex_shrink_0(),
        )
        .child(
            text(Variant::Body2, value)
                .text_color(sem.text_primary)
                .min_w_0()
                .text_right(),
        )
}
