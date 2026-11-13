//! The storage card: the usage filter and the count, the per-user table (username, used of quota
//! with a bar, the percentage, the file count, quota and recalculate), its states and the
//! "Load more" foot, after `AdminStoragePage.tsx`. On a phone the table's columns become one
//! stacked block per user.

use super::{COLUMNS, StorageEvent, StoragePage, quota_action, recalc_action};
use crate::community_settings::common::{card, empty_line, loading_rows};
use crate::community_settings::rules::{failure, running};
use crate::format::file_size;
use crate::kit::{Alert, Button, ButtonSize, Chip, SelectField, Severity, Variant, spacing, text};
use crate::theme::{Sem, SemTheme};
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::component::progress::Progress as KitProgress;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{LoadState, StorageRow};
use semaphore_design::Icon as DesignIcon;

/// The percentage's text and bar colour: the accent to 75, the warning to 90, then the error.
fn usage_color(percent: f64, sem: &Sem) -> Hsla {
    if percent >= 90. {
        sem.error
    } else if percent >= 75. {
        sem.warning
    } else {
        sem.primary
    }
}

/// A user's use: `percent` of the bar, in the severity's colour on a 20% track of it (the kit's
/// `LinearProgress` paints only the accent, which would hide the warning and error states).
fn usage_bar(id: SharedString, label: String, percent: f64, color: Hsla) -> impl IntoElement {
    div().child(
        KitProgress::new(id)
            .accessibility_label(label)
            .color(color)
            .value(percent.clamp(0., 100.) as f32)
            .loading(false)
            .h(px(6.))
            .rounded(px(4.))
            .bg(color.opacity(0.2)),
    )
}

impl StoragePage {
    pub(super) fn storage_card(&self, narrow: bool, cx: &mut Context<Self>) -> AnyElement {
        let title = match self.view.state {
            LoadState::Ready => format!("Users ({})", self.view.total),
            _ => "Storage".to_owned(),
        };
        let filters = self.filters(narrow, cx);
        let table: AnyElement = match &self.view.state {
            LoadState::Loading => loading_rows("admin-storage-loading", "Loading storage", 6),
            LoadState::Failed { error } => div()
                .flex()
                .flex_col()
                .items_start()
                .gap(spacing(1.5))
                .child(Alert::new(
                    Severity::Error,
                    format!("Failed to load user storage data: {}", error.message),
                ))
                .child(
                    Button::new("admin-storage-retry", "Try again")
                        .outlined()
                        .on_click(cx.listener(|_, _, _, cx| cx.emit(StorageEvent::Retry))),
                )
                .into_any_element(),
            LoadState::Ready if self.view.rows.is_empty() => empty_line(
                if self.view.min_percent > 0 {
                    format!(
                        "No users found with \u{2265}{}% storage usage",
                        self.view.min_percent
                    )
                } else {
                    "No users found".to_owned()
                },
                cx,
            )
            .into_any_element(),
            LoadState::Ready => {
                let rows: Vec<AnyElement> = self
                    .view
                    .rows
                    .iter()
                    .map(|row| self.user_row(row, narrow, cx))
                    .collect();
                div()
                    .flex()
                    .flex_col()
                    .when(!narrow, |table| table.child(self.head_row(cx)))
                    .children(rows)
                    .into_any_element()
            }
        };
        let more = (self.view.state == LoadState::Ready && self.view.more).then(|| {
            div().flex().justify_center().pt(spacing(1.)).child(
                Button::new("admin-storage-more", "Load more")
                    .outlined()
                    .loading(self.view.loading_more)
                    .disabled(self.view.loading_more)
                    .on_click(cx.listener(|_, _, _, cx| cx.emit(StorageEvent::LoadMore))),
            )
        });
        card(
            title,
            div()
                .flex()
                .flex_col()
                .gap(spacing(1.))
                .child(filters)
                .child(table)
                .children(more),
            cx,
        )
        .into_any_element()
    }

    fn filters(&self, narrow: bool, cx: &Context<Self>) -> Div {
        let sem = cx.sem();
        let filter = div()
            .when(narrow, |field| field.w_full())
            .when(!narrow, |field| field.w(px(220.)))
            .child(SelectField::new(
                "admin-storage-filter",
                &self.filter,
                "Usage",
            ));
        let showing = (self.view.min_percent > 0)
            .then(|| Chip::new(format!("Showing users \u{2265}{}%", self.view.min_percent)));
        let mut row = div().w_full().flex().gap(spacing(2.));
        if narrow {
            row = row.flex_col().items_start();
        } else {
            row = row.items_center().flex_wrap();
        }
        row.child(filter)
            .children(showing)
            .when(!narrow, |row| row.child(div().flex_1()))
            .children((self.view.state == LoadState::Ready).then(|| {
                text(Variant::Body2, format!("{} users", self.view.total))
                    .whitespace_nowrap()
                    .text_color(sem.text_secondary)
            }))
    }

    /// The desktop table's headings, over the rows.
    fn head_row(&self, cx: &Context<Self>) -> Div {
        let sem = cx.sem();
        let cell = |label: &str, width: Div| {
            width
                .px(spacing(2.))
                .py(spacing(1.))
                .child(text(Variant::Subtitle2, label.to_owned()).text_color(sem.text_primary))
        };
        div()
            .w_full()
            .flex()
            .items_center()
            .border_b_1()
            .border_color(sem.divider)
            .child(cell(COLUMNS[0], div().flex_1().min_w_0()))
            .child(cell(COLUMNS[1], div().flex_1().min_w_0()))
            .child(cell(COLUMNS[2], div().w(px(90.)).flex_shrink_0()))
            .child(cell(COLUMNS[3], div().w(px(80.)).flex_shrink_0()))
            .child(cell(COLUMNS[4], div().w(px(300.)).flex_shrink_0()))
    }

