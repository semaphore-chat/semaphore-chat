//! A pane that is kept but not shown: the native side of the web `Pane`'s `hidden` + `inert`.

use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;

/// A pane's element, observed for UI queries (focus included) in test builds.
pub(crate) type Pane = gpui_kit::base::ObservedElement<Stateful<Div>>;

/// A pane: the item an island sits in, focusable from code only (its handle is no Tab stop).
pub(crate) fn pane(id: &'static str, handle: &FocusHandle) -> Pane {
    div()
        .id(id)
        .test_support()
        .track_focus(handle)
        .relative()
        .flex()
        .flex_col()
        .min_w_0()
        .min_h_0()
}

/// A pane that is shown (it takes the room its column gives) or kept but not drawn.
pub(crate) fn shown_or_kept(pane: Pane, shown: bool) -> AnyElement {
    if shown {
        pane.flex_1().into_any_element()
    } else {
        Kept::new(pane.size_full()).into_any_element()
    }
}

/// Lays its child out (so the child renders and its element state, read during layout, is kept
/// from frame to frame) and never prepaints or paints it, so it adds no hitbox, no accessibility
/// node, no Tab stop and no pixels. It is absolute and fills its parent, which takes no room
/// from the pane that is shown; put it in a `relative` parent.
///
/// The same trick as MediaTile's `ByWidth` (lay out every step, draw one); the two share no code
/// yet.
pub(crate) struct Kept {
    child: AnyElement,
}

impl Kept {
    pub(crate) fn new(child: impl IntoElement) -> Self {
        Self {
            child: child.into_any_element(),
        }
    }
}

impl IntoElement for Kept {
    type Element = Self;

    fn into_element(self) -> Self {
        self
    }
}

impl Element for Kept {
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
        let child = self.child.request_layout(window, cx);
        let style = Style {
            position: Position::Absolute,
            size: size(relative(1.).into(), relative(1.).into()),
            ..Style::default()
        };
        (window.request_layout(style, [child], cx), ())
    }

    fn prepaint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        _: Bounds<Pixels>,
        _: &mut (),
        _: &mut Window,
        _: &mut App,
    ) {
    }

    fn paint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        _: Bounds<Pixels>,
        _: &mut (),
        _: &mut (),
        _: &mut Window,
        _: &mut App,
    ) {
    }
}
