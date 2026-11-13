//! UA5: per-user storage: the usage filter (everyone, over 75%, over 90%), the list a page at a
//! time, a user's quota (GiB) and recalculation, after `pages/admin/AdminStoragePage.tsx`.
//!
//! Frozen by the UI freeze: the public API below (`new`, the setters and `StorageEvent`) is what the app
//! wiring lane builds against while UA5 draws the screen; change it only with the coordinator.
//!
//! The page decides nothing: whether it may be read comes from `InstanceAdminCaps::storage`, the
//! rows and the "load more" foot from `AdminStorageView`, and each change's progress and refusal
//! from its own entry in `AdminStorageView::op`. It adds only what the web adds: the quota is typed
//! in GiB.

mod rows;
#[cfg(feature = "stories")]
mod stories;
#[cfg(test)]
mod tests;

use crate::community_settings::rules::{Outcome, Pending, act, failure, needs, running};
use crate::kit::{
    Alert, Button, Dialog, Severity, TextField, Variant, select_state, spacing, text,
};
use crate::theme::SemTheme;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::component::IndexPath;
use gpui_kit::component::input::InputState;
use gpui_kit::component::select::{SelectEvent, SelectState};
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{AdminAction, AdminActionKind, AdminStorageView, InstanceAdminCaps};

#[derive(Debug, Clone, PartialEq)]
pub enum StorageEvent {
    /// The filter changed: the owner reads `Core::admin_storage(min_percent)`.
    Filter(u32),
    /// `Core::load_more_storage(min_percent)`.
    LoadMore,
    /// `Core::set_user_quota(user_id, quota_bytes)`.
    SetQuota { user_id: String, quota_bytes: u64 },
    /// `Core::recalculate_storage(user_id)`.
    Recalculate { user_id: String },
    /// The read failed and the user asked again: `Core::retry_failed`.
    Retry,
}

/// The usage filter's labels, with the minimum percentages they stand for.
const FILTERS: [(&str, u32); 3] = [("Everyone", 0), ("Over 75%", 75), ("Over 90%", 90)];

const GIB: u64 = 1 << 30;

pub struct StoragePage {
    caps: InstanceAdminCaps,
    view: AdminStorageView,
    filter: Entity<SelectState<Vec<SharedString>>>,
    quota: Entity<InputState>,
    /// The user whose quota dialog is open.
    quota_for: Option<String>,
    /// The dialog's own change, followed until core records that it ended.
    pending: Option<Pending>,
    /// Why that change was refused: the dialog stays open and shows it.
    error: Option<String>,
    /// The filter the control stands for: last sent, or the view's when it changed from outside.
    emitted: u32,
    /// The filter sent and not yet the view's own.
    asked: Option<u32>,
    /// The view's filter already looked at, so a repeated render asks nothing new.
    seen: u32,
    _subscription: Subscription,
}

impl EventEmitter<StorageEvent> for StoragePage {}

fn quota_action(user_id: &str) -> AdminAction {
    act(AdminActionKind::SetUserQuota, Some(user_id))
}

fn recalc_action(user_id: &str) -> AdminAction {
    act(AdminActionKind::RecalculateStorage, Some(user_id))
}

