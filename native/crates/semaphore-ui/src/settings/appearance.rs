//! The appearance tab, after the appearance card in `pages/SettingsPage.tsx`: dark or light (no
//! "follow the system"), the 12 accents, the 3 intensities and a live preview. Core shows a pick
//! at once, so each one goes out as it's made.

use super::shell::{caption, section, segmented, switch_row, tab_page};
use super::{AppearanceEvent, AppearanceSettings};
use crate::kit::{Skeleton, Switch, Variant, spacing, text};
use crate::panel::common::{design_icon, error_block};
use crate::theme::{Sem, SemTheme, ThemeChoice};
use gpui_kit::base;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{
    AccentColor, Appearance, AppearancePatch, LoadState, ThemeIntensity, ThemeMode,
};
use semaphore_design::{Accent, Icon as DesignIcon, Intensity, Mode};

pub const ACCENTS: [AccentColor; 12] = [
    AccentColor::Teal,
    AccentColor::Blue,
    AccentColor::Indigo,
    AccentColor::Purple,
    AccentColor::Rose,
    AccentColor::Red,
    AccentColor::Orange,
    AccentColor::Amber,
    AccentColor::Lime,
    AccentColor::Emerald,
    AccentColor::Cyan,
    AccentColor::Slate,
];

/// The theme the server's appearance settings stand for.
pub fn theme_choice(appearance: Appearance) -> ThemeChoice {
    let mode = match appearance.mode {
        ThemeMode::Dark => Mode::Dark,
        ThemeMode::Light => Mode::Light,
    };
    let accent = match appearance.accent {
        AccentColor::Teal => Accent::Teal,
        AccentColor::Blue => Accent::Blue,
        AccentColor::Indigo => Accent::Indigo,
        AccentColor::Purple => Accent::Purple,
        AccentColor::Rose => Accent::Rose,
        AccentColor::Red => Accent::Red,
        AccentColor::Orange => Accent::Orange,
        AccentColor::Amber => Accent::Amber,
        AccentColor::Lime => Accent::Lime,
        AccentColor::Emerald => Accent::Emerald,
        AccentColor::Cyan => Accent::Cyan,
        AccentColor::Slate => Accent::Slate,
    };
    let intensity = match appearance.intensity {
        ThemeIntensity::Minimal => Intensity::Minimal,
        ThemeIntensity::Balanced => Intensity::Balanced,
        ThemeIntensity::Vibrant => Intensity::Vibrant,
    };
    ThemeChoice::new(mode, accent, intensity)
}

/// `accentColors[].name` in `theme/constants.ts`.
pub fn accent_name(accent: AccentColor) -> &'static str {
    match accent {
        AccentColor::Teal => "Ocean Teal",
        AccentColor::Blue => "Sky Blue",
        AccentColor::Indigo => "Deep Indigo",
        AccentColor::Purple => "Soft Purple",
        AccentColor::Rose => "Rose Pink",
        AccentColor::Red => "Crimson Red",
        AccentColor::Orange => "Coral Orange",
        AccentColor::Amber => "Golden Amber",
        AccentColor::Lime => "Lime Green",
        AccentColor::Emerald => "Emerald Green",
        AccentColor::Cyan => "Electric Cyan",
        AccentColor::Slate => "Slate Gray",
    }
}

fn accent_key(accent: AccentColor) -> &'static str {
    match accent {
        AccentColor::Teal => "teal",
        AccentColor::Blue => "blue",
        AccentColor::Indigo => "indigo",
        AccentColor::Purple => "purple",
        AccentColor::Rose => "rose",
        AccentColor::Red => "red",
        AccentColor::Orange => "orange",
        AccentColor::Amber => "amber",
        AccentColor::Lime => "lime",
        AccentColor::Emerald => "emerald",
        AccentColor::Cyan => "cyan",
        AccentColor::Slate => "slate",
    }
}

