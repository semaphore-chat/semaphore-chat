//! Unit A's proof that the patched libwebrtc capturers work from Rust: lists screens and captures
//! BGRA frames at a capped rate, and lists cameras and captures from one. Exits non-zero when a
//! check fails. `scripts/capture-probe.sh` runs it headless (Xvfb, and PipeWire with a test
//! camera node); on a desktop it runs against the real screen and cameras.
//!
//!   capture_probe screens [--fps 15] [--frames 10] [--expect-size 1280x720] [--expect-white]
//!   capture_probe cameras [--frames 30] [--v4l2] [--expect-device "Rig camera"]
//!
//! Screens: X11 and Windows produce one frame per `capture_frame`, so the cap is this pacer's;
//! PipeWire (Wayland) also gets it through `set_max_frame_rate`. Cameras: PipeWire over our own
//! connection to the daemon (no portal), else `--v4l2`; DirectShow on Windows.

use livekit::webrtc::desktop_capturer::{
    CaptureError, DesktopCaptureSourceType, DesktopCapturer, DesktopCapturerOptions,
};
use livekit::webrtc::native::camera_capturer::{
    CameraBackend, CameraCapability, CameraCapturer, CameraDevice,
};
use livekit::webrtc::video_frame::VideoBuffer as _;
use std::process::ExitCode;
use std::sync::mpsc;
use std::time::{Duration, Instant};

fn arg(args: &[String], name: &str) -> Option<String> {
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1).cloned())
}

fn flag(args: &[String], name: &str) -> bool {
    args.iter().any(|a| a == name)
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let result = match args.first().map(String::as_str) {
        Some("screens") => screens(&args),
        Some("cameras") => cameras(&args),
        _ => Err("usage: capture_probe screens|cameras [options]".into()),
    };
    match result {
        Ok(()) => {
            println!("PROBE ok");
            ExitCode::SUCCESS
        }
        Err(error) => {
            println!("PROBE FAILED: {error}");
            ExitCode::FAILURE
        }
    }
}

struct Frame {
    at: Instant,
    width: i32,
    height: i32,
    stride: u32,
    /// The middle pixel, B, G, R, A.
    middle: [u8; 4],
    /// Pixels in the middle row whose B, G and R are all 255.
    white: usize,
}

fn screens(args: &[String]) -> Result<(), String> {
    let fps: u32 = arg(args, "--fps")
        .map_or(Ok(15), |v| v.parse())
        .map_err(|e| format!("{e}"))?;
    let frames: usize = arg(args, "--frames")
        .map_or(Ok(10), |v| v.parse())
        .map_err(|e| format!("{e}"))?;

    let mut options = DesktopCapturerOptions::new(DesktopCaptureSourceType::Screen);
    options.set_include_cursor(true);
    let mut capturer =
        DesktopCapturer::new(options).ok_or("no screen capturer on this platform or display")?;
    let sources = capturer.get_source_list();
    println!("SCREENS {}", sources.len());
    for source in &sources {
        println!("  {source}");
    }
    let source = sources.first().cloned().ok_or("no screen to capture")?;

    let (tx, rx) = mpsc::channel::<Result<Frame, CaptureError>>();
    capturer.set_max_frame_rate(fps);
    capturer.start_capture(Some(source), move |result| {
        let frame = result.map(|frame| {
            let (width, height, stride) = (frame.width(), frame.height(), frame.stride());
            let data = frame.data();
            let row = (height as usize / 2) * stride as usize;
            let middle_at = row + (width as usize / 2) * 4;
            let middle = [
                data[middle_at],
                data[middle_at + 1],
                data[middle_at + 2],
                data[middle_at + 3],
            ];
            let white = (0..width as usize)
                .filter(|x| data[row + x * 4..row + x * 4 + 3] == [255, 255, 255])
                .count();
            Frame {
                at: Instant::now(),
                width,
                height,
                stride,
                middle,
                white,
            }
        });
        let _ = tx.send(frame);
    });

    // The pacer: one `capture_frame` per tick, so the frame rate can't pass `fps`.
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_time()
        .build()
        .map_err(|e| e.to_string())?;
    let mut got = Vec::new();
    let mut temporary = 0;
    runtime.block_on(async {
        let mut ticks = tokio::time::interval(Duration::from_secs_f64(1.0 / fps as f64));
        ticks.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        while got.len() < frames && temporary < 50 {
            ticks.tick().await;
            capturer.capture_frame();
            match rx.recv_timeout(Duration::from_secs(5)) {
                Ok(Ok(frame)) => got.push(frame),
                Ok(Err(CaptureError::Temporary)) => temporary += 1,
                Ok(Err(CaptureError::Permanent)) => return Err("permanent capture error".into()),
                Err(_) => return Err("no capture result within 5 s".to_string()),
            }
        }
        Ok(())
    })?;
    if got.len() < frames {
        return Err(format!(
            "{temporary} temporary errors, {} frames",
            got.len()
        ));
    }
    for (i, frame) in got.iter().enumerate() {
        println!(
            "FRAME {i} {}x{} stride={} bgra-middle={:?} white-in-middle-row={}",
            frame.width, frame.height, frame.stride, frame.middle, frame.white
        );
    }
    let elapsed = got.last().unwrap().at - got[0].at;
    let measured = (got.len() - 1) as f64 / elapsed.as_secs_f64();
    println!(
        "FPS cap={fps} measured={measured:.2} over {} frames",
        got.len()
    );
    if measured > fps as f64 * 1.1 {
        return Err(format!("{measured:.2} fps is over the {fps} fps cap"));
    }
    if measured < fps as f64 * 0.8 {
        return Err(format!("{measured:.2} fps is well under the {fps} fps cap"));
    }
    let first = &got[0];
    if first.stride < first.width as u32 * 4 {
        return Err("stride below 4 bytes per pixel: not BGRA".into());
    }
    if let Some(size) = arg(args, "--expect-size") {
        let got_size = format!("{}x{}", first.width, first.height);
        if got_size != size {
            return Err(format!("frame is {got_size}, expected {size}"));
        }
    }
    if flag(args, "--expect-white") && got.iter().any(|f| f.white != f.width as usize) {
        return Err("expected a white screen (Xvfb -wr)".into());
    }
    Ok(())
}

