//! Throwaway rig. Replays I420 clips from memory, no LiveKit, through one of these arms:
//!   none        UI only (baseline)
//!   today       Zed's path off macOS: libyuv I420->BGRA, Arc<RenderImage> per frame, img(), drop_image
//!   scalar      as today, with a naive per-pixel Rust converter
//!   mallopt     as today, glibc told to keep freed frames (allocation reuse without a patch)
//!   sized       as today, libyuv scales to the displayed tile size before converting
//!   surface     patched: NV12 textures updated in place, sampled by the surfaces pipeline
//!   surface-sized  patched, and scaled to tile size on the CPU first
use gpui::{
    App, Bounds, Context, Corners, ImageSource, IntoElement, ObjectFit, Render, RenderImage,
    SharedString, StyledImage, Window, WindowBounds, WindowOptions, canvas, div, img, point,
    prelude::*, px, rgb, rgba, size,
};
use smallvec::smallvec;
use std::{
    io::Write as _,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering::Relaxed},
    },
    time::{Duration, Instant},
};

unsafe extern "C" {
    fn I420ToARGB(
        y: *const u8, ys: i32, u: *const u8, us: i32, v: *const u8, vs: i32,
        out: *mut u8, os: i32, w: i32, h: i32,
    ) -> i32;
    fn I420Scale(
        y: *const u8, ys: i32, u: *const u8, us: i32, v: *const u8, vs: i32, sw: i32, sh: i32,
        dy: *mut u8, dys: i32, du: *mut u8, dus: i32, dv: *mut u8, dvs: i32, dw: i32, dh: i32,
        filter: i32,
    ) -> i32;
    fn MergeUVPlane(
        u: *const u8, us: i32, v: *const u8, vs: i32, out: *mut u8, os: i32, w: i32, h: i32,
    );
}
const FILTER_BILINEAR: i32 = 2;

#[derive(Clone, Copy, PartialEq, Debug)]
enum Arm { None, Today, Scalar, Mallopt, Sized, Surface, SurfaceSized }

#[derive(Clone)]
struct Config {
    arm: Arm,
    arm_name: String,
    tiles720: usize,
    share: bool,
    warmup: f64,
    duration: f64,
    frames_dir: String,
    out: String,
}

struct Clip { map: memmap2::Mmap, w: usize, h: usize, frames: usize }
impl Clip {
    fn open(path: &str, w: usize, h: usize) -> Self {
        let f = std::fs::File::open(path).expect(path);
        let map = unsafe { memmap2::Mmap::map(&f).unwrap() };
        let frames = map.len() / (w * h * 3 / 2);
        Self { map, w, h, frames }
    }
    fn planes(&self, i: usize) -> (&[u8], &[u8], &[u8]) {
        let fs = self.w * self.h * 3 / 2;
        let f = &self.map[(i % self.frames) * fs..][..fs];
        let (y, c) = f.split_at(self.w * self.h);
        let (u, v) = c.split_at(self.w * self.h / 4);
        (y, u, v)
    }
}

fn scalar_i420_to_bgra(y: &[u8], u: &[u8], v: &[u8], w: usize, h: usize, out: &mut [u8]) {
    for row in 0..h {
        let cw = w / 2;
        let urow = &u[(row / 2) * cw..];
        let vrow = &v[(row / 2) * cw..];
        let yrow = &y[row * w..];
        let orow = &mut out[row * w * 4..];
        for col in 0..w {
            let yy = (yrow[col] as i32 - 16) * 298;
            let uu = urow[col / 2] as i32 - 128;
            let vv = vrow[col / 2] as i32 - 128;
            let o = &mut orow[col * 4..col * 4 + 4];
            o[0] = ((yy + 516 * uu + 128) >> 8).clamp(0, 255) as u8;
            o[1] = ((yy - 100 * uu - 208 * vv + 128) >> 8).clamp(0, 255) as u8;
            o[2] = ((yy + 409 * vv + 128) >> 8).clamp(0, 255) as u8;
            o[3] = 255;
        }
    }
}

