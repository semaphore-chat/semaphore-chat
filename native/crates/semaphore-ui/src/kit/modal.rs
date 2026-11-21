//! The modal core Dialog and Sheet share, as the web kit's `overlays/modal.tsx`: gpui-kit's focus
//! trap and backdrop, the kit's scrim, Escape in the bubble phase, a scrim press that counts only
//! when it starts and ends on the scrim, and first focus placed once the frame exists. The panel
//! is the caller's; the core resets the surface to `Surface` for everything in it.
//!
//! In a window with a behaviour host the modal is a layer of its overlay stack: Escape and the
//! scrim press come from the stack (in its order: a menu above the dialog closes first), and so
//! does `ParentClosed`; focus goes back to the opener once the modal is gone. Without a host the
//! modal handles Escape and the scrim itself, as before.

use super::behaviour::overlay::{
    CloseReason, FocusLayer, LAYER_CONTEXT, LayerKind, LayerScope, LayerSpec, layer_keys, use_layer,
};
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
    /// The layer the modal was opened in has closed: the owner must close it.
    ParentClosed,
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
#[allow(clippy::too_many_arguments)]
pub(crate) fn modal(
    id: ElementId,
    kind: LayerKind,
    align: ModalAlign,
    place_focus: bool,
    on_close: Option<ModalClose>,
    window: &mut Window,
    cx: &mut App,
    panel: impl FnOnce(&FocusHandle) -> AnyElement,
) -> impl IntoElement {
    let scrim_colour = cx.sem().role.scrim;
    let focus = window.use_keyed_state(id.clone(), cx, |_, cx| ModalFocus {
        host: cx.focus_handle(),
        first: cx.focus_handle(),
        placed: false,
        scrim_down: false,
    });
    let (host, first, placed) = {
        let focus = focus.read(cx);
        (focus.host.clone(), focus.first.clone(), focus.placed)
    };
    // A layer of the window's stack, opened before focus moves in: what has focus now is its
    // opener. The stack's reasons map onto the modal's; Tab never closes a modal.
    let layer = on_close.clone().and_then(|close| {
        let focus_first = first.clone();
        use_layer(
            ElementId::NamedChild(std::sync::Arc::new(id.clone()), "layer".into()),
            LayerSpec {
                kind,
                roots: vec![host.clone()],
                on_request_close: Rc::new(move |reason, window, cx| {
                    let reason = match reason {
                        CloseReason::Escape | CloseReason::Back => ModalReason::Escape,
                        CloseReason::Scrim | CloseReason::PressOutside => ModalReason::Scrim,
                        CloseReason::ParentClosed => ModalReason::ParentClosed,
                        CloseReason::Tab => return,
                    };
                    close(reason, window, cx)
                }),
                focus_layer: Some(Rc::new(move |window: &mut Window, cx: &mut App| {
                    focus_first_control(&focus_first, window, cx)
                }) as FocusLayer),
                opener: None,
                fallback_opener: None,
            },
            window,
            cx,
        )
    });
    let hosted = layer.is_some();
    if !placed && place_focus {
        focus.update(cx, |focus, _| focus.placed = true);
        let (host, first) = (host.clone(), first.clone());
        // After this frame is drawn, when its Tab order exists.
        window.defer(cx, move |window, cx| {
            // The trap focuses its own host; a control inside that took focus keeps it.
            if host.is_focused(window) || !host.contains_focused(window, cx) {
                focus_first_control(&first, window, cx);
            }
        });
    }
    let escape = on_close.clone();
    let scrim = on_close.clone();
    let popup = div()
        // On the stack, Escape goes to the host ahead of any ancestor's binding.
        .when(hosted, |popup| {
            layer_keys(popup.key_context(LAYER_CONTEXT), cx)
        })
        .absolute()
        .inset_0()
        // Escape is the modal's own, in the bubble phase, so a focused control that uses it
        // (a field's IME, an open select list) has it first. gpui-kit's dialog keys are off:
        // they would make Enter close the modal instead of pressing the focused button.
        .on_key_down(move |event, window, cx| {
            if !hosted && event.keystroke.key == "escape" && !event.keystroke.modifiers.modified() {
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
        .child(panel(&first))
        // The panel's bounds: a press in them is inside the modal, anywhere else on its scrim.
        .when_some(layer.clone(), |popup, layer| {
            popup.on_children_prepainted(move |bounds, _, _| {
                layer.set_panel(bounds.first().copied());
            })
        });
    let popup = match &layer {
        Some(layer) => LayerScope::new(layer.id.clone(), popup).into_any_element(),
        None => popup.into_any_element(),
    };
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
                        // On the stack, the window's press listeners report the scrim press.
                        if down
                            && !hosted
                            && let Some(close) = &scrim
                        {
                            close(ModalReason::Scrim, window, cx);
                        }
                    }
                }),
        )
        // An overlay panel is the surface, whatever it was opened from (a card).
        .popup(SurfaceScope::new(Surface::Surface, popup))
}

/// Focuses the modal's first control that takes focus, from the start of `first`'s container.
fn focus_first_control(first: &FocusHandle, window: &mut Window, cx: &mut App) {
    window.focus(first, cx);
    window.focus_next(cx);
}
