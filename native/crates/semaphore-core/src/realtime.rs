//! The real-time transport, as core sees it. `semaphore-net`'s Socket.IO session implements this
//! when `spike/t7-t8` lands; `SocketEvent` and the methods mirror that session.

use async_trait::async_trait;
use serde_json::Value;

/// What the transport reports. Fed to [`crate::Core::ingest`].
#[derive(Debug, Clone, PartialEq)]
pub enum RealtimeEvent {
    Connected {
        sid: String,
    },
    /// `reason` uses socket.io-client's words, such as `transport close`.
    Disconnected {
        reason: String,
    },
    ConnectError {
        message: String,
    },
    Event {
        name: String,
        payload: Value,
    },
    /// After `resume()`: the socket survived the suspend, so no event was lost and no resync runs.
    Resumed,
    Reauthenticated {
        result: Value,
    },
    /// The session can't be recovered: core signs out, and the app must sign in again.
    AuthLost {
        reason: Option<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum RealtimeError {
    #[error("not connected")]
    NotConnected,
    #[error("no ack within the time limit")]
    AckTimedOut,
    #[error("the transport has shut down")]
    Closed,
}

/// Connects with `auth: { token: "Bearer ...", protocol: 2 }`, so sends get a typed `SendAck`.
#[async_trait]
pub trait Realtime: Send + Sync {
    fn connect(&self);
    fn disconnect(&self);
    fn restart_transport(&self);
    fn suspend(&self);
    /// `refresh` comes from [`crate::ResyncPlan::refresh_token`].
    fn resume(&self, refresh: bool);
    async fn emit(&self, event: String, payload: Value) -> Result<(), RealtimeError>;
    /// Returns the server's ack arguments.
    async fn emit_with_ack(
        &self,
        event: String,
        payload: Value,
        wait_ms: u64,
    ) -> Result<Vec<Value>, RealtimeError>;
}
