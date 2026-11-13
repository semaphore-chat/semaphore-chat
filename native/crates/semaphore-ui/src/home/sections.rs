//! `HomeScreen` and `ZeroCommunityGate` drawn: `HomeSections.tsx`, `NewUserNextStep.tsx` and
//! `HomePage`'s layout.

use super::{
    HomeEvent, HomeMention, HomeScreen, HomeSection, HomeVoiceChannel, Section, ZeroCommunityGate,
};
use crate::dms::face::{group_face, user_face};
use crate::dms::names::{dm_preview, dm_title, user_name};
use crate::kit::{Button, ButtonSize, Paper, Skeleton, Variant, spacing, text};
use crate::panel::common::{design_icon, error_block, is_phone};
use crate::theme::{FONT_FAMILY, SemTheme, color::hsla_of};
use gpui_kit::base;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::DmRow;
use semaphore_design::Icon as DesignIcon;

/// `HOME_TWO_COLUMN_PX`: from this width Mentions and Unread messages sit side by side.
const TWO_COLUMN: f32 = 900.;
/// `PAGE_LIST_MAX_WIDTH` and `PAGE_WIDE_MAX_WIDTH`.
const LIST_MAX: f32 = 720.;
const WIDE_MAX: f32 = 1200.;
/// `MAX_VOICE_AVATARS`.
const MAX_VOICE_FACES: usize = 4;

/// `HomeSection`: a bold caption with an optional action, over an outlined card.
fn section(
    id: &'static str,
    title: &'static str,
    action: Option<AnyElement>,
    body: AnyElement,
    cx: &App,
) -> impl IntoElement + use<> {
    let sem = cx.sem();
    div()
        .id(id)
        .test_support()
        .role(Role::Region)
        .aria_label(title)
        .flex_1()
        .min_w_0()
        .flex()
        .flex_col()
        .child(
            div()
                .flex()
                .items_center()
                .gap(spacing(2.))
                .mb(spacing(1.))
                .min_h(px(30.))
                .child(
                    text(Variant::Subtitle2, title)
                        .flex_1()
                        .font_weight(FontWeight(700.))
                        .text_color(sem.text_secondary),
                )
                .children(action),
        )
        .child(
            Paper::new()
                .radius(8.)
                .overflow_hidden()
                .w_full()
                .child(body),
        )
}

/// `SectionSkeleton`: two rows of a round face and a line.
fn skeleton(id: &'static str, label: &'static str) -> AnyElement {
    div()
        .id(id)
        .test_support()
        .role(Role::ProgressIndicator)
        .aria_label(label)
        .p(spacing(2.))
        .flex()
        .flex_col()
        .gap(spacing(2.))
        .children((0..2usize).map(move |index| {
            div()
                .flex()
                .items_center()
                .gap(spacing(2.))
                .child(Skeleton::circle((id, index * 2), 32.))
                .child(Skeleton::rect((id, index * 2 + 1), relative(0.6), 14.))
        }))
        .into_any_element()
}

/// `CountChip`: a small bold pill.
fn count_chip(label: String, error: bool, cx: &App) -> impl IntoElement + use<> {
    let sem = cx.sem();
    let (bg, fg) = if error {
        (sem.error, hsla_of(sem.palette.common_white))
    } else {
        (sem.primary, sem.primary_contrast)
    };
    div()
        .flex_shrink_0()
        .h(px(24.))
        .min_w(px(24.))
        .px(px(8.))
        .flex()
        .items_center()
        .justify_center()
        .rounded(px(12.))
        .bg(bg)
        .text_color(fg)
        .child(text(Variant::Caption, label).font_weight(FontWeight(700.)))
}

/// A `ListItemButton` with an avatar, two lines and something at the end.
fn row(
    id: ElementId,
    label: String,
    face: AnyElement,
    primary: String,
    secondary: String,
    end: AnyElement,
    cx: &App,
) -> base::Button {
    let sem = cx.sem();
    let hover = sem.list_hover;
    base::Button::new(id)
        .accessibility_label(label)
        .w_full()
        .min_h(px(56.))
        .px(spacing(2.))
        .py(spacing(1.))
        .flex()
        .items_center()
        .gap(spacing(2.))
        .cursor_pointer()
        .hover(move |style| style.bg(hover))
        .focus_visible(move |style| style.bg(hover))
        .child(face)
        .child(
            div()
                .flex_1()
                .min_w_0()
                .flex()
                .flex_col()
                .child(
                    text(Variant::Body1, primary)
                        .font_weight(FontWeight(600.))
                        .text_color(sem.text_primary)
                        .truncate(),
                )
                .child(
                    text(Variant::Body2, secondary)
                        .text_color(sem.text_secondary)
                        .truncate(),
                ),
        )
        .child(end)
}

