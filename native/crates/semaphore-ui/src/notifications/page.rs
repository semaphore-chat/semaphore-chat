//! US2: the notifications page (`/notifications`), the centre's list full width with a title, the
//! All / Unread filter, "Mark all read", dismiss and "Load more", after
//! `pages/NotificationsPage.tsx` and `NotificationList.tsx`. It emits the centre's events.
//!
//! Frozen by the UI freeze: the public API below (`new`, the setters and `NotificationsPageEvent`) is what the app
//! wiring lane builds against while US2 draws the screen; change it only with the coordinator.

use super::{NotificationEvent, kind_label, notification_label};
use crate::dms::face::user_face;
use crate::dms::names::{last_message_time, user_name};
use crate::kit::{Button, ButtonSize, Skeleton, Tabs, Variant, spacing, text, with_tip};
use crate::messages::TimeFormat;
use crate::panel::PanelClock;
use crate::panel::common::{
    design_icon, empty_block, error_block, icon_button, is_phone, preview_text,
};
use crate::theme::SemTheme;
use gpui_kit::base;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{LoadState, NotificationKind, NotificationList, NotificationRow};
use semaphore_design::Icon as DesignIcon;

/// `PAGE_FEED_MAX_WIDTH`: the web's list pages cap their column here.
const PAGE_WIDTH: f32 = 960.;
const AVATAR: f32 = 40.;
const KIND_BADGE: f32 = 18.;

#[derive(Debug, Clone, PartialEq)]
pub enum NotificationsPageEvent {
    /// Every action is the centre's (`NotificationEvent`), handled the same way.
    Notification(super::NotificationEvent),
}

/// Which rows the page shows: the Unread tab hides the ones already read.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
enum Filter {
    #[default]
    All,
    Unread,
}

impl Filter {
    fn index(self) -> usize {
        match self {
            Filter::All => 0,
            Filter::Unread => 1,
        }
    }
}

pub struct NotificationsPage {
    list: NotificationList,
    clock: PanelClock,
    time: TimeFormat,
    filter: Filter,
}

impl EventEmitter<NotificationsPageEvent> for NotificationsPage {}

impl NotificationsPage {
    pub fn new(_window: &mut Window, _cx: &mut Context<Self>) -> Self {
        Self {
            list: NotificationList::default(),
            clock: PanelClock::default(),
            time: TimeFormat::default(),
            filter: Filter::All,
        }
    }

    /// `Core::notifications()`.
    pub fn set_list(&mut self, list: NotificationList, cx: &mut Context<Self>) {
        self.list = list;
        cx.notify();
    }

    /// What "2 hours ago" is measured from.
    pub fn set_clock(&mut self, clock: PanelClock, cx: &mut Context<Self>) {
        self.clock = clock;
        cx.notify();
    }

    /// The zone dates are written in.
    pub fn set_time(&mut self, time: TimeFormat, cx: &mut Context<Self>) {
        self.time = time;
        cx.notify();
    }

    /// A story's filter tab, without an owner to press it.
    #[cfg(feature = "stories")]
    pub(crate) fn show_tab(&mut self, unread: bool, cx: &mut Context<Self>) {
        self.filter = if unread { Filter::Unread } else { Filter::All };
        cx.notify();
    }

