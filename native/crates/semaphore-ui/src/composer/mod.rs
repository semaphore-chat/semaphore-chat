//! The composer and its mention picker. Unit U10.
//!
//! Built to the web client's `components/Message/MessageInput.tsx`, its `MentionDropdown`,
//! `FilePreview` and `ReplyComposerBanner`, and `useComposerAvailability`.
//!
//! - `rules`: the text rules, as plain functions. U6 replaces the mention half.
//! - `model`: what the owner hands in and what comes back as a [`ComposerEvent`].
//! - `view`: the view. It holds the kit's `Textarea`, which owns editing, IME and accessibility.
//! - `menu`: the dropdown, positioned from the caret in the same frame.
//! - `palette`: the web's colours and our icons, local until U8's theme lands.
//!
//! The owner makes a [`Composer`], subscribes to its events, and calls
//! [`Composer::send_settled`] after each `Send`. Nothing here talks to core directly, so stories and
//! tests need no server: `Core::mention_candidates` plugs in as a [`MentionSource`].
//!
//! IME: the kit's field does composition, and `tests.rs` drives it through the text-input protocol
//! an input method uses. No test can drive a real input method or its candidate window: that part of
//! T4 needs the owner's desktop.

mod edit;
mod menu;
mod model;
mod palette;
mod rules;
mod view;

#[cfg(feature = "stories")]
mod stories;
#[cfg(test)]
mod tests;

pub use model::{
    AttachmentSource, Availability, ComposerEvent, ComposerMode, Draft, DraftStore, MentionSource,
    PendingAttachment, ReplyTarget,
};
pub use view::{Composer, ComposerConfig};

#[cfg(feature = "stories")]
pub(crate) use stories::edit_composer_for_story;
#[cfg(feature = "stories")]
pub use stories::stories;
