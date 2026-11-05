// No console window on Windows release builds.
#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

use gpui_kit::component::Root;
use gpui_kit::*;
use semaphore_core::{Core, CoreEvent, EventSink};
use semaphore_platform_desktop::SystemClock;
use semaphore_ui::Shell;
use semaphore_ui::kit::UiAssets;
use semaphore_ui::nav::Route;
use semaphore_ui::shell::CoreSource;
use std::process::ExitCode;
use std::rc::Rc;
use std::sync::Arc;

struct LogEvents;

impl EventSink for LogEvents {
    fn on_event(&self, event: CoreEvent) {
        eprintln!("core: {event:?}");
    }
}

/// `semaphore-app --probe-media <url> <token>`: join a LiveKit room, leave, exit.
///
/// Besides being a smoke test, this is what makes libwebrtc reachable from the binary. An
/// engine nothing calls is dropped by the linker, and then a green Windows link job and the
/// binary size would say nothing about the media stack.
fn run_media_probe(args: &[String]) -> Option<ExitCode> {
    let [flag, url, token] = args else {
        return None;
    };
    if flag != "--probe-media" {
        return None;
    }
    match semaphore_media_livekit::probe_connection(url.clone(), token.clone()) {
        Ok(()) => {
            println!("media probe: connected and left");
            Some(ExitCode::SUCCESS)
        }
        Err(error) => {
            eprintln!("media probe failed: {error}");
            Some(ExitCode::FAILURE)
        }
    }
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if let Some(code) = run_media_probe(&args) {
        return code;
    }

    let core = Arc::new(Core::new(Arc::new(SystemClock), Arc::new(LogEvents)));
    let connection = core.connection();

    gpui_kit::application()
        .with_assets(UiAssets)
        .run(move |cx| {
            gpui_kit::init(cx);
            semaphore_ui::theme::init(cx);
            gpui_kit::open_window(WindowOptions::default(), cx, |window, cx| {
                // U13 wires the real content, the auth flow and the events. This is the shell alone.
                let content =
                    Rc::new(|_: &_, _: &mut Window, _: &mut App| div().into_any_element());
                let shell = cx.new(|cx| {
                    let source = Rc::new(CoreSource(core.clone()));
                    Shell::new(source, Route::Home, content, connection, cx)
                });
                cx.new(|cx| Root::new(shell, window, cx))
            })
            .expect("failed to open the main window");
        });
    ExitCode::SUCCESS
}
