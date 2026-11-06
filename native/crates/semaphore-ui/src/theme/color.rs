//! The colour maths `themeConfig.ts` uses, on `semaphore-design`'s packed `0xRRGGBBAA`.

use gpui_kit::{Hsla, rgba};
use semaphore_design::Rgba as Token;

fn channels(color: Token) -> (u8, u8, u8, u8) {
    let [r, g, b, a] = color.0.to_be_bytes();
    (r, g, b, a)
}

pub fn hsla_of(color: Token) -> Hsla {
    Hsla::from(rgba(color.0))
}

/// For tests: back from an `Hsla` to the nearest packed colour.
#[cfg(test)]
pub fn token_of(color: Hsla) -> Token {
    let rgba = gpui_kit::Rgba::from(color);
    let byte = |value: f32| (value * 255.).round() as u32;
    Token(byte(rgba.r) << 24 | byte(rgba.g) << 16 | byte(rgba.b) << 8 | byte(rgba.a))
}

/// `#rrggbb`, fully opaque. Only for the literals `themeConfig.ts` itself writes.
pub fn parse_hex(hex: &str) -> Token {
    let value = u32::from_str_radix(hex.trim_start_matches('#'), 16).expect("a #rrggbb literal");
    Token(value << 8 | 0xff)
}

/// MUI's `alpha`: replaces the alpha channel.
pub fn alpha(color: Token, value: f32) -> Token {
    let byte = (value * 255.).round() as u32;
    Token(color.0 & 0xffffff00 | byte)
}

/// `blendColors`: `one` at `weight`, `other` at `1 - weight`, opaque.
pub fn blend(one: Token, other: Token, weight: f32) -> Token {
    let (r1, g1, b1, _) = channels(one);
    let (r2, g2, b2, _) = channels(other);
    let mix = |a: u8, b: u8| (a as f32 * weight + b as f32 * (1. - weight)).round() as u32;
    Token(mix(r1, r2) << 24 | mix(g1, g2) << 16 | mix(b1, b2) << 8 | 0xff)
}

fn luminance(color: Token) -> f32 {
    let (r, g, b, _) = channels(color);
    let linear = |value: u8| {
        let value = value as f32 / 255.;
        if value <= 0.03928 {
            value / 12.92
        } else {
            ((value + 0.055) / 1.055).powf(2.4)
        }
    };
    0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

/// MUI's `getContrastRatio`. Alpha is ignored, as MUI's own does for its opaque inputs.
pub fn contrast_ratio(one: Token, other: Token) -> f32 {
    let (a, b) = (luminance(one), luminance(other));
    (a.max(b) + 0.05) / (a.min(b) + 0.05)
}

/// `readableTextColor` at the WCAG AA text ratio: `preferred`, or mixed towards `towards` in 5%
/// steps until it reads on every backdrop.
pub fn readable_text_color(preferred: Token, backdrops: &[Token], towards: Token) -> Token {
    const MIN_RATIO: f32 = 4.5;
    for step in 0..=20 {
        let candidate = if step == 0 {
            preferred
        } else {
            blend(towards, preferred, step as f32 / 20.)
        };
        if backdrops
            .iter()
            .all(|backdrop| contrast_ratio(candidate, *backdrop) >= MIN_RATIO)
        {
            return candidate;
        }
    }
    towards
}

/// MUI's `darken`, for the standard Alert's dark-mode background.
pub fn darken(color: Token, coefficient: f32) -> Token {
    let (r, g, b, a) = channels(color);
    let scale = |value: u8| (value as f32 * (1. - coefficient)).round() as u32;
    Token(scale(r) << 24 | scale(g) << 16 | scale(b) << 8 | a as u32)
}

/// MUI's `lighten`, for the standard Alert's light-mode background.
pub fn lighten(color: Token, coefficient: f32) -> Token {
    let (r, g, b, a) = channels(color);
    let scale = |value: u8| (value as f32 + (255. - value as f32) * coefficient).round() as u32;
    Token(scale(r) << 24 | scale(g) << 16 | scale(b) << 8 | a as u32)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blend_matches_the_web_on_a_known_paper() {
        // tokens.json: dark-teal-balanced paper is #19292e, primary #0d9488 at 0.1 over #1a1d24.
        assert_eq!(
            blend(parse_hex("#0d9488"), parse_hex("#1a1d24"), 0.1),
            parse_hex("#19292e")
        );
    }

    #[test]
    fn alpha_rounds_to_the_nearest_step() {
        assert_eq!(alpha(parse_hex("#3b82f6"), 0.18), Token(0x3b82f62e));
    }

    #[test]
    fn contrast_of_black_on_white_is_21() {
        let ratio = contrast_ratio(parse_hex("#000000"), parse_hex("#ffffff"));
        assert!((ratio - 21.).abs() < 0.01, "{ratio}");
    }
}
