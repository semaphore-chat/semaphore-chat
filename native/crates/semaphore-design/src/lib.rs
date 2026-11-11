//! The web client's design tokens and icons, generated for the native UI.
//!
//! Everything here comes from the web client at the commit in `native/contract/PIN`, through
//! `tools/web-export/{theme.test.ts,icons.test.tsx}` and `tools/gen-design`. Regenerate it with
//! `native/scripts/gen-design.sh`; never edit `src/generated.rs`, `src/type_scale.rs`, `data/` or
//! `assets/` by hand.
//!
//! No dependencies, and no GPUI: this is the data, not the mapping onto a renderer (see unit U8).
//! See `native/docs/slice-units/U2-design.md`.

mod generated;
#[cfg(test)]
mod tests;
pub mod type_scale;

pub use generated::{Accent, Icon, Intensity, Mode, Tokens, tokens};

/// A colour as the web resolves it, packed `0xRRGGBBAA`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rgba(pub u32);
