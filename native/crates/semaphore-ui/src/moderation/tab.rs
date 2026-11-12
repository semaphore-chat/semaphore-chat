//! The community settings' Moderation tab (`EditCommunityPage.tsx`'s moderation panel): the ban
//! list and the timeout list side by side (stacked on a phone), the moderation log under them.
//!
//! Lists need `CommunityCaps::view_bans` (the server's VIEW_BAN_LIST, for timeouts too, #688) and
//! the log `view_moderation_log`; a section this user can't see says so. Lifting a ban or a
//! timeout is per row (`can_lift`): the tab emits `Unban`/`RemoveTimeout` and the owner opens the
//! confirm (`ModerationDialog::open_unban`, `open_remove_timeout`).
//!
//! Mount it with `CommunitySettingsScreen::set_moderation_slot`. Feed it `Core::bans`,
//! `Core::timeouts` and `Core::moderation_log`; the filter and "Load more" go to
//! `Core::set_moderation_log_filter` and `Core::more_moderation_log`.

use super::common::{
    card, empty_line, face_and_name, list, loading_rows, locked_note, row, tone_chip, tone_color,
};
use super::format::{
    BanStatus, LOG_KINDS, action_label, action_tone, admin_action, ban_status, date_time,
    date_time_seconds, log_by, log_count, log_detail, now_ms, reason_preview, timeout_left,
};
use crate::community_settings::rules::{failure, running};
use crate::kit::{
    Alert, Button, ButtonSize, SelectField, Severity, Spinner, Variant, select_state, spacing,
    text, with_tip,
};
use crate::messages::TimeFormat;
use crate::panel::common::{design_icon, error_block, is_phone};
use crate::theme::SemTheme;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::component::IndexPath;
use gpui_kit::component::select::{SelectEvent, SelectState};
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{
    AdminActionKind, BanListView, BanRow, CommunityCaps, LoadState, ModerationActionKind,
    ModerationLogRow, ModerationLogView, TimeoutListView, TimeoutRow, UserView,
};
use semaphore_design::Icon as DesignIcon;
use std::time::Duration;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ModerationTabEvent {
    /// "Unban" on a row: open the unban confirm for them.
    Unban { user: UserView },
    /// "Remove" on a row: open the remove-timeout confirm for them.
    RemoveTimeout { user: UserView },
    /// `Core::set_moderation_log_filter(community, filter)`.
    Filter(Option<ModerationActionKind>),
    /// `Core::more_moderation_log(community)`.
    MoreLog,
    /// A list failed and the user asked again: `Core::retry_failed`.
    Retry,
}

/// The filter's choices: "All actions", then each kind.
fn filter_labels() -> Vec<SharedString> {
    std::iter::once("All actions")
        .chain(LOG_KINDS.iter().map(|kind| action_label(*kind)))
        .map(SharedString::from)
        .collect()
}

fn filter_index(filter: Option<ModerationActionKind>) -> usize {
    filter
        .and_then(|kind| LOG_KINDS.iter().position(|known| *known == kind))
        .map_or(0, |index| index + 1)
}

pub struct ModerationTab {
    caps: CommunityCaps,
    bans: BanListView,
    timeouts: TimeoutListView,
    log: ModerationLogView,
    time: TimeFormat,
    filter: Entity<SelectState<Vec<SharedString>>>,
    /// What the select shows, so a filter set from outside moves it.
    shown_filter: Option<ModerationActionKind>,
    ticker: Option<Task<()>>,
    _subscriptions: Vec<Subscription>,
}

impl EventEmitter<ModerationTabEvent> for ModerationTab {}

