// No console window on Windows release builds.
#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

use gpui_kit::*;
use semaphore_app::AppConfig;
use semaphore_app::desktop::DesktopServices;
use semaphore_core::platform::AppPaths as _;
use semaphore_platform_desktop::update::InstallKind;
use semaphore_platform_desktop::{
    DesktopEvent, DesktopPaths, KeyringSecrets, SystemClock, instance, links,
};
use semaphore_ui::messages::TimeFormat;
use std::process::ExitCode;
use std::rc::Rc;
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

/// The binary's name in `--version` and `--help`.
const NAME: &str = env!("CARGO_PKG_NAME");

const USAGE: &str =
    "usage: semaphore-app [--server <url>] | [--] semaphore://... | --probe-media <url> <token>";

/// How long a build started by "Restart to update" waits for the previous app to shut down and
/// release the single-instance lock. Shutting down is quick; this only bounds a hung one.
#[cfg(unix)]
const AFTER_UPDATE_PATIENCE: std::time::Duration = std::time::Duration::from_secs(60);

fn usage() -> ExitCode {
    semaphore_app::logging::stderr_line(format_args!("{USAGE}"));
    ExitCode::from(2)
}

/// Makes this app the handler for `semaphore://`, or takes its registration away, as the Desktop
/// App tab's "Open semaphore:// links with this app" asks. Off the main thread: it writes a few
/// small files (Linux) or registry values (Windows), and a failure only means links don't open
/// this app.
///
/// With the setting never touched, today's behaviour by build: a packaged build
/// (`SEMAPHORE_PACKAGED=1` in the build environment) registers, and a development build doesn't,
/// so a checkout can't take `semaphore://` links away from the installed app.
/// `SEMAPHORE_REGISTER_SCHEME=1` asks for it at run time (to test links), and `=0` forbids any
/// change, whatever the setting says.
fn register_scheme(data_dir: &std::path::Path) {
    let asked = std::env::var("SEMAPHORE_REGISTER_SCHEME").ok();
    if asked.as_deref() == Some("0") {
        return;
    }
    let settings = semaphore_app::settings::SettingsStore::load(data_dir);
    let open_links = match asked.as_deref() {
        Some("1") => true,
        _ => settings
            .get()
            .open_links
            .unwrap_or_else(|| option_env!("SEMAPHORE_PACKAGED") == Some("1")),
    };
    let _ = std::thread::Builder::new()
        .name("register-scheme".into())
        .spawn(move || {
            // The same table the settings switch goes through, so a start and a click agree.
            use semaphore_app::desktop::{DesktopLinks, LinkAction, LinkRegistrar as _};
            // A registration this app wrote in an older form (Windows: no `--` before the link)
            // is still ours: rewritten now, before anything reads it.
            if open_links
                && let Some(target) = semaphore_platform_desktop::links::RegisterTarget::from_env()
            {
                match semaphore_platform_desktop::links::upgrade(&target) {
                    Ok(true) => {
                        log::info!("rewrote the semaphore:// registration in its current form")
                    }
                    Ok(false) => {}
                    Err(error) => log::warn!("updating the semaphore:// registration: {error}"),
                }
            }
            let links = DesktopLinks::from_env();
            match semaphore_app::desktop::link_action(open_links, links.status()) {
                LinkAction::Nothing => {}
                LinkAction::Register => {
                    if let Err(error) = links.register() {
                        log::warn!("registering semaphore:// links: {error}");
                    }
                }
                LinkAction::Unregister => {
                    if let Err(error) = links.unregister() {
                        log::warn!("unregistering semaphore:// links: {error}");
                    }
                }
            }
        });
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    // These load the binary and its libraries and exit before any window, keyring or socket:
    // `scripts/test-packages.sh` uses `--version` as the package smoke test.
    if let [flag] = args.as_slice() {
        match flag.as_str() {
            "--version" | "-V" => {
                println!("{NAME} {}", semaphore_app::version());
                return ExitCode::SUCCESS;
            }
            "--help" | "-h" => {
                println!("{USAGE}");
                return ExitCode::SUCCESS;
            }
            _ => {}
        }
    }
    if let Some(code) = run_media_probe(&args) {
        return code;
    }
    // Links come from the OS, after `--` in the registered command: a link launch takes its links
    // and nothing else (see `semaphore_app::launch`).
    let Ok(semaphore_app::launch::Launch {
        links: link_args,
        server_url,
        after_update,
    }) = semaphore_app::launch::parse(&args)
    else {
        return usage();
    };
    let Some(data_dir) =
        DesktopPaths::new().map(|paths| std::path::PathBuf::from(paths.data_dir()))
    else {
        eprintln!("semaphore-app: the OS reports no home directory");
        return ExitCode::FAILURE;
    };
    // `SEMAPHORE_LOG` as before, to stderr; the size-capped files under the data directory join
    // once this process is the app (below), so a launch that only forwards a link never writes
    // into or rotates the running app's files.
    let level = semaphore_app::logging::init();
    let log_dir = semaphore_app::logging::logs_dir(&data_dir);
    semaphore_app::crash::install(&log_dir);

    // One app per user: a second launch hands its links to the first and exits, before it opens
    // anything. If the check itself fails, run anyway rather than not at all.
    let launch = instance::Forward::from_launch(&link_args);
    let instance_dir = instance::default_dir(&data_dir);
    // The build an update started waits for the old app to let go instead of forwarding to it.
    #[cfg(unix)]
    let handover = after_update.then(|| {
        instance::acquire_after_update(&instance_dir, AFTER_UPDATE_PATIENCE)
            .map(instance::Instance::Primary)
    });
    #[cfg(not(unix))]
    let handover: Option<std::io::Result<instance::Instance>> = {
        let _ = after_update;
        None
    };
    if let Some(Err(error)) = &handover
        && error.kind() == std::io::ErrorKind::TimedOut
    {
        // The previous version is still running (it holds the lock): that one stays.
        eprintln!("semaphore-app: the previous version is still running ({error}); not starting");
        return ExitCode::FAILURE;
    }
    let acquired = match handover {
        Some(result) => result,
        None => instance::acquire(&instance_dir, &launch),
    };
    let primary = match acquired {
        Ok(instance::Instance::Forwarded) => {
            log::info!("handed over to the running app");
            return ExitCode::SUCCESS;
        }
        Ok(instance::Instance::Primary(primary)) => Ok(primary),
        Err(error) => Err(error),
    };
    // This process is the app now (or runs anyway): its files.
    semaphore_app::logging::attach_files(&data_dir);
    log::info!(
        "Semaphore Chat {} starting on {} {} ({level} logging)",
        semaphore_app::version(),
        std::env::consts::OS,
        std::env::consts::ARCH
    );
    // A panic in a previous run left a report: say so here and do nothing else with it.
    if let Some(report) = semaphore_app::crash::newest_report(&log_dir) {
        log::warn!(
            "a crash report from a previous run is at {}",
            report.display()
        );
    }
    let primary = match primary {
        Ok(primary) => Some(primary),
        Err(error) => {
            log::warn!("single instance check failed, starting anyway: {error}");
            None
        }
    };
    register_scheme(&data_dir);

    // The answering primary: released explicitly once the event loop has ended (after shutdown),
    // which is the moment an updated build waiting on the lock takes over.
    let serving: Arc<std::sync::Mutex<Option<instance::ServingInstance>>> = Arc::default();
    let serving_slot = serving.clone();
    let restart_server_url = server_url.clone();
    gpui_kit::application()
        .with_assets(semaphore_app::files::AppAssets)
        .run(move |cx| {
            semaphore_app::init(cx);
            // Before any window or notification: Windows' toasts need the AppUserModelID.
            cx.set_app_identity(links::APP_ID, "Semaphore");
            // First run only: the Electron app's non-secret settings, when it has a file.
            match semaphore_app::electron_import::import_once(&data_dir) {
                semaphore_app::electron_import::Import::Imported { close_to_tray } => {
                    log::info!(
                        "imported the Electron app's settings: close to tray = {close_to_tray}"
                    );
                }
                semaphore_app::electron_import::Import::Failed(error) => {
                    log::warn!("importing the Electron app's settings failed: {error}");
                }
                semaphore_app::electron_import::Import::Nothing(_) => {}
            }
            let settings = semaphore_app::settings::SettingsStore::load(&data_dir);
            // W13: the updater runs only if this build has a feed and this install can update;
            // `update` also carries why not, for the settings row.
            let update = semaphore_app::update::start();
            let restart_path = match &update {
                semaphore_app::update::UpdateStart::On(options) => match &options.install {
                    InstallKind::AppImage { path } => Some(path.clone()),
                    _ => None,
                },
                semaphore_app::update::UpdateStart::Off(_) => None,
            };
            let desktop = DesktopServices::start(settings.get().close_to_tray, true, cx);
            if let Some(primary) = primary {
                let sink = desktop.sink.clone();
                let answering = primary.serve(move |forward| {
                    sink(DesktopEvent::Opened {
                        urls: forward.urls,
                        activation_token: forward.activation_token,
                    })
                });
                *serving_slot
                    .lock()
                    .unwrap_or_else(|poison| poison.into_inner()) = Some(answering);
            }
            let cold_start_links = desktop.sink.clone();
            let config = AppConfig {
                update,
                // The new build starts now, while this app still holds the lock; it waits for the
                // lock (`--after-update`), which this process releases after shutting down. A
                // build that can't be started leaves this app running and says why.
                restart: Some(Rc::new(move |cx: &mut App| {
                    let Some(path) = &restart_path else {
                        return Err("this installation doesn't restart itself".into());
                    };
                    let mut command = semaphore_app::update::restart_command(
                        path,
                        restart_server_url.as_deref(),
                        std::env::vars_os(),
                    );
                    match command.spawn() {
                        Ok(_child) => {
                            log::info!("started {}; quitting to hand over", path.display());
                            cx.quit();
                            Ok(())
                        }
                        Err(error) => {
                            Err(format!("{} could not be started: {error}", path.display()))
                        }
                    }
                })),
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
                notifier: desktop.notifier.clone(),
                open_url: None,
                pick_files: None,
                save_path: None,
                links: Some(Arc::new(semaphore_app::desktop::DesktopLinks::from_env())),
                keep_awake: Some(Arc::new(
                    semaphore_platform_desktop::keep_awake::DesktopKeepAwake::new(),
                )),
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
    // Everything has shut down: stop answering, remove the socket, unlock. An updated build
    // waiting with `--after-update` becomes the primary now. (Were this never reached, the
    // kernel drops the lock when the process ends, with the same result.)
    let answering = serving
        .lock()
        .unwrap_or_else(|poison| poison.into_inner())
        .take();
    if let Some(answering) = answering {
        answering.release();
    }
    ExitCode::SUCCESS
}
