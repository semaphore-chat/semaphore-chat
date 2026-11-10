//! Draws a solid red NV12 frame through the video surface path and checks the pixels that come out.
//! On Windows it also uploads a frame no texture can hold, and checks that it costs only that tile:
//! the window still draws, the red tile is still there, and `VideoUploader::failed()` is true.
//!
//!   rig-surface-smoke
//!
//! Prints one line, `SURFACE_SMOKE result=... renderer="..." software=...`, and exits:
//! 0 when the pixels are right, 3 when there's no surface path to test (no window, no device, or no
//! uploader), and 1 when the path ran and drew wrongly. A pass with `software=true` ran on a
//! software rasterizer (WARP on Windows, lavapipe on Linux): it proves the code, not a GPU.
//!
//! Linux renders headless, as rig-shot does. Windows has no headless renderer, so it opens a real
//! window.

use gpui_kit::test::TestWindowExt as _;
use gpui_kit::*;
use image::RgbaImage;

const WIDTH: f32 = 160.0;
const HEIGHT: f32 = 120.0;
const FRAME: u32 = 64;
/// BT.601 limited range red: what the patch reads every frame as.
const RED_YUV: (u8, u8, u8) = (81, 90, 240);
const TOLERANCE: i32 = 24;

const NO_PATH: i32 = 3;

struct Smoke {
    red: VideoSurfaceId,
    broken: VideoSurfaceId,
}

impl Render for Smoke {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        let (red, broken) = (self.red, self.broken);
        div().size_full().bg(white()).child(
            canvas(
                |_, _, _| {},
                move |bounds, _, window, _| {
                    // The red tile in the middle half; the broken one in the top-left corner.
                    let quarter = size(bounds.size.width / 4.0, bounds.size.height / 4.0);
                    let middle = Bounds {
                        origin: bounds.origin + point(quarter.width, quarter.height),
                        size: size(bounds.size.width / 2.0, bounds.size.height / 2.0),
                    };
                    window.paint_video_surface(middle, Corners::default(), red);
                    let corner = Bounds {
                        origin: bounds.origin,
                        size: size(quarter.width / 2.0, quarter.height / 2.0),
                    };
                    window.paint_video_surface(corner, Corners::default(), broken);
                },
            )
            .size_full(),
        )
    }
}

/// What a run found, before it's printed.
struct Outcome {
    renderer: String,
    software: Option<bool>,
    isolation: &'static str,
}

enum Failure {
    NoPath(String),
    Wrong(String),
}

fn red_frame(y: &mut Vec<u8>, uv: &mut Vec<u8>) {
    *y = vec![RED_YUV.0; (FRAME * FRAME) as usize];
    *uv = [RED_YUV.1, RED_YUV.2].repeat((FRAME * FRAME / 4) as usize);
}

fn near(pixel: [u8; 4], want: [u8; 3]) -> bool {
    (0..3).all(|i| (i32::from(pixel[i]) - i32::from(want[i])).abs() <= TOLERANCE)
}

fn check_red(image: &RgbaImage, when: &str) -> std::result::Result<(), Failure> {
    let (w, h) = image.dimensions();
    let centre = image.get_pixel(w / 2, h / 2).0;
    if !near(centre, [255, 0, 0]) {
        return Err(Failure::Wrong(format!(
            "{when}: the tile's centre is {centre:?}, not red"
        )));
    }
    // Outside every tile: the background, so the tile kept to its bounds.
    let outside = image.get_pixel(w - 2, h - 2).0;
    if !near(outside, [255, 255, 255]) {
        return Err(Failure::Wrong(format!(
            "{when}: the background is {outside:?}, not white"
        )));
    }
    Ok(())
}