fn icon_face(icon: DesignIcon, bg: Hsla, fg: Hsla) -> AnyElement {
    div()
        .size(px(32.))
        .flex_shrink_0()
        .flex()
        .items_center()
        .justify_center()
        .rounded_full()
        .bg(bg)
        .child(design_icon(icon, 20., fg))
        .into_any_element()
}

fn mention_count_label(count: u32) -> String {
    format!(
        "{count} unread {}",
        if count == 1 { "mention" } else { "mentions" }
    )
}

/// The next step's card: `NewUserNextStep`.
pub(crate) fn next_step<V: EventEmitter<HomeEvent>>(
    can_create: bool,
    full_width: bool,
    cx: &mut Context<V>,
) -> impl IntoElement + use<V> {
    let sem = cx.sem().clone();
    let (hint, button) = if can_create {
        (
            "Communities hold your channels and voice rooms. Create one and invite people to it.",
            Button::new("home-create-community", "Create a community")
                .contained()
                .start_icon(DesignIcon::Add)
                .on_click(cx.listener(|_, _, _, cx| cx.emit(HomeEvent::CreateCommunity))),
        )
    } else {
        (
            "Ask an admin of this server to add you to a community. You can still send direct messages in the meantime.",
            Button::new("home-message-someone", "Message someone")
                .outlined()
                .start_icon(DesignIcon::Chat)
                .on_click(cx.listener(|_, _, _, cx| cx.emit(HomeEvent::OpenDms))),
        )
    };
    div()
        .id("new-user-next-step")
        .test_support()
        .role(Role::Region)
        .aria_label("Next step")
        .w_full()
        .when(!full_width, |card| card.max_w(px(520.)).mx_auto())
        .child(
            Paper::new()
                .radius(8.)
                .w_full()
                .p(spacing(4.))
                .flex()
                .flex_col()
                .items_center()
                .child(design_icon(DesignIcon::Groups, 48., sem.primary).mb(spacing(1.)))
                .child(
                    text(Variant::H6, "You're not in any communities yet")
                        .font_weight(FontWeight(700.))
                        .text_center(),
                )
                .child(
                    text(Variant::Body2, hint)
                        .mt(spacing(1.))
                        .mb(spacing(3.))
                        .text_color(sem.text_secondary)
                        .text_center(),
                )
                .child(button),
        )
}

impl HomeScreen {
    fn mentions_section(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        let body = match &self.data.mentions {
            Section::Loading => skeleton("home-mentions-loading", "Loading mentions"),
            Section::Failed(_) => error_block(
                "home-mentions-retry",
                "Couldn't load what's new",
                "Check your connection and try again.",
                cx.listener(|_, _, _, cx| cx.emit(HomeEvent::Retry(HomeSection::Mentions))),
                cx,
            ),
            Section::Ready(mentions) if mentions.is_empty() => return None,
            Section::Ready(mentions) => div()
                .flex()
                .flex_col()
                .children(mentions.iter().map(|mention| self.mention_row(mention, cx)))
                .into_any_element(),
        };
        let action = matches!(self.data.mentions, Section::Ready(_)).then(|| {
            Button::new("home-open-notifications", "Notifications")
                .size(ButtonSize::Small)
                .on_click(cx.listener(|_, _, _, cx| cx.emit(HomeEvent::OpenNotifications)))
                .into_any_element()
        });
        Some(section("home-mentions", "Mentions", action, body, cx).into_any_element())
    }

    fn mention_row(&self, mention: &HomeMention, cx: &mut Context<Self>) -> AnyElement {
        let sem = cx.sem().clone();
        let (community_id, channel_id) = (mention.community_id.clone(), mention.channel_id.clone());
        row(
            ElementId::Name(format!("home-mention-{}", mention.channel_id).into()),
            format!(
                "# {} in {}, {}",
                mention.channel_name,
                mention.community_name,
                mention_count_label(mention.mention_count)
            ),
            icon_face(
                DesignIcon::AlternateEmail,
                sem.action_selected,
                sem.text_primary,
            ),
            format!("# {}", mention.channel_name),
            mention.community_name.clone(),
            count_chip(format!("@{}", mention.mention_count), true, cx).into_any_element(),
            cx,
        )
        .on_click(cx.listener(move |_, _, _, cx| {
            cx.emit(HomeEvent::OpenChannel {
                community_id: community_id.clone(),
                channel_id: channel_id.clone(),
            })
        }))
        .into_any_element()
    }

