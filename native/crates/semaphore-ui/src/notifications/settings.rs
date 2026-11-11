//! The notification settings section, after `Settings/NotificationSettings.tsx`: switches, the
//! sound type, do not disturb with its hours, the default channel level and DM notifications,
//! saved together with a Save button.

use super::menu::level_label;
use super::{NotificationSettingsSection, SettingsEvent};
use crate::kit::{Button, ButtonSize, Radio, Skeleton, Switch, TextField, Variant, spacing, text};
use crate::panel::common::{design_icon, error_block, icon_button};
use crate::theme::SemTheme;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::component::input::{InputEvent, InputState};
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{
    LoadState, NotificationSettings, NotificationSettingsPatch, NotificationSettingsView,
    NotifyLevel, NotifySound,
};
use semaphore_design::Icon as DesignIcon;

/// `HH:mm`, 24-hour, as the server keeps the DND hours.
pub fn valid_time(value: &str) -> bool {
    let Some((hours, minutes)) = value.split_once(':') else {
        return false;
    };
    hours.len() == 2
        && minutes.len() == 2
        && hours.parse::<u8>().is_ok_and(|h| h < 24)
        && minutes.parse::<u8>().is_ok_and(|m| m < 60)
}

/// Why the draft can't be saved.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SettingsError {
    /// A time isn't `HH:mm`.
    BadTime,
    /// One time without the other: DND would be on always, which the hours don't say.
    OneTime,
}

impl SettingsError {
    pub fn message(self) -> &'static str {
        match self {
            SettingsError::BadTime => "Use 24-hour times such as 22:00",
            SettingsError::OneTime => "Set both times, or neither for all day",
        }
    }
}

/// What was loaded and what the form shows now. The DND hours are kept as typed.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SettingsForm {
    pub saved: NotificationSettings,
    pub draft: NotificationSettings,
}

fn time_text(time: &Option<String>) -> &str {
    time.as_deref().unwrap_or("")
}

impl SettingsForm {
    pub fn new(saved: NotificationSettings) -> Self {
        Self {
            draft: saved.clone(),
            saved,
        }
    }

    pub fn is_dirty(&self) -> bool {
        self.saved != self.draft
    }

    /// New settings from the server. A form with no changes takes them; one with changes keeps
    /// them, measured against what is saved now.
    pub fn load(&mut self, saved: NotificationSettings) {
        if !self.is_dirty() {
            self.draft = saved.clone();
        }
        self.saved = saved;
    }

    pub fn discard(&mut self) {
        self.draft = self.saved.clone();
    }

    pub fn set_time(&mut self, start: bool, value: &str) {
        let value = value.trim();
        let value = (!value.is_empty()).then(|| value.to_owned());
        if start {
            self.draft.dnd_start = value;
        } else {
            self.draft.dnd_end = value;
        }
    }

    pub fn error(&self) -> Option<SettingsError> {
        let (start, end) = (
            time_text(&self.draft.dnd_start),
            time_text(&self.draft.dnd_end),
        );
        if (!start.is_empty() && !valid_time(start)) || (!end.is_empty() && !valid_time(end)) {
            return Some(SettingsError::BadTime);
        }
        if self.draft.dnd && start.is_empty() != end.is_empty() {
            return Some(SettingsError::OneTime);
        }
        None
    }

    /// The fields that changed. A cleared time is sent as "", and changed hours carry
    /// `local_timezone`, so they mean this user's clock.
    pub fn patch(
        &self,
        local_timezone: Option<&str>,
    ) -> Result<NotificationSettingsPatch, SettingsError> {
        if let Some(error) = self.error() {
            return Err(error);
        }
        let (saved, draft) = (&self.saved, &self.draft);
        let changed = |a: bool, b: bool| (a != b).then_some(b);
        let mut patch = NotificationSettingsPatch {
            desktop_enabled: changed(saved.desktop_enabled, draft.desktop_enabled),
            play_sound: changed(saved.play_sound, draft.play_sound),
            sound: (saved.sound != draft.sound).then_some(draft.sound),
            dnd: changed(saved.dnd, draft.dnd),
            default_level: (saved.default_level != draft.default_level)
                .then_some(draft.default_level),
            dm_notifications: changed(saved.dm_notifications, draft.dm_notifications),
            ..NotificationSettingsPatch::default()
        };
        let mut hours_changed = false;
        if saved.dnd_start != draft.dnd_start {
            patch.dnd_start = Some(time_text(&draft.dnd_start).to_owned());
            hours_changed = true;
        }
        if saved.dnd_end != draft.dnd_end {
            patch.dnd_end = Some(time_text(&draft.dnd_end).to_owned());
            hours_changed = true;
        }
        if hours_changed
            && draft.dnd_start.is_some()
            && let Some(zone) = local_timezone
            && saved.dnd_timezone.as_deref() != Some(zone)
        {
            patch.dnd_timezone = Some(zone.to_owned());
        }
        Ok(patch)
    }
}

