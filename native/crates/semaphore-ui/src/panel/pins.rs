//! The pinned messages panel, after `PinnedMessagesPanel.tsx`.

use super::common::{
    design_icon, empty_block, error_block, icon_button, is_phone, panel_header, preview_text,
    relative_time,
};
use super::{PinsPanel, PinsPanelEvent};
use crate::kit::{Skeleton, Variant, spacing, text};
use crate::messages::{CacheKind, MediaState};
use crate::shell::user_avatar;
use crate::theme::SemTheme;
use gpui_kit::base;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{AttachmentKind, LoadState, PinnedRow};
use semaphore_design::Icon as DesignIcon;

/// The web caps an attachment preview at 140px inside a 150px box.
const PREVIEW_HEIGHT: f32 = 140.;

impl PinsPanel {
    fn pin_row(
        &self,
        index: usize,
        pin: &PinnedRow,
        now_ms: i64,
        touch: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> impl IntoElement + use<> {
        let sem = cx.sem();
        let row = &pin.row;
        let message_id = row.id.clone().unwrap_or_default();
        let author = row
            .author
            .display_name
            .clone()
            .unwrap_or_else(|| row.author.username.clone());
        let when = relative_time(now_ms, row.sent_at_ms);
        let content = preview_text(&row.display, None);
        let (primary, secondary, hover, divider) = (
            sem.text_primary,
            sem.text_secondary,
            sem.overlay_medium,
            sem.divider,
        );
        let first = row.attachments.first().cloned();
        let more = row.attachments.len().saturating_sub(1);
        let attachment = first.map(|attachment| {
            let image = matches!(attachment.kind, AttachmentKind::Image).then(|| {
                let media = self.images.source.attachment(&attachment);
                self.images.resolve(media, CacheKind::Images, window, cx)
            });
            match image {
                Some(MediaState::Ready(image)) => div()
                    .mt(px(if content.is_empty() { 0. } else { 8. }))
                    .max_h(px(PREVIEW_HEIGHT))
                    .overflow_hidden()
                    .rounded(px(4.))
                    .child(
                        img(image)
                            .max_h(px(PREVIEW_HEIGHT))
                            .max_w_full()
                            .object_fit(ObjectFit::Contain),
                    )
                    .into_any_element(),
                _ => div()
                    .mt(px(if content.is_empty() { 0. } else { 8. }))
                    .max_w_full()
                    .overflow_hidden()
                    .flex()
                    .items_center()
                    .gap(px(6.))
                    .px(px(8.))
                    .py(px(6.))
                    .rounded(px(4.))
                    .border_1()
                    .border_color(divider)
                    .child(design_icon(
                        DesignIcon::InsertDriveFileOutlined,
                        18.,
                        secondary,
                    ))
                    .child(
                        text(Variant::Caption, attachment.filename.clone())
                            .text_color(primary)
                            .min_w_0()
                            .truncate(),
                    )
                    .into_any_element(),
            }
        });
        let unpin = self.can_unpin.then(|| {
            let message_id = message_id.clone();
            icon_button(
                ElementId::Name(format!("unpin-{message_id}").into()),
                DesignIcon::Close,
                "Unpin message",
                touch,
                secondary,
                cx,
            )
            .when(!touch, |button| button.size(px(30.)))
            .on_click(cx.listener(move |_, _, _, cx| {
                cx.stop_propagation();
                cx.emit(PinsPanelEvent::Unpin {
                    message_id: message_id.clone(),
                });
            }))
        });
        let jump_id = message_id.clone();
        let parent = pin.parent_message_id.clone();
        let mut label = format!("{author}, {when}: {content}");
        if row.attachments.len() == 1 {
            label.push_str(", 1 attachment");
        } else if !row.attachments.is_empty() {
            label.push_str(&format!(", {} attachments", row.attachments.len()));
        }
        div()
            .relative()
            .w_full()
            .flex_shrink_0()
            .when(index > 0, |row| row.border_t_1().border_color(divider))
            .child(
                base::Button::new(ElementId::Name(format!("pin-{message_id}").into()))
                    .accessibility_label(label)
                    .w_full()
                    .flex()
                    .flex_col()
                    .items_start()
                    .pl(spacing(2.))
                    .pr(spacing(if self.can_unpin { 6. } else { 2. }))
                    .py(spacing(1.))
                    .cursor_pointer()
                    .hover(move |style| style.bg(hover))
                    .focus_visible(move |style| style.bg(hover))
                    .child(
                        div()
                            .w_full()
                            .min_w_0()
                            .flex()
                            .items_center()
                            .gap(spacing(1.))
                            .mb(px(4.))
                            .child(user_avatar(
                                &author,
                                row.author.avatar_file_id.as_deref(),
                                24.,
                            ))
                            .child(
                                text(Variant::Subtitle2, author.clone())
                                    .text_color(primary)
                                    .min_w_0()
                                    .truncate(),
                            )
                            .child(
                                text(Variant::Caption, when)
                                    .text_color(secondary)
                                    .flex_shrink_0()
                                    .whitespace_nowrap(),
                            ),
                    )
                    .when(!content.is_empty(), |row| {
                        row.child(
                            text(Variant::Body2, content.clone())
                                .w_full()
                                .text_color(primary)
                                .line_clamp(3)
                                .text_ellipsis(),
                        )
                    })
                    .children(attachment)
                    .when(more > 0, |row| {
                        row.child(
                            text(Variant::Caption, format!("+{more} more"))
                                .mt(px(4.))
                                .text_color(secondary),
                        )
                    })
                    .on_click(cx.listener(move |_, _, _, cx| {
                        cx.emit(PinsPanelEvent::Jump {
                            message_id: jump_id.clone(),
                            parent_message_id: parent.clone(),
                        });
                    })),
            )
            .children(unpin.map(|unpin| {
                div()
                    .id("unpin-anchor")
                    .absolute()
                    .top(spacing(1.))
                    .right(spacing(1.))
                    .occlude()
                    .child(unpin)
            }))
    }
}

impl Render for PinsPanel {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let touch = is_phone(window);
        let sem = cx.sem();
        let (paper, secondary) = (sem.paper, sem.text_secondary);
        let close = icon_button(
            "pins-close",
            DesignIcon::Close,
            "Close pinned messages",
            touch,
            secondary,
            cx,
        )
        .on_click(cx.listener(|_, _, _, cx| cx.emit(PinsPanelEvent::Close)))
        .into_any_element();
        let count = match self.pins.state {
            LoadState::Ready if !self.pins.rows.is_empty() => {
                Some(SharedString::from(self.pins.rows.len().to_string()))
            }
            _ => None,
        };
        let header = panel_header(
            DesignIcon::PushPin,
            "Pinned Messages",
            count,
            vec![close],
            touch,
            cx,
        );
        let body: Vec<AnyElement> = match &self.pins.state {
            LoadState::Loading => vec![
                div()
                    .id("pins-loading")
                    .test_support()
                    .role(Role::ProgressIndicator)
                    .aria_label("Loading pinned messages")
                    .p(spacing(2.))
                    .flex()
                    .flex_col()
                    .gap(spacing(2.))
                    .children(
                        (0..3usize)
                            .map(|index| Skeleton::rect(("pin-loading", index), relative(1.), 60.)),
                    )
                    .into_any_element(),
            ],
            LoadState::Failed { .. } => vec![
                error_block(
                    "pins-retry",
                    "Couldn't load pinned messages",
                    "Check your connection and try again.",
                    cx.listener(|_, _, _, cx| cx.emit(PinsPanelEvent::Retry)),
                    cx,
                )
                .into_any_element(),
            ],
            LoadState::Ready if self.pins.rows.is_empty() => vec![
                empty_block(
                    DesignIcon::PushPin,
                    "No pinned messages yet.",
                    "Pin important messages to keep them easily accessible.",
                    cx,
                )
                .into_any_element(),
            ],
            LoadState::Ready => {
                let now = self.clock.now_ms();
                let rows = self.pins.rows.clone();
                rows.iter()
                    // A pin is a sent message, so it has an id; one without can't be jumped to
                    // or unpinned, and would share an element id with the next.
                    .filter(|pin| pin.row.id.is_some())
                    .enumerate()
                    .map(|(index, pin)| {
                        self.pin_row(index, pin, now, touch, window, cx)
                            .into_any_element()
                    })
                    .collect()
            }
        };
        div()
            .id("pins-panel")
            .test_support()
            .role(Role::Complementary)
            .aria_label("Pinned messages")
            .size_full()
            .flex()
            .flex_col()
            .bg(paper)
            .child(header)
            .child(
                div()
                    .id("pins-scroll")
                    .test_support()
                    .role(Role::List)
                    .aria_label("Pinned messages")
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scroll()
                    .flex()
                    .flex_col()
                    .children(body),
            )
    }
}
