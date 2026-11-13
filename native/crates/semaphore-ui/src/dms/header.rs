//! The conversation header, after `DMChatHeader.tsx`. US2 adds a group's overflow menu: "Add people"
//! and "Leave group" (the latter behind a confirm).

use super::names::dm_title;
use super::{DmHeader, DmHeaderEvent, DmHeaderState};
use crate::community_settings::common::Confirm;
use crate::kit::{Menu, MenuItem, Skeleton, Variant, spacing, text};
use crate::panel::common::{icon_button, is_phone};
use crate::theme::SemTheme;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_design::Icon as DesignIcon;

impl DmHeader {
    /// The conversation's name, when it is a group that has one.
    fn group_name(&self) -> Option<String> {
        match &self.state {
            DmHeaderState::Ready(row) if row.is_group => Some(dm_title(row)),
            _ => None,
        }
    }

    /// US2: "Add people" picked: the owner opens the user picker.
    fn add_people(&mut self, cx: &mut Context<Self>) {
        self.menu_open = false;
        cx.emit(DmHeaderEvent::AddPeople);
        cx.notify();
    }

    /// US2: "Leave group" picked: ask, as the web's ConfirmDialog would.
    fn confirm_leave(&mut self, cx: &mut Context<Self>) {
        self.menu_open = false;
        self.leave_open = true;
        cx.notify();
    }

    /// The overflow button and its menu, below it at the header's end.
    fn group_menu(&self, touch: bool, cx: &mut Context<Self>) -> AnyElement {
        let height = if touch { 48. } else { 36. };
        let add = cx.weak_entity();
        let leave = cx.weak_entity();
        let items = vec![
            MenuItem::new("dm-add-people", "Add people", move |_, cx| {
                add.update(cx, |header, cx| header.add_people(cx)).ok();
            })
            .icon(DesignIcon::PersonAdd)
            .min_height(height),
            MenuItem::new("dm-leave", "Leave group", move |_, cx| {
                leave.update(cx, |header, cx| header.confirm_leave(cx)).ok();
            })
            .icon(DesignIcon::Logout)
            .destructive()
            .min_height(height),
        ];
        div()
            .relative()
            .flex_shrink_0()
            .child(
                icon_button(
                    "dm-header-more",
                    DesignIcon::MoreVert,
                    "Conversation actions",
                    touch,
                    cx.sem().action_active,
                    cx,
                )
                .selected(self.menu_open)
                .on_click(cx.listener(|header, _, _, cx| {
                    header.menu_open = !header.menu_open;
                    cx.notify();
                })),
            )
            .children(self.menu_open.then(|| {
                div()
                    .absolute()
                    .top(px(if touch { 48. } else { 38. }))
                    .right_0()
                    .child(
                        deferred(
                            anchored()
                                .anchor(Anchor::TopRight)
                                .snap_to_window_with_margin(px(8.))
                                .child(
                                    div()
                                        .w(px(220.))
                                        .occlude()
                                        .on_mouse_down_out(cx.listener(|header, _, _, cx| {
                                            header.menu_open = false;
                                            cx.notify();
                                        }))
                                        .child(Menu::new("Conversation actions", items)),
                                ),
                        )
                        .with_priority(1),
                    )
            }))
            .into_any_element()
    }
}

