//! UA2: the admin dashboard: stats tiles, server health and the attention items, after
//! `pages/admin/AdminDashboard.tsx` and `adminAttention.ts`.
//!
//! Frozen by the UI freeze: the public API below (`new`, the setters and `DashboardEvent`) is what the app
//! wiring lane builds against while UA2 draws the screen; change it only with the coordinator.
//!
//! Nothing here judges the instance: the attention items, their severity, order and targets are
//! core's (`AdminDashboardView::attention`), and the disk bar takes its colour from the `Disk` item.
//! What this user may open comes from `InstanceAdminCaps`.

use crate::community_settings::common::{locked_button, locked_note, page, phone};
use crate::community_settings::rules::needs;
use crate::kit::{Button, Skeleton, Variant, link, spacing, text, with_tip};
use crate::panel::common::{design_icon, error_block};
use crate::theme::SemTheme;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::component::progress::Progress as KitProgress;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{
    AdminDashboardView, AdminPage, AttentionId, AttentionItem, AttentionSeverity, AttentionTarget,
    InstanceAdminCaps, InstanceStats, InstanceStorage, LoadState,
};
use semaphore_design::Icon as DesignIcon;

#[cfg(any(test, feature = "stories"))]
mod fixtures;
#[cfg(feature = "stories")]
mod stories;
#[cfg(test)]
mod tests;

#[derive(Debug, Clone, PartialEq)]
pub enum DashboardEvent {
    /// An attention item's action or a tile: open an admin page (Storage with its filter).
    Open {
        page: AdminPage,
        storage_min_percent: Option<u32>,
    },
    /// The LiveKit item's "Setup guide": open the URL in the browser.
    OpenUrl(String),
    /// The read failed and the user asked again: `Core::retry_failed`.
    Retry,
}

pub struct DashboardPage {
    caps: InstanceAdminCaps,
    view: AdminDashboardView,
}

impl EventEmitter<DashboardEvent> for DashboardPage {}

impl DashboardPage {
    pub fn new(_window: &mut Window, _cx: &mut Context<Self>) -> Self {
        Self {
            caps: InstanceAdminCaps::default(),
            view: AdminDashboardView::default(),
        }
    }

    /// What this user may do on the instance (`InstancePermissionsView::admin`).
    pub fn set_caps(&mut self, caps: InstanceAdminCaps, cx: &mut Context<Self>) {
        self.caps = caps;
        cx.notify();
    }

    /// `Core::admin_dashboard()`.
    pub fn set_view(&mut self, view: AdminDashboardView, cx: &mut Context<Self>) {
        self.view = view;
        cx.notify();
    }
}

/// Window widths from which the totals sit six to a row, as the web's 1200px container query.
const SIX_TILES_FROM: f32 = 1600.;

/// Why this user can't open `page`, or `None` when they can: the admin shell's rule, from the caps.
fn page_locked(caps: &InstanceAdminCaps, page: AdminPage) -> Option<String> {
    let (allowed, permission) = match page {
        AdminPage::Dashboard => (caps.dashboard, "Read instance stats"),
        AdminPage::Users => (caps.users_read, "Read users"),
        AdminPage::Communities => (caps.communities_read, "Read all communities"),
        AdminPage::Invites => (caps.invites_read, "Read instance invites"),
        AdminPage::Roles => (caps.roles_read, "Read instance settings"),
        AdminPage::Storage => (caps.storage, "Manage user storage"),
        AdminPage::Settings => (caps.settings_read, "Read instance settings"),
    };
    (!allowed).then(|| needs(permission))
}

/// One totals tile: what it counts and the page it opens.
struct Tile {
    id: &'static str,
    label: &'static str,
    value: u64,
    icon: DesignIcon,
    page: Option<AdminPage>,
}

