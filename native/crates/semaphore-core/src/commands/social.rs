//! Friends, friend requests and idle presence. Unit W2-core.

use crate::client::Core;
use crate::model::{FriendsView, FriendshipState};
use crate::platform::CoreError;
use crate::resync::unavailable;

/// No input for this long makes the user idle, as the web's `useActivityDetector`. A hidden or
/// minimised window is idle at once. The app watches input and calls [`Core::set_idle`].
pub const IDLE_AFTER_MS: u64 = 5 * 60 * 1000;

impl Core {
    /// Friends and pending requests. `ViewKey::Friends` says when to read again.
    pub fn friends(&self) -> FriendsView {
        FriendsView::default()
    }

    /// Where this user stands with another.
    pub async fn friendship_status(&self, _user_id: String) -> Result<FriendshipState, CoreError> {
        Err(unavailable("friends"))
    }

    /// Asks someone to be friends. If they already asked this user, the server makes them friends.
    pub async fn send_friend_request(&self, _user_id: String) -> Result<(), CoreError> {
        Err(unavailable("friends"))
    }

    pub async fn accept_friend_request(&self, _friendship_id: String) -> Result<(), CoreError> {
        Err(unavailable("friends"))
    }

    pub async fn decline_friend_request(&self, _friendship_id: String) -> Result<(), CoreError> {
        Err(unavailable("friends"))
    }

    /// Takes back a request this user sent.
    pub async fn cancel_friend_request(&self, _friendship_id: String) -> Result<(), CoreError> {
        Err(unavailable("friends"))
    }

    pub async fn remove_friend(&self, _friendship_id: String) -> Result<(), CoreError> {
        Err(unavailable("friends"))
    }

    /// The user went idle, or came back. Sent to the server at once and with every later
    /// heartbeat. The server shows no one as idle; it only stops push notifications meanwhile.
    pub fn set_idle(&self, _idle: bool) {}
}
