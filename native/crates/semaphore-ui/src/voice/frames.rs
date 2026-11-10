//! Decoded frames on their way to tiles. Called from media threads: `VideoFrames` is what the app's
//! `VideoSink` forwards to, so this crate needs no LiveKit.

use super::{VideoPath, icons};
use gpui_kit::*;
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::RwLock;
use std::sync::atomic::{AtomicBool, Ordering};

struct Slot {
    surface: VideoSurfaceId,
    size: (u32, u32),
    /// The RGBA path's current frame, and the ones to free once nothing draws them.
    image: Option<Arc<RenderImage>>,
    retired: Vec<Arc<RenderImage>>,
}

pub struct VideoFrames {
    path: VideoPath,
    uploader: Option<Arc<dyn VideoUploader>>,
    slots: RwLock<HashMap<String, Slot>>,
    dirty: AtomicBool,
}

impl VideoFrames {
    /// The path this build and this window's renderer support: see [`super::video_path`].
    pub fn for_window(window: &Window) -> Arc<Self> {
        Self::with_path(window, super::video_path(window))
    }

    /// Forces a path, to exercise the fallback on a machine that has the fast one.
    pub fn with_path(window: &Window, path: VideoPath) -> Arc<Self> {
        Self::with_uploader(path, window.video_uploader())
    }

    fn with_uploader(path: VideoPath, uploader: Option<Arc<dyn VideoUploader>>) -> Arc<Self> {
        Arc::new(Self {
            path,
            uploader,
            slots: RwLock::default(),
            dirty: AtomicBool::new(false),
        })
    }

    /// The path frames take now. A surface that failed moves this to RGBA for good, from the next
    /// frame on, so a tile that went dark comes back.
    pub fn path(&self) -> VideoPath {
        match (&self.path, &self.uploader) {
            (VideoPath::Surface, Some(uploader)) if !uploader.failed() => VideoPath::Surface,
            _ => VideoPath::RgbaFallback,
        }
    }

    /// A new frame. Safe from any thread, and doesn't wait on the UI thread.
    pub fn push(&self, track_sid: &str, frame: &Nv12Frame<'_>) {
        match (self.path(), &self.uploader) {
            (VideoPath::Surface, Some(uploader)) => {
                let surface = self.ensure_slot(track_sid, frame);
                uploader.upload(surface, frame);
            }
            _ => {
                let image = nv12_to_render_image(frame);
                self.ensure_slot(track_sid, frame);
                let mut slots = self.slots.write().unwrap_or_else(|p| p.into_inner());
                if let Some(slot) = slots.get_mut(track_sid)
                    && let Some(old) = slot.image.replace(image)
                {
                    slot.retired.push(old);
                }
            }
        }
        self.dirty.store(true, Ordering::Release);
    }

    fn ensure_slot(&self, track_sid: &str, frame: &Nv12Frame<'_>) -> VideoSurfaceId {
        let size = (frame.width, frame.height);
        {
            let slots = self.slots.read().unwrap_or_else(|p| p.into_inner());
            if let Some(slot) = slots.get(track_sid)
                && slot.size == size
            {
                return slot.surface;
            }
        }
        let mut slots = self.slots.write().unwrap_or_else(|p| p.into_inner());
        let slot = slots.entry(track_sid.to_owned()).or_insert_with(|| Slot {
            surface: VideoSurfaceId::next(),
            size,
            image: None,
            retired: Vec::new(),
        });
        slot.size = size;
        slot.surface
    }

    /// The track is gone. Its tile goes back to an avatar when the model next says so.
    pub fn end(&self, track_sid: &str) {
        let removed = self
            .slots
            .write()
            .unwrap_or_else(|p| p.into_inner())
            .remove(track_sid);
        if let (Some(slot), Some(uploader)) = (removed, &self.uploader) {
            uploader.remove(slot.surface);
        }
        self.dirty.store(true, Ordering::Release);
    }

    pub fn has_frame(&self, track_sid: &str) -> bool {
        self.slots
            .read()
            .unwrap_or_else(|p| p.into_inner())
            .contains_key(track_sid)
    }

    /// Whether anything changed since the last call, which is the view's cue to redraw.
    pub fn take_dirty(&self) -> bool {
        self.dirty.swap(false, Ordering::AcqRel)
    }