    fn dms_section(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        let body = match &self.data.unread_dms {
            Section::Loading => skeleton("home-dms-loading", "Loading messages"),
            Section::Failed(_) => error_block(
                "home-dms-retry",
                "Couldn't load conversations",
                "Check your connection and try again.",
                cx.listener(|_, _, _, cx| cx.emit(HomeEvent::Retry(HomeSection::UnreadDms))),
                cx,
            ),
            Section::Ready(rows) if rows.is_empty() => return None,
            Section::Ready(rows) => div()
                .flex()
                .flex_col()
                .children(rows.iter().map(|dm| self.dm_row(dm, cx)))
                .into_any_element(),
        };
        let action = matches!(self.data.unread_dms, Section::Ready(_)).then(|| {
            Button::new("home-open-dms", "All messages")
                .size(ButtonSize::Small)
                .on_click(cx.listener(|_, _, _, cx| cx.emit(HomeEvent::OpenDms)))
                .into_any_element()
        });
        Some(section("home-unread-dms", "Unread messages", action, body, cx).into_any_element())
    }

    fn dm_row(&self, dm: &DmRow, cx: &mut Context<Self>) -> AnyElement {
        let title = dm_title(dm);
        let preview = dm
            .last_message
            .as_ref()
            .map(|_| dm_preview(dm))
            .filter(|preview| !preview.trim().is_empty())
            .unwrap_or_else(|| "New message".to_owned());
        let face = match (dm.is_group, dm.members.first()) {
            (false, Some(other)) => user_face(other, 32., None, cx).into_any_element(),
            _ => group_face(32., cx).into_any_element(),
        };
        let group_id = dm.id.clone();
        row(
            ElementId::Name(format!("home-dm-{}", dm.id).into()),
            format!("{title}, {} unread", dm.unread),
            face,
            title,
            preview,
            count_chip(dm.unread.to_string(), false, cx).into_any_element(),
            cx,
        )
        .on_click(cx.listener(move |_, _, _, cx| {
            cx.emit(HomeEvent::OpenDm {
                group_id: group_id.clone(),
            })
        }))
        .into_any_element()
    }

    fn voice_section(&self, touch: bool, cx: &mut Context<Self>) -> Option<AnyElement> {
        let body = match &self.data.voice {
            Section::Loading => return None,
            Section::Failed(_) => error_block(
                "home-voice-retry",
                "Couldn't load who's in voice",
                "Check your connection and try again.",
                cx.listener(|_, _, _, cx| cx.emit(HomeEvent::Retry(HomeSection::Voice))),
                cx,
            ),
            Section::Ready(channels) if channels.is_empty() => return None,
            Section::Ready(channels) => div()
                .flex()
                .flex_col()
                .children(
                    channels
                        .iter()
                        .map(|channel| self.voice_row(channel, touch, cx)),
                )
                .into_any_element(),
        };
        Some(section("home-voice", "In voice now", None, body, cx).into_any_element())
    }

    fn voice_row(
        &self,
        channel: &HomeVoiceChannel,
        touch: bool,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let sem = cx.sem().clone();
        let names = channel
            .users
            .iter()
            .map(user_name)
            .collect::<Vec<_>>()
            .join(", ");
        let extra = channel.users.len().saturating_sub(MAX_VOICE_FACES);
        let surface = sem.paper;
        let faces = div()
            .flex_shrink_0()
            .flex()
            .items_center()
            .when(touch, |faces| faces.invisible().w(px(0.)))
            .children(channel.users.iter().take(MAX_VOICE_FACES).enumerate().map(
                |(index, user)| {
                    div()
                        .when(index > 0, |face| face.ml(px(-8.)))
                        .rounded_full()
                        .border_2()
                        .border_color(surface)
                        .child(user_face(user, 28., None, cx))
                },
            ))
            .when(extra > 0, |faces| {
                faces.child(
                    text(Variant::Caption, format!("+{extra}"))
                        .ml(spacing(1.))
                        .text_color(sem.text_secondary),
                )
            });
        let (community_id, channel_id) = (channel.community_id.clone(), channel.channel_id.clone());
        row(
            ElementId::Name(format!("home-voice-{}", channel.channel_id).into()),
            format!(
                "{} in {}, {} in voice",
                channel.channel_name,
                channel.community_name,
                channel.users.len()
            ),
            icon_face(
                DesignIcon::VolumeUp,
                sem.success,
                hsla_of(sem.palette.common_white),
            ),
            channel.channel_name.clone(),
            format!("{} · {names}", channel.community_name),
            faces.into_any_element(),
            cx,
        )
        .on_click(cx.listener(move |_, _, _, cx| {
            cx.emit(HomeEvent::OpenChannel {
                community_id: community_id.clone(),
                channel_id: channel_id.clone(),
            })
        }))
        .into_any_element()
    }

