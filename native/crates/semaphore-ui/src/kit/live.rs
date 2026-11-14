//! Live regions: the nodes a screen reader reads out when they appear or change.
//!
//! AccessKit does not infer liveness from a role: a `Role::Status` or `Role::Alert` node is silent
//! until its `live` property says otherwise (`accesskit_atspi_common` emits
//! `org.a11y.atspi.Event.Object.Announcement` only for a live node with a name; the Windows
//! adapter raises `LiveRegionChanged` for the same). GPUI's div has no `aria_live` setter, but
//! `.a11y_synthetic_children` gets the element's own node through `builder.parent_node()`, which
//! is where [`LiveElement::aria_live`] writes it.
//!
//! One closure per element: `.aria_live(..)` is `a11y_synthetic_children`, so a second call (or
//! any other synthetic-children closure on the same element) replaces the first. Set it once, on
//! the element that carries the role and the label.
//!
//! This is the web's `role="status"`/`role="alert"` plus `aria-live`: polite for status, assertive
//! for alerts, as `frontend/src/hooks/useMessageListAnnouncer.ts` and the web's `Alert` are.

use gpui_kit::accesskit::Live;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;

/// A live node's box. Not zero: an empty box can be filtered out of the accessibility tree.
pub const HIDDEN_SIZE: Pixels = px(1.);

/// `.aria_live(Live::Polite)` on a stateful element: its own AccessKit node becomes live, and
/// atomic, so a screen reader reads the whole label rather than a changed part of it.
pub trait LiveElement: Sized {
    fn aria_live(self, live: Live) -> Self;
}

impl<E: StatefulInteractiveElement> LiveElement for E {
    fn aria_live(self, live: Live) -> Self {
        self.a11y_synthetic_children(move |builder| {
            let node = builder.parent_node();
            node.set_live(live);
            node.set_live_atomic();
        })
    }
}

/// What a live region last said, and the number that makes it a fresh node: two identical
/// announcements must still differ, or the accessibility tree sees no change and says nothing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Said {
    pub text: String,
    pub seq: u64,
}

/// The holder behind a live region: the last thing said, numbered once per announcement.
#[derive(Debug, Default)]
pub struct Speaker {
    last: Option<Said>,
    seq: u64,
}

impl Speaker {
    /// Says `text` as a new announcement; `false` for nothing to say.
    pub fn say(&mut self, text: impl Into<String>) -> bool {
        let text = text.into();
        if text.is_empty() {
            return false;
        }
        self.seq += 1;
        self.last = Some(Said {
            text,
            seq: self.seq,
        });
        true
    }

    pub fn last(&self) -> Option<&Said> {
        self.last.as_ref()
    }

    /// The node to draw for what was last said, or nothing before the first announcement. `id`
    /// names the region (one per view that speaks); the sequence number makes each node new.
    pub fn node(&self, id: &'static str, live: Live) -> Option<impl IntoElement> {
        self.last
            .as_ref()
            .map(|said| live_node((id, said.seq), said.text.clone(), live))
    }
}

/// A visually hidden node a screen reader reads out: 1x1, out of layout, its text as the label.
/// `Role::Status` and polite, or `Role::Alert` and assertive, by `live`.
pub fn live_node(
    id: impl Into<ElementId>,
    text: impl Into<SharedString>,
    live: Live,
) -> impl IntoElement {
    let role = match live {
        Live::Assertive => Role::Alert,
        _ => Role::Status,
    };
    div()
        .id(id)
        .test_support()
        .role(role)
        .aria_label(text)
        .aria_live(live)
        // Out of the layout (1x1, at the corner) so it neither moves a row nor changes a shot.
        .absolute()
        .top(px(0.))
        .left(px(0.))
        .w(HIDDEN_SIZE)
        .h(HIDDEN_SIZE)
        .overflow_hidden()
}
