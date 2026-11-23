//! The layout templates, the native side of `frontend/src/kit/layout/`
//! (`design/guide/layouts.md`): AppFrame, ThreeIslands, SettingsLayout, StageLayout, CallStack
//! and the three width ranges.
//!
//! How the web's pieces map onto GPUI:
//! - **Width ranges** come from the window's width ([`WidthRange::current`]), as the web's
//!   `useWidthRange` reads the viewport. They are read while rendering, so the first frame is right.
//!   The templates never ask a container's width, so they need no `ByWidth`.
//! - **A hidden pane** (the phone's other pane) is laid out but never drawn ([`kept::Kept`]):
//!   its element state (scroll offsets, keyed state) is read in layout and so survives, while it
//!   adds no hitbox, no accessibility node and no Tab stop: the web's `hidden` plus `inert`.
//!   Every pane keeps the same element id at every width, so its state also survives a resize.
//! - **Focus follows the shown pane** ([`focus`]), as `useFollowFocus`.
//! - **Toasts.** A template places the window's [`super::ToastRegion`] in its main pane, above
//!   anything pinned to that pane's bottom; [`AppFrame`] draws it at its own foot only when no
//!   template did in the same frame. That replaces the web's `data-kit-toast-anchor`. A screen
//!   that pins something to the bottom of a three-islands main pane (a composer, call controls)
//!   puts a [`ToastAnchor`] above it instead, the web's `useToastClearance`.
//!
//! Left out, because only a browser has them: the on-screen keyboard (`useKeyboardInset`, the
//! dock bar and the call surface giving way to it, the frame ending at it) and the safe-area
//! insets. CallStack's `summary` is accepted so screens can share their code, and never drawn.

mod call_stack;
pub(crate) mod focus;
mod frame;
mod kept;
mod settings;
mod stage;
mod three_islands;
mod width;

pub use call_stack::{CallSlot, CallStack, PANE_MIN};
pub use frame::{AppFrame, ToastAnchor, WithoutToastAnchor};
pub use settings::{SettingsLayout, SettingsPane};
pub use stage::StageLayout;
pub use three_islands::{PhonePane, ThreeIslands};
pub use width::WidthRange;
