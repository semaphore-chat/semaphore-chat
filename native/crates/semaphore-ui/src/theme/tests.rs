use super::*;
use color::{contrast_ratio, token_of};
// `gpui_kit::*` brings GPUI's `test` attribute in too, and it would win.
use core::prelude::v1::test;

/// `hsv(hue, 1, 1)`, the edges of the hue circle, plus the grey axis and the two defaults.
fn bases() -> Vec<Token> {
    let mut bases: Vec<Token> = (0..360u32)
        .step_by(15)
        .map(|hue| {
            let step = hue % 60;
            let up = (step * 255 + 30) / 60;
            let down = ((60 - step) * 255 + 30) / 60;
            let (r, g, b) = match (hue / 60) % 6 {
                0 => (255, up, 0),
                1 => (down, 255, 0),
                2 => (0, 255, up),
                3 => (0, down, 255),
                4 => (up, 0, 255),
                _ => (255, 0, down),
            };
            Token(r << 24 | g << 16 | b << 8 | 0xff)
        })
        .collect();
    bases.extend([
        Token(0x000000ff),
        Token(0x808080ff),
        Token(0xffffffff),
        DEFAULT_BASE,
        Token(0x0d9488ff),
    ]);
    bases
}

fn every_input() -> Vec<ThemeInput> {
    let mut all = Vec::new();
    for base in bases() {
        for mode in Mode::ALL {
            for intensity in Intensity::ALL {
                all.push(ThemeInput::new(base, mode, intensity));
            }
        }
    }
    all
}

#[test]
fn the_default_is_the_design_default() {
    let input = ThemeInput::default();
    assert_eq!(input.base, Token(0x8e75ffff));
    assert_eq!(input.mode, Mode::Dark);
    assert_eq!(input.intensity, Intensity::Minimal);
    assert_eq!(input.name(), "dark-minimal-8e75ff");
}

#[test]
fn names_round_trip() {
    for input in every_input() {
        assert_eq!(
            ThemeInput::parse(&input.name()),
            Some(input),
            "{}",
            input.name()
        );
    }
}

#[test]
fn old_accent_names_read_as_the_accents_primary() {
    let teal = ThemeInput::parse("dark-teal-minimal").unwrap();
    assert_eq!(
        teal,
        ThemeInput::new(Token(0x0d9488ff), Mode::Dark, Intensity::Minimal)
    );
    let blue = ThemeInput::parse("light-blue-vibrant").unwrap();
    assert_eq!(
        blue,
        ThemeInput::new(Token(0x3b82f6ff), Mode::Light, Intensity::Vibrant)
    );
    for accent in AccentColor::ALL {
        let name = format!("dark-{}-balanced", accent.name());
        let input = ThemeInput::parse(&name).unwrap();
        assert_eq!(
            format!("#{:06x}", input.base.0 >> 8),
            accent.primary().to_hex()
        );
    }
}

#[test]
fn bad_names_are_refused() {
    for name in [
        "",
        "dark",
        "dark-minimal",
        "dark-mauve-minimal",
        "dusk-minimal-8e75ff",
        "dark-loud-8e75ff",
        "dark-minimal-8e75f",
        "dark-minimal-8e75fff",
        "dark-minimal-8E75FF",
        "dark-minimal-8e75fg",
        "dark-minimal-#8e75f",
        "dark-teal-minimal-extra",
    ] {
        assert_eq!(ThemeInput::parse(name), None, "{name:?}");
    }
}

#[test]
fn a_base_is_always_opaque() {
    let input = ThemeInput::new(Token(0x8e75ff00), Mode::Dark, Intensity::Minimal);
    assert_eq!(input.base, DEFAULT_BASE);
}

