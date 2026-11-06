//! The web client's theme on GPUI.
//!
//! `semaphore-design` holds the 72 resolved MUI palettes. They don't hold what `generateTheme` puts
//! in its `components` overrides (`frontend/src/theme/themeConfig.ts`), so [`Sem`] computes those
//! here from the same formulas: every value keeps its web name and intensity rule. [`apply`] installs
//! a theme at runtime, onto gpui-kit's `Theme` for the kit's own components, and as the [`Sem`] global
//! for ours.
//!
//! gpui gradients have two stops, so the vibrant button's three-stop gradient keeps its outer two.
//! Box shadows and glows are approximated where a surface has them, and left out on text-only parts.

use gpui_kit::component::{Theme, ThemeMode};
use gpui_kit::*;
use semaphore_design::{Accent, Intensity, Mode, Rgba as Token, Tokens, tokens};
use std::borrow::Cow;

pub mod color;
use color::{alpha, blend, contrast_ratio, hsla_of, parse_hex, readable_text_color};

/// The one font the web client ships, so widths and metrics match it.
pub const FONT_FAMILY: &str = "Roboto";

const ROBOTO: [&[u8]; 4] = [
    include_bytes!("../../assets/fonts/Roboto-400.ttf"),
    include_bytes!("../../assets/fonts/Roboto-500.ttf"),
    include_bytes!("../../assets/fonts/Roboto-600.ttf"),
    include_bytes!("../../assets/fonts/Roboto-700.ttf"),
];

/// One of the 72 themes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ThemeChoice {
    pub mode: Mode,
    pub accent: Accent,
    pub intensity: Intensity,
}

impl Default for ThemeChoice {
    /// `defaultSettings` in `frontend/src/theme/constants.ts`.
    fn default() -> Self {
        Self::new(Mode::Dark, Accent::Teal, Intensity::Minimal)
    }
}

pub const ALL_MODES: [Mode; 2] = [Mode::Light, Mode::Dark];
pub const ALL_ACCENTS: [Accent; 12] = [
    Accent::Teal,
    Accent::Blue,
    Accent::Indigo,
    Accent::Purple,
    Accent::Rose,
    Accent::Red,
    Accent::Orange,
    Accent::Amber,
    Accent::Lime,
    Accent::Emerald,
    Accent::Cyan,
    Accent::Slate,
];
pub const ALL_INTENSITIES: [Intensity; 3] =
    [Intensity::Minimal, Intensity::Balanced, Intensity::Vibrant];

fn accent_name(accent: Accent) -> &'static str {
    match accent {
        Accent::Teal => "teal",
        Accent::Blue => "blue",
        Accent::Indigo => "indigo",
        Accent::Purple => "purple",
        Accent::Rose => "rose",
        Accent::Red => "red",
        Accent::Orange => "orange",
        Accent::Amber => "amber",
        Accent::Lime => "lime",
        Accent::Emerald => "emerald",
        Accent::Cyan => "cyan",
        Accent::Slate => "slate",
    }
}

impl ThemeChoice {
    pub const fn new(mode: Mode, accent: Accent, intensity: Intensity) -> Self {
        Self {
            mode,
            accent,
            intensity,
        }
    }

    /// Every theme, in the web's own order.
    pub fn all() -> Vec<Self> {
        let mut themes = Vec::with_capacity(72);
        for mode in ALL_MODES {
            for accent in ALL_ACCENTS {
                for intensity in ALL_INTENSITIES {
                    themes.push(Self::new(mode, accent, intensity));
                }
            }
        }
        themes
    }

    /// `<mode>-<accent>-<intensity>`, the key `data/tokens.json` uses.
    pub fn name(self) -> String {
        let mode = match self.mode {
            Mode::Light => "light",
            Mode::Dark => "dark",
        };
        let intensity = match self.intensity {
            Intensity::Minimal => "minimal",
            Intensity::Balanced => "balanced",
            Intensity::Vibrant => "vibrant",
        };
        format!("{mode}-{}-{intensity}", accent_name(self.accent))
    }

