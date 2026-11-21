//! The colour palette derivation: a direct port of `design/gen/colour_ref.py`,
//! the definition of the algorithm.
//!
//! `colour_params` holds the numbers. Decisions (gamut, contrast) are taken on the
//! rounded 8-bit colour and on fixed step grids, exactly as the reference does, so
//! the Rust client, the web client and the shared vectors cannot drift on a
//! floating-point rounding difference.

use crate::Rgba;
use crate::colour_params::{
    ACCENT_TEXT_CONTRAST, CHROMA_REFERENCE, DARK, INK, INTENSITY, LIGHT, ModeParams, PAPER, STATUS,
};

/// Light or dark: which end of the lightness scale the grounds sit at.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Mode {
    Light,
    Dark,
}

impl Mode {
    pub const ALL: [Mode; 2] = [Mode::Light, Mode::Dark];
}

/// How much of the base colour's hue reaches the neutral roles (`colour.intensity`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Intensity {
    Minimal,
    Balanced,
    Vibrant,
}

impl Intensity {
    /// Weakest first.
    pub const ALL: [Intensity; 3] = [Intensity::Minimal, Intensity::Balanced, Intensity::Vibrant];
}

/// One mode's 16 colour roles, packed `0xRRGGBBAA`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Palette {
    pub ground: Rgba,
    pub surface: Rgba,
    pub fill: Rgba,
    pub hairline: Rgba,
    pub text: Rgba,
    pub text_secondary: Rgba,
    pub text_dim: Rgba,
    pub accent: Rgba,
    pub on_accent: Rgba,
    pub accent_text: Rgba,
    pub focus: Rgba,
    pub positive: Rgba,
    pub warning: Rgba,
    pub danger: Rgba,
    pub on_danger: Rgba,
    pub scrim: Rgba,
}

impl Palette {
    /// The roles in `design/gen/colour_ref.py`'s `ROLES` order.
    pub fn roles(&self) -> [Rgba; 16] {
        [
            self.ground,
            self.surface,
            self.fill,
            self.hairline,
            self.text,
            self.text_secondary,
            self.text_dim,
            self.accent,
            self.on_accent,
            self.accent_text,
            self.focus,
            self.positive,
            self.warning,
            self.danger,
            self.on_danger,
            self.scrim,
        ]
    }
}

/// `#rrggbb` (either case) to an opaque colour; anything else is `None`.
pub fn parse_base(hex: &str) -> Option<Rgba> {
    let bytes = hex.as_bytes();
    if bytes.len() != 7 || bytes[0] != b'#' {
        return None;
    }
    let mut value = 0u32;
    for byte in &bytes[1..] {
        value = value << 4 | char::from(*byte).to_digit(16)?;
    }
    Some(Rgba(value << 8 | 0xff))
}

/// The WCAG contrast ratio between two colours; their alpha bytes are ignored.
pub fn contrast_ratio(a: Rgba, b: Rgba) -> f64 {
    contrast(channels(a), channels(b))
}

/// The 8-bit `[r, g, b]` channels of a colour; the alpha byte is ignored.
fn channels(colour: Rgba) -> [u8; 3] {
    [
        (colour.0 >> 24) as u8,
        (colour.0 >> 16) as u8,
        (colour.0 >> 8) as u8,
    ]
}

/// One 8-bit sRGB channel to linear light.
fn lin(channel: u8) -> f64 {
    let c = f64::from(channel) / 255.0;
    if c <= 0.04045 {
        c / 12.92
    } else {
        ((c + 0.055) / 1.055).powf(2.4)
    }
}

/// Linear light back to the sRGB scale, for a value from 0 to 1.
fn unlin(v: f64) -> f64 {
    if v <= 0.0031308 {
        12.92 * v
    } else {
        1.055 * v.powf(1.0 / 2.4) - 0.055
    }
}

/// 8-bit sRGB to OKLab: `(L, C, h)`, with the hue in radians.
fn to_oklch(rgb: [u8; 3]) -> (f64, f64, f64) {
    let [r, g, b] = rgb.map(lin);
    let l = (0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b).cbrt();
    let m = (0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b).cbrt();
    let s = (0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b).cbrt();
    let lightness = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
    let a = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
    let bb = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
    (lightness, a.hypot(bb), bb.atan2(a))
}

/// OKLCH to linear sRGB; the values may fall outside 0 to 1.
fn to_linear(lightness: f64, chroma: f64, hue: f64) -> [f64; 3] {
    let a = chroma * hue.cos();
    let b = chroma * hue.sin();
    let l = (lightness + 0.3963377774 * a + 0.2158037573 * b).powi(3);
    let m = (lightness - 0.1055613458 * a - 0.0638541728 * b).powi(3);
    let s = (lightness - 0.0894841775 * a - 1.2914855480 * b).powi(3);
    [
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
    ]
}

/// OKLCH to an 8-bit sRGB colour; chroma is cut in 1% steps until it is in gamut.
fn to_rgb(lightness: f64, chroma: f64, hue: f64) -> [u8; 3] {
    let lightness = lightness.clamp(0.0, 1.0);
    let mut rgb = [0.0; 3];
    for k in 0..=100 {
        rgb = to_linear(lightness, chroma * f64::from(100 - k) / 100.0, hue);
        if rgb.iter().all(|v| (-0.0005..=1.0005).contains(v)) {
            break;
        }
    }
    rgb.map(|v| (unlin(v.clamp(0.0, 1.0)) * 255.0 + 0.5).floor() as u8)
}

