//! The modal core Dialog and Sheet share, as the web kit's `overlays/modal.tsx`: gpui-kit's focus
//! trap and backdrop, the kit's scrim, Escape in the bubble phase, a scrim press that counts only
//! when it starts and ends on the scrim, and first focus placed once the frame exists. The panel
//! is the caller's; the core resets the surface to `Surface` for everything in it.

use super::{Surface, SurfaceScope};
use crate::theme::SemTheme;
use gpui_kit::base;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_design::lounge::LAYOUT_GUTTER;
use std::rc::Rc;

/// Why a modal asks to close, before the piece maps it to its own reason.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ModalReason {
    Escape,
    Scrim,
}

pub(crate) type ModalClose = Rc<dyn Fn(ModalReason, &mut Window, &mut App)>;

/// Where the panel sits in the window.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ModalAlign {
    /// Centred, a gutter from every edge.
    Centre,
    /// Full width at the bottom edge (a bottom sheet).
    Bottom,
}

/// Where the modal keeps its first focus: the host's handle, and whether focus was placed.
struct ModalFocus {
    host: FocusHandle,
    first: FocusHandle,
    placed: bool,
    /// A left press went down on the scrim and has not come up yet.
    scrim_down: bool,
}

/// A modal around `panel`. `panel` gets the first-focus handle: track it on the container whose
/// first focusable control takes focus when the modal opens (unless something inside already took
/// it). `place_focus` false leaves focus to the trap's host. State is kept under `id`, so two modals
/// with the same title never share it.
pub(crate) fn modal(
    id: ElementId,
    align: ModalAlign,
    place_focus: bool,
    on_close: Option<ModalClose>,
    window: &mut Window,
    cx: &mut App,
    panel: impl FnOnce(&FocusHandle) -> AnyElement,
) -> impl IntoElement {
    let scrim_colour = cx.sem().role.scrim;
    let focus = window.use_keyed_state(id, cx, |_, cx| ModalFocus {
        host: cx.focus_handle(),
        first: cx.focus_handle(),
        placed: false,
        scrim_down: false,
    });
    let (host, first, placed) = {
        let focus = focus.read(cx);
        (focus.host.clone(), focus.first.clone(), focus.placed)
    };
    if !placed && place_focus {
        focus.update(cx, |focus, _| focus.placed = true);
        let (host, first) = (host.clone(), first.clone());
        // After this frame is drawn, when its Tab order exists.
        window.defer(cx, move |window, cx| {
            // The trap focuses its own host; a control inside that took focus keeps it.
            if host.is_focused(window) || !host.contains_focused(window, cx) {
                window.focus(&first, cx);
                window.focus_next(cx);
            }
        });
    }
    let escape = on_close.clone();
    let scrim = on_close.clone();
    let popup = div()
        .absolute()
        .inset_0()
        // Escape is the modal's own, in the bubble phase, so a focused control that uses it
        // (a field's IME, an open select list) has it first. gpui-kit's dialog keys are off:
        // they would make Enter close the modal instead of pressing the focused button.
        .on_key_down(move |event, window, cx| {
            if event.keystroke.key == "escape" && !event.keystroke.modifiers.modified() {
                cx.stop_propagation();
                if let Some(close) = &escape {
                    close(ModalReason::Escape, window, cx);
                }
            }
        })
        .flex()
        .map(|popup| match align {
            ModalAlign::Centre => popup.items_center().justify_center().p(px(LAYOUT_GUTTER)),
            ModalAlign::Bottom => popup.items_end().justify_center(),
        })
        .child(panel(&first));
    base::Dialog::new(cx)
        .focus_handle(host)
        .close_on_escape(false)
        .open(true)
        .on_open_change(move |open, reason, window, cx| {
            let reason = match reason {
                base::DialogChangeReason::BackdropPress => ModalReason::Scrim,
                base::DialogChangeReason::Cancel => ModalReason::Escape,
                _ => return,
            };
            if !open && let Some(on_close) = &on_close {
                on_close(reason, window, cx);
            }
        })
        // The kit's own scrim takes the press: gpui-kit listens on a wrapper the occluding scrim
        // hides from the hit test. A left press that starts and ends on the dimmed page asks to
        // close.
        .backdrop(
            div()
                .id("dialog-scrim")
                .test_support()
                .absolute()
                .inset_0()
                .occlude()
                .bg(scrim_colour)
                .on_mouse_down(MouseButton::Left, {
                    let focus = focus.clone();
                    move |_, _, cx| {
                        cx.stop_propagation();
                        focus.update(cx, |focus, _| focus.scrim_down = true);
                    }
                })
                .on_mouse_up(MouseButton::Left, {
                    let focus = focus.clone();
                    move |_, window, cx| {
                        let down = focus.update(cx, |focus, _| {
                            std::mem::replace(&mut focus.scrim_down, false)
                        });
                        if down && let Some(close) = &scrim {
                            close(ModalReason::Scrim, window, cx);
                        }
                    }
                }),
        )
        // An overlay panel is the surface, whatever it was opened from (a card).
        .popup(SurfaceScope::new(Surface::Surface, popup))
}