    pub fn parse(name: &str) -> Option<Self> {
        Self::all().into_iter().find(|theme| theme.name() == name)
    }
}

/// A CSS `background`: a colour, or a two-stop gradient.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Paint {
    Solid(Hsla),
    /// CSS angle, in degrees.
    Linear(f32, Hsla, Hsla),
}

impl Paint {
    pub fn background(self) -> Background {
        match self {
            Paint::Solid(color) => color.into(),
            Paint::Linear(angle, from, to) => linear_gradient(
                angle,
                linear_color_stop(from, 0.),
                linear_color_stop(to, 1.),
            ),
        }
    }
}

/// `accentPalettes` in `themeConfig.ts`. `lighter` and `subtle` never reach `theme.palette`, so
/// they aren't in `semaphore-design`.
#[derive(Debug, Clone, Copy)]
pub struct AccentColors {
    pub primary: Token,
    pub light: Token,
    pub dark: Token,
    pub lighter: Token,
    pub subtle: Token,
}

fn accent_colors(accent: Accent) -> AccentColors {
    let (primary, light, dark, lighter, subtle) = match accent {
        Accent::Teal => ("#0d9488", "#14b8a6", "#0f766e", "#5eead4", "#2dd4bf"),
        Accent::Blue => ("#3b82f6", "#60a5fa", "#2563eb", "#93c5fd", "#60a5fa"),
        Accent::Indigo => ("#6366f1", "#818cf8", "#4f46e5", "#a5b4fc", "#818cf8"),
        Accent::Purple => ("#8b5cf6", "#a78bfa", "#7c3aed", "#c4b5fd", "#a78bfa"),
        Accent::Rose => ("#f43f5e", "#fb7185", "#e11d48", "#fda4af", "#fb7185"),
        Accent::Red => ("#ef4444", "#f87171", "#dc2626", "#fca5a5", "#f87171"),
        Accent::Orange => ("#f97316", "#fb923c", "#ea580c", "#fdba74", "#fb923c"),
        Accent::Amber => ("#f59e0b", "#fbbf24", "#d97706", "#fcd34d", "#fbbf24"),
        Accent::Lime => ("#84cc16", "#a3e635", "#65a30d", "#bef264", "#a3e635"),
        Accent::Emerald => ("#10b981", "#34d399", "#059669", "#6ee7b7", "#34d399"),
        Accent::Cyan => ("#06b6d4", "#22d3ee", "#0891b2", "#67e8f9", "#22d3ee"),
        Accent::Slate => ("#64748b", "#94a3b8", "#475569", "#cbd5e1", "#94a3b8"),
    };
    AccentColors {
        primary: parse_hex(primary),
        light: parse_hex(light),
        dark: parse_hex(dark),
        lighter: parse_hex(lighter),
        subtle: parse_hex(subtle),
    }
}

/// A resolved theme: the palette plus what the 21 `components` overrides compute from it. (The web's
/// `components` object has 21 entries; the brief's "22" counts one more than `themeConfig.ts` has.)
#[derive(Debug, Clone)]
pub struct Sem {
    pub choice: ThemeChoice,
    pub is_dark: bool,
    pub palette: &'static Tokens,
    pub accent: AccentColors,

