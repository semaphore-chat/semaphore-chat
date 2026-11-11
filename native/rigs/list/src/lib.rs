//! T2/T3 rig. The list view is on `gpui::list` + `ListState`; `MessageScroller` keeps its
//! `ListState` private, so a drag selection cannot call `scroll_by` or `viewport_bounds` on it.

pub mod assets;
pub mod data;
pub mod lru;
pub mod selection;
pub mod textdoc;
pub mod view;
