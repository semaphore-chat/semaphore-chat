//! The design system's theme on GPUI.
//!
//! A theme is a base colour, a mode and an intensity ([`ThemeInput`]). `semaphore_design::derive`
//! turns them into the 16 colour roles (`design/guide/tokens-and-colour.md`), and [`Sem`] holds
//! them, as [`Sem::roles`] and [`Sem::role`]. [`apply`] installs a theme at runtime, onto
//! gpui-kit's `Theme` for the kit's own components, and as the [`Sem`] global for ours, so a
//! switch shows at once.
//!
//! The screens not yet converted to the design system still read the MUI-shaped names they were
//! written against (`text_primary`, `paper`, `list_selected`, ...). Those are kept, flat, and each
//! is now one of the roles or a state tint over one, as the web's `createLoungeTheme` maps MUI's
//! palette onto the roles. The table is in `native/docs/theme.md`. They go when their last screen
//! is converted (epic #848, B19).

use gpui_kit::component::{Theme, ThemeMode};
use gpui_kit::*;
use semaphore_core::model::AccentColor;
use semaphore_design::lounge::{
    STATE_HOVER, STATE_HOVER_ON_FILL, STATE_PRESSED, STATE_PRESSED_ON_FILL,
};
use semaphore_design::{Intensity, Mode, Palette, Rgba as Token, derive_palette, parse_base};
use std::borrow::Cow;

pub mod color;
use color::{alpha, blend, hsla_of};

/// The body font (`font.body` in `design/tokens.json`), for every text the old screens draw.
pub const FONT_FAMILY: &str = semaphore_design::lounge::FONT_BODY;
/// The heading font (`font.heading`), for titles and names in converted screens.
pub const HEADING_FONT_FAMILY: &str = semaphore_design::lounge::FONT_HEADING;

/// The faces the web kit bundles (`frontend/src/kit/fonts.ts`); see `assets/fonts/README`.
const FONTS: [&[u8]; 6] = [
    include_bytes!("../../assets/fonts/Figtree-400.ttf"),
    include_bytes!("../../assets/fonts/Figtree-400-italic.ttf"),
    include_bytes!("../../assets/fonts/Figtree-500.ttf"),
    include_bytes!("../../assets/fonts/Figtree-600.ttf"),
    include_bytes!("../../assets/fonts/BricolageGrotesque-600.ttf"),
    include_bytes!("../../assets/fonts/BricolageGrotesque-700.ttf"),
];

/// The design system's default base colour, `#8e75ff` (the server's default `baseColor`).
pub const DEFAULT_BASE: Token = Token(0x8e75ffff);

/// What a theme is derived from: a base colour, a mode and an intensity.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ThemeInput {
    /// Opaque `0xRRGGBBff`.
    pub base: Token,
    pub mode: Mode,
    pub intensity: Intensity,
}

impl Default for ThemeInput {
    /// The design default: `#8e75ff`, dark, minimal.
    fn default() -> Self {
        Self::new(DEFAULT_BASE, Mode::Dark, Intensity::Minimal)
    }
}

fn mode_name(mode: Mode) -> &'static str {
    match mode {
        Mode::Light => "light",
        Mode::Dark => "dark",
    }
}

fn intensity_name(intensity: Intensity) -> &'static str {
    match intensity {
        Intensity::Minimal => "minimal",
        Intensity::Balanced => "balanced",
        Intensity::Vibrant => "vibrant",
    }
}

impl ThemeInput {
    /// `base`'s alpha byte is ignored: a base is always opaque.
    pub const fn new(base: Token, mode: Mode, intensity: Intensity) -> Self {
        Self {
            base: Token(base.0 | 0xff),
            mode,
            intensity,
        }
    }

    /// `<mode>-<intensity>-<rrggbb>`, e.g. `dark-minimal-8e75ff`: how the app remembers the last
    /// theme it showed, and how the screenshot rig names one.
    pub fn name(self) -> String {
        format!(
            "{}-{}-{:06x}",
            mode_name(self.mode),
            intensity_name(self.intensity),
            self.base.0 >> 8
        )
    }

