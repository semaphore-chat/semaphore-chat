//! Hides a real window with the patched `Window::set_window_visible` (close to tray), then shows it,
//! and checks it draws again.
//!
//!   rig-window-hide
//!
//! - **X11** (Xvfb): the window's map state goes `Viewable`, `Unmapped`, `Viewable`, read over a
//!   connection of our own, and frames draw after it's shown.
//! - **Wayland** (headless weston): no frame draws while hidden, which is what keeps a buffer from
//!   reaching an unconfigured surface, a protocol error that would end the connection. After it's
//!   shown, frames draw again, which means the compositor configured and mapped it anew.
//! - Both: twice more, then a hidden window is closed, as quitting from the tray does.
//!
//! Prints one line, `WINDOW_HIDE result=... platform=...`, and exits 0 on a pass, 1 on a failure, 3
//! when there's no window to test (no display).

use gpui_kit::*;
use std::cell::Cell;
use std::rc::Rc;
use std::time::{Duration, Instant};

const PATIENCE: Duration = Duration::from_secs(15);
/// How long a hidden window is watched for frames that shouldn't come.
const HIDDEN_FOR: Duration = Duration::from_millis(600);

struct Frames(Rc<Cell<u32>>);

impl Render for Frames {
    fn render(&mut self, window: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        self.0.set(self.0.get() + 1);
        window.request_animation_frame();
        div().size_full().bg(rgb(0x2f6fdf))
    }
}

/// The X11 window id, where there is one.
#[cfg(target_os = "linux")]
fn x11_window(window: &Window) -> Option<u32> {
    use raw_window_handle::RawWindowHandle;
    match raw_window_handle::HasWindowHandle::window_handle(window)
        .ok()?
        .as_raw()
    {
        RawWindowHandle::Xcb(handle) => Some(handle.window.get()),
        RawWindowHandle::Xlib(handle) => u32::try_from(handle.window).ok(),
        _ => None,
    }
}

#[cfg(not(target_os = "linux"))]
fn x11_window(_: &Window) -> Option<u32> {
    None
}

#[cfg(target_os = "linux")]
fn map_state(id: u32) -> Result<String, String> {
    use x11rb::connection::Connection as _;
    use x11rb::protocol::xproto::ConnectionExt as _;
    let (connection, _) = x11rb::connect(None).map_err(|error| error.to_string())?;
    let attributes = connection
        .get_window_attributes(id)
        .map_err(|error| error.to_string())?
        .reply()
        .map_err(|error| error.to_string())?;
    let _ = connection.flush();
    Ok(format!("{:?}", attributes.map_state))
}

#[cfg(not(target_os = "linux"))]
fn map_state(_: u32) -> Result<String, String> {
    Err("no X11 here".into())
}

