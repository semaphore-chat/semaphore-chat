//! ThreeIslands: the chat screen (`frontend/src/kit/layout/ThreeIslands.tsx`,
//! `design/guide/layouts.md`, "Three islands").

use super::call_stack::{CallSlot, PANE_MIN};
use super::focus::follow_focus;
use super::frame::place_toasts;
use super::kept::{pane, shown_or_kept};
use super::width::WidthRange;
use crate::kit::{Action, Island, Padding, Sheet};
use crate::theme::SemTheme;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_design::lounge::{
    LAYOUT_DOCK, LAYOUT_GUTTER, LAYOUT_LEFT_COLUMN, LAYOUT_RIGHT_COLUMN,
};
use std::rc::Rc;

/// Which pane a phone shows.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum PhonePane {
    Left,
    #[default]
    Centre,
}

const LEFT: usize = 0;
const CENTRE: usize = 1;
const RIGHT: usize = 2;

/// The chat screen: the dock, the place, the conversation and the context.
///
/// - Wide: a left column (the dock above the left island, the call slot under it) | the centre
///   island | the right island while the right content is showing.
/// - Compact: the left column | the centre. The right content is a Sheet while showing.
/// - Phone: one pane fills the frame ([`ThreeIslands::phone_pane`]), then the call slot, then
///   the dock bar. The other pane is kept but not drawn, so what was typed or scrolled in it
///   survives and nothing in it can be reached. The right content is a Sheet.
///
/// Landmarks: the left island is a navigation landmark, the centre the main, the right a
/// complementary one, in reading order; the Dock names its own. On a phone showing the left pane,
/// that pane is the main. The centre island has no padding: the conversation brings its own
/// header, list and composer, and on a phone its own Back.
///
/// When the pane that holds focus stops being shown, focus moves to the pane now shown. The right
/// content is rebuilt when the width crosses `breakpoint.docked`: keep a reply draft in the
/// screen's own state. Toasts sit at the foot of the pane that is the main. Render inside an
/// [`super::AppFrame`].
#[derive(IntoElement)]
pub struct ThreeIslands {
    left: AnyElement,
    left_label: SharedString,
    left_footer: Option<AnyElement>,
    centre: AnyElement,
    centre_label: SharedString,
    dock: Option<AnyElement>,
    right: Option<AnyElement>,
    right_label: Option<SharedString>,
    right_open: Option<bool>,
    on_right_close: Option<Action>,
    call: Option<CallSlot>,
    phone_pane: PhonePane,
    left_scroll: Option<ScrollHandle>,
    right_scroll: Option<ScrollHandle>,
}

impl ThreeIslands {
    /// `left` is the place (community header, channels, voice rooms), `centre` the conversation
    /// or task; each label names its landmark.
    pub fn new(
        left: impl IntoElement,
        left_label: impl Into<SharedString>,
        centre: impl IntoElement,
        centre_label: impl Into<SharedString>,
    ) -> Self {
        Self {
            left: left.into_any_element(),
            left_label: left_label.into(),
            left_footer: None,
            centre: centre.into_any_element(),
            centre_label: centre_label.into(),
            dock: None,
            right: None,
            right_label: None,
            right_open: None,
            on_right_close: None,
            call: None,
            phone_pane: PhonePane::Centre,
            left_scroll: None,
            right_scroll: None,
        }
    }

    /// A kit Dock: above the left island, or the bar at the bottom of a phone.
    pub fn dock(mut self, dock: impl IntoElement) -> Self {
        self.dock = Some(dock.into_any_element());
        self
    }

    /// Stays at the foot of the left island while the rest of it scrolls (the user's own card).
    pub fn left_footer(mut self, footer: impl IntoElement) -> Self {
        self.left_footer = Some(footer.into_any_element());
        self
    }

    /// Context (members, a thread, pins): its own island at wide, a Sheet below that.
    pub fn right(mut self, right: impl IntoElement) -> Self {
        self.right = Some(right.into_any_element());
        self
    }

    /// Names the right island and the Sheet. Falls back to "Details".
    pub fn right_label(mut self, label: impl Into<SharedString>) -> Self {
        self.right_label = Some(label.into());
        self
    }

    /// Whether the right content is showing, at every width: an island at wide, a Sheet below.
    /// Left out (`None`), it is showing at wide and closed below, so a resize never opens a Sheet
    /// by itself.
    pub fn right_open(mut self, open: impl Into<Option<bool>>) -> Self {
        self.right_open = open.into();
        self
    }

    /// Called when the Sheet asks to close (Escape, the scrim, Close). At wide the screen closes
    /// the island with its own control.
    pub fn on_right_close(mut self, handler: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_right_close = Some(Rc::new(handler));
        self
    }

    /// The persistent in-call strip, on its own or as a [`super::CallStack`]. On a phone it sits
    /// between the shown pane and the dock bar; at compact and wide under the left island.
    pub fn call_bar(mut self, call: impl Into<CallSlot>) -> Self {
        self.call = Some(call.into());
        self
    }

