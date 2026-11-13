//! GPUI views. Each one renders plain data handed to it, so the screenshot rig can draw any of
//! them as a story with no server behind it. One directory per feature, each owned by one unit,
//! so parallel work doesn't collide.

pub mod about;
pub mod admin;
pub mod auth;
pub mod community_settings;
pub mod composer;
pub mod dms;
pub mod emoji;
pub mod friends;
pub mod gifs;
pub mod home;
pub mod kit;
pub mod messages;
pub mod moderation;
pub mod nav;
pub mod notifications;
pub mod panel;
pub mod player;
pub mod profile;
pub mod replay;
pub mod roles;
pub mod settings;
pub mod shell;
pub mod shortcuts;
#[cfg(feature = "stories")]
pub mod stories;
pub mod theme;
pub mod thread;
pub mod voice;

pub use shell::Shell;
