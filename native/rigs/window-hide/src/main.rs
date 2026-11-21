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
//! - Wayland: `visibility()` reads `Hidden` while hidden and `Visible` once shown, the report
//!   `set_visible` defers to an idle turn of the event loop.
//!
//!   RIG_CLOSE_CMD='swaymsg ... kill' rig-window-hide close-request <hide|quit>
//!
//! - The compositor's close (Hyprland's `killactive`, a title bar's close button): `RIG_CLOSE_CMD`
//!   asks it to close the window, and the should-close callback does what close to tray does.
//!   `hide`: hides the window from inside the callback and keeps it, twice, then shows it and it
//!   draws again (the tray's show). `quit`: lets it close, and the app goes on. Both once panicked
//!   with "RefCell already borrowed" in the Wayland backend's `report_visibility`.
//!
//! Prints one line, `WINDOW_HIDE result=... platform=...` (`CLOSE_REQUEST ...` for the second form),
//! and exits 0 on a pass, 1 on a failure, 3 when there's no window to test (no display).

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

fn finish(label: &str, platform: &str, result: Result<(), String>) -> ! {
    match result {
        Ok(()) => {
            println!("{label} result=pass platform={platform}");
            std::process::exit(0);
        }
        Err(why) => {
            println!("{label} result=fail platform={platform} why={why:?}");
            std::process::exit(1);
        }
    }
}

const APP_ID: &str = "app.semaphorechat.rig-window-hide";

fn options() -> WindowOptions {
    options_with(APP_ID)
}

fn options_with(app_id: &str) -> WindowOptions {
    WindowOptions {
        window_bounds: Some(WindowBounds::Windowed(Bounds {
            origin: Default::default(),
            size: size(px(320.), px(240.)),
        })),
        app_id: Some(app_id.into()),
        ..Default::default()
    }
}

/// What the should-close callback does in `close-request`: close to tray's hide, or a plain close.
#[derive(Clone, Copy, PartialEq)]
enum OnClose {
    Hide,
    Quit,
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let on_close = match args.iter().map(String::as_str).collect::<Vec<_>>()[..] {
        [] => None,
        ["close-request", "hide"] => Some(OnClose::Hide),
        ["close-request", "quit"] => Some(OnClose::Quit),
        _ => {
            eprintln!("usage: rig-window-hide [close-request <hide|quit>]");
            std::process::exit(2);
        }
    };
    let label = if on_close.is_some() {
        "CLOSE_REQUEST"
    } else {
        "WINDOW_HIDE"
    };
    gpui_kit::application().run(move |cx| {
        let platform = cx.compositor_name();
        if platform != "X11" && platform != "Wayland" && !cfg!(windows) {
            println!("{label} result=skip platform={platform:?} why=\"no display\"");
            std::process::exit(3);
        }
        let frames = Rc::new(Cell::new(0u32));
        let view_frames = frames.clone();
        let handle = match cx.open_window(options(), |_, cx| cx.new(|_| Frames(view_frames))) {
            Ok(handle) => handle,
            Err(error) => {
                println!(
                    "{label} result=skip platform={platform:?} why={:?}",
                    error.to_string()
                );
                std::process::exit(3);
            }
        };
        let platform = platform.to_owned();
        cx.spawn(async move |cx| {
            let result = match on_close {
                None => run(cx, handle.into(), frames).await,
                Some(on_close) => close_request(cx, handle.into(), frames, on_close).await,
            };
            finish(label, &platform, result)
        })
        .detach();
    });
}