    // MuiPaper and MuiCard
    pub paper: Hsla,
    pub paper_border: Hsla,
    pub card_border: Hsla,
    // MuiButton
    pub contained: Paint,
    pub contained_hover: Paint,
    pub outlined_border: Hsla,
    pub outlined_text: Hsla,
    pub outlined_hover_border: Hsla,
    pub outlined_hover_bg: Hsla,
    // MuiListItemButton
    pub list_hover: Hsla,
    pub list_selected: Hsla,
    pub list_selected_hover: Hsla,
    pub list_selected_border: Pixels,
    // MuiChip
    pub chip_bg: Hsla,
    pub chip_hover: Hsla,
    pub chip_text: Hsla,
    pub chip_border: Option<Hsla>,
    // MuiDrawer
    pub drawer: Paint,
    // MuiAppBar
    pub app_bar: Paint,
    pub app_bar_text: Hsla,
    // MuiLink, MuiTypography colorPrimary
    pub link: Hsla,
    pub link_hover: Hsla,
    // MuiOutlinedInput
    pub input_border: Hsla,
    pub input_border_focused: Hsla,
    // MuiIconButton
    pub icon_button_hover: Hsla,
    // MuiTab
    pub tab_selected: Hsla,
    // MuiSwitch, MuiCheckbox, MuiRadio, MuiSlider, MuiCircularProgress
    pub control_on: Hsla,
    // MuiLinearProgress
    pub progress_track: Hsla,
    pub progress_bar: Hsla,
    // MuiSnackbarContent
    pub snackbar_bg: Hsla,
    pub snackbar_text: Hsla,
    pub snackbar_border: Hsla,
    // MuiTooltip
    pub tooltip_bg: Hsla,
    // MuiCssBaseline. The band fades to `background_default` over `body_band`.
    pub body: Paint,
    pub body_band: Pixels,

    // Palette values views use everywhere.
    pub text_primary: Hsla,
    pub text_secondary: Hsla,
    pub text_disabled: Hsla,
    pub divider: Hsla,
    pub background_default: Hsla,
    pub primary: Hsla,
    pub primary_contrast: Hsla,
    pub error: Hsla,
    pub warning: Hsla,
    pub info: Hsla,
    pub success: Hsla,
    pub positive: Hsla,
    pub negative: Hsla,
    pub overlay_light: Hsla,
    pub overlay_medium: Hsla,
    pub overlay_heavy: Hsla,
    pub action_hover: Hsla,
    pub action_selected: Hsla,
    pub action_active: Hsla,
    pub action_disabled: Hsla,
    pub action_disabled_bg: Hsla,
}

impl Global for Sem {}

const BASE_DARK_PAPER: &str = "#1a1d24";
const BASE_LIGHT_PAPER: &str = "#ffffff";
const BASE_DARK_DEFAULT: &str = "#111318";
const BASE_LIGHT_DEFAULT: &str = "#f5f5f5";
const BAR_DARK: &str = "#151820";
const BAR_LIGHT: &str = "#ffffff";

