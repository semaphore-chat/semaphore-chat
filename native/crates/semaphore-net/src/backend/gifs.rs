//! [`HttpBackend`] for [`GifsBackend`]: GIF search. W7-A fills it; until then every call answers the
//! trait's "unsupported" default.

use semaphore_core::backend::GifsBackend;

use super::*;

impl GifsBackend for HttpBackend {}