/// Asks the compositor to close the window, with `RIG_CLOSE_CMD`.
fn request_close() -> Result<(), String> {
    let command = std::env::var("RIG_CLOSE_CMD").map_err(|_| "RIG_CLOSE_CMD is not set")?;
    let status = std::process::Command::new("sh")
        .arg("-c")
        .arg(&command)
        .stdout(std::process::Stdio::null())
        .status()
        .map_err(|error| format!("{command}: {error}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("{command}: {status}"))
    }
}

async fn close_request(
    cx: &mut AsyncApp,
    window: AnyWindowHandle,
    frames: Rc<Cell<u32>>,
    on_close: OnClose,
) -> Result<(), String> {
    let asked = Rc::new(Cell::new(0u32));
    let callback_asked = asked.clone();
    window
        .update(cx, |_, window, cx| {
            // As `close_or_hide` does: hide from inside the callback and keep the window.
            window.on_window_should_close(cx, move |window, _| {
                callback_asked.set(callback_asked.get() + 1);
                match on_close {
                    OnClose::Hide => !window.set_window_visible(false),
                    OnClose::Quit => true,
                }
            });
        })
        .map_err(|error| format!("{error:#}"))?;
    let visibility = |cx: &mut AsyncApp| window.update(cx, |_, window, _| window.visibility()).ok();
    if !until(cx, |_| frames.get() >= 3).await {
        return Err(format!("the window never drew ({} frames)", frames.get()));
    }
    if on_close == OnClose::Quit {
        // Another window (another app id, so the close request misses it) keeps the app up, and
        // goes on drawing only if the close left the connection healthy.
        let other_frames = Rc::new(Cell::new(0u32));
        let view_frames = other_frames.clone();
        cx.update(|cx| {
            cx.open_window(
                options_with("app.semaphorechat.rig-window-hide-other"),
                |_, cx| cx.new(|_| Frames(view_frames)),
            )
        })
        .map_err(|error| format!("second window: {error:#}"))?;
        if !until(cx, |_| other_frames.get() >= 3).await {
            return Err("the second window never drew".into());
        }
        request_close()?;
        if !until(cx, |cx| asked.get() == 1 && visibility(cx).is_none()).await {
            return Err(format!(
                "the close request didn't close it (asked {} times)",
                asked.get()
            ));
        }
        let at = other_frames.get();
        if !until(cx, |_| other_frames.get() >= at + 10).await {
            return Err("the connection stopped after the close".into());
        }
        return Ok(());
    }
    for round in 1..=2 {
        request_close()?;
        if !until(cx, |cx| {
            asked.get() == round && visibility(cx) == Some(WindowVisibility::Hidden)
        })
        .await
        {
            return Err(format!(
                "round {round}: asked {} times, visibility {:?}",
                asked.get(),
                visibility(cx)
            ));
        }
        cx.background_executor()
            .timer(Duration::from_millis(100))
            .await;
        let before = frames.get();
        cx.background_executor().timer(HIDDEN_FOR).await;
        if frames.get() != before {
            return Err(format!(
                "round {round}: {} frames drew while hidden",
                frames.get() - before
            ));
        }
        // The tray's show.
        let at = frames.get();
        let shown = window
            .update(cx, |_, window, _| {
                let shown = window.set_window_visible(true);
                window.activate_window();
                window.refresh();
                shown
            })
            .unwrap_or(false);
        if !shown {
            return Err(format!("round {round}: set_window_visible(true) refused"));
        }
        if !until(cx, |cx| {
            frames.get() >= at + 3 && visibility(cx) == Some(WindowVisibility::Visible)
        })
        .await
        {
            return Err(format!(
                "round {round}: after the show, {} frames, visibility {:?}",
                frames.get() - at,
                visibility(cx)
            ));
        }
    }
    Ok(())
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
        // Wayland: the deferred visibility report reaches the window.
        if !until(cx, |cx| {
            window
                .update(cx, |_, window, _| {
                    window.visibility() == WindowVisibility::Hidden
                })
                .unwrap_or(false)
        })
        .await
        {
            return Err("a hidden window's visibility never read Hidden".into());
        }
        // Then let a frame already under way land, and none may follow.
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
    if !until(cx, |cx| {
        window
            .update(cx, |_, window, _| {
                window.visibility() == WindowVisibility::Visible
            })
            .unwrap_or(false)
    })
    .await
    {
        return Err("a shown window's visibility never read Visible".into());
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
