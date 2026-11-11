//! The notification centre drawn, after `NotificationList.tsx`: one compact row a notification,
//! `[avatar+kind] [Name · label ..... time] [preview .... dot]`, with mark read and dismiss.

use super::{NotificationCenter, NotificationEvent};
use crate::dms::face::user_face;
use crate::dms::names::{last_message_time, user_name};
use crate::kit::{Button, ButtonSize, Skeleton, Variant, spacing, text};
use crate::panel::common::{
    design_icon, empty_block, error_block, icon_button, is_phone, panel_header, preview_text,
    relative_time,
};
use crate::theme::SemTheme;
use gpui_kit::base;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{LoadState, NotificationKind, NotificationRow};
use semaphore_design::Icon as DesignIcon;

const AVATAR: f32 = 40.;
const KIND_BADGE: f32 = 18.;

/// `getNotificationTypeLabel`.
pub fn kind_label(kind: NotificationKind) -> &'static str {
    match kind {
        NotificationKind::Mention => "Mentioned you",
        NotificationKind::DirectMessage => "Sent a message",
        NotificationKind::ChannelMessage => "New message",
        NotificationKind::ThreadReply => "Replied in a thread",
    }
}

fn kind_icon(kind: NotificationKind) -> DesignIcon {
    match kind {
        NotificationKind::Mention => DesignIcon::AlternateEmail,
        NotificationKind::DirectMessage => DesignIcon::Chat,
        NotificationKind::ChannelMessage => DesignIcon::Tag,
        NotificationKind::ThreadReply => DesignIcon::Forum,
    }
}

/// A row's accessible name: `getNotificationText`, where, when, and whether it is unread.
pub fn notification_label(row: &NotificationRow, now_ms: i64) -> String {
    let author = user_name(&row.author);
    let preview = preview_text(&row.preview, Some(100));
    let mut label = match (row.kind, preview.is_empty()) {
        (NotificationKind::Mention, false) => format!("{author} mentioned you: {preview}"),
        (NotificationKind::Mention, true) => format!("{author} mentioned you"),
        (NotificationKind::ThreadReply, false) => {
            format!("{author} replied in a thread: {preview}")
        }
        (NotificationKind::ThreadReply, true) => format!("{author} replied in a thread"),
        (_, false) => format!("{author}: {preview}"),
        (_, true) => format!("{author}: New message"),
    };
    if let Some(channel) = &row.channel_name {
        label.push_str(&format!(", in #{channel}"));
    }
    label.push_str(&format!(", {}", relative_time(now_ms, row.created_at_ms)));
    if !row.read {
        label.push_str(", unread");
    }
    label
}

impl NotificationCenter {
    fn face(&self, row: &NotificationRow, cx: &App) -> Div {
        let sem = cx.sem();
        // MUI's grey.500 for a read row, solid so the white icon stays legible.
        let tint = if row.read {
            rgb(0x9e9e9e).into()
        } else {
            sem.primary
        };
        let icon = kind_icon(row.kind);
        div()
            .relative()
            .flex_shrink_0()
            .child(user_face(&row.author, AVATAR, None, cx))
            .child(
                div()
                    .absolute()
                    .bottom(px(-3.))
                    .right(px(-3.))
                    .size(px(KIND_BADGE))
                    .flex()
                    .items_center()
                    .justify_center()
                    .rounded_full()
                    .border_2()
                    .border_color(sem.paper)
                    .bg(tint)
                    .child(design_icon(icon, 11., sem.primary_contrast)),
            )
    }