impl NotificationSettingsSection {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let start = cx.new(|cx| InputState::new(window, cx));
        let end = cx.new(|cx| InputState::new(window, cx));
        let subscriptions = vec![
            cx.subscribe_in(&start, window, |section, field, event, _, cx| {
                section.on_time(true, field, event, cx)
            }),
            cx.subscribe_in(&end, window, |section, field, event, _, cx| {
                section.on_time(false, field, event, cx)
            }),
        ];
        Self {
            form: SettingsForm::default(),
            state: LoadState::Loading,
            start,
            end,
            saving: false,
            local_timezone: None,
            _subscriptions: subscriptions,
        }
    }

    fn on_time(
        &mut self,
        start: bool,
        field: &Entity<InputState>,
        event: &InputEvent,
        cx: &mut Context<Self>,
    ) {
        if let InputEvent::Change = event {
            let value = field.read(cx).value().to_string();
            self.form.set_time(start, &value);
            cx.notify();
        }
    }

    /// `Core::notification_settings`, read again on `ViewChanged { NotificationSettings }`.
    pub fn set_view(
        &mut self,
        view: NotificationSettingsView,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let was_dirty = self.form.is_dirty();
        self.state = view.state;
        self.form.load(view.settings);
        if !was_dirty {
            self.sync_fields(window, cx);
        }
        cx.notify();
    }

    /// A save is on its way.
    pub fn set_saving(&mut self, saving: bool, cx: &mut Context<Self>) {
        self.saving = saving;
        cx.notify();
    }

    /// This device's IANA zone, such as `Europe/Berlin`, sent with changed DND hours.
    pub fn set_local_timezone(&mut self, zone: Option<String>, cx: &mut Context<Self>) {
        self.local_timezone = zone;
        cx.notify();
    }

    pub fn form(&self) -> &SettingsForm {
        &self.form
    }

    pub(crate) fn edit(
        &mut self,
        cx: &mut Context<Self>,
        f: impl FnOnce(&mut NotificationSettings),
    ) {
        f(&mut self.form.draft);
        cx.notify();
    }

    fn sync_fields(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let start = time_text(&self.form.draft.dnd_start).to_owned();
        let end = time_text(&self.form.draft.dnd_end).to_owned();
        self.start
            .update(cx, |field, cx| field.set_value(start, window, cx));
        self.end
            .update(cx, |field, cx| field.set_value(end, window, cx));
    }

    pub(crate) fn save(&mut self, cx: &mut Context<Self>) {
        if self.saving || !self.form.is_dirty() {
            return;
        }
        if let Ok(patch) = self.form.patch(self.local_timezone.as_deref()) {
            cx.emit(SettingsEvent::Save(patch));
        }
    }

    fn discard(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.form.discard();
        self.sync_fields(window, cx);
        cx.notify();
    }
}

/// A switch with its label and the web's caption beside it, as `FormControlLabel` lays them out.
fn switch_row(switch: Switch, label: &'static str, caption: &'static str, cx: &App) -> Div {
    let sem = cx.sem();
    div().flex().items_start().gap(px(4.)).child(switch).child(
        div()
            .flex_1()
            .min_w_0()
            .pt(px(6.))
            .flex()
            .flex_col()
            .child(text(Variant::Body1, label).text_color(sem.text_primary))
            .child(text(Variant::Caption, caption).text_color(sem.text_secondary)),
    )
}

fn section_title(title: &'static str, caption: Option<&'static str>, cx: &App) -> Div {
    let sem = cx.sem();
    div()
        .flex()
        .flex_col()
        .gap(px(2.))
        .child(text(Variant::Subtitle2, title).text_color(sem.text_primary))
        .children(
            caption.map(|caption| text(Variant::Caption, caption).text_color(sem.text_secondary)),
        )
}

