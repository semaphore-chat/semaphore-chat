//! The sessions tab, after `Settings/SessionsSettings.tsx`: each signed-in device with when it was
//! last used, a revoke button on all but this one, and "Sign out all other devices" behind a
//! confirm.

use super::shell::{caption, tab_page};
use super::{SessionsEvent, SessionsSettings};
use crate::kit::{Alert, Button, Chip, Dialog, Skeleton, Spinner, Variant, spacing, text};
use crate::panel::common::{design_icon, error_block, icon_button, relative_time};
use crate::theme::SemTheme;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{LoadState, SessionRow};
use semaphore_design::Icon as DesignIcon;

/// The row's name: the device the server recorded, or "Unknown device".
pub fn session_device_name(row: &SessionRow) -> String {
    row.device_name
        .as_deref()
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .unwrap_or("Unknown device")
        .to_owned()
}

fn date(ms: i64) -> String {
    chrono::DateTime::from_timestamp_millis(ms)
        .map(|date| date.format("%b %-d, %Y").to_string())
        .unwrap_or_default()
}

/// The lines under a row's name, from `now_ms`: "Last active: 5 minutes ago", then the IP when
/// there is one, then "Signed in Nov 1, 2026 · Expires Dec 1, 2026".
pub fn session_details(row: &SessionRow, now_ms: i64) -> Vec<String> {
    let mut lines = vec![format!(
        "Last active: {}",
        relative_time(now_ms, row.last_used_at_ms)
    )];
    if let Some(ip) = row.ip_address.as_deref().filter(|ip| !ip.is_empty()) {
        lines.push(format!("IP: {ip}"));
    }
    lines.push(format!(
        "Signed in {} · Expires {}",
        date(row.created_at_ms),
        date(row.expires_at_ms)
    ));
    lines
}

/// The web's `getDeviceIcon`.
fn device_icon(name: &str) -> DesignIcon {
    let name = name.to_lowercase();
    if ["android", "iphone", "ipad"]
        .iter()
        .any(|n| name.contains(n))
    {
        DesignIcon::Smartphone
    } else if ["desktop", "electron", "native"]
        .iter()
        .any(|n| name.contains(n))
    {
        DesignIcon::Computer
    } else {
        DesignIcon::Laptop
    }
}

impl SessionsSettings {
    fn others(&self) -> usize {
        self.view
            .sessions
            .iter()
            .filter(|row| !row.is_current)
            .count()
    }

    fn row(&self, row: &SessionRow, now_ms: i64, cx: &mut Context<Self>) -> AnyElement {
        let sem = cx.sem().clone();
        let name = session_device_name(row);
        let details = session_details(row, now_ms);
        let trailing: Option<AnyElement> = if row.is_current {
            None
        } else if row.busy {
            Some(
                div()
                    .id(SharedString::from(format!("session-busy-{}", row.id)))
                    .test_support()
                    .role(Role::ProgressIndicator)
                    .aria_label("Signing out this device")
                    .size(px(34.))
                    .flex()
                    .items_center()
                    .justify_center()
                    .child(
                        Spinner::new(SharedString::from(format!("session-spinner-{}", row.id)))
                            .size(20.),
                    )
                    .into_any_element(),
            )
        } else {
            let id = row.id.clone();
            Some(
                icon_button(
                    SharedString::from(format!("session-revoke-{}", row.id)),
                    DesignIcon::Delete,
                    format!("Sign out {name}"),
                    false,
                    sem.error,
                    cx,
                )
                .on_click(cx.listener(move |_, _, _, cx| {
                    cx.emit(SessionsEvent::Revoke {
                        session_id: id.clone(),
                    })
                }))
                .into_any_element(),
            )
        };
        let current_chip = row
            .is_current
            .then(|| Chip::new("Current").colors(transparent_black(), sem.primary, sem.primary));
        div()
            .id(SharedString::from(format!("session-{}", row.id)))
            .test_support()
            .role(Role::ListItem)
            .aria_label(SharedString::from(name.clone()))
            .flex()
            .items_start()
            .gap(spacing(2.))
            .px(spacing(2.))
            .py(spacing(1.5))
            .rounded(px(4.))
            .border_1()
            .border_color(if row.is_current {
                sem.primary
            } else {
                transparent_black()
            })
            .when(row.is_current, |row| row.bg(sem.action_selected))
            .child(
                div()
                    .pt(px(2.))
                    .child(design_icon(device_icon(&name), 24., sem.action_active)),
            )
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .flex()
                    .flex_col()
                    .gap(px(2.))
                    .child(
                        div()
                            .flex()
                            .flex_wrap()
                            .items_center()
                            .gap(spacing(1.))
                            .child(
                                text(Variant::Body1, name)
                                    .min_w_0()
                                    .text_color(sem.text_primary),
                            )
                            .children(current_chip),
                    )
                    .children(details.into_iter().enumerate().map(|(index, line)| {
                        text(
                            if index == 0 {
                                Variant::Body2
                            } else {
                                Variant::Caption
                            },
                            line,
                        )
                        .text_color(sem.text_secondary)
                    })),
            )
            .children(trailing)
            .into_any_element()
    }

    fn list(&self, cx: &mut Context<Self>) -> AnyElement {
        let sem = cx.sem().clone();
        match &self.view.state {
            LoadState::Loading => div()
                .id("sessions-loading")
                .test_support()
                .role(Role::ProgressIndicator)
                .aria_label("Loading sessions")
                .flex()
                .flex_col()
                .gap(spacing(1.))
                .children((0..3usize).map(|index| {
                    div()
                        .flex()
                        .items_center()
                        .gap(spacing(2.))
                        .px(spacing(2.))
                        .py(spacing(1.))
                        .child(Skeleton::circle(("session-skeleton-icon", index), 24.))
                        .child(
                            div()
                                .flex_1()
                                .flex()
                                .flex_col()
                                .gap(px(6.))
                                .child(Skeleton::rect(
                                    ("session-skeleton-a", index),
                                    relative(0.6),
                                    18.,
                                ))
                                .child(Skeleton::rect(
                                    ("session-skeleton-b", index),
                                    relative(0.4),
                                    14.,
                                )),
                        )
                }))
                .into_any_element(),
            LoadState::Failed { .. } => error_block(
                "sessions-retry",
                "Failed to load sessions",
                "Check your connection and try again.",
                cx.listener(|_, _, _, cx| cx.emit(SessionsEvent::Retry)),
                cx,
            ),
            LoadState::Ready if self.view.sessions.is_empty() => {
                text(Variant::Body2, "No active sessions found.")
                    .text_color(sem.text_secondary)
                    .into_any_element()
            }
            LoadState::Ready => {
                let now = self.clock.now_ms();
                let rows: Vec<_> = self
                    .view
                    .sessions
                    .iter()
                    .map(|row| self.row(row, now, cx))
                    .collect();
                div()
                    .id("sessions-list")
                    .test_support()
                    .role(Role::List)
                    .aria_label("Active sessions")
                    .flex()
                    .flex_col()
                    .gap(spacing(1.))
                    .children(rows)
                    .into_any_element()
            }
        }
    }
}

