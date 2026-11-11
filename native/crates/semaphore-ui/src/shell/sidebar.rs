//! The channel sidebar: `CommunityPage`'s header, `ChannelList` and `ChannelRow`.

use super::{Load, Shell, ShellEvent, community_avatar, error_state, user_avatar};
use crate::kit::{Badge, Icon, IconButton, Skeleton, Variant, spacing, text};
use crate::nav::Route;
use crate::theme::{SemTheme, color::hsla_of};
use gpui_kit::base;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{
    ChannelKind, ChannelRow, CommunityRow, ParticipantView, UserView, VoiceView,
};
use semaphore_design::Icon as IconName;

impl Shell {
    /// `None` outside a community.
    pub(super) fn sidebar(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        let community_id = self.nav.current().community_id()?.to_owned();
        let sem = cx.sem().clone();
        let community = self.community();
        let body = self.channel_list(&community_id, false, cx);
        Some(
            div()
                .id("channel-sidebar")
                .size_full()
                .flex()
                .flex_col()
                .pt(spacing(2.))
                .overflow_y_scroll()
                .bg(sem.paper)
                .border_1()
                .border_color(sem.paper_border)
                .children(community.map(|community| self.community_header(&community, cx)))
                .child(body)
                .into_any_element(),
        )
    }

