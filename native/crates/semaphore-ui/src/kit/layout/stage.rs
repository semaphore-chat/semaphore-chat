//! StageLayout: the call screen (`frontend/src/kit/layout/StageLayout.tsx`,
//! `design/guide/layouts.md`, "The full stage").

use super::frame::place_toasts;
use crate::kit::{Action, Island, Padding, Sheet};
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_design::lounge::{CONTROL_MD, SPACE_LG, SPACE_MD};
use std::rc::Rc;

/// The call screen: one island filling the frame (the main), a header row, the stage taking the
/// rest of the height with its content centred and capped at the stage on both axes (content that
/// sizes itself to the room fits it; content with a fixed size larger than the stage is clipped),
/// an optional strip of small tiles, and the controls centred at the bottom. The arrangement is
/// the same at every width.
///
/// [`StageLayout::side`] (the people) is a Sheet at every width, shown while `side_open`.
/// Toasts sit above the controls. Render inside an [`super::AppFrame`].
#[derive(IntoElement)]
pub struct StageLayout {
    header: AnyElement,
    stage: AnyElement,
    controls: AnyElement,
    stage_label: SharedString,
    strip: Option<AnyElement>,
    side: Option<AnyElement>,
    side_label: Option<SharedString>,
    side_open: bool,
    on_side_close: Option<Action>,
}

impl StageLayout {
    /// `header` is the title row, `stage` the big thing (a shared screen, the people's tiles),
    /// `controls` the call controls; `stage_label` names the main.
    pub fn new(
        header: impl IntoElement,
        stage: impl IntoElement,
        controls: impl IntoElement,
        stage_label: impl Into<SharedString>,
    ) -> Self {
        Self {
            header: header.into_any_element(),
            stage: stage.into_any_element(),
            controls: controls.into_any_element(),
            stage_label: stage_label.into(),
            strip: None,
            side: None,
            side_label: None,
            side_open: false,
            on_side_close: None,
        }
    }

    /// A row of small tiles under the stage; it scrolls sideways when it overflows.
    pub fn strip(mut self, strip: impl IntoElement) -> Self {
        self.strip = Some(strip.into_any_element());
        self
    }

    /// The people, in a Sheet at every width.
    pub fn side(mut self, side: impl IntoElement) -> Self {
        self.side = Some(side.into_any_element());
        self
    }

    /// Names the Sheet. Falls back to "People".
    pub fn side_label(mut self, label: impl Into<SharedString>) -> Self {
        self.side_label = Some(label.into());
        self
    }

    pub fn side_open(mut self, open: bool) -> Self {
        self.side_open = open;
        self
    }

    /// Called when the Sheet asks to close (Escape, the scrim, Close).
    pub fn on_side_close(mut self, handler: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_side_close = Some(Rc::new(handler));
        self
    }
}

impl RenderOnce for StageLayout {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let header = div()
            .id("stage-layout-header")
            .test_support()
            .flex_none()
            .flex()
            .items_center()
            .gap(px(SPACE_MD))
            .min_h(px(CONTROL_MD + 2. * SPACE_LG))
            .px(px(SPACE_LG))
            .child(self.header);
        let stage = div()
            .id("stage-layout-stage")
            .test_support()
            .flex_1()
            .min_w_0()
            .min_h_0()
            .flex()
            .items_center()
            .justify_center()
            .overflow_hidden()
            .px(px(SPACE_LG))
            .child(
                // The web caps the stage's child at 100% of both axes. GPUI cannot set another
                // element's max size, so the content gets a wrapper capped at the stage (and as
                // big, so content that sizes itself to the room, by percentages or GPUI's
                // `container_query`, the web's `cqw`/`cqh`, fits on both axes), centred in it and
                // clipped to it.
                div()
                    .id("stage-layout-content")
                    .test_support()
                    .flex_1()
                    .self_stretch()
                    .max_w_full()
                    .max_h_full()
                    .min_w_0()
                    .min_h_0()
                    .flex()
                    .items_center()
                    .justify_center()
                    .overflow_hidden()
                    .child(self.stage),
            );
        let strip = self.strip.map(|strip| {
            div()
                .id("stage-layout-strip")
                .test_support()
                .flex_none()
                .flex()
                .justify_center()
                .gap(px(SPACE_MD))
                .pt(px(SPACE_MD))
                .px(px(SPACE_LG))
                .overflow_x_scroll()
                .child(strip)
        });
        let controls = div()
            .id("stage-layout-controls")
            .test_support()
            .flex_none()
            .flex()
            .flex_wrap()
            .items_center()
            .justify_center()
            .gap(px(SPACE_MD))
            .p(px(SPACE_LG))
            .child(self.controls);
        let sheet = self.side.filter(|_| self.side_open).map(|side| {
            let close = self.on_side_close.clone();
            Sheet::new(
                "stage-layout-side",
                self.side_label
                    .clone()
                    .unwrap_or_else(|| SharedString::from("People")),
            )
            .body(side)
            .on_request_close(move |_, window, cx| {
                if let Some(close) = &close {
                    close(window, cx);
                }
            })
        });
        div()
            .id("stage-layout")
            .test_support()
            .flex_1()
            .min_w_0()
            .min_h_0()
            .flex()
            .flex_col()
            .child(
                Island::new("stage-layout-island")
                    .main(Some(self.stage_label.clone()))
                    .padding(Padding::None)
                    .scroll(true)
                    .child(
                        div()
                            .flex_1()
                            .min_h_0()
                            .flex()
                            .flex_col()
                            .child(
                                // What sits above the controls; toasts sit at its foot.
                                div()
                                    .relative()
                                    .flex_1()
                                    .min_h_0()
                                    .flex()
                                    .flex_col()
                                    .child(header)
                                    .child(stage)
                                    .children(strip)
                                    .child(place_toasts(cx)),
                            )
                            .child(controls),
                    ),
            )
            .children(sheet)
    }
}
