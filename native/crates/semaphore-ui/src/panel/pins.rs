//! The pinned messages panel, after the web Lounge's `PinnedSheet.tsx` (`PinnedPanel`): a kit
//! PanelPane with a ListRow for each pin (who wrote it and when, its words or its files), Unpin
//! for those who may, and the loading, error and empty states.

use super::common::{message_preview, panel_heading, relative_time};
use super::{PinsPanel, PinsPanelEvent};
use crate::kit::LiveElement as _;
use crate::kit::{
    Avatar, AvatarSize, Button, IconButton, ListRow, PanelPane, RowSize, Skeleton, Variant, text,
};
use crate::messages::author_name;
use crate::shell::lounge::{Rows, focused};
use crate::theme::SemTheme;
use gpui_kit::accesskit::Live;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{LoadState, PinnedRow};
use semaphore_design::lounge::{SPACE_MD, SPACE_SM, SPACE_XS};
use semaphore_design::{Icon as DesignIcon, LoungeIcon, person_colour};

/// "1 file", "3 files".
fn files_line(count: usize) -> String {
    if count == 1 {
        "1 file".to_owned()
    } else {
        format!("{count} files")
    }
}

/// A pin's second line: its words and its files, or "No text".
pub(crate) fn pin_secondary(pin: &PinnedRow) -> String {
    let words = message_preview(&pin.row, None);
    let files = pin.row.attachments.len();
    let files = if files > 0 {
        files_line(files)
    } else {
        String::new()
    };
    let parts: Vec<String> = [words, files]
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect();
    if parts.is_empty() {
        "No text".to_owned()
    } else {
        parts.join(" · ")
    }
}

/// A pin's row id: the rig and the tests click `pin-<message id>`.
fn row_id(pin: &PinnedRow) -> String {
    format!("pin-{}", pin.row.id.as_deref().unwrap_or_default())
}

impl PinsPanel {
    /// The pins the panel lists: a pin is a sent message, so it has an id; one without can't be
    /// jumped to or unpinned, and would share an element id with the next.
    fn listed(&self) -> Vec<PinnedRow> {
        self.pins
            .rows
            .iter()
            .filter(|pin| pin.row.id.is_some())
            .cloned()
            .collect()
    }

    /// Unpin was pressed on the row at `index`: once the list no longer has it, focus goes to the
    /// row now in its place (or the last one), as the web's.
    pub(crate) fn unpin(&mut self, message_id: String, index: usize, cx: &mut Context<Self>) {
        self.unpinned = Some((message_id.clone(), index));
        cx.emit(PinsPanelEvent::Unpin { message_id });
    }

    fn pin_row(
        &self,
        index: usize,
        pin: &PinnedRow,
        now_ms: i64,
        rows: &Rows,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let row = &pin.row;
        let message_id = row.id.clone().unwrap_or_default();
        let name = author_name(row);
        let when = relative_time(now_ms, row.sent_at_ms);
        let secondary = pin_secondary(pin);
        let id = row_id(pin);
        let avatar = Avatar::new(name.clone())
            .colour(person_colour(Some(&row.author.id)))
            .file(row.author.avatar_file_id.as_deref())
            .size(AvatarSize::Md)
            .decorative(true);
        let jump_id = message_id.clone();
        let parent = pin.parent_message_id.clone();
        let view = cx.entity().downgrade();
        let mut list_row = ListRow::new(SharedString::from(id.clone()), format!("{name} · {when}"))
            .size(RowSize::Lg)
            .secondary(secondary.clone())
            .leading(avatar)
            .label(format!("Show the message from {name}: {secondary}"))
            .on_click(move |_, cx| {
                view.update(cx, |_, cx| {
                    cx.emit(PinsPanelEvent::Jump {
                        message_id: jump_id.clone(),
                        parent_message_id: parent.clone(),
                    })
                })
                .ok();
            });
        if self.can_unpin {
            let view = cx.entity().downgrade();
            list_row = list_row.trailing(
                IconButton::new(
                    SharedString::from(format!("unpin-{message_id}")),
                    DesignIcon::Close,
                    format!("Unpin the message from {name}"),
                )
                .lounge_icon(LoungeIcon::PinOff)
                .on_click(move |_, _, cx| {
                    cx.stop_propagation();
                    let message_id = message_id.clone();
                    view.update(cx, |panel, cx| panel.unpin(message_id, index, cx))
                        .ok();
                }),
            );
        }
        focused(list_row, rows, &id, cx)
    }

