//! The conversation header, after `DMChatHeader.tsx`.

use super::names::dm_title;
use super::{DmHeader, DmHeaderEvent, DmHeaderState};
use crate::kit::{Skeleton, Variant, spacing, text};
use crate::panel::common::{icon_button, is_phone};
use crate::theme::SemTheme;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_design::Icon as DesignIcon;

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
        let call = (ready && self.can_call).then(|| {
            icon_button(
                "dm-header-call",
                DesignIcon::Phone,
                "Start a voice call",
                touch,
                sem.action_active,
                cx,
            )
            .on_click(cx.listener(|_, _, _, cx| cx.emit(DmHeaderEvent::JoinCall)))
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
                    .children(members),
            )
    }
}