impl Render for NotificationSettingsSection {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let sem = cx.sem().clone();
        let view = cx.weak_entity();
        let heading = div()
            .flex()
            .items_center()
            .gap(spacing(1.))
            .pb(spacing(2.))
            .mb(spacing(1.))
            .border_b_1()
            .border_color(sem.divider)
            .child(design_icon(
                DesignIcon::Notifications,
                24.,
                sem.text_primary,
            ))
            .child(text(Variant::H6, "Notification Settings").text_color(sem.text_primary));
        let body: AnyElement =
            match &self.state {
                LoadState::Loading => div()
                    .id("notification-settings-loading")
                    .test_support()
                    .role(Role::ProgressIndicator)
                    .aria_label("Loading notification settings")
                    .flex()
                    .flex_col()
                    .gap(spacing(2.))
                    .children((0..6usize).map(|index| {
                        Skeleton::rect(("settings-loading", index), relative(1.), 40.)
                    }))
                    .into_any_element(),
                LoadState::Failed { .. } => error_block(
                    "notification-settings-retry",
                    "Couldn't load notification settings",
                    "Check your connection and try again.",
                    cx.listener(|_, _, _, cx| cx.emit(SettingsEvent::Retry)),
                    cx,
                ),
                LoadState::Ready => self.form_body(cx).into_any_element(),
            };
        let bar = (matches!(self.state, LoadState::Ready) && self.form.is_dirty()).then(|| {
            let error = self.form.error();
            div()
                .id("notification-settings-bar")
                .test_support()
                .role(Role::Status)
                .aria_label("Unsaved notification settings")
                .flex_shrink_0()
                .px(spacing(3.))
                .py(spacing(1.5))
                .flex()
                .flex_wrap()
                .items_center()
                .justify_between()
                .gap(spacing(1.))
                .border_t_1()
                .border_color(sem.divider)
                .bg(sem.background_default)
                .child(
                    text(
                        Variant::Body2,
                        error
                            .map(SettingsError::message)
                            .unwrap_or("Unsaved notification settings"),
                    )
                    .text_color(if error.is_some() {
                        sem.error
                    } else {
                        sem.text_secondary
                    }),
                )
                .child(
                    div()
                        .flex()
                        .gap(spacing(1.))
                        .child(
                            Button::new("notification-settings-discard", "Discard")
                                .disabled(self.saving)
                                .on_click({
                                    let view = view.clone();
                                    move |_, window, cx| {
                                        view.update(cx, |section, cx| section.discard(window, cx))
                                            .ok();
                                    }
                                }),
                        )
                        .child(
                            Button::new("notification-settings-save", "Save")
                                .contained()
                                .disabled(error.is_some())
                                .loading(self.saving)
                                .on_click({
                                    let view = view.clone();
                                    move |_, _, cx| {
                                        view.update(cx, |section, cx| section.save(cx)).ok();
                                    }
                                }),
                        ),
                )
        });
        // The save bar stays at the foot, as the web's sticky one does, under the scrolling form.
        div()
            .id("notification-settings")
            .test_support()
            .role(Role::Region)
            .aria_label("Notification Settings")
            .size_full()
            .flex()
            .flex_col()
            .bg(sem.paper)
            .child(
                div()
                    .id("notification-settings-scroll")
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scroll()
                    .p(spacing(3.))
                    .child(heading)
                    .child(body),
            )
            .children(bar)
    }
}

