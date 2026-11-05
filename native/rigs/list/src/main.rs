//! Real-window runs under a compositor. Input is injected in-process through `dispatch_event`,
//! so it takes the same path as compositor input after the platform layer: real hit testing, real
//! text shaping, and the real renderer.
//!
//!   rig-list fling  --out x.json [--arm rows|textview|real] [--image-cache lru|global] [--messages N] [--up-secs S]
//!   rig-list idle-real --out x.json
//!   rig-list jump   --out x.json
//!   rig-list select --out x.json [--shot-wait-file PATH]
//!   rig-list idle   --out x.json

use anyhow::{Context as _, Result, bail};
use gpui_kit::base::TextSelectionLayer;
use gpui_kit::base::text::{TextView, TextViewState};
use gpui_kit::prelude::*;
use gpui_kit::*;
use rig_list::assets::{build_emoji, ensure_images};
use rig_list::data::{ANIMATED_FROM, Kind, Seg, Store, copy_range, generate, truth};
use rig_list::lru::LruImageCache;
use rig_list::selection::Selection;
use rig_list::textdoc::{EmojiPlugin, message_markdown};
use rig_list::view::{MessageListView, Shared};
use semaphore_ui::messages::{self, ListData, ListOptions, ListStatus, MessageList, synth};
use serde_json::{Value, json};
use std::cell::{Cell, RefCell};
use std::path::PathBuf;
use std::rc::Rc;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

#[derive(Clone)]
struct Args {
    mode: String,
    out: PathBuf,
    arm: String,
    image_cache: String,
    messages: usize,
    up_secs: f64,
    down_secs: f64,
    mid_secs: f64,
    v0: f64,
    image_dir: PathBuf,
    wait_file: Option<PathBuf>,
    no_images: bool,
}

fn parse_args() -> Result<Args> {
    let mut raw = std::env::args().skip(1);
    let mode = raw.next().context("mode: fling, jump or select")?;
    let mut args = Args {
        mode,
        out: PathBuf::from("/tmp/rig-list.json"),
        arm: "rows".into(),
        image_cache: "lru".into(),
        messages: 100_000,
        up_secs: 30.,
        down_secs: 10.,
        mid_secs: 10.,
        v0: 9000.,
        image_dir: PathBuf::from("/tmp/rig-list-images"),
        wait_file: None,
        no_images: false,
    };
    while let Some(flag) = raw.next() {
        if flag == "--no-images" {
            args.no_images = true;
            continue;
        }
        let value = raw
            .next()
            .with_context(|| format!("{flag} needs a value"))?;
        match flag.as_str() {
            "--out" => args.out = value.into(),
            "--arm" => args.arm = value,
            "--image-cache" => args.image_cache = value,
            "--messages" => args.messages = value.parse()?,
            "--up-secs" => args.up_secs = value.parse()?,
            "--down-secs" => args.down_secs = value.parse()?,
            "--mid-secs" => args.mid_secs = value.parse()?,
            "--v0" => args.v0 = value.parse()?,
            "--image-dir" => args.image_dir = value.into(),
            "--shot-wait-file" => args.wait_file = Some(value.into()),
            other => bail!("unknown flag {other}"),
        }
    }
    Ok(args)
}

fn memory_mb() -> Value {
    let text = std::fs::read_to_string("/proc/self/smaps_rollup").unwrap_or_default();
    let read = |key: &str| {
        text.lines()
            .find(|line| line.starts_with(key))
            .and_then(|line| line.split_whitespace().nth(1))
            .and_then(|kb| kb.parse::<f64>().ok())
            .map(|kb| (kb / 1024.0 * 10.0).round() / 10.0)
    };
    // Swapped pages leave PSS and RSS, and on a host under memory pressure they can look like a
    // sudden release. Report them, so a drop can be told apart from one.
    json!({ "pss": read("Pss:"), "rss": read("Rss:"), "anon": read("Anonymous:"), "swap": read("Swap:") })
}

fn cpu_seconds() -> f64 {
    let stat = std::fs::read_to_string("/proc/self/stat").unwrap_or_default();
    let fields: Vec<&str> = stat
        .rsplit(')')
        .next()
        .unwrap_or("")
        .split_whitespace()
        .collect();
    let ticks = fields
        .get(11)
        .and_then(|v| v.parse::<f64>().ok())
        .unwrap_or(0.)
        + fields
            .get(12)
            .and_then(|v| v.parse::<f64>().ok())
            .unwrap_or(0.);
    ticks / 100.0
}