    fn community_header(
        &self,
        community: &CommunityRow,
        cx: &mut Context<Self>,
    ) -> impl IntoElement + use<> {
        let sem = cx.sem();
        let (id, view) = (community.id.clone(), cx.entity().downgrade());
        div()
            .flex()
            .flex_shrink_0()
            .items_center()
            .justify_between()
            .gap(spacing(1.5))
            .px(spacing(2.))
            .pb(spacing(2.))
            .border_b_1()
            .border_color(sem.divider)
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(spacing(1.5))
                    .flex_1()
                    .min_w_0()
                    .child(community_avatar(
                        &community.id,
                        &community.name,
                        community.avatar_file_id.as_deref(),
                        40.,
                    ))
                    .child(
                        div().flex_1().min_w_0().child(
                            text(Variant::H6, community.name.clone())
                                .font_weight(FontWeight(700.))
                                .truncate(),
                        ),
                    ),
            )
            .child(
                IconButton::new(
                    "community-settings",
                    IconName::Settings,
                    "Community settings",
                )
                .small()
                .color(sem.text_secondary)
                .on_click(move |_, _, cx| {
                    let community_id = id.clone();
                    view.update(cx, |_, cx| {
                        cx.emit(ShellEvent::OpenCommunitySettings { community_id });
                    })
                    .ok();
                }),
            )
    }

    /// The list itself, used by the sidebar and by the phone's channel screen.
    pub(super) fn channel_list(
        &self,
        community_id: &str,
        touch: bool,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let sem = cx.sem().clone();
        let channels = match self.source.channels(community_id) {
            Load::Loading => {
                return div()
                    .id("channels-loading")
                    .test_support()
                    .role(Role::ProgressIndicator)
                    .aria_label("Loading channels")
                    .px(spacing(2.))
                    .py(spacing(1.))
                    .flex()
                    .flex_col()
                    .child(div().mb(spacing(1.)).child(Skeleton::rect(
                        "channels-loading-title",
                        relative(0.4),
                        16.,
                    )))
                    .children((0..3usize).map(|index| {
                        div().mb(px(4.)).child(Skeleton::rect(
                            ("channels-loading-row", index),
                            relative(1.),
                            32.,
                        ))
                    }))
                    .into_any_element();
            }
            Load::Failed(_) => {
                return error_state(
                    "channels-retry",
                    "Couldn't load channels",
                    "Check your connection and try again.",
                    true,
                    cx,
                )
                .into_any_element();
            }
            Load::Ready(channels) => channels,
        };
        if channels.is_empty() {
            return div()
                .px(spacing(2.))
                .py(spacing(3.))
                .flex()
                .justify_center()
                .text_color(sem.text_secondary)
                .child(text(Variant::Body2, "No channels yet"))
                .into_any_element();
        }

        let mut text_channels: Vec<ChannelRow> = channels
            .iter()
            .filter(|channel| channel.kind != ChannelKind::Voice)
            .cloned()
            .collect();
        let mut voice_channels: Vec<ChannelRow> = channels
            .into_iter()
            .filter(|channel| channel.kind == ChannelKind::Voice)
            .collect();
        text_channels.sort_by_key(|channel| channel.position);
        voice_channels.sort_by_key(|channel| channel.position);
        let selected = self.nav.current().channel_id().map(str::to_owned);
        let voice = self.source.voice();

        div()
            .id("channel-list")
            .test_support()
            .role(Role::Navigation)
            .aria_label("Channels")
            .w_full()
            .flex_shrink_0()
            .flex()
            .flex_col()
            .when(!text_channels.is_empty(), |list| {
                let header = if touch {
                    self.touch_category_header("Text Channels", false, cx)
                        .into_any_element()
                } else {
                    category_header(IconName::Tag, "Text Channels", false, cx).into_any_element()
                };
                list.child(header).children(
                    text_channels
                        .iter()
                        .filter(|_| !(touch && self.collapsed.contains("Text Channels")))
                        .map(|channel| {
                            self.channel_row(
                                channel,
                                selected.as_deref() == Some(channel.id.as_str()),
                                touch,
                                &voice,
                                cx,
                            )
                        }),
                )
            })
            .when(!voice_channels.is_empty(), |list| {
                // A CSS margin collapses with the last row's above it. Flex margins don't.
                let after_rows = !text_channels.is_empty();
                let header = if touch {
                    self.touch_category_header("Voice Channels", after_rows, cx)
                        .into_any_element()
                } else {
                    category_header(IconName::VolumeUp, "Voice Channels", after_rows, cx)
                        .into_any_element()
                };
                list.child(header).children(
                    voice_channels
                        .iter()
                        .filter(|_| !(touch && self.collapsed.contains("Voice Channels")))
                        .map(|channel| {
                            self.channel_row(
                                channel,
                                selected.as_deref() == Some(channel.id.as_str()),
                                touch,
                                &voice,
                                cx,
                            )
                        }),
                )
            })
            .into_any_element()
    }

    /// `ChannelCategoryList`'s header: no icon, and a chevron that folds the category.
    fn touch_category_header(
        &self,
        label: &'static str,
        after_rows: bool,
        cx: &mut Context<Self>,
    ) -> impl IntoElement + use<> {
        let sem = cx.sem();
        let collapsed = self.collapsed.contains(label);
        let view = cx.entity().downgrade();
        let (secondary, active) = (sem.text_secondary, sem.action_active);
        base::Button::new(ElementId::Name(format!("category-{label}").into()))
            .accessibility_label(if collapsed {
                format!("Expand {label}")
            } else {
                format!("Collapse {label}")
            })
            .w_full()
            .flex()
            .flex_shrink_0()
            .items_center()
            .justify_between()
            .px(spacing(2.))
            .pt(px(if after_rows { 10. } else { 23. }))
            .pb(px(12.))
            .cursor_pointer()
            .text_color(secondary)
            .on_click(move |_, _, cx| {
                view.update(cx, |shell, cx| {
                    if !shell.collapsed.remove(label) {
                        shell.collapsed.insert(label);
                    }
                    cx.notify();
                })
                .ok();
            })
            .child(
                text(Variant::Caption, label.to_uppercase())
                    .font_weight(FontWeight(700.))
                    .line_height(px(20.)),
            )
            .child(
                Icon::new(if collapsed {
                    IconName::KeyboardArrowDown
                } else {
                    IconName::KeyboardArrowUp
                })
                .size(20.)
                .color(active),
            )
    }

    fn channel_row(
        &self,
        channel: &ChannelRow,
        selected: bool,
        touch: bool,
        voice: &VoiceView,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let sem = cx.sem();
        let is_text = channel.kind == ChannelKind::Text;
        let is_voice = channel.kind == ChannelKind::Voice;
        let unread = is_text && !selected && channel.unread_count > 0;
        let mentions = if is_text && !selected {
            channel.mention_count
        } else {
            0
        };
        let dark = sem.is_dark;
        let (selected_bg, selected_hover) = (
            sem.primary.opacity(if dark { 0.2 } else { 0.12 }),
            sem.primary.opacity(if dark { 0.25 } else { 0.15 }),
        );
        let hover_bg = if dark {
            hsla(0., 0., 1., 0.08)
        } else {
            hsla(0., 0., 0., 0.04)
        };
        let color = if selected {
            sem.primary
        } else if unread {
            sem.text_primary
        } else {
            sem.text_secondary
        };
        let hover_color = if selected {
            sem.primary
        } else {
            sem.text_primary
        };
        let pill = sem.text_primary.opacity(0.8);
        let lock_color = sem.text_secondary;
        let weight = if unread {
            700.
        } else if selected {
            600.
        } else {
            500.
        };
        let leading = if is_text {
            IconName::Tag
        } else {
            IconName::VolumeUp
        };
        let icon_size = if touch { 20. } else { 18. };

        let view = cx.entity().downgrade();
        let channel_id = channel.id.clone();
        let community_id = channel.community_id.clone();
        let row = base::Button::new(ElementId::Name(format!("channel-{}", channel.id).into()))
            .selected(selected)
            .accessibility_label(channel_accessible_name(channel, unread, mentions))
            .relative()
            .mx(spacing(1.))
            .mb(spacing(0.25))
            .pl(spacing(2.))
            .pr(spacing(1.5))
            .py(spacing(if touch { 1. } else { 0.75 }))
            .when(touch, |row| row.min_h(px(44.)))
            .flex()
            .flex_shrink_0()
            .items_center()
            .justify_start()
            .rounded(spacing(1.))
            .cursor_pointer()
            .text_color(color)
            .when(selected, |row| {
                row.bg(selected_bg)
                    .hover(move |style| style.bg(selected_hover))
                    .focus_visible(move |style| style.bg(selected_hover))
            })
            .when(!selected, |row| {
                row.hover(move |style| style.bg(hover_bg).text_color(hover_color))
                    .focus_visible(move |style| style.bg(hover_bg).text_color(hover_color))
            })
            .on_click(move |_, _, cx| {
                let (channel_id, community_id) = (channel_id.clone(), community_id.clone());
                view.update(cx, |shell, cx| {
                    if is_voice {
                        cx.emit(ShellEvent::JoinVoice {
                            channel_id: channel_id.clone(),
                        });
                    }
                    if is_voice || is_text {
                        shell.navigate(
                            Route::Channel {
                                community_id,
                                channel_id,
                            },
                            cx,
                        );
                    }
                })
                .ok();
            })
            // The state pill sits outside the row, flush with the sidebar's edge.
            .when(unread || selected, |row| {
                row.child(
                    div()
                        .absolute()
                        .left(spacing(-1.))
                        .top(px(if selected { 11. } else { 17. }))
                        .w(px(4.))
                        .h(px(if selected { 20. } else { 8. }))
                        .rounded_r(px(4.))
                        .bg(pill),
                )
            })
            .child(
                div()
                    .w(px(if touch { 32. } else { 28. }))
                    .flex_shrink_0()
                    .child(Icon::new(leading).size(icon_size).color(color)),
            )
            .child(
                div().min_w_0().my(spacing(0.5)).child(
                    text(Variant::Body2, channel.name.clone())
                        .text_size(px(if touch { 15. } else { 14. }))
                        .line_height(px(if touch { 23. } else { 21. }))
                        .font_weight(FontWeight(weight))
                        .truncate(),
                ),
            )
            .when(channel.is_private, |row| {
                row.child(
                    div()
                        .ml(spacing(0.5))
                        .flex_shrink_0()
                        .child(Icon::new(IconName::Lock).size(14.).color(lock_color)),
                )
            })
            .when(mentions > 0, |row| {
                row.child(
                    div()
                        .ml_auto()
                        .pl(spacing(1.))
                        .flex_shrink_0()
                        .child(Badge::new(mentions).compact()),
                )
            });

        let users = if is_voice {
            voice_users(channel, voice, cx)
        } else {
            Vec::new()
        };
        div()
            .flex()
            .flex_col()
            .flex_shrink_0()
            .child(row)
            .children(users)
            .into_any_element()
    }
}

