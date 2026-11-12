//! `FriendsPanel` drawn: the header, the tabs, the friends and the requests.

use super::{FriendsEvent, FriendsPanel, FriendsTab, RequestsTab};
use crate::dms::face::user_face;
use crate::dms::names::user_name;
use crate::kit::{Button, ButtonSize, Skeleton, Tabs, Variant, spacing, text};
use crate::messages::TimeFormat;
use crate::panel::common::{design_icon, empty_block, error_block, icon_button, is_phone};
use crate::theme::SemTheme;
use gpui_kit::base;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{FriendRequestRow, FriendRow, LoadState};
use semaphore_design::Icon as DesignIcon;

const DAY_MS: i64 = 24 * 60 * 60 * 1000;

/// `FriendRequestCard`'s `formatDate`: "Today", "Yesterday", "3 days ago", then the date in
/// `time`'s zone.
pub fn request_date(time: &TimeFormat, now_ms: i64, sent_at_ms: i64) -> String {
    let days = (now_ms - sent_at_ms).max(0) / DAY_MS;
    match days {
        0 => "Today".to_owned(),
        1 => "Yesterday".to_owned(),
        days if days < 7 => format!("{days} days ago"),
        _ => time.format_at(sent_at_ms, "%-m/%-d/%Y"),
    }
}

fn section_label(label: String, cx: &App) -> Div {
    text(Variant::Caption, label.to_uppercase())
        .px(spacing(2.))
        .py(spacing(1.))
        .text_color(cx.sem().text_secondary)
}

