//! The community rail: `CommunityToggle`, `CommunityListItem`, `RailNavButton`, `CreateCommunityButton`.

use super::{
    Load, RAIL_EXPANDED_WIDTH, RAIL_WIDTH, Shell, ShellEvent, community_avatar, user_avatar,
};
use crate::kit::{Badge, Icon, IconButton, Variant, spacing, text, with_tip};
use crate::nav::Route;
use crate::theme::{SemTheme, color::hsla_of};
use gpui_kit::base;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{CommunityRow, SessionState, UserView};
use semaphore_design::Icon as IconName;

#[derive(Clone, Copy)]
struct RailNav {
    id: &'static str,
    label: &'static str,
    icon: IconName,
    badge: u32,
    filled: bool,
}

impl Shell {
    pub(super) fn rail(&self, cx: &mut Context<Self>) -> impl IntoElement + use<> {
        let sem = cx.sem().clone();
        let expanded = self.rail_expanded;
        let width = if expanded {
            RAIL_EXPANDED_WIDTH
        } else {
            RAIL_WIDTH
        };
        let counts = self.source.rail_counts();
        let selected = self.nav.current().community_id().map(str::to_owned);
        let communities = self.source.communities();
        let me = match self.source.session() {
            SessionState::SignedIn { me } => Some(me),
            _ => None,
        };
        let divider = sem.divider;
        let section = move || {
            div()
                .flex()
                .flex_col()
                .when(expanded, |this| this.px(spacing(1.)))
                .when(!expanded, |this| this.items_center())
                .gap(spacing(1.))
        };

        let view = cx.entity().downgrade();
        let dm = RailNav {
            id: "rail-dm",
            label: "Messages",
            icon: IconName::Chat,
            badge: counts.dm_unread,
            filled: true,
        };
        let notifications = RailNav {
            id: "rail-notifications",
            label: "Notifications",
            icon: IconName::NotificationsNone,
            badge: counts.notifications_unread,
            filled: false,
        };

        let mut list = div().w_full().flex().flex_col();
        list = match communities {
            Load::Loading => list.child(
                div()
                    .flex()
                    .justify_center()
                    .text_color(hsla_of(sem.palette.grey_500))
                    .child(text(Variant::Body2, "Loading...")),
            ),
            Load::Failed(_) => list.child(
                div()
                    .flex()
                    .justify_center()
                    .text_color(sem.error)
                    .child(text(Variant::Body2, "Error loading").text_center()),
            ),
            Load::Ready(rows) if rows.is_empty() => list.child(if expanded {
                text(Variant::Body2, "No communities yet")
                    .px(spacing(1.))
                    .text_color(sem.text_secondary)
                    .into_any_element()
            } else {
                with_tip(
                    div()
                        .id("rail-no-communities")
                        .test_support()
                        .role(Role::Image)
                        .aria_label("Not in any communities yet")
                        .flex()
                        .justify_center(),
                    "Not in any communities yet",
                )
                .child(Icon::new(IconName::GroupsOutlined).color(sem.text_disabled))
                .into_any_element()
            }),
            Load::Ready(rows) => list.children(rows.into_iter().map(|row| {
                self.community_item(&row, selected.as_deref() == Some(row.id.as_str()), cx)
                    .into_any_element()
            })),
        };

        div()
            .id("community-rail")
            .test_support()
            .role(Role::Navigation)
            .aria_label("Communities")
            .relative()
            .w(px(width))
            .h_full()
            .flex_shrink_0()
            .flex()
            .flex_col()
            .overflow_hidden()
            .bg(sem.paper)
            .border_r_1()
            .border_color(divider)
            .child(
                section()
                    .pt(spacing(2.))
                    .pb(spacing(1.))
                    .child(self.rail_nav(dm, expanded, cx, {
                        let view = view.clone();
                        move |cx| {
                            view.update(cx, |shell, cx| shell.navigate(Route::DirectMessages, cx))
                                .ok();
                        }
                    }))
                    .child(self.rail_nav(notifications, expanded, cx, {
                        let view = view.clone();
                        move |cx| {
                            view.update(cx, |_, cx| cx.emit(ShellEvent::OpenNotifications))
                                .ok();
                        }
                    })),
            )
            .child(div().mx(spacing(2.)).h(px(1.)).flex_shrink_0().bg(divider))
            .child(
                div()
                    .id("rail-scroll")
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scroll()
                    .py(spacing(1.5))
                    .child(
                        section()
                            .gap(spacing(1.5))
                            .child(list.gap(spacing(1.5)))
                            .child(self.create_button(expanded, cx)),
                    ),
            )
            .child(div().mx(spacing(2.)).h(px(1.)).flex_shrink_0().bg(divider))
            .child(
                section()
                    .py(spacing(1.))
                    .child(
                        div()
                            .flex()
                            .when(expanded, |this| this.justify_start())
                            .when(!expanded, |this| this.justify_center())
                            .child(
                                IconButton::new(
                                    "rail-toggle",
                                    if expanded {
                                        IconName::MenuOpen
                                    } else {
                                        IconName::Menu
                                    },
                                    if expanded {
                                        "Collapse sidebar"
                                    } else {
                                        "Expand sidebar"
                                    },
                                )
                                .on_click({
                                    let view = view.clone();
                                    move |_, _, cx| {
                                        view.update(cx, |shell, cx| {
                                            shell.rail_expanded = !shell.rail_expanded;
                                            cx.notify();
                                        })
                                        .ok();
                                    }
                                }),
                            ),
                    )
                    .children(me.map(|me| self.account_button(&me, expanded, cx))),
            )
    }