impl StoragePage {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let filter = select_state(labels(), Some(0), window, cx);
        let quota = crate::kit::text_state(window, cx, false);
        let subscription = cx.subscribe_in(&filter, window, |page, _, event, _, cx| {
            let SelectEvent::Confirm(Some(label)) = event else {
                return;
            };
            page.filter_chosen(label.as_ref(), cx);
        });
        Self {
            caps: InstanceAdminCaps::default(),
            view: AdminStorageView::default(),
            filter,
            quota,
            quota_for: None,
            pending: None,
            error: None,
            emitted: 0,
            asked: None,
            seen: 0,
            _subscription: subscription,
        }
    }

    /// What this user may do on the instance (`InstancePermissionsView::admin`).
    pub fn set_caps(&mut self, caps: InstanceAdminCaps, cx: &mut Context<Self>) {
        self.caps = caps;
        cx.notify();
    }

    /// `Core::admin_storage(min_percent)`.
    pub fn set_view(&mut self, view: AdminStorageView, cx: &mut Context<Self>) {
        if let Some(mut pending) = self.pending.clone() {
            match pending.observe(&view.op) {
                // Core can record the refusal on the action's own entry before its end reaches
                // this view: either is the same answer.
                Outcome::Waiting => {
                    if let Some(error) = failure(&view.op, &pending.action) {
                        self.error = Some(error.message.clone());
                        self.pending = None;
                    }
                }
                Outcome::Failed => {
                    self.error = Some(
                        failure(&view.op, &pending.action)
                            .map(|error| error.message.clone())
                            .unwrap_or_else(|| {
                                "Something went wrong. Please try again.".to_owned()
                            }),
                    );
                    self.pending = None;
                }
                Outcome::Succeeded => {
                    // The quota is saved: its dialog goes.
                    self.close_quota_quietly();
                }
            }
        }
        self.view = view;
        cx.notify();
    }

    // ---- The filter. ----

    /// The filter the control stands for, when the view's changed from outside (a route, or a
    /// story). An answer to a filter this page sent is not an outside change: the control keeps
    /// what the user set while core catches up.
    fn sync_filter(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.view.min_percent == self.seen {
            return;
        }
        self.seen = self.view.min_percent;
        if self.asked == Some(self.view.min_percent) {
            self.asked = None;
            return;
        }
        if self.asked.is_some() {
            return;
        }
        self.emitted = self.view.min_percent;
        let percent = self.emitted;
        let filter = self.filter.clone();
        cx.defer_in(window, move |_, window, cx| {
            filter.update(cx, |state, cx| {
                state.set_selected_index(
                    Some(IndexPath::default().row(filter_index(percent))),
                    window,
                    cx,
                )
            });
        });
    }

    fn filter_chosen(&mut self, label: &str, cx: &mut Context<Self>) {
        let percent = percent_of(label);
        if percent == self.emitted {
            return;
        }
        self.emitted = percent;
        self.asked = Some(percent);
        cx.emit(StorageEvent::Filter(percent));
        cx.notify();
    }

    // ---- A user's quota. ----

    pub(crate) fn open_quota(
        &mut self,
        user_id: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(row) = self.view.rows.iter().find(|row| row.user_id == user_id) else {
            return;
        };
        let gib = row.quota_bytes / GIB;
        self.quota_for = Some(user_id.to_owned());
        self.pending = None;
        self.error = None;
        self.quota
            .update(cx, |field, cx| field.set_value(gib.to_string(), window, cx));
        cx.notify();
    }

    fn close_quota_quietly(&mut self) {
        self.quota_for = None;
        self.pending = None;
        self.error = None;
    }

    pub(crate) fn close_quota(&mut self, cx: &mut Context<Self>) {
        self.close_quota_quietly();
        cx.notify();
    }

    fn save_quota(&mut self, cx: &mut Context<Self>) {
        let Some(user_id) = self.quota_for.clone() else {
            return;
        };
        let typed = self.quota.read(cx).value().to_string();
        let Ok(gib) = parse_gb(&typed) else {
            return;
        };
        let action = quota_action(&user_id);
        if self.busy(&action) {
            return;
        }
        self.pending = Some(Pending::new(action, &self.view.op));
        self.error = None;
        cx.emit(StorageEvent::SetQuota {
            user_id,
            quota_bytes: gib * GIB,
        });
        cx.notify();
    }

    // ---- Recalculating. ----

    fn recalculate(&mut self, user_id: &str, cx: &mut Context<Self>) {
        if running(&self.view.op, &recalc_action(user_id)) {
            return;
        }
        cx.emit(StorageEvent::Recalculate {
            user_id: user_id.to_owned(),
        });
    }

    // ---- Drawing. ----

    /// Whether this change is on its way: sent and not yet recorded, or running on the op.
    fn busy(&self, action: &AdminAction) -> bool {
        running(&self.view.op, action)
            || self
                .pending
                .as_ref()
                .is_some_and(|pending| pending.action == *action)
    }

    fn dialog(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        let user_id = self.quota_for.clone()?;
        let name = self
            .view
            .rows
            .iter()
            .find(|row| row.user_id == user_id)
            .map(|row| row.username.clone())
            .unwrap_or_else(|| user_id.clone());
        let typed = self.quota.read(cx).value().to_string();
        let invalid = quota_error(&typed);
        let action = quota_action(&user_id);
        let busy = self.busy(&action);
        let refusal = self
            .error
            .clone()
            .or_else(|| failure(&self.view.op, &action).map(|error| error.message.clone()));
        let sem = cx.sem().clone();
        Some(
            Dialog::new(format!("Storage Quota for {name}"))
                .width(480.)
                .body(
                    div()
                        .pt(spacing(1.))
                        .flex()
                        .flex_col()
                        .gap(spacing(2.))
                        .children(
                            (!busy)
                                .then(|| {
                                    refusal.map(|message| Alert::new(Severity::Error, message))
                                })
                                .flatten(),
                        )
                        .child(
                            text(
                                Variant::Body2,
                                "The most this user's files may take, in GB. 0 sets no quota.",
                            )
                            .text_color(sem.text_secondary),
                        )
                        .child(
                            TextField::new("admin-storage-quota-field", &self.quota, "Quota (GB)")
                                .disabled(busy)
                                .error(invalid.is_some()),
                        )
                        .children(invalid.map(|message| {
                            div()
                                .id("admin-storage-quota-error")
                                .test_support()
                                .child(crate::community_settings::common::field_error(message, cx))
                        })),
                )
                .action(
                    Button::new("admin-storage-quota-cancel", "Cancel")
                        .disabled(busy)
                        .on_click(cx.listener(|page, _, _, cx| page.close_quota(cx))),
                )
                .action(
                    Button::new("admin-storage-quota-save", "Save")
                        .contained()
                        .loading(busy)
                        .disabled(invalid.is_some() || typed.trim().is_empty() || busy)
                        .on_click(cx.listener(|page, _, _, cx| page.save_quota(cx))),
                )
                .on_close({
                    let page = cx.weak_entity();
                    move |_, cx| {
                        page.update(cx, |page, cx| page.close_quota(cx)).ok();
                    }
                })
                .into_any_element(),
        )
    }
}