    fn loading(&self) -> AnyElement {
        div()
            .id("pins-loading")
            .test_support()
            .role(Role::ProgressIndicator)
            .aria_label("Loading pinned messages")
            .flex()
            .flex_col()
            .gap(px(SPACE_MD))
            .children((0..3usize).map(|index| {
                div()
                    .flex()
                    .gap(px(SPACE_MD))
                    .child(Skeleton::circle(
                        ("pin-loading-avatar", index),
                        AvatarSize::Md,
                    ))
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .child(Skeleton::text(("pin-loading", index), 2)),
                    )
            }))
            .into_any_element()
    }

    fn failed(&self, cx: &mut Context<Self>) -> AnyElement {
        div()
            .id("pins-failed")
            .test_support()
            .role(Role::Alert)
            .aria_label("Couldn't load pinned messages")
            .aria_live(Live::Assertive)
            .flex()
            .flex_col()
            .items_start()
            .gap(px(SPACE_SM))
            .child(text(Variant::Body1, "Couldn't load pinned messages"))
            .child(
                Button::new("pins-retry", "Try again")
                    .on_click(cx.listener(|_, _, _, cx| cx.emit(PinsPanelEvent::Retry))),
            )
            .into_any_element()
    }

    fn empty(&self, cx: &mut Context<Self>) -> AnyElement {
        let secondary = cx.sem().text_secondary;
        div()
            .id("pins-empty")
            .test_support()
            .flex()
            .flex_col()
            .gap(px(SPACE_XS))
            .child(text(Variant::Body1, "No pinned messages yet."))
            .child(
                text(
                    Variant::Body2,
                    "Pin important messages to keep them easy to find.",
                )
                .text_color(secondary),
            )
            .into_any_element()
    }
}

impl Render for PinsPanel {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let header = panel_heading(
            "pins-heading",
            "Pinned messages",
            "pins-close",
            "Close pinned messages",
            cx.listener(|_, _, _, cx| cx.emit(PinsPanelEvent::Close)),
        );
        let listed = self.listed();
        let rows = Rows::new(
            "pins-rows",
            listed
                .iter()
                .map(|pin| (row_id(pin), pin_secondary(pin)))
                .collect(),
            None,
            Some(self.scroll.clone()),
            window,
            cx,
        );
        // An unpinned row has gone: its neighbour takes focus.
        if let Some((gone, index)) = self.unpinned.clone()
            && self.pins.state == LoadState::Ready
            && !listed
                .iter()
                .any(|pin| pin.row.id.as_deref() == Some(&gone))
        {
            self.unpinned = None;
            if let Some(next) = listed.get(index.min(listed.len().saturating_sub(1)))
                && let Some((handle, _)) = rows.focus(&row_id(next))
            {
                window.focus(&handle, cx);
            } else {
                window.focus(&self.focus, cx);
            }
        }
        let body = match &self.pins.state {
            LoadState::Loading => self.loading(),
            LoadState::Failed { .. } => self.failed(cx),
            LoadState::Ready if listed.is_empty() => self.empty(cx),
            LoadState::Ready => {
                let now = self.clock.now_ms();
                let items: Vec<AnyElement> = listed
                    .iter()
                    .enumerate()
                    .map(|(index, pin)| self.pin_row(index, pin, now, &rows, cx))
                    .collect();
                rows.keys(div().flex().flex_col().gap(px(SPACE_XS)).children(items))
                    .into_any_element()
            }
        };
        div()
            .id("pins-panel")
            .test_support()
            .track_focus(&self.focus)
            .size_full()
            .on_key_down(cx.listener(|_, event: &KeyDownEvent, _, cx| {
                // Nothing inside the panel takes Escape before this: its buttons and rows have no
                // menu, edit or selection of their own. With the focus in here, the key closes the
                // panel, as its Close does.
                if event.keystroke.key == "escape" {
                    cx.emit(PinsPanelEvent::Close);
                    cx.stop_propagation();
                }
            }))
            .child(
                PanelPane::new("pins-pane", header)
                    .track_scroll(&self.scroll)
                    .list_label("Pinned messages")
                    .child(body),
            )
    }
}
