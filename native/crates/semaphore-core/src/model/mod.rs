//! View models: what a UI renders. Frozen by U0, so UI units can build against them before core
//! is real. Change one only with the coordinator's agreement, because every UI unit reads them.
//!
//! All owned, no lifetimes or generics, so UniFFI can export them as records.
//!
//! Split by area; every type is re-exported here, so `model::X` is the path to use.

mod actions;
mod common;
mod communities;
mod files;
mod messages;
mod reading;
mod session;
mod voice;

pub use actions::*;
pub use common::*;
pub use communities::*;
pub use files::*;
pub use messages::*;
pub use reading::*;
pub use session::*;
pub use voice::*;
