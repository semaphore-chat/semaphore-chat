//! Which layer a kit piece is drawn on, and the colours that follow from it: the native side of
//! `frontend/src/kit/theme/onSurface.ts`.
//!
//! The web reads the layer from a React context. GPUI has no tree-scoped context, so a piece takes
//! it from its owner (`on_surface`), and leaves it at `Ground`, as the web's default, otherwise.

use crate::theme::Sem;
use crate::theme::color::{blend, hsla_of};
use gpui_kit::Hsla;
use semaphore_design::lounge::STATE_PRESSED_ON_FILL;

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

/// The background a fill-coloured piece (a neutral pill, a track, an alert) uses so it stays
/// visible on `on`: `fill` on the ground or a surface, `surface` on a fill, and the faint
/// on-accent tint on the accent.
pub fn stand_out_fill(sem: &Sem, on: Surface) -> Hsla {
    match on {
        Surface::Fill => sem.role.surface,
        Surface::Accent => hsla_of(blend(
            sem.roles.on_accent,
            sem.roles.accent,
            STATE_PRESSED_ON_FILL,
        )),
        Surface::Ground | Surface::Surface => sem.role.fill,
    }
}

/// The colour of the layer itself: what a ring that separates a piece from it is painted in.
pub fn tint_base(sem: &Sem, on: Surface) -> Hsla {
    match on {
        Surface::Ground => sem.role.ground,
        Surface::Surface => sem.role.surface,
        Surface::Fill => sem.role.fill,
        Surface::Accent => sem.role.accent,
    }
}

/// A track's colour (a progress bar's): the hairline, or the stand-out fill on a fill.
pub fn rail_fill(sem: &Sem, on: Surface) -> Hsla {
    if on == Surface::Fill {
        stand_out_fill(sem, on)
    } else {
        sem.role.hairline
    }
}