fn channel_accessible_name(channel: &ChannelRow, unread: bool, mentions: u32) -> String {
    let mut name = channel.name.clone();
    if channel.is_private {
        name.push_str(", private");
    }
    if mentions > 0 {
        name.push_str(&format!(", {mentions} mentions"));
    } else if unread {
        name.push_str(", unread");
    }
    name
}

fn category_header(
    icon: IconName,
    label: &'static str,
    after_rows: bool,
    cx: &mut Context<Shell>,
) -> impl IntoElement {
    let sem = cx.sem();
    let icon_color = if sem.is_dark {
        hsla_of(sem.palette.primary_light).opacity(0.7)
    } else {
        sem.primary
    };
    div()
        .flex()
        .flex_shrink_0()
        .items_center()
        .gap(spacing(1.))
        .px(spacing(2.))
        .py(spacing(1.))
        .mt(spacing(if after_rows { 0.75 } else { 1. }))
        .mb(spacing(0.5))
        .child(Icon::new(icon).size(16.).color(icon_color))
        .child(
            text(Variant::Caption, label.to_uppercase())
                .font_weight(FontWeight(700.))
                .text_color(sem.text_secondary),
        )
}

/// `CompactUserItem`: who is in a voice channel, with mute marks when we're connected to it.
fn voice_users(
    channel: &ChannelRow,
    voice: &VoiceView,
    cx: &mut Context<Shell>,
) -> Vec<AnyElement> {
    let connected_here = voice.channel_id.as_deref() == Some(channel.id.as_str());
    if connected_here {
        voice
            .participants
            .iter()
            .map(|participant| {
                voice_user_row(&channel.id, &participant.user, Some(participant), cx)
                    .into_any_element()
            })
            .collect()
    } else {
        channel
            .voice_users
            .iter()
            .map(|user| voice_user_row(&channel.id, user, None, cx).into_any_element())
            .collect()
    }
}