fn loadavg() -> String {
    std::fs::read_to_string("/proc/loadavg")
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn pct(sorted: &[f64], p: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    sorted[((p / 100.0 * (sorted.len() - 1) as f64).round() as usize).min(sorted.len() - 1)]
}

fn round2(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

/// Present times and build costs per phase.
#[derive(Default)]
struct FrameLog {
    phase: String,
    started_at: Option<Instant>,
    presents: Vec<(String, Instant, f64)>,
}

impl FrameLog {
    fn summary(&self, phase: &str) -> Value {
        let frames: Vec<&(String, Instant, f64)> =
            self.presents.iter().filter(|f| f.0 == phase).collect();
        let mut intervals: Vec<f64> = frames
            .windows(2)
            .map(|w| w[1].1.duration_since(w[0].1).as_secs_f64() * 1000.0)
            .collect();
        // Each slow interval with the CPU cost of the frame that ended it.
        let mut slowest: Vec<(f64, f64)> = frames
            .windows(2)
            .map(|w| (w[1].1.duration_since(w[0].1).as_secs_f64() * 1000.0, w[1].2))
            .collect();
        slowest.sort_by(|a, b| b.0.total_cmp(&a.0));
        slowest.truncate(5);
        let mut build: Vec<f64> = frames.iter().map(|f| f.2).collect();
        intervals.sort_by(f64::total_cmp);
        build.sort_by(f64::total_cmp);
        let median = pct(&intervals, 50.);
        json!({
            "frames": frames.len(),
            "present_interval_ms": {
                "p50": round2(median),
                "p95": round2(pct(&intervals, 95.)),
                "p99": round2(pct(&intervals, 99.)),
                "max": round2(intervals.last().copied().unwrap_or(0.)),
            },
            "fps_mean": if intervals.is_empty() { 0.0 } else { round2(1000.0 * intervals.len() as f64 / intervals.iter().sum::<f64>()) },
            "missed_vsyncs": intervals.iter().filter(|i| **i > median * 1.5).count(),
            "over_16_7": intervals.iter().filter(|i| **i > 16.7).count(),
            "over_20": intervals.iter().filter(|i| **i > 20.0).count(),
            "slowest_interval_and_frame_cost_ms": slowest.iter().map(|(i, c)| [round2(*i), round2(*c)]).collect::<Vec<_>>(),
            "frame_cost_ms": { "p50": round2(pct(&build, 50.)), "p99": round2(pct(&build, 99.)), "max": round2(build.last().copied().unwrap_or(0.)) },
        })
    }
}

/// Scrolling phases, advanced once per frame.
struct Fling {
    phases: Vec<(String, f64, f64)>,
    index: usize,
    phase_started: Instant,
    last: Instant,
    velocity: f64,
    v0: f64,
    distance: f64,
    distance_by_phase: Vec<f64>,
}

impl Fling {
    /// Pixels to move this frame, or None when every phase is done.
    fn advance(&mut self) -> Option<(f64, bool)> {
        const TAU: f64 = 0.5;
        let now = Instant::now();
        let dt = now.duration_since(self.last).as_secs_f64();
        self.last = now;
        let (_, seconds, _) = self.phases.get(self.index)?.clone();
        let mut changed = false;
        if now.duration_since(self.phase_started).as_secs_f64() >= seconds {
            self.distance_by_phase.push(self.distance);
            self.distance = 0.0;
            self.index += 1;
            self.phase_started = now;
            self.velocity = 0.0;
            changed = true;
            self.phases.get(self.index)?;
        }
        let (_, _, direction_now) = self.phases[self.index].clone();
        self.velocity *= (-dt / TAU).exp();
        if self.velocity.abs() < 300.0 {
            self.velocity = self.v0 * direction_now;
        }
        let delta = self.velocity * dt;
        self.distance += delta.abs();
        Some((delta, changed))
    }
}

/// The real arm's root: the slice's list, with a frame hook around it.
struct RealRoot {
    list: Entity<MessageList>,
    after_present: Rc<dyn Fn(&mut App)>,
}

impl Render for RealRoot {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let hook = self.after_present.clone();
        cx.defer(move |cx| hook(cx));
        div().size_full().child(self.list.clone())
    }
}

fn open_real_list(
    messages: usize,
    image_dir: PathBuf,
    cx: &mut Context<RealRoot>,
) -> Entity<MessageList> {
    cx.new(|cx| {
        MessageList::new(
            ListData {
                me_id: "me".into(),
                rows: synth::rows(0, messages),
                replies: Default::default(),
                status: ListStatus::Ready,
            },
            Rc::new(synth::SynthMedia::new(Some(image_dir))),
            ListOptions::default(),
            cx,
        )
    })
}

/// Arm B's root.
struct DocumentRoot {
    state: Entity<TextViewState>,
    after_present: Rc<dyn Fn(&mut App)>,
}

impl Render for DocumentRoot {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let hook = self.after_present.clone();
        cx.defer(move |cx| hook(cx));
        div()
            .size_full()
            .bg(rgb(0x1e1f22))
            .text_color(rgb(0xdcddde))
            .font_family("DejaVu Sans")
            .child(TextSelectionLayer)
            .child(
                TextView::new(&self.state)
                    .selectable(true)
                    .scrollable(true)
                    .plugin(EmojiPlugin),
            )
    }
}

fn window_options() -> WindowOptions {
    messages::with_list_frame_policy(WindowOptions {
        window_bounds: Some(WindowBounds::Windowed(Bounds {
            origin: Default::default(),
            size: size(px(1920.), px(1080.)),
        })),
        focus: true,
        show: true,
        // Headless sway has no seat, so the window never becomes active and GPUI would hold it to
        // its inactive rate. A real focused window has no such limit.
        inactive_frame_interval: None,
        low_power_frame_interval: None,
        thermal_frame_interval: None,
        ..Default::default()
    })
}

fn write_json(path: &PathBuf, value: &Value) {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    std::fs::write(
        path,
        serde_json::to_string_pretty(value).expect("json") + "\n",
    )
    .expect("writing the result");
}

// ------------------------------------------------------------------ fling