    fn row(
        &self,
        row: &NotificationRow,
        now_ms: i64,
        touch: bool,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let sem = cx.sem().clone();
        let unread = !row.read;
        let id = row.id.clone();
        let author = user_name(&row.author);
        // The channel is in the row's accessible name; the line keeps the web's short label.
        let label_line = kind_label(row.kind);
        let preview = preview_text(&row.preview, Some(100));
        let (hover, unread_bg) = (sem.action_hover, sem.action_hover);
        let open = {
            let id = id.clone();
            let link = row.link.clone();
            let parent = row.parent_message_id.clone();
            cx.listener(move |_, _, _, cx| {
                if unread {
                    cx.emit(NotificationEvent::MarkRead { id: id.clone() });
                }
                cx.emit(NotificationEvent::Open {
                    notification_id: id.clone(),
                    link: link.clone(),
                    parent_message_id: parent.clone(),
                });
            })
        };
        let mark = unread.then(|| {
            let id = id.clone();
            icon_button(
                ElementId::Name(format!("notification-read-{id}").into()),
                DesignIcon::CheckCircle,
                "Mark as read",
                touch,
                sem.text_secondary,
                cx,
            )
            .on_click(cx.listener(move |_, _, _, cx| {
                cx.stop_propagation();
                cx.emit(NotificationEvent::MarkRead { id: id.clone() });
            }))
        });
        let dismiss = icon_button(
            ElementId::Name(format!("notification-dismiss-{id}").into()),
            DesignIcon::Close,
            "Dismiss",
            touch,
            sem.text_secondary,
            cx,
        )
        .on_click(cx.listener({
            let id = id.clone();
            move |_, _, _, cx| {
                cx.stop_propagation();
                cx.emit(NotificationEvent::Dismiss { id: id.clone() });
            }
        }));
        div()
            .w_full()
            .flex()
            .items_center()
            .pr(spacing(1.))
            .border_b_1()
            .border_color(sem.divider)
            .when(unread, |row| row.bg(unread_bg))
            .child(
                base::Button::new(ElementId::Name(format!("notification-{id}").into()))
                    .accessibility_label(notification_label(row, now_ms))
                    .flex_1()
                    .min_w_0()
                    .min_h(px(56.))
                    .px(spacing(2.))
                    .py(spacing(1.))
                    .flex()
                    .items_center()
                    .gap(spacing(1.5))
                    .cursor_pointer()
                    .hover(move |style| style.bg(hover))
                    .focus_visible(move |style| style.bg(hover))
                    .child(self.face(row, cx))
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
                                    .items_baseline()
                                    .gap(px(6.))
                                    .min_w_0()
                                    .child(
                                        text(Variant::Body1, author)
                                            .flex_shrink_0()
                                            .max_w(relative(0.55))
                                            .truncate()
                                            .font_weight(FontWeight(if unread {
                                                700.
                                            } else {
                                                500.
                                            }))
                                            .text_color(sem.text_primary),
                                    )
                                    .child(
                                        text(Variant::Body2, label_line)
                                            .min_w_0()
                                            .truncate()
                                            .text_color(sem.text_secondary),
                                    )
                                    .child(
                                        text(
                                            Variant::Caption,
                                            last_message_time(now_ms, row.created_at_ms),
                                        )
                                        .ml_auto()
                                        .pl(px(8.))
                                        .flex_shrink_0()
                                        .whitespace_nowrap()
                                        .text_color(if unread {
                                            sem.text_primary
                                        } else {
                                            sem.text_secondary
                                        })
                                        .when(unread, |time| time.font_weight(FontWeight(600.))),
                                    ),
                            )
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap(spacing(1.))
                                    .min_w_0()
                                    .child(
                                        text(
                                            Variant::Body2,
                                            if preview.is_empty() {
                                                "\u{a0}".to_owned()
                                            } else {
                                                preview
                                            },
                                        )
                                        .flex_1()
                                        .min_w_0()
                                        .truncate()
                                        .text_color(
                                            if unread {
                                                sem.text_primary
                                            } else {
                                                sem.text_secondary
                                            },
                                        ),
                                    )
                                    .when(unread, |line| {
                                        line.child(
                                            div()
                                                .size(px(8.))
                                                .flex_shrink_0()
                                                .rounded_full()
                                                .bg(sem.primary),
                                        )
                                    }),
                            ),
                    )
                    .on_click(open),
            )
            .child(
                div()
                    .flex()
                    .flex_shrink_0()
                    .items_center()
                    .children(mark)
                    .child(dismiss),
            )
            .into_any_element()
    }
}

