//! [`FakeBackend`] for W7-A. Empty in the W6/W7 freeze: every call answers the trait's
//! "unsupported" default. W7-A scripts it the way `w5a.rs` does (answers decoded into the wire
//! type, errors, gates, the calls made).

use super::FakeBackend;
use semaphore_core::backend::GifsBackend;

impl GifsBackend for FakeBackend {}
