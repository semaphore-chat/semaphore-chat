//! `person_colour` against the shared vectors, and the readable-ink search's contrast promise.

use crate::colour_params::PEOPLE;
use crate::derive::contrast_ratio;
use crate::people::{fnv1a32, person_colour, readable_background};
use crate::{Intensity, Mode, Rgba, derive_palette, parse_base};

/// The shared vectors, as the web's `personColourVectors.ts` copies them.
const VECTORS: &str = include_str!("../../../../design/vectors/person-colour.json");

struct Vector {
    id: String,
    hash: u32,
    colour: Option<Rgba>,
}

/// The value of `"key": ...` in one vector object: a string's contents, or the bare token. The
/// file is generated with no escapes in it (the test checks), so a string ends at the next quote.
fn field<'a>(object: &'a str, key: &str) -> &'a str {
    let at = object
        .find(&format!("\"{key}\":"))
        .unwrap_or_else(|| panic!("no {key} in {object}"));
    let rest = object[at + key.len() + 3..].trim_start();
    match rest.strip_prefix('"') {
        Some(string) => &string[..string.find('"').expect("closing quote")],
        None => rest.split([',', '\n', '}']).next().expect("a value").trim(),
    }
}

fn vectors() -> Vec<Vector> {
    assert!(!VECTORS.contains('\\'), "the parser here takes no escapes");
    VECTORS
        .split('{')
        .skip(1)
        .map(|object| {
            let object = &object[..object.find('}').expect("closing brace")];
            let colour = field(object, "colour");
            Vector {
                id: field(object, "id").to_owned(),
                hash: u32::from_str_radix(field(object, "fnv1a32").trim_start_matches("0x"), 16)
                    .expect("a hex hash"),
                colour: (colour != "null").then(|| parse_base(colour).expect("#rrggbb")),
            }
        })
        .collect()
}

#[test]
fn person_colour_matches_every_shared_vector() {
    let vectors = vectors();
    assert!(vectors.len() >= 30, "read {} vectors", vectors.len());
    assert!(
        vectors.iter().any(|v| v.id == "😀"),
        "the non-ASCII ids are read"
    );
    for vector in &vectors {
        assert_eq!(
            fnv1a32(vector.id.as_bytes()),
            vector.hash,
            "{:?}",
            vector.id
        );
        assert_eq!(
            person_colour(Some(&vector.id)),
            vector.colour,
            "{:?}",
            vector.id
        );
    }
}

#[test]
fn no_id_keeps_the_neutral_fill() {
    assert_eq!(person_colour(None), None);
    assert_eq!(person_colour(Some("")), None);
}

#[test]
fn ids_are_hashed_as_given_not_folded() {
    // UUIDs in either case land on the same colour by chance in the vectors; "a" and "A" do not.
    assert_ne!(person_colour(Some("a")), person_colour(Some("A")));
}

fn inks(base: u32, mode: Mode, intensity: Intensity) -> [Rgba; 2] {
    let palette = derive_palette(Rgba(base << 8 | 0xff), mode, intensity);
    [palette.ground, palette.text]
}

const SWEEP: [u8; 8] = [0, 51, 102, 119, 128, 153, 204, 255];

fn sweep() -> impl Iterator<Item = Rgba> {
    SWEEP.into_iter().flat_map(|r| {
        SWEEP.into_iter().flat_map(move |g| {
            SWEEP.into_iter().map(move |b| {
                Rgba(u32::from(r) << 24 | u32::from(g) << 16 | u32::from(b) << 8 | 0xff)
            })
        })
    })
}

#[test]
fn every_sweep_colour_reaches_4_5_with_the_default_palette() {
    for mode in Mode::ALL {
        let inks = inks(0x8e75ff, mode, Intensity::Minimal);
        for colour in sweep() {
            let found = readable_background(colour, inks)
                .unwrap_or_else(|| panic!("{colour:?} in {mode:?} has no readable colour"));
            assert!(inks.contains(&found.ink), "{colour:?}: one of the two inks");
            assert!(
                contrast_ratio(found.ink, found.background) >= 4.5,
                "{colour:?} in {mode:?}: {found:?}"
            );
        }
    }
}

#[test]
fn a_tinted_palette_never_gets_a_failing_colour() {
    for mode in Mode::ALL {
        let inks = inks(0x0d9488, mode, Intensity::Vibrant);
        for colour in sweep() {
            if let Some(found) = readable_background(colour, inks) {
                assert!(
                    contrast_ratio(found.ink, found.background) >= 4.5,
                    "{colour:?}"
                );
            }
        }
        for colour in [0xffffff, 0x000000, 0x777777, 0xff0000, 0x00ff00, 0x0000ff] {
            assert!(
                readable_background(Rgba(colour << 8 | 0xff), inks).is_some(),
                "{colour:06x} in {mode:?}"
            );
        }
    }
}

#[test]
fn two_near_identical_inks_give_none_or_a_passing_colour() {
    let inks = [Rgba(0x777777ff), Rgba(0x7a7a7aff)];
    for colour in [0x777777, 0xffffff, 0x000000, 0xff0000] {
        if let Some(found) = readable_background(Rgba(colour << 8 | 0xff), inks) {
            assert!(contrast_ratio(found.ink, found.background) >= 4.5);
        }
    }
}

#[test]
fn every_person_colour_reads_unchanged_with_the_darker_ink() {
    for colour in PEOPLE {
        let colour = Rgba(colour << 8 | 0xff);
        for mode in Mode::ALL {
            let inks = inks(0x8e75ff, mode, Intensity::Minimal);
            let found = readable_background(colour, inks).expect("readable");
            assert_eq!(
                found.background, colour,
                "{colour:?} is not nudged in {mode:?}"
            );
        }
    }
}

#[test]
fn a_colour_that_already_passes_comes_back_as_given_and_one_that_fails_is_nudged() {
    let inks = inks(0x8e75ff, Mode::Dark, Intensity::Minimal);
    let white = readable_background(Rgba(0xffffffff), inks).expect("readable");
    assert_eq!(white.background, Rgba(0xffffffff));
    // Mid grey reads with neither ink as it is: it moves, and keeps its (zero) chroma.
    let grey = Rgba(0x777777ff);
    assert!(inks.iter().all(|ink| contrast_ratio(*ink, grey) < 4.5));
    let moved = readable_background(grey, inks).expect("readable");
    assert_ne!(moved.background, grey);
    let [r, g, b] = [24, 16, 8].map(|shift| (moved.background.0 >> shift) as u8);
    assert!(
        r.abs_diff(g) <= 1 && g.abs_diff(b) <= 1,
        "{moved:?} stays grey"
    );
}

#[test]
fn the_cache_returns_the_same_answer() {
    let inks = inks(0x8e75ff, Mode::Light, Intensity::Minimal);
    let first = readable_background(Rgba(0x5fd49aff), inks);
    assert_eq!(readable_background(Rgba(0x5fd49aff), inks), first);
}
