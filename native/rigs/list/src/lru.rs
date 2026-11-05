//! A bounded image cache. GPUI's `RetainAllImageCache` and the global asset cache never let go
//! of a decoded image or its atlas tile, so a long scroll grows without limit.

use gpui_kit::{
    App, AppContext as _, Entity, ImageCache, ImageCacheError, ImageCacheItem, RenderImage,
    Resource, Window,
};
use std::collections::{HashMap, VecDeque};
use std::sync::Arc;

pub struct LruImageCache {
    max_bytes: usize,
    bytes: usize,
    items: HashMap<Resource, (ImageCacheItem, usize)>,
    order: VecDeque<Resource>,
    pub evicted: usize,
}

impl LruImageCache {
    pub fn new(max_bytes: usize, cx: &mut App) -> Entity<Self> {
        cx.new(|_| LruImageCache {
            max_bytes,
            bytes: 0,
            items: HashMap::new(),
            order: VecDeque::new(),
            evicted: 0,
        })
    }

    pub fn bytes(&self) -> usize {
        self.bytes
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
                .insert(resource.clone(), (ImageCacheItem::new(resource, cx), 0));
            self.order.push_back(resource.clone());
        }
        if let Some(position) = self.order.iter().position(|r| r == resource)
            && position + 1 != self.order.len()
        {
            let item = self.order.remove(position).expect("position is in range");
            self.order.push_back(item);
        }
        let (item, counted) = self.items.get_mut(resource).expect("just inserted");
        let result = item.use_image(window);
        if *counted == 0
            && let Some(Ok(image)) = &result
        {
            *counted = image_bytes(image);
            self.bytes += *counted;
        }
        // Keep the newest entries; a row on screen re-enters on its next layout.
        while self.bytes > self.max_bytes && self.order.len() > 16 {
            let Some(oldest) = self.order.pop_front() else {
                break;
            };
            if let Some((item, counted)) = self.items.remove(&oldest) {
                self.bytes -= counted;
                self.evicted += 1;
                if let Some(Ok(image)) = item.get() {
                    cx.drop_image(image, Some(window));
                }
            }
        }
        result
    }
}