impl Render for DmHeader {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let touch = is_phone(window);
        let sem = cx.sem().clone();
        let back = self.back.then(|| {
            icon_button(
                "dm-header-back",
                DesignIcon::ArrowBack,
                "Back to conversations",
                touch,
                sem.action_active,
                cx,
            )
            .on_click(cx.listener(|_, _, _, cx| cx.emit(DmHeaderEvent::Back)))
        });
        let title: AnyElement = match &self.state {
            DmHeaderState::Loading => div()
                .id("dm-header-loading")
                .test_support()
                .role(Role::ProgressIndicator)
                .aria_label("Loading conversation")
                .w(px(160.))
                .max_w_full()
                .child(Skeleton::rect("dm-header-skeleton", relative(1.), 20.))
                .into_any_element(),
            DmHeaderState::Unavailable => text(Variant::H6, "Conversation unavailable")
                .font_weight(FontWeight(600.))
                .text_color(sem.text_primary)
                .truncate()
                .into_any_element(),
            DmHeaderState::Ready(row) => {
                let title = text(Variant::H6, dm_title(row))
                    .font_weight(FontWeight(600.))
                    .text_color(sem.text_primary)
                    .min_w_0()
                    .truncate();
                match row.members.first().filter(|_| !row.is_group) {
                    Some(other) => {
                        let user_id = other.id.clone();
                        div()
                            .id("dm-header-title")
                            .test_support()
                            .role(Role::Button)
                            .aria_label(SharedString::from(format!(
                                "View {}'s profile",
                                dm_title(row)
                            )))
                            .min_w_0()
                            .cursor_pointer()
                            .child(title)
                            .on_click(cx.listener(move |_, _, _, cx| {
                                cx.emit(DmHeaderEvent::OpenProfile {
                                    user_id: user_id.clone(),
                                })
                            }))
                            .into_any_element()
                    }
                    None => title.into_any_element(),
                }
            }
        };
        let ready = matches!(self.state, DmHeaderState::Ready(_));
        let view = cx.entity().downgrade();
        let call = self.call.filter(|_| ready).map(|state| {
            let (voice, video) = (view.clone(), view);
            crate::voice::dm_call_controls(
                state,
                crate::voice::DmCallActions {
                    on_voice: std::rc::Rc::new(move |_, cx| {
                        voice
                            .update(cx, |_, cx| cx.emit(DmHeaderEvent::Call { video: false }))
                            .ok();
                    }),
                    on_video: std::rc::Rc::new(move |_, cx| {
                        video
                            .update(cx, |_, cx| cx.emit(DmHeaderEvent::Call { video: true }))
                            .ok();
                    }),
                },
                cx,
            )
        });
        let search = (ready && self.search).then(|| {
            icon_button(
                "dm-header-search",
                DesignIcon::Search,
                "Search messages",
                touch,
                sem.action_active,
                cx,
            )
            .on_click(cx.listener(|_, _, _, cx| cx.emit(DmHeaderEvent::Search)))
        });
        let members = (ready && self.members_button).then(|| {
            icon_button(
                "dm-header-members",
                DesignIcon::People,
                "Members",
                touch,
                sem.action_active,
                cx,
            )
            .on_click(cx.listener(|_, _, _, cx| cx.emit(DmHeaderEvent::OpenMembers)))
        });
        let more = (ready && self.group).then(|| self.group_menu(touch, cx));
        let leave = (self.group && self.leave_open).then(|| {
            let name = self.group_name().unwrap_or_else(|| "this group".to_owned());
            let confirm = cx.weak_entity();
            let cancel = cx.weak_entity();
            Confirm {
                id: "dm-leave",
                title: "Leave group",
                message: format!("Leave {name}? You won't get its messages."),
                confirm: "Leave group",
                busy: false,
            }
            .dialog(
                move |_, cx| {
                    confirm
                        .update(cx, |header, cx| {
                            header.leave_open = false;
                            cx.emit(DmHeaderEvent::Leave);
                            cx.notify();
                        })
                        .ok();
                },
                move |_, cx| {
                    cancel
                        .update(cx, |header, cx| {
                            header.leave_open = false;
                            cx.notify();
                        })
                        .ok();
                },
                cx,
            )
        });
        div()
            .id("dm-header")
            .test_support()
            .role(Role::Banner)
            .w_full()
            .flex_shrink_0()
            .min_h(px(64.))
            .px(spacing(2.))
            .py(spacing(1.5))
            .flex()
            .items_center()
            .justify_between()
            .gap(spacing(1.))
            .bg(sem.paper)
            .border_b_1()
            .border_color(sem.divider)
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .flex()
                    .items_center()
                    .gap(spacing(1.5))
                    .children(back)
                    .child(div().flex_1().min_w_0().flex().child(title)),
            )
            .child(
                div()
                    .flex()
                    .flex_shrink_0()
                    .items_center()
                    .gap(px(4.))
                    .children(search)
                    .children(call)
                    .children(members)
                    .children(more),
            )
            .children(leave)
    }
}
