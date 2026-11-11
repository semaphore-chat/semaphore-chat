//! The colours and fonts the list draws with: the web client's dark theme, default accent, as
//! `generateTheme('dark', 'teal', 'minimal')`, the web's defaults, and MUI's dark palette resolve them.
//!
//! Local to this module until U2's generated tokens and U8's theme land. Replacing `Palette::dark`
//! with a read from the theme is the only change the list needs.

use gpui_kit::*;

/// The web client's font first, then what's likely on the machine. Picked from installed fonts
/// rather than left to GPUI's fallback, because that fallback drops the weight: with Roboto missing,
/// `font("Roboto")` bold draws as regular DejaVu. Bundling Roboto is the theme's job (U8).
const BODY_FONTS: [&str; 5] = [
    "Roboto",
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

/// The column text wraps at. The web caps at `80ch`, about 720 px in Roboto at 16 px.
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

fn alpha(color: u32, a: f32) -> Hsla {
    let mut color: Hsla = rgb(color).into();
    color.a = a;
    color
}

impl Palette {
    pub fn dark() -> Self {
        let white = |a| alpha(0xffffff, a);
        let primary = 0x0d9488;
        Self {
            background: rgb(0x111318).into(),
            paper: rgb(0x1a1d24).into(),
            text: rgb(0xffffff).into(),
            text_secondary: white(0.7),
            text_disabled: white(0.5),
            divider: white(0.12),
            hover: white(0.08),
            overlay_medium: white(0.08),
            overlay_heavy: white(0.12),
            primary: rgb(primary).into(),
            primary_light: rgb(0x14b8a6).into(),
            positive: rgb(0x22c55e).into(),
            warning: rgb(0xffa726).into(),
            error: rgb(0xf44336).into(),
            avatar_bg: rgb(0x757575).into(),
            skeleton: white(0.11),
            selection: alpha(primary, 0.35),
        }
    }

    pub fn tint(&self, color: Hsla, a: f32) -> Hsla {
        Hsla { a, ..color }
    }
}