impl NotificationSettingsSection {
    fn form_body(&self, cx: &mut Context<Self>) -> Div {
        let sem = cx.sem().clone();
        let draft = self.form.draft.clone();
        let view = cx.weak_entity();
        let toggle = |id: &'static str,
                      label: &'static str,
                      checked: bool,
                      set: fn(&mut NotificationSettings, bool)| {
            let view = view.clone();
            Switch::new(id, label, checked).on_change(move |on, _, cx| {
                view.update(cx, |section, cx| section.edit(cx, |draft| set(draft, on)))
                    .ok();
            })
        };
        let sound = |id: &'static str, label: &'static str, value: NotifySound| {
            let view = view.clone();
            Radio::new(id, label, draft.sound == value)
                .disabled(!draft.play_sound)
                .on_select(move |_, cx| {
                    view.update(cx, |section, cx| {
                        section.edit(cx, |draft| draft.sound = value)
                    })
                    .ok();
                })
        };
        let level = |id: &'static str, value: NotifyLevel, caption: &'static str| {
            let view = view.clone();
            div()
                .flex()
                .flex_col()
                .child(
                    Radio::new(id, level_label(value), draft.default_level == value).on_select(
                        move |_, cx| {
                            view.update(cx, |section, cx| {
                                section.edit(cx, |draft| draft.default_level = value)
                            })
                            .ok();
                        },
                    ),
                )
                .child(
                    text(Variant::Caption, caption)
                        .pl(px(42.))
                        .text_color(sem.text_secondary),
                )
        };
        let preview = icon_button(
            "notification-sound-preview",
            DesignIcon::PlayArrow,
            "Test notification sound",
            false,
            sem.action_active,
            cx,
        )
        .disabled(!draft.play_sound)
        .on_click(cx.listener(move |section, _, _, cx| {
            cx.emit(SettingsEvent::PreviewSound(section.form.draft.sound));
        }));
        let error = self.form.error();
        div()
            .flex()
            .flex_col()
            .gap(spacing(2.5))
            .child(switch_row(
                toggle(
                    "notification-desktop",
                    "Desktop Notifications",
                    draft.desktop_enabled,
                    |d, on| d.desktop_enabled = on,
                ),
                "Desktop Notifications",
                "Show desktop notifications for new messages and mentions",
                cx,
            ))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(spacing(1.))
                    .child(switch_row(
                        toggle(
                            "notification-sound",
                            "Notification Sounds",
                            draft.play_sound,
                            |d, on| d.play_sound = on,
                        ),
                        "Notification Sounds",
                        "Play a sound when you receive a notification",
                        cx,
                    ))
                    .child(
                        div()
                            .pl(px(62.))
                            .flex()
                            .flex_col()
                            .gap(px(2.))
                            .child(
                                text(Variant::Body2, "Sound Type").text_color(sem.text_secondary),
                            )
                            .child(
                                div()
                                    .flex()
                                    .flex_wrap()
                                    .items_center()
                                    .gap(spacing(1.))
                                    .child(sound(
                                        "notification-sound-default",
                                        "Default",
                                        NotifySound::Default,
                                    ))
                                    .child(sound(
                                        "notification-sound-mention",
                                        "Mention",
                                        NotifySound::Mention,
                                    ))
                                    .child(sound(
                                        "notification-sound-dm",
                                        "Direct Message",
                                        NotifySound::Dm,
                                    ))
                                    .child(preview),
                            ),
                    ),
            )
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(spacing(1.))
                    .child(switch_row(
                        toggle("notification-dnd", "Do Not Disturb", draft.dnd, |d, on| {
                            d.dnd = on
                        }),
                        "Do Not Disturb",
                        "Suppress notifications during specific hours",
                        cx,
                    ))
                    .when(draft.dnd, |dnd| {
                        dnd.child(
                            div()
                                .pl(px(62.))
                                .flex()
                                .flex_wrap()
                                .gap(spacing(2.))
                                .child(
                                    div().w(px(140.)).child(
                                        TextField::new(
                                            "notification-dnd-start",
                                            &self.start,
                                            "Start Time",
                                        )
                                        .placeholder("22:00")
                                        .error(
                                            error == Some(SettingsError::BadTime)
                                                && !valid_time(time_text(&draft.dnd_start))
                                                && draft.dnd_start.is_some(),
                                        ),
                                    ),
                                )
                                .child(
                                    div().w(px(140.)).child(
                                        TextField::new(
                                            "notification-dnd-end",
                                            &self.end,
                                            "End Time",
                                        )
                                        .placeholder("08:00")
                                        .error(
                                            error == Some(SettingsError::BadTime)
                                                && !valid_time(time_text(&draft.dnd_end))
                                                && draft.dnd_end.is_some(),
                                        ),
                                    ),
                                ),
                        )
                        .child(
                            text(
                                Variant::Caption,
                                if draft.dnd_start.is_none() && draft.dnd_end.is_none() {
                                    "No hours set: notifications stay quiet until you turn this off"
                                } else {
                                    "Quiet between these times every day"
                                },
                            )
                            .pl(px(62.))
                            .text_color(sem.text_secondary),
                        )
                    }),
            )
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(spacing(1.))
                    .child(section_title(
                        "Default Channel Notifications",
                        Some("Choose when to receive notifications from channels"),
                        cx,
                    ))
                    .child(level(
                        "notification-level-all",
                        NotifyLevel::All,
                        "Get notified for every message in channels",
                    ))
                    .child(level(
                        "notification-level-mentions",
                        NotifyLevel::Mentions,
                        "Only get notified when someone mentions you",
                    ))
                    .child(level(
                        "notification-level-muted",
                        NotifyLevel::Muted,
                        "No channel notifications (you can override per channel)",
                    )),
            )
            .child(switch_row(
                toggle(
                    "notification-dms",
                    "Direct Message Notifications",
                    draft.dm_notifications,
                    |d, on| d.dm_notifications = on,
                ),
                "Direct Message Notifications",
                "Get notified for all direct messages",
                cx,
            ))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(spacing(1.))
                    .child(section_title("Test Notifications", None, cx))
                    .child(
                        div().child(
                            Button::new("notification-send-test", "Send Test Notification")
                                .outlined()
                                .size(ButtonSize::Small)
                                .start_icon(DesignIcon::Send)
                                .disabled(!self.form.saved.desktop_enabled)
                                .on_click(
                                    cx.listener(|_, _, _, cx| cx.emit(SettingsEvent::SendTest)),
                                ),
                        ),
                    ),
            )
    }
}