fn tiles(stats: &InstanceStats) -> [Tile; 6] {
    [
        Tile {
            id: "admin-tile-users",
            label: "Users",
            value: stats.total_users,
            icon: DesignIcon::People,
            page: Some(AdminPage::Users),
        },
        Tile {
            id: "admin-tile-communities",
            label: "Communities",
            value: stats.total_communities,
            icon: DesignIcon::Groups,
            page: Some(AdminPage::Communities),
        },
        Tile {
            id: "admin-tile-channels",
            label: "Channels",
            value: stats.total_channels,
            // The web's Chat icon; in this icon set it draws the same as Message, so Forum tells them apart.
            icon: DesignIcon::Forum,
            page: Some(AdminPage::Communities),
        },
        Tile {
            id: "admin-tile-messages",
            label: "Messages",
            value: stats.total_messages,
            icon: DesignIcon::Message,
            page: None,
        },
        Tile {
            id: "admin-tile-invites",
            label: "Active invites",
            value: stats.active_invites,
            icon: DesignIcon::Link,
            page: Some(AdminPage::Invites),
        },
        Tile {
            id: "admin-tile-banned",
            label: "Banned users",
            value: stats.banned_users,
            icon: DesignIcon::Block,
            // Gap: the web opens Users filtered to banned users; the frozen `Open` event has no users filter.
            page: Some(AdminPage::Users),
        },
    ]
}

/// The element ids of an attention row, its action and the action's lock note.
fn attention_ids(id: AttentionId) -> (&'static str, &'static str, &'static str) {
    match id {
        AttentionId::Disk => (
            "admin-attention-disk",
            "admin-attention-disk-action",
            "admin-attention-disk-locked",
        ),
        AttentionId::OverQuota => (
            "admin-attention-over-quota",
            "admin-attention-over-quota-action",
            "admin-attention-over-quota-locked",
        ),
        AttentionId::StorageUnavailable => (
            "admin-attention-storage-unavailable",
            "admin-attention-storage-unavailable-action",
            "admin-attention-storage-unavailable-locked",
        ),
        AttentionId::Livekit => (
            "admin-attention-livekit",
            "admin-attention-livekit-action",
            "admin-attention-livekit-locked",
        ),
    }
}

fn severity_color(severity: AttentionSeverity, cx: &App) -> Hsla {
    let sem = cx.sem();
    match severity {
        AttentionSeverity::Error => sem.error,
        AttentionSeverity::Warning => sem.warning,
    }
}

impl DashboardPage {
    fn heading(&self, title: &'static str, action: Option<AnyElement>, cx: &App) -> Div {
        div()
            .flex()
            .flex_wrap()
            .items_center()
            .justify_between()
            .gap(spacing(2.))
            .child(
                text(Variant::Subtitle1, title)
                    .font_weight(FontWeight::BOLD)
                    .text_color(cx.sem().text_primary),
            )
            .children(action)
    }

    fn attention(&self, narrow: bool, cx: &mut Context<Self>) -> AnyElement {
        let sem = cx.sem().clone();
        let items = &self.view.attention;
        let storage_failed = items
            .iter()
            .any(|item| item.id == AttentionId::StorageUnavailable);
        // Core has no "storage still loading" flag: no storage and no StorageUnavailable item means
        // the storage read hasn't answered yet, so its checks aren't known either (the web's skeleton).
        if self.view.storage.is_none() && !storage_failed {
            return div()
                .id("admin-attention-loading")
                .test_support()
                .role(Role::ProgressIndicator)
                .aria_label("Checking instance health")
                .child(Skeleton::rect(
                    "admin-attention-skeleton",
                    relative(1.),
                    48.,
                ))
                .into_any_element();
        }
        if items.is_empty() {
            return div()
                .id("admin-attention-all-good")
                .test_support()
                .role(Role::Status)
                .aria_label("All good: nothing needs attention.")
                .flex()
                .items_center()
                .gap(spacing(1.))
                .child(design_icon(
                    DesignIcon::CheckCircleOutline,
                    24.,
                    sem.success,
                ))
                .child(
                    text(Variant::Body1, "All good: nothing needs attention.")
                        .text_color(sem.text_secondary),
                )
                .into_any_element();
        }
        let rows: Vec<AnyElement> = items
            .iter()
            .map(|item| self.attention_row(item, narrow, cx))
            .collect();
        div()
            .flex()
            .flex_col()
            .gap(spacing(1.5))
            .child(self.heading("Needs attention", None, cx))
            .child(
                div()
                    .id("admin-attention")
                    .test_support()
                    .role(Role::List)
                    .aria_label("Needs attention")
                    .flex()
                    .flex_col()
                    .gap(spacing(1.))
                    .children(rows),
            )
            .into_any_element()
    }

