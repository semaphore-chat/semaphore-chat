//! [`FakeBackend`] for W6-C. Empty in the W6/W7 freeze: every call answers the trait's
//! "unsupported" default. W6-C scripts it the way `w5a.rs` does (answers decoded into the wire
//! type, errors, gates, the calls made).

use super::FakeBackend;
use semaphore_core::backend::AdminStorageBackend;

impl AdminStorageBackend for FakeBackend {}
