//! UV: a voice channel's pre-join: who's here, Join voice / Join muted, "you can listen",
//! "you don't have permission", "You're timed out until …", "You're in X; joining moves you
//! here", after `components/Voice/VoiceChannelPreJoin.tsx` and `VoiceChannelJoinButton.tsx`.
//!
//! Frozen by the UI freeze: the public API below (`new`, the setters and `PreJoinEvent`) is what the app
//! wiring lane builds against; change it only with the coordinator. `set_media` was added in UV with
//! the coordinator's approval, as `GifPicker::set_media`.
//!
//! The panel decides nothing: who's here, which join the channel allows, the timeout and the other
//! call all come from `VoicePreJoinView`. It only keeps "deafened" meaning "muted" when it carries
//! the view's deafen into a join, as the web's voice controls do.

use crate::dms::face::user_face;
use crate::dms::names::user_name;
use crate::kit::{Button, ButtonSize, Icon, Skeleton, Variant, spacing, text};
use crate::messages::{CacheKind, Media, MediaSource, MediaState, TimeFormat};
use crate::panel::common::is_phone;
use crate::theme::SemTheme;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{
    LoadState, UserView, VoiceJoinMode, VoiceJoinOptions, VoicePreJoinView,
};
use semaphore_design::Icon as IconName;
use std::rc::Rc;

#[cfg(test)]
mod tests;

#[cfg(any(test, feature = "stories"))]
mod fixtures;

#[cfg(feature = "stories")]
mod stories;

/// The web's `VoiceParticipantGrid` avatar.
const AVATAR: f32 = 64.;
/// A grid cell: the web's 96px minimum, plus its padding.
const TILE: f32 = 112.;
/// The web's `maxWidth: 720`.
const MAX_WIDTH: f32 = 720.;

#[derive(Debug, Clone, PartialEq)]
pub enum PreJoinEvent {
    /// `Core::join_voice_with(channel_id, options)`.
    Join(VoiceJoinOptions),
    /// The read failed and the user asked again: `Core::retry_failed`.
    Retry,
    /// WP (additive, with the coordinator): a person in the grid was clicked: their profile, as
    /// the web's `VoiceParticipantGrid` opens it.
    OpenProfile { user_id: String },
}

pub struct PreJoinPanel {
    view: VoicePreJoinView,
    time: TimeFormat,
    media: Option<Media>,
}

impl EventEmitter<PreJoinEvent> for PreJoinPanel {}

impl PreJoinPanel {
    pub fn new(_window: &mut Window, _cx: &mut Context<Self>) -> Self {
        Self {
            view: VoicePreJoinView::default(),
            time: TimeFormat::default(),
            media: None,
        }
    }

    /// `Core::voice_prejoin(community_id, channel_id)`.
    pub fn set_view(&mut self, view: VoicePreJoinView, cx: &mut Context<Self>) {
        self.view = view;
        cx.notify();
    }

    /// The zone "timed out until" is written in.
    pub fn set_time(&mut self, time: TimeFormat, cx: &mut Context<Self>) {
        self.time = time;
        cx.notify();
    }

    /// Where the people's avatars come from (`MediaSource::avatar`, keyed by `avatar_file_id`): the
    /// app's. Without one, avatars come from the app's `AvatarImages`, or are initials.
    pub fn set_media(&mut self, media: Rc<dyn MediaSource>, cx: &mut Context<Self>) {
        self.media = Some(Media::new(media, cx));
        cx.notify();
    }
}

/// The two joins a channel with SPEAK offers, and the one listen-only join: what each sends. The
/// view's deafen carries through, and a deafened join is a muted one.
pub(super) fn join_options(muted: bool, view: &VoicePreJoinView) -> VoiceJoinOptions {
    VoiceJoinOptions {
        muted: muted || view.deafened,
        deafened: view.deafened,
    }
}

/// The line under the channel name, as the web's `countLabel`; `None` while loading.
pub(super) fn count_label(view: &VoicePreJoinView) -> Option<String> {
    match &view.state {
        LoadState::Loading => None,
        LoadState::Failed { .. } => Some("Couldn't load who's here".into()),
        LoadState::Ready => Some(match view.users.len() {
            0 => "Nobody's here yet".into(),
            1 => "1 person here".into(),
            n => format!("{n} people here"),
        }),
    }
}

/// When a timeout ends, on the panel's display clock: the time today, else the day too.
pub(super) fn until_label(time: &TimeFormat, until_ms: i64) -> String {
    let clock = time.clock(until_ms);
    if time.day(until_ms) == time.day(time.now.now_ms()) {
        clock
    } else {
        format!("{} at {clock}", time.format_at(until_ms, "%a, %b %-d"))
    }
}

