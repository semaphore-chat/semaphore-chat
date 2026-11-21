//! The palette derivation for the apps: `semaphore-design`'s `derive_palette` over core's
//! appearance types, so a mobile client themes itself from the same Rust code as desktop
//! (design doc: derivation reaches mobile through the FFI, not a third implementation).
//!
//! A pure function of its arguments: it touches no core and no runtime, so it is a free
//! export rather than a `SemaphoreCore` method, and the `run`/`sync` rule does not apply.

use semaphore_core::model::{Rgb, ThemeIntensity, ThemeMode};
use semaphore_design::{Intensity, Mode, Rgba};

/// One mode's 16 colour roles, each packed `0xRRGGBBAA` (`design/gen/colour_ref.py`'s roles).
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Record)]
pub struct DerivedPalette {
    pub ground: u32,
    pub surface: u32,
    pub fill: u32,
    pub hairline: u32,
    pub text: u32,
    pub text_secondary: u32,
    pub text_dim: u32,
    pub accent: u32,
    pub on_accent: u32,
    pub accent_text: u32,
    pub focus: u32,
    pub positive: u32,
    pub warning: u32,
    pub danger: u32,
    pub on_danger: u32,
    pub scrim: u32,
}

/// The roles of `base` in `mode` at `intensity`, as the web's and desktop's themes derive them.
/// A client that follows the system's light or dark setting resolves `mode` itself first.
#[uniffi::export]
pub fn derive_palette(base: Rgb, mode: ThemeMode, intensity: ThemeIntensity) -> DerivedPalette {
    let base =
        Rgba(u32::from(base.r) << 24 | u32::from(base.g) << 16 | u32::from(base.b) << 8 | 0xFF);
    let mode = match mode {
        ThemeMode::Dark => Mode::Dark,
        ThemeMode::Light => Mode::Light,
    };
    let intensity = match intensity {
        ThemeIntensity::Minimal => Intensity::Minimal,
        ThemeIntensity::Balanced => Intensity::Balanced,
        ThemeIntensity::Vibrant => Intensity::Vibrant,
    };
    let p = semaphore_design::derive_palette(base, mode, intensity);
    DerivedPalette {
        ground: p.ground.0,
        surface: p.surface.0,
        fill: p.fill.0,
        hairline: p.hairline.0,
        text: p.text.0,
        text_secondary: p.text_secondary.0,
        text_dim: p.text_dim.0,
        accent: p.accent.0,
        on_accent: p.on_accent.0,
        accent_text: p.accent_text.0,
        focus: p.focus.0,
        positive: p.positive.0,
        warning: p.warning.0,
        danger: p.danger.0,
        on_danger: p.on_danger.0,
        scrim: p.scrim.0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `#rrggbb` or `#rrggbbaa` (the scrim) from the vectors, packed `0xRRGGBBAA`.
    fn packed(hex: &str) -> u32 {
        let digits = hex.trim_start_matches('#');
        let value = u32::from_str_radix(digits, 16).unwrap();
        if digits.len() == 6 {
            value << 8 | 0xFF
        } else {
            value
        }
    }

    /// Every case of the shared vectors, through the exported function and core's types.
    #[test]
    fn derive_palette_reproduces_every_shared_vector() {
        let vectors: serde_json::Value =
            serde_json::from_str(include_str!("../../../../design/vectors/colour.json")).unwrap();
        let cases = vectors.as_array().unwrap();
        assert_eq!(cases.len(), 96);
        for case in cases {
            let base = Rgb::parse(case["base"].as_str().unwrap()).unwrap();
            let mode = match case["mode"].as_str().unwrap() {
                "dark" => ThemeMode::Dark,
                "light" => ThemeMode::Light,
                other => panic!("mode {other}"),
            };
            let intensity = match case["intensity"].as_str().unwrap() {
                "minimal" => ThemeIntensity::Minimal,
                "balanced" => ThemeIntensity::Balanced,
                "vibrant" => ThemeIntensity::Vibrant,
                other => panic!("intensity {other}"),
            };
            let got = derive_palette(base, mode, intensity);
            let roles = &case["roles"];
            let role = |name: &str| packed(roles[name].as_str().unwrap());
            let want = DerivedPalette {
                ground: role("ground"),
                surface: role("surface"),
                fill: role("fill"),
                hairline: role("hairline"),
                text: role("text"),
                text_secondary: role("textSecondary"),
                text_dim: role("textDim"),
                accent: role("accent"),
                on_accent: role("onAccent"),
                accent_text: role("accentText"),
                focus: role("focus"),
                positive: role("positive"),
                warning: role("warning"),
                danger: role("danger"),
                on_danger: role("onDanger"),
                scrim: role("scrim"),
            };
            assert_eq!(got, want, "{case}");
        }
    }
}
