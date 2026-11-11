//! The message list and its selection, grown from the T2 and T3 rig in `rigs/list`.
//!
//! - `store`: `Arc<MessageRow>` in seq order, changed only by core's `ListOp`s.
//! - `text`, `selection`: what the display string means. Plain Rust, with no GPUI.
//! - `row`, `text_element`: drawing one row, after the web client's `components/Message/`.
//! - `media`: where images come from, the bounded cache, animation timing, the allocator setting.
//! - `view`: the list itself. The app makes one with `ListData`, feeds it `ListOp`s, and answers
//!   its `MessageListEvent`s.
//!
//! The app must call [`init`] once at startup and pass every window that shows a list through
//! [`with_list_frame_policy`].

mod format;
mod icons;
mod media;
pub mod palette;
mod row;
mod selection;
mod store;
mod text;
mod text_element;
mod view;

#[cfg(any(test, feature = "stories"))]
pub mod fixture;
#[cfg(any(test, feature = "stories"))]
pub mod synth;

#[cfg(feature = "stories")]
mod stories;
#[cfg(test)]
mod tests;

pub use format::TimeFormat;
pub use media::{
    IMAGE_BUDGET_BYTES, LruImageCache, MediaRef, MediaSource, NoMedia, SMALL_BUDGET_BYTES,
    tune_allocator,
};
pub use row::ReplyPreview;
pub use selection::{Pos, Selection};
pub use view::{
    ClearSelection, CopySelection, ListData, ListOptions, ListStatus, MessageList,
    MessageListEvent, SelectAll, init, with_list_frame_policy,
};

#[cfg(feature = "stories")]
pub use stories::stories;