fn convert_new_image(
    arm: Arm, y: &[u8], u: &[u8], v: &[u8], sw: usize, sh: usize, dw: usize, dh: usize,
    scratch: &mut Vec<u8>,
) -> Arc<RenderImage> {
    let (w, h) = if arm == Arm::Sized { (dw, dh) } else { (sw, sh) };
    let mut bgra: Vec<u8> = Vec::with_capacity(w * h * 4);
    unsafe { bgra.set_len(w * h * 4) };
    unsafe {
        if arm == Arm::Sized {
            let cw = (w + 1) / 2;
            let ch = (h + 1) / 2;
            scratch.resize(w * h + 2 * cw * ch, 0);
            let (dy, c) = scratch.split_at_mut(w * h);
            let (du, dv) = c.split_at_mut(cw * ch);
            I420Scale(
                y.as_ptr(), sw as i32, u.as_ptr(), (sw / 2) as i32, v.as_ptr(), (sw / 2) as i32,
                sw as i32, sh as i32,
                dy.as_mut_ptr(), w as i32, du.as_mut_ptr(), cw as i32, dv.as_mut_ptr(), cw as i32,
                w as i32, h as i32, FILTER_BILINEAR,
            );
            I420ToARGB(
                dy.as_ptr(), w as i32, du.as_ptr(), cw as i32, dv.as_ptr(), cw as i32,
                bgra.as_mut_ptr(), (w * 4) as i32, w as i32, h as i32,
            );
        } else if arm == Arm::Scalar {
            scalar_i420_to_bgra(y, u, v, sw, sh, &mut bgra);
        } else {
            I420ToARGB(
                y.as_ptr(), sw as i32, u.as_ptr(), (sw / 2) as i32, v.as_ptr(), (sw / 2) as i32,
                bgra.as_mut_ptr(), (sw * 4) as i32, sw as i32, sh as i32,
            );
        }
    }
    let image = image::RgbaImage::from_raw(w as u32, h as u32, bgra).unwrap();
    Arc::new(RenderImage::new(smallvec![image::Frame::new(image)]))
}

#[derive(Default)]
struct Slot {
    latest: Mutex<Option<Arc<RenderImage>>>,
}

struct Stream {
    label: SharedString,
    rect: Bounds<gpui::Pixels>,
    slot: Arc<Slot>,
    video: gpui::VideoSurfaceId,
    shown: Option<Arc<RenderImage>>,
    speaking: bool,
}

static FRAMES_CONVERTED: AtomicU64 = AtomicU64::new(0);

fn spawn_stream(
    arm: Arm, name: String, clip: Arc<Clip>, fps: f64, offset: usize, dw: usize, dh: usize,
    slot: Arc<Slot>, uploader: Option<Arc<dyn gpui::VideoUploader>>, video: gpui::VideoSurfaceId,
) {
    std::thread::Builder::new()
        .name(name)
        .spawn(move || {
            let period = Duration::from_secs_f64(1.0 / fps);
            let mut next = Instant::now() + period.mul_f64((offset % 7) as f64 / 7.0);
            let mut i = offset * 13;
            // Source clip is 60 fps content; step so 30 fps streams still change fully per frame.
            let step = if fps <= 30.0 { 2 } else { 1 };
            let mut scratch = Vec::new();
            let mut uv = Vec::new();
            let (sw, sh) = (clip.w, clip.h);
            loop {
                let now = Instant::now();
                if next > now { std::thread::sleep(next - now); }
                next += period;
                if Instant::now() > next + period * 4 { next = Instant::now() + period; }
                let (y, u, v) = clip.planes(i);
                i += step;
                match arm {
                    Arm::Surface | Arm::SurfaceSized => {
                        let up = uploader.as_ref().expect("uploader");
                        let (w, h) = if arm == Arm::SurfaceSized { (dw, dh) } else { (sw, sh) };
                        let cw = (w + 1) / 2;
                        let ch = (h + 1) / 2;
                        uv.resize(cw * 2 * ch, 0u8);
                        unsafe {
                            if arm == Arm::SurfaceSized {
                                scratch.resize(w * h + 2 * cw * ch, 0u8);
                                let (dy, c) = scratch.split_at_mut(w * h);
                                let (du, dv) = c.split_at_mut(cw * ch);
                                I420Scale(
                                    y.as_ptr(), sw as i32, u.as_ptr(), (sw / 2) as i32, v.as_ptr(), (sw / 2) as i32,
                                    sw as i32, sh as i32,
                                    dy.as_mut_ptr(), w as i32, du.as_mut_ptr(), cw as i32, dv.as_mut_ptr(), cw as i32,
                                    w as i32, h as i32, FILTER_BILINEAR,
                                );
                                MergeUVPlane(du.as_ptr(), cw as i32, dv.as_ptr(), cw as i32, uv.as_mut_ptr(), (cw * 2) as i32, cw as i32, ch as i32);
                                up.upload(video, &gpui::Nv12Frame {
                                    width: w as u32, height: h as u32, y: dy, y_stride: w as u32,
                                    uv: &uv, uv_stride: (cw * 2) as u32,
                                });
                            } else {
                                MergeUVPlane(u.as_ptr(), cw as i32, v.as_ptr(), cw as i32, uv.as_mut_ptr(), (cw * 2) as i32, cw as i32, ch as i32);
                                up.upload(video, &gpui::Nv12Frame {
                                    width: w as u32, height: h as u32, y, y_stride: w as u32,
                                    uv: &uv, uv_stride: (cw * 2) as u32,
                                });
                            }
                        }
                    }
                    _ => {
                        let image = convert_new_image(arm, y, u, v, sw, sh, dw, dh, &mut scratch);
                        *slot.latest.lock().unwrap() = Some(image);
                    }
                }
                FRAMES_CONVERTED.fetch_add(1, Relaxed);
            }
        })
        .unwrap();
}

