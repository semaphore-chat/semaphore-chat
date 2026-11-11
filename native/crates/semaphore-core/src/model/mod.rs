//! View models: what a UI renders. Frozen by U0, so UI units can build against them before core
//! is real. Change one only with the coordinator's agreement, because every UI unit reads them.
//!
//! All owned, no lifetimes or generics, so UniFFI can export them as records.
//!
//! Split by area; every type is re-exported here, so `model::X` is the path to use.

mod account;
mod actions;
mod admin;
mod calls;
mod common;
mod communities;
mod diagnostics;
mod dms;
mod files;
mod messages;
mod moderation;
mod notify;
mod onboarding;
mod profile;
mod reading;
mod replay;
mod roles;
mod session;
mod social;
mod soundboard;
mod voice;

pub use account::*;
pub use actions::*;
pub use admin::*;
pub use calls::*;
pub use common::*;
pub use communities::*;
pub use diagnostics::*;
pub use dms::*;
pub use files::*;
pub use messages::*;
pub use moderation::*;
pub use notify::*;
pub use onboarding::*;
pub use profile::*;
pub use reading::*;
pub use replay::*;
pub use roles::*;
pub use session::*;
pub use social::*;
pub use soundboard::*;
pub use voice::*;
