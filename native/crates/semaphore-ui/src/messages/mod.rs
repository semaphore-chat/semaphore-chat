//! The message list and its selection, grown from the T2 and T3 rig in `rigs/list`.
//!
//! - `store`: `Arc<MessageRow>` in seq order, changed only by core's `ListOp`s.
//! - `text`, `selection`: what the display string means. Plain Rust, with no GPUI.
//! - `row`: drawing one row on the kit's `MessageRow` and `MessageText`; `segments`: a row's
//!   words as the kit's segments, and the map between the display string and the words as drawn.
//! - `media`: where images come from, the bounded cache, animation timing, the allocator setting.
//! - `third_party`: the only way to a GIF's or a link preview's picture, closed while the setting
//!   is off. `seen`: which row "Seen by" goes under and how it reads.
//! - `view`: the list itself. The app makes one with `ListData`, feeds it `ListOp`s, and answers
//!   its `MessageListEvent`s. `announce` decides what a screen reader hears about new messages.
//!
//! The app must call [`init`] once at startup and pass every window that shows a list through
//! [`with_list_frame_policy`].

#[cfg(test)]
mod action_tests;
mod actions;
mod announce;
mod format;
#[cfg(test)]
mod link_tests;
mod media;
mod painted;
pub mod palette;
#[cfg(test)]
mod player_tests;
mod row;
mod seen;
mod segments;
mod selection;
mod store;
mod text;
mod third_party;
mod view;

#[cfg(any(test, feature = "stories"))]
pub mod fixture;
#[cfg(any(test, feature = "stories"))]
pub mod synth;

#[cfg(any(test, feature = "stories"))]
mod media_stories;
#[cfg(test)]
mod media_tests;
#[cfg(feature = "stories")]
mod stories;
#[cfg(test)]
mod tests;

pub use actions::{
    ListPermissions, MessageAction, UnreadDivider, delete_is_removal, message_actions,
    reaction_tooltip_lines, toolbar_actions, unread_label,
};
pub use format::TimeFormat;
pub use media::{
    CacheKind, IMAGE_BUDGET_BYTES, LruImageCache, Media, MediaRef, MediaSource, MediaState,
    NoMedia, SMALL_BUDGET_BYTES, tune_allocator,
};
pub use row::ReplyPreview;
pub(crate) use row::author_name;
pub use selection::{Pos, Selection};
pub(crate) use text::plain_text_with_links;
pub use view::{
    ClearSelection, CopySelection, ListData, ListOptions, ListStatus, MessageList,
    MessageListEvent, SelectAll, init, with_list_frame_policy,
};

#[cfg(feature = "stories")]
pub use stories::stories;