// ------------------------------------------------------------ view

const CHAT: &[&str] = &[
    "mike: the new voice bar looks right on phone width now",
    "sam: can you try sharing at 1080p60? the old build stuttered",
    "ana: the egress volume filled up again, I'll bump it",
    "mike: rounded corners on tiles match the web client",
    "sam: reactions still arrive before the message sometimes",
];

struct Rig {
    cfg: Config,
    streams: Vec<Stream>,
    started: Instant,
    frame_no: u64,
    metrics: Option<Metrics>,
    done: bool,
}

struct Metrics {
    start: Instant,
    cpu_start: f64,
    threads_start: Vec<(String, f64)>,
    created_start: u64,
    atlas_start: i64,
    alloc_start: Option<(u64, u64)>,
    converted_start: u64,
    soak_log: Vec<(f64, i64, u64, u64, f64)>,
    last_log: Instant,
}

fn ticks_per_sec() -> f64 { unsafe { libc::sysconf(libc::_SC_CLK_TCK) as f64 } }

fn parse_stat(s: &str) -> Option<(String, f64)> {
    let open = s.find('(')?;
    let close = s.rfind(')')?;
    let comm = s[open + 1..close].to_string();
    let rest: Vec<&str> = s[close + 2..].split_whitespace().collect();
    let t = rest.get(11)?.parse::<f64>().ok()? + rest.get(12)?.parse::<f64>().ok()?;
    Some((comm, t / ticks_per_sec()))
}
fn process_cpu_s() -> f64 {
    parse_stat(&std::fs::read_to_string("/proc/self/stat").unwrap()).unwrap().1
}
fn thread_cpu() -> Vec<(String, f64)> {
    let mut v = Vec::new();
    for e in std::fs::read_dir("/proc/self/task").unwrap().flatten() {
        if let Ok(s) = std::fs::read_to_string(e.path().join("stat")) {
            if let Some((c, t)) = parse_stat(&s) {
                v.push((format!("{}#{}", c, e.file_name().to_string_lossy()), t));
            }
        }
    }
    v
}
fn status_kb(key: &str) -> f64 {
    let s = std::fs::read_to_string("/proc/self/status").unwrap();
    for l in s.lines() {
        if let Some(r) = l.strip_prefix(key) {
            return r.trim_start_matches(':').trim().split_whitespace().next().unwrap().parse().unwrap_or(0.0);
        }
    }
    0.0
}

