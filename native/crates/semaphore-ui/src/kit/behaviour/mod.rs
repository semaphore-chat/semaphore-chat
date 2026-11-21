//! The behaviour hosts: the glue between the UI-free reducers of
//! `semaphore_design::behaviour` and GPUI, as the web kit's `frontend/src/kit/behaviour/hosts/`.
//! `design/guide/behaviour.md` ("What a host does") is the contract.
//!
//! - [`BehaviourRoot`] mounts one [`BehaviourHost`] per window.
//! - The overlay stack (`overlay`): every kit Menu, Popover, Dialog and Sheet is a layer; Escape,
//!   presses, `parentClosed` and focus return are decided once, here.
//! - List focus (`list_focus`): one Tab stop, arrows, Home and End and typeahead for Menu, Dock and
//!   Tabs.
//! - The toast queue ([`Toasts`], [`ToastRegion`]), the destructive confirmation
//!   ([`confirm_destructive`]) and the load state ([`use_load_state`], [`LoadStateView`]).
//! - The announcer ([`announce`]).

mod announce;
mod confirm;
mod host;
pub(crate) mod list_focus;
mod load;
mod machine;
pub(crate) mod overlay;
#[cfg(feature = "stories")]
pub(crate) mod stories;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod tests_queue;
#[cfg(test)]
mod tests_review;
mod toasts;

pub use announce::{Announcer, Politeness, announce};
pub use confirm::{ConfirmDestructive, ConfirmDialog, ConfirmOptions, confirm_destructive};
pub use host::{BehaviourHost, BehaviourRoot};
pub use load::{LoadResult, LoadState, LoadStateView, use_load_state};
pub use overlay::{CloseReason, LayerKind, escape_open_layer, screen_escape, screen_focus_target};
pub use toasts::{ToastRegion, ToastRequest, Toasts};
