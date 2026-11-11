// No console window on Windows release builds.
#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

use gpui_kit::*;
use semaphore_app::AppConfig;
use semaphore_core::platform::AppPaths as _;
use semaphore_platform_desktop::{DesktopPaths, KeyringSecrets, SystemClock};
use semaphore_ui::messages::TimeFormat;
use std::process::ExitCode;
use std::sync::Arc;

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

/// Log lines to stderr, at `SEMAPHORE_LOG` (error, warn, info, debug, trace; warn by default).
struct StderrLog(log::LevelFilter);

impl log::Log for StderrLog {
    fn enabled(&self, metadata: &log::Metadata) -> bool {
        metadata.level() <= self.0
    }

    fn log(&self, record: &log::Record) {
        if self.enabled(record.metadata()) {
            eprintln!("{} {}: {}", record.level(), record.target(), record.args());
        }
    }

    fn flush(&self) {}
}

fn init_logging() {
    let level = std::env::var("SEMAPHORE_LOG")
        .ok()
        .and_then(|level| level.parse().ok())
        .unwrap_or(log::LevelFilter::Warn);
    if log::set_boxed_logger(Box::new(StderrLog(level))).is_ok() {
        log::set_max_level(level);
    }
}

fn usage() -> ExitCode {
    eprintln!("usage: semaphore-app [--server <url>] | --probe-media <url> <token>");
    ExitCode::from(2)
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if let Some(code) = run_media_probe(&args) {
        return code;
    }
    let server_url = match args.as_slice() {
        [] => None,
        [flag, url] if flag == "--server" => Some(url.clone()),
        _ => return usage(),
    };
    init_logging();
    let Some(data_dir) =
        DesktopPaths::new().map(|paths| std::path::PathBuf::from(paths.data_dir()))
    else {
        eprintln!("semaphore-app: the OS reports no home directory");
        return ExitCode::FAILURE;
    };

    gpui_kit::application()
        .with_assets(semaphore_app::files::AppAssets)
        .run(move |cx| {
            semaphore_app::init(cx);
            let config = AppConfig {
                secrets: Arc::new(KeyringSecrets::new()),
                clock: Arc::new(SystemClock),
                server_url,
                time: TimeFormat::default(),
                scrollbar: true,
                settings: semaphore_app::settings::SettingsStore::load(&data_dir),
                data_dir,
                watch_os: true,
                audio: None,
                video_sources: None,
                screen_capture: None,
                heartbeat: semaphore_app::voice::HEARTBEAT,
            };
            let options = semaphore_app::window_options(WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(Bounds::centered(
                    None,
                    size(px(1280.), px(800.)),
                    cx,
                ))),
                app_id: Some("app.semaphorechat.semaphore".into()),
                titlebar: Some(TitlebarOptions {
                    title: Some("Semaphore".into()),
                    ..Default::default()
                }),
                ..WindowOptions::default()
            });
            let mut app_root = None;
            gpui_kit::open_window(options, cx, |window, cx| {
                let (root, app) = semaphore_app::build_root(config, window, cx);
                app_root = Some(app);
                root
            })
            .expect("failed to open the main window");
            // Closing the window quits, and a quit ends the socket and core first.
            cx.on_window_closed(|cx, _| cx.quit()).detach();
            if let Some(app) = app_root {
                cx.on_app_quit(move |cx| {
                    app.update(cx, |app, _| app.shutdown());
                    async {}
                })
                .detach();
            }
        });
    ExitCode::SUCCESS
}