impl FriendsPanel {
    fn friend_row(&self, row: &FriendRow, touch: bool, cx: &mut Context<Self>) -> AnyElement {
        let sem = cx.sem().clone();
        let name = user_name(&row.user);
        let id = row.friendship_id.clone();
        let user_id = row.user.id.clone();
        let busy = row.busy;
        let menu_open = self.menu.as_deref() == Some(id.as_str());
        let hover = sem.list_hover;
        let status = if row.online { "Online" } else { "Offline" };
        let more = icon_button(
            ElementId::Name(format!("friend-more-{id}").into()),
            DesignIcon::MoreVert,
            format!("More for {name}"),
            touch,
            sem.action_active,
            cx,
        )
        .disabled(busy)
        .on_click(cx.listener({
            let id = id.clone();
            move |panel, _, _, cx| {
                cx.stop_propagation();
                panel.menu = if panel.menu.as_deref() == Some(id.as_str()) {
                    None
                } else {
                    Some(id.clone())
                };
                cx.notify();
            }
        }));
        let menu = menu_open.then(|| {
            let item = |item_id: String, icon: DesignIcon, label: &str, color: Hsla| {
                base::Button::new(ElementId::Name(item_id.into()))
                    .role(Role::MenuItem)
                    .accessibility_label(label.to_owned())
                    .min_h(px(36.))
                    .px(px(16.))
                    .flex()
                    .items_center()
                    .gap(spacing(1.5))
                    .cursor_pointer()
                    .hover(move |style| style.bg(hover))
                    .focus_visible(move |style| style.bg(hover))
                    .text_color(color)
                    .child(design_icon(icon, 20., color))
                    .child(text(Variant::Body1, label.to_owned()))
            };
            let message = item(
                format!("friend-message-{id}"),
                DesignIcon::Message,
                "Message",
                sem.text_primary,
            )
            .on_click(cx.listener({
                let user_id = user_id.clone();
                move |panel, _, _, cx| {
                    panel.menu = None;
                    cx.emit(FriendsEvent::Message {
                        user_id: user_id.clone(),
                    });
                }
            }));
            let profile = item(
                format!("friend-profile-{id}"),
                DesignIcon::Person,
                "View Profile",
                sem.text_primary,
            )
            .on_click(cx.listener({
                let user_id = user_id.clone();
                move |panel, _, _, cx| {
                    panel.menu = None;
                    cx.emit(FriendsEvent::OpenProfile {
                        user_id: user_id.clone(),
                    });
                }
            }));
            let remove = item(
                format!("friend-remove-{id}"),
                DesignIcon::PersonRemove,
                "Remove Friend",
                sem.error,
            )
            .on_click(cx.listener({
                let id = id.clone();
                move |panel, _, _, cx| {
                    panel.menu = None;
                    cx.emit(FriendsEvent::Remove {
                        friendship_id: id.clone(),
                    });
                }
            }));
            deferred(
                anchored().anchor(Anchor::TopRight).snap_to_window().child(
                    div()
                        .id("friend-menu")
                        .test_support()
                        .role(Role::Menu)
                        .aria_label(format!("Actions for {name}"))
                        .min_w(px(180.))
                        .py(px(8.))
                        .rounded(px(4.))
                        .bg(sem.paper)
                        .border_1()
                        .border_color(sem.divider)
                        .shadow_lg()
                        .occlude()
                        .on_mouse_down_out(cx.listener(|panel, _, _, cx| {
                            panel.menu = None;
                            cx.notify();
                        }))
                        .child(message)
                        .child(profile)
                        .child(remove),
                ),
            )
            .with_priority(1)
        });
        div()
            .relative()
            .w_full()
            .flex()
            .items_center()
            .pr(spacing(1.))
            .when(busy, |row| row.opacity(0.5))
            .child(
                base::Button::new(ElementId::Name(format!("friend-{id}").into()))
                    .accessibility_label(format!("{name}, {status}"))
                    .disabled(busy)
                    .flex_1()
                    .min_w_0()
                    .when(touch, |row| row.min_h(px(56.)))
                    .px(spacing(2.))
                    .py(spacing(1.))
                    .flex()
                    .items_center()
                    .gap(spacing(2.))
                    .when(!busy, |row| {
                        row.cursor_pointer()
                            .hover(move |style| style.bg(hover))
                            .focus_visible(move |style| style.bg(hover))
                    })
                    .child(user_face(&row.user, 40., Some(row.online), cx))
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .flex()
                            .flex_col()
                            .child(
                                text(Variant::Body1, name.clone())
                                    .text_color(sem.text_primary)
                                    .truncate(),
                            )
                            .child(
                                text(Variant::Body2, format!("@{}", row.user.username))
                                    .text_color(sem.text_secondary)
                                    .truncate(),
                            ),
                    )
                    .on_click(cx.listener(move |_, _, _, cx| {
                        cx.emit(FriendsEvent::Message {
                            user_id: user_id.clone(),
                        })
                    })),
            )
            .child(
                div()
                    .flex_shrink_0()
                    .child(more)
                    .child(div().absolute().right(spacing(1.)).children(menu)),
            )
            .into_any_element()
    }

    fn request_row(
        &self,
        row: &FriendRequestRow,
        incoming: bool,
        now_ms: i64,
        touch: bool,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let sem = cx.sem().clone();
        let name = user_name(&row.user);
        let id = row.friendship_id.clone();
        let busy = row.busy;
        let when = request_date(&self.time, now_ms, row.sent_at_ms);
        let secondary = if incoming {
            format!("Sent {when}")
        } else {
            format!("Pending since {when}")
        };
        let action = |key: &str,
                      icon: DesignIcon,
                      label: String,
                      color: Hsla,
                      event: FriendsEvent,
                      cx: &mut Context<Self>| {
            icon_button(
                ElementId::Name(format!("request-{key}-{id}").into()),
                icon,
                label,
                touch,
                color,
                cx,
            )
            .disabled(busy)
            .on_click(cx.listener(move |_, _, _, cx| cx.emit(event.clone())))
            .into_any_element()
        };
        let actions = if incoming {
            vec![
                action(
                    "accept",
                    DesignIcon::Check,
                    format!("Accept {name}"),
                    sem.success,
                    FriendsEvent::Accept {
                        friendship_id: id.clone(),
                    },
                    cx,
                ),
                action(
                    "decline",
                    DesignIcon::Close,
                    format!("Decline {name}"),
                    sem.error,
                    FriendsEvent::Decline {
                        friendship_id: id.clone(),
                    },
                    cx,
                ),
            ]
        } else {
            vec![action(
                "cancel",
                DesignIcon::Cancel,
                format!("Cancel request to {name}"),
                sem.error,
                FriendsEvent::Cancel {
                    friendship_id: id.clone(),
                },
                cx,
            )]
        };
        div()
            .id(ElementId::Name(format!("request-{id}").into()))
            .test_support()
            .role(Role::ListItem)
            .aria_label(format!("{name}, {secondary}"))
            .w_full()
            .when(touch, |row| row.min_h(px(56.)))
            .px(spacing(2.))
            .py(spacing(1.))
            .flex()
            .items_center()
            .gap(spacing(2.))
            .when(busy, |row| row.opacity(0.5))
            .child(user_face(&row.user, 40., None, cx))
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .flex()
                    .flex_col()
                    .child(
                        text(Variant::Body1, name)
                            .text_color(sem.text_primary)
                            .truncate(),
                    )
                    .child(
                        text(Variant::Body2, secondary)
                            .text_color(sem.text_secondary)
                            .truncate(),
                    ),
            )
            .child(
                div()
                    .flex()
                    .flex_shrink_0()
                    .items_center()
                    .gap(px(4.))
                    .children(actions),
            )
            .into_any_element()
    }

    fn friends_body(&self, touch: bool, cx: &mut Context<Self>) -> Vec<AnyElement> {
        if self.view.friends.is_empty() {
            return vec![
                empty_block(
                    DesignIcon::People,
                    "No friends yet",
                    "Add friends to see them here",
                    cx,
                )
                .into_any_element(),
            ];
        }
        let rows = self.view.friends.clone();
        let mut body =
            vec![section_label(format!("All Friends - {}", rows.len()), cx).into_any_element()];
        body.extend(rows.iter().map(|row| self.friend_row(row, touch, cx)));
        body
    }

    fn requests_body(&self, touch: bool, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let incoming = self.requests_tab == RequestsTab::Received;
        let labels = vec![
            SharedString::from(format!("Received ({})", self.view.incoming.len())),
            SharedString::from(format!("Sent ({})", self.view.outgoing.len())),
        ];
        let tabs = Tabs::new("requests-tabs", labels, if incoming { 0 } else { 1 }).on_select({
            let view = cx.weak_entity();
            move |index, _, cx| {
                let tab = if index == 0 {
                    RequestsTab::Received
                } else {
                    RequestsTab::Sent
                };
                view.update(cx, |panel, cx| panel.set_requests_tab(tab, cx))
                    .ok();
            }
        });
        let rows = if incoming {
            self.view.incoming.clone()
        } else {
            self.view.outgoing.clone()
        };
        let mut body = vec![div().w_full().child(tabs).into_any_element()];
        if rows.is_empty() {
            let (title, hint) = if incoming {
                (
                    "No pending requests",
                    "Friend requests you receive will appear here",
                )
            } else {
                (
                    "No sent requests",
                    "Friend requests you send will appear here",
                )
            };
            body.push(empty_block(DesignIcon::PersonAdd, title, hint, cx).into_any_element());
        } else {
            let now = self.clock.now_ms();
            body.extend(
                rows.iter()
                    .map(|row| self.request_row(row, incoming, now, touch, cx)),
            );
        }
        body
    }
}