fn run_fling(args: Args, cx: &mut App) {
    let load_start = loadavg();
    let log = Rc::new(RefCell::new(FrameLog {
        phase: "warmup".into(),
        ..Default::default()
    }));
    let hook_log = log.clone();
    let after_present: Rc<dyn Fn(&mut App)> = Rc::new(move |_| {
        let mut log = hook_log.borrow_mut();
        let now = Instant::now();
        let cost = log
            .started_at
            .map_or(0.0, |s| now.duration_since(s).as_secs_f64() * 1000.0);
        let phase = log.phase.clone();
        log.presents.push((phase, now, cost));
    });
    let setup_started = Instant::now();

    enum Root {
        Rows(Entity<MessageListView>),
        Document(Entity<DocumentRoot>),
        Real(Entity<RealRoot>),
    }
    let mut parse_ms = None;
    let mut cache_stats: Rc<dyn Fn(&App) -> Value> = Rc::new(|_| Value::Null);
    let root: Root;
    let args_for_root = args.clone();
    let any_handle: AnyWindowHandle;
    if args.arm == "textview" {
        let source = (0..args.messages as i64)
            .map(|id| message_markdown(&generate(id)))
            .collect::<Vec<_>>()
            .join("\n\n");
        let parse_started = Instant::now();
        let (handle, entity) = gpui_kit::open_window(window_options(), cx, |_, cx| {
            let state = cx.new(|cx| TextViewState::markdown(&source, cx));
            cx.new(|_| DocumentRoot {
                state,
                after_present,
            })
        })
        .expect("opening the window");
        parse_ms = Some(round2(parse_started.elapsed().as_secs_f64() * 1000.0));
        any_handle = handle;
        root = Root::Document(entity);
    } else if args.arm == "real" {
        // No `MALLOC_MMAP_THRESHOLD_` here: `messages::init` sets it in-process.
        messages::init(cx);
        ensure_images(&args.image_dir).expect("generating images");
        let image_dir = args.image_dir.clone();
        let messages = args.messages;
        let (handle, entity) = gpui_kit::open_window(window_options(), cx, move |_, cx| {
            cx.new(|cx| RealRoot {
                list: open_real_list(messages, image_dir, cx),
                after_present,
            })
        })
        .expect("opening the window");
        let list = entity.read(cx).list.clone();
        cache_stats = Rc::new(move |cx| {
            let (held, small, evicted) = list.read(cx).image_cache_stats(cx);
            json!({ "evicted": evicted, "held_mb": (held / (1024 * 1024)) as u64, "small_mb": (small / (1024 * 1024)) as u64 })
        });
        any_handle = handle;
        root = Root::Real(entity);
    } else {
        ensure_images(&args.image_dir).expect("generating images");
        let shared = Shared::new(
            Store::new(0, args.messages),
            build_emoji(),
            args.image_dir.clone(),
        );
        shared.images_off.set(args_for_root.no_images);
        let images =
            (args_for_root.image_cache == "lru").then(|| LruImageCache::new(128 * 1024 * 1024, cx));
        if let Some(images) = images.clone() {
            cache_stats = Rc::new(move |cx| {
                let cache = images.read(cx);
                json!({ "evicted": cache.evicted, "held_mb": (cache.bytes() / (1024 * 1024)) as u64 })
            });
        }
        let (handle, entity) = gpui_kit::open_window(window_options(), cx, move |_, cx| {
            cx.new(|cx| {
                let mut view = MessageListView::new(shared, images, cx);
                view.after_present = Some(after_present);
                view
            })
        })
        .expect("opening the window");
        any_handle = handle;
        root = Root::Rows(entity);
    }
    let store_ready_ms = round2(setup_started.elapsed().as_secs_f64() * 1000.0);
    let memory_at_start = memory_mb();

    let phases = vec![
        ("fling_up".to_string(), args.up_secs, 1.0),
        ("fling_down".to_string(), args.down_secs, -1.0),
        ("jump_mid_fling_up".to_string(), args.mid_secs, 1.0),
    ];
    let fling = Rc::new(RefCell::new(Fling {
        phases,
        index: 0,
        phase_started: Instant::now(),
        last: Instant::now(),
        velocity: 0.0,
        v0: args.v0,
        distance: 0.0,
        distance_by_phase: Vec::new(),
    }));
    let sampler = Sampler::start();
    let root = Rc::new(root);
    let cpu_at_start = Rc::new(Cell::new(0f64));

    // After a warmup, start the frame loop.
    let args2 = args.clone();
    let warmup_log = log.clone();
    cx.spawn(async move |cx| {
        let warmup_started = Instant::now();
        // Bounded wait until the window really is presenting.
        // A still window has no reason to keep presenting, so a few frames are enough.
        while warmup_log.borrow().presents.len() < 3 && warmup_started.elapsed() < Duration::from_secs(120) {
            cx.background_executor().timer(Duration::from_millis(20)).await;
        }
        let presented = warmup_log.borrow().presents.len();
        if presented < 3 {
            eprintln!("no frames after 120 s: {presented}");
            std::process::exit(3);
        }
        any_handle
            .update(cx, |_, window, cx| {
                cpu_at_start.set(cpu_seconds());
                fling.borrow_mut().phase_started = Instant::now();
                fling.borrow_mut().last = Instant::now();
                log.borrow_mut().phase = "fling_up".into();
                let driver = Rc::new(Driver {
                    args: args2.clone(),
                    fling: fling.clone(),
                    log: log.clone(),
                    root_notify: {
                        let root = root.clone();
                        Rc::new(move |cx: &mut App| match &*root {
                            Root::Rows(view) => view.update(cx, |_, cx| cx.notify()),
                            Root::Document(view) => view.update(cx, |_, cx| cx.notify()),
                            Root::Real(view) => view.update(cx, |_, cx| cx.notify()),
                        })
                    },
                    jump_mid: {
                        let root = root.clone();
                        Rc::new(move |id: i64, cx: &mut App| match &*root {
                            Root::Rows(view) => view.update(cx, |view, cx| {
                                view.scroll_to_id(id, 0.);
                                cx.notify();
                            }),
                            Root::Document(view) => view.update(cx, |view, cx| {
                                view.state.read(cx).list_state().scroll_to(ListOffset { item_ix: id as usize, offset_in_item: px(0.) });
                                cx.notify();
                            }),
                            Root::Real(view) => view.update(cx, |view, cx| {
                                view.list.read(cx).scroll_to_seq(id, 0.);
                                cx.notify();
                            }),
                        })
                    },
                    cache_stats: cache_stats.clone(),
                    finish: RefCell::new(Some(Box::new({
                        let log = log.clone();
                        let fling = fling.clone();
                        let sampler = sampler.clone();
                        let cpu_at_start = cpu_at_start.clone();
                        let load_start = load_start.clone();
                        let memory_at_start = memory_at_start.clone();
                        let args = args2.clone();
                        move |evicted: Value| {
                            let log = log.borrow();
                            let fling = fling.borrow();
                            let wall = (args.up_secs + args.down_secs + args.mid_secs).max(1.0);
                            let result = json!({
                                "scenario": "fling",
                                "arm": args.arm,
                                "image_cache": args.image_cache,
                                "messages": args.messages,
                                "v0_px_per_s": args.v0,
                                "setup_ms": store_ready_ms,
                                "textview_open_ms": parse_ms,
                                "phases": {
                                    "fling_up": log.summary("fling_up"),
                                    "fling_down": log.summary("fling_down"),
                                    "jump_mid_fling_up": log.summary("jump_mid_fling_up"),
                                },
                                "distance_px": fling.distance_by_phase,
                                "cpu_pct_core_avg": round2((cpu_seconds() - cpu_at_start.get()) / wall * 100.0),
                                "memory_mb": { "start": memory_at_start, "end": memory_mb(), "pss_peak": sampler.peak_pss(), "series": sampler.series() },
                                "image_cache_stats": evicted,
                                "load": { "start": load_start, "end": loadavg(), "peak_load1": sampler.peak_load() },
                            });
                            write_json(&args.out, &result);
                        }
                    }))),
                });
                drive(driver, window, cx);
            })
            .ok();
    })
    .detach();
}