impl Sem {
    pub fn new(choice: ThemeChoice) -> Self {
        let palette = tokens(choice.mode, choice.accent, choice.intensity);
        let accent = accent_colors(choice.accent);
        let is_dark = matches!(choice.mode, Mode::Dark);
        let balanced = !matches!(choice.intensity, Intensity::Minimal);
        let vibrant = matches!(choice.intensity, Intensity::Vibrant);
        let primary = accent.primary;
        // minimal, balanced, vibrant: the shape of nearly every override.
        let by = |minimal: f32, balanced_value: f32, vibrant_value: f32| {
            if vibrant {
                vibrant_value
            } else if balanced {
                balanced_value
            } else {
                minimal
            }
        };

        let base_paper = parse_hex(if is_dark {
            BASE_DARK_PAPER
        } else {
            BASE_LIGHT_PAPER
        });
        let base_default = parse_hex(if is_dark {
            BASE_DARK_DEFAULT
        } else {
            BASE_LIGHT_DEFAULT
        });
        let bar = parse_hex(if is_dark { BAR_DARK } else { BAR_LIGHT });
        let paper = palette.background_paper;

        // The chip text rule, from `generateTheme`.
        let chip_tint = by(0.1, 0.18, 0.3);
        let chip_hover_tint = chip_tint + 0.1;
        let backdrops: Vec<Token> = [paper, base_default]
            .into_iter()
            .flat_map(|surface| {
                [
                    blend(primary, surface, chip_tint),
                    blend(primary, surface, chip_hover_tint),
                ]
            })
            .collect();
        let chip_text = readable_text_color(
            if is_dark { accent.lighter } else { accent.dark },
            &backdrops,
            parse_hex(if is_dark { "#ffffff" } else { "#000000" }),
        );

        let contained = if vibrant {
            Paint::Linear(135., hsla_of(accent.light), hsla_of(accent.dark))
        } else if balanced {
            Paint::Linear(135., hsla_of(accent.primary), hsla_of(accent.light))
        } else {
            Paint::Solid(hsla_of(accent.primary))
        };
        let contained_hover = if vibrant {
            Paint::Linear(
                135.,
                hsla_of(accent.primary),
                hsla_of(blend(accent.dark, parse_hex("#000000"), 0.5)),
            )
        } else if balanced {
            Paint::Linear(135., hsla_of(accent.dark), hsla_of(accent.primary))
        } else {
            Paint::Solid(hsla_of(accent.dark))
        };

        let drawer = if vibrant {
            let weight = if is_dark { 0.5 } else { 0.35 };
            Paint::Linear(
                180.,
                hsla_of(blend(primary, base_paper, weight)),
                hsla_of(base_paper),
            )
        } else if balanced {
            let from = if is_dark {
                blend(accent.dark, base_paper, 0.3)
            } else {
                blend(primary, base_paper, 0.2)
            };
            Paint::Linear(180., hsla_of(from), hsla_of(base_paper))
        } else {
            Paint::Solid(hsla_of(base_paper))
        };

        let app_bar = if vibrant {
            let (from, to) = if is_dark {
                (blend(accent.dark, bar, 0.4), blend(primary, bar, 0.55))
            } else {
                (blend(primary, bar, 0.3), blend(accent.light, bar, 0.35))
            };
            Paint::Linear(90., hsla_of(from), hsla_of(to))
        } else if balanced {
            let to = if is_dark {
                blend(accent.dark, bar, 0.35)
            } else {
                blend(primary, bar, 0.2)
            };
            Paint::Linear(90., hsla_of(bar), hsla_of(to))
        } else {
            Paint::Solid(hsla_of(bar))
        };

        let (body, body_band) = if vibrant {
            let weight = if is_dark { 0.35 } else { 0.25 };
            (
                Paint::Linear(
                    180.,
                    hsla_of(blend(primary, base_default, weight)),
                    hsla_of(base_default),
                ),
                px(600.),
            )
        } else if balanced {
            let from = if is_dark {
                blend(accent.dark, base_default, 0.15)
            } else {
                blend(primary, base_default, 0.1)
            };
            (
                Paint::Linear(180., hsla_of(from), hsla_of(base_default)),
                px(400.),
            )
        } else {
            (Paint::Solid(hsla_of(base_default)), px(0.))
        };

        // getContrastText's rule, contrastThreshold 3.
        let snackbar_text = if contrast_ratio(paper, parse_hex("#ffffff")) >= 3. {
            hsla_of(parse_hex("#ffffff"))
        } else {
            hsla_of(Token(0x000000de))
        };

        Self {
            choice,
            is_dark,
            palette,
            accent,
            paper: hsla_of(paper),
            paper_border: hsla_of(alpha(primary, by(0.08, 0.2, 0.4))),
            card_border: hsla_of(alpha(primary, by(0.08, 0.25, 0.5))),
            contained,
            contained_hover,
            outlined_border: hsla_of(alpha(primary, by(0.3, 0.5, 0.7))),
            outlined_text: hsla_of(accent.light),
            outlined_hover_border: hsla_of(primary),
            outlined_hover_bg: hsla_of(alpha(primary, by(0.08, 0.08, 0.15))),
            list_hover: hsla_of(alpha(primary, by(0.06, 0.12, 0.18))),
            list_selected: hsla_of(alpha(primary, by(0.1, 0.18, 0.28))),
            list_selected_hover: hsla_of(alpha(primary, by(0.14, 0.22, 0.35))),
            list_selected_border: px(by(3., 3., 4.)),
            chip_bg: hsla_of(alpha(primary, chip_tint)),
            chip_hover: hsla_of(alpha(primary, chip_hover_tint)),
            chip_text: hsla_of(chip_text),
            chip_border: if vibrant {
                Some(hsla_of(alpha(primary, 0.5)))
            } else if balanced {
                Some(hsla_of(alpha(primary, 0.25)))
            } else {
                None
            },
            drawer,
            app_bar,
            app_bar_text: hsla_of(palette.text_primary),
            link: hsla_of(accent.subtle),
            link_hover: hsla_of(accent.light),
            input_border: hsla_of(alpha(primary, 0.3)),
            input_border_focused: hsla_of(primary),
            icon_button_hover: hsla_of(alpha(primary, 0.1)),
            tab_selected: hsla_of(accent.light),
            control_on: hsla_of(primary),
            progress_track: hsla_of(alpha(primary, 0.2)),
            progress_bar: hsla_of(primary),
            snackbar_bg: hsla_of(paper),
            snackbar_text,
            snackbar_border: hsla_of(if is_dark {
                Token(0xffffff1f)
            } else {
                Token(0x0000001f)
            }),
            tooltip_bg: hsla_of(parse_hex(if is_dark { "#2a2d35" } else { "#333333" })),
            body,
            body_band,
            text_primary: hsla_of(palette.text_primary),
            text_secondary: hsla_of(palette.text_secondary),
            text_disabled: hsla_of(palette.text_disabled),
            divider: hsla_of(palette.divider),
            background_default: hsla_of(palette.background_default),
            primary: hsla_of(palette.primary_main),
            primary_contrast: hsla_of(palette.primary_contrast_text),
            error: hsla_of(palette.error_main),
            warning: hsla_of(palette.warning_main),
            info: hsla_of(palette.info_main),
            success: hsla_of(palette.success_main),
            positive: hsla_of(palette.semantic_status_positive),
            negative: hsla_of(palette.semantic_status_negative),
            overlay_light: hsla_of(palette.semantic_overlay_light),
            overlay_medium: hsla_of(palette.semantic_overlay_medium),
            overlay_heavy: hsla_of(palette.semantic_overlay_heavy),
            action_hover: hsla_of(palette.action_hover),
            action_selected: hsla_of(palette.action_selected),
            action_active: hsla_of(palette.action_active),
            action_disabled: hsla_of(palette.action_disabled),
            action_disabled_bg: hsla_of(palette.action_disabled_background),
        }
    }
}