    fn rail_nav(
        &self,
        nav: RailNav,
        expanded: bool,
        cx: &mut Context<Self>,
        on_click: impl Fn(&mut App) + 'static,
    ) -> AnyElement {
        let sem = cx.sem();
        let size = if expanded { 32. } else { 48. };
        let hover = sem.action_hover;
        let primary = sem.text_primary;
        let (background, icon_color) = if nav.filled {
            (sem.primary, sem.primary_contrast)
        } else {
            (sem.action_selected, sem.text_primary)
        };
        let label = if nav.id == "rail-notifications" {
            format!("Notifications, {} unread", nav.badge)
        } else {
            "Direct Messages".to_owned()
        };
        let icon = div()
            .size(px(size))
            .flex()
            .items_center()
            .justify_center()
            .rounded_full()
            .bg(background)
            .child(Icon::new(nav.icon).color(icon_color));
        let button = base::Button::new(nav.id)
            .accessibility_label(label)
            .w_full()
            .flex()
            .items_center()
            .when(expanded, |this| this.p(px(4.)).justify_start())
            .when(!expanded, |this| this.justify_center())
            .rounded(px(8.))
            .cursor_pointer()
            .hover(move |style| style.bg(hover))
            .focus_visible(move |style| style.bg(hover))
            .on_click(move |_, _, cx| on_click(cx))
            .child(Badge::new(nav.badge).on(icon))
            .when(expanded, |this| {
                this.child(
                    div()
                        .ml(spacing(1.))
                        .min_w_0()
                        .flex_1()
                        .text_color(primary)
                        .child(text(Variant::ListItem, nav.label).truncate()),
                )
            });
        if expanded {
            button.into_any_element()
        } else {
            with_tip(button, nav.label).into_any_element()
        }
    }

    fn community_item(
        &self,
        row: &CommunityRow,
        selected: bool,
        cx: &mut Context<Self>,
    ) -> impl IntoElement + use<> {
        let sem = cx.sem();
        let expanded = self.rail_expanded;
        let (primary_color, text_primary) = (sem.primary, sem.text_primary);
        let selected_bg = sem.primary.opacity(0.12);
        let focus_bg = sem.action_hover;
        let view = cx.entity().downgrade();
        let id = row.id.clone();
        let size = if expanded { 32. } else { 48. };
        let avatar = community_avatar(&row.id, &row.name, row.avatar_file_id.as_deref(), size);
        let avatar = if expanded {
            avatar.text_size_override(14.)
        } else {
            avatar.text_size_override(19.)
        };
        let button = base::Button::new(ElementId::Name(format!("community-{}", row.id).into()))
            .selected(selected)
            .accessibility_label(row.name.clone())
            .when(!expanded, |this| this.w(relative(0.9)).mx_auto())
            .when(expanded, |this| this.w_full())
            .cursor_pointer()
            .flex_shrink_0()
            .rounded(px(8.))
            .focus_visible(move |style| style.bg(focus_bg))
            .child(
                div()
                    .relative()
                    .w_full()
                    .flex()
                    .items_center()
                    .rounded(px(8.))
                    .p(px(if expanded { 4. } else { 8. }))
                    .when(selected, |this| {
                        this.bg(selected_bg)
                            .border_2()
                            .border_color(primary_color)
                            .p(px(if expanded { 2. } else { 6. }))
                    })
                    .child(
                        div()
                            .when(!expanded, |this| this.mx_auto())
                            .when(expanded, |this| this.mr(spacing(1.)))
                            .child(avatar),
                    )
                    .when(expanded, |this| {
                        this.child(
                            div().flex_1().min_w_0().text_color(text_primary).child(
                                text(Variant::Body2, row.name.clone())
                                    .font_weight(FontWeight(600.))
                                    .truncate(),
                            ),
                        )
                    }),
            )
            .on_click(move |_, _, cx| {
                let community_id = id.clone();
                view.update(cx, |shell, cx| {
                    shell.navigate(Route::Community { community_id }, cx);
                })
                .ok();
            });
        if expanded {
            button.into_any_element()
        } else {
            with_tip(button, row.name.clone()).into_any_element()
        }
    }

