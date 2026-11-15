//! The colour rules of `appearance-settings`, which the fake mirrors from the backend:
//! `ACCENT_PRIMARY` and `nearestAccent` in `shared/src/theme/accents.ts`, which
//! `backend/src/appearance-settings/appearance-settings.service.ts` uses to keep `accentColor` in
//! step with `baseColor`.
//!
//! The table, the `#rrggbb` form and the OKLab distance are core's
//! ([`AccentColor::primary`], [`AccentColor::nearest_to`]), whose `the_accent_table_is_the_webs`
//! test pins them to `accents.ts`: one definition, so the fake and the client cannot disagree.
//! These two functions read a name or a colour out of the request body, which core's types do not.

use semaphore_core::model::{AccentColor, Rgb};

/// The primary colour of a named accent, as the backend derives `baseColor` from one.
pub(crate) fn primary(accent: &str) -> Option<String> {
    AccentColor::parse(accent).map(|accent| accent.primary().to_hex())
}

/// The accent whose primary is nearest `base` in OKLab, as `nearestAccent` picks it: `slate` for a
/// colour without a meaningful chroma, `None` when `base` isn't `#rrggbb`.
pub(crate) fn nearest_accent(base: &str) -> Option<String> {
    Rgb::parse(base).map(|base| AccentColor::nearest_to(base).name().to_owned())
}