    /// The rows the open tab shows: the Unread tab leaves the read ones out.
    fn visible_rows(&self) -> Vec<NotificationRow> {
        self.list
            .rows
            .iter()
            .filter(|row| self.filter == Filter::All || !row.read)
            .cloned()
            .collect()
    }

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
        let when = last_message_time(now_ms, row.created_at_ms);
        // The page knows the zone dates are written in, so the time carries the exact one.
        let at = format!(
            "{} at {}",
            self.time.day_label(row.created_at_ms),
            self.time.clock(row.created_at_ms)
        );
        let (hover, unread_bg) = (sem.action_hover, sem.action_hover);
        let open = {
            let id = id.clone();
            let link = row.link.clone();
            let parent = row.parent_message_id.clone();
            cx.listener(move |_, _, _, cx| {
                if unread {
                    cx.emit(NotificationsPageEvent::Notification(
                        NotificationEvent::MarkRead { id: id.clone() },
                    ));
                }
                cx.emit(NotificationsPageEvent::Notification(
                    NotificationEvent::Open {
                        notification_id: id.clone(),
                        link: link.clone(),
                        parent_message_id: parent.clone(),
                    },
                ));
            })
        };
        // A phone's row is narrower than the panel's, and tapping it already marks it read: the
        // check would only squeeze the name. Dismiss stays, since it is the only way to clear one.
        let mark = (unread && !touch).then(|| {
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
                cx.emit(NotificationsPageEvent::Notification(
                    NotificationEvent::MarkRead { id: id.clone() },
                ));
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
                cx.emit(NotificationsPageEvent::Notification(
                    NotificationEvent::Dismiss { id: id.clone() },
                ));
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
                                            .min_w_0()
                                            .truncate()
                                            .max_w(relative(0.55))
                                            .font_weight(FontWeight(if unread {
                                                700.
                                            } else {
                                                500.
                                            }))
                                            .text_color(sem.text_primary),
                                    )
                                    .child(
                                        // A short fixed label, so it never shrinks: the name is
                                        // what truncates when the row runs out of room.
                                        text(Variant::Body2, label_line)
                                            .flex_shrink_0()
                                            .whitespace_nowrap()
                                            .text_color(sem.text_secondary),
                                    )
                                    .child(with_tip(
                                        text(Variant::Caption, when)
                                            .id(ElementId::Name(
                                                format!("notification-time-{id}").into(),
                                            ))
                                            .ml_auto()
                                            .pl(px(8.))
                                            .flex_shrink_0()
                                            .whitespace_nowrap()
                                            .text_color(if unread {
                                                sem.text_primary
                                            } else {
                                                sem.text_secondary
                                            })
                                            .when(unread, |time| {
                                                time.font_weight(FontWeight(600.))
                                            }),
                                        at,
                                    )),
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

    /// What the tab shows: the skeleton, the error, the empty line or the rows.
    fn body(&self, touch: bool, cx: &mut Context<Self>) -> AnyElement {
        let now = self.clock.now_ms();
        let unread_tab = self.filter == Filter::Unread;
        match &self.list.state {
            LoadState::Loading => div()
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
            LoadState::Failed { .. } => error_block(
                "notifications-retry",
                "Couldn't load notifications",
                "Check your connection and try again.",
                cx.listener(|_, _, _, cx| {
                    cx.emit(NotificationsPageEvent::Notification(
                        NotificationEvent::Retry,
                    ))
                }),
                cx,
            ),
            LoadState::Ready => {
                let rows = self.visible_rows();
                if rows.is_empty() {
                    return div()
                        .flex()
                        .flex_col()
                        .items_center()
                        .pt(spacing(4.))
                        .child(empty_block(
                            DesignIcon::NotificationsNone,
                            if unread_tab {
                                "No unread notifications"
                            } else {
                                "No notifications"
                            },
                            if unread_tab {
                                "You're all caught up."
                            } else {
                                "You'll see mentions, replies, and direct messages here."
                            },
                            cx,
                        ))
                        .child(
                            Button::new("notifications-refresh", "Refresh")
                                .outlined()
                                .on_click(cx.listener(|_, _, _, cx| {
                                    cx.emit(NotificationsPageEvent::Notification(
                                        NotificationEvent::Retry,
                                    ))
                                })),
                        )
                        .into_any_element();
                }
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
                                    .on_click(cx.listener(|_, _, _, cx| {
                                        cx.emit(NotificationsPageEvent::Notification(
                                            NotificationEvent::LoadMore,
                                        ))
                                    })),
                            )
                            .into_any_element(),
                    );
                }
                div()
                    .id("notifications-list")
                    .test_support()
                    .role(Role::List)
                    .aria_label("Notifications")
                    .w_full()
                    .flex()
                    .flex_col()
                    .children(body)
                    .into_any_element()
            }
        }
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

impl Render for NotificationsPage {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let touch = is_phone(window);
        let sem = cx.sem().clone();
        let ready = matches!(self.list.state, LoadState::Ready);
        let unread = self.list.unread_count;
        let tabs = Tabs::new(
            "notifications-tabs",
            vec![SharedString::from("All"), SharedString::from("Unread")],
            self.filter.index(),
        )
        .on_select({
            let view = cx.weak_entity();
            move |index, _, cx| {
                view.update(cx, |page, cx| {
                    let filter = if index == 1 {
                        Filter::Unread
                    } else {
                        Filter::All
                    };
                    if page.filter != filter {
                        page.filter = filter;
                        cx.notify();
                    }
                })
                .ok();
            }
        });
        let mark_all = (ready && unread > 0).then(|| {
            div()
                .flex_shrink_0()
                .flex()
                .justify_end()
                .px(spacing(1.))
                .py(spacing(0.5))
                .child(
                    Button::new("notifications-mark-all", "Mark all as read")
                        .size(ButtonSize::Small)
                        .start_icon(DesignIcon::CheckCircle)
                        .on_click(cx.listener(|_, _, _, cx| {
                            cx.emit(NotificationsPageEvent::Notification(
                                NotificationEvent::MarkAllRead,
                            ))
                        })),
                )
        });
        let body = self.body(touch, cx);
        div()
            .id("notifications-page")
            .test_support()
            .role(Role::Region)
            .aria_label("Notifications")
            .size_full()
            .font_family(crate::theme::FONT_FAMILY)
            .text_color(sem.text_primary)
            .bg(sem.background_default)
            .child(
                div()
                    .w_full()
                    .max_w(px(PAGE_WIDTH))
                    .mx_auto()
                    .flex_1()
                    .min_h_0()
                    .flex()
                    .flex_col()
                    .p(spacing(if touch { 2. } else { 3. }))
                    .child(
                        div().mb(spacing(3.)).child(
                            text(Variant::H5, "Notifications")
                                .font_weight(FontWeight(700.))
                                .text_color(sem.text_primary),
                        ),
                    )
                    .child(
                        // The tabs' own rule ends with them; this one carries it across the page.
                        div()
                            .w_full()
                            .border_b_1()
                            .border_color(sem.divider)
                            .child(tabs),
                    )
                    .children(mark_all)
                    .child(
                        div()
                            .id("notifications-page-scroll")
                            .flex_1()
                            .min_h_0()
                            .overflow_y_scroll()
                            .flex()
                            .flex_col()
                            .child(body),
                    ),
            )
    }
}

#[cfg(feature = "stories")]
pub fn stories() -> Vec<crate::stories::Story> {
    super::stories::page_stories()
}
