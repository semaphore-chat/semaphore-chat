//! Which layer a kit piece is drawn on, and the colours that follow from it: the native side of
//! `frontend/src/kit/theme/onSurface.ts`.
//!
//! The web reads the layer from a React context. GPUI has no tree-scoped context, so the kit keeps
//! one of its own: [`SurfaceScope`] pushes a layer on a stack (an `App` global) while its child
//! subtree lays out and prepaints, and a piece reads the top of it with [`Surface::current`] when
//! it renders. That works because GPUI renders a `RenderOnce` (and an uncached view) inside its
//! parent's request-layout step (`ViewElement::request_layout` in `gpui-pre/src/view.rs`), so the
//! children of a scope render while it is pushed. `surface_tests` pins that behaviour.
//!
//! Island and Dock give their children `Surface`, a Card `Fill` (`Surface` on a fill), a selected
//! ListRow `Accent`, and every overlay panel resets to `Surface`. A piece's own `on_surface(..)`
//! still wins; with neither, it is on `Ground`, as the web's default.

use crate::theme::Sem;
use crate::theme::color::{blend, hsla_of};
use gpui_kit::{
    AnyElement, App, Bounds, Element, ElementId, Global, GlobalElementId, Hsla, InspectorElementId,
    IntoElement, LayoutId, Pixels, Window,
};
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

impl Surface {
    /// The layer the innermost [`SurfaceScope`] being drawn gives, or `Ground` outside every scope.
    pub fn current(cx: &App) -> Surface {
        cx.try_global::<SurfaceStack>()
            .and_then(|stack| stack.layers.last().copied())
            .unwrap_or_default()
    }

    /// A piece's own layer (`on_surface`) if it was given one, the current scope's otherwise.
    pub fn or_current(own: Option<Surface>, cx: &App) -> Surface {
        own.unwrap_or_else(|| Surface::current(cx))
    }

    /// The layer a piece drawn in the `fill` colour gives its children: `Fill`, or `Surface` when
    /// it sits on a fill itself (a card in a card).
    pub fn inside_fill(self) -> Surface {
        if self == Surface::Fill {
            Surface::Surface
        } else {
            Surface::Fill
        }
    }
}

/// The layers of the scopes being drawn, innermost last.
#[derive(Default)]
struct SurfaceStack {
    layers: Vec<Surface>,
    /// A frame-end check is queued (debug builds).
    check_queued: bool,
}

impl Global for SurfaceStack {}

/// Runs `f` with `surface` as the current layer, and leaves the stack as it found it, whatever
/// `f` pushed.
fn with_surface<R>(
    surface: Surface,
    window: &mut Window,
    cx: &mut App,
    f: impl FnOnce(&mut Window, &mut App) -> R,
) -> R {
    let stack = cx.default_global::<SurfaceStack>();
    let depth = stack.layers.len();
    stack.layers.push(surface);
    #[cfg(debug_assertions)]
    if depth == 0 && !stack.check_queued {
        stack.check_queued = true;
        // Effects run once the frame is drawn: every scope has popped by then.
        cx.defer(|cx| {
            let stack = cx.default_global::<SurfaceStack>();
            stack.check_queued = false;
            debug_assert!(
                stack.layers.is_empty(),
                "kit surface stack not empty at frame end: {:?}",
                stack.layers
            );
        });
    }
    let result = f(window, cx);
    cx.default_global::<SurfaceStack>().layers.truncate(depth);
    result
}

/// Gives `child`'s subtree a layer: the kit pieces in it draw as on `surface` unless told
/// otherwise. Layout-transparent: it takes the child's own layout.
pub struct SurfaceScope {
    surface: Surface,
    child: AnyElement,
}

impl SurfaceScope {
    pub fn new(surface: Surface, child: impl IntoElement) -> Self {
        Self {
            surface,
            child: child.into_any_element(),
        }
    }
}

impl IntoElement for SurfaceScope {
    type Element = Self;

    fn into_element(self) -> Self {
        self
    }
}

impl Element for SurfaceScope {
    type RequestLayoutState = ();
    type PrepaintState = ();

    fn id(&self) -> Option<ElementId> {
        None
    }

    fn source_location(&self) -> Option<&'static core::panic::Location<'static>> {
        None
    }

    fn request_layout(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (LayoutId, ()) {
        let child = &mut self.child;
        let layout = with_surface(self.surface, window, cx, |window, cx| {
            child.request_layout(window, cx)
        });
        (layout, ())
    }

    fn prepaint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        _: Bounds<Pixels>,
        _: &mut (),
        window: &mut Window,
        cx: &mut App,
    ) {
        // A view that re-renders in prepaint (a cached one) sees the layer too.
        let child = &mut self.child;
        with_surface(self.surface, window, cx, |window, cx| {
            child.prepaint(window, cx)
        });
    }

    fn paint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        _: Bounds<Pixels>,
        _: &mut (),
        _: &mut (),
        window: &mut Window,
        cx: &mut App,
    ) {
        self.child.paint(window, cx);
    }
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
