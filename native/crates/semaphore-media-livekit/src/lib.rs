//! LiveKit behind core's `MediaEngine`. Thin on purpose: T7 and the video rigs grow this.

use async_trait::async_trait;
use livekit::{Room, RoomEvent, RoomOptions};
use semaphore_core::CoreError;
use semaphore_core::platform::MediaEngine;
use tokio::sync::Mutex;
use tokio::sync::mpsc::UnboundedReceiver;

struct Session {
    room: Room,
    // Held so the SDK's event channel stays open. Nothing consumes it in Phase 0.
    _events: UnboundedReceiver<RoomEvent>,
}

#[derive(Default)]
pub struct LiveKitEngine {
    session: Mutex<Option<Session>>,
}

#[async_trait]
impl MediaEngine for LiveKitEngine {
    async fn connect(&self, url: String, token: String) -> Result<(), CoreError> {
        let (room, events) = Room::connect(&url, &token, RoomOptions::default())
            .await
            .map_err(|error| CoreError::Failed {
                message: error.to_string(),
            })?;
        *self.session.lock().await = Some(Session {
            room,
            _events: events,
        });
        Ok(())
    }

    async fn disconnect(&self) {
        if let Some(session) = self.session.lock().await.take() {
            // Leaving a room we are already gone from is not worth surfacing.
            let _ = session.room.close().await;
        }
    }
}

/// Joins a room and leaves it, blocking until done. Used by the app's `--probe-media` mode.
pub fn probe_connection(url: String, token: String) -> Result<(), CoreError> {
    let runtime = tokio::runtime::Runtime::new().map_err(|error| CoreError::Failed {
        message: error.to_string(),
    })?;
    runtime.block_on(async {
        let engine = LiveKitEngine::default();
        engine.connect(url, token).await?;
        engine.disconnect().await;
        Ok(())
    })
}