/// Read the active theme: `cx.sem()`.
pub trait SemTheme {
    fn sem(&self) -> &Sem;
}

impl SemTheme for App {
    fn sem(&self) -> &Sem {
        self.global::<Sem>()
    }
}

/// Registers the fonts and installs the default theme. Call once, after `gpui_kit::init`.
pub fn init(cx: &mut App) {
    let fonts = ROBOTO.iter().map(|font| Cow::Borrowed(*font)).collect();
    if let Err(error) = cx.text_system().add_fonts(fonts) {
        // Text still draws, in a fallback font, so a bad font must not stop the app.
        eprintln!("semaphore-ui: registering Roboto failed: {error}");
    }
    apply(ThemeChoice::default(), cx);
}

/// Switches every window to this theme.
pub fn apply(choice: ThemeChoice, cx: &mut App) {
    let sem = Sem::new(choice);
    let mode = if sem.is_dark {
        ThemeMode::Dark
    } else {
        ThemeMode::Light
    };
    Theme::change(mode, None, cx);
    Theme::update(cx, |theme| map_onto_kit(&sem, theme));
    cx.set_global(sem);
    cx.refresh_windows();
}

/// gpui-kit's own components (Select, Dialog, Input, Slider and so on) read these.
fn map_onto_kit(sem: &Sem, theme: &mut Theme) {
    let solid = |paint: Paint| match paint {
        Paint::Solid(color) | Paint::Linear(_, color, _) => color,
    };
    theme.font_family = FONT_FAMILY.into();
    theme.font_size = px(16.);
    theme.radius = px(4.);
    theme.radius_lg = px(12.);

    let c = &mut theme.colors;
    c.background = sem.background_default;
    c.foreground = sem.text_primary;
    c.muted = sem.overlay_medium;
    c.muted_foreground = sem.text_secondary;
    c.border = sem.divider;
    c.input = sem.input_border;
    c.ring = sem.primary;
    c.caret = sem.text_primary;
    c.selection = sem.primary.opacity(0.3);
    c.accent = sem.list_hover;
    c.accent_foreground = sem.text_primary;
    c.primary = sem.primary;
    c.primary_foreground = sem.primary_contrast;
    c.primary_hover = solid(sem.contained_hover);
    c.primary_active = solid(sem.contained_hover);
    c.secondary = sem.action_hover;
    c.secondary_foreground = sem.text_primary;
    c.secondary_hover = sem.action_selected;
    c.secondary_active = sem.action_selected;
    c.danger = sem.error;
    c.danger_foreground = hsla_of(sem.palette.error_contrast_text);
    c.warning = sem.warning;
    c.warning_foreground = hsla_of(sem.palette.warning_contrast_text);
    c.success = sem.success;
    c.success_foreground = hsla_of(sem.palette.success_contrast_text);
    c.info = sem.info;
    c.info_foreground = hsla_of(sem.palette.info_contrast_text);
    c.popover = sem.paper;
    c.popover_foreground = sem.text_primary;
    c.list = sem.paper;
    c.list_hover = sem.list_hover;
    c.list_active = sem.list_selected;
    c.list_active_border = sem.primary;
    c.link = sem.link;
    c.link_hover = sem.link_hover;
    c.link_active = sem.link_hover;
    c.progress_bar = sem.progress_bar;
    c.skeleton = sem.overlay_heavy;
    c.slider_bar = sem.control_on;
    c.slider_thumb = sem.control_on;
    c.switch = sem.text_disabled;
    c.switch_thumb = sem.paper;
    c.sidebar = sem.paper;
    c.sidebar_foreground = sem.text_primary;
    c.sidebar_border = sem.divider;
    c.sidebar_accent = sem.list_selected;
    c.sidebar_accent_foreground = sem.primary;
    c.tab = sem.paper;
    c.tab_active = sem.paper;
    c.tab_active_foreground = sem.tab_selected;
    c.tab_foreground = sem.text_secondary;
    c.tab_bar = sem.paper;
    c.table = sem.paper;
    c.table_hover = sem.action_hover;
    c.table_head = sem.paper;
    c.table_head_foreground = sem.text_primary;
    c.table_row_border = sem.divider;
    c.title_bar = solid(sem.app_bar);
    c.title_bar_border = sem.divider;
    c.overlay = Hsla::from(rgba(0x00000080));
    c.scrollbar_thumb = sem.overlay_heavy;
    c.scrollbar_thumb_hover = sem.overlay_heavy;
}