fn camera_backend(args: &[String]) -> Result<CameraBackend, String> {
    #[cfg(target_os = "linux")]
    {
        if flag(args, "--v4l2") {
            return Ok(CameraBackend::V4l2);
        }
        // Our own connection, as an unsandboxed client has; libwebrtc takes it over. The portal,
        // which a sandbox needs, is left out.
        let socket = std::env::var_os("PIPEWIRE_REMOTE")
            .map(std::path::PathBuf::from)
            .filter(|path| path.is_absolute())
            .or_else(|| {
                std::env::var_os("XDG_RUNTIME_DIR")
                    .map(|dir| std::path::Path::new(&dir).join("pipewire-0"))
            })
            .ok_or("no PipeWire socket: XDG_RUNTIME_DIR is unset")?;
        let stream = std::os::unix::net::UnixStream::connect(&socket)
            .map_err(|e| format!("{}: {e}", socket.display()))?;
        Ok(CameraBackend::PipeWire {
            fd: Some(stream.into()),
        })
    }
    #[cfg(target_os = "windows")]
    {
        let _ = args;
        Ok(CameraBackend::DirectShow)
    }
}

/// The mode closest to 640x480 at 30 fps, as a camera tile would start.
fn pick(device: &CameraDevice) -> Option<CameraCapability> {
    device.capabilities.iter().copied().min_by_key(|c| {
        (c.width as i64 - 640).abs() + (c.height as i64 - 480).abs() + (c.max_fps as i64 - 30).abs()
    })
}

fn cameras(args: &[String]) -> Result<(), String> {
    let frames: usize = arg(args, "--frames")
        .map_or(Ok(30), |v| v.parse())
        .map_err(|e| format!("{e}"))?;
    let backend = camera_backend(args)?;
    println!("BACKEND {backend:?}");
    let capturer =
        CameraCapturer::new(backend, Duration::from_secs(5)).map_err(|e| e.to_string())?;

    // A PipeWire node's formats arrive after the node: a bounded poll, 5 s.
    let wanted = arg(args, "--expect-device");
    let mut devices = Vec::new();
    for _ in 0..50 {
        devices = capturer.devices();
        let ready = devices.iter().any(|d| {
            !d.capabilities.is_empty() && wanted.as_ref().is_none_or(|name| &d.name == name)
        });
        if ready {
            break;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    println!("CAMERAS {}", devices.len());
    for device in &devices {
        println!("  {:?} id={:?}", device.name, device.unique_id);
        for capability in &device.capabilities {
            println!(
                "    {}x{} @{} {:?}{}",
                capability.width,
                capability.height,
                capability.max_fps,
                capability.format,
                if capability.interlaced {
                    " interlaced"
                } else {
                    ""
                }
            );
        }
    }
    let device = devices
        .iter()
        .find(|d| wanted.as_ref().is_none_or(|name| &d.name == name) && !d.capabilities.is_empty())
        .ok_or("no camera with modes to capture from")?;
    let capability = pick(device).ok_or("no mode")?;
    println!("START {:?} {capability:?}", device.name);

    let (tx, rx) = mpsc::sync_channel::<(Instant, u32, u32, f64)>(frames * 2);
    let started = capturer.start(&device.unique_id, capability, move |frame| {
        let i420 = frame.buffer.to_i420();
        let (y, _, _) = i420.data();
        let mean_luma = y.iter().map(|&v| v as u64).sum::<u64>() as f64 / y.len().max(1) as f64;
        let _ = tx.try_send((Instant::now(), i420.width(), i420.height(), mean_luma));
    });
    if !started {
        return Err("the capture didn't start".into());
    }
    let mut got = Vec::new();
    while got.len() < frames {
        match rx.recv_timeout(Duration::from_secs(5)) {
            Ok(frame) => got.push(frame),
            Err(_) => {
                capturer.stop();
                return Err(format!("{} frames, then none for 5 s", got.len()));
            }
        }
    }
    capturer.stop();
    for (i, (_, width, height, luma)) in got.iter().enumerate().take(3) {
        println!("FRAME {i} I420 {width}x{height} mean-luma={luma:.1}");
    }
    let elapsed = got.last().unwrap().0 - got[0].0;
    let measured = (got.len() - 1) as f64 / elapsed.as_secs_f64();
    println!(
        "FPS mode={} measured={measured:.2} over {} frames",
        capability.max_fps,
        got.len()
    );
    if got
        .iter()
        .any(|&(_, w, h, _)| w != capability.width || h != capability.height)
    {
        return Err("a frame differs from the mode's size".into());
    }
    if measured < capability.max_fps as f64 * 0.8 || measured > capability.max_fps as f64 * 1.1 {
        return Err(format!(
            "{measured:.2} fps for a {} fps mode",
            capability.max_fps
        ));
    }
    if got.windows(2).all(|pair| pair[0].3 == pair[1].3) {
        return Err("the picture never changed: not live frames".into());
    }
    Ok(())
}
