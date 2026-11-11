//! The conversation list, after `DirectMessageList.tsx` and `DmListItem.tsx`.

use super::face::{group_face, user_face};
use super::names::{UnreadMark, dm_name, dm_preview, last_message_time, row_label, unread_mark};
use super::{DmListEvent, DmListView};
use crate::kit::{Badge, Button, Skeleton, Variant, spacing, text};
use crate::panel::common::{design_icon, error_block, is_phone};
use crate::theme::SemTheme;
use gpui_kit::base;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{DmRow, LoadState};
use semaphore_design::Icon as DesignIcon;

impl DmListView {
    fn row(
        &self,
        row: &DmRow,
        now_ms: i64,
        touch: bool,
        cx: &mut Context<Self>,
    ) -> impl IntoElement + use<> {
        let sem = cx.sem();
        let selected = self.selected.as_deref() == Some(row.id.as_str());
        let mark = unread_mark(row.unread, row.mentions, selected);
        let unread = mark.is_some();
        let name = dm_name(row);
        let (primary, secondary, hover, selected_bg, error, success) = (
            sem.text_primary,
            sem.text_secondary,
            sem.list_hover,
            sem.list_selected,
            sem.error,
            sem.success,
        );
        let weight = FontWeight(if unread { 700. } else { 500. });
        let face = if row.is_group {
            group_face(40., cx)
        } else {
            let online = row
                .members
                .first()
                .map(|user| self.online.contains(&user.id));
            match row.members.first() {
                Some(user) => user_face(user, 40., online, cx),
                None => group_face(40., cx),
            }
        };
        let in_call = self.in_call.as_deref() == Some(row.id.as_str());
        let time = row
            .last_message
            .as_ref()
            .map(|last| last_message_time(now_ms, last.sent_at_ms));
        let badge = mark.map(|mark| match mark {
            UnreadMark::Dot => div()
                .size(px(10.))
                .mr(px(4.))
                .flex_shrink_0()
                .rounded_full()
                .bg(error)
                .into_any_element(),
            UnreadMark::Count(count) => Badge::new(count).compact().into_any_element(),
        });
        let id = row.id.clone();
        base::Button::new(ElementId::Name(format!("dm-row-{}", row.id).into()))
            .accessibility_label(row_label(row, selected))
            .selected(selected)
            .w_full()
            .min_w_0()
            .when(touch, |button| button.min_h(px(56.)))
            .my(px(4.))
            .px(spacing(2.))
            .py(spacing(1.))
            .flex()
            .items_center()
            .gap(spacing(2.))
            .rounded(px(4.))
            .cursor_pointer()
            .when(selected, |button| button.bg(selected_bg))
            .hover(move |style| style.bg(hover))
            .focus_visible(move |style| style.bg(hover))
            .child(face)
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
                            .items_center()
                            .gap(px(4.))
                            .min_w_0()
                            .child(
                                text(Variant::Body1, name.names.clone())
                                    .min_w_0()
                                    .truncate()
                                    .font_weight(weight)
                                    .text_color(primary),
                            )
                            .when(name.extra > 0, |line| {
                                line.child(
                                    text(Variant::Body1, format!("+ {}", name.extra))
                                        .flex_shrink_0()
                                        .whitespace_nowrap()
                                        .font_weight(weight)
                                        .text_color(secondary),
                                )
                            })
                            .when(in_call, |line| {
                                line.child(design_icon(DesignIcon::Phone, 16., success))
                            })
                            .children(time.map(|time| {
                                text(Variant::Caption, time)
                                    .ml_auto()
                                    .pl(px(8.))
                                    .flex_shrink_0()
                                    .whitespace_nowrap()
                                    .text_color(if unread { primary } else { secondary })
                                    .when(unread, |time| time.font_weight(FontWeight(600.)))
                            })),
                    )
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(8.))
                            .min_w_0()
                            .child(
                                text(Variant::Body2, dm_preview(row))
                                    .flex_1()
                                    .min_w_0()
                                    .truncate()
                                    .text_color(if unread { primary } else { secondary }),
                            )
                            .children(badge),
                    ),
            )
            .on_click(
                cx.listener(move |_, _, _, cx| cx.emit(DmListEvent::Open { dm_id: id.clone() })),
            )
    }
}

impl Render for DmListView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let touch = is_phone(window);
        let sem = cx.sem().clone();
        let body: AnyElement = match &self.list.state {
            LoadState::Loading => div()
                .id("dm-list-loading")
                .test_support()
                .role(Role::ProgressIndicator)
                .aria_label("Loading conversations")
                .p(spacing(2.))
                .flex()
                .flex_col()
                .gap(spacing(2.))
                .children((0..8usize).map(|index| {
                    div()
                        .flex()
                        .items_center()
                        .gap(spacing(2.))
                        .child(Skeleton::circle(("dm-loading-face", index), 40.))
                        .child(
                            div()
                                .flex_1()
                                .flex()
                                .flex_col()
                                .gap(px(6.))
                                .child(Skeleton::rect(
                                    ("dm-loading-name", index),
                                    relative(0.6),
                                    14.,
                                ))
                                .child(Skeleton::rect(
                                    ("dm-loading-text", index),
                                    relative(0.9),
                                    12.,
                                )),
                        )
                }))
                .into_any_element(),
            LoadState::Failed { .. } => error_block(
                "dm-list-retry",
                "Couldn't load conversations",
                "Check your connection and try again.",
                cx.listener(|_, _, _, cx| cx.emit(DmListEvent::Retry)),
                cx,
            ),
            LoadState::Ready if self.list.rows.is_empty() => div()
                .id("dm-list-empty")
                .test_support()
                .flex()
                .flex_col()
                .items_center()
                .justify_center()
                .gap(px(4.))
                .px(spacing(3.))
                .py(spacing(6.))
                .child(
                    design_icon(DesignIcon::ChatBubbleOutline, 48., sem.text_disabled)
                        .mb(spacing(1.)),
                )
                .child(
                    text(Variant::Subtitle1, "No conversations yet")
                        .text_color(sem.text_primary)
                        .text_center(),
                )
                .child(
                    text(
                        Variant::Body2,
                        "Start a conversation with a friend or another member.",
                    )
                    .text_color(sem.text_secondary)
                    .text_center()
                    .mb(spacing(2.)),
                )
                .child(
                    Button::new("dm-list-start", "Start a conversation")
                        .contained()
                        .on_click(cx.listener(|_, _, _, cx| cx.emit(DmListEvent::NewMessage))),
                )
                .into_any_element(),
            LoadState::Ready => {
                let now = self.clock.now_ms();
                let rows = self.list.rows.clone();
                div()
                    .px(spacing(1.))
                    .flex()
                    .flex_col()
                    .children(
                        rows.iter()
                            .map(|row| self.row(row, now, touch, cx).into_any_element())
                            .collect::<Vec<_>>(),
                    )
                    .into_any_element()
            }
        };
        div()
            .id("dm-list")
            .test_support()
            .role(Role::Navigation)
            .aria_label("Conversations")
            .size_full()
            .overflow_y_scroll()
            .child(body)
    }
}
