//! Sheet: the larger modal for browsing or a longer task (the "All communities" sheet), the native
//! side of `frontend/src/kit/overlays/Sheet.tsx`. It shares the modal core with Dialog.

use super::behaviour::LayerKind;
use super::modal::{ModalAlign, ModalClose, ModalReason, modal};
use super::overlays::{ShadowKind, shadow, type_text};
use super::{IconButton, ValueAction};
use crate::theme::SemTheme;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_design::Icon as IconName;
use semaphore_design::lounge::{
    self as t, BORDER_HAIRLINE, LAYOUT_DIALOG_MD, LAYOUT_DIALOG_SM, LAYOUT_DOCK, RADIUS_ISLAND,
    SPACE_LG, SPACE_MD, SPACE_SM, SPACE_XL, SPACE_XS,
};
use std::rc::Rc;

/// Why a [`Sheet`] asks to close. The owner may refuse `Escape` and `Scrim` (unsaved changes).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SheetCloseReason {
    Escape,
    /// A left press that started and ended on the dimmed page.
    Scrim,
    /// The Close button.
    Button,
    /// The layer the sheet was opened in has closed (the window's overlay stack): the owner
    /// must close it.
    ParentClosed,
}

/// The sheet's width on a wide window: `layout.dialogMd` (560) or twice `layout.dialogSm` (800).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum SheetSize {
    #[default]
    Md,
    Lg,
}

impl SheetSize {
    pub fn width(self) -> f32 {
        match self {
            SheetSize::Md => LAYOUT_DIALOG_MD,
            SheetSize::Lg => 2. * LAYOUT_DIALOG_SM,
        }
    }
}

/// Whether a window this wide shows the sheet as a bottom sheet.
pub fn sheet_is_bottom(width: Pixels) -> bool {
    width < px(t::BREAKPOINT_PHONE)
}

/// A modal panel over a dimmed page, for content that is more than a question: a list of
/// communities, a settings pane. It behaves like a Dialog (focus is trapped, Escape and the scrim
/// ask to close) and shares its core. The header (title and Close) and the optional actions row
/// stay put; the body scrolls. Focus starts on the first action, or on Close when there are none.
/// On a wide window it is a centred panel; below the phone breakpoint, a bottom sheet: full
/// width, rounded on top, at most the window less the dock's height. No slide-in (desktop).
#[derive(IntoElement)]
pub struct Sheet {
    id: ElementId,
    title: SharedString,
    top: Option<AnyElement>,
    body: Vec<AnyElement>,
    actions: Vec<AnyElement>,
    size: SheetSize,
    on_close: Option<ValueAction<SheetCloseReason>>,
}

impl Sheet {
    /// `id` keys the sheet's focus state; `title` names it.
    pub fn new(id: impl Into<ElementId>, title: impl Into<SharedString>) -> Self {
        Self {
            id: id.into(),
            title: title.into(),
            top: None,
            body: Vec::new(),
            actions: Vec::new(),
            size: SheetSize::Md,
            on_close: None,
        }
    }

    /// Content fixed under the title, above the scrolling body: a heading, a search field that
    /// filters the body.
    pub fn top(mut self, element: impl IntoElement) -> Self {
        self.top = Some(element.into_any_element());
        self
    }

    pub fn body(mut self, element: impl IntoElement) -> Self {
        self.body.push(element.into_any_element());
        self
    }

    /// A kit Button in the row pinned to the bottom.
    pub fn action(mut self, element: impl IntoElement) -> Self {
        self.actions.push(element.into_any_element());
        self
    }

    pub fn size(mut self, size: SheetSize) -> Self {
        self.size = size;
        self
    }

