//! `RowTabScope`: how a message row shares Tab with the controls inside it, the native side of the
//! web kit's `frontend/src/kit/chat/rowTabScope.ts`.
//!
//! A message list is one Tab stop: the row that holds the list's roving focus. Only that row's own
//! controls, and the controls of a row focus is in, are Tab stops; every other row's controls are
//! skipped by Tab, still pressable and still reachable by a screen reader's own navigation. So
//! Tab from the focused row walks its controls and then leaves the list, instead of walking every
//! link of every message drawn.
//!
//! GPUI has no tree-scoped context, so this is a stack like [`super::super::SurfaceScope`]'s: the
//! scope is pushed while its subtree lays out and prepaints, and a control reads the top with
//! [`RowTabScope::active`] when it renders. Outside every scope everything is a Tab stop. The kit's
//! Button and IconButton and the chat pieces read it; a control in a row slot that is not a kit
//! piece must read it too.

use gpui_kit::{
    AnyElement, App, Bounds, Element, ElementId, Global, GlobalElementId, InspectorElementId,
    IntoElement, LayoutId, Pixels, Window,
};

/// The scopes being drawn, innermost last.
#[derive(Default)]
struct TabScopeStack {
    active: Vec<bool>,
}

impl Global for TabScopeStack {}

fn with_scope<R>(
    active: bool,
    window: &mut Window,
    cx: &mut App,
    f: impl FnOnce(&mut Window, &mut App) -> R,
) -> R {
    let stack = cx.default_global::<TabScopeStack>();
    let depth = stack.active.len();
    stack.active.push(active);
    let result = f(window, cx);
    cx.default_global::<TabScopeStack>().active.truncate(depth);
    result
}

/// Gives `child`'s subtree whether its controls are Tab stops now. Layout-transparent.
pub struct RowTabScope {
    active: bool,
    child: AnyElement,
}

impl RowTabScope {
    pub fn new(active: bool, child: impl IntoElement) -> Self {
        Self {
            active,
            child: child.into_any_element(),
        }
    }

    /// Whether the controls of the surrounding message row are Tab stops now: true outside every
    /// row that joins a list's roving focus.
    pub fn active(cx: &App) -> bool {
        cx.try_global::<TabScopeStack>()
            .and_then(|stack| stack.active.last().copied())
            .unwrap_or(true)
    }
}

impl IntoElement for RowTabScope {
    type Element = Self;
    fn into_element(self) -> Self {
        self
    }
}

impl Element for RowTabScope {
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
        let layout = with_scope(self.active, window, cx, |window, cx| {
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
        let child = &mut self.child;
        with_scope(self.active, window, cx, |window, cx| {
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
        let child = &mut self.child;
        with_scope(self.active, window, cx, |window, cx| {
            child.paint(window, cx)
        });
    }
}
