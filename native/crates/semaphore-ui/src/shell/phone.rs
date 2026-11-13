//! Under 600px: one pane at a time, as `MobileLayout` does, with its app bar and bottom navigation.
//! The rail opens over the list.

use super::{Load, Shell, ShellEvent, community_avatar};
use crate::kit::{Badge, Icon, IconButton, Variant, spacing, text};
use crate::nav::Route;
use crate::theme::SemTheme;
use gpui_kit::base;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::ChannelKind;
use semaphore_design::Icon as IconName;

impl Shell {
    pub(super) fn render_phone(&mut self, window: &mut Window, cx: &mut Context<Self>) -> Div {
        let sem = cx.sem().clone();
        let community = self.community();
        let channel = self.channel();
        let in_content = self.phone_content && channel.is_some();
        let view = cx.entity().downgrade();

        let in_dms = matches!(
            self.nav.current(),
            Route::DirectMessages | Route::DirectMessage { .. }
        );
        // A voice channel's title is its name after the voice icon, as the web's pre-join; a text
        // channel keeps its hash.
        let voice = in_content
            && channel
                .as_ref()
                .is_some_and(|c| c.kind == ChannelKind::Voice);
        let bar_title = if in_content {
            channel.as_ref().map_or_else(String::new, |channel| {
                super::header_title(channel.kind, &channel.name)
            })
        } else if in_dms {
            "Direct Messages".to_owned()
        } else {
            community
                .as_ref()
                .map(|c| c.name.clone())
                .unwrap_or_else(|| "Semaphore Chat".to_owned())
        };

        let leading = if in_content {
            IconButton::new("phone-back", IconName::ArrowBack, "Back").on_click({
                let view = view.clone();
                move |_, _, cx| {
                    view.update(cx, |shell, cx| {
                        shell.phone_content = false;
                        cx.notify();
                    })
                    .ok();
                }
            })
        } else {
            IconButton::new("phone-rail", IconName::Menu, "Open communities").on_click({
                let view = view.clone();
                move |_, _, cx| {
                    view.update(cx, |shell, cx| {
                        shell.phone_rail_open = !shell.phone_rail_open;
                        cx.notify();
                    })
                    .ok();
                }
            })
        };

        let app_bar = div()
            .id("phone-app-bar")
            .test_support()
            .role(Role::Banner)
            .h(px(58.))
            .w_full()
            .flex()
            .flex_shrink_0()
            .items_center()
            .gap(spacing(1.))
            .px(spacing(0.5))
            .bg(sem.app_bar.background())
            .text_color(sem.app_bar_text)
            .border_b_1()
            .border_color(sem.divider)
            .child(leading)
            .when_some(
                community.clone().filter(|_| !in_content),
                |bar, community| {
                    bar.child(community_avatar(
                        &community.id,
                        &community.name,
                        community.avatar_file_id.as_deref(),
                        32.,
                    ))
                },
            )
            .child(
                div()
                    .flex()
                    .flex_1()
                    .items_center()
                    .gap(spacing(0.5))
                    .min_w_0()
                    .when(voice, |title| {
                        title.child(
                            Icon::new(IconName::VolumeUp)
                                .size(20.)
                                .color(sem.text_secondary),
                        )
                    })
                    .child(
                        text(Variant::H6, bar_title)
                            .text_size(px(18.))
                            .font_weight(FontWeight(600.))
                            .truncate(),
                    ),
            )
            .when_some(
                self.header_accessory.clone().filter(|_| in_content),
                |bar, accessory| bar.child(accessory),
            )
            .when(in_content, |bar| {
                let view = view.clone();
                bar.child(
                    IconButton::new("members-toggle", IconName::People, "Members").on_click(
                        move |_, _, cx| {
                            view.update(cx, |shell, cx| {
                                shell.members_open = !shell.members_open;
                                cx.notify();
                            })
                            .ok();
                        },
                    ),
                )
            })
            .child(IconButton::new("phone-more", IconName::MoreVert, "More"));

        let pane: AnyElement = if in_content {
            self.content_element(window, cx)
        } else if let Some(community) = community.as_ref() {
            div()
                .id("phone-channels")
                .size_full()
                .overflow_y_scroll()
                .child(self.channel_list(&community.id, true, cx))
                .into_any_element()
        } else if let Some(sidebar) = self.route_sidebar(true, window, cx) {
            div()
                .id("phone-route-sidebar")
                .test_support()
                .size_full()
                .overflow_hidden()
                .child(sidebar)
                .into_any_element()
        } else {
            self.content_element(window, cx)
        };

        let counts = self.source.rail_counts();
        let is_dm = matches!(
            self.nav.current(),
            Route::DirectMessages | Route::DirectMessage { .. }
        );
        let nav_bar = div()
            .id("phone-bottom-nav")
            .test_support()
            .role(Role::Navigation)
            .aria_label("Main")
            .h(px(58.))
            .flex()
            .flex_shrink_0()
            .border_t_1()
            .border_color(sem.divider)
            .bg(sem.paper)
            .child(
                self.phone_nav_item("phone-nav-home", IconName::Home, "Home", 0, !is_dm, cx, {
                    let view = view.clone();
                    move |cx| {
                        view.update(cx, |shell, cx| {
                            let route = match shell.source.communities() {
                                Load::Ready(rows) if !rows.is_empty() => Route::Community {
                                    community_id: rows[0].id.clone(),
                                },
                                _ => Route::Home,
                            };
                            shell.navigate(route, cx);
                            shell.phone_content = false;
                        })
                        .ok();
                    }
                }),
            )
            .child(self.phone_nav_item(
                "phone-nav-messages",
                IconName::Message,
                "Messages",
                counts.dm_unread,
                is_dm,
                cx,
                {
                    let view = view.clone();
                    move |cx| {
                        view.update(cx, |shell, cx| shell.navigate(Route::DirectMessages, cx))
                            .ok();
                    }
                },
            ))
            .child(self.phone_nav_item(
                "phone-nav-notifications",
                IconName::Notifications,
                "Notifications",
                counts.notifications_unread,
                false,
                cx,
                {
                    let view = view.clone();
                    move |cx| {
                        view.update(cx, |_, cx| cx.emit(ShellEvent::OpenNotifications))
                            .ok();
                    }
                },
            ))
            .child(self.phone_nav_item(
                "phone-nav-profile",
                IconName::Person,
                "Profile",
                0,
                false,
                cx,
                {
                    let view = view.clone();
                    move |cx| {
                        view.update(cx, |_, cx| cx.emit(ShellEvent::OpenAccountMenu))
                            .ok();
                    }
                },
            ));

        let rail_open = self.phone_rail_open;
        let members_open = self.members_open && in_content;
        let scrim = hsla(0., 0., 0., 0.5);
        let rail = rail_open.then(|| self.rail(cx));
        let members = (members_open && self.side_panel.is_none()).then(|| self.members_drawer(cx));
        let side_panel = self.side_panel_drawer(true, cx);

        self.body_ground(cx)
            .flex()
            .flex_col()
            .child(app_bar)
            // The banner sits in the pane, so it clears the bottom navigation.
            .child(
                div()
                    .relative()
                    .flex_1()
                    .min_h_0()
                    .child(pane)
                    .children(self.connection_banner(cx)),
            )
            .child(nav_bar)
            .when_some(rail, |shell, rail| {
                let close = view.clone();
                shell
                    .child(
                        div()
                            .id("phone-rail-scrim")
                            .test_support()
                            .absolute()
                            .inset_0()
                            .occlude()
                            .bg(scrim)
                            .on_click(move |_, _, cx| {
                                close
                                    .update(cx, |shell, cx| {
                                        shell.phone_rail_open = false;
                                        cx.notify();
                                    })
                                    .ok();
                            }),
                    )
                    .child(
                        div()
                            .absolute()
                            .top_0()
                            .bottom_0()
                            .left_0()
                            .occlude()
                            .child(rail),
                    )
            })
            .children(members)
            .children(side_panel)
    }

    #[allow(clippy::too_many_arguments)]
    fn phone_nav_item(
        &self,
        id: &'static str,
        icon: IconName,
        label: &'static str,
        badge: u32,
        selected: bool,
        cx: &mut Context<Self>,
        on_click: impl Fn(&mut App) + 'static,
    ) -> AnyElement {
        let sem = cx.sem();
        let color = if selected {
            sem.primary
        } else {
            sem.text_secondary
        };
        base::Button::new(id)
            .accessibility_label(if badge > 0 {
                format!("{label}, {badge} unread")
            } else {
                label.to_owned()
            })
            .selected(selected)
            .flex_1()
            .flex()
            .flex_col()
            .items_center()
            .justify_center()
            .cursor_pointer()
            .text_color(color)
            .on_click(move |_, _, cx| on_click(cx))
            .child(Badge::new(badge).on(Icon::new(icon).color(color)))
            .child(text(Variant::Xs, label).font_weight(FontWeight(500.)))
            .into_any_element()
    }
}