    fn attention_row(
        &self,
        item: &AttentionItem,
        narrow: bool,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let sem = cx.sem().clone();
        let color = severity_color(item.severity, cx);
        let (row_id, action_id, locked_id) = attention_ids(item.id);
        let icon = match item.severity {
            AttentionSeverity::Error => DesignIcon::ErrorOutline,
            AttentionSeverity::Warning => DesignIcon::WarningAmber,
        };
        let (event, locked) = match &item.target {
            AttentionTarget::Page {
                page,
                storage_min_percent,
            } => (
                DashboardEvent::Open {
                    page: *page,
                    storage_min_percent: *storage_min_percent,
                },
                page_locked(&self.caps, *page),
            ),
            AttentionTarget::Url { url } => (DashboardEvent::OpenUrl(url.clone()), None),
            AttentionTarget::Retry => (DashboardEvent::Retry, None),
        };
        let mut button = Button::new(action_id, item.action_label.clone()).color(color);
        if matches!(item.target, AttentionTarget::Url { .. }) {
            button = button.start_icon(DesignIcon::OpenInNew);
        }
        if locked.is_none() {
            button = button.on_click(cx.listener(move |_, _: &ClickEvent, _, cx| {
                cx.emit(event.clone());
            }));
        }
        let action = locked_button(button, locked_id, locked, cx);
        let words =
            div()
                .flex_1()
                .min_w_0()
                .flex()
                .items_start()
                .gap(spacing(1.5))
                .py(px(4.))
                .child(div().mt(px(2.)).child(design_icon(icon, 24., color)))
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .flex()
                        .flex_col()
                        .child(
                            text(Variant::Body1, item.title.clone())
                                .font_weight(FontWeight(600.))
                                .text_color(sem.text_primary),
                        )
                        .children(item.detail.clone().map(|detail| {
                            text(Variant::Body2, detail).text_color(sem.text_secondary)
                        })),
                );
        // MUI paints the severity as a 4px left border on an outlined Paper; gpui has one border
        // colour per element, so the stripe is its own strip inside the row.
        div()
            .id(row_id)
            .test_support()
            .role(Role::ListItem)
            .aria_label(item.title.clone())
            .w_full()
            .flex()
            .rounded(px(4.))
            .overflow_hidden()
            .border_1()
            .border_color(sem.divider)
            .bg(color.opacity(0.08))
            .child(div().w(px(4.)).flex_none().bg(color))
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .flex()
                    .when(narrow, |row| row.flex_col().gap(px(4.)))
                    .when(!narrow, |row| row.items_center().gap(spacing(2.)))
                    .py(spacing(1.))
                    .pl(px(12.))
                    .pr(spacing(1.))
                    .child(words)
                    .child(
                        div()
                            .flex_none()
                            .flex()
                            .when(narrow, |action| action.justify_end())
                            .child(action),
                    ),
            )
            .into_any_element()
    }

    fn totals(&self, window: &Window, cx: &mut Context<Self>) -> AnyElement {
        let narrow = phone(window);
        let width = f32::from(window.viewport_size().width);
        let per_row = if narrow {
            2
        } else if width >= SIX_TILES_FROM {
            6
        } else {
            3
        };
        let cells: Vec<AnyElement> = match &self.view.stats {
            Some(stats) => tiles(stats)
                .into_iter()
                .map(|tile| self.tile(tile, narrow, cx))
                .collect(),
            None => (0..6).map(|index| tile_skeleton(index, cx)).collect(),
        };
        let mut rows = Vec::new();
        let mut cells = cells.into_iter().peekable();
        while cells.peek().is_some() {
            let row: Vec<AnyElement> = cells
                .by_ref()
                .take(per_row)
                .map(|cell| {
                    div()
                        .flex_1()
                        .min_w_0()
                        .flex()
                        .child(cell)
                        .into_any_element()
                })
                .collect();
            rows.push(
                div()
                    .flex()
                    .gap(spacing(if narrow { 1.5 } else { 2. }))
                    .children(row),
            );
        }
        div()
            .flex()
            .flex_col()
            .gap(spacing(1.5))
            .child(self.heading("Totals", None, cx))
            .child(
                div()
                    .id("admin-totals")
                    .test_support()
                    .role(Role::Group)
                    .aria_label("Totals")
                    .flex()
                    .flex_col()
                    .gap(spacing(if narrow { 1.5 } else { 2. }))
                    .children(rows),
            )
            .into_any_element()
    }

    fn tile(&self, tile: Tile, narrow: bool, cx: &mut Context<Self>) -> AnyElement {
        let sem = cx.sem().clone();
        let locked = tile.page.and_then(|page| page_locked(&self.caps, page));
        let opens = tile.page.filter(|_| locked.is_none());
        let chevron = || design_icon(DesignIcon::ChevronRight, 24., sem.text_disabled);
        let icon = design_icon(tile.icon, 24., sem.text_secondary);
        let words = div()
            .flex_1()
            .min_w_0()
            .flex()
            .flex_col()
            .child(
                text(Variant::H5, count_label(tile.value))
                    .font_weight(FontWeight::BOLD)
                    .line_height(relative(1.2))
                    .text_color(sem.text_primary),
            )
            .child(text(Variant::Body2, tile.label).text_color(sem.text_secondary));
        let body = if narrow {
            // Phone: icon and chevron on a top row, the number and label below at the tile's width.
            div()
                .flex()
                .flex_col()
                .gap(px(4.))
                .child(
                    div()
                        .flex()
                        .items_center()
                        .justify_between()
                        .child(icon)
                        .children(opens.map(|_| chevron())),
                )
                .child(words)
        } else {
            div()
                .flex()
                .items_center()
                .gap(spacing(1.5))
                .child(icon)
                .child(words)
                .children(opens.map(|_| chevron()))
        };
        let frame = div()
            .id(tile.id)
            .test_support()
            .aria_label(format!("{}: {}", tile.label, grouped(tile.value)))
            .w_full()
            .p(spacing(2.))
            .rounded(px(8.))
            .border_1()
            .border_color(sem.divider)
            .bg(sem.paper)
            .child(body);
        match (opens, locked) {
            (Some(page), _) => {
                let hover = sem.action_hover;
                frame
                    .role(Role::Link)
                    .cursor_pointer()
                    .hover(move |style| style.bg(hover))
                    .on_click(cx.listener(move |_, _: &ClickEvent, _, cx| {
                        cx.emit(DashboardEvent::Open {
                            page,
                            storage_min_percent: None,
                        });
                    }))
                    .into_any_element()
            }
            (None, Some(reason)) => with_tip(frame.role(Role::Group), reason).into_any_element(),
            (None, None) => frame.role(Role::Group).into_any_element(),
        }
    }

    fn storage_section(&self, narrow: bool, cx: &mut Context<Self>) -> Option<AnyElement> {
        // A failed storage read shows as the StorageUnavailable item instead of this section.
        if self
            .view
            .attention
            .iter()
            .any(|item| item.id == AttentionId::StorageUnavailable)
        {
            return None;
        }
        let action = match page_locked(&self.caps, AdminPage::Storage) {
            None => {
                let entity = cx.entity();
                link("admin-view-storage", "View storage", cx, move |_, cx| {
                    entity.update(cx, |_, cx| {
                        cx.emit(DashboardEvent::Open {
                            page: AdminPage::Storage,
                            storage_min_percent: None,
                        })
                    })
                })
                .into_any_element()
            }
            Some(reason) => locked_note("admin-view-storage-locked", reason, cx)
                .max_w(px(320.))
                .into_any_element(),
        };
        let body = match &self.view.storage {
            Some(storage) => self.storage_card(storage, narrow, cx),
            None => div()
                .id("admin-storage-loading")
                .test_support()
                .role(Role::ProgressIndicator)
                .aria_label("Loading storage and server status")
                .child(Skeleton::rect("admin-storage-skeleton", relative(1.), 220.))
                .into_any_element(),
        };
        Some(
            div()
                .flex()
                .flex_col()
                .gap(spacing(1.5))
                .child(self.heading("Storage & server", Some(action), cx))
                .child(body)
                .into_any_element(),
        )
    }

    fn storage_card(&self, storage: &InstanceStorage, narrow: bool, cx: &App) -> AnyElement {
        let sem = cx.sem();
        let server = &storage.server;
        let disk_color = self
            .view
            .attention
            .iter()
            .find(|item| item.id == AttentionId::Disk)
            .map(|item| severity_color(item.severity, cx));
        let mut left = div().flex_1().min_w_0().flex().flex_col();
        if server.disk_total_bytes > 0 {
            left = left.child(usage_bar(
                "admin-disk-bar",
                "Server disk",
                server.disk_used_bytes,
                server.disk_total_bytes,
                server.disk_used_percent,
                disk_color,
                cx,
            ));
        }
        let load = if server.load_average.is_empty() {
            "—".to_owned()
        } else {
            server
                .load_average
                .iter()
                .map(|load| format!("{load:.2}"))
                .collect::<Vec<_>>()
                .join(", ")
        };
        left = left
            .child(usage_bar(
                "admin-memory-bar",
                "Server memory",
                server.memory_used_bytes,
                server.memory_total_bytes,
                server.memory_used_percent,
                None,
                cx,
            ))
            .child(info_row("CPU", format!("{} cores", server.cpu_cores), cx))
            .child(info_row("Load average", load, cx))
            .child(info_row("Uptime", uptime_label(server.uptime_secs), cx))
            .child(info_row(
                "Platform",
                format!("{} ({})", server.platform, server.hostname),
                cx,
            ));
        let right = div()
            .flex_1()
            .min_w_0()
            .flex()
            .flex_col()
            .child(info_row(
                "Files stored",
                format!(
                    "{} in {} files",
                    bytes_label(storage.total_used_bytes),
                    grouped(storage.total_files)
                ),
                cx,
            ))
            .child(info_row(
                "Avg per user",
                bytes_label(storage.average_per_user_bytes),
                cx,
            ))
            .child(info_row(
                "Default quota",
                bytes_label(storage.default_quota_bytes),
                cx,
            ))
            .child(info_row(
                "Max file size",
                bytes_label(storage.max_file_bytes),
                cx,
            ))
            .child(info_row(
                "Users at 75–90% of quota",
                grouped(storage.users_approaching_quota),
                cx,
            ))
            .when(!storage.by_kind.is_empty(), |right| {
                right
                    .child(
                        text(Variant::Body2, "By type")
                            .text_color(sem.text_secondary)
                            .mt(spacing(1.5))
                            .mb(px(4.)),
                    )
                    .children(storage.by_kind.iter().map(|kind| {
                        info_row(
                            kind.kind.replace('_', " ").to_lowercase(),
                            format!(
                                "{} · {} files",
                                bytes_label(kind.bytes),
                                grouped(kind.count)
                            ),
                            cx,
                        )
                    }))
            });
        div()
            .id("admin-storage-card")
            .test_support()
            .role(Role::Group)
            .aria_label("Storage & server")
            .w_full()
            .p(spacing(2.))
            .rounded(px(8.))
            .border_1()
            .border_color(sem.divider)
            .bg(sem.paper)
            .flex()
            .when(narrow, |card| card.flex_col().gap(spacing(2.)))
            .when(!narrow, |card| card.gap(spacing(4.)))
            .child(left)
            .child(right)
            .into_any_element()
    }
}