    /// Tracks the left island's scrolling part, so its content can bring a row into view.
    pub fn left_scroll(mut self, handle: &ScrollHandle) -> Self {
        self.left_scroll = Some(handle.clone());
        self
    }

    /// Likewise the right content's, island or Sheet.
    pub fn right_scroll(mut self, handle: &ScrollHandle) -> Self {
        self.right_scroll = Some(handle.clone());
        self
    }

    pub fn phone_pane(mut self, pane: PhonePane) -> Self {
        self.phone_pane = pane;
        self
    }
}

fn dock_slot(dock: AnyElement) -> Div {
    div().flex_none().h(px(LAYOUT_DOCK)).min_w_0().child(dock)
}

impl RenderOnce for ThreeIslands {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let range = WidthRange::current(window);
        let phone = range.is_phone();
        let open = self.right.is_some() && self.right_open.unwrap_or(range.is_wide());
        let show_island = open && range.is_wide();
        let left_shown = !phone || self.phone_pane == PhonePane::Left;
        let centre_shown = !phone || self.phone_pane == PhonePane::Centre;
        let left_main = phone && self.phone_pane == PhonePane::Left;
        let name = self
            .right_label
            .clone()
            .unwrap_or_else(|| SharedString::from("Details"));

        let mut shown = Vec::with_capacity(3);
        if left_shown {
            shown.push(LEFT);
        }
        if centre_shown {
            shown.push(CENTRE);
        }
        if show_island {
            shown.push(RIGHT);
        }
        let target = if left_main { LEFT } else { CENTRE };
        let handles = follow_focus("three-islands-focus", 3, &shown, target, window, cx);

        let left = pane("three-islands-left", &handles[LEFT])
            .when(left_main, |pane| pane.role(Role::Main))
            .child(
                Island::new("three-islands-left-island")
                    .nav(self.left_label.clone())
                    .padding(Padding::Md)
                    .scroll(true)
                    .when_some(self.left_scroll.clone(), |island, handle| {
                        island.track_scroll(&handle)
                    })
                    .footer(self.left_footer)
                    .child(self.left),
            )
            .when(left_main, |pane| pane.child(place_toasts(cx)));
        let centre = pane("three-islands-centre", &handles[CENTRE])
            .child(
                Island::new("three-islands-centre-island")
                    .main(Some(self.centre_label.clone()))
                    .padding(Padding::None)
                    .scroll(true)
                    .child(self.centre),
            )
            .when(centre_shown, |pane| pane.child(place_toasts(cx)));
        // The call slot sits on the frame's ground: the colour its rounded corners are cut against.
        let behind = cx.sem().role.ground;
        let call = self
            .call
            .map(|call| call.into_parts(behind))
            .unwrap_or_default();
        let has_call = !call.is_empty();

        let mut sheet = None;
        let mut island = None;
        if let Some(right) = self.right {
            if show_island {
                island = Some(
                    pane("three-islands-right", &handles[RIGHT])
                        .flex_none()
                        .w(px(LAYOUT_RIGHT_COLUMN))
                        .child(
                            Island::new("three-islands-right-island")
                                .aside(name.clone())
                                .scroll(true)
                                .when_some(self.right_scroll.clone(), |island, handle| {
                                    island.track_scroll(&handle)
                                })
                                .child(right),
                        ),
                );
            } else if open {
                let close = self.on_right_close.clone();
                sheet = Some(
                    Sheet::new("three-islands-right-sheet", name.clone())
                        .body(right)
                        .when_some(self.right_scroll.clone(), |sheet, handle| {
                            sheet.scroll_handle(&handle)
                        })
                        .on_request_close(move |_, window, cx| {
                            if let Some(close) = &close {
                                close(window, cx);
                            }
                        }),
                );
            }
        }

        let root = div()
            .id("three-islands")
            .test_support()
            .flex_1()
            .min_w_0()
            .min_h_0()
            .flex();
        let root = if phone {
            root.flex_col()
                .child(
                    div()
                        .relative()
                        .flex_1()
                        .min_w_0()
                        .min_h(px(if has_call { PANE_MIN } else { 0. }))
                        .flex()
                        .flex_col()
                        .child(shown_or_kept(left, left_shown))
                        .child(shown_or_kept(centre, centre_shown)),
                )
                .children(call)
                .when_some(self.dock, |root, dock| {
                    root.child(dock_slot(dock).mt(px(LAYOUT_GUTTER)))
                })
        } else {
            root.flex_row()
                .gap(px(LAYOUT_GUTTER))
                .child(
                    div()
                        .flex_none()
                        .w(px(LAYOUT_LEFT_COLUMN))
                        .min_h_0()
                        .flex()
                        .flex_col()
                        .when_some(self.dock, |column, dock| {
                            column.child(dock_slot(dock).mb(px(LAYOUT_GUTTER)))
                        })
                        .child(shown_or_kept(left, true))
                        .children(call),
                )
                .child(shown_or_kept(centre, true))
                .children(island)
        };
        root.children(sheet)
    }
}