    /// `CreateCommunityButton`: a dashed box with a plus.
    fn create_button(&self, expanded: bool, cx: &mut Context<Self>) -> AnyElement {
        let sem = cx.sem();
        if !self.can_create_community() {
            return div().into_any_element();
        }
        let dashes = sem.text_secondary.opacity(0.3);
        let view = cx.entity().downgrade();
        let size = if expanded { 32. } else { 40. };
        let (primary, disc, plus) = (sem.text_primary, sem.overlay_heavy, sem.text_primary);
        base::Button::new("rail-create-community")
            .accessibility_label("Create community")
            .when(!expanded, |this| this.w(relative(0.9)).mx_auto())
            .when(expanded, |this| this.w_full())
            .cursor_pointer()
            .on_click(move |_, _, cx| {
                view.update(cx, |_, cx| cx.emit(ShellEvent::CreateCommunity))
                    .ok();
            })
            .child(
                div()
                    .w_full()
                    .flex()
                    .items_center()
                    .rounded(px(8.))
                    .p(px(if expanded { 2. } else { 8. }))
                    .border_2()
                    .border_dashed()
                    .border_color(dashes)
                    .when(!expanded, |this| this.justify_center())
                    .child(
                        div()
                            .size(px(size))
                            .flex()
                            .items_center()
                            .justify_center()
                            .rounded_full()
                            .bg(disc)
                            .child(Icon::new(IconName::Add).color(plus)),
                    )
                    .when(expanded, |this| {
                        this.child(
                            div()
                                .ml(spacing(1.))
                                .text_color(primary)
                                .child(text(Variant::Body2, "New community").truncate()),
                        )
                    }),
            )
            .into_any_element()
    }

    /// `RailUserMenu`'s trigger: an avatar with the online dot.
    fn account_button(
        &self,
        me: &UserView,
        expanded: bool,
        cx: &mut Context<Self>,
    ) -> impl IntoElement + use<> {
        let sem = cx.sem();
        let name = me
            .display_name
            .clone()
            .unwrap_or_else(|| me.username.clone());
        let view = cx.entity().downgrade();
        let (paper, primary) = (sem.paper, sem.text_primary);
        let hover = sem.action_hover;
        base::Button::new("rail-account")
            .accessibility_label(format!("Account menu for {name}"))
            .flex()
            .items_center()
            .when(expanded, |this| this.p(px(4.)))
            .when(!expanded, |this| this.justify_center())
            .rounded(px(8.))
            .cursor_pointer()
            .hover(move |style| style.bg(hover))
            .focus_visible(move |style| style.bg(hover))
            .on_click(move |_, _, cx| {
                view.update(cx, |_, cx| cx.emit(ShellEvent::OpenAccountMenu))
                    .ok();
            })
            .child(
                div()
                    .relative()
                    .child(user_avatar(
                        &name,
                        me.avatar_file_id.as_deref(),
                        if expanded { 32. } else { 40. },
                    ))
                    .child(status_dot(paper)),
            )
            .when(expanded, |this| {
                this.child(
                    div()
                        .ml(spacing(1.))
                        .flex_1()
                        .min_w_0()
                        .text_color(primary)
                        .child(text(Variant::ListItem, name.clone()).truncate()),
                )
            })
    }

    /// The web asks `useCanPerformAction`; core has no permission read yet, so anyone already in a
    /// community sees it, and an empty account sees the empty state, as the web's fixtures do.
    fn can_create_community(&self) -> bool {
        match self.source.communities() {
            Load::Ready(rows) => !rows.is_empty(),
            _ => false,
        }
    }
}

/// `UserStatusIndicator`: the online green, ringed in the surface colour.
pub(super) fn status_dot(surface: Hsla) -> impl IntoElement {
    div()
        .absolute()
        .bottom(px(-2.))
        .right(px(-2.))
        .size(px(12.))
        .rounded_full()
        .border_2()
        .border_color(surface)
        .bg(rgb(0x43b581))
}