impl Render for SessionsSettings {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let others = self.others();
        let ready = matches!(self.view.state, LoadState::Ready);
        let revoking = self.view.revoking_others;
        let sign_out_all = (ready && others > 0).then(|| {
            div().flex().justify_end().child(
                Button::new("sessions-revoke-others", "Sign out all other devices")
                    .outlined()
                    .color(cx.sem().error)
                    .start_icon(DesignIcon::Logout)
                    .loading(revoking)
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.confirming = true;
                        cx.notify();
                    })),
            )
        });
        let body = div()
            .flex()
            .flex_col()
            .gap(spacing(2.))
            .child(caption(
                "Manage your active sessions across devices. You can sign out of any session to protect your account.",
                cx,
            ))
            .children(
                self.notice
                    .as_ref()
                    .map(|(severity, message)| Alert::new(*severity, message.clone())),
            )
            .child(self.list(cx))
            .children(sign_out_all);
        let dialog = (self.confirming && others > 0).then(|| {
            let close = cx.weak_entity();
            let cancel = cx.weak_entity();
            let confirm = cx.weak_entity();
            let noun = if others == 1 { "device" } else { "devices" };
            Dialog::new("Sign out other devices?")
                .body(text(
                    Variant::Body2,
                    format!(
                        "This signs you out on {others} other {noun}. You'll stay signed in here."
                    ),
                ))
                .action(Button::new("sessions-confirm-cancel", "Cancel").on_click(
                    move |_, _, cx| {
                        cancel
                            .update(cx, |this, cx| {
                                this.confirming = false;
                                cx.notify();
                            })
                            .ok();
                    },
                ))
                .action(
                    Button::new("sessions-confirm-revoke", "Sign out all")
                        .contained()
                        .color(cx.sem().error)
                        .on_click(move |_, _, cx| {
                            confirm
                                .update(cx, |this, cx| {
                                    this.confirming = false;
                                    cx.emit(SessionsEvent::RevokeOthers);
                                    cx.notify();
                                })
                                .ok();
                        }),
                )
                .on_close(move |_, cx| {
                    close
                        .update(cx, |this, cx| {
                            this.confirming = false;
                            cx.notify();
                        })
                        .ok();
                })
        });
        div()
            .relative()
            .size_full()
            .child(tab_page(
                "sessions-settings",
                DesignIcon::Devices,
                "Active Sessions",
                Vec::new(),
                body,
                cx,
            ))
            .children(dialog)
    }
}