/// What a listen-only join says under its button.
pub(super) fn listen_only_note(view: &VoicePreJoinView, time: &TimeFormat) -> String {
    match view.timed_out_until_ms {
        Some(until) => format!(
            "You can listen, but you can't speak until {}",
            until_label(time, until)
        ),
        None => "You can listen but not speak here".into(),
    }
}

pub(super) const NO_PERMISSION: &str = "You don't have permission to join this voice channel.";

pub(super) fn elsewhere_note(channel: &str) -> String {
    format!("You're in \u{201c}{channel}\u{201d}. Joining moves you here.")
}

impl PreJoinPanel {
    fn emit_join(
        &self,
        muted: bool,
        cx: &mut Context<Self>,
    ) -> impl Fn(&ClickEvent, &mut Window, &mut App) + 'static {
        let options = join_options(muted, &self.view);
        cx.listener(move |_, _: &ClickEvent, _, cx| cx.emit(PreJoinEvent::Join(options)))
    }

    fn controls(&self, cx: &mut Context<Self>) -> AnyElement {
        let sem = cx.sem().clone();
        match self.view.mode {
            VoiceJoinMode::None => div()
                .id("voice-prejoin-blocked")
                .test_support()
                .flex()
                .items_center()
                .justify_center()
                .gap(spacing(1.))
                .text_color(sem.text_secondary)
                .child(
                    Icon::new(IconName::Block)
                        .size(20.)
                        .color(sem.text_secondary),
                )
                .child(text(Variant::Body2, NO_PERMISSION).min_w_0().text_center())
                .into_any_element(),
            VoiceJoinMode::ListenOnly => div()
                .flex()
                .flex_col()
                .items_center()
                .gap(spacing(1.))
                .child(
                    Button::new("voice-prejoin-listen", "Join to listen")
                        .contained()
                        .size(ButtonSize::Large)
                        .start_icon(IconName::Headphones)
                        .on_click(self.emit_join(true, cx)),
                )
                .child(
                    div().id("voice-prejoin-listen-note").test_support().child(
                        text(Variant::Body2, listen_only_note(&self.view, &self.time))
                            .text_center()
                            .text_color(sem.text_secondary),
                    ),
                )
                .into_any_element(),
            VoiceJoinMode::Full => div()
                .flex()
                .flex_wrap()
                .justify_center()
                .gap(spacing(1.5))
                .child(
                    Button::new("voice-prejoin-join", "Join voice")
                        .contained()
                        .size(ButtonSize::Large)
                        .start_icon(IconName::Mic)
                        .on_click(self.emit_join(false, cx)),
                )
                .child(
                    Button::new("voice-prejoin-join-muted", "Join muted")
                        .outlined()
                        .size(ButtonSize::Large)
                        .start_icon(IconName::MicOff)
                        .on_click(self.emit_join(true, cx)),
                )
                .into_any_element(),
        }
    }

    fn count(&self, cx: &mut Context<Self>) -> AnyElement {
        let sem = cx.sem().clone();
        let line = div()
            .id("voice-prejoin-count")
            .test_support()
            .min_h(px(24.))
            .flex()
            .flex_wrap()
            .items_center()
            .justify_center()
            .gap(spacing(1.));
        match count_label(&self.view) {
            None => line
                .child(Skeleton::rect("voice-prejoin-count-loading", px(140.), 20.))
                .into_any_element(),
            Some(label) => line
                .child(text(Variant::Body1, label).text_color(sem.text_secondary))
                .when(
                    matches!(self.view.state, LoadState::Failed { .. }),
                    |line| {
                        line.child(
                            Button::new("voice-prejoin-retry", "Try again")
                                .outlined()
                                .size(ButtonSize::Small)
                                .start_icon(IconName::Refresh)
                                .on_click(cx.listener(|_, _: &ClickEvent, _, cx| {
                                    cx.emit(PreJoinEvent::Retry)
                                })),
                        )
                    },
                )
                .into_any_element(),
        }
    }

    fn face(&self, user: &UserView, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let picture = self
            .media
            .as_ref()
            .zip(user.avatar_file_id.as_deref())
            .and_then(|(media, file_id)| {
                match media.resolve(media.source.avatar(file_id), CacheKind::Small, window, cx) {
                    MediaState::Ready(image) => Some(image),
                    MediaState::Loading | MediaState::Failed => None,
                }
            });
        match picture {
            // As `Avatar` draws a file: the parent's clip is a rectangle, so the image rounds itself.
            Some(image) => img(ImageSource::Render(image))
                .size(px(AVATAR))
                .flex_shrink_0()
                .rounded_full()
                .object_fit(ObjectFit::Cover)
                .into_any_element(),
            None => user_face(user, AVATAR, None, cx).into_any_element(),
        }
    }

    fn grid(&self, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let sem = cx.sem().clone();
        let tiles: Vec<AnyElement> = self
            .view
            .users
            .iter()
            .enumerate()
            .map(|(ix, user)| {
                let name = user_name(user);
                let user_id = user.id.clone();
                let hover = sem.action_hover;
                div()
                    .id(SharedString::from(format!("voice-prejoin-user-{ix}")))
                    .test_support()
                    .role(Role::Button)
                    .aria_label(name.clone())
                    .cursor_pointer()
                    .hover(move |style| style.bg(hover))
                    .on_click(cx.listener(move |_, _: &ClickEvent, _, cx| {
                        cx.emit(PreJoinEvent::OpenProfile {
                            user_id: user_id.clone(),
                        })
                    }))
                    .w(px(TILE))
                    .min_w_0()
                    .flex()
                    .flex_col()
                    .items_center()
                    .gap(spacing(0.75))
                    .p(spacing(1.))
                    .rounded(px(8.))
                    .child(self.face(user, window, cx))
                    .child(
                        text(Variant::Body2, name)
                            .w_full()
                            .text_center()
                            .truncate()
                            .text_color(sem.text_primary),
                    )
                    .into_any_element()
            })
            .collect();
        div()
            .id("voice-prejoin-people")
            .test_support()
            .aria_label("People in this voice channel")
            .w_full()
            .mt(spacing(2.))
            .flex()
            .flex_wrap()
            .justify_center()
            .gap(spacing(1.))
            .children(tiles)
            .into_any_element()
    }
}