#[cfg(feature = "stories")]
pub fn stories() -> Vec<crate::stories::Story> {
    use crate::kit::Variant;
    use crate::kit::text;
    use crate::stories::Story;

    /// All 72 themes at once, each tile painted from its own [`Sem`], not the global one.
    struct Swatches;

    impl Render for Swatches {
        fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
            let sem = cx.sem().clone();
            div()
                .size_full()
                .p_4()
                .bg(sem.background_default)
                .flex()
                .flex_wrap()
                .gap_1()
                .font_family(FONT_FAMILY)
                .children(ThemeChoice::all().into_iter().map(|choice| {
                    let tile = Sem::new(choice);
                    div()
                        .w(px(150.))
                        .h(px(90.))
                        .flex()
                        .flex_col()
                        .rounded(px(4.))
                        .overflow_hidden()
                        .border_1()
                        .border_color(tile.paper_border)
                        .bg(tile.body.background())
                        .child(
                            div()
                                .h(px(20.))
                                .bg(tile.app_bar.background())
                                .px_1()
                                .text_color(tile.app_bar_text)
                                .child(text(Variant::Xs, choice.name())),
                        )
                        .child(
                            div()
                                .flex_1()
                                .flex()
                                .gap_1()
                                .p_1()
                                .child(div().w(px(40.)).h_full().bg(tile.drawer.background()))
                                .child(
                                    div()
                                        .flex_1()
                                        .flex()
                                        .flex_col()
                                        .gap_1()
                                        .child(
                                            div()
                                                .h(px(20.))
                                                .rounded(px(4.))
                                                .bg(tile.contained.background()),
                                        )
                                        .child(
                                            div()
                                                .h(px(16.))
                                                .rounded(px(8.))
                                                .bg(tile.chip_bg)
                                                .text_color(tile.chip_text)
                                                .px_1()
                                                .child(text(Variant::Xs, "chip")),
                                        ),
                                ),
                        )
                }))
        }
    }

    vec![Story::new("theme-swatches", |_, _, cx| {
        cx.new(|_| Swatches).into()
    })]
}