impl Render for FriendsPanel {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let touch = is_phone(window);
        let sem = cx.sem().clone();
        let pending = self.view.incoming.len() + self.view.outgoing.len();
        let incoming = self.view.incoming.len();
        let header = div()
            .flex_shrink_0()
            .flex()
            .items_center()
            .when(self.show_title, |header| header.justify_between())
            .when(!self.show_title, |header| header.justify_end())
            .p(spacing(2.))
            .border_b_1()
            .border_color(sem.divider)
            .when(self.show_title, |header| {
                header.child(text(Variant::H6, "Friends").text_color(sem.text_primary))
            })
            .child(
                Button::new("friends-add", "Add Friend")
                    .contained()
                    .size(ButtonSize::Small)
                    .start_icon(DesignIcon::PersonAdd)
                    .on_click(cx.listener(|_, _, _, cx| cx.emit(FriendsEvent::AddFriend))),
            );
        let pending_label = if incoming > 0 {
            format!("Pending ({pending}) · {incoming} new")
        } else {
            format!("Pending ({pending})")
        };
        let tabs = Tabs::new(
            "friends-tabs",
            vec![
                SharedString::from(format!("All ({})", self.view.friends.len())),
                SharedString::from(pending_label),
            ],
            match self.tab {
                FriendsTab::All => 0,
                FriendsTab::Pending => 1,
            },
        )
        .on_select({
            let view = cx.weak_entity();
            move |index, _, cx| {
                let tab = if index == 0 {
                    FriendsTab::All
                } else {
                    FriendsTab::Pending
                };
                view.update(cx, |panel, cx| panel.set_tab(tab, cx)).ok();
            }
        });
        let body: Vec<AnyElement> = match &self.view.state {
            LoadState::Loading => vec![
                div()
                    .id("friends-loading")
                    .test_support()
                    .role(Role::ProgressIndicator)
                    .aria_label("Loading friends")
                    .p(spacing(2.))
                    .flex()
                    .flex_col()
                    .gap(spacing(2.))
                    .children((0..5usize).map(|index| {
                        div()
                            .flex()
                            .items_center()
                            .gap(spacing(2.))
                            .child(Skeleton::circle(("friend-loading-face", index), 40.))
                            .child(Skeleton::rect(
                                ("friend-loading-name", index),
                                relative(0.6),
                                14.,
                            ))
                    }))
                    .into_any_element(),
            ],
            LoadState::Failed { .. } => vec![error_block(
                "friends-retry",
                "Couldn't load friends",
                "Check your connection and try again.",
                cx.listener(|_, _, _, cx| cx.emit(FriendsEvent::Retry)),
                cx,
            )],
            LoadState::Ready => match self.tab {
                FriendsTab::All => self.friends_body(touch, cx),
                FriendsTab::Pending => self.requests_body(touch, cx),
            },
        };
        div()
            .id("friends-panel")
            .test_support()
            .role(Role::Region)
            .aria_label("Friends")
            .size_full()
            .flex()
            .flex_col()
            .bg(sem.paper)
            .child(header)
            .child(div().w_full().flex_shrink_0().child(tabs))
            .child(
                div()
                    .id("friends-scroll")
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scroll()
                    .flex()
                    .flex_col()
                    .children(body),
            )
    }
}
