//! The soundboard: the web's `SoundboardButton.tsx`. A button on the call's bar (channel calls only)
//! opens a popover above it with the community's sounds; a press plays one to everyone in the call.
//!
//! The bar draws both from `VoiceStageModel::soundboard` and `soundboard_open`; the clicks go to
//! `VoiceController::{toggle_soundboard, play_sound, retry_soundboard}`.

use crate::kit::{Alert, Button, Severity, Spinner, Variant, text};
use crate::theme::SemTheme;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{LoadState, SoundboardSound, SoundboardView};
use std::rc::Rc;

pub const POPOVER_WIDTH: f32 = 320.;
const COLUMNS: usize = 3;
/// What a sound with no emoji shows, as on the web.
pub const DEFAULT_EMOJI: &str = "\u{1f50a}";

type Handler<T> = Rc<dyn Fn(T, &mut Window, &mut App)>;
type Action = Rc<dyn Fn(&mut Window, &mut App)>;

pub struct SoundboardActions {
    /// `Core::play_sound(sound_id)`.
    pub on_play: Handler<String>,
    /// The list failed: `Core::retry_failed`.
    pub on_retry: Action,
    /// A press outside or Escape.
    pub on_close: Action,
}

fn sound_tile(
    sound: &SoundboardSound,
    starting: bool,
    on_play: Handler<String>,
    cx: &App,
) -> impl IntoElement + use<> {
    let sem = cx.sem();
    let border = sem.outlined_border;
    let hover_border = sem.outlined_hover_border;
    let hover_bg = sem.outlined_hover_bg;
    let id = sound.id.clone();
    let label = if starting {
        format!("{} (playing)", sound.name)
    } else {
        format!("Play {}", sound.name)
    };
    div()
        .id(SharedString::from(format!("sound-{}", sound.id)))
        .test_support()
        .role(Role::Button)
        .aria_label(label)
        .min_w_0()
        .h(px(64.))
        .px(px(4.))
        .rounded(px(4.))
        .border_1()
        .border_color(if starting { sem.primary } else { border })
        .when(starting, |tile| tile.bg(hover_bg))
        .flex()
        .flex_col()
        .items_center()
        .justify_center()
        .gap(px(2.))
        .cursor_pointer()
        .hover(move |style| style.border_color(hover_border).bg(hover_bg))
        .on_click(move |_, window, cx| on_play(id.clone(), window, cx))
        .child(if starting {
            div()
                .h(px(30.))
                .flex()
                .items_center()
                .child(
                    Spinner::new(SharedString::from(format!("sound-busy-{}", sound.id))).size(22.),
                )
                .into_any_element()
        } else {
            div()
                .h(px(30.))
                .text_size(px(24.))
                .line_height(px(30.))
                .child(
                    sound
                        .emoji
                        .clone()
                        .filter(|emoji| !emoji.is_empty())
                        .unwrap_or_else(|| DEFAULT_EMOJI.to_owned()),
                )
                .into_any_element()
        })
        .child(
            text(
                Variant::Caption,
                if starting {
                    "Playing".to_owned()
                } else {
                    sound.name.clone()
                },
            )
            .w_full()
            .text_center()
            .text_color(sem.outlined_text)
            .truncate(),
        )
}

/// The popover's panel. The bar anchors it above its button.
pub fn soundboard_popover(
    view: &SoundboardView,
    actions: SoundboardActions,
    cx: &App,
) -> impl IntoElement + use<> {
    let sem = cx.sem();
    let close = actions.on_close.clone();
    let body = match &view.state {
        LoadState::Loading => div()
            .flex()
            .justify_center()
            .py(px(16.))
            .child(Spinner::new("soundboard-loading").size(24.))
            .into_any_element(),
        LoadState::Failed { error } => {
            let retry = actions.on_retry.clone();
            div()
                .flex()
                .flex_col()
                .gap(px(8.))
                .child(Alert::new(
                    Severity::Error,
                    format!("Couldn't load the sounds: {}", error.message),
                ))
                .child(
                    div().flex().justify_end().child(
                        Button::new("soundboard-retry", "Retry")
                            .on_click(move |_, window, cx| retry(window, cx)),
                    ),
                )
                .into_any_element()
        }
        LoadState::Ready if view.sounds.is_empty() => text(
            Variant::Body2,
            "No sounds yet. An admin can add some in community settings.",
        )
        .text_color(sem.text_secondary)
        .into_any_element(),
        LoadState::Ready => {
            let mut grid = div().flex().flex_col().gap(px(8.));
            for row in view.sounds.chunks(COLUMNS) {
                let mut line = div().flex().gap(px(8.));
                for sound in row {
                    let starting = view.playing.as_deref() == Some(sound.id.as_str());
                    line = line.child(div().flex_1().min_w_0().child(sound_tile(
                        sound,
                        starting,
                        actions.on_play.clone(),
                        cx,
                    )));
                }
                // Keep the last row's tiles the width of the others.
                for _ in row.len()..COLUMNS {
                    line = line.child(div().flex_1());
                }
                grid = grid.child(line);
            }
            div()
                .id("soundboard-grid")
                .max_h(px(280.))
                .overflow_y_scroll()
                .child(grid)
                .into_any_element()
        }
    };
    div()
        .id("soundboard")
        .test_support()
        .role(Role::Dialog)
        .aria_label("Soundboard")
        .w(px(POPOVER_WIDTH))
        .max_w(px(POPOVER_WIDTH))
        .p(px(16.))
        .flex()
        .flex_col()
        .gap(px(8.))
        .rounded(px(4.))
        .bg(sem.paper)
        .text_color(sem.text_primary)
        .border_1()
        .border_color(sem.paper_border)
        .shadow_lg()
        .occlude()
        .on_mouse_down_out(move |_, window, cx| close(window, cx))
        .child(text(Variant::Subtitle2, "Soundboard").text_color(sem.text_primary))
        .children(
            view.error
                .as_ref()
                .filter(|_| matches!(view.state, LoadState::Ready))
                .map(|error| {
                    Alert::new(
                        Severity::Error,
                        format!("Couldn't play that sound: {}", error.message),
                    )
                }),
        )
        .child(body)
}

/// The soundboard as the bar shows it. `view` is `Some` in a channel call (the button shows) and
/// `open` while its popover is up.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SoundboardBar {
    pub view: Option<SoundboardView>,
    pub open: bool,
}
