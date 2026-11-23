//! The design system's tokens, palette derivation and icons, for the native UI.
//!
//! `generated` (the MUI icon set) and `type_scale` come from the web client at the commit in
//! `native/contract/PIN`, through `tools/web-export/{theme.test.ts,icons.test.tsx}` and
//! `tools/gen-design`; the old screens use them until they are converted. Regenerate them with
//! `native/scripts/gen-design.sh`; never edit `src/generated.rs`, `src/type_scale.rs` or
//! `assets/icons/` by hand.
//!
//! `lounge` is generated from `design/tokens.json`, not from the web client at the pin.
//! `colour_params` and the test-only `colour_vectors` are generated from `design/` by
//! `design/gen/gen_tokens.py` too. `derive` is the hand-written palette derivation, a port of
//! `design/gen/colour_ref.py`.
//!
//! The test-only `behaviour_vectors` holds the shared behaviour vectors from `design/behaviour/`,
//! as canonical JSON strings, for the behaviour reducers' ports to be tested against.
//!
//! `people` is a person's avatar colour from their id and the readable-ink search for a data
//! colour (ports of `frontend/src/kit/theme/{personColour,readable}.ts`).
//!
//! `lounge_icons` is the shared Lucide set from `design/icons/icons.json`, with one SVG asset per
//! icon below `assets/lucide/`.
//!
//! `chat` holds the chat pieces' pure rules (ports of `frontend/src/kit/chat/*.ts`).
//!
//! No dependencies, and no GPUI: this is the data, not the mapping onto a renderer (see unit U8).
//! See `native/docs/slice-units/U2-design.md`.

pub mod behaviour;
#[cfg(test)]
mod behaviour_vectors;
pub mod chat;
#[cfg(test)]
mod chat_tests;
pub mod colour_params;
#[cfg(test)]
mod colour_vectors;
pub mod derive;
#[cfg(test)]
mod derive_tests;
mod generated;
pub mod lounge;
pub mod lounge_icons;
#[cfg(test)]
mod lounge_icons_tests;
#[cfg(test)]
mod lounge_tests;
pub mod people;
#[cfg(test)]
mod people_tests;
#[cfg(test)]
mod tests;
pub mod type_scale;

pub use derive::{Intensity, Mode, Palette, derive_palette, parse_base};
pub use generated::Icon;
pub use lounge_icons::LoungeIcon;
pub use people::{Readable, person_colour, readable_background};

/// A colour as the web resolves it, packed `0xRRGGBBAA`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rgba(pub u32);