impl Rig {
    fn tick_metrics(&mut self, cx: &mut Context<Self>) {
        let elapsed = self.started.elapsed().as_secs_f64();
        if self.metrics.is_none() && elapsed >= self.cfg.warmup {
            gpui_wgpu::telemetry::take_presents();
            self.metrics = Some(Metrics {
                start: Instant::now(),
                cpu_start: process_cpu_s(),
                threads_start: thread_cpu(),
                created_start: gpui_wgpu::telemetry::textures_created(),
                atlas_start: gpui_wgpu::telemetry::atlas_live_bytes(),
                alloc_start: gpui_wgpu::telemetry::allocator(),
                converted_start: FRAMES_CONVERTED.load(Relaxed),
                soak_log: vec![],
                last_log: Instant::now(),
            });
        }
        let Some(m) = self.metrics.as_mut() else { return };
        let log_every = (self.cfg.duration / 60.0).clamp(1.0, 30.0);
        if m.last_log.elapsed().as_secs_f64() >= log_every {
            m.last_log = Instant::now();
            let (a, r) = gpui_wgpu::telemetry::allocator().unwrap_or((0, 0));
            m.soak_log.push((
                m.start.elapsed().as_secs_f64(),
                gpui_wgpu::telemetry::atlas_live_bytes(),
                a, r,
                status_kb("RssAnon") / 1024.0,
            ));
        }
        if m.start.elapsed().as_secs_f64() >= self.cfg.duration && !self.done {
            self.done = true;
            let wall = m.start.elapsed().as_secs_f64();
            let cpu = process_cpu_s() - m.cpu_start;
            let presents = gpui_wgpu::telemetry::take_presents();
            let mut iv: Vec<f64> = presents.windows(2).map(|w| (w[1] - w[0]).as_secs_f64() * 1000.0).collect();
            iv.sort_by(|a, b| a.partial_cmp(b).unwrap());
            let pct = |p: f64| iv.get(((iv.len() as f64 - 1.0) * p) as usize).copied().unwrap_or(f64::NAN);
            let start_threads = m.threads_start.clone();
            let mut per_thread: Vec<(String, f64)> = thread_cpu().into_iter().map(|(k, t)| {
                let s = start_threads.iter().find(|(n, _)| *n == k).map(|x| x.1).unwrap_or(0.0);
                (k, (t - s) / wall * 100.0)
            }).filter(|x| x.1 > 0.2).collect();
            per_thread.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
            let threads_json: Vec<String> = per_thread.iter().map(|(k, v)| format!("\"{}\":{:.1}", k.replace('"', ""), v)).collect();
            let (a0, r0) = m.alloc_start.unwrap_or((0, 0));
            let (a1, r1) = gpui_wgpu::telemetry::allocator().unwrap_or((0, 0));
            let soak: Vec<String> = m.soak_log.iter().map(|(t, atlas, a, r, rss)| format!("[{t:.0},{atlas},{a},{r},{rss:.0}]")).collect();
            let specs = cx.update_window_specs();
            let json = format!(
                "{{\"arm\":\"{}\",\"tiles720\":{},\"share1080\":{},\"duration_s\":{:.1},\"frames_presented\":{},\"fps_p50\":{:.2},\"frame_ms_p50\":{:.2},\"frame_ms_p95\":{:.2},\"frame_ms_p99\":{:.2},\"frame_ms_max\":{:.2},\"cpu_pct_core_total\":{:.1},\"video_frames_per_s\":{:.1},\"textures_created_per_s\":{:.1},\"textures_created\":{},\"atlas_live_mb_start\":{:.1},\"atlas_live_mb_end\":{:.1},\"wgpu_alloc_mb_start\":{:.1},\"wgpu_alloc_mb_end\":{:.1},\"wgpu_reserved_mb_start\":{:.1},\"wgpu_reserved_mb_end\":{:.1},\"rss_mb\":{:.0},\"rss_incl_mapped_clips_mb\":{:.0},\"renderer\":\"{}\",\"threads\":{{{}}},\"soak\":[{}]}}\n",
                self.cfg.arm_name, self.cfg.tiles720, self.cfg.share, wall, presents.len(),
                1000.0 / pct(0.5), pct(0.5), pct(0.95), pct(0.99), pct(1.0), cpu / wall * 100.0,
                (FRAMES_CONVERTED.load(Relaxed) - m.converted_start) as f64 / wall,
                (gpui_wgpu::telemetry::textures_created() - m.created_start) as f64 / wall,
                gpui_wgpu::telemetry::textures_created() - m.created_start,
                m.atlas_start as f64 / 1048576.0, gpui_wgpu::telemetry::atlas_live_bytes() as f64 / 1048576.0,
                a0 as f64 / 1048576.0, a1 as f64 / 1048576.0, r0 as f64 / 1048576.0, r1 as f64 / 1048576.0,
                status_kb("RssAnon") / 1024.0, status_kb("VmRSS") / 1024.0,
                specs, threads_json.join(","), soak.join(","),
            );
            let mut f = std::fs::OpenOptions::new().create(true).append(true).open(&self.cfg.out).unwrap();
            f.write_all(json.as_bytes()).unwrap();
            print!("{json}");
            unsafe { libc::_exit(0) };
        }
    }
}