    /// [`ThemeInput::name`]'s form, or the old `<mode>-<accent>-<intensity>` one (`dark-teal-minimal`),
    /// read as that accent's primary as the base, as the server migrated accents to base colours.
    pub fn parse(name: &str) -> Option<Self> {
        let parts: Vec<&str> = name.split('-').collect();
        let [mode, second, third] = parts[..] else {
            return None;
        };
        let mode = Mode::ALL.into_iter().find(|m| mode_name(*m) == mode)?;
        let intensity_of = |text: &str| {
            Intensity::ALL
                .into_iter()
                .find(|i| intensity_name(*i) == text)
        };
        if let Some(intensity) = intensity_of(second) {
            if third.len() != 6 || third.bytes().any(|b| b.is_ascii_uppercase()) {
                return None;
            }
            let base = parse_base(&format!("#{third}"))?;
            return Some(Self::new(base, mode, intensity));
        }
        let accent = AccentColor::parse(second)?;
        let intensity = intensity_of(third)?;
        let base = parse_base(&accent.primary().to_hex())?;
        Some(Self::new(base, mode, intensity))
    }
}

/// A CSS `background`. The design system is flat, so only a colour.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Paint {
    Solid(Hsla),
}

impl Paint {
    pub fn background(self) -> Background {
        match self {
            Paint::Solid(color) => color.into(),
        }
    }

    pub fn color(self) -> Hsla {
        match self {
            Paint::Solid(color) => color,
        }
    }
}

/// The 16 roles as GPUI colours, named as `design/guide/tokens-and-colour.md` names them.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Roles {
    pub ground: Hsla,
    pub surface: Hsla,
    pub fill: Hsla,
    pub hairline: Hsla,
    pub text: Hsla,
    pub text_secondary: Hsla,
    pub text_dim: Hsla,
    pub accent: Hsla,
    pub on_accent: Hsla,
    pub accent_text: Hsla,
    pub focus: Hsla,
    pub positive: Hsla,
    pub warning: Hsla,
    pub danger: Hsla,
    pub on_danger: Hsla,
    pub scrim: Hsla,
}

impl Roles {
    fn of(palette: &Palette) -> Self {
        Self {
            ground: hsla_of(palette.ground),
            surface: hsla_of(palette.surface),
            fill: hsla_of(palette.fill),
            hairline: hsla_of(palette.hairline),
            text: hsla_of(palette.text),
            text_secondary: hsla_of(palette.text_secondary),
            text_dim: hsla_of(palette.text_dim),
            accent: hsla_of(palette.accent),
            on_accent: hsla_of(palette.on_accent),
            accent_text: hsla_of(palette.accent_text),
            focus: hsla_of(palette.focus),
            positive: hsla_of(palette.positive),
            warning: hsla_of(palette.warning),
            danger: hsla_of(palette.danger),
            on_danger: hsla_of(palette.on_danger),
            scrim: hsla_of(palette.scrim),
        }
    }
}

/// The few MUI palette entries the old screens read directly, each now a role (see the module
/// docs). Packed colours, as `semaphore-design` has them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LegacyPalette {
    pub background_paper: Token,
    pub common_white: Token,
    pub primary_light: Token,
    pub secondary_main: Token,
    pub secondary_contrast_text: Token,
    pub error_main: Token,
    pub error_light: Token,
    pub error_contrast_text: Token,
    pub warning_main: Token,
    pub warning_light: Token,
    pub warning_contrast_text: Token,
    pub success_main: Token,
    pub success_light: Token,
    pub success_contrast_text: Token,
    pub info_main: Token,
    pub info_light: Token,
    pub info_contrast_text: Token,
    pub grey_400: Token,
    pub grey_500: Token,
    pub grey_600: Token,
}

