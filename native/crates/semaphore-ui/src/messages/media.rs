//! Images: where they come from, a bounded decode cache, animation timing, and the allocator setting
//! that makes the bound real.

use gpui_kit::*;
use semaphore_core::model::AttachmentView;
use std::collections::HashMap;
use std::hash::Hash;
use std::rc::Rc;
use std::sync::Arc;
use std::time::Duration;

/// Decoded attachments. T2 held a 100k-row fling at about 370 MB with this much, and 642 MB without
/// the allocator setting below.
pub const IMAGE_BUDGET_BYTES: usize = 128 * 1024 * 1024;
/// Emoji and avatars, which are small and come back constantly, so the attachments' churn must not
/// evict them.
pub const SMALL_BUDGET_BYTES: usize = 32 * 1024 * 1024;
/// A cap on entries, because a failed or pending load holds no bytes but does hold an entry.
const MAX_ENTRIES: usize = 4096;
/// The newest entries, kept whatever the budget says: rows on screen re-enter on every layout, and
/// evicting one of those would reload it forever.
const KEEP_NEWEST: usize = 16;

/// How the list gets an image. Files need the session's auth, so the app supplies this over its own
/// loader; stories and rigs hand over images they built.
pub trait MediaSource: 'static {
    fn attachment(&self, attachment: &AttachmentView) -> MediaRef;
    fn emoji(&self, emoji_id: &str) -> MediaRef;
    fn avatar(&self, file_id: &str) -> MediaRef;
}

#[derive(Clone)]
pub enum MediaRef {
    /// Already decoded, and not counted against the budget.
    Ready(Arc<RenderImage>),
    /// Loaded through the bounded cache, by whatever `AssetSource` or path this names.
    Resource(Resource),
    /// This source has nothing for it.
    Missing,
}

/// No images: every attachment stays a placeholder.
pub struct NoMedia;

impl MediaSource for NoMedia {
    fn attachment(&self, _: &AttachmentView) -> MediaRef {
        MediaRef::Missing
    }
    fn emoji(&self, _: &str) -> MediaRef {
        MediaRef::Missing
    }
    fn avatar(&self, _: &str) -> MediaRef {
        MediaRef::Missing
    }
}

#[derive(Clone)]
pub enum MediaState {
    Loading,
    Ready(Arc<RenderImage>),
    Failed,
}

/// A source and its two caches.
pub struct Media {
    pub source: Rc<dyn MediaSource>,
    pub images: Entity<LruImageCache>,
    pub small: Entity<LruImageCache>,
}

#[derive(Clone, Copy)]
pub enum CacheKind {
    Images,
    Small,
}

impl Media {
    pub fn new(source: Rc<dyn MediaSource>, cx: &mut App) -> Self {
        Self {
            source,
            images: LruImageCache::new(IMAGE_BUDGET_BYTES, cx),
            small: LruImageCache::new(SMALL_BUDGET_BYTES, cx),
        }
    }

    /// Where the image is now. Called while laying out a row, so when a load finishes the view that
    /// asked is notified and redraws.
    pub fn resolve(
        &self,
        media: MediaRef,
        kind: CacheKind,
        window: &mut Window,
        cx: &mut App,
    ) -> MediaState {
        match media {
            MediaRef::Ready(image) => MediaState::Ready(image),
            MediaRef::Missing => MediaState::Failed,
            MediaRef::Resource(resource) => {
                let cache = match kind {
                    CacheKind::Images => &self.images,
                    CacheKind::Small => &self.small,
                };
                match cache.update(cx, |cache, cx| cache.load(&resource, window, cx)) {
                    None => MediaState::Loading,
                    Some(Ok(image)) => MediaState::Ready(image),
                    Some(Err(_)) => MediaState::Failed,
                }
            }
        }
    }
}

/// Which entries to drop, separate from GPUI so the policy can be tested. Least recently used first,
/// by a tick rather than a list, because `load` runs for every image in view on every frame and the
/// common case must not walk anything.
pub(crate) struct Ledger<K> {
    max_bytes: usize,
    bytes: usize,
    tick: u64,
    entries: HashMap<K, (u64, usize)>,
}

impl<K: Clone + Eq + Hash> Ledger<K> {
    pub fn new(max_bytes: usize) -> Self {
        Self {
            max_bytes,
            bytes: 0,
            tick: 0,
            entries: HashMap::new(),
        }
    }