fn smoke(
    handle: AnyWindowHandle,
    smoke: &Smoke,
    cx: &mut App,
) -> std::result::Result<Outcome, Failure> {
    let wrong = |error: anyhow::Error| Failure::Wrong(format!("{error:#}"));
    cx.update_window(handle, |_, window, cx| {
        let specs = window.gpu_specs();
        let renderer = specs
            .as_ref()
            .map(|specs| format!("{} ({})", specs.device_name, specs.driver_name))
            .unwrap_or_else(|| "unknown".to_owned());
        let software = specs.map(|specs| specs.is_software_emulated);
        let Some(uploader) = window.video_uploader() else {
            return Err(Failure::NoPath("the renderer has no video uploader".into()));
        };
        let (mut y, mut uv) = (Vec::new(), Vec::new());
        red_frame(&mut y, &mut uv);
        uploader.upload(
            smoke.red,
            &Nv12Frame {
                width: FRAME,
                height: FRAME,
                y: &y,
                y_stride: FRAME,
                uv: &uv,
                uv_stride: FRAME,
            },
        );
        window.render_frame(cx);
        let image = window.render_to_image().map_err(wrong)?;
        check_red(&image, "a good frame")?;
        if uploader.failed() {
            return Err(Failure::Wrong("a good frame set failed()".into()));
        }

        let isolation = if cfg!(target_os = "windows") {
            // No texture is 0x0, so writing this one fails.
            uploader.upload(
                smoke.broken,
                &Nv12Frame {
                    width: 0,
                    height: 0,
                    y: &[],
                    y_stride: 0,
                    uv: &[],
                    uv_stride: 0,
                },
            );
            window.render_frame(cx);
            let image = window.render_to_image().map_err(wrong)?;
            check_red(&image, "after a broken frame")?;
            if !uploader.failed() {
                return Err(Failure::Wrong("a broken frame didn't set failed()".into()));
            }
            "ok"
        } else {
            "skipped"
        };
        Ok(Outcome {
            renderer,
            software,
            isolation,
        })
    })
    .map_err(|error| Failure::Wrong(format!("{error:#}")))?
}

fn options() -> WindowOptions {
    WindowOptions {
        window_bounds: Some(WindowBounds::Windowed(Bounds {
            origin: Default::default(),
            size: size(px(WIDTH), px(HEIGHT)),
        })),
        focus: false,
        show: cfg!(target_os = "windows"),
        ..Default::default()
    }
}

fn open(cx: &mut App) -> std::result::Result<(AnyWindowHandle, Smoke), Failure> {
    let ids = Smoke {
        red: VideoSurfaceId::next(),
        broken: VideoSurfaceId::next(),
    };
    let view = Smoke {
        red: ids.red,
        broken: ids.broken,
    };
    let handle = cx
        .open_window(options(), |_, cx| cx.new(|_| view))
        .map_err(|error| Failure::NoPath(format!("couldn't open a window: {error:#}")))?;
    Ok((handle.into(), ids))
}

fn run(cx: &mut App) -> std::result::Result<Outcome, Failure> {
    let (handle, ids) = open(cx)?;
    smoke(handle, &ids, cx)
}

fn report(result: std::result::Result<Outcome, Failure>) -> i32 {
    match result {
        Ok(outcome) => {
            let software = match outcome.software {
                Some(software) => software.to_string(),
                None => "unknown".to_owned(),
            };
            println!(
                "SURFACE_SMOKE result=pass renderer=\"{}\" software={software} isolation={}",
                outcome.renderer, outcome.isolation
            );
            0
        }
        Err(Failure::NoPath(why)) => {
            println!("SURFACE_SMOKE result=not-tested reason=\"{why}\"");
            NO_PATH
        }
        Err(Failure::Wrong(why)) => {
            println!("SURFACE_SMOKE result=fail reason=\"{why}\"");
            1
        }
    }
}

#[cfg(target_os = "windows")]
fn main() {
    gpui_kit::application().run(|cx| {
        let code = report(run(cx));
        std::process::exit(code);
    });
}

#[cfg(not(target_os = "windows"))]
fn main() {
    let mut cx = HeadlessAppContext::with_platform(
        gpui_kit::platform::current_platform(true).text_system(),
        std::sync::Arc::new(()),
        gpui_kit::platform::current_headless_renderer,
    );
    let code = cx.update(|cx| report(run(cx)));
    std::process::exit(code);
}