    /// Paints inside `bounds`, rounded. Does nothing before the first frame, so whatever is behind
    /// it stays visible.
    pub(super) fn paint(
        &self,
        track_sid: &str,
        bounds: Bounds<Pixels>,
        radius: Pixels,
        fit: Fit,
        window: &mut Window,
        cx: &App,
    ) {
        let mut retired = Vec::new();
        let (surface, frame_size, image) = {
            let mut slots = self.slots.write().unwrap_or_else(|p| p.into_inner());
            let Some(slot) = slots.get_mut(track_sid) else {
                return;
            };
            std::mem::swap(&mut retired, &mut slot.retired);
            (slot.surface, slot.size, slot.image.clone())
        };
        let draw = |rect: Bounds<Pixels>, radii: Corners<Pixels>, window: &mut Window| match &image
        {
            Some(image) => {
                let _ = window.paint_image(rect, rect, radii, image.clone(), 0, false);
            }
            None => paint_surface(window, rect, radii, surface),
        };
        let cover = fit_cover(bounds, frame_size.0, frame_size.1);
        match fit {
            // The same shape, or close enough that nobody could tell.
            Fit::Cover { .. } | Fit::Contain if overflow_is_negligible(bounds, cover) => {
                draw(bounds, Corners::all(radius), window)
            }
            Fit::Contain => draw(
                fit_contain(bounds, frame_size.0, frame_size.1),
                Corners::all(radius),
                window,
            ),
            Fit::Cover { corners } => {
                // The texture always maps to the whole rect it's painted in, and a surface's rounded
                // corners are that rect's. So: paint it oversized, clip to the tile, and draw the
                // tile's corners back on top. A UV rect in the patch would make this one draw.
                window.with_content_mask(Some(ContentMask { bounds }), |window| {
                    draw(cover, Corners::default(), window);
                });
                icons::paint_corners(bounds, radius, corners, window, cx);
            }
        }
        for old in retired {
            let _ = window.drop_image(old);
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) enum Fit {
    /// The whole frame, with bars if the shape differs. For screens, where a cropped edge is lost
    /// content.
    Contain,
    /// Fills the tile, cropping. For faces, as on the web. `corners` is what shows outside the
    /// tile's rounded corners.
    Cover { corners: Hsla },
}

fn overflow_is_negligible(bounds: Bounds<Pixels>, cover: Bounds<Pixels>) -> bool {
    (f32::from(cover.size.width) - f32::from(bounds.size.width)).abs() < 1.0
        && (f32::from(cover.size.height) - f32::from(bounds.size.height)).abs() < 1.0
}

#[cfg(not(any(target_os = "macos", target_os = "ios")))]
fn paint_surface(
    window: &mut Window,
    bounds: Bounds<Pixels>,
    radii: Corners<Pixels>,
    surface: VideoSurfaceId,
) {
    window.paint_video_surface(bounds, radii, surface);
}

/// The patch has no Metal side, and `video_path` never picks `Surface` on Apple platforms.
#[cfg(any(target_os = "macos", target_os = "ios"))]
fn paint_surface(_: &mut Window, _: Bounds<Pixels>, _: Corners<Pixels>, _: VideoSurfaceId) {}

/// The largest rect of the frame's shape that fits, centred.
pub(super) fn fit_contain(bounds: Bounds<Pixels>, width: u32, height: u32) -> Bounds<Pixels> {
    if width == 0 || height == 0 {
        return bounds;
    }
    let frame_aspect = width as f32 / height as f32;
    let (box_w, box_h) = (f32::from(bounds.size.width), f32::from(bounds.size.height));
    let (w, h) = if box_w / box_h.max(1.0) > frame_aspect {
        (box_h * frame_aspect, box_h)
    } else {
        (box_w, box_w / frame_aspect)
    };
    Bounds {
        origin: point(
            bounds.origin.x + px((box_w - w) / 2.0),
            bounds.origin.y + px((box_h - h) / 2.0),
        ),
        size: size(px(w), px(h)),
    }
}

/// The smallest rect of the frame's shape that covers the box, centred.
pub(super) fn fit_cover(bounds: Bounds<Pixels>, width: u32, height: u32) -> Bounds<Pixels> {
    if width == 0 || height == 0 {
        return bounds;
    }
    let frame_aspect = width as f32 / height as f32;
    let (box_w, box_h) = (f32::from(bounds.size.width), f32::from(bounds.size.height));
    let (w, h) = if box_w / box_h.max(1.0) > frame_aspect {
        (box_w, box_w / frame_aspect)
    } else {
        (box_h * frame_aspect, box_h)
    };
    Bounds {
        origin: point(
            bounds.origin.x + px((box_w - w) / 2.0),
            bounds.origin.y + px((box_h - h) / 2.0),
        ),
        size: size(px(w), px(h)),
    }
}

/// The fallback's cost lives here: a whole-frame conversion and a new atlas entry per frame. BT.601
/// limited range, the same matrix the surface shader uses, so the two paths look the same.
fn nv12_to_render_image(frame: &Nv12Frame<'_>) -> Arc<RenderImage> {
    let (width, height) = (frame.width as usize, frame.height as usize);
    let mut bgra = vec![255u8; width * height * 4];
    for row in 0..height {
        let y_row = &frame.y[row * frame.y_stride as usize..][..width];
        let uv_row = &frame.uv[(row / 2) * frame.uv_stride as usize..];
        let out_row = &mut bgra[row * width * 4..][..width * 4];
        for (col, out) in out_row.as_chunks_mut::<4>().0.iter_mut().enumerate() {
            let y = 298 * (i32::from(y_row[col]) - 16);
            let u = i32::from(uv_row[col & !1]) - 128;
            let v = i32::from(uv_row[(col & !1) + 1]) - 128;
            out[0] = ((y + 516 * u + 128) >> 8).clamp(0, 255) as u8;
            out[1] = ((y - 100 * u - 208 * v + 128) >> 8).clamp(0, 255) as u8;
            out[2] = ((y + 409 * v + 128) >> 8).clamp(0, 255) as u8;
        }
    }
    let image = image::RgbaImage::from_raw(frame.width, frame.height, bgra)
        .expect("the buffer is width * height * 4");
    Arc::new(RenderImage::new(vec![image::Frame::new(image)]))
}

#[cfg(test)]
mod tests {
    use super::*;
    // `gpui_kit::*` brings in its own `test` attribute, which `#[test]` would otherwise resolve to.
    use std::prelude::rust_2024::test;

    fn rect(w: f32, h: f32) -> Bounds<Pixels> {
        Bounds {
            origin: point(px(10.), px(20.)),
            size: size(px(w), px(h)),
        }
    }

    #[test]
    fn a_wide_frame_in_a_tall_box_is_letterboxed_top_and_bottom() {
        let fitted = fit_contain(rect(640., 480.), 1280, 720);
        assert_eq!(fitted.size.width, px(640.));
        assert_eq!(fitted.size.height, px(360.));
        assert_eq!(fitted.origin.y, px(20. + 60.));
    }

    #[test]
    fn a_tall_box_for_a_narrow_frame_is_pillarboxed() {
        let fitted = fit_contain(rect(640., 360.), 720, 1280);
        assert_eq!(fitted.size.height, px(360.));
        assert!((f32::from(fitted.size.width) - 202.5).abs() < 0.01);
    }

    #[test]
    fn covering_overflows_the_long_side_and_stays_centred() {
        let fitted = fit_cover(rect(640., 480.), 1280, 720);
        assert_eq!(fitted.size.height, px(480.));
        assert!((f32::from(fitted.size.width) - 853.33).abs() < 0.01);
        assert!((f32::from(fitted.origin.x) - (10. - 106.67)).abs() < 0.01);
    }

    #[test]
    fn a_zero_sized_frame_fills_the_box() {
        assert_eq!(fit_contain(rect(100., 100.), 0, 0), rect(100., 100.));
    }
}

#[cfg(test)]
mod failover_tests {
    use super::*;
    use std::prelude::rust_2024::test;
    use std::sync::Mutex;
    use std::sync::atomic::AtomicUsize;

    #[derive(Default)]
    struct FakeUploader {
        failed: AtomicBool,
        uploads: AtomicUsize,
        removed: Mutex<Vec<VideoSurfaceId>>,
    }

    impl VideoUploader for FakeUploader {
        fn upload(&self, _: VideoSurfaceId, _: &Nv12Frame<'_>) {
            self.uploads.fetch_add(1, Ordering::SeqCst);
        }
        fn remove(&self, id: VideoSurfaceId) {
            self.removed.lock().unwrap().push(id);
        }
        fn failed(&self) -> bool {
            self.failed.load(Ordering::SeqCst)
        }
    }

    fn push(frames: &VideoFrames) {
        let y = [128u8; 16];
        let uv = [128u8; 8];
        frames.push(
            "track",
            &Nv12Frame {
                width: 4,
                height: 4,
                y: &y,
                y_stride: 4,
                uv: &uv,
                uv_stride: 4,
            },
        );
    }

    fn holds_image(frames: &VideoFrames) -> bool {
        frames.slots.read().unwrap()["track"].image.is_some()
    }

    #[test]
    fn frames_move_to_rgba_when_the_surface_fails_and_stay_there() {
        let uploader = Arc::new(FakeUploader::default());
        let frames = VideoFrames::with_uploader(VideoPath::Surface, Some(uploader.clone()));

        push(&frames);
        assert_eq!(frames.path(), VideoPath::Surface);
        assert_eq!(uploader.uploads.load(Ordering::SeqCst), 1);
        assert!(!holds_image(&frames));

        uploader.failed.store(true, Ordering::SeqCst);
        assert_eq!(frames.path(), VideoPath::RgbaFallback);
        push(&frames);
        assert_eq!(uploader.uploads.load(Ordering::SeqCst), 1);
        // What `paint` draws in preference to the surface, so the tile is back.
        assert!(holds_image(&frames));
    }

    #[test]
    fn asking_for_rgba_never_touches_the_uploader() {
        let uploader = Arc::new(FakeUploader::default());
        let frames = VideoFrames::with_uploader(VideoPath::RgbaFallback, Some(uploader.clone()));
        push(&frames);
        assert_eq!(uploader.uploads.load(Ordering::SeqCst), 0);
        assert!(holds_image(&frames));
    }

    #[test]
    fn ending_a_track_still_frees_its_surface_after_a_failure() {
        let uploader = Arc::new(FakeUploader::default());
        let frames = VideoFrames::with_uploader(VideoPath::Surface, Some(uploader.clone()));
        push(&frames);
        uploader.failed.store(true, Ordering::SeqCst);
        frames.end("track");
        assert_eq!(uploader.removed.lock().unwrap().len(), 1);
    }
}
