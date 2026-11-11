//! Finding and following messages: thread info and subscriptions, search, the unread divider and
//! message links. Unit W1-core part B.

/// What these commands keep between calls. Forgotten at sign-out.
#[derive(Debug, Default)]
pub(crate) struct ReadingState {}
