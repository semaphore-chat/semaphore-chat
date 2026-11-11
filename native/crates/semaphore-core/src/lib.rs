//! The client core: state and lifecycle, with no UI framework and no OS dependency.
//!
//! The public API stays binding-friendly so UniFFI or similar can expose it to SwiftUI
//! and Compose later: owned records and enums, no lifetimes or generics, callback traits
//! for anything pushed out. A UI reads the records in [`model`] and calls [`Core`]; generated
//! wire types and `serde_json` values stay behind that line.

pub mod backend;
pub mod cache;
pub mod client;
pub mod commands;
pub mod events;
pub mod lifecycle;
pub mod links;
pub mod model;
pub mod notify;
pub mod platform;
pub mod realtime;
pub mod resync;
#[cfg(feature = "fixtures")]
pub mod scenario;
pub mod send;
pub mod socketio;
pub mod store;
pub mod text;
pub mod uploads;

pub use cache::{CacheEntry, QueryCache, QueryKey};
pub use client::{Core, Services};
pub use lifecycle::{ConnectionState, NetworkState, ResyncPlan};
pub use platform::{CoreError, CoreEvent, EventSink};