    pub fn bytes(&self) -> usize {
        self.bytes
    }

    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn touch(&mut self, key: &K) {
        self.tick += 1;
        match self.entries.get_mut(key) {
            Some(entry) => entry.0 = self.tick,
            None => {
                self.entries.insert(key.clone(), (self.tick, 0));
            }
        }
    }

    /// Records a decoded size, once.
    pub fn set_bytes(&mut self, key: &K, bytes: usize) {
        if let Some(entry) = self.entries.get_mut(key)
            && entry.1 == 0
        {
            entry.1 = bytes;
            self.bytes += bytes;
        }
    }

    /// The next entry to evict, if over budget, removed from the ledger.
    pub fn pop_victim(&mut self) -> Option<K> {
        let over = self.bytes > self.max_bytes || self.entries.len() > MAX_ENTRIES;
        if !over || self.entries.len() <= KEEP_NEWEST {
            return None;
        }
        let victim = self
            .entries
            .iter()
            .min_by_key(|(_, (tick, _))| *tick)
            .map(|(key, _)| key.clone())?;
        let (_, bytes) = self.entries.remove(&victim)?;
        self.bytes -= bytes;
        Some(victim)
    }
}

/// A bounded image cache. GPUI's `RetainAllImageCache` and the global asset cache never let go of a
/// decoded image or its atlas tile, so a long scroll grows without limit.
pub struct LruImageCache {
    ledger: Ledger<Resource>,
    items: HashMap<Resource, ImageCacheItem>,
    pub evicted: usize,
}

impl LruImageCache {
    pub fn new(max_bytes: usize, cx: &mut App) -> Entity<Self> {
        cx.new(|_| Self {
            ledger: Ledger::new(max_bytes),
            items: HashMap::new(),
            evicted: 0,
        })
    }

    pub fn bytes(&self) -> usize {
        self.ledger.bytes()
    }
}

fn image_bytes(image: &RenderImage) -> usize {
    (0..image.frame_count())
        .map(|frame| image.as_bytes(frame).map_or(0, <[u8]>::len))
        .sum()
}

impl ImageCache for LruImageCache {
    fn load(
        &mut self,
        resource: &Resource,
        window: &mut Window,
        cx: &mut App,
    ) -> Option<Result<Arc<RenderImage>, ImageCacheError>> {
        if !self.items.contains_key(resource) {
            self.items
                .insert(resource.clone(), ImageCacheItem::new(resource, cx));
        }
        self.ledger.touch(resource);
        let result = self.items.get(resource)?.use_image(window);
        if let Some(Ok(image)) = &result {
            self.ledger.set_bytes(resource, image_bytes(image));
        }
        while let Some(victim) = self.ledger.pop_victim() {
            self.evicted += 1;
            if let Some(item) = self.items.remove(&victim)
                && let Some(Ok(image)) = item.get()
            {
                cx.drop_image(image, Some(window));
            }
        }
        result
    }
}

/// Gives freed image decodes back to the OS, in-process instead of `MALLOC_MMAP_THRESHOLD_=262144`
/// in the environment, which a desktop launcher wouldn't set.
///
/// T2's soak with the bounded cache alone reached 642 MB: the cache held 126 MB, and glibc kept the
/// rest in its arenas. Any allocation this big now gets its own mapping, returned on free. The
/// setting also turns off glibc's dynamic threshold, which is what lets the arenas fill up.
#[cfg(all(target_os = "linux", target_env = "gnu"))]
pub fn tune_allocator() -> bool {
    const MMAP_THRESHOLD: i32 = 256 * 1024;
    // SAFETY: `mallopt` only changes allocator parameters. It's safe to call at any time on glibc,
    // which takes the arena lock itself.
    unsafe { libc::mallopt(libc::M_MMAP_THRESHOLD, MMAP_THRESHOLD) == 1 }
}

/// Other allocators have no such setting, and T2 only measured glibc.
#[cfg(not(all(target_os = "linux", target_env = "gnu")))]
pub fn tune_allocator() -> bool {
    false
}

/// A GIF asking for less than this means "as fast as you can", which browsers read as 100 ms. Same
/// here, so a badly encoded emoji can't drive the window at 60 fps.
const SHORTEST_FRAME: Duration = Duration::from_millis(20);
const DEFAULT_FRAME: Duration = Duration::from_millis(100);