/// Samples memory and load once a second on its own thread. Reading `smaps_rollup` takes
/// milliseconds, and on the frame loop it would be the thing being measured.
#[derive(Clone)]
struct Sampler(Arc<Mutex<Vec<(Value, f64)>>>);

impl Sampler {
    fn start() -> Self {
        let samples = Arc::new(Mutex::new(Vec::new()));
        let writer = samples.clone();
        std::thread::spawn(move || {
            loop {
                let load1 = loadavg()
                    .split_whitespace()
                    .next()
                    .and_then(|v| v.parse::<f64>().ok())
                    .unwrap_or(0.);
                writer
                    .lock()
                    .expect("sampler lock")
                    .push((memory_mb(), load1));
                std::thread::sleep(Duration::from_secs(1));
            }
        });
        Sampler(samples)
    }
    fn series(&self) -> Vec<Value> {
        self.0
            .lock()
            .expect("sampler lock")
            .iter()
            .map(|(memory, _)| memory.clone())
            .collect()
    }
    fn peak_pss(&self) -> f64 {
        self.0
            .lock()
            .expect("sampler lock")
            .iter()
            .filter_map(|(memory, _)| memory["pss"].as_f64())
            .fold(0.0, f64::max)
    }
    fn peak_load(&self) -> f64 {
        self.0
            .lock()
            .expect("sampler lock")
            .iter()
            .map(|(_, load)| *load)
            .fold(0.0, f64::max)
    }
}

type JumpTo = Rc<dyn Fn(i64, &mut App)>;
type Finish = Box<dyn FnOnce(Value)>;

struct Driver {
    args: Args,
    fling: Rc<RefCell<Fling>>,
    log: Rc<RefCell<FrameLog>>,
    root_notify: Rc<dyn Fn(&mut App)>,
    jump_mid: JumpTo,
    cache_stats: Rc<dyn Fn(&App) -> Value>,
    finish: RefCell<Option<Finish>>,
}

fn drive(driver: Rc<Driver>, window: &mut Window, cx: &mut App) {
    let step = driver.fling.borrow_mut().advance();
    let Some((delta, changed)) = step else {
        if let Some(finish) = driver.finish.borrow_mut().take() {
            finish((driver.cache_stats)(cx));
        }
        cx.quit();
        return;
    };
    if changed {
        let index = driver.fling.borrow().index;
        let phase = driver.fling.borrow().phases[index].0.clone();
        driver.log.borrow_mut().phase = phase.clone();
        if phase == "jump_mid_fling_up" {
            (driver.jump_mid)(driver.args.messages as i64 / 2, cx);
        }
    }
    driver.log.borrow_mut().started_at = Some(Instant::now());
    let center = point(
        window.bounds().size.width / 2.,
        window.bounds().size.height / 2.,
    );
    window.dispatch_event(
        PlatformInput::Scroll(ScrollEvent {
            position: center,
            delta: ScrollDelta::Pixels(point(px(0.), px(delta as f32))),
            modifiers: Modifiers::default(),
            touch_phase: TouchPhase::Moved,
            source: Default::default(),
        }),
        cx,
    );
    (driver.root_notify)(cx);
    let next = driver.clone();
    window.on_next_frame(move |window, cx| drive(next, window, cx));
}

