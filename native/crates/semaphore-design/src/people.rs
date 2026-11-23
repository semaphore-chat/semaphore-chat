//! A person's avatar colour, and the readable-ink search for any data colour.
//!
//! Ports of `frontend/src/kit/theme/personColour.ts` and `readable.ts`; `person_colour` is pinned
//! by `design/vectors/person-colour.json` (see `design/gen/colour_ref.py`, `person_colour`).

use crate::Rgba;
use crate::colour_params::PEOPLE;
use crate::derive::{channels, contrast, rgba, to_oklch, to_rgb};
use std::cell::RefCell;
use std::collections::HashMap;

const FNV_OFFSET: u32 = 0x811c_9dc5;
const FNV_PRIME: u32 = 0x0100_0193;

/// 32-bit FNV-1a over `bytes`: XOR each byte in, then multiply by the prime, modulo 2^32.
pub fn fnv1a32(bytes: &[u8]) -> u32 {
    bytes.iter().fold(FNV_OFFSET, |hash, byte| {
        (hash ^ u32::from(*byte)).wrapping_mul(FNV_PRIME)
    })
}

/// A person's avatar colour from their user id: `PEOPLE[fnv1a32(utf8(id)) % 9]`, the id used
/// exactly as the API gives it. A missing or empty id gives `None` (the neutral fill).
pub fn person_colour(id: Option<&str>) -> Option<Rgba> {
    let id = id.filter(|id| !id.is_empty())?;
    let colour = PEOPLE[fnv1a32(id.as_bytes()) as usize % PEOPLE.len()];
    Some(Rgba(colour << 8 | 0xff))
}

/// A data colour made readable: the background to paint and the ink to write on it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Readable {
    pub background: Rgba,
    pub ink: Rgba,
}

/// The contrast the ink must reach on the background.
const TARGET: f64 = 4.5;
const STEPS: u32 = 501;
const STEP: f64 = 0.002;
/// Most answers kept (then the cache starts again); a list of avatars repeats a few colours.
const CACHE_LIMIT: usize = 256;

thread_local! {
    static CACHE: RefCell<HashMap<(u32, u32, u32), Option<Readable>>> =
        RefCell::new(HashMap::new());
}

fn search(colour: Rgba, inks: [Rgba; 2]) -> Option<Readable> {
    const BLACK: [u8; 3] = [0, 0, 0];
    let original = channels(colour);
    let [first, second] = inks.map(channels);
    let first_is_darker = contrast(first, BLACK) <= contrast(second, BLACK);
    let (darker, lighter) = if first_is_darker {
        (first, second)
    } else {
        (second, first)
    };
    let (darker_ink, lighter_ink) = if first_is_darker {
        (inks[0], inks[1])
    } else {
        (inks[1], inks[0])
    };
    // `true`: the darker ink reads at least as well on `rgb`.
    let darker_wins = |rgb: [u8; 3]| contrast(darker, rgb) >= contrast(lighter, rgb);

    let (lightness, chroma, hue) = to_oklch(original);
    let direction = if darker_wins(original) { 1.0 } else { -1.0 };
    for i in 0..STEPS {
        let l = (lightness + direction * STEP * f64::from(i)).clamp(0.0, 1.0);
        let rgb = if i == 0 {
            original
        } else {
            to_rgb(l, chroma, hue)
        };
        let (ink, ink_rgb) = if darker_wins(rgb) {
            (darker_ink, darker)
        } else {
            (lighter_ink, lighter)
        };
        if contrast(ink_rgb, rgb) >= TARGET {
            let background = if i == 0 { colour } else { rgba(rgb, 0xff) };
            return Some(Readable { background, ink });
        }
        if i > 0 && (l == 0.0 || l == 1.0) {
            break;
        }
    }
    None
}

/// `colour` with its lightness (OKLCH) nudged only as far as needed for one of `inks` to read on
/// it at 4.5:1, plus that ink. A colour that already passes comes back unchanged. The nudge goes
/// lighter when the darker ink reads better on the original, else darker, in steps of 0.002, and
/// keeps chroma and hue (chroma only drops where the lightness leaves the gamut); it stops at
/// black or white. `None` when no lightness makes it readable with these inks: never a failing
/// colour. Alpha bytes are ignored. Answers are cached per colour and inks, on this thread.
pub fn readable_background(colour: Rgba, inks: [Rgba; 2]) -> Option<Readable> {
    let colour = Rgba(colour.0 | 0xff);
    let key = (colour.0, inks[0].0, inks[1].0);
    if let Some(answer) = CACHE.with(|cache| cache.borrow().get(&key).copied()) {
        return answer;
    }
    let answer = search(colour, inks);
    CACHE.with(|cache| {
        let mut cache = cache.borrow_mut();
        if cache.len() >= CACHE_LIMIT {
            cache.clear();
        }
        cache.insert(key, answer);
    });
    answer
}