/// The relative luminance of an 8-bit sRGB colour.
fn luminance(rgb: [u8; 3]) -> f64 {
    0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2])
}

/// The WCAG contrast ratio between two 8-bit sRGB colours.
fn contrast(x: [u8; 3], y: [u8; 3]) -> f64 {
    let (first, second) = (luminance(x), luminance(y));
    let (lighter, darker) = if first < second {
        (second, first)
    } else {
        (first, second)
    };
    (lighter + 0.05) / (darker + 0.05)
}

/// Move lightness in steps of 0.002 until the 8-bit colour reaches `target` on
/// every background and, when inks are given, until one of them reaches 4.5 on it.
fn ensure(
    lightness: f64,
    chroma: f64,
    hue: f64,
    against: &[[u8; 3]],
    target: f64,
    direction: f64,
    inks: Option<&[[u8; 3]]>,
) -> [u8; 3] {
    let mut rgb = [0; 3];
    for i in 0..=500 {
        rgb = to_rgb(lightness + direction * 0.002 * f64::from(i), chroma, hue);
        if against.iter().all(|bg| contrast(rgb, *bg) >= target)
            && inks.is_none_or(|inks| inks.iter().any(|ink| contrast(*ink, rgb) >= 4.5))
        {
            return rgb;
        }
    }
    rgb
}

/// A colour as `0xRRGGBBAA`.
fn rgba(rgb: [u8; 3], alpha: u8) -> Rgba {
    Rgba(
        u32::from(rgb[0]) << 24
            | u32::from(rgb[1]) << 16
            | u32::from(rgb[2]) << 8
            | u32::from(alpha),
    )
}

/// The 16 roles of `base` in `mode` at `intensity`; the alpha byte of `base` is ignored.
pub fn derive_palette(base: Rgba, mode: Mode, intensity: Intensity) -> Palette {
    let params: ModeParams = match mode {
        Mode::Dark => DARK,
        Mode::Light => LIGHT,
    };
    let direction = if mode == Mode::Dark { 1.0 } else { -1.0 };
    let (base_l, base_c, hue) = to_oklch(channels(base));
    let scale = (base_c / CHROMA_REFERENCE).min(1.0);
    let tint = match intensity {
        Intensity::Minimal => INTENSITY[0],
        Intensity::Balanced => INTENSITY[1],
        Intensity::Vibrant => INTENSITY[2],
    };

    let tinted = |pair: [f64; 2]| to_rgb(pair[0], pair[1] * scale * tint, hue);
    let ground = tinted(params.ground);
    let surface = tinted(params.surface);
    let fill = tinted(params.fill);
    let hairline = tinted(params.hairline);
    let surfaces = [ground, surface, fill];

    let ensure_neutral =
        |pair: [f64; 2], against: &[[u8; 3]], target: f64, inks: Option<&[[u8; 3]]>| {
            ensure(
                pair[0],
                pair[1] * scale,
                hue,
                against,
                target,
                direction,
                inks,
            )
        };
    let text = ensure_neutral(params.text, &surfaces, 4.5, None);
    let text_secondary = ensure_neutral(params.text_secondary, &surfaces, 4.5, None);
    let text_dim = ensure_neutral(params.text_dim, &surfaces[..2], 4.5, None);

    let [low, high] = params.accent_l;
    let accent_l = base_l.clamp(low, high);
    let ink = to_rgb(INK[0], INK[1] * scale, hue);
    let paper = to_rgb(PAPER[0], PAPER[1] * scale, hue);
    let accent = ensure(
        accent_l,
        base_c,
        hue,
        &surfaces[..2],
        3.0,
        direction,
        Some(&[ink, paper]),
    );
    let focus = ensure(accent_l, base_c, hue, &surfaces, 3.0, direction, None);
    let accent_text = ensure(
        accent_l,
        base_c,
        hue,
        &surfaces,
        ACCENT_TEXT_CONTRAST,
        direction,
        None,
    );
    let on = |background: [u8; 3]| {
        if contrast(ink, background) >= contrast(paper, background) {
            ink
        } else {
            paper
        }
    };
    let on_accent = on(accent);

    let status = |value: u32| {
        let rgb = [(value >> 16) as u8, (value >> 8) as u8, value as u8];
        let (lightness, chroma, hue) = to_oklch(rgb);
        ensure(
            lightness,
            chroma,
            hue,
            &surfaces,
            4.5,
            direction,
            Some(&[ink, paper]),
        )
    };
    let positive = status(STATUS[0]);
    let warning = status(STATUS[1]);
    let danger = status(STATUS[2]);
    let on_danger = on(danger);

    let [scrim_l, scrim_c, scrim_alpha] = params.scrim;
    let scrim_alpha = (scrim_alpha * 255.0 + 0.5).floor() as u8;

    Palette {
        ground: rgba(ground, 0xff),
        surface: rgba(surface, 0xff),
        fill: rgba(fill, 0xff),
        hairline: rgba(hairline, 0xff),
        text: rgba(text, 0xff),
        text_secondary: rgba(text_secondary, 0xff),
        text_dim: rgba(text_dim, 0xff),
        accent: rgba(accent, 0xff),
        on_accent: rgba(on_accent, 0xff),
        accent_text: rgba(accent_text, 0xff),
        focus: rgba(focus, 0xff),
        positive: rgba(positive, 0xff),
        warning: rgba(warning, 0xff),
        danger: rgba(danger, 0xff),
        on_danger: rgba(on_danger, 0xff),
        scrim: rgba(to_rgb(scrim_l, scrim_c * scale, hue), scrim_alpha),
    }
}