/// A label and its value on one line, the value bold at the right (the web's `Row`).
fn info_row(label: impl Into<SharedString>, value: impl Into<SharedString>, cx: &App) -> Div {
    let sem = cx.sem();
    div()
        .flex()
        .justify_between()
        .gap(spacing(2.))
        .py(px(4.))
        .child(
            // A long label (a storage type's name) wraps rather than squeezing the value to a
            // column of single characters on a phone.
            text(Variant::Body2, label)
                .min_w_0()
                .max_w(relative(0.6))
                .text_color(sem.text_secondary),
        )
        .child(
            text(Variant::Body2, value)
                .flex_1()
                .min_w_0()
                .text_right()
                .font_weight(FontWeight::BOLD)
                .text_color(sem.text_primary),
        )
}

/// A resource's use: its row, then a 6px bar.
///
/// The kit's `LinearProgress` always paints the accent, which would hide the disk's warning and
/// error states (the web sets the colour explicitly for the same reason), so this draws the gpui-kit
/// bar the kit wraps, in the severity's colour on a 20% track of it. Private to the dashboard.
fn usage_bar(
    id: &'static str,
    label: &'static str,
    used: u64,
    total: u64,
    percent: f64,
    color: Option<Hsla>,
    cx: &App,
) -> Div {
    let sem = cx.sem();
    let (bar, track) = match color {
        Some(color) => (color, color.opacity(0.2)),
        None => (sem.progress_bar, sem.progress_track),
    };
    let shown = percent.round();
    div()
        .py(px(4.))
        .flex()
        .flex_col()
        .child(info_row(
            label,
            format!("{} / {} ({shown}%)", bytes_label(used), bytes_label(total)),
            cx,
        ))
        .child(
            div().mt(px(4.)).child(
                KitProgress::new(id)
                    .accessibility_label(format!("{label} {shown}% used"))
                    .color(bar)
                    .value(percent.clamp(0., 100.) as f32)
                    .loading(false)
                    .h(px(6.))
                    .rounded(px(4.))
                    .bg(track),
            ),
        )
}

