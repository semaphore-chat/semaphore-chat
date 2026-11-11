//! W4: keeps the system awake during a call ([`KeepAwake`]): a logind `sleep` inhibitor on Linux,
//! `SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED)` on a thread of its own on Windows
//! (the state belongs to the thread that set it). Sleep only, never the display, as Electron's
//! `prevent-app-suspension`.
//!
//! A stub until W4-media: it says it can't.

use semaphore_core::platform::{CoreError, KeepAwake};

#[derive(Debug, Default)]
pub struct DesktopKeepAwake;

impl KeepAwake for DesktopKeepAwake {
    fn set(&self, _on: bool) -> Result<(), CoreError> {
        Err(CoreError::Unavailable {
            what: "keeping the system awake".into(),
        })
    }
}