impl Render for PreJoinPanel {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let sem = cx.sem().clone();
        let phone = is_phone(window);
        let joinable = self.view.mode != VoiceJoinMode::None;
        let header = div()
            .flex()
            .items_center()
            .justify_center()
            .gap(spacing(1.5))
            .min_w_0()
            .max_w_full()
            .child(
                Icon::new(IconName::VolumeUp)
                    .size(if phone { 32. } else { 40. })
                    .color(sem.primary),
            )
            .child(
                div()
                    .id("voice-prejoin-name")
                    .test_support()
                    .min_w_0()
                    .child(
                        text(Variant::H5, self.view.channel_name.clone())
                            .truncate()
                            .text_color(sem.text_primary),
                    ),
            );
        let deafened = (joinable && self.view.deafened).then(|| {
            div()
                .id("voice-prejoin-deafened-note")
                .test_support()
                .flex()
                .items_center()
                .gap(spacing(0.75))
                .text_color(sem.text_secondary)
                .child(
                    Icon::new(IconName::HeadsetOff)
                        .size(18.)
                        .color(sem.text_secondary),
                )
                .child(text(Variant::Body2, "You'll join deafened"))
        });
        let elsewhere = self.view.connected_elsewhere.as_ref().map(|channel| {
            div()
                .id("voice-prejoin-elsewhere")
                .test_support()
                .max_w_full()
                .child(
                    text(Variant::Body2, elsewhere_note(channel))
                        .text_center()
                        .text_color(sem.warning),
                )
        });
        let people = (!self.view.users.is_empty()).then(|| self.grid(window, cx));
        let count = self.count(cx);
        let controls = self.controls(cx);
        div()
            .id("voice-prejoin")
            .test_support()
            .role(Role::Region)
            .aria_label(format!("{} voice channel", self.view.channel_name))
            .size_full()
            .overflow_y_scroll()
            .bg(sem.background_default)
            .child(
                div()
                    .min_h_full()
                    .w_full()
                    .flex()
                    .flex_col()
                    .items_center()
                    .justify_center()
                    .px(spacing(if phone { 2. } else { 3. }))
                    .py(spacing(if phone { 3. } else { 6. }))
                    .child(
                        div()
                            .w_full()
                            .max_w(px(MAX_WIDTH))
                            .flex()
                            .flex_col()
                            .items_center()
                            .gap(spacing(2.5))
                            .child(header)
                            .child(count)
                            .child(controls)
                            .children(deafened)
                            .children(elsewhere)
                            .children(people),
                    ),
            )
    }
}

#[cfg(feature = "stories")]
pub fn stories() -> Vec<crate::stories::Story> {
    stories::stories()
}