impl LegacyPalette {
    fn of(p: &Palette, mode: Mode) -> Self {
        // `createLoungeTheme`: positive and warning have no on-colour among the roles, so they
        // take the page colour opposite the mode.
        let on_status = if mode == Mode::Dark {
            p.ground
        } else {
            p.surface
        };
        Self {
            background_paper: p.surface,
            common_white: Token(0xffffffff),
            primary_light: p.accent_text,
            secondary_main: p.accent,
            secondary_contrast_text: p.on_accent,
            error_main: p.danger,
            error_light: p.danger,
            error_contrast_text: p.on_danger,
            warning_main: p.warning,
            warning_light: p.warning,
            warning_contrast_text: on_status,
            success_main: p.positive,
            success_light: p.positive,
            success_contrast_text: on_status,
            info_main: p.accent,
            info_light: p.accent,
            info_contrast_text: p.on_accent,
            grey_400: p.text_dim,
            grey_500: p.text_dim,
            grey_600: p.text_dim,
        }
    }
}

/// The theme in use: its input, the derived roles, and the old screens' names for them.
#[derive(Debug, Clone)]
pub struct Sem {
    pub input: ThemeInput,
    pub is_dark: bool,
    /// The derived palette, packed.
    pub roles: Palette,
    /// The same roles as GPUI colours.
    pub role: Roles,
    pub palette: LegacyPalette,