// ------------------------------------------------------------------ scripted runs

/// A frame counter, so a script waits for frames rather than for a guessed time.
#[derive(Clone)]
struct Frames(Rc<Cell<u64>>);

impl Frames {
    async fn wait(&self, count: u64, cx: &mut AsyncApp) {
        let target = self.0.get() + count;
        let started = Instant::now();
        while self.0.get() < target {
            assert!(
                started.elapsed() < Duration::from_secs(60),
                "no frames for 60 s"
            );
            cx.background_executor()
                .timer(Duration::from_millis(1))
                .await;
        }
    }
}

fn open_scripted(
    args: &Args,
    messages: usize,
    cx: &mut App,
) -> (Entity<MessageListView>, AnyWindowHandle, Frames) {
    ensure_images(&args.image_dir).expect("generating images");
    let shared = Shared::new(
        Store::new(0, messages),
        build_emoji(),
        args.image_dir.clone(),
    );
    shared.probe.set(true);
    let images = LruImageCache::new(128 * 1024 * 1024, cx);
    let frames = Frames(Rc::new(Cell::new(0)));
    let counter = frames.0.clone();
    let (handle, view) = gpui_kit::open_window(window_options(), cx, move |_, cx| {
        cx.new(|cx| {
            let mut view = MessageListView::new(shared, Some(images), cx);
            view.after_present = Some(Rc::new(move |_| counter.set(counter.get() + 1)));
            view
        })
    })
    .expect("opening the window");
    (view, handle, frames)
}

/// How far each row painted both before and after moved, in pixels.
fn row_shift(
    before: &std::collections::BTreeMap<i64, f32>,
    after: &std::collections::BTreeMap<i64, f32>,
) -> (usize, f32) {
    let mut common = 0;
    let mut worst = 0f32;
    for (id, top) in before {
        if let Some(now) = after.get(id) {
            common += 1;
            worst = worst.max((now - top).abs());
        }
    }
    (common, worst)
}

fn tops(view: &Entity<MessageListView>, cx: &mut AsyncApp) -> std::collections::BTreeMap<i64, f32> {
    view.read_with(cx, |view, _| view.shared.row_tops.borrow().clone())
}

fn refresh(view: &Entity<MessageListView>, cx: &mut AsyncApp) {
    view.update(cx, |_, cx| cx.notify());
}

/// Finds the image message nearest `from` going forward.
fn next_image_id(from: i64) -> i64 {
    (from..)
        .find(|id| matches!(generate(*id).kind, Kind::Image { .. }))
        .expect("an image exists")
}