impl ModerationTab {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let filter = select_state(filter_labels(), Some(0), window, cx);
        let _subscriptions = vec![cx.subscribe_in(&filter, window, |tab, _, event, _, cx| {
            let SelectEvent::Confirm(Some(label)) = event else {
                return;
            };
            let picked = LOG_KINDS
                .iter()
                .copied()
                .find(|kind| action_label(*kind) == label.as_ref());
            tab.shown_filter = picked;
            cx.emit(ModerationTabEvent::Filter(picked));
            cx.notify();
        })];
        Self {
            caps: CommunityCaps::default(),
            bans: BanListView::default(),
            timeouts: TimeoutListView::default(),
            log: ModerationLogView::default(),
            time: TimeFormat::default(),
            filter,
            shown_filter: None,
            ticker: None,
            _subscriptions,
        }
    }

    /// `Core::community_permissions(community).caps`.
    pub fn set_caps(&mut self, caps: CommunityCaps, cx: &mut Context<Self>) {
        self.caps = caps;
        cx.notify();
    }

    pub fn set_bans(&mut self, bans: BanListView, cx: &mut Context<Self>) {
        self.bans = bans;
        cx.notify();
    }

    pub fn set_timeouts(&mut self, timeouts: TimeoutListView, cx: &mut Context<Self>) {
        self.timeouts = timeouts;
        cx.notify();
    }

    pub fn set_log(&mut self, log: ModerationLogView, cx: &mut Context<Self>) {
        self.log = log;
        cx.notify();
    }

    /// The zone and clock times are written in: the app's, unless a story fixes them. With the real
    /// clock, the timeouts' "left" ticks once a second while any show.
    pub fn set_time(&mut self, time: TimeFormat, cx: &mut Context<Self>) {
        self.time = time;
        cx.notify();
    }

    fn keep_ticking(&self) -> bool {
        self.time.now.is_real()
            && self.caps.view_bans
            && self.timeouts.state == LoadState::Ready
            && !self.timeouts.timeouts.is_empty()
    }

    fn tick(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if !self.keep_ticking() {
            self.ticker = None;
            return;
        }
        if self.ticker.is_some() {
            return;
        }
        self.ticker = Some(cx.spawn_in(window, async move |this, cx| {
            loop {
                cx.background_executor().timer(Duration::from_secs(1)).await;
                let going = this.update(cx, |tab, cx| {
                    cx.notify();
                    tab.keep_ticking()
                });
                if !matches!(going, Ok(true)) {
                    this.update(cx, |tab, _| tab.ticker = None).ok();
                    break;
                }
            }
        }));
    }

    fn sync_filter(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.shown_filter == self.log.filter {
            return;
        }
        self.shown_filter = self.log.filter;
        let index = filter_index(self.log.filter);
        self.filter.update(cx, |state, cx| {
            state.set_selected_index(Some(IndexPath::default().row(index)), window, cx)
        });
    }

    fn lift_button(
        id: String,
        label: &'static str,
        accessible: String,
        can_lift: bool,
        busy: bool,
        locked: &'static str,
        on_click: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
    ) -> AnyElement {
        let button = Button::new(SharedString::from(id.clone()), label)
            .outlined()
            .size(ButtonSize::Small)
            .loading(busy)
            .disabled(!can_lift);
        if can_lift {
            return div()
                .flex_none()
                .child(button.on_click(on_click))
                .into_any_element();
        }
        with_tip(
            div()
                .id(SharedString::from(format!("{id}-locked")))
                .flex_none()
                .aria_label(format!("{accessible}: {locked}")),
            locked,
        )
        .test_support()
        .child(button)
        .into_any_element()
    }

    fn details(lines: Vec<(String, Hsla)>) -> Div {
        div().flex().flex_col().gap(px(2.)).children(
            lines
                .into_iter()
                .map(|(line, color)| text(Variant::Caption, line).min_w_0().text_color(color)),
        )
    }

    fn ban_row(&self, ban: &BanRow, now: i64, cx: &mut Context<Self>) -> AnyElement {
        let sem = cx.sem().clone();
        let status = ban_status(now, ban.expires_at_ms);
        let chip = match &status {
            BanStatus::Permanent => tone_chip(status.label(), sem.error),
            BanStatus::Expired => tone_chip(status.label(), sem.text_secondary),
            BanStatus::Expires(_) => tone_chip(status.label(), sem.warning),
        };
        let name = crate::dms::names::user_name(&ban.user);
        let mut lines = vec![(
            format!(
                "Banned {} {}",
                date_time(&self.time, ban.created_at_ms),
                log_by(Some(&ban.moderator))
            ),
            sem.text_secondary,
        )];
        if let Some(reason) = ban.reason.as_deref().filter(|r| !r.trim().is_empty()) {
            lines.push((
                format!("Reason: {}", reason_preview(reason, 160)),
                sem.text_primary,
            ));
        }
        let unban = admin_action(AdminActionKind::Unban, &ban.user.id);
        let busy = running(&self.bans.op, &unban);
        if let Some(error) = failure(&self.bans.op, &unban) {
            lines.push((format!("Couldn't unban: {}", error.message), sem.error));
        }
        let user = ban.user.clone();
        row(
            SharedString::from(format!("ban-{}", ban.user.id)),
            format!("{name}, {}", status.label()),
            cx,
        )
        .child(
            div()
                .flex_1()
                .min_w_0()
                .flex()
                .flex_col()
                .gap(px(4.))
                .child(
                    div()
                        .flex()
                        .flex_wrap()
                        .items_center()
                        .gap(spacing(1.))
                        .child(face_and_name(&ban.user, 28., cx))
                        .child(chip),
                )
                .child(Self::details(lines)),
        )
        .child(Self::lift_button(
            format!("unban-{}", ban.user.id),
            "Unban",
            format!("Unban {name}"),
            ban.can_lift,
            busy,
            "You can't lift this ban",
            cx.listener(move |_, _, _, cx| {
                cx.emit(ModerationTabEvent::Unban { user: user.clone() })
            }),
        ))
        .into_any_element()
    }

    fn timeout_row(&self, timeout: &TimeoutRow, now: i64, cx: &mut Context<Self>) -> AnyElement {
        let sem = cx.sem().clone();
        let left = timeout_left(now, timeout.expires_at_ms);
        let chip = if left == "Expired" {
            tone_chip(left.clone(), sem.text_secondary)
        } else {
            tone_chip(left.clone(), sem.warning)
        };
        let name = crate::dms::names::user_name(&timeout.user);
        let mut lines = vec![(
            format!(
                "Timed out {} {}",
                date_time(&self.time, timeout.created_at_ms),
                log_by(Some(&timeout.moderator))
            ),
            sem.text_secondary,
        )];
        if let Some(reason) = timeout.reason.as_deref().filter(|r| !r.trim().is_empty()) {
            lines.push((
                format!("Reason: {}", reason_preview(reason, 160)),
                sem.text_primary,
            ));
        }
        let lift = admin_action(AdminActionKind::RemoveTimeout, &timeout.user.id);
        let busy = running(&self.timeouts.op, &lift);
        if let Some(error) = failure(&self.timeouts.op, &lift) {
            lines.push((
                format!("Couldn't remove the timeout: {}", error.message),
                sem.error,
            ));
        }
        let user = timeout.user.clone();
        row(
            SharedString::from(format!("timeout-{}", timeout.user.id)),
            format!("{name}, {left}"),
            cx,
        )
        .child(
            div()
                .flex_1()
                .min_w_0()
                .flex()
                .flex_col()
                .gap(px(4.))
                .child(
                    div()
                        .flex()
                        .flex_wrap()
                        .items_center()
                        .gap(spacing(1.))
                        .child(face_and_name(&timeout.user, 28., cx))
                        .child(chip),
                )
                .child(Self::details(lines)),
        )
        .child(Self::lift_button(
            format!("lift-timeout-{}", timeout.user.id),
            "Remove",
            format!("Remove the timeout for {name}"),
            timeout.can_lift,
            busy,
            "You can't lift this timeout",
            cx.listener(move |_, _, _, cx| {
                cx.emit(ModerationTabEvent::RemoveTimeout { user: user.clone() })
            }),
        ))
        .into_any_element()
    }

    fn log_row(&self, entry: &ModerationLogRow, cx: &mut Context<Self>) -> AnyElement {
        let sem = cx.sem().clone();
        let color = tone_color(action_tone(entry.action), &sem);
        let icon = match entry.action {
            ModerationActionKind::Ban => DesignIcon::Block,
            ModerationActionKind::Unban => DesignIcon::LockOpen,
            ModerationActionKind::Kick => DesignIcon::PersonRemove,
            ModerationActionKind::Timeout => DesignIcon::Timer,
            ModerationActionKind::RemoveTimeout => DesignIcon::TimerOff,
            ModerationActionKind::DeleteMessage => DesignIcon::Delete,
            ModerationActionKind::PinMessage | ModerationActionKind::UnpinMessage => {
                DesignIcon::PushPin
            }
            ModerationActionKind::Unknown => DesignIcon::History,
        };
        let label = action_label(entry.action);
        let detail = log_detail(entry);
        row(
            SharedString::from(format!("log-{}", entry.id)),
            format!("{label}: {detail}"),
            cx,
        )
        .child(
            div()
                .flex_none()
                .size(px(32.))
                .rounded_full()
                .flex()
                .items_center()
                .justify_center()
                .bg(color.opacity(0.12))
                .child(design_icon(icon, 18., color)),
        )
        .child(
            div()
                .flex_1()
                .min_w_0()
                .flex()
                .flex_col()
                .gap(px(4.))
                .child(
                    div()
                        .flex()
                        .flex_wrap()
                        .items_center()
                        .gap(spacing(1.))
                        .child(tone_chip(label, color))
                        .child(
                            text(Variant::Caption, log_by(entry.moderator.as_ref()))
                                .min_w_0()
                                .text_color(sem.text_secondary),
                        ),
                )
                .child(
                    text(Variant::Body2, detail)
                        .min_w_0()
                        .text_color(sem.text_primary),
                )
                .child(
                    text(
                        Variant::Caption,
                        date_time_seconds(&self.time, entry.created_at_ms),
                    )
                    .text_color(sem.text_secondary),
                ),
        )
        .into_any_element()
    }

    fn failed(id: &'static str, title: &'static str, cx: &mut Context<Self>) -> AnyElement {
        error_block(
            id,
            title,
            "Please try again.",
            cx.listener(|_, _, _, cx| cx.emit(ModerationTabEvent::Retry)),
            cx,
        )
    }

    fn bans_card(&self, now: i64, cx: &mut Context<Self>) -> AnyElement {
        let body: AnyElement = if !self.caps.view_bans {
            locked_note(
                "bans-locked",
                "You need the \u{201c}View ban list\u{201d} permission",
                cx,
            )
            .into_any_element()
        } else {
            match &self.bans.state {
                LoadState::Loading => loading_rows("bans-loading", "Loading bans", 3),
                LoadState::Failed { .. } => Self::failed("bans-retry", "Failed to load bans", cx),
                LoadState::Ready if self.bans.bans.is_empty() => {
                    empty_line("No banned users", cx).into_any_element()
                }
                LoadState::Ready => {
                    let rows: Vec<_> = self
                        .bans
                        .bans
                        .iter()
                        .map(|ban| self.ban_row(ban, now, cx))
                        .collect();
                    list("bans-list", "Banned users")
                        .children(rows)
                        .into_any_element()
                }
            }
        };
        let title = match self.bans.state {
            LoadState::Ready if self.caps.view_bans => {
                format!("Banned Users ({})", self.bans.bans.len())
            }
            _ => "Banned Users".to_owned(),
        };
        card("moderation-bans", title, None, body, cx)
            .flex_1()
            .into_any_element()
    }

    fn timeouts_card(&self, now: i64, cx: &mut Context<Self>) -> AnyElement {
        let body: AnyElement = if !self.caps.view_bans {
            locked_note(
                "timeouts-locked",
                "You need the \u{201c}View ban list\u{201d} permission",
                cx,
            )
            .into_any_element()
        } else {
            match &self.timeouts.state {
                LoadState::Loading => loading_rows("timeouts-loading", "Loading timeouts", 3),
                LoadState::Failed { .. } => {
                    Self::failed("timeouts-retry", "Failed to load timeouts", cx)
                }
                LoadState::Ready if self.timeouts.timeouts.is_empty() => {
                    empty_line("No active timeouts", cx).into_any_element()
                }
                LoadState::Ready => {
                    let rows: Vec<_> = self
                        .timeouts
                        .timeouts
                        .iter()
                        .map(|timeout| self.timeout_row(timeout, now, cx))
                        .collect();
                    list("timeouts-list", "Timed out users")
                        .children(rows)
                        .into_any_element()
                }
            }
        };
        let title = match self.timeouts.state {
            LoadState::Ready if self.caps.view_bans => {
                format!("Active Timeouts ({})", self.timeouts.timeouts.len())
            }
            _ => "Active Timeouts".to_owned(),
        };
        card("moderation-timeouts", title, None, body, cx)
            .flex_1()
            .into_any_element()
    }

    fn log_card(&self, phone: bool, cx: &mut Context<Self>) -> AnyElement {
        let sem = cx.sem().clone();
        if !self.caps.view_moderation_log {
            return card(
                "moderation-log",
                "Moderation Log",
                None,
                locked_note(
                    "log-locked",
                    "You need the \u{201c}View moderation logs\u{201d} permission",
                    cx,
                ),
                cx,
            )
            .into_any_element();
        }
        let filter = div()
            .when(phone, |filter| filter.w_full())
            .when(!phone, |filter| filter.w(px(220.)))
            .child(SelectField::new(
                "log-filter",
                &self.filter,
                "Filter by Action",
            ));
        let body: AnyElement = match &self.log.state {
            LoadState::Loading => loading_rows("log-loading", "Loading the moderation log", 4),
            LoadState::Failed { .. } => {
                Self::failed("log-retry", "Failed to load the moderation log", cx)
            }
            LoadState::Ready if self.log.rows.is_empty() => {
                empty_line("No moderation logs found", cx).into_any_element()
            }
            LoadState::Ready => {
                let rows: Vec<_> = self
                    .log
                    .rows
                    .iter()
                    .map(|entry| self.log_row(entry, cx))
                    .collect();
                let shown = self.log.rows.len();
                let total = self.log.total;
                let more = shown < total as usize;
                let footer = div()
                    .pt(spacing(1.))
                    .flex()
                    .flex_wrap()
                    .items_center()
                    .justify_between()
                    .gap(spacing(1.))
                    .child(
                        text(Variant::Caption, log_count(shown, total))
                            .text_color(sem.text_secondary),
                    )
                    .child(if self.log.loading_more {
                        div()
                            .id("log-more-loading")
                            .test_support()
                            .role(Role::ProgressIndicator)
                            .aria_label("Loading more")
                            .flex()
                            .items_center()
                            .gap(spacing(1.))
                            .child(Spinner::new("log-more-spinner").size(18.))
                            .child(
                                text(Variant::Body2, "Loading more\u{2026}")
                                    .text_color(sem.text_secondary),
                            )
                            .into_any_element()
                    } else if more {
                        Button::new("log-more", "Load more")
                            .outlined()
                            .size(ButtonSize::Small)
                            .on_click(
                                cx.listener(|_, _, _, cx| cx.emit(ModerationTabEvent::MoreLog)),
                            )
                            .into_any_element()
                    } else {
                        text(Variant::Caption, "End of the log")
                            .text_color(sem.text_secondary)
                            .into_any_element()
                    });
                div()
                    .flex()
                    .flex_col()
                    .gap(spacing(1.))
                    .child(list("log-list", "Moderation log").children(rows))
                    .child(footer)
                    .into_any_element()
            }
        };
        card(
            "moderation-log",
            "Moderation Log",
            None,
            div()
                .flex()
                .flex_col()
                .gap(spacing(2.))
                .child(filter)
                .child(body),
            cx,
        )
        .into_any_element()
    }
}