fn labels() -> Vec<SharedString> {
    FILTERS
        .iter()
        .map(|(label, _)| SharedString::from(*label))
        .collect()
}

fn percent_of(label: &str) -> u32 {
    FILTERS
        .iter()
        .find(|(known, _)| *known == label)
        .map_or(0, |(_, percent)| *percent)
}

/// The control's row for a minimum: the highest step at or below it.
fn filter_index(percent: u32) -> usize {
    FILTERS
        .iter()
        .rposition(|(_, step)| *step <= percent)
        .unwrap_or(0)
}

/// "Enter a whole number of GB": empty says nothing until Save is pressed, anything but digits
/// (or far too large) says why not.
fn quota_error(typed: &str) -> Option<&'static str> {
    let typed = typed.trim();
    if typed.is_empty() {
        return None;
    }
    parse_gb(typed).err()
}

fn parse_gb(typed: &str) -> Result<u64, &'static str> {
    let typed = typed.trim();
    let whole = !typed.is_empty() && typed.chars().all(|c| c.is_ascii_digit());
    match typed.parse::<u64>() {
        Ok(gb) if whole && gb.checked_mul(GIB).is_some() => Ok(gb),
        _ => Err("Enter a whole number of GB"),
    }
}

impl Render for StoragePage {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        self.sync_filter(window, cx);
        let narrow = crate::community_settings::common::phone(window);
        let body: AnyElement = if !self.caps.storage {
            crate::community_settings::common::card(
                "Storage",
                crate::community_settings::common::locked_note(
                    "admin-storage-locked",
                    needs("Manage user storage"),
                    cx,
                ),
                cx,
            )
            .into_any_element()
        } else {
            self.storage_card(narrow, cx)
        };
        let page = crate::community_settings::common::page(
            "admin-storage",
            "User Storage",
            Some("View and manage storage usage per user".into()),
            Vec::new(),
            body,
            window,
            cx,
        );
        div()
            .relative()
            .size_full()
            .child(page)
            .children(self.dialog(cx))
    }
}

#[cfg(feature = "stories")]
pub fn stories() -> Vec<crate::stories::Story> {
    stories::stories()
}

/// The table's columns, in the web's order.
pub(super) const COLUMNS: [&str; 5] = ["User", "Storage Used", "% Used", "Files", "Actions"];
