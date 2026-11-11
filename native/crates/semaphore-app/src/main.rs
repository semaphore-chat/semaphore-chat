// No console window on Windows release builds.
#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

use gpui_kit::*;
use semaphore_app::AppConfig;
use semaphore_app::desktop::DesktopServices;
use semaphore_core::platform::AppPaths as _;
use semaphore_platform_desktop::{
    DesktopEvent, DesktopPaths, KeyringSecrets, SystemClock, instance, links,
};
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
    eprintln!(
        "usage: semaphore-app [--server <url>] [semaphore://...] | --probe-media <url> <token>"
    );
    ExitCode::from(2)
}

/// Registers `semaphore://` for this executable, off the main thread: it writes a few small files
/// (Linux) or registry values (Windows), and a failure only means links don't open the app.
///
/// Only a packaged build does this on its own (`SEMAPHORE_PACKAGED=1` in the build environment):
/// until the native app replaces the Electron one, a development build run from a checkout must
/// not take `semaphore://` links away from the installed app. `SEMAPHORE_REGISTER_SCHEME=1` asks
/// for it at run time (to test links), and `=0` forbids it even in a packaged build.
fn register_scheme() {
    let asked = std::env::var("SEMAPHORE_REGISTER_SCHEME").ok();
    let register = match asked.as_deref() {
        Some("1") => true,
        Some("0") => false,
        _ => option_env!("SEMAPHORE_PACKAGED") == Some("1"),
    };
    if !register {
        return;
    }
    let _ = std::thread::Builder::new()
        .name("register-scheme".into())
        .spawn(|| {
            let Some(target) = links::RegisterTarget::from_env() else {
                return;
            };
            match links::register(&target) {
                Ok(links::Registered::Ours) => {}
                Ok(links::Registered::Packaged(entry)) => {
                    log::info!("semaphore:// is registered by {}", entry.display());
                }
                Err(error) => log::warn!("{error}"),
            }
        });
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if let Some(code) = run_media_probe(&args) {
        return code;
    }
    // Links can come anywhere: the OS appends one to the registered command.
    let (link_args, rest): (Vec<String>, Vec<String>) =
        args.into_iter().partition(|arg| links::is_candidate(arg));
    let server_url = match rest.as_slice() {
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

    // One app per user: a second launch hands its links to the first and exits, before it opens
    // anything. If the check itself fails, run anyway rather than not at all.
    let launch = instance::Forward::from_launch(&link_args);
    let primary = match instance::acquire(&instance::default_dir(&data_dir), &launch) {
        Ok(instance::Instance::Forwarded) => {
            log::info!("handed over to the running app");
            return ExitCode::SUCCESS;
        }
        Ok(instance::Instance::Primary(primary)) => Some(primary),
        Err(error) => {
            log::warn!("single instance check failed, starting anyway: {error}");
            None
        }
    };
    register_scheme();

    gpui_kit::application()
        .with_assets(semaphore_app::files::AppAssets)
        .run(move |cx| {
            semaphore_app::init(cx);
            // Before any window or notification: Windows' toasts need the AppUserModelID.
            cx.set_app_identity(links::APP_ID, "Semaphore");
            let settings = semaphore_app::settings::SettingsStore::load(&data_dir);
            let desktop = DesktopServices::start(settings.get().close_to_tray, true, cx);
            if let Some(primary) = primary {
                let sink = desktop.sink.clone();
                primary.serve(move |forward| {
                    sink(DesktopEvent::Opened {
                        urls: forward.urls,
                        activation_token: forward.activation_token,
                    })
                });
            }
            let cold_start_links = desktop.sink.clone();
            let config = AppConfig {
                secrets: Arc::new(KeyringSecrets::new()),
                clock: Arc::new(SystemClock),
                server_url,
                time: TimeFormat::default(),
                scrollbar: true,
                settings,
                data_dir,
                watch_os: true,
                audio: None,
                video_sources: None,
                screen_capture: None,
                heartbeat: semaphore_app::voice::HEARTBEAT,
            };
            let bounds =
                semaphore_app::desktop::opening_bounds(config.settings.get().window.as_ref(), cx);
            let options = semaphore_app::window_options(WindowOptions {
                window_bounds: Some(bounds),
                app_id: Some(links::APP_ID.into()),
                titlebar: Some(TitlebarOptions {
                    title: Some("Semaphore".into()),
                    ..Default::default()
                }),
                ..WindowOptions::default()
            });
            let mut app_root = None;
            gpui_kit::open_window(options, cx, |window, cx| {
                let (root, app) = semaphore_app::build_root(config, window, cx);
                semaphore_app::desktop::remember_window(&app, window, cx);
                semaphore_app::desktop::attach(desktop, &app, window, cx);
                app_root = Some(app);
                root
            })
            .expect("failed to open the main window");
            // This launch's own links, through the same path as a second launch's.
            if !launch.urls.is_empty() {
                cold_start_links(DesktopEvent::Opened {
                    urls: launch.urls,
                    activation_token: None,
                });
            }
            // Closing the window quits unless it hid to the tray (see `desktop`), and a quit ends
            // the socket and core first.
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