fn intensity_hint(intensity: ThemeIntensity) -> &'static str {
    match intensity {
        ThemeIntensity::Minimal => "Clean, neutral look with minimal accent color",
        ThemeIntensity::Balanced => "Soft gradients and accent color highlights",
        ThemeIntensity::Vibrant => "Bold, eye-catching accent colors throughout",
    }
}

impl AppearanceSettings {
    fn update(&mut self, patch: AppearancePatch, cx: &mut Context<Self>) {
        cx.emit(AppearanceEvent::Update(patch));
    }
}

impl Render for AppearanceSettings {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let body: AnyElement =
            match &self.view.state {
                LoadState::Loading => div()
                    .id("appearance-loading")
                    .test_support()
                    .role(Role::ProgressIndicator)
                    .aria_label("Loading appearance settings")
                    .flex()
                    .flex_col()
                    .gap(spacing(2.))
                    .children((0..4usize).map(|index| {
                        Skeleton::rect(("appearance-skeleton", index), relative(1.), 48.)
                    }))
                    .into_any_element(),
                LoadState::Failed { .. } => error_block(
                    "appearance-retry",
                    "Couldn't load your appearance settings",
                    "Check your connection and try again.",
                    cx.listener(|_, _, _, cx| cx.emit(AppearanceEvent::Retry)),
                    cx,
                ),
                LoadState::Ready => self.form(cx).into_any_element(),
            };
        tab_page(
            "appearance-settings",
            DesignIcon::Palette,
            "Appearance",
            Vec::new(),
            body,
            cx,
        )
    }
}

impl AppearanceSettings {
    fn form(&self, cx: &mut Context<Self>) -> Div {
        let sem = cx.sem().clone();
        let appearance = self.view.appearance;
        let view = cx.weak_entity();
        let dark = appearance.mode == ThemeMode::Dark;
        let mode_view = view.clone();
        let mode = section("Theme Mode", cx).child(switch_row(
            Switch::new("appearance-dark", "Dark Mode", dark).on_change(move |on, _, cx| {
                let mode = if on {
                    ThemeMode::Dark
                } else {
                    ThemeMode::Light
                };
                mode_view
                    .update(cx, |this, cx| {
                        this.update(
                            AppearancePatch {
                                mode: Some(mode),
                                ..AppearancePatch::default()
                            },
                            cx,
                        )
                    })
                    .ok();
            }),
            if dark { "Dark Mode" } else { "Light Mode" },
            None,
            cx,
        ));
        let swatches = ACCENTS.iter().map(|&accent| {
            let view = view.clone();
            let colors = Sem::new(theme_choice(Appearance {
                accent,
                ..appearance
            }))
            .accent;
            let primary = crate::theme::color::hsla_of(colors.primary);
            let selected = appearance.accent == accent;
            let ring = sem.text_primary;
            base::Button::new(SharedString::from(format!(
                "appearance-accent-{}",
                accent_key(accent)
            )))
            .accessibility_label(accent_name(accent))
            .selected(selected)
            .size(px(48.))
            .flex()
            .items_center()
            .justify_center()
            .rounded(px(8.))
            .cursor_pointer()
            .bg(primary)
            .border_3()
            .border_color(if selected { ring } else { transparent_black() })
            .when(selected, |swatch| {
                swatch.child(design_icon(DesignIcon::CheckCircle, 28., white()))
            })
            .on_click(move |_, _, cx| {
                view.update(cx, |this, cx| {
                    this.update(
                        AppearancePatch {
                            accent: Some(accent),
                            ..AppearancePatch::default()
                        },
                        cx,
                    )
                })
                .ok();
            })
        });
        let accent = section("Accent Color", cx)
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .gap(spacing(1.5))
                    .children(swatches),
            )
            .child(caption(accent_name(appearance.accent), cx));
        let intensity_view = view.clone();
        let intensity = section("Theme Intensity", cx)
            .child(segmented(
                "appearance-intensity",
                &[
                    (ThemeIntensity::Minimal, "Minimal"),
                    (ThemeIntensity::Balanced, "Balanced"),
                    (ThemeIntensity::Vibrant, "Vibrant"),
                ],
                appearance.intensity,
                move |intensity, _, cx| {
                    intensity_view
                        .update(cx, |this, cx| {
                            this.update(
                                AppearancePatch {
                                    intensity: Some(intensity),
                                    ..AppearancePatch::default()
                                },
                                cx,
                            )
                        })
                        .ok();
                },
            ))
            .child(caption(intensity_hint(appearance.intensity), cx));
        div()
            .flex()
            .flex_col()
            .gap(spacing(3.))
            .child(mode)
            .child(accent)
            .child(intensity)
            .child(section("Preview", cx).child(preview(appearance)))
    }
}

