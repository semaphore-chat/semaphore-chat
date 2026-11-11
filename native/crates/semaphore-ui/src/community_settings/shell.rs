//! The shell: the section nav beside the open tab, as the web's `FormPageShell` on a desktop; on a
//! phone a list of the sections to tap into, with a back button. A section these caps don't open
//! shows disabled with why, as the web's disabled tabs (but saying why).

use super::common::{empty_line, page};
use super::rules::CommunityTab;
use super::{CommunitySettingsScreen, CommunityShellEvent};
use crate::kit::{ListRow, Spinner, Variant, spacing, text};
use crate::panel::common::{design_icon, error_block, icon_button, is_phone};
use crate::theme::SemTheme;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::LoadState;
use semaphore_design::Icon as DesignIcon;

fn tab_icon(tab: CommunityTab) -> DesignIcon {
    match tab {
        CommunityTab::Overview => DesignIcon::Settings,
        CommunityTab::Members => DesignIcon::People,
        CommunityTab::Channels => DesignIcon::Tag,
        CommunityTab::PrivateChannels => DesignIcon::LockOutlined,
        CommunityTab::Roles => DesignIcon::AdminPanelSettingsOutlined,
        CommunityTab::MentionGroups => DesignIcon::AlternateEmail,
        CommunityTab::Emoji => DesignIcon::EmojiEmotionsOutlined,
        CommunityTab::Moderation => DesignIcon::ShieldOutlined,
        CommunityTab::Soundboard => DesignIcon::LibraryMusic,
        CommunityTab::Invites => DesignIcon::Link,
    }
}

impl CommunitySettingsScreen {
    fn pick(&mut self, tab: CommunityTab, cx: &mut Context<Self>) {
        self.tab = tab;
        self.tab_chosen = true;
        self.phone_open = true;
        cx.emit(CommunityShellEvent::TabChanged(tab));
        cx.notify();
    }

    fn locked(&self, tab: CommunityTab) -> Option<String> {
        match self.permissions.state {
            LoadState::Ready => tab.locked(&self.permissions.caps),
            _ => None,
        }
    }

    fn content(&self, window: &Window, cx: &mut Context<Self>) -> AnyElement {
        match &self.permissions.state {
            LoadState::Loading => {
                return div()
                    .id("community-settings-loading")
                    .test_support()
                    .role(Role::ProgressIndicator)
                    .aria_label("Loading permissions")
                    .size_full()
                    .flex()
                    .items_center()
                    .justify_center()
                    .child(Spinner::new("community-settings-spinner"))
                    .into_any_element();
            }
            LoadState::Failed { .. } => {
                return div()
                    .size_full()
                    .flex()
                    .items_center()
                    .justify_center()
                    .child(error_block(
                        "community-settings-retry",
                        "Failed to load community",
                        "Please try again.",
                        cx.listener(|_, _, _, cx| cx.emit(CommunityShellEvent::RetryPermissions)),
                        cx,
                    ))
                    .into_any_element();
            }
            LoadState::Ready => {}
        }
        if let Some(reason) = self.locked(self.tab) {
            return page(
                "community-tab-locked",
                self.tab.label(),
                None,
                Vec::new(),
                crate::kit::Alert::new(crate::kit::Severity::Warning, reason),
                window,
                cx,
            );
        }
        match self.tab {
            CommunityTab::Overview => self.overview.clone().into_any_element(),
            CommunityTab::Members => self.members.clone().into_any_element(),
            CommunityTab::Channels => self.channels.clone().into_any_element(),
            CommunityTab::PrivateChannels => self.private_channels.clone().into_any_element(),
            CommunityTab::MentionGroups => self.mention_groups.clone().into_any_element(),
            CommunityTab::Emoji => self.emoji.clone().into_any_element(),
            CommunityTab::Soundboard => self.soundboard.clone().into_any_element(),
            CommunityTab::Invites => self.invites.clone().into_any_element(),
            CommunityTab::Roles => self.slot(self.roles.clone(), window, cx),
            CommunityTab::Moderation => self.slot(self.moderation.clone(), window, cx),
        }
    }

    fn slot(&self, view: Option<AnyView>, window: &Window, cx: &App) -> AnyElement {
        match view {
            Some(view) => view.into_any_element(),
            None => page(
                "community-tab-slot",
                self.tab.label(),
                None,
                Vec::new(),
                empty_line("Not available yet.", cx),
                window,
                cx,
            ),
        }
    }