    /// One user: who, used of their quota with a bar, the percentage and files, and the two
    /// actions. A refusal stays under the row it belongs to.
    fn user_row(&self, row: &StorageRow, narrow: bool, cx: &mut Context<Self>) -> AnyElement {
        let sem = cx.sem().clone();
        let recalc = recalc_action(&row.user_id);
        let quota = quota_action(&row.user_id);
        let recalc_busy = running(&self.view.op, &recalc);
        let quota_busy = self.busy(&quota);
        let error = failure(&self.view.op, &recalc)
            .or_else(|| failure(&self.view.op, &quota))
            .map(|error| error.message.clone());
        let color = usage_color(row.percent_used, &sem);
        let id = row.user_id.clone();
        let percent = text(Variant::Body2, format!("{:.1}%", row.percent_used))
            .font_weight(FontWeight::BOLD)
            .whitespace_nowrap()
            .text_color(color);
        let used = text(Variant::Caption, file_size(row.used_bytes))
            .whitespace_nowrap()
            .text_color(sem.text_secondary);
        let quota_label = text(Variant::Caption, file_size(row.quota_bytes))
            .whitespace_nowrap()
            .text_color(sem.text_secondary);
        let files = text(Variant::Body2, row.file_count.to_string())
            .whitespace_nowrap()
            .text_color(sem.text_primary);
        let usage = usage_bar(
            SharedString::from(format!("admin-storage-bar-{}", row.user_id)),
            format!("{} storage used", row.username),
            row.percent_used,
            color,
        );
        let quota_button = Button::new(
            SharedString::from(format!("admin-storage-quota-{}", row.user_id)),
            "Quota",
        )
        .outlined()
        .size(ButtonSize::Small)
        .start_icon(DesignIcon::Storage)
        .disabled(quota_busy)
        .on_click(cx.listener({
            let id = id.clone();
            move |page, _, window, cx| page.open_quota(&id, window, cx)
        }));
        let recalc_button = Button::new(
            SharedString::from(format!("admin-storage-recalc-{}", row.user_id)),
            "Recalculate",
        )
        .outlined()
        .size(ButtonSize::Small)
        .start_icon(DesignIcon::Refresh)
        .loading(recalc_busy)
        .disabled(recalc_busy)
        .on_click(cx.listener({
            let id = id.clone();
            move |page, _, _, cx| page.recalculate(&id, cx)
        }));
        let actions = div()
            .flex()
            .flex_wrap()
            .items_center()
            .gap(spacing(1.))
            .child(quota_button)
            .child(recalc_button);
        let body = if narrow {
            div()
                .flex()
                .flex_col()
                .gap(spacing(1.))
                .child(
                    text(Variant::Body2, row.username.clone())
                        .font_weight(FontWeight(500.))
                        .truncate()
                        .min_w_0()
                        .text_color(sem.text_primary),
                )
                .child(
                    div().flex().items_center().gap(spacing(1.)).child(
                        text(
                            Variant::Caption,
                            format!(
                                "{} of {}",
                                file_size(row.used_bytes),
                                file_size(row.quota_bytes)
                            ),
                        )
                        .truncate()
                        .text_color(sem.text_secondary),
                    ),
                )
                .child(usage)
                .child(
                    div()
                        .flex()
                        .items_center()
                        .justify_between()
                        .gap(spacing(1.))
                        .child(percent)
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap(spacing(1.))
                                .child(files)
                                .child(
                                    text(
                                        Variant::Caption,
                                        if row.file_count == 1 { "file" } else { "files" },
                                    )
                                    .text_color(sem.text_secondary),
                                ),
                        ),
                )
                .child(actions)
        } else {
            div()
                .w_full()
                .flex()
                .items_center()
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .px(spacing(2.))
                        .py(spacing(1.5))
                        .child(
                            text(Variant::Body2, row.username.clone())
                                .font_weight(FontWeight(500.))
                                .truncate()
                                .min_w_0()
                                .text_color(sem.text_primary),
                        ),
                )
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .px(spacing(2.))
                        .py(spacing(1.5))
                        .flex()
                        .flex_col()
                        .gap(px(4.))
                        .child(
                            div()
                                .flex()
                                .justify_between()
                                .gap(spacing(1.))
                                .child(used)
                                .child(quota_label),
                        )
                        .child(usage),
                )
                .child(
                    div()
                        .w(px(90.))
                        .flex_shrink_0()
                        .px(spacing(2.))
                        .py(spacing(1.5))
                        .child(percent),
                )
                .child(
                    div()
                        .w(px(80.))
                        .flex_shrink_0()
                        .px(spacing(2.))
                        .py(spacing(1.5))
                        .child(files),
                )
                .child(
                    div()
                        .w(px(300.))
                        .flex_shrink_0()
                        .px(spacing(2.))
                        .py(spacing(1.5))
                        .child(actions),
                )
        };
        let error = error.map(|message| {
            div()
                .w_full()
                .pb(spacing(1.))
                .child(Alert::new(Severity::Error, message))
        });
        div()
            .id(SharedString::from(format!(
                "admin-storage-row-{}",
                row.user_id
            )))
            .test_support()
            .role(Role::ListItem)
            .aria_label(row.username.clone())
            .w_full()
            .flex()
            .flex_col()
            .when(narrow, |row| row.px(spacing(2.)).py(spacing(1.5)))
            .border_b_1()
            .border_color(sem.divider)
            .child(body)
            .children(error)
            .into_any_element()
    }
}
