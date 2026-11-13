//! The camera test's states and transitions, apart from any engine or window: the tab asks its
//! owner to open the selected camera, the owner feeds the frames that arrive and why a capture
//! failed, and these say what the settings page draws.
//!
//! The test itself runs in the app and the engine (`MediaEngine`'s camera test loop); this is only
//! what the page shows: nothing running, opening, a live picture, or why it couldn't.

use gpui_kit::SharedString;

/// What the camera test is doing.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum CameraTestState {
    /// Nothing runs: the preview surface says how to start one.
    #[default]
    Idle,
    /// "Test camera" was pressed and the camera hasn't handed a frame over yet.
    Starting,
    /// Frames are reaching the preview.
    Running,
    /// It couldn't start, or stopped on its own: why.
    Failed { reason: SharedString },
}

impl CameraTestState {
    /// Whether the button says "Stop": a test is in flight, picture or not.
    pub fn is_active(&self) -> bool {
        matches!(self, Self::Starting | Self::Running)
    }
}

/// What happens to the camera test.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CameraTestEvent {
    /// "Test camera", or the same for a changed camera while one runs.
    Start,
    /// A frame reached the preview.
    Frame,
    /// "Stop", or something ended it: leaving the tab, the call taking the camera.
    Stop,
    /// The engine refused the camera, or a running capture ended on its own.
    Failed { reason: SharedString },
}

/// The state after `event`. Only "Test camera" starts one: a frame arriving after a failure can't
/// revive it, and a stray frame while nothing runs changes nothing.
pub fn next(state: &CameraTestState, event: &CameraTestEvent) -> CameraTestState {
    use CameraTestState::{Failed, Idle, Running, Starting};
    match event {
        CameraTestEvent::Start => Starting,
        CameraTestEvent::Stop => Idle,
        CameraTestEvent::Frame => match state {
            Starting => Running,
            other => other.clone(),
        },
        CameraTestEvent::Failed { reason } => match state {
            // A refusal that arrives after a stop belongs to a test nobody shows any more.
            Idle => Idle,
            _ => Failed {
                reason: reason.clone(),
            },
        },
    }
}