    fn caught_up(cx: &App) -> AnyElement {
        let sem = cx.sem();
        div()
            .id("home-caught-up")
            .test_support()
            .w_full()
            .child(
                Paper::new()
                    .radius(8.)
                    .w_full()
                    .p(spacing(4.))
                    .flex()
                    .flex_col()
                    .items_center()
                    .child(
                        design_icon(DesignIcon::CheckCircleOutline, 48., sem.success)
                            .mb(spacing(1.)),
                    )
                    .child(
                        text(Variant::H6, "You're all caught up")
                            .font_weight(FontWeight(700.))
                            .text_center(),
                    )
                    .child(
                        text(
                            Variant::Body2,
                            "No unread mentions or messages, and nobody is in voice right now.",
                        )
                        .text_color(sem.text_secondary)
                        .text_center(),
                    ),
            )
            .into_any_element()
    }
}

impl Render for HomeScreen {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let sem = cx.sem().clone();
        let width = f32::from(window.viewport_size().width);
        let touch = is_phone(window);
        let (pair, rest, narrow): (Vec<AnyElement>, Vec<AnyElement>, bool) =
            match &self.data.communities {
                Section::Loading => (
                    vec![
                        section(
                            "home-mentions",
                            "Mentions",
                            None,
                            skeleton("home-mentions-loading", "Loading mentions"),
                            cx,
                        )
                        .into_any_element(),
                        section(
                            "home-unread-dms",
                            "Unread messages",
                            None,
                            skeleton("home-dms-loading", "Loading messages"),
                            cx,
                        )
                        .into_any_element(),
                    ],
                    Vec::new(),
                    false,
                ),
                Section::Failed(_) => (
                    Vec::new(),
                    vec![
                        Paper::new()
                            .radius(8.)
                            .w_full()
                            .child(error_block(
                                "home-communities-retry",
                                "Couldn't load your communities",
                                "Check your connection and try again.",
                                cx.listener(|_, _, _, cx| {
                                    cx.emit(HomeEvent::Retry(HomeSection::Communities))
                                }),
                                cx,
                            ))
                            .into_any_element(),
                    ],
                    true,
                ),
                Section::Ready(ids) if ids.is_empty() => {
                    let mut rest =
                        vec![next_step(self.can_create_community, true, cx).into_any_element()];
                    rest.extend(self.dms_section(cx));
                    (Vec::new(), rest, true)
                }
                Section::Ready(_) => {
                    let mentions = self.mentions_section(cx);
                    let dms = self.dms_section(cx);
                    let voice = self.voice_section(touch, cx);
                    let still_loading = matches!(self.data.mentions, Section::Loading)
                        || matches!(self.data.unread_dms, Section::Loading);
                    let nothing_new = mentions.is_none() && dms.is_none() && voice.is_none();
                    let mut rest: Vec<AnyElement> = voice.into_iter().collect();
                    if nothing_new && !still_loading {
                        rest.push(Self::caught_up(cx));
                    }
                    let pair: Vec<AnyElement> = mentions.into_iter().chain(dms).collect();
                    (pair, rest, nothing_new && !still_loading)
                }
            };
        let two = !narrow && width >= TWO_COLUMN && pair.len() == 2;
        let max = if narrow || !two { LIST_MAX } else { WIDE_MAX };
        let pair = if two {
            div()
                .w_full()
                .flex()
                .gap(spacing(3.))
                .items_start()
                .children(pair)
                .into_any_element()
        } else {
            div()
                .w_full()
                .flex()
                .flex_col()
                .gap(spacing(3.))
                .children(pair)
                .into_any_element()
        };
        div()
            .id("home")
            .test_support()
            .role(Role::Region)
            .aria_label("Home")
            .size_full()
            .font_family(FONT_FAMILY)
            .text_color(sem.text_primary)
            .bg(sem.background_default)
            .overflow_y_scroll()
            .child(
                div()
                    .w_full()
                    .max_w(px(max))
                    .mx_auto()
                    .p(spacing(if touch { 2. } else { 3. }))
                    .flex()
                    .flex_col()
                    .gap(spacing(3.))
                    .child(text(Variant::H5, "Home").font_weight(FontWeight(700.)))
                    .children(self.invite_card(cx))
                    .child(pair)
                    .children(rest),
            )
    }
}

impl Render for ZeroCommunityGate {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let sem = cx.sem().clone();
        div()
            .id("zero-community-gate")
            .size_full()
            .font_family(FONT_FAMILY)
            .text_color(sem.text_primary)
            .bg(sem.background_default)
            .overflow_y_scroll()
            .flex()
            .items_center()
            .p(spacing(2.))
            .child(next_step(self.can_create_community, false, cx))
    }
}
