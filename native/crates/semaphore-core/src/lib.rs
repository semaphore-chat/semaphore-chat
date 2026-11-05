//! The client core: state and lifecycle, with no UI framework and no OS dependency.
//!
//! The public API stays binding-friendly so UniFFI or similar can expose it to SwiftUI
//! and Compose later: owned records and enums, no lifetimes or generics, callback traits
//! for anything pushed out. Phase 0 is a deliberately thin stub of that shape.

pub mod cache;
pub mod client;
pub mod lifecycle;
pub mod platform;
pub mod socketio;

pub use cache::{CacheEntry, QueryCache, QueryKey};
pub use client::Core;
pub use lifecycle::{ConnectionState, NetworkState, ResyncPlan};
pub use platform::{CoreError, CoreEvent, EventSink};