fn run_jump(args: Args, cx: &mut App) {
    let load_start = loadavg();
    let (view, handle, frames) = open_scripted(&args, args.messages, cx);
    let out = args.out.clone();
    cx.spawn(async move |cx| {
        let mut results = serde_json::Map::new();
        frames.wait(10, cx).await;
        let (cpu_start, run_start) = (cpu_seconds(), Instant::now());

        // Holds still long enough that the image decodes have finished, so what's measured is
        // the event under test.
        let settle = |view: Entity<MessageListView>, frames: Frames, cx: &mut AsyncApp| {
            let mut cx = cx.clone();
            async move {
                for _ in 0..60 {
                    refresh(&view, &mut cx);
                    frames.wait(1, &mut cx).await;
                }
            }
        };

        // Prepend, held mid-history.
        view.update(cx, |view, cx| {
            view.scroll_to_id(50_000, 37.);
            cx.notify();
        });
        settle(view.clone(), frames.clone(), cx).await;
        let before = tops(&view, cx);
        view.update(cx, |view, cx| view.prepend(5_000, cx));
        settle(view.clone(), frames.clone(), cx).await;
        let (common, worst) = row_shift(&before, &tops(&view, cx));
        results.insert(
            "prepend_5000_mid_history".into(),
            json!({ "rows_compared": common, "max_shift_px": worst }),
        );

        // Prepend, scrolled to the very first row, which is how a real history page arrives.
        view.update(cx, |view, cx| {
            let first = view.shared.store.borrow().first_id();
            view.scroll_to_id(first, 0.);
            cx.notify();
        });
        settle(view.clone(), frames.clone(), cx).await;
        let before = tops(&view, cx);
        view.update(cx, |view, cx| view.prepend(50, cx));
        settle(view.clone(), frames.clone(), cx).await;
        let (common, worst) = row_shift(&before, &tops(&view, cx));
        results.insert(
            "prepend_50_at_top_row".into(),
            json!({ "rows_compared": common, "max_shift_px": worst }),
        );

        // Prepend during a live wheel scroll: each frame the rows must move by what the wheel
        // asked for, plus nothing.
        view.update(cx, |view, cx| {
            view.scroll_to_id(70_000, 0.);
            cx.notify();
        });
        settle(view.clone(), frames.clone(), cx).await;
        let mut worst_error = 0f32;
        let mut compared = 0;
        for frame in 0..120 {
            let before = tops(&view, cx);
            let wheel = 40.0f32;
            let _ = handle.update(cx, |_, window, cx| {
                let center = point(
                    window.bounds().size.width / 2.,
                    window.bounds().size.height / 2.,
                );
                window.dispatch_event(
                    PlatformInput::Scroll(ScrollEvent {
                        position: center,
                        delta: ScrollDelta::Pixels(point(px(0.), px(wheel))),
                        modifiers: Modifiers::default(),
                        touch_phase: TouchPhase::Moved,
                        source: Default::default(),
                    }),
                    cx,
                );
            });
            if frame % 20 == 10 {
                view.update(cx, |view, cx| view.prepend(500, cx));
            }
            refresh(&view, cx);
            frames.wait(1, cx).await;
            let after = tops(&view, cx);
            for (id, top) in &before {
                if let Some(now) = after.get(id) {
                    compared += 1;
                    worst_error = worst_error.max((now - top - wheel).abs());
                }
            }
        }
        results.insert(
            "prepend_during_live_scroll".into(),
            json!({ "row_frames_compared": compared, "max_error_px": worst_error }),
        );

        // Late image load. `reserved` means the message says how big the image is.
        for (name, reserve) in [
            ("late_image_reserved", true),
            ("late_image_unreserved", false),
        ] {
            view.update(cx, |view, _| view.shared.reserve_images.set(reserve));
            let mut per_position = serde_json::Map::new();
            for (position, base) in [
                ("above_viewport", 75_000i64),
                ("in_viewport", 76_000),
                ("top_partial_row", 77_000),
            ] {
                let image_id = next_image_id(base);
                let (scroll_to, offset) = match position {
                    // The image sits a few rows above the top row, inside the overdraw.
                    "above_viewport" => (image_id + 3, 0.0),
                    // The image's row is on screen, below the top row.
                    "in_viewport" => (image_id - 2, 0.0),
                    // The image's row is the top row, scrolled partly past its header.
                    _ => (image_id, 12.0),
                };
                view.update(cx, |view, cx| {
                    view.shared.pending_images.borrow_mut().insert(image_id);
                    view.list.remeasure();
                    view.scroll_to_id(scroll_to, offset);
                    cx.notify();
                });
                settle(view.clone(), frames.clone(), cx).await;
                let before = tops(&view, cx);
                view.update(cx, |view, cx| view.image_arrived(image_id, cx));
                settle(view.clone(), frames.clone(), cx).await;
                let after = tops(&view, cx);
                let (common, worst) = row_shift(&before, &after);
                per_position.insert(
                    position.into(),
                    json!({ "image_id": image_id, "rows_compared": common, "max_shift_px": worst }),
                );
            }
            results.insert(name.into(), Value::Object(per_position));
        }

        results.insert(
            "load".into(),
            json!({ "start": load_start, "end": loadavg() }),
        );
        results.insert("memory_mb".into(), memory_mb());
        results.insert(
            "cpu_pct_core_avg".into(),
            json!(round2(
                (cpu_seconds() - cpu_start) / run_start.elapsed().as_secs_f64() * 100.0
            )),
        );
        write_json(&out, &json!({ "scenario": "jump", "results": results }));
        cx.update(|cx| cx.quit());
    })
    .detach();
}

fn inject(handle: AnyWindowHandle, event: PlatformInput, cx: &mut AsyncApp) {
    let _ = handle.update(cx, move |_, window, cx| {
        window.dispatch_event(event, cx);
    });
}

