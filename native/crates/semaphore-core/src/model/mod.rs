//! View models: what a UI renders. Frozen by U0, so UI units can build against them before core
//! is real. Change one only with the coordinator's agreement, because every UI unit reads them.
//!
//! All owned, no lifetimes or generics, so UniFFI can export them as records.
//!
//! Split by area; every type is re-exported here, so `model::X` is the path to use.

mod account;
mod actions;
mod common;
mod communities;
mod dms;
mod files;
mod messages;
mod notify;
mod onboarding;
mod profile;
mod reading;
mod session;
mod social;
mod voice;

pub use account::*;
pub use actions::*;
pub use common::*;
pub use communities::*;
pub use dms::*;
pub use files::*;
pub use messages::*;
pub use notify::*;
pub use onboarding::*;
pub use profile::*;
pub use reading::*;
pub use session::*;
pub use social::*;
pub use voice::*;
