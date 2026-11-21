//! Which layer a kit piece is drawn on, and the colours that follow from it: the native side of
//! `frontend/src/kit/theme/onSurface.ts`.
//!
//! The web reads the layer from a React context. GPUI has no tree-scoped context, so a piece takes
//! it from its owner (`on_surface`), and leaves it at `Ground`, as the web's default, otherwise.

use crate::theme::Sem;
use crate::theme::color::{blend, hsla_of};
use gpui_kit::Hsla;
use semaphore_design::lounge::STATE_PRESSED_ON_FILL;
use semaphore_design::{Palette, Rgba as Token};

/// The layer under a kit piece.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Surface {
    /// The page under everything, outside an island.
    #[default]
    Ground,
    /// An island or an overlay panel.
    Surface,
    /// A card, or anything else drawn in the `fill` colour.
    Fill,
    /// A selected row, the solid accent pill.
    Accent,
}

/// The background a fill-coloured piece (a neutral pill, a soft button, a field box, a track) uses
/// so it stays visible on `on`: `fill` on the ground or a surface, `surface` on a fill, and the faint
/// on-accent tint on the accent.
pub fn stand_out_fill(sem: &Sem, on: Surface) -> Hsla {
    hsla_of(stand_out_token(&sem.roles, on))
}

/// The colour of the layer itself: what a ring that separates a piece from it is painted in, and
/// what a hover or pressed tint is mixed over for a piece with no background of its own.
pub fn tint_base(sem: &Sem, on: Surface) -> Hsla {
    hsla_of(tint_base_token(&sem.roles, on))
}

/// A track's colour (a progress bar's): the hairline, or the stand-out fill on a fill.
pub fn rail_fill(sem: &Sem, on: Surface) -> Hsla {
    hsla_of(rail_fill_token(&sem.roles, on))
}

/// [`stand_out_fill`] as a packed colour, for the controls' state mixing and tests.
pub fn stand_out_token(p: &Palette, on: Surface) -> Token {
    match on {
        Surface::Fill => p.surface,
        Surface::Accent => blend(p.on_accent, p.accent, STATE_PRESSED_ON_FILL),
        Surface::Ground | Surface::Surface => p.fill,
    }
}

/// [`tint_base`] as a packed colour.
pub fn tint_base_token(p: &Palette, on: Surface) -> Token {
    match on {
        Surface::Ground => p.ground,
        Surface::Surface => p.surface,
        Surface::Fill => p.fill,
        Surface::Accent => p.accent,
    }
}

/// [`rail_fill`] as a packed colour.
pub fn rail_fill_token(p: &Palette, on: Surface) -> Token {
    if on == Surface::Fill {
        stand_out_token(p, on)
    } else {
        p.hairline
    }
}