    fn nav(&self, phone: bool, cx: &mut Context<Self>) -> AnyElement {
        let sem = cx.sem().clone();
        let name = if self.community_name.is_empty() {
            "Community".to_owned()
        } else {
            self.community_name.clone()
        };
        let header = div()
            .flex()
            .items_center()
            .justify_between()
            .gap(spacing(1.))
            .px(spacing(2.))
            .min_h(px(if phone { 56. } else { 64. }))
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .flex()
                    .flex_col()
                    .child(
                        text(Variant::Caption, name)
                            .truncate()
                            .text_color(sem.text_secondary),
                    )
                    .child(text(Variant::H6, "Manage Community").text_color(sem.text_primary)),
            )
            .child(
                icon_button(
                    "community-settings-close",
                    DesignIcon::Close,
                    "Close community settings",
                    phone,
                    sem.action_active,
                    cx,
                )
                .on_click(cx.listener(|_, _, _, cx| cx.emit(CommunityShellEvent::Close))),
            );
        let rows: Vec<_> = CommunityTab::ALL
            .into_iter()
            .map(|tab| {
                let view = cx.weak_entity();
                let locked = self.locked(tab);
                let mut row = ListRow::new(
                    SharedString::from(format!("community-tab-{}", tab.key())),
                    tab.label(),
                )
                .leading(design_icon(
                    tab_icon(tab),
                    22.,
                    if locked.is_some() {
                        sem.text_disabled
                    } else {
                        sem.action_active
                    },
                ))
                .selected(!phone && tab == self.tab)
                .disabled(locked.is_some());
                if let Some(reason) = locked {
                    // "Needs “View members”": the nav is narrow.
                    let short = reason
                        .trim_start_matches("You need the ")
                        .trim_end_matches(" permission");
                    row = row.secondary(format!("Needs {short}"));
                } else {
                    row = row.on_click(move |_, cx| {
                        view.update(cx, |screen, cx| screen.pick(tab, cx)).ok();
                    });
                    if phone {
                        row = row.trailing(design_icon(
                            DesignIcon::ChevronRight,
                            22.,
                            sem.text_secondary,
                        ));
                    }
                }
                row
            })
            .collect();
        div()
            .id("community-settings-nav")
            .test_support()
            .role(Role::Navigation)
            .aria_label("Community management sections")
            .flex()
            .flex_col()
            .size_full()
            .child(header)
            .child(
                div()
                    .id("community-settings-nav-scroll")
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scroll()
                    .px(spacing(1.))
                    .pb(spacing(1.))
                    .flex()
                    .flex_col()
                    .children(rows),
            )
            .into_any_element()
    }
}

impl Render for CommunitySettingsScreen {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let sem = cx.sem().clone();
        let root = div()
            .id("community-settings")
            .test_support()
            .role(Role::Region)
            .aria_label("Community settings")
            .size_full()
            .flex()
            .bg(sem.background_default);
        if !is_phone(window) {
            return root
                .child(
                    div()
                        .w(px(260.))
                        .flex_shrink_0()
                        .h_full()
                        .bg(sem.paper)
                        .border_r_1()
                        .border_color(sem.divider)
                        .child(self.nav(false, cx)),
                )
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .h_full()
                        .flex()
                        .justify_center()
                        .child(
                            div()
                                .w_full()
                                .max_w(px(1100.))
                                .h_full()
                                .child(self.content(window, cx)),
                        ),
                );
        }
        if !self.phone_open {
            return root.child(div().size_full().bg(sem.paper).child(self.nav(true, cx)));
        }
        let bar = div()
            .flex_shrink_0()
            .flex()
            .items_center()
            .gap(spacing(1.))
            .px(spacing(1.))
            .min_h(px(56.))
            .border_b_1()
            .border_color(sem.divider)
            .bg(sem.paper)
            .child(
                icon_button(
                    "community-settings-back",
                    DesignIcon::ArrowBack,
                    "Back to community settings",
                    true,
                    sem.action_active,
                    cx,
                )
                .on_click(cx.listener(|screen, _, _, cx| {
                    screen.phone_open = false;
                    cx.notify();
                })),
            )
            .child(
                text(Variant::H6, self.tab.label())
                    .flex_1()
                    .min_w_0()
                    .truncate()
                    .text_color(sem.text_primary),
            );
        root.flex_col()
            .child(bar)
            .child(div().flex_1().min_h_0().child(self.content(window, cx)))
    }
}