#[test]
fn sem_holds_the_derived_roles() {
    for input in every_input() {
        let sem = Sem::new(input);
        let derived = derive_palette(input.base, input.mode, input.intensity);
        assert_eq!(sem.roles, derived);
        let gpui = [
            sem.role.ground,
            sem.role.surface,
            sem.role.fill,
            sem.role.hairline,
            sem.role.text,
            sem.role.text_secondary,
            sem.role.text_dim,
            sem.role.accent,
            sem.role.on_accent,
            sem.role.accent_text,
            sem.role.focus,
            sem.role.positive,
            sem.role.warning,
            sem.role.danger,
            sem.role.on_danger,
            sem.role.scrim,
        ];
        for ((colour, role), name) in derived.roles().into_iter().zip(gpui).zip(ROLE_NAMES) {
            assert_eq!(token_of(role), colour, "{name} in {}", input.name());
        }
        assert_eq!(sem.is_dark, input.mode == Mode::Dark);
    }
}

#[test]
fn the_old_names_map_onto_the_roles() {
    // The table in native/docs/theme.md, after the web's createLoungeTheme.
    let sem = Sem::new(ThemeInput::new(
        Token(0x3b82f6ff),
        Mode::Light,
        Intensity::Balanced,
    ));
    let r = sem.role;
    let pairs = [
        ("background_default", sem.background_default, r.ground),
        ("paper", sem.paper, r.surface),
        ("divider", sem.divider, r.hairline),
        ("paper_border", sem.paper_border, r.hairline),
        ("input_border", sem.input_border, r.hairline),
        ("input_border_focused", sem.input_border_focused, r.focus),
        ("text_primary", sem.text_primary, r.text),
        ("text_secondary", sem.text_secondary, r.text_secondary),
        ("text_disabled", sem.text_disabled, r.text_dim),
        ("primary", sem.primary, r.accent),
        ("primary_contrast", sem.primary_contrast, r.on_accent),
        ("link", sem.link, r.accent_text),
        ("tab_selected", sem.tab_selected, r.accent_text),
        ("error", sem.error, r.danger),
        ("negative", sem.negative, r.danger),
        ("warning", sem.warning, r.warning),
        ("success", sem.success, r.positive),
        ("positive", sem.positive, r.positive),
        ("chip_bg", sem.chip_bg, r.fill),
        ("chip_text", sem.chip_text, r.text),
        ("app_bar_text", sem.app_bar_text, r.text),
    ];
    for (name, old, role) in pairs {
        assert_eq!(old, role, "{name}");
    }
    assert_eq!(sem.contained, Paint::Solid(r.accent));
    assert_eq!(sem.body, Paint::Solid(r.ground));
    assert_eq!(sem.drawer, Paint::Solid(r.surface));
    assert_eq!(sem.app_bar, Paint::Solid(r.surface));
    assert_eq!(
        sem.list_selected,
        hsla_of(alpha(sem.roles.accent, STATE_HOVER_ON_FILL))
    );
    assert_eq!(sem.palette.error_contrast_text, sem.roles.on_danger);
    assert_eq!(sem.palette.background_paper, sem.roles.surface);
    assert_eq!(sem.palette.warning_contrast_text, sem.roles.surface);
    let dark = Sem::new(ThemeInput::default());
    assert_eq!(dark.palette.warning_contrast_text, dark.roles.ground);
}

/// `colour` composited over `under`, for a translucent tint.
fn over(colour: Hsla, under: Token) -> Token {
    let token = token_of(colour);
    let a = (token.0 & 0xff) as f32 / 255.;
    blend(Token(token.0 | 0xff), under, a)
}

