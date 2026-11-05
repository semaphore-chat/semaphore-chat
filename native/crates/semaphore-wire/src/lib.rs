//! Generated wire types and socket events, plus the tolerant enum module.
//!
//! Everything here comes from `native/contract/` through `tools/gen-api`; run
//! `native/scripts/gen-api.sh` to regenerate. Only `lib.rs` is hand-written.
//!
//! The crate is deliberately pure Rust: no HTTP, no TLS, no C. Reader rules from
//! `contract/wire-contract.md` are enforced by the generated types: unknown fields are
//! ignored, unknown enum values are kept, and a missing optional field means `null`.

// The generated `types` module names enum types as `semaphore_wire::enums::X`, so that the
// same path works in `semaphore-api`'s generated client. This makes it resolve here too.
extern crate self as semaphore_wire;

pub mod events;
mod generated;

pub use generated::{enums, types};
// Also at the root, because `semaphore-api`'s generated client aliases this crate as `types`
// and names every DTO `types::Foo`.
pub use generated::types::*;