impl Render for ModerationTab {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        self.sync_filter(window, cx);
        self.tick(window, cx);
        let sem = cx.sem().clone();
        let phone = is_phone(window);
        let now = now_ms(&self.time);
        let heading = div()
            .flex()
            .flex_col()
            .gap(px(2.))
            .child(text(Variant::H6, "Moderation").text_color(sem.text_primary))
            .child(
                text(
                    Variant::Body2,
                    "Bans, timeouts and what moderators have done here.",
                )
                .text_color(sem.text_secondary),
            );
        let body: AnyElement = if !self.caps.view_bans && !self.caps.view_moderation_log {
            Alert::new(
                Severity::Warning,
                "You don't have permission to view moderation tools.",
            )
            .into_any_element()
        } else {
            let lists = div()
                .w_full()
                .flex()
                .gap(spacing(3.))
                .when(phone, |lists| lists.flex_col())
                .when(!phone, |lists| lists.flex_wrap().items_start())
                .child(
                    div()
                        .flex_1()
                        .when(!phone, |side| side.min_w(px(300.)))
                        .child(self.bans_card(now, cx)),
                )
                .child(
                    div()
                        .flex_1()
                        .when(!phone, |side| side.min_w(px(300.)))
                        .child(self.timeouts_card(now, cx)),
                );
            div()
                .flex()
                .flex_col()
                .gap(spacing(3.))
                .child(lists)
                .child(self.log_card(phone, cx))
                .into_any_element()
        };
        div()
            .id("community-moderation")
            .test_support()
            .role(Role::Region)
            .aria_label("Moderation")
            .size_full()
            .flex()
            .flex_col()
            .bg(sem.background_default)
            .child(
                div()
                    .id("community-moderation-scroll")
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scroll()
                    .p(spacing(if phone { 2. } else { 3. }))
                    .flex()
                    .flex_col()
                    .gap(spacing(2.))
                    .child(heading)
                    .child(body),
            )
    }
}