fn tile_skeleton(index: usize, cx: &App) -> AnyElement {
    let sem = cx.sem();
    div()
        .w_full()
        .p(spacing(2.))
        .rounded(px(8.))
        .border_1()
        .border_color(sem.divider)
        .bg(sem.paper)
        .flex()
        .items_center()
        .gap(spacing(1.5))
        .child(Skeleton::circle(("admin-tile-skeleton", index * 3), 24.))
        .child(
            div()
                .flex_1()
                .flex()
                .flex_col()
                .gap(px(6.))
                .child(Skeleton::rect(
                    ("admin-tile-skeleton", index * 3 + 1),
                    relative(0.5),
                    26.,
                ))
                .child(Skeleton::rect(
                    ("admin-tile-skeleton", index * 3 + 2),
                    relative(0.7),
                    16.,
                )),
        )
        .into_any_element()
}

/// `n.toLocaleString()` in English: thousands separated by commas.
fn grouped(n: u64) -> String {
    let digits = n.to_string();
    let mut out = String::with_capacity(digits.len() + digits.len() / 3);
    for (index, digit) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index).is_multiple_of(3) {
            out.push(',');
        }
        out.push(digit);
    }
    out
}

/// A tile's number: grouped below a million, from there compact with one decimal ("1.2M"), as the
/// web's `Intl.NumberFormat(.., { notation: "compact", maximumFractionDigits: 1 })`.
fn count_label(n: u64) -> String {
    const UNITS: [(f64, &str); 3] = [(1e6, "M"), (1e9, "B"), (1e12, "T")];
    if n < 1_000_000 {
        return grouped(n);
    }
    let value = n as f64;
    let mut unit = 0;
    while unit + 1 < UNITS.len() && value >= UNITS[unit + 1].0 {
        unit += 1;
    }
    let mut scaled = (value / UNITS[unit].0 * 10.).round() / 10.;
    // 999.95M rounds to 1000M: Intl moves it up a unit.
    if scaled >= 1000. && unit + 1 < UNITS.len() {
        unit += 1;
        scaled = (value / UNITS[unit].0 * 10.).round() / 10.;
    }
    format!("{scaled}{}", UNITS[unit].1)
}

