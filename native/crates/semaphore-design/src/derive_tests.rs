//! Tests for the palette derivation.
//!
//! `design/vectors/colour.json`, generated from `design/gen/colour_ref.py`, is
//! the definition of the algorithm: these tests hold the port to it.

use crate::colour_vectors::VECTORS;
use crate::derive::{contrast_ratio, derive_palette, parse_base};
use crate::{Intensity, Mode, Rgba};

#[test]
fn derive_reproduces_every_shared_vector() {
    assert_eq!(VECTORS.len(), 96);
    for (base, mode, intensity, roles) in VECTORS {
        let got = derive_palette(parse_base(base).unwrap(), *mode, *intensity)
            .roles()
            .map(|c| c.0);
        assert_eq!(&got, roles, "{base} {mode:?} {intensity:?}");
    }
}

#[test]
fn derive_default_is_the_approved_palette() {
    let p = derive_palette(Rgba(0x8E75FFFF), Mode::Dark, Intensity::Minimal);
    assert_eq!(
        (
            p.ground.0,
            p.surface.0,
            p.accent.0,
            p.accent_text.0,
            p.scrim.0
        ),
        (0x121214FF, 0x1B1B1FFF, 0x8E75FFFF, 0xAFA5FEFF, 0x09081199)
    );
}

#[test]
fn derive_parse_base_accepts_only_rrggbb() {
    assert_eq!(parse_base("#8e75ff"), Some(Rgba(0x8E75FFFF)));
    assert_eq!(parse_base("#8E75FF"), Some(Rgba(0x8E75FFFF)));
    for bad in [
        "",
        "#fff",
        "red",
        "#8E75FF00",
        "8E75FF",
        "#8E75FG",
        "#8E75FF ",
        " #8E75FF",
        "#8E75Fé",
        "#€5FF",
    ] {
        assert_eq!(parse_base(bad), None, "{bad}");
    }
}

#[test]
fn derive_ignores_base_alpha() {
    assert_eq!(
        derive_palette(Rgba(0x8E75FF00), Mode::Light, Intensity::Vibrant),
        derive_palette(Rgba(0x8E75FFFF), Mode::Light, Intensity::Vibrant)
    );
}

/// `hsv(hue / 360, 1, 1)` as `#rrggbb`: the six-sector formula at full saturation
/// and value, in integer arithmetic (the two non-maximal channels are `0` and a
/// 0-to-255 ramp).
fn full_hue_hex(hue: u32) -> String {
    let sector = (hue / 60) % 6;
    let step = hue % 60;
    let up = (step * 255 + 30) / 60;
    let down = ((60 - step) * 255 + 30) / 60;
    let (r, g, b) = match sector {
        0 => (255, up, 0),
        1 => (down, 255, 0),
        2 => (0, 255, up),
        3 => (0, down, 255),
        4 => (up, 0, 255),
        _ => (255, 0, down),
    };
    format!("#{r:02x}{g:02x}{b:02x}")
}

#[test]
fn derive_keeps_text_readable_for_every_hue() {
    // 36 hues at full saturation built with integer maths (the six-sector HSV formula),
    // both modes, all intensities: the Review Focus item 3 rules with contrast_ratio.
    for base in (0..360).step_by(10).map(full_hue_hex) {
        let parsed = parse_base(&base).unwrap();
        for mode in [Mode::Dark, Mode::Light] {
            for intensity in [Intensity::Minimal, Intensity::Balanced, Intensity::Vibrant] {
                let palette = derive_palette(parsed, mode, intensity);
                let surfaces = [
                    ("ground", palette.ground),
                    ("surface", palette.surface),
                    ("fill", palette.fill),
                ];
                let check = |role: &str, value: Rgba, background: &str, bg: Rgba, target: f64| {
                    let got = contrast_ratio(value, bg);
                    assert!(
                        got >= target,
                        "{base} {mode:?} {intensity:?}: {role} {value:?} on \
                         {background} {bg:?} is {got:.3}:1, need {target}:1"
                    );
                };
                for (role, value) in [
                    ("text", palette.text),
                    ("textSecondary", palette.text_secondary),
                    ("accentText", palette.accent_text),
                    ("positive", palette.positive),
                    ("warning", palette.warning),
                    ("danger", palette.danger),
                ] {
                    for (background, bg) in surfaces {
                        check(role, value, background, bg, 4.5);
                    }
                }
                for (background, bg) in &surfaces[..2] {
                    check("textDim", palette.text_dim, background, *bg, 4.5);
                    check("accent", palette.accent, background, *bg, 3.0);
                }
                check("onAccent", palette.on_accent, "accent", palette.accent, 4.5);
                check("onDanger", palette.on_danger, "danger", palette.danger, 4.5);
            }
        }
    }
}
