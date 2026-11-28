//! PanelPane: a screen's right panel that is not a conversation (`frontend/src/kit/layout/PanelPane.tsx`,
//! `design/guide/components.md`).

use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_design::lounge::{SPACE_SM, SPACE_XS};

/// A right panel that fills its region (ThreeIslands' [`super::ThreeIslands::right_fill`], the
/// filling drawer below wide): a header and an optional fixed part at the top, then a body that
/// scrolls on its own, so the heading, Close and a search field stay in view over a long list.
/// The region has no padding in that mode; the pane brings it, with the same padding as a
/// thread's header so a panel's Close lines up with a thread's.
#[derive(IntoElement)]
pub struct PanelPane {
    id: ElementId,
    header: AnyElement,
    top: Option<AnyElement>,
    body: Vec<AnyElement>,
    scroll: Option<ScrollHandle>,
    body_label: Option<SharedString>,
}

impl PanelPane {
    pub fn new(id: impl Into<ElementId>, header: impl IntoElement) -> Self {
        Self {
            id: id.into(),
            header: header.into_any_element(),
            top: None,
            body: Vec::new(),
            scroll: None,
            body_label: None,
        }
    }

    /// Under the header and also fixed: a search field, a scope switch.
    pub fn top(mut self, top: impl IntoElement) -> Self {
        self.top = Some(top.into_any_element());
        self
    }

    /// The panel's content. It fills what is left, and is the only part that scrolls.
    pub fn child(mut self, child: impl IntoElement) -> Self {
        self.body.push(child.into_any_element());
        self
    }

    pub fn children(mut self, children: impl IntoIterator<Item = impl IntoElement>) -> Self {
        self.body
            .extend(children.into_iter().map(IntoElement::into_any_element));
        self
    }

    /// Tracks the body's scrolling, so the content can bring a row into view.
    pub fn track_scroll(mut self, handle: &ScrollHandle) -> Self {
        self.scroll = Some(handle.clone());
        self
    }

    /// Makes the body a list landmark with this name.
    pub fn list_label(mut self, label: impl Into<SharedString>) -> Self {
        self.body_label = Some(label.into());
        self
    }
}

impl RenderOnce for PanelPane {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        let id = self.id.clone();
        let body_id = ElementId::Name(format!("{id}-body").into());
        let body = div()
            .id(body_id)
            .test_support()
            .when_some(self.body_label, |body, label| {
                body.role(Role::List).aria_label(label)
            })
            .flex_1()
            .min_h_0()
            .min_w_0()
            .overflow_y_scroll()
            .when_some(self.scroll, |body, handle| body.track_scroll(&handle))
            .flex()
            .flex_col()
            .px(px(SPACE_SM))
            .pb(px(SPACE_SM))
            .children(self.body);
        div()
            .id(self.id)
            .test_support()
            .size_full()
            .min_h_0()
            .min_w_0()
            .flex()
            .flex_col()
            .child(
                div()
                    .flex_none()
                    .min_w_0()
                    .pt(px(SPACE_SM))
                    .px(px(SPACE_SM))
                    .pb(px(SPACE_XS))
                    .child(self.header),
            )
            .children(self.top.map(|top| {
                div()
                    .flex_none()
                    .min_w_0()
                    .pt(px(SPACE_XS))
                    .px(px(SPACE_SM))
                    .pb(px(SPACE_SM))
                    .child(top)
            }))
            .child(body)
    }
}