/// A small mock of the app, painted from the chosen theme's own `Sem` rather than the window's.
fn preview(appearance: Appearance) -> AnyElement {
    let tile = Sem::new(theme_choice(appearance));
    let line =
        |width: f32, color: Hsla| div().h(px(8.)).w(relative(width)).rounded(px(4.)).bg(color);
    let message = |name: &'static str, width: f32| {
        div()
            .flex()
            .gap(px(8.))
            .child(
                div()
                    .size(px(28.))
                    .flex_shrink_0()
                    .rounded_full()
                    .bg(tile.primary),
            )
            .child(
                div()
                    .flex_1()
                    .flex()
                    .flex_col()
                    .gap(px(4.))
                    .child(text(Variant::Caption, name).text_color(tile.text_primary))
                    .child(line(width, tile.text_secondary.opacity(0.5))),
            )
    };
    div()
        .id("appearance-preview")
        .test_support()
        .role(Role::Image)
        .aria_label("Preview of the chosen theme")
        .w_full()
        .max_w(px(520.))
        .h(px(200.))
        .flex()
        .flex_col()
        .rounded(px(8.))
        .overflow_hidden()
        .border_1()
        .border_color(tile.paper_border)
        .bg(tile.body.background())
        .child(
            div()
                .h(px(32.))
                .flex_shrink_0()
                .flex()
                .items_center()
                .px(px(12.))
                .bg(tile.app_bar.background())
                .text_color(tile.app_bar_text)
                .child(text(Variant::Body2, "# general").font_weight(FontWeight(500.))),
        )
        .child(
            div()
                .flex_1()
                .min_h_0()
                .flex()
                .child(
                    div()
                        .w(px(96.))
                        .flex_shrink_0()
                        .flex()
                        .flex_col()
                        .gap(px(6.))
                        .p(px(10.))
                        .bg(tile.drawer.background())
                        .child(line(0.8, tile.text_secondary.opacity(0.6)))
                        .child(div().h(px(18.)).rounded(px(4.)).bg(tile.list_selected))
                        .child(line(0.6, tile.text_secondary.opacity(0.6)))
                        .child(line(0.7, tile.text_secondary.opacity(0.6))),
                )
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .flex()
                        .flex_col()
                        .gap(px(10.))
                        .p(px(12.))
                        .bg(tile.paper)
                        .child(message("Ava", 0.7))
                        .child(message("Ben", 0.5))
                        .child(
                            div()
                                .flex()
                                .gap(px(8.))
                                .items_center()
                                .child(
                                    div()
                                        .h(px(24.))
                                        .px(px(10.))
                                        .flex()
                                        .items_center()
                                        .rounded(px(4.))
                                        .bg(tile.contained.background())
                                        .text_color(tile.primary_contrast)
                                        .child(text(Variant::Caption, "Button")),
                                )
                                .child(
                                    div()
                                        .h(px(20.))
                                        .px(px(8.))
                                        .flex()
                                        .items_center()
                                        .rounded(px(10.))
                                        .bg(tile.chip_bg)
                                        .text_color(tile.chip_text)
                                        .child(text(Variant::Caption, "Chip")),
                                ),
                        ),
                ),
        )
        .into_any_element()
}
