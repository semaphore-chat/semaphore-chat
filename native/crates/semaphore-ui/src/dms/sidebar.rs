//! `DirectMessagesPage`'s sidebar: "Direct Messages" or "Friends", a "+" for a new conversation,
//! Messages and Friends tabs (the Friends one badged with requests waiting), and the list or the
//! friends panel under them.

use super::{DmListEvent, DmListView, DmSidebar, DmSidebarEvent, DmTab};
use crate::friends::{FriendsEvent, FriendsPanel};
use crate::kit::{Badge, Variant, spacing, text};
use crate::panel::common::{design_icon, icon_button, is_phone};
use crate::theme::SemTheme;
use gpui_kit::base;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_design::Icon as DesignIcon;

impl DmSidebar {
    pub fn new(cx: &mut Context<Self>) -> Self {
        let list = cx.new(DmListView::new);
        let friends = cx.new(|cx| {
            let mut panel = FriendsPanel::new(cx);
            panel.set_show_title(false, cx);
            panel
        });
        let subscriptions = vec![
            cx.subscribe(&list, |_, _, event: &DmListEvent, cx| {
                cx.emit(DmSidebarEvent::List(event.clone()));
            }),
            cx.subscribe(&friends, |_, _, event: &FriendsEvent, cx| {
                cx.emit(DmSidebarEvent::Friends(event.clone()));
            }),
            // The Friends tab's badge counts what the panel was given.
            cx.observe(&friends, |_, _, cx| cx.notify()),
        ];
        Self {
            list,
            friends,
            tab: DmTab::Messages,
            _subscriptions: subscriptions,
        }
    }

    pub fn list(&self) -> &Entity<DmListView> {
        &self.list
    }

    pub fn friends(&self) -> &Entity<FriendsPanel> {
        &self.friends
    }

    pub fn tab(&self) -> DmTab {
        self.tab
    }

    /// Shows a tab; the owner does this after a friend's "Message" opens their conversation.
    pub fn set_tab(&mut self, tab: DmTab, cx: &mut Context<Self>) {
        if self.tab != tab {
            self.tab = tab;
            cx.emit(DmSidebarEvent::TabChanged(tab));
            cx.notify();
        }
    }

    fn tab_button(
        &self,
        tab: DmTab,
        icon: DesignIcon,
        label: &'static str,
        badge: usize,
        cx: &mut Context<Self>,
    ) -> impl IntoElement + use<> {
        let sem = cx.sem();
        let selected = self.tab == tab;
        let color = if selected {
            sem.tab_selected
        } else {
            sem.text_secondary
        };
        let (line, hover) = (sem.primary, sem.action_hover);
        let id = match tab {
            DmTab::Messages => "dm-tab-messages",
            DmTab::Friends => "dm-tab-friends",
        };
        let name = if badge > 0 {
            format!("{label}, {badge} requests")
        } else {
            label.to_owned()
        };
        base::Button::new(id)
            .role(Role::Tab)
            .accessibility_label(name)
            .selected(selected)
            .flex_1()
            .min_w_0()
            .h(px(48.))
            .relative()
            .flex()
            .items_center()
            .justify_center()
            .gap(px(8.))
            .px(spacing(1.))
            .cursor_pointer()
            .hover(move |style| style.bg(hover))
            .focus_visible(move |style| style.bg(hover))
            .text_color(color)
            .child(
                Badge::new(badge as u32)
                    .compact()
                    .on(design_icon(icon, 20., color)),
            )
            .child(text(Variant::Button, label).truncate())
            .when(selected, |tab| {
                tab.child(
                    div()
                        .absolute()
                        .left_0()
                        .right_0()
                        .bottom_0()
                        .h(px(2.))
                        .bg(line),
                )
            })
            .on_click(cx.listener(move |sidebar, _, _, cx| sidebar.set_tab(tab, cx)))
    }
}

impl Render for DmSidebar {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let touch = is_phone(window);
        let sem = cx.sem().clone();
        let incoming = self.friends.read(cx).incoming_count();
        let messages = self.tab == DmTab::Messages;
        let add = messages.then(|| {
            icon_button(
                "dm-new",
                DesignIcon::Add,
                "New conversation",
                touch,
                sem.action_active,
                cx,
            )
            .on_click(
                cx.listener(|_, _, _, cx| cx.emit(DmSidebarEvent::List(DmListEvent::NewMessage))),
            )
        });
        // On a phone the app bar already says "Direct Messages".
        let header = (!touch || add.is_some()).then(|| {
            div()
                .flex_shrink_0()
                .flex()
                .items_center()
                .justify_between()
                .gap(spacing(1.))
                .px(spacing(2.))
                .min_h(px(if touch { 48. } else { 64. }))
                .border_b_1()
                .border_color(sem.divider)
                .child(if touch {
                    div().flex_1().into_any_element()
                } else {
                    text(
                        Variant::H6,
                        if messages {
                            "Direct Messages"
                        } else {
                            "Friends"
                        },
                    )
                    .font_weight(FontWeight(700.))
                    .text_color(sem.text_primary)
                    .truncate()
                    .into_any_element()
                })
                .children(add)
        });
        let body: AnyElement = if messages {
            self.list.clone().into_any_element()
        } else {
            self.friends.clone().into_any_element()
        };
        div()
            .id("dm-sidebar")
            .test_support()
            .size_full()
            .flex()
            .flex_col()
            .bg(sem.paper)
            .children(header)
            .child(
                div()
                    .id("dm-tabs")
                    .test_support()
                    .role(Role::TabList)
                    .aria_label("Direct messages and friends")
                    .flex_shrink_0()
                    .flex()
                    .border_b_1()
                    .border_color(sem.divider)
                    .child(self.tab_button(DmTab::Messages, DesignIcon::Chat, "Messages", 0, cx))
                    .child(self.tab_button(
                        DmTab::Friends,
                        DesignIcon::People,
                        "Friends",
                        incoming,
                        cx,
                    )),
            )
            .child(div().flex_1().min_h_0().child(body))
    }
}
