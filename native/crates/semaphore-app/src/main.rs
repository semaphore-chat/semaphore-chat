// No console window on Windows release builds.
#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

use gpui_kit::*;
use semaphore_core::{Core, CoreEvent, EventSink};
use semaphore_media_livekit::LiveKitEngine;
use semaphore_platform_desktop::SystemClock;
use semaphore_ui::Shell;
use std::sync::Arc;

struct LogEvents;

impl EventSink for LogEvents {
    fn on_event(&self, event: CoreEvent) {
        eprintln!("core: {event:?}");
    }
}

fn main() {
    let core = Arc::new(Core::new(Arc::new(SystemClock), Arc::new(LogEvents)));
    // Linked now so the Windows CI job and the size numbers cover libwebrtc.
    let _media = LiveKitEngine::default();
    let connection = core.connection();

    gpui_kit::application().run(move |cx| {
        gpui_kit::init(cx);
        gpui_kit::open_window(WindowOptions::default(), cx, |_, cx| {
            cx.new(|_| Shell { connection })
        })
        .expect("failed to open the main window");
    });
}