#[test]
fn text_on_the_old_names_stays_readable_for_every_base() {
    for input in every_input() {
        let sem = Sem::new(input);
        let p = sem.palette;
        let check = |what: &str, text: Token, on: Token, target: f32| {
            let ratio = contrast_ratio(text, on);
            assert!(
                ratio >= target,
                "{}: {what} is {ratio:.2}:1, need {target}:1",
                input.name()
            );
        };
        let surface = sem.roles.surface;
        let ground = sem.roles.ground;
        let t = token_of;
        for under in [surface, ground] {
            check(
                "text on a selected row",
                t(sem.text_primary),
                over(sem.list_selected, under),
                4.5,
            );
            check(
                "text on a hovered selected row",
                t(sem.text_primary),
                over(sem.list_selected_hover, under),
                4.5,
            );
            check(
                "text on a hovered row",
                t(sem.text_primary),
                over(sem.list_hover, under),
                4.5,
            );
            check(
                "secondary text on a hovered row",
                t(sem.text_secondary),
                over(sem.action_hover, under),
                4.5,
            );
            check(
                "text on overlay_heavy",
                t(sem.text_primary),
                over(sem.overlay_heavy, under),
                4.5,
            );
        }
        check(
            "label on the accent button",
            t(sem.primary_contrast),
            t(sem.contained.color()),
            4.5,
        );
        // The kit's hover (text mixed into the accent at `state.hoverOnFill`, as the web's
        // `buttonLook`) darkens a light-mode accent towards a dark label: 3.5:1 at worst (pure red).
        // The resting label is held to 4.5:1 above; the hover to large-text contrast.
        check(
            "label on the hovered accent button",
            t(sem.primary_contrast),
            t(sem.contained_hover.color()),
            3.0,
        );
        check("chip text", t(sem.chip_text), t(sem.chip_bg), 4.5);
        check(
            "chip text, hovered",
            t(sem.chip_text),
            t(sem.chip_hover),
            4.5,
        );
        check(
            "snackbar text",
            t(sem.snackbar_text),
            t(sem.snackbar_bg),
            4.5,
        );
        // What `Tip`, the player's card tip and the reaction tooltip draw.
        check("tooltip text", t(sem.tooltip_text), t(sem.tooltip_bg), 4.5);
        check("on error", p.error_contrast_text, p.error_main, 4.5);
        check("on warning", p.warning_contrast_text, p.warning_main, 4.5);
        check("on success", p.success_contrast_text, p.success_main, 4.5);
        check(
            "on secondary",
            p.secondary_contrast_text,
            p.secondary_main,
            4.5,
        );
        check("on info", p.info_contrast_text, sem.roles.accent, 4.5);
        check("primary_light on paper", p.primary_light, surface, 4.5);
    }
}

/// The Windows-platform (3) English (0x409) record `name_id` of a TrueType file's name table,
/// decoded from UTF-16BE.
fn font_name(bytes: &[u8], name_id: u16) -> Option<String> {
    let u16_at = |at: usize| u16::from_be_bytes([bytes[at], bytes[at + 1]]);
    let u32_at =
        |at: usize| u32::from_be_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]]);
    let tables = usize::from(u16_at(4));
    let name = (0..tables)
        .map(|index| 12 + index * 16)
        .find(|record| &bytes[*record..*record + 4] == b"name")?;
    let table = u32_at(name + 8) as usize;
    let count = usize::from(u16_at(table + 2));
    let strings = table + usize::from(u16_at(table + 4));
    (0..count)
        .map(|index| table + 6 + index * 12)
        .find_map(|record| {
            let (platform, language, id) = (u16_at(record), u16_at(record + 4), u16_at(record + 6));
            if platform != 3 || language != 0x409 || id != name_id {
                return None;
            }
            let length = usize::from(u16_at(record + 8));
            let start = strings + usize::from(u16_at(record + 10));
            let units: Vec<u16> = bytes[start..start + length]
                .as_chunks::<2>()
                .0
                .iter()
                .map(|pair| u16::from_be_bytes(*pair))
                .collect();
            String::from_utf16(&units).ok()
        })
}