fn run_select(args: Args, cx: &mut App) {
    let load_start = loadavg();
    let (view, handle, frames) = open_scripted(&args, args.messages, cx);
    let out = args.out.clone();
    let wait_file = args.wait_file.clone();
    cx.spawn(async move |cx| {
        frames.wait(10, cx).await;
        let (cpu_start, run_start) = (cpu_seconds(), Instant::now());
        view.update(cx, |view, cx| {
            view.scroll_to_id(50_000, 0.);
            cx.notify();
        });
        for _ in 0..30 {
            refresh(&view, cx);
            frames.wait(1, cx).await;
        }
        let (viewport, start) = view
            .read_with(cx, |view, _| {
                let viewport = view.list.viewport_bounds();
                let row = view
                    .painted_rows()
                    .into_iter()
                    .find(|(_, bounds)| bounds.top() >= viewport.top() && bounds.size.height > px(0.))
                    .expect("a row");
                (viewport, row.1.origin + point(px(30.), px(6.)))
            });

        inject(
            handle,
            PlatformInput::MouseDown(MouseDownEvent {
                button: MouseButton::Left,
                position: start,
                modifiers: Modifiers::default(),
                click_count: 1,
                first_mouse: false,
            }),
            cx,
        );
        frames.wait(2, cx).await;
        let below = point(viewport.center().x, viewport.bottom() + px(60.));
        let move_to = |position| {
            PlatformInput::MouseMove(MouseMoveEvent { position, pressed_button: Some(MouseButton::Left), modifiers: Modifiers::default() })
        };
        // Past the bottom of the window the compositor keeps sending moves to the grabbing client.
        inject(handle, move_to(below), cx);
        let drag_started = Instant::now();
        let selection_of = |view: &Entity<MessageListView>, cx: &mut AsyncApp| {
            view.read_with(cx, |view, _| view.shared.selection.get())
        };
        let anchor = selection_of(&view, cx).expect("selection").anchor;
        let mut max_rows_painted = 0;
        while selection_of(&view, cx).is_some_and(|s| s.cursor.id < anchor.id + 150) {
            assert!(drag_started.elapsed() < Duration::from_secs(120), "auto-scroll stalled");
            frames.wait(1, cx).await;
            max_rows_painted = max_rows_painted.max(view.read_with(cx, |view, _| view.painted_rows().len()));
        }
        let drag_ms = drag_started.elapsed().as_millis();
        inject(handle, move_to(viewport.center()), cx);
        frames.wait(2, cx).await;
        inject(
            handle,
            PlatformInput::MouseUp(MouseUpEvent {
                button: MouseButton::Left,
                position: viewport.center(),
                modifiers: Modifiers::default(),
                click_count: 1,
            }),
            cx,
        );
        frames.wait(2, cx).await;

        let selection: Selection = selection_of(&view, cx).expect("a selection after release");
        let (start_pos, end_pos) = selection.ordered();
        let copied = view.read_with(cx, |view, _| view.selected_text());
        let mut expected = Vec::new();
        for id in start_pos.id..=end_pos.id {
            let message = generate(id);
            let part = if id == start_pos.id {
                copy_range(&message, start_pos.byte..message.display.len() as u32)
            } else if id == end_pos.id {
                copy_range(&message, 0..end_pos.byte)
            } else {
                truth(id)
            };
            if !part.is_empty() {
                expected.push(part);
            }
        }
        let expected = expected.join("\n");
        let copy_started = Instant::now();
        view.update(cx, |view, cx| view.copy(cx));
        let copy_ms = copy_started.elapsed().as_secs_f64() * 1000.0;
        let clipboard = cx.update(|cx| cx.read_from_clipboard().and_then(|item| item.text())).unwrap_or_default();

        // Everything scrolled out, then back.
        view.update(cx, |view, cx| {
            view.scroll_to_id(90_000, 0.);
            cx.notify();
        });
        for _ in 0..20 {
            refresh(&view, cx);
            frames.wait(1, cx).await;
        }
        let while_unmounted = view.read_with(cx, |view, _| view.selected_text());
        let painted_selected = view
            .read_with(cx, |view, _| view.painted_rows().iter().filter(|(id, _)| *id >= start_pos.id && *id <= end_pos.id).count());
        // Stand on the part of the selection with the most inline content, for the screenshot.
        let shot_row = (start_pos.id + 1..end_pos.id)
            .find(|id| {
                let message = generate(*id);
                let animated = message.segs.iter().any(|s| matches!(s, Seg::Emoji { emoji, .. } if *emoji >= ANIMATED_FROM));
                let linked = message.segs.iter().any(|s| matches!(s, Seg::Link { .. }));
                animated && (linked || message.display.len() > 40)
            })
            .unwrap_or(start_pos.id + 1);
        view.update(cx, |view, cx| {
            view.scroll_to_id(shot_row, 0.);
            cx.notify();
        });
        for _ in 0..60 {
            refresh(&view, cx);
            frames.wait(1, cx).await;
        }
        let after_remount = view.read_with(cx, |view, _| view.selected_text());

        write_json(
            &out,
            &json!({
                "scenario": "select_real_window",
                "messages_selected": end_pos.id - start_pos.id + 1,
                "anchor": { "id": selection.anchor.id, "byte": selection.anchor.byte },
                "cursor": { "id": selection.cursor.id, "byte": selection.cursor.byte },
                "copied_bytes": copied.len(),
                "text_exact_match": copied == expected,
                "clipboard_exact_match": clipboard == expected,
                "clipboard_bytes": clipboard.len(),
                "while_unmounted_exact_match": while_unmounted == expected,
                "after_remount_exact_match": after_remount == expected,
                "painted_selected_rows_while_away": painted_selected,
                "max_rows_painted_during_drag": max_rows_painted,
                "drag_ms": drag_ms,
                "copy_ms": round2(copy_ms),
                "shot_row": shot_row,
                "cpu_pct_core_avg": round2((cpu_seconds() - cpu_start) / run_start.elapsed().as_secs_f64() * 100.0),
                "memory_mb": memory_mb(),
                "load": { "start": load_start, "end": loadavg() },
            }),
        );
        // Lets a screenshot run against the finished selection. Bounded by the script's timeout.
        if let Some(file) = wait_file {
            let started = Instant::now();
            while !file.exists() && started.elapsed() < Duration::from_secs(60) {
                refresh(&view, cx);
                frames.wait(1, cx).await;
            }
        }
        cx.update(|cx| cx.quit());
    })
    .detach();
}