trait WindowSpecs { fn update_window_specs(&mut self) -> String; }
impl<T> WindowSpecs for Context<'_, T> {
    fn update_window_specs(&mut self) -> String { std::env::var("RIG_RENDERER").unwrap_or_default() }
}

impl Render for Rig {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        window.request_animation_frame();
        self.frame_no += 1;
        self.tick_metrics(cx);
        let frame_no = self.frame_no;

        let mut children = Vec::new();
        for s in self.streams.iter_mut() {
            let mut tile = div()
                .absolute()
                .left(s.rect.origin.x)
                .top(s.rect.origin.y)
                .w(s.rect.size.width)
                .h(s.rect.size.height)
                .rounded(px(12.0))
                .bg(rgb(0x23272a))
                .overflow_hidden();
            match self.cfg.arm {
                Arm::Surface | Arm::SurfaceSized => {
                    let video = s.video;
                    tile = tile.child(
                        canvas(|_, _, _| {}, move |bounds, _, window, _| {
                            window.paint_video_surface(bounds, Corners::all(px(12.0)), video);
                        })
                        .size_full(),
                    );
                }
                Arm::None => {}
                _ => {
                    let newest = s.slot.latest.lock().unwrap().clone();
                    if let Some(new) = newest {
                        if s.shown.as_ref().is_none_or(|old| old.id != new.id) {
                            if let Some(old) = s.shown.replace(new) {
                                window.drop_image(old).unwrap();
                            }
                        }
                    }
                    if let Some(image) = &s.shown {
                        tile = tile.child(
                            img(ImageSource::Render(image.clone()))
                                .size_full()
                                .rounded(px(12.0))
                                .object_fit(ObjectFit::Cover),
                        );
                    }
                }
            }
            // Overlay above the video: name pill, mic dot, speaking border.
            tile = tile.child(
                div()
                    .absolute()
                    .left(px(8.0))
                    .bottom(px(8.0))
                    .px_2()
                    .py_1()
                    .rounded(px(6.0))
                    .bg(rgba(0x000000a0))
                    .flex()
                    .gap_1()
                    .items_center()
                    .child(div().size(px(8.0)).rounded(px(4.0)).bg(rgb(0x43b581)))
                    .child(div().text_color(rgb(0xffffff)).text_size(px(13.0)).child(s.label.clone())),
            );
            if s.speaking {
                tile = tile.child(div().absolute().size_full().rounded(px(12.0)).border_2().border_color(rgb(0x43b581)));
            }
            children.push(tile);
        }

        // Chat panel: static text on three bottom cells, a clock that changes every frame on top.
        let chat = div()
            .absolute()
            .left(px(484.0))
            .top(px(814.0))
            .w(px(1436.0))
            .h(px(266.0))
            .p_2()
            .rounded(px(12.0))
            .bg(rgb(0x2c2f33))
            .flex()
            .flex_col()
            .text_color(rgb(0xdcddde))
            .text_size(px(14.0))
            .children((0..10).map(|i| div().child(CHAT[i % CHAT.len()])));
        let hud = div()
            .absolute()
            .right(px(16.0))
            .top(px(8.0))
            .px_3()
            .py_1()
            .rounded(px(8.0))
            .bg(rgba(0x000000c0))
            .text_color(rgb(0xffffff))
            .text_size(px(14.0))
            .child(format!("frame {frame_no}"));
        let progress = div()
            .absolute()
            .left(px(0.0))
            .top(px(0.0))
            .h(px(4.0))
            .w(px((frame_no % 600) as f32 / 600.0 * 1920.0))
            .bg(rgb(0x5865f2));

        div()
            .size_full()
            .relative()
            .bg(rgb(0x1e2124))
            .font_family("DejaVu Sans")
            .children(children)
            .child(chat)
            .child(hud)
            .child(progress)
    }
}