#[test]
fn the_bundled_fonts_are_truetype_named_as_the_tokens() {
    // The test platform's text system registers nothing, so this reads the files GPUI is handed:
    // TrueType, with the family GPUI looks up (`font.body`, `font.heading`) in name IDs 1 and 16,
    // exactly, and the style in 2 and 17.
    assert_eq!(FONT_FAMILY, "Figtree");
    assert_eq!(HEADING_FONT_FAMILY, "Bricolage Grotesque");
    let faces = [
        (FONT_FAMILY, "Regular", "Regular"),
        (FONT_FAMILY, "Italic", "Italic"),
        (FONT_FAMILY, "Regular", "Medium"),
        (FONT_FAMILY, "Regular", "SemiBold"),
        (HEADING_FONT_FAMILY, "Regular", "SemiBold"),
        (HEADING_FONT_FAMILY, "Bold", "Bold"),
    ];
    for (index, (bytes, (family, subfamily, style))) in FONTS.iter().zip(faces).enumerate() {
        assert_eq!(bytes[..4], [0, 1, 0, 0], "font {index} is not TrueType");
        assert_eq!(
            font_name(bytes, 1).as_deref(),
            Some(family),
            "font {index}: name ID 1"
        );
        assert_eq!(
            font_name(bytes, 16).as_deref(),
            Some(family),
            "font {index}: name ID 16"
        );
        assert_eq!(
            font_name(bytes, 2).as_deref(),
            Some(subfamily),
            "font {index}: name ID 2"
        );
        assert_eq!(
            font_name(bytes, 17).as_deref(),
            Some(style),
            "font {index}: name ID 17"
        );
    }
}

#[test]
fn a_window_appearance_maps_to_a_mode() {
    // GPUI's Linux platform (patched, `third_party/patches/gpui-pre-linux.patch`) reports Dark when
    // the Settings portal is missing or has no preference, so "Match system" gives dark there.
    assert_eq!(mode_of(WindowAppearance::Dark), Mode::Dark);
    assert_eq!(mode_of(WindowAppearance::VibrantDark), Mode::Dark);
    assert_eq!(mode_of(WindowAppearance::Light), Mode::Light);
    assert_eq!(mode_of(WindowAppearance::VibrantLight), Mode::Light);
}

#[test]
fn every_preset_draws_its_on_colours_readably() {
    // Each pairing a kit piece or an old screen draws on a role, for every colour the Appearance
    // tab offers, in both modes and all intensities: 4.5:1 for text, 3:1 for icons.
    for (base, name) in crate::settings::base_presets() {
        let packed = Token(
            u32::from(base.r) << 24 | u32::from(base.g) << 16 | u32::from(base.b) << 8 | 0xff,
        );
        for mode in Mode::ALL {
            for intensity in Intensity::ALL {
                let sem = Sem::new(ThemeInput::new(packed, mode, intensity));
                let p = sem.palette;
                let t = token_of;
                let check = |what: &str, ink: Token, on: Token, target: f32| {
                    let ratio = contrast_ratio(ink, on);
                    assert!(
                        ratio >= target,
                        "{name} {mode:?} {intensity:?}: {what} is {ratio:.2}:1, need {target}:1"
                    );
                };
                // Text.
                check(
                    "pinned-count digit on the accent",
                    t(sem.primary_contrast),
                    t(sem.primary),
                    4.5,
                );
                check(
                    "error count on danger",
                    p.error_contrast_text,
                    p.error_main,
                    4.5,
                );
                check(
                    "avatar initials on fill",
                    t(sem.role.text),
                    t(sem.role.fill),
                    4.5,
                );
                check("tooltip text", t(sem.tooltip_text), t(sem.tooltip_bg), 4.5);
                for (surface, on) in [("surface", sem.roles.surface), ("ground", sem.roles.ground)]
                {
                    check(&format!("accent text on {surface}"), t(sem.link), on, 4.5);
                    check(
                        &format!("accent text on a selected row on {surface}"),
                        t(sem.link),
                        over(sem.list_selected, on),
                        4.5,
                    );
                }
                // Icons.
                check(
                    "muted icon on danger",
                    p.error_contrast_text,
                    p.error_main,
                    3.0,
                );
                check(
                    "voice icon on positive",
                    p.success_contrast_text,
                    p.success_main,
                    3.0,
                );
                check(
                    "unread kind icon on the accent",
                    t(sem.primary_contrast),
                    t(sem.primary),
                    3.0,
                );
                check(
                    "read kind icon on fill",
                    t(sem.text_secondary),
                    t(sem.chip_bg),
                    3.0,
                );
            }
        }
    }
}