/// Polls `check` until it holds or `PATIENCE` runs out.
async fn until(cx: &mut AsyncApp, mut check: impl FnMut(&mut AsyncApp) -> bool) -> bool {
    let deadline = Instant::now() + PATIENCE;
    loop {
        if check(cx) {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        cx.background_executor()
            .timer(Duration::from_millis(20))
            .await;
    }
}

fn finish(platform: &str, result: Result<(), String>) -> ! {
    match result {
        Ok(()) => {
            println!("WINDOW_HIDE result=pass platform={platform}");
            std::process::exit(0);
        }
        Err(why) => {
            println!("WINDOW_HIDE result=fail platform={platform} why={why:?}");
            std::process::exit(1);
        }
    }
}

fn options() -> WindowOptions {
    WindowOptions {
        window_bounds: Some(WindowBounds::Windowed(Bounds {
            origin: Default::default(),
            size: size(px(320.), px(240.)),
        })),
        app_id: Some("app.semaphorechat.rig-window-hide".into()),
        ..Default::default()
    }
}

fn main() {
    gpui_kit::application().run(|cx| {
        let platform = cx.compositor_name();
        if platform != "X11" && platform != "Wayland" && !cfg!(windows) {
            println!("WINDOW_HIDE result=skip platform={platform:?} why=\"no display\"");
            std::process::exit(3);
        }
        let frames = Rc::new(Cell::new(0u32));
        let view_frames = frames.clone();
        let handle = match cx.open_window(options(), |_, cx| cx.new(|_| Frames(view_frames))) {
            Ok(handle) => handle,
            Err(error) => {
                println!(
                    "WINDOW_HIDE result=skip platform={platform:?} why={:?}",
                    error.to_string()
                );
                std::process::exit(3);
            }
        };
        let platform = platform.to_owned();
        cx.spawn(async move |cx| {
            let result = run(cx, handle.into(), frames).await;
            finish(&platform, result)
        })
        .detach();
    });
}

async fn run(
    cx: &mut AsyncApp,
    window: AnyWindowHandle,
    frames: Rc<Cell<u32>>,
) -> Result<(), String> {
    let with = |cx: &mut AsyncApp, f: &mut dyn FnMut(&mut Window) -> bool| {
        window.update(cx, |_, window, _| f(window)).unwrap_or(false)
    };
    if !until(cx, |_| frames.get() >= 3).await {
        return Err(format!("the window never drew ({} frames)", frames.get()));
    }
    let x11 = window
        .update(cx, |_, window, _| x11_window(window))
        .ok()
        .flatten();
    if let Some(id) = x11 {
        let state = map_state(id)?;
        if state != "VIEWABLE" {
            return Err(format!("shown window's map state is {state}"));
        }
    }
    if !with(cx, &mut |window| window.can_hide_window()) {
        return Err("can_hide_window() is false".into());
    }
    if !with(cx, &mut |window| window.set_window_visible(false)) {
        return Err("set_window_visible(false) refused".into());
    }
    if let Some(id) = x11 {
        if !until(cx, |_| map_state(id).is_ok_and(|state| state == "UNMAPPED")).await {
            return Err(format!(
                "hidden window's map state stayed {:?}",
                map_state(id)
            ));
        }
    } else {
        // Wayland: let a frame already under way land, then none may follow.
        cx.background_executor()
            .timer(Duration::from_millis(100))
            .await;
        let before = frames.get();
        cx.background_executor().timer(HIDDEN_FOR).await;
        let during = frames.get() - before;
        if during > 0 {
            return Err(format!("{during} frames drew while hidden"));
        }
    }
    let hidden_at = frames.get();
    if !with(cx, &mut |window| window.set_window_visible(true)) {
        return Err("set_window_visible(true) refused".into());
    }
    with(cx, &mut |window| {
        window.activate_window();
        window.refresh();
        true
    });
    if let Some(id) = x11
        && !until(cx, |_| map_state(id).is_ok_and(|state| state == "VIEWABLE")).await
    {
        return Err(format!(
            "shown window's map state stayed {:?}",
            map_state(id)
        ));
    }
    if !until(cx, |_| frames.get() >= hidden_at + 3).await {
        return Err(format!(
            "no frames after showing it again ({} since)",
            frames.get() - hidden_at
        ));
    }
    // Twice more: a second hide and show from the remapped state.
    for _ in 0..2 {
        with(cx, &mut |window| window.set_window_visible(false));
        cx.background_executor()
            .timer(Duration::from_millis(200))
            .await;
        let at = frames.get();
        with(cx, &mut |window| window.set_window_visible(true));
        if !until(cx, |_| frames.get() >= at + 3).await {
            return Err("no frames after a repeated show".into());
        }
    }
    // Quitting from the tray closes a hidden window. A second window keeps the app (and its
    // connection) up, and goes on drawing only if closing the first raised no protocol error.
    let other_frames = Rc::new(Cell::new(0u32));
    let view_frames = other_frames.clone();
    cx.update(|cx| cx.open_window(options(), |_, cx| cx.new(|_| Frames(view_frames))))
        .map_err(|error| format!("second window: {error:#}"))?;
    if !until(cx, |_| other_frames.get() >= 3).await {
        return Err("the second window never drew".into());
    }
    with(cx, &mut |window| window.set_window_visible(false));
    with(cx, &mut |window| {
        window.remove_window();
        true
    });
    let at = other_frames.get();
    if !until(cx, |_| other_frames.get() >= at + 10).await {
        return Err("the connection stopped after closing a hidden window".into());
    }
    Ok(())
}
