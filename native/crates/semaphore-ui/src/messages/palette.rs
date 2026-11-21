//! The colours and fonts the list draws with: the theme's ([`crate::theme::Sem`]), under the names
//! the list was written against.

use gpui_kit::*;

/// The bundled body font first (the theme registers it), then what's likely on the machine. Picked
/// from installed fonts rather than left to GPUI's fallback, because that fallback drops the weight:
/// with the font missing, bold draws as regular DejaVu.
const BODY_FONTS: [&str; 5] = [
    crate::theme::FONT_FAMILY,
    "Noto Sans",
    "Segoe UI",
    "Cantarell",
    "DejaVu Sans",
];
const CODE_FONTS: [&str; 6] = [
    "SF Mono",
    "Menlo",
    "Consolas",
    "Liberation Mono",
    "DejaVu Sans Mono",
    "Noto Sans Mono",
];

#[derive(Clone, Debug)]
pub struct Fonts {
    pub body: SharedString,
    pub code: SharedString,
}

impl Fonts {
    pub fn pick(cx: &App) -> Self {
        let installed = cx.text_system().all_font_names();
        let first_of = |wanted: &[&'static str], last_resort: &'static str| -> SharedString {
            wanted
                .iter()
                .find(|name| installed.iter().any(|font| font == *name))
                .copied()
                .unwrap_or(last_resort)
                .into()
        };
        Self {
            body: first_of(&BODY_FONTS, ".SystemUIFont"),
            code: first_of(&CODE_FONTS, ".SystemUIFont"),
        }
    }
}

/// The column text wraps at. The web caps at `80ch`, about 720 px at 16 px.
pub const TEXT_MAX_WIDTH: f32 = 720.;
pub const CODE_MAX_WIDTH: f32 = 1080.;
pub const AVATAR: f32 = 32.;
pub const AVATAR_GUTTER: f32 = 44.;
pub const BODY_SIZE: f32 = 16.;
pub const BODY_LINE: f32 = 24.;
pub const CODE_SIZE: f32 = 13.6;
pub const CAPTION_SIZE: f32 = 12.;
pub const NAME_SIZE: f32 = 14.;

#[derive(Clone, Copy, Debug)]
pub struct Palette {
    pub background: Hsla,
    pub paper: Hsla,
    pub text: Hsla,
    pub text_secondary: Hsla,
    pub text_disabled: Hsla,
    pub divider: Hsla,
    pub hover: Hsla,
    pub overlay_medium: Hsla,
    pub overlay_heavy: Hsla,
    pub primary: Hsla,
    pub primary_light: Hsla,
    pub positive: Hsla,
    pub warning: Hsla,
    pub error: Hsla,
    pub avatar_bg: Hsla,
    pub skeleton: Hsla,
    pub selection: Hsla,
}

impl Palette {
    /// The default theme's colours, for a list drawn before it reads the theme.
    pub fn dark() -> Self {
        Self::from_sem(&crate::theme::Sem::default())
    }

    /// The theme's colours, under the names the list was written against.
    pub fn from_sem(sem: &crate::theme::Sem) -> Self {
        Self {
            background: sem.background_default,
            paper: sem.paper,
            text: sem.text_primary,
            text_secondary: sem.text_secondary,
            text_disabled: sem.text_disabled,
            divider: sem.divider,
            hover: sem.action_hover,
            overlay_medium: sem.overlay_medium,
            overlay_heavy: sem.overlay_heavy,
            primary: sem.primary,
            primary_light: sem.link,
            positive: sem.positive,
            warning: sem.warning,
            error: sem.error,
            avatar_bg: crate::theme::color::hsla_of(sem.palette.grey_600),
            skeleton: sem.overlay_heavy,
            selection: Hsla {
                a: 0.35,
                ..sem.primary
            },
        }
    }

    pub fn tint(&self, color: Hsla, a: f32) -> Hsla {
        Hsla { a, ..color }
    }

    /// MUI's tooltip: grey 700 at 92%, in both modes. White text sits on it in every theme, so it
    /// stays fixed until the list's tooltips move to the kit's (epic #848, B4).
    pub fn tooltip_bg(&self) -> Hsla {
        let mut color: Hsla = rgb(0x616161).into();
        color.a = 0.92;
        color
    }
}