fn voice_user_row(
    channel_id: &str,
    user: &UserView,
    participant: Option<&ParticipantView>,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    let sem = cx.sem();
    let name = user
        .display_name
        .clone()
        .unwrap_or_else(|| user.username.clone());
    let (muted, deafened) = participant.map_or((false, false), |p| (p.muted, p.deafened));
    let hover = sem.action_hover;
    let (negative, primary, secondary) = (sem.negative, sem.text_primary, sem.text_secondary);
    let id = ElementId::Name(format!("voice-user-{channel_id}-{}", user.id).into());
    let mut label = name.clone();
    if deafened {
        label.push_str(", deafened");
    } else if muted {
        label.push_str(", muted");
    }
    base::Button::new(id)
        .accessibility_label(label)
        .relative()
        .pl(spacing(4.))
        .pr(spacing(1.))
        .h(px(44.))
        .flex()
        .flex_shrink_0()
        .items_center()
        .justify_start()
        .cursor_pointer()
        .hover(move |style| style.bg(hover))
        .child(
            div().w(px(40.)).flex_shrink_0().child(
                div()
                    .relative()
                    .size(px(32.))
                    .child(user_avatar(&name, user.avatar_file_id.as_deref(), 32.))
                    .when(deafened || muted, |face| {
                        // The mark on the avatar, as well as the one at the row's end.
                        face.child(
                            div()
                                .absolute()
                                .right(px(-4.))
                                .bottom(px(-4.))
                                .size(px(16.))
                                .flex()
                                .items_center()
                                .justify_center()
                                .rounded_full()
                                .bg(negative)
                                .child(
                                    Icon::new(if deafened {
                                        IconName::VolumeOff
                                    } else {
                                        IconName::MicOff
                                    })
                                    .size(10.)
                                    .color(hsla(0., 0., 1., 1.)),
                                ),
                        )
                    }),
            ),
        )
        .child(
            div()
                .flex_1()
                .min_w_0()
                .text_color(if muted { secondary } else { primary })
                .child(
                    text(Variant::Body2, name.clone())
                        .font_weight(FontWeight(500.))
                        .truncate(),
                ),
        )
        .when(deafened || muted, |row| {
            row.child(
                Icon::new(if deafened {
                    IconName::VolumeOff
                } else {
                    IconName::MicOff
                })
                .size(16.)
                .color(negative),
            )
        })
}