/// CPU for a list sitting still: with nothing moving, and with animated emoji on screen, which
/// makes the whole window redraw every frame.
fn run_idle(args: Args, cx: &mut App) {
    let load_start = loadavg();
    let (view, _handle, frames) = open_scripted(&args, args.messages, cx);
    let out = args.out.clone();
    cx.spawn(async move |cx| {
        let row_with_animation = (50_000i64..)
            .find(|id| generate(*id).segs.iter().any(|s| matches!(s, Seg::Emoji { emoji, .. } if *emoji >= ANIMATED_FROM)))
            .expect("an animated emoji exists");
        let row_without_animation = (60_000i64..)
            .find(|start| {
                (*start..*start + 25).all(|id| {
                    let message = generate(id);
                    !message.segs.iter().any(|s| matches!(s, Seg::Emoji { emoji, .. } if *emoji >= ANIMATED_FROM))
                })
            })
            .expect("a stretch with no animated emoji");
        let mut readings = serde_json::Map::new();
        for (name, row) in [("no_animation", row_without_animation), ("animated_emoji_on_screen", row_with_animation)] {
            view.update(cx, |view, cx| {
                view.scroll_to_id(row, 0.);
                cx.notify();
            });
            for _ in 0..30 {
                refresh(&view, cx);
                frames.wait(1, cx).await;
            }
            let (cpu_before, frames_before) = (cpu_seconds(), frames.0.get());
            let window = Instant::now();
            // A measurement window: the point is to do nothing for this long.
            cx.background_executor().timer(Duration::from_secs(10)).await;
            let seconds = window.elapsed().as_secs_f64();
            readings.insert(
                name.into(),
                json!({
                    "row": row,
                    "cpu_pct_core": round2((cpu_seconds() - cpu_before) / seconds * 100.0),
                    "frames_per_s": round2((frames.0.get() - frames_before) as f64 / seconds),
                }),
            );
        }
        write_json(&out, &json!({ "scenario": "idle", "readings": readings, "memory_mb": memory_mb(), "load": { "start": load_start, "end": loadavg() } }));
        cx.update(|cx| cx.quit());
    })
    .detach();
}

/// The real list holding still: CPU and frames with nothing moving, then with an animated emoji on
/// screen. `idle` on the prototype read 6-15% of a core at 60 fps for the second.
fn run_idle_real(args: Args, cx: &mut App) {
    let load_start = loadavg();
    messages::init(cx);
    ensure_images(&args.image_dir).expect("generating images");
    let frames = Rc::new(Cell::new(0u64));
    let counter = frames.clone();
    let image_dir = args.image_dir.clone();
    let count = args.messages;
    let out = args.out.clone();
    let (_, root) = gpui_kit::open_window(window_options(), cx, move |_, cx| {
        cx.new(|cx| RealRoot {
            list: open_real_list(count, image_dir, cx),
            after_present: Rc::new(move |_| counter.set(counter.get() + 1)),
        })
    })
    .expect("opening the window");
    let list = root.read(cx).list.clone();
    let frames = Frames(frames);
    cx.spawn(async move |cx| {
        let animated = |seq: i64| {
            synth::row(seq).segs.iter().any(|seg| {
                matches!(&seg.kind, semaphore_core::model::SegKind::Emoji { emoji_id, .. }
                    if emoji_id.strip_prefix("emoji-").and_then(|n| n.parse::<u16>().ok())
                        .is_some_and(|n| n >= synth::ANIMATED_FROM))
            })
        };
        let row_with_animation = (50_000i64..).find(|seq| animated(*seq)).expect("an animated emoji");
        let row_without_animation = (60_000i64..)
            .find(|start| (*start..*start + 25).all(|seq| !animated(seq)))
            .expect("a stretch with no animated emoji");
        let mut readings = serde_json::Map::new();
        for (name, row) in [("no_animation", row_without_animation), ("animated_emoji_on_screen", row_with_animation)] {
            root.update(cx, |root, cx| {
                root.list.read(cx).scroll_to_seq(row, 0.);
                cx.notify();
            });
            for _ in 0..30 {
                root.update(cx, |_, cx| cx.notify());
                frames.wait(1, cx).await;
            }
            // Let image decodes and the scrollbar's fade finish: they'd count as motion.
            cx.background_executor().timer(Duration::from_secs(3)).await;
            let (cpu_before, frames_before) = (cpu_seconds(), frames.0.get());
            let paints_before = list.read_with(cx, |list, _| list.animated_paints());
            let window = Instant::now();
            // A measurement window: the point is to do nothing for this long.
            cx.background_executor().timer(Duration::from_secs(10)).await;
            let seconds = window.elapsed().as_secs_f64();
            readings.insert(
                name.into(),
                json!({
                    "row": row,
                    "cpu_pct_core": round2((cpu_seconds() - cpu_before) / seconds * 100.0),
                    "frames_per_s": round2((frames.0.get() - frames_before) as f64 / seconds),
                    "animated_paints_per_s": round2((list.read_with(cx, |list, _| list.animated_paints()) - paints_before) as f64 / seconds),
                }),
            );
        }
        write_json(&out, &json!({ "scenario": "idle-real", "readings": readings, "memory_mb": memory_mb(), "load": { "start": load_start, "end": loadavg() } }));
        cx.update(|cx| cx.quit());
    })
    .detach();
}

fn main() -> Result<()> {
    let args = parse_args()?;
    gpui_kit::application().run(move |cx| {
        gpui_kit::init(cx);
        cx.activate(true);
        match args.mode.as_str() {
            "fling" => run_fling(args, cx),
            "jump" => run_jump(args, cx),
            "select" => run_select(args, cx),
            "idle" => run_idle(args, cx),
            "idle-real" => run_idle_real(args, cx),
            other => {
                eprintln!("unknown mode {other}");
                cx.quit();
            }
        }
    });
    Ok(())
}