    /// Called on Escape, a press on the scrim and the Close button, with which; the owner
    /// removes the sheet.
    pub fn on_request_close(
        mut self,
        handler: impl Fn(SheetCloseReason, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.on_close = Some(Rc::new(handler));
        self
    }
}

impl RenderOnce for Sheet {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let sem = cx.sem().clone();
        let viewport = window.viewport_size();
        let bottom = sheet_is_bottom(viewport.width);
        let on_close = self.on_close.clone();
        let modal_close: Option<ModalClose> = on_close.clone().map(|close| {
            Rc::new(
                move |reason: ModalReason, window: &mut Window, cx: &mut App| {
                    let reason = match reason {
                        ModalReason::Escape => SheetCloseReason::Escape,
                        ModalReason::Scrim => SheetCloseReason::Scrim,
                        ModalReason::ParentClosed => SheetCloseReason::ParentClosed,
                    };
                    close(reason, window, cx)
                },
            ) as ModalClose
        });
        let Sheet {
            id,
            title,
            top,
            body,
            actions,
            size,
            ..
        } = self;
        let has_actions = !actions.is_empty();
        let align = if bottom {
            ModalAlign::Bottom
        } else {
            ModalAlign::Centre
        };
        modal(
            id,
            LayerKind::Sheet,
            align,
            true,
            modal_close,
            window,
            cx,
            move |first| {
                let close = IconButton::new("sheet-close", IconName::Close, "Close").on_click({
                    let on_close = on_close.clone();
                    move |_, window, cx| {
                        if let Some(close) = &on_close {
                            close(SheetCloseReason::Button, window, cx);
                        }
                    }
                });
                let header = div()
                    .flex_none()
                    .flex()
                    .items_center()
                    .justify_between()
                    .gap(px(SPACE_MD))
                    .pt(px(SPACE_LG))
                    .pr(px(SPACE_LG))
                    .pb(px(SPACE_MD))
                    .pl(px(SPACE_XL))
                    .child(
                        type_text(t::TEXT_TITLE, title.clone())
                            .id("sheet-title")
                            .role(Role::Heading)
                            .min_w_0()
                            .truncate(),
                    )
                    .child(
                        // With no actions row, Close takes focus when the sheet opens.
                        div()
                            .flex_none()
                            .when(!has_actions, |slot| slot.track_focus(first).tab_group())
                            .child(close),
                    );
                let panel = div()
                    .id("sheet-panel")
                    .test_support()
                    .aria_label(title)
                    .occlude()
                    .flex()
                    .flex_col()
                    .overflow_hidden()
                    .bg(sem.role.surface)
                    .text_color(sem.role.text)
                    .border_color(sem.role.hairline)
                    .shadow(shadow(&sem, ShadowKind::Overlay))
                    .map(|panel| {
                        if bottom {
                            panel
                                .w_full()
                                .max_h(viewport.height - px(LAYOUT_DOCK))
                                .border_t(px(BORDER_HAIRLINE))
                                .border_l(px(BORDER_HAIRLINE))
                                .border_r(px(BORDER_HAIRLINE))
                                .rounded_t(px(RADIUS_ISLAND))
                        } else {
                            panel
                                .w(px(size.width()))
                                .max_w_full()
                                .max_h_full()
                                .border(px(BORDER_HAIRLINE))
                                .rounded(px(RADIUS_ISLAND))
                        }
                    })
                    .child(header)
                    .children(top.map(|top| {
                        div()
                            .flex_none()
                            .min_w_0()
                            .px(px(SPACE_XL))
                            .pb(px(SPACE_MD))
                            .child(top)
                    }))
                    .child(
                        div()
                            .id("sheet-body")
                            .test_support()
                            .flex_1()
                            .min_h_0()
                            .overflow_y_scroll()
                            .pt(px(SPACE_XS))
                            .px(px(SPACE_XL))
                            .pb(px(SPACE_XL))
                            .flex()
                            .flex_col()
                            .children(body),
                    )
                    .when(has_actions, |panel| {
                        panel.child(
                            div()
                                .track_focus(first)
                                .tab_group()
                                .flex_none()
                                .flex()
                                .gap(px(SPACE_SM))
                                .py(px(SPACE_MD))
                                .px(px(SPACE_XL))
                                .border_t(px(BORDER_HAIRLINE))
                                .border_color(sem.role.hairline)
                                .map(|row| {
                                    if bottom {
                                        row.flex_col().items_stretch()
                                    } else {
                                        row.flex_row().flex_wrap().justify_end().items_center()
                                    }
                                })
                                .children(actions),
                        )
                    });
                panel.into_any_element()
            },
        )
    }
}