impl Render for NotificationCenter {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let touch = is_phone(window);
        let sem = cx.sem().clone();
        let close = icon_button(
            "notifications-close",
            DesignIcon::Close,
            "Close notifications",
            touch,
            sem.text_secondary,
            cx,
        )
        .on_click(cx.listener(|_, _, _, cx| cx.emit(NotificationEvent::Close)))
        .into_any_element();
        let ready = matches!(self.list.state, LoadState::Ready);
        let unread = self.list.unread_count;
        let subtitle =
            (ready && unread > 0).then(|| SharedString::from(format!("{unread} unread")));
        let header = panel_header(
            DesignIcon::Notifications,
            "Notifications",
            subtitle,
            vec![close],
            touch,
            cx,
        );
        let mark_all = (ready && unread > 0).then(|| {
            div()
                .flex_shrink_0()
                .flex()
                .justify_end()
                .px(spacing(2.))
                .py(spacing(1.))
                .border_b_1()
                .border_color(sem.divider)
                .child(
                    Button::new("notifications-mark-all", "Mark all as read")
                        .size(ButtonSize::Small)
                        .start_icon(DesignIcon::CheckCircle)
                        .on_click(
                            cx.listener(|_, _, _, cx| cx.emit(NotificationEvent::MarkAllRead)),
                        ),
                )
        });
        let body: Vec<AnyElement> = match &self.list.state {
            LoadState::Loading => vec![
                div()
                    .id("notifications-loading")
                    .test_support()
                    .role(Role::ProgressIndicator)
                    .aria_label("Loading notifications")
                    .p(spacing(2.))
                    .flex()
                    .flex_col()
                    .gap(spacing(2.))
                    .children((0..8usize).map(|index| {
                        div()
                            .flex()
                            .items_center()
                            .gap(spacing(1.5))
                            .child(Skeleton::circle(
                                ("notification-loading-face", index),
                                AVATAR,
                            ))
                            .child(
                                div()
                                    .flex_1()
                                    .flex()
                                    .flex_col()
                                    .gap(px(6.))
                                    .child(Skeleton::rect(
                                        ("notification-loading-name", index),
                                        relative(0.6),
                                        14.,
                                    ))
                                    .child(Skeleton::rect(
                                        ("notification-loading-text", index),
                                        relative(0.9),
                                        12.,
                                    )),
                            )
                    }))
                    .into_any_element(),
            ],
            LoadState::Failed { .. } => vec![error_block(
                "notifications-retry",
                "Couldn't load notifications",
                "Check your connection and try again.",
                cx.listener(|_, _, _, cx| cx.emit(NotificationEvent::Retry)),
                cx,
            )],
            LoadState::Ready if self.list.rows.is_empty() => vec![
                div()
                    .flex()
                    .flex_col()
                    .items_center()
                    .child(empty_block(
                        DesignIcon::NotificationsNone,
                        "No notifications",
                        "You'll see mentions, replies, and direct messages here.",
                        cx,
                    ))
                    .child(
                        Button::new("notifications-refresh", "Refresh")
                            .outlined()
                            .on_click(cx.listener(|_, _, _, cx| cx.emit(NotificationEvent::Retry))),
                    )
                    .into_any_element(),
            ],
            LoadState::Ready => {
                let now = self.clock.now_ms();
                let rows = self.list.rows.clone();
                let mut body: Vec<AnyElement> = rows
                    .iter()
                    .map(|row| self.row(row, now, touch, cx))
                    .collect();
                if self.list.has_more {
                    body.push(
                        div()
                            .flex()
                            .justify_center()
                            .p(spacing(2.))
                            .child(
                                Button::new("notifications-more", "Load more")
                                    .outlined()
                                    .loading(self.loading_more)
                                    .on_click(cx.listener(|center, _, _, cx| {
                                        if !center.loading_more {
                                            cx.emit(NotificationEvent::LoadMore);
                                        }
                                    })),
                            )
                            .into_any_element(),
                    );
                }
                body
            }
        };
        div()
            .id("notification-center")
            .test_support()
            .role(Role::Complementary)
            .aria_label("Notifications")
            .size_full()
            .flex()
            .flex_col()
            .bg(sem.paper)
            .child(header)
            .children(mark_all)
            .child(
                div()
                    .id("notifications-scroll")
                    .test_support()
                    .role(Role::List)
                    .aria_label("Notifications")
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scroll()
                    .flex()
                    .flex_col()
                    .children(body),
            )
    }
}
