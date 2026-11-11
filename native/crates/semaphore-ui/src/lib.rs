//! GPUI views. Each one renders plain data handed to it, so the screenshot rig can draw any of
//! them as a story with no server behind it. One directory per feature, each owned by one unit,
//! so parallel work doesn't collide.

pub mod auth;
pub mod composer;
pub mod dms;
pub mod emoji;
pub mod friends;
pub mod home;
pub mod kit;
pub mod messages;
pub mod nav;
pub mod notifications;
pub mod panel;
pub mod profile;
pub mod settings;
pub mod shell;
#[cfg(feature = "stories")]
pub mod stories;
pub mod theme;
pub mod thread;
pub mod voice;

pub use shell::Shell;
