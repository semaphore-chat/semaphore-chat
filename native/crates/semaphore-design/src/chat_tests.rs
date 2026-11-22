//! The chat rules against the web kit's own cases (`frontend/src/__tests__/kit/*`), plus the
//! edges the port adds.

use crate::chat::*;

#[test]
fn bidi_controls_are_stripped_and_nothing_else() {
    assert_eq!(strip_bidi("a\u{202E}b\u{2066}c\u{200F}d\u{061C}"), "abcd");
    for c in [
        '\u{200E}', '\u{202A}', '\u{202B}', '\u{202C}', '\u{202D}', '\u{2067}', '\u{2068}',
        '\u{2069}',
    ] {
        assert_eq!(strip_bidi(&format!("x{c}y")), "xy", "{c:?} kept");
    }
    // Not bidi controls: a zero-width space, a joiner, Arabic letters.
    assert_eq!(
        strip_bidi("a\u{200B}b\u{200D}مرحبا"),
        "a\u{200B}b\u{200D}مرحبا"
    );
    assert_eq!(strip_bidi(""), "");
}

#[test]
fn a_mention_is_followed_only_to_an_app_internal_address() {
    for href in [
        "data:text/html,x",
        "//evil.example/c",
        "/\\evil.example",
        "/\t/evil.example",
        "javascript:alert(1)",
        "https://evil.example/c",
        "c/clips",
        " /c",
        "/.//evil.example",
        "/..//evil.example",
        "/a/../b",
        "/a/./b",
        "/%2e%2E/b",
        "/%2E/b",
        "/c//clips",
        "#/c/../x",
        "#//evil.example",
        "#c/clips",
        "#",
        "",
        "/c\n",
        "/c\u{7f}",
        "/.",
        "/..",
    ] {
        assert_eq!(internal_href(href), None, "{href:?} followed");
    }
    for href in [
        "/c/clips",
        "#/c/clips",
        "/c/clips?from=a//b",
        "/c/clips#a//b",
        "/",
        "#/",
        "/a/.../b",
        "/a/.b",
        "/%2e%2e%2e",
    ] {
        assert_eq!(internal_href(href), Some(href), "{href:?} refused");
    }
}

#[test]
fn reaction_counts_are_in_full_to_999_then_compact() {
    assert_eq!(drawn_reaction_count(0), "0");
    assert_eq!(drawn_reaction_count(4), "4");
    assert_eq!(drawn_reaction_count(999), "999");
    assert_eq!(drawn_reaction_count(1000), "1K");
    assert_eq!(drawn_reaction_count(1049), "1K");
    assert_eq!(drawn_reaction_count(1050), "1.1K");
    assert_eq!(drawn_reaction_count(1250), "1.3K");
    assert_eq!(drawn_reaction_count(48213), "48.2K");
    assert_eq!(drawn_reaction_count(123_456), "123.5K");
    assert_eq!(drawn_reaction_count(999_949), "999.9K");
    assert_eq!(drawn_reaction_count(999_950), "1M");
    assert_eq!(drawn_reaction_count(999_999), "1M");
    assert_eq!(drawn_reaction_count(1_500_000), "1.5M");
    assert_eq!(drawn_reaction_count(2_000_000_000), "2B");
    assert_eq!(drawn_reaction_count(3_400_000_000_000), "3.4T");
    // Past the last unit it stays in that unit.
    assert_eq!(drawn_reaction_count(5_000_000_000_000_000), "5000T");
    assert_eq!(drawn_reaction_count(u64::MAX), "18446744.1T");
}

#[test]
fn a_count_is_whole_and_never_negative() {
    assert_eq!(whole_count(-3.), 0);
    assert_eq!(whole_count(f64::NAN), 0);
    assert_eq!(whole_count(f64::INFINITY), 0);
    assert_eq!(whole_count(f64::NEG_INFINITY), 0);
    assert_eq!(whole_count(4.9), 4);
    assert_eq!(whole_count(0.), 0);
    assert_eq!(reaction_name("Laugh", 4), "Laugh reaction, 4");
    assert_eq!(reaction_name("Fire", 1250), "Fire reaction, 1250");
}

#[test]
fn typing_text_names_one_two_or_the_first_and_the_others() {
    assert_eq!(typing_text::<&str>(&[]), "");
    assert_eq!(typing_text(&["aiko"]), "aiko is typing…");
    assert_eq!(
        typing_text(&["aiko", "dropbear"]),
        "aiko and dropbear are typing…"
    );
    assert_eq!(
        typing_text(&["aiko", "dropbear", "gracie"]),
        "aiko and 2 others are typing…"
    );
    assert_eq!(
        typing_text(&["aiko", "dropbear", "gracie", "kwam3"]),
        "aiko and 3 others are typing…"
    );
    assert_eq!(TYPING_LINE_HEIGHT, 32.);
}

#[test]
fn jump_text_counts_new_messages_up_to_99() {
    let plain = jump_text(0);
    assert_eq!(
        (plain.text.as_str(), plain.name.as_str(), plain.counted),
        ("Jump to latest", "Jump to latest", false)
    );
    let one = jump_text(1);
    assert_eq!(
        (one.text.as_str(), one.name.as_str()),
        ("1 new", "Jump to latest, 1 new message")
    );
    let three = jump_text(3);
    assert_eq!(
        (three.text.as_str(), three.name.as_str(), three.counted),
        ("3 new", "Jump to latest, 3 new messages", true)
    );
    assert_eq!(jump_text(99).text, "99 new");
    let many = jump_text(240);
    assert_eq!(
        (many.text.as_str(), many.name.as_str()),
        ("99+ new", "Jump to latest, 99+ new messages")
    );
}

fn sized(w: f64, h: f64) -> (f32, f32) {
    let b = image_box(Some(w), Some(h));
    (b.width, b.height)
}

#[test]
fn an_image_box_keeps_a_small_size_and_shrinks_a_big_one() {
    assert_eq!(sized(200., 100.), (200., 100.));
    assert_eq!(sized(1600., 900.), (320., 180.));
    assert_eq!(sized(600., 1200.), (120., 240.));
    assert_eq!(sized(320., 240.), (320., 240.));
    // Rounded as JavaScript rounds: 333×250 scales by 0.96 to 319.68×240.
    assert_eq!(sized(333., 250.), (320., 240.));
    assert_eq!(sized(201.5, 100.), (202., 100.));
}

#[test]
fn an_image_box_never_has_a_side_under_48() {
    assert_eq!(sized(4000., 10.), (320., 48.));
    assert_eq!(sized(10., 4000.), (48., 240.));
    assert_eq!(sized(10000., 1.), (320., 48.));
    assert_eq!(sized(20., 20.), (48., 48.));
    assert_eq!(sized(0.4, 0.4), (48., 48.));
}

#[test]
fn an_unknown_size_gets_the_fallback_box() {
    assert_eq!(image_box(None, None), IMAGE_FALLBACK);
    assert_eq!(image_box(Some(100.), None), IMAGE_FALLBACK);
    assert_eq!(image_box(None, Some(100.)), IMAGE_FALLBACK);
    assert_eq!(image_box(Some(0.), Some(100.)), IMAGE_FALLBACK);
    assert_eq!(image_box(Some(-5.), Some(100.)), IMAGE_FALLBACK);
    assert_eq!(image_box(Some(f64::NAN), Some(100.)), IMAGE_FALLBACK);
    assert_eq!(image_box(Some(f64::INFINITY), Some(100.)), IMAGE_FALLBACK);
    assert_eq!(
        IMAGE_FALLBACK,
        BoxSize {
            width: 240.,
            height: 160.
        }
    );
}
