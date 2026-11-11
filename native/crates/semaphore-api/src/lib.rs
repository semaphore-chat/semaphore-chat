//! Generated REST client over `semaphore-wire`, plus the hand-written multipart upload and
//! file range read.
//!
//! `generated.rs` comes from `native/contract/openapi.json` through `tools/gen-api`; run
//! `native/scripts/gen-api.sh` to regenerate. Everything else here is hand-written.

pub mod error;
mod generated;
pub mod range;
pub mod upload;

pub use error::{ApiError, from_progenitor};
pub use generated::*;
pub use range::FileRange;

/// The reqwest this client is built on, so callers share one version and one connection
/// pool. `semaphore-net` configures the TLS backend.
pub use reqwest;