fn frame_delay(image: &RenderImage, frame: usize) -> Duration {
    let (numer, denom) = image.delay(frame).numer_denom_ms();
    let delay = Duration::from_millis(u64::from(numer) / u64::from(denom.max(1)));
    if delay < SHORTEST_FRAME {
        DEFAULT_FRAME
    } else {
        delay
    }
}

/// Which frame an animation shows after running for `elapsed`, and for how much longer. `None` for a
/// still image. The clock is shared, so copies of an emoji stay in step.
pub fn animation_frame(image: &RenderImage, elapsed: Duration) -> Option<(usize, Duration)> {
    let frames = image.frame_count();
    if frames <= 1 {
        return None;
    }
    let total: Duration = (0..frames).map(|frame| frame_delay(image, frame)).sum();
    let mut left = Duration::from_nanos((elapsed.as_nanos() % total.as_nanos().max(1)) as u64);
    for frame in 0..frames {
        let delay = frame_delay(image, frame);
        if left < delay {
            return Some((frame, delay - left));
        }
        left -= delay;
    }
    Some((0, frame_delay(image, 0)))
}

/// Fits an image of `size` inside `bounds`, centred, keeping its shape.
pub fn contain(bounds: Bounds<Pixels>, size: Size<DevicePixels>) -> Bounds<Pixels> {
    let (width, height) = (size.width.0 as f32, size.height.0 as f32);
    if width <= 0. || height <= 0. {
        return bounds;
    }
    let scale = (f32::from(bounds.size.width) / width).min(f32::from(bounds.size.height) / height);
    let fitted = gpui_kit::size(px(width * scale), px(height * scale));
    Bounds::new(
        point(
            bounds.left() + (bounds.size.width - fitted.width) / 2.,
            bounds.top() + (bounds.size.height - fitted.height) / 2.,
        ),
        fitted,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    // `gpui_kit::*` exports the `test` attribute, and the macro's own `#[test]` would resolve to it.
    use std::prelude::v1::test;

    #[test]
    fn the_ledger_evicts_oldest_first_down_to_the_budget() {
        let mut ledger = Ledger::new(100);
        for key in 0..20 {
            ledger.touch(&key);
            ledger.set_bytes(&key, 10);
        }
        // 200 bytes held against a budget of 100.
        ledger.touch(&0);
        let mut evicted = Vec::new();
        while let Some(victim) = ledger.pop_victim() {
            evicted.push(victim);
        }
        assert!(ledger.bytes() <= 100 || ledger.len() <= KEEP_NEWEST);
        assert_eq!(evicted.first(), Some(&1), "key 0 was used last");
        assert!(!evicted.contains(&0));
    }

    #[test]
    fn the_ledger_keeps_the_newest_entries_whatever_the_budget() {
        let mut ledger = Ledger::new(1);
        for key in 0..KEEP_NEWEST + 4 {
            ledger.touch(&key);
            ledger.set_bytes(&key, 10_000);
        }
        let mut count = 0;
        while ledger.pop_victim().is_some() {
            count += 1;
        }
        assert_eq!(count, 4);
        assert_eq!(ledger.len(), KEEP_NEWEST);
    }

    #[test]
    fn a_size_is_counted_once_and_entries_with_no_bytes_are_still_capped() {
        let mut ledger = Ledger::new(100);
        ledger.touch(&"a");
        ledger.set_bytes(&"a", 10);
        ledger.set_bytes(&"a", 10);
        assert_eq!(ledger.bytes(), 10);

        let mut ledger = Ledger::new(100);
        for key in 0..MAX_ENTRIES + 3 {
            ledger.touch(&key);
        }
        let mut count = 0;
        while ledger.pop_victim().is_some() {
            count += 1;
        }
        assert_eq!(count, 3);
    }

    #[cfg(all(target_os = "linux", target_env = "gnu"))]
    #[test]
    fn the_allocator_accepts_the_setting() {
        assert!(tune_allocator());
    }

    #[test]
    fn contain_centres_and_keeps_the_shape() {
        let bounds = Bounds::new(point(px(10.), px(10.)), size(px(100.), px(100.)));
        let fitted = contain(bounds, size(DevicePixels(200), DevicePixels(100)));
        assert_eq!(fitted.size, size(px(100.), px(50.)));
        assert_eq!(fitted.origin, point(px(10.), px(35.)));
    }
}
