//! The appearance tab: a mode (light, dark or the system's), a base colour the theme is derived
//! from, an intensity, and a live preview. Laid out as the web's appearance card
//! (`pages/SettingsPage.tsx`) until the settings screens are converted (epic #848, B16); the colour
//! row is the base colour's, as the design system has it. Core shows a pick at once, so each one
//! goes out as it's made.

use super::shell::{caption, section, segmented, tab_page};
use super::{AppearanceEvent, AppearanceSettings};
use crate::kit::{Skeleton, Variant, spacing, text};
use crate::panel::common::{design_icon, error_block};
use crate::theme::{Sem, SemTheme, ThemeInput, system_mode};
use gpui_kit::base;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{
    AccentColor, Appearance, AppearancePatch, DEFAULT_BASE, LoadState, Rgb, ThemeIntensity,
    ThemeMode,
};
use semaphore_design::{Icon as DesignIcon, Intensity, Mode, Rgba};

/// The base colours offered: the design default, then the old accents' primaries, so a colour
/// picked on an older client shows as picked here.
pub fn base_presets() -> Vec<(Rgb, &'static str)> {
    let mut presets = vec![(DEFAULT_BASE, "Lounge Violet")];
    presets.extend(
        AccentColor::ALL
            .into_iter()
            .map(|accent| (accent.primary(), accent_name(accent))),
    );
    presets
}

/// The colours offered for `appearance`'s server: every preset, or, on a server without the base
/// colour (below v0.11.0), the accents' primaries only, as that server keeps only a named accent.
pub fn presets_for(appearance: Appearance) -> Vec<(Rgb, &'static str)> {
    let mut presets = base_presets();
    if !appearance.base_colour_settings {
        presets.retain(|(base, _)| AccentColor::ALL.iter().any(|a| a.primary() == *base));
    }
    presets
}

/// The three modes the tab offers: `matchSystem` is the third.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ModeChoice {
    Light,
    Dark,
    System,
}

/// The theme the appearance settings stand for, with `system` the operating system's mode (used
/// when `matchSystem` is on).
pub fn theme_input(appearance: Appearance, system: Mode) -> ThemeInput {
    let mode = if appearance.match_system {
        system
    } else {
        match appearance.mode {
            ThemeMode::Dark => Mode::Dark,
            ThemeMode::Light => Mode::Light,
        }
    };
    let intensity = match appearance.intensity {
        ThemeIntensity::Minimal => Intensity::Minimal,
        ThemeIntensity::Balanced => Intensity::Balanced,
        ThemeIntensity::Vibrant => Intensity::Vibrant,
    };
    let Rgb { r, g, b } = appearance.base;
    let base = Rgba(u32::from(r) << 24 | u32::from(g) << 16 | u32::from(b) << 8 | 0xff);
    ThemeInput::new(base, mode, intensity)
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

fn intensity_hint(intensity: ThemeIntensity) -> &'static str {
    match intensity {
        ThemeIntensity::Minimal => "Neutral backgrounds, with your colour on accents",
        ThemeIntensity::Balanced => "A tint of your colour in the backgrounds",
        ThemeIntensity::Vibrant => "Backgrounds full of your colour",
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
        let system = system_mode(cx);
        let view = cx.weak_entity();
        let send = move |patch: AppearancePatch, cx: &mut App| {
            view.update(cx, |this, cx| this.update(patch, cx)).ok();
        };

        let chosen_mode = if appearance.match_system {
            ModeChoice::System
        } else if appearance.mode == ThemeMode::Dark {
            ModeChoice::Dark
        } else {
            ModeChoice::Light
        };
        let mode_send = send.clone();
        // "Match system" only where the server stores it (v0.11.0 on).
        let modes: &[(ModeChoice, &'static str)] = if appearance.base_colour_settings {
            &[
                (ModeChoice::Light, "Light"),
                (ModeChoice::Dark, "Dark"),
                (ModeChoice::System, "Match system"),
            ]
        } else {
            &[(ModeChoice::Light, "Light"), (ModeChoice::Dark, "Dark")]
        };
        let mode = section("Theme Mode", cx).child(segmented(
            "appearance-mode",
            modes,
            chosen_mode,
            move |choice, _, cx| {
                let patch = match choice {
                    ModeChoice::System => AppearancePatch {
                        match_system: Some(true),
                        ..AppearancePatch::default()
                    },
                    ModeChoice::Dark | ModeChoice::Light => AppearancePatch {
                        mode: Some(if choice == ModeChoice::Dark {
                            ThemeMode::Dark
                        } else {
                            ThemeMode::Light
                        }),
                        match_system: Some(false),
                        ..AppearancePatch::default()
                    },
                };
                mode_send(patch, cx);
            },
        ));

        let effective = theme_input(appearance, system);
        let ring = sem.text_primary;
        let swatches = presets_for(appearance).into_iter().map(|(base, name)| {
            let send = send.clone();
            // The accent the base gives in the current mode and intensity: what the user gets.
            let tile = Sem::new(theme_input(Appearance { base, ..appearance }, system));
            let selected = appearance.base == base;
            base::Button::new(SharedString::from(format!(
                "appearance-base-{}",
                &base.to_hex()[1..]
            )))
            .accessibility_label(name)
            .selected(selected)
            .size(px(48.))
            .flex()
            .items_center()
            .justify_center()
            .rounded(px(8.))
            .cursor_pointer()
            .bg(tile.role.accent)
            .border_3()
            .border_color(if selected { ring } else { transparent_black() })
            .when(selected, |swatch| {
                swatch.child(design_icon(
                    DesignIcon::CheckCircle,
                    28.,
                    tile.role.on_accent,
                ))
            })
            .on_click(move |_, _, cx| {
                send(
                    AppearancePatch {
                        base: Some(base),
                        ..AppearancePatch::default()
                    },
                    cx,
                )
            })
        });
        let chosen_name = base_presets()
            .into_iter()
            .find(|(base, _)| *base == appearance.base)
            .map(|(_, name)| format!("{name} ({})", appearance.base.to_hex()))
            .unwrap_or_else(|| appearance.base.to_hex());
        let colour = section("Colour", cx)
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .gap(spacing(1.5))
                    .children(swatches),
            )
            .child(caption(chosen_name, cx));

        let intensity_send = send.clone();
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
                    intensity_send(
                        AppearancePatch {
                            intensity: Some(intensity),
                            ..AppearancePatch::default()
                        },
                        cx,
                    )
                },
            ))
            .child(caption(intensity_hint(appearance.intensity), cx));
        div()
            .flex()
            .flex_col()
            .gap(spacing(3.))
            .child(mode)
            .child(colour)
            .child(intensity)
            .child(section("Preview", cx).child(preview(effective)))
    }
}

fn preview(input: ThemeInput) -> AnyElement {
    let tile = Sem::new(input);
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
