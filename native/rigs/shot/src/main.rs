//! Renders one story to a PNG, with no display server.
//!
//!   rig-shot <story> <width> <height> <out.png>
//!   rig-shot --list
//!
//! Stories come from `semaphore_ui::stories`. Run it from `native/`, where it finds
//! `fixtures/scenarios`. Steps such as click and type arrive with unit U8.
//!
//! Linux only for real pixels: GPUI has a headless WGPU renderer there and none on Windows.

use anyhow::{Context as _, Result, bail};
use gpui_kit::assets::Assets;
use gpui_kit::test::TestWindowExt as _;
use gpui_kit::*;
use semaphore_ui::stories::{self, StoryEnv, StoryRoot};
use std::sync::Arc;

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().is_some_and(|arg| arg == "--list") {
        for story in stories::all() {
            println!("{}", story.name);
        }
        return Ok(());
    }
    let [story, width, height, out] = args.as_slice() else {
        bail!("usage: rig-shot <story> <width> <height> <out.png> | rig-shot --list");
    };
    let width: f32 = width.parse().context("width")?;
    let height: f32 = height.parse().context("height")?;
    let Some(story) = stories::find(story) else {
        bail!("unknown story {story}; rig-shot --list shows them");
    };
    let env = StoryEnv {
        scenarios_dir: "fixtures/scenarios".into(),
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
                |window, cx| {
                    let view = (story.build)(&env, window, cx);
                    cx.new(|_| StoryRoot { view })
                },
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
