//! Renders one story to a PNG, with no display server.
//!
//!   rig-shot <story> <width> <height> <out.png>
//!
//! Linux only for real pixels: GPUI has a headless WGPU renderer there and none on Windows.

use anyhow::{Context as _, Result, bail};
use gpui_kit::assets::Assets;
use gpui_kit::test::TestWindowExt as _;
use gpui_kit::*;
use semaphore_core::ConnectionState;
use semaphore_ui::Shell;
use std::sync::Arc;

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [story, width, height, out] = args.as_slice() else {
        bail!("usage: rig-shot <story> <width> <height> <out.png>");
    };
    let width: f32 = width.parse().context("width")?;
    let height: f32 = height.parse().context("height")?;

    let connection = match story.as_str() {
        "shell-connected" => ConnectionState::Connected,
        "shell-offline" => ConnectionState::Offline,
        other => bail!("unknown story {other}; have shell-connected, shell-offline"),
    };

    let mut cx = HeadlessAppContext::with_platform(
        gpui_kit::platform::current_platform(true).text_system(),
        Arc::new(Assets),
        gpui_kit::platform::current_headless_renderer,
    );
    cx.update(gpui_kit::init);

    let (handle, _) = cx
        .update(|cx| {
            gpui_kit::open_window(
                WindowOptions {
                    window_bounds: Some(WindowBounds::Windowed(Bounds {
                        origin: Default::default(),
                        size: size(px(width), px(height)),
                    })),
                    focus: false,
                    show: false,
                    ..Default::default()
                },
                cx,
                |_, cx| cx.new(|_| Shell { connection }),
            )
        })
        .context("opening the offscreen window")?;
    cx.update_window(handle, |_, window, cx| window.render_frame(cx))
        .context("rendering the frame")?;

    let image = cx
        .capture_screenshot(handle)
        .context("offscreen rendering is unavailable")?;
    image.save(out).with_context(|| format!("writing {out}"))?;
    println!("{out} {}x{}", image.width(), image.height());
    Ok(())
}
