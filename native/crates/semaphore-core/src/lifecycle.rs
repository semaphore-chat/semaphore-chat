//! Lifecycle types. The socket is never assumed to be up: an OS can suspend the process
//! at any time, so connectivity is state the transport reports into core.

use crate::cache::QueryKey;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectionState {
    Disconnected,
    Connected,
    /// The OS suspended us. Nothing runs until `resume()`.
    Suspended,
    /// The network is gone; waiting for `network_changed(Available)`.
    Offline,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NetworkState {
    Available,
    Unavailable,
}

/// What the caller must do to catch up. Core decides; the transport and UI act.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ResyncPlan {
    pub reconnect_socket: bool,
    /// The token expires within the refresh margin, or already has.
    pub refresh_token: bool,
    /// Refetch these. Empty from `resume()` and `network_changed()`: whether there was a gap
    /// isn't known until the transport reports `Resumed` or `Connected`. See [`crate::resync`].
    pub stale_queries: Vec<QueryKey>,
}