fn layout(cfg: &Config) -> (Vec<(Bounds<gpui::Pixels>, bool, String)>, (usize, usize), (usize, usize)) {
    // 4x4 grid on 1920x1080. Screen share occupies the top-left 2x2 cell block; others go after it.
    let (cw, ch) = (480.0_f32, 270.0_f32);
    let gap = 4.0;
    let rect = |col: f32, row: f32, cols: f32, rows: f32| Bounds {
        origin: point(px(col * cw + gap / 2.0), px(row * ch + gap / 2.0)),
        size: size(px(cols * cw - gap), px(rows * ch - gap)),
    };
    let mut out = Vec::new();
    if cfg.share { out.push((rect(0.0, 0.0, 2.0, 2.0), true, "Screen share 1080p60".to_string())); }
    let cells = [(2., 0.), (3., 0.), (2., 1.), (3., 1.), (0., 2.), (1., 2.), (2., 2.), (3., 2.), (0., 3.)];
    for i in 0..cfg.tiles720 {
        let (c, r) = cells[i];
        out.push((rect(c, r, 1.0, 1.0), false, format!("User {} 720p30", i + 1)));
    }
    (out, (956, 536), (476, 266))
}

fn arg(name: &str, default: &str) -> String {
    let flag = format!("--{name}=");
    std::env::args().find_map(|a| a.strip_prefix(&flag).map(str::to_string)).unwrap_or(default.to_string())
}

fn main() {
    let arm_name = arg("arm", "today");
    let arm = match arm_name.as_str() {
        "none" => Arm::None, "today" => Arm::Today, "scalar" => Arm::Scalar, "mallopt" => Arm::Mallopt,
        "sized" => Arm::Sized, "surface" => Arm::Surface, "surface-sized" => Arm::SurfaceSized,
        other => panic!("unknown arm {other}"),
    };
    if arm == Arm::Mallopt {
        unsafe {
            libc::mallopt(libc::M_MMAP_THRESHOLD, 256 * 1024 * 1024);
            libc::mallopt(libc::M_TRIM_THRESHOLD, 1024 * 1024 * 1024);
            libc::mallopt(libc::M_ARENA_MAX, 2);
        }
    }
    let cfg = Config {
        arm,
        arm_name,
        tiles720: arg("tiles", "9").parse().unwrap(),
        share: arg("share", "1") == "1",
        warmup: arg("warmup", "5").parse().unwrap(),
        duration: arg("duration", "20").parse().unwrap(),
        frames_dir: arg("frames", "/v/frames"),
        out: arg("out", "/v/gpui-raw.jsonl"),
    };
    let clip720 = Arc::new(Clip::open(&format!("{}/720p.i420", cfg.frames_dir), 1280, 720));
    let clip1080 = Arc::new(Clip::open(&format!("{}/1080p.i420", cfg.frames_dir), 1920, 1080));

    gpui_platform::application().run(move |cx: &mut App| {
        let bounds = Bounds::centered(None, size(px(1920.0), px(1080.0)), cx);
        cx.open_window(
            WindowOptions { window_bounds: Some(WindowBounds::Windowed(bounds)), inactive_frame_interval: None, low_power_frame_interval: None, thermal_frame_interval: None, ..Default::default() },
            move |window, cx| {
                let uploader = window.video_uploader();
                let (cells, share_px, tile_px) = layout(&cfg);
                let mut streams = Vec::new();
                for (i, (rect, is_share, label)) in cells.into_iter().enumerate() {
                    let slot = Arc::new(Slot::default());
                    let video = gpui::VideoSurfaceId::next();
                    if arm != Arm::None {
                        let (clip, fps, (dw, dh)) = if is_share {
                            (clip1080.clone(), 60.0, share_px)
                        } else {
                            (clip720.clone(), 30.0, tile_px)
                        };
                        spawn_stream(arm, format!("video-{i}"), clip, fps, i, dw, dh, slot.clone(), uploader.clone(), video);
                    }
                    streams.push(Stream {
                        label: label.into(),
                        rect,
                        slot,
                        video,
                        shown: None,
                        speaking: i % 4 == 1,
                    });
                }
                cx.new(|_| Rig {
                    cfg,
                    streams,
                    started: Instant::now(),
                    frame_no: 0,
                    metrics: None,
                    done: false,
                })
            },
        )
        .unwrap();
        cx.activate(true);
    });
}