    // The old screens' names, each a role or a state tint over one.
    pub paper: Hsla,
    pub paper_border: Hsla,
    pub card_border: Hsla,
    pub contained: Paint,
    pub contained_hover: Paint,
    pub outlined_border: Hsla,
    pub outlined_text: Hsla,
    pub outlined_hover_border: Hsla,
    pub outlined_hover_bg: Hsla,
    pub list_hover: Hsla,
    pub list_selected: Hsla,
    pub list_selected_hover: Hsla,
    pub list_selected_border: Pixels,
    pub chip_bg: Hsla,
    pub chip_hover: Hsla,
    pub chip_text: Hsla,
    pub chip_border: Option<Hsla>,
    pub drawer: Paint,
    pub app_bar: Paint,
    pub app_bar_text: Hsla,
    pub link: Hsla,
    pub link_hover: Hsla,
    pub input_border: Hsla,
    pub input_border_focused: Hsla,
    pub icon_button_hover: Hsla,
    pub tab_selected: Hsla,
    pub control_on: Hsla,
    pub progress_track: Hsla,
    pub progress_bar: Hsla,
    pub snackbar_bg: Hsla,
    pub snackbar_text: Hsla,
    pub snackbar_border: Hsla,
    pub tooltip_bg: Hsla,
    pub body: Paint,
    pub body_band: Pixels,

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

impl Default for Sem {
    fn default() -> Self {
        Self::new(ThemeInput::default())
    }
}

impl Sem {
    pub fn new(input: ThemeInput) -> Self {
        let p = derive_palette(input.base, input.mode, input.intensity);
        let r = Roles::of(&p);
        let is_dark = input.mode == Mode::Dark;
        // A state tint of `color` at `amount`, translucent, so it works over whatever is under it.
        let tint = |color: Token, amount: f32| hsla_of(alpha(color, amount));
        // The kit's opaque state: `amount` of `over` mixed into `under`.
        let mix = |over: Token, under: Token, amount: f32| hsla_of(blend(over, under, amount));

        Self {
            input,
            is_dark,
            roles: p,
            role: r,
            palette: LegacyPalette::of(&p, input.mode),

            paper: r.surface,
            paper_border: r.hairline,
            card_border: r.hairline,
            contained: Paint::Solid(r.accent),
            contained_hover: Paint::Solid(mix(p.text, p.accent, STATE_HOVER_ON_FILL)),
            outlined_border: r.hairline,
            outlined_text: r.accent_text,
            outlined_hover_border: r.accent,
            outlined_hover_bg: tint(p.text, STATE_HOVER),
            list_hover: tint(p.text, STATE_HOVER),
            list_selected: tint(p.accent, STATE_HOVER_ON_FILL),
            list_selected_hover: tint(p.accent, STATE_PRESSED_ON_FILL),
            list_selected_border: px(semaphore_design::lounge::BORDER_SELECTED),
            chip_bg: r.fill,
            chip_hover: mix(p.text, p.fill, STATE_HOVER_ON_FILL),
            chip_text: r.text,
            chip_border: None,
            drawer: Paint::Solid(r.surface),
            app_bar: Paint::Solid(r.surface),
            app_bar_text: r.text,
            link: r.accent_text,
            link_hover: r.accent_text,
            input_border: r.hairline,
            input_border_focused: r.focus,
            icon_button_hover: tint(p.text, STATE_PRESSED),
            tab_selected: r.accent_text,
            control_on: r.accent,
            progress_track: r.hairline,
            progress_bar: r.accent,
            snackbar_bg: r.fill,
            snackbar_text: r.text,
            snackbar_border: r.hairline,
            tooltip_bg: r.fill,
            body: Paint::Solid(r.ground),
            body_band: px(0.),

            text_primary: r.text,
            text_secondary: r.text_secondary,
            text_disabled: r.text_dim,
            divider: r.hairline,
            background_default: r.ground,
            primary: r.accent,
            primary_contrast: r.on_accent,
            error: r.danger,
            warning: r.warning,
            info: r.accent,
            success: r.positive,
            positive: r.positive,
            negative: r.danger,
            overlay_light: tint(p.text, STATE_HOVER),
            overlay_medium: tint(p.text, STATE_PRESSED),
            overlay_heavy: tint(p.text, STATE_HOVER_ON_FILL),
            action_hover: tint(p.text, STATE_HOVER),
            action_selected: tint(p.text, STATE_PRESSED),
            action_active: r.text_secondary,
            action_disabled: r.text_dim,
            action_disabled_bg: r.fill,
        }
    }
}

/// The operating system's light or dark setting, for `matchSystem`.
pub fn system_mode(cx: &App) -> Mode {
    mode_of(cx.window_appearance())
}

/// A window's appearance as a theme mode.
pub fn mode_of(appearance: WindowAppearance) -> Mode {
    match appearance {
        WindowAppearance::Dark | WindowAppearance::VibrantDark => Mode::Dark,
        WindowAppearance::Light | WindowAppearance::VibrantLight => Mode::Light,
    }
}

pub trait SemTheme {
    fn sem(&self) -> &Sem;
}

impl SemTheme for App {
    fn sem(&self) -> &Sem {
        self.global::<Sem>()
    }
}

pub fn init(cx: &mut App) {
    let fonts = FONTS.iter().map(|font| Cow::Borrowed(*font)).collect();
    if let Err(error) = cx.text_system().add_fonts(fonts) {
        // Text still draws, in a fallback font, so a bad font must not stop the app.
        eprintln!("semaphore-ui: registering the bundled fonts failed: {error}");
    }
    apply(ThemeInput::default(), cx);
}

pub fn apply(input: ThemeInput, cx: &mut App) {
    let sem = Sem::new(input);
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

fn map_onto_kit(sem: &Sem, theme: &mut Theme) {
    let r = &sem.role;
    theme.font_family = FONT_FAMILY.into();
    theme.font_size = px(16.);
    theme.radius = px(4.);
    theme.radius_lg = px(12.);

    let c = &mut theme.colors;
    c.background = r.ground;
    c.foreground = r.text;
    c.muted = r.fill;
    c.muted_foreground = r.text_secondary;
    c.border = r.hairline;
    c.input = r.hairline;
    c.ring = r.focus;
    c.caret = r.text;
    c.selection = r.accent.opacity(0.3);
    c.accent = sem.list_hover;
    c.accent_foreground = r.text;
    c.primary = r.accent;
    c.primary_foreground = r.on_accent;
    c.primary_hover = sem.contained_hover.color();
    c.primary_active = sem.contained_hover.color();
    c.secondary = sem.action_hover;
    c.secondary_foreground = r.text;
    c.secondary_hover = sem.action_selected;
    c.secondary_active = sem.action_selected;
    c.danger = r.danger;
    c.danger_foreground = r.on_danger;
    c.warning = r.warning;
    c.warning_foreground = hsla_of(sem.palette.warning_contrast_text);
    c.success = r.positive;
    c.success_foreground = hsla_of(sem.palette.success_contrast_text);
    c.info = r.accent;
    c.info_foreground = r.on_accent;
    c.popover = r.surface;
    c.popover_foreground = r.text;
    c.list = r.surface;
    c.list_hover = sem.list_hover;
    c.list_active = sem.list_selected;
    c.list_active_border = r.accent;
    c.link = r.accent_text;
    c.link_hover = r.accent_text;
    c.link_active = r.accent_text;
    c.progress_bar = r.accent;
    c.skeleton = sem.overlay_heavy;
    c.slider_bar = r.accent;
    c.slider_thumb = r.accent;
    c.switch = r.text_dim;
    c.switch_thumb = r.surface;
    c.sidebar = r.surface;
    c.sidebar_foreground = r.text;
    c.sidebar_border = r.hairline;
    c.sidebar_accent = sem.list_selected;
    c.sidebar_accent_foreground = r.accent_text;
    c.tab = r.surface;
    c.tab_active = r.surface;
    c.tab_active_foreground = r.accent_text;
    c.tab_foreground = r.text_secondary;
    c.tab_bar = r.surface;
    c.table = r.surface;
    c.table_hover = sem.action_hover;
    c.table_head = r.surface;
    c.table_head_foreground = r.text;
    c.table_row_border = r.hairline;
    c.title_bar = r.surface;
    c.title_bar_border = r.hairline;
    c.overlay = r.scrim;
    c.scrollbar_thumb = sem.overlay_heavy;
    c.scrollbar_thumb_hover = sem.overlay_heavy;
}

/// The role names in `design/gen/colour_ref.py`'s `ROLES` order, for the roles story and tests.
pub const ROLE_NAMES: [&str; 16] = [
    "ground",
    "surface",
    "fill",
    "hairline",
    "text",
    "textSecondary",
    "textDim",
    "accent",
    "onAccent",
    "accentText",
    "focus",
    "positive",
    "warning",
    "danger",
    "onDanger",
    "scrim",
];

#[cfg(feature = "stories")]
pub fn stories() -> Vec<crate::stories::Story> {
    use crate::kit::Variant;
    use crate::kit::text;
    use crate::stories::Story;

    /// The bases the roles story derives: the default, the old accents' teal, and the edges of the
    /// hue circle and the grey axis.
    const BASES: [u32; 4] = [0x8e75ff, 0x0d9488, 0xff0000, 0x808080];

    struct Roles;

    impl Render for Roles {
        fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
            let sem = cx.sem().clone();
            let column =
                |input: ThemeInput| {
                    let tile = Sem::new(input);
                    let rows = tile.roles.roles().into_iter().zip(ROLE_NAMES).map(
                        move |(colour, name)| {
                            div()
                                .flex()
                                .items_center()
                                .gap_1()
                                .child(
                                    div()
                                        .size(px(12.))
                                        .rounded(px(2.))
                                        .border_1()
                                        .border_color(tile.role.hairline)
                                        .bg(hsla_of(colour)),
                                )
                                .child(text(Variant::Xs, format!("{name} {:08x}", colour.0)))
                        },
                    );
                    div()
                        .w(px(150.))
                        .flex()
                        .flex_col()
                        .gap(px(1.))
                        .p_1()
                        .rounded(px(4.))
                        .bg(tile.role.ground)
                        .text_color(tile.role.text)
                        .border_1()
                        .border_color(tile.role.hairline)
                        .child(text(Variant::Xs, input.name()).text_color(tile.role.accent_text))
                        .children(rows)
                };
            div()
                .id("theme-roles")
                .size_full()
                .overflow_y_scroll()
                .p_2()
                .bg(sem.background_default)
                .flex()
                .flex_wrap()
                .gap_1()
                .font_family(FONT_FAMILY)
                .children(BASES.into_iter().flat_map(|base| {
                    Mode::ALL.into_iter().flat_map(move |mode| {
                        Intensity::ALL.into_iter().map(move |intensity| {
                            column(ThemeInput::new(Token(base << 8 | 0xff), mode, intensity))
                        })
                    })
                }))
        }
    }

    vec![Story::new("theme-roles", |_, _, cx| {
        cx.new(|_| Roles).into()
    })]
}

#[cfg(test)]
mod tests;