#[cfg(test)]
mod tests {
    use super::*;
    // `gpui_kit::*` brings GPUI's `test` attribute in too, and it would win.
    use core::prelude::v1::test;

    #[test]
    fn all_72_themes_have_distinct_names_and_round_trip() {
        let all = ThemeChoice::all();
        assert_eq!(all.len(), 72);
        for theme in all {
            assert_eq!(ThemeChoice::parse(&theme.name()), Some(theme));
        }
        assert_eq!(ThemeChoice::parse("dark-mauve-balanced"), None);
    }

    #[test]
    fn paper_matches_the_web_in_every_theme() {
        for choice in ThemeChoice::all() {
            let sem = Sem::new(choice);
            assert_eq!(sem.paper, hsla_of(sem.palette.background_paper));
        }
    }

    /// `themeConfig.ts` promises chip text reaches WCAG AA on its tint in every theme.
    #[test]
    fn chip_text_reaches_aa_in_every_theme() {
        for choice in ThemeChoice::all() {
            let palette = tokens(choice.mode, choice.accent, choice.intensity);
            let sem = Sem::new(choice);
            let accent = accent_colors(choice.accent);
            let tint = match choice.intensity {
                Intensity::Minimal => 0.1,
                Intensity::Balanced => 0.18,
                Intensity::Vibrant => 0.3,
            };
            let backdrop = blend(accent.primary, palette.background_paper, tint);
            let text = color::token_of(sem.chip_text);
            assert!(
                contrast_ratio(text, backdrop) >= 4.4,
                "{}: {}",
                choice.name(),
                contrast_ratio(text, backdrop)
            );
        }
    }

    /// Values read off `generateTheme` for one theme of each intensity.
    #[test]
    fn overrides_match_the_formulas() {
        let sem = Sem::new(ThemeChoice::new(
            Mode::Dark,
            Accent::Blue,
            Intensity::Balanced,
        ));
        assert_eq!(
            sem.list_selected,
            hsla_of(alpha(parse_hex("#3b82f6"), 0.18))
        );
        assert_eq!(
            sem.contained,
            Paint::Linear(
                135.,
                hsla_of(parse_hex("#3b82f6")),
                hsla_of(parse_hex("#60a5fa"))
            )
        );
        let sem = Sem::new(ThemeChoice::new(
            Mode::Light,
            Accent::Teal,
            Intensity::Minimal,
        ));
        assert_eq!(sem.input_border, hsla_of(alpha(parse_hex("#0d9488"), 0.3)));
        assert_eq!(sem.contained, Paint::Solid(hsla_of(parse_hex("#0d9488"))));
        let sem = Sem::new(ThemeChoice::new(
            Mode::Dark,
            Accent::Rose,
            Intensity::Vibrant,
        ));
        assert_eq!(sem.list_selected_border, px(4.));
        assert_eq!(sem.paper_border, hsla_of(alpha(parse_hex("#f43f5e"), 0.4)));
    }
}
