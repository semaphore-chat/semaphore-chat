//! Acting on a message: edit, delete, pin and react, and the reads that go with them (pins, who
//! reacted). Unit W1-core part A.

/// What these commands keep between calls. Forgotten at sign-out.
#[derive(Debug, Default)]
pub(crate) struct ActionsState {}