/// The web's `formatUptime`: days and hours, hours and minutes, or minutes.
fn uptime_label(seconds: u64) -> String {
    let days = seconds / 86_400;
    let hours = seconds % 86_400 / 3_600;
    let minutes = seconds % 3_600 / 60;
    if days > 0 {
        format!("{days}d {hours}h")
    } else if hours > 0 {
        format!("{hours}h {minutes}m")
    } else {
        format!("{minutes}m")
    }
}

/// The web's `formatFileSize`: 1024-based units, at most two decimals, "0 Bytes" for nothing.
fn bytes_label(bytes: u64) -> String {
    const UNITS: [&str; 6] = ["Bytes", "KB", "MB", "GB", "TB", "PB"];
    if bytes == 0 {
        return "0 Bytes".into();
    }
    let value = bytes as f64;
    let mut unit = 0;
    while unit + 1 < UNITS.len() && value >= 1024f64.powi(unit as i32 + 1) {
        unit += 1;
    }
    let scaled = (value / 1024f64.powi(unit as i32) * 100.).round() / 100.;
    format!("{scaled} {}", UNITS[unit])
}

impl Render for DashboardPage {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let narrow = phone(window);
        let body = if !self.caps.dashboard {
            locked_note("admin-dashboard-denied", needs("Read instance stats"), cx)
                .into_any_element()
        } else if let LoadState::Failed { error } = &self.view.state {
            error_block(
                "admin-dashboard-retry",
                "Couldn't load the admin dashboard",
                error.message.clone(),
                cx.listener(|_, _: &ClickEvent, _, cx| cx.emit(DashboardEvent::Retry)),
                cx,
            )
        } else {
            let attention = self.attention(narrow, cx);
            let totals = self.totals(window, cx);
            let storage = self.storage_section(narrow, cx);
            div()
                .flex()
                .flex_col()
                .gap(spacing(4.))
                .child(attention)
                .child(totals)
                .children(storage)
                .into_any_element()
        };
        page(
            "admin-dashboard",
            "Dashboard",
            Some("Overview of your instance".into()),
            Vec::new(),
            body,
            window,
            cx,
        )
    }
}

#[cfg(feature = "stories")]
pub fn stories() -> Vec<crate::stories::Story> {
    stories::stories()
}
