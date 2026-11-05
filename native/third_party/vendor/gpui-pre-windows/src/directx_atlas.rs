use collections::FxHashMap;
use etagere::BucketedAtlasAllocator;
use parking_lot::Mutex;
use std::sync::Arc;
use windows::Win32::Graphics::{
    Direct3D11::{
        D3D11_BIND_SHADER_RESOURCE, D3D11_BOX, D3D11_CPU_ACCESS_WRITE, D3D11_MAP_WRITE_DISCARD,
        D3D11_MAPPED_SUBRESOURCE, D3D11_TEXTURE2D_DESC, D3D11_USAGE_DEFAULT, D3D11_USAGE_DYNAMIC,
        ID3D11Device, ID3D11DeviceContext, ID3D11ShaderResourceView, ID3D11Texture2D,
    },
    Dxgi::Common::*,
};

use gpui::{
    AtlasBackend, AtlasKey, AtlasState, AtlasTextureId, AtlasTextureKind, AtlasTextureList,
    AtlasTile, Bounds, DevicePixels, PlatformAtlas, Point, Size,
};

pub(crate) struct DirectXAtlas(Mutex<AtlasState<DirectXAtlasTextures>>, DirectXVideo);

/// The immediate context is single-threaded, so `VideoUploader::upload` only parks the latest
/// frame here, and `DirectXAtlas::flush_video` writes it into the textures before each draw.
#[derive(Default)]
struct DirectXVideoQueue(Mutex<DirectXVideoQueueState>);

#[derive(Default)]
struct DirectXVideoQueueState {
    pending: FxHashMap<gpui::VideoSurfaceId, PendingVideoFrame>,
    removed: Vec<gpui::VideoSurfaceId>,
    spare: Vec<PendingVideoFrame>,
}

#[derive(Default)]
struct PendingVideoFrame {
    width: u32,
    height: u32,
    y: Vec<u8>,
    y_stride: u32,
    uv: Vec<u8>,
    uv_stride: u32,
}

impl gpui::VideoUploader for DirectXVideoQueue {
    fn upload(&self, id: gpui::VideoSurfaceId, frame: &gpui::Nv12Frame<'_>) {
        let chroma_height = frame.height.div_ceil(2);
        if frame.y.len() < (frame.y_stride * frame.height) as usize
            || frame.uv.len() < (frame.uv_stride * chroma_height) as usize
            || frame.y_stride < frame.width
            || frame.uv_stride < frame.width.div_ceil(2) * 2
        {
            log::error!("video frame planes are smaller than its dimensions");
            return;
        }
        let mut parked = self.0.lock().spare.pop().unwrap_or_default();
        parked.width = frame.width;
        parked.height = frame.height;
        parked.y_stride = frame.y_stride;
        parked.uv_stride = frame.uv_stride;
        parked.y.clear();
        parked.y.extend_from_slice(frame.y);
        parked.uv.clear();
        parked.uv.extend_from_slice(frame.uv);
        let mut state = self.0.lock();
        if let Some(superseded) = state.pending.insert(id, parked) {
            state.spare.push(superseded);
        }
    }

    fn remove(&self, id: gpui::VideoSurfaceId) {
        let mut state = self.0.lock();
        if let Some(pending) = state.pending.remove(&id) {
            state.spare.push(pending);
        }
        state.removed.push(id);
    }
}

#[derive(Default)]
struct DirectXVideo {
    queue: Arc<DirectXVideoQueue>,
    textures: Mutex<FxHashMap<gpui::VideoSurfaceId, DirectXVideoTexture>>,
}

struct DirectXVideoTexture {
    size: (u32, u32),
    y: ID3D11Texture2D,
    uv: ID3D11Texture2D,
    y_view: [Option<ID3D11ShaderResourceView>; 1],
    uv_view: [Option<ID3D11ShaderResourceView>; 1],
}

impl DirectXVideoTexture {
    fn new(device: &ID3D11Device, width: u32, height: u32) -> anyhow::Result<Self> {
        let (y, y_view) = Self::plane(device, width, height, DXGI_FORMAT_R8_UNORM)?;
        let (uv, uv_view) = Self::plane(
            device,
            width.div_ceil(2),
            height.div_ceil(2),
            DXGI_FORMAT_R8G8_UNORM,
        )?;
        Ok(Self {
            size: (width, height),
            y,
            uv,
            y_view,
            uv_view,
        })
    }

    fn plane(
        device: &ID3D11Device,
        width: u32,
        height: u32,
        format: DXGI_FORMAT,
    ) -> anyhow::Result<(ID3D11Texture2D, [Option<ID3D11ShaderResourceView>; 1])> {
        let desc = D3D11_TEXTURE2D_DESC {
            Width: width,
            Height: height,
            MipLevels: 1,
            ArraySize: 1,
            Format: format,
            SampleDesc: DXGI_SAMPLE_DESC {
                Count: 1,
                Quality: 0,
            },
            // Dynamic: Map(WRITE_DISCARD) renames the texture, so a draw still using the
            // previous frame neither stalls nor forces the driver into a staging copy.
            Usage: D3D11_USAGE_DYNAMIC,
            BindFlags: D3D11_BIND_SHADER_RESOURCE.0 as u32,
            CPUAccessFlags: D3D11_CPU_ACCESS_WRITE.0 as u32,
            MiscFlags: 0,
        };
        let mut texture = None;
        let mut view = None;
        unsafe {
            device.CreateTexture2D(&desc, None, Some(&mut texture))?;
        }
        let texture = texture.ok_or_else(|| anyhow::anyhow!("CreateTexture2D returned nothing"))?;
        unsafe {
            device.CreateShaderResourceView(&texture, None, Some(&mut view))?;
        }
        Ok((texture, [view]))
    }

    fn write_plane(
        device_context: &ID3D11DeviceContext,
        texture: &ID3D11Texture2D,
        source: &[u8],
        source_stride: u32,
        row_bytes: u32,
        rows: u32,
    ) -> anyhow::Result<()> {
        let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
        unsafe {
            device_context.Map(texture, 0, D3D11_MAP_WRITE_DISCARD, 0, Some(&mut mapped))?;
            for row in 0..rows as usize {
                std::ptr::copy_nonoverlapping(
                    source.as_ptr().add(row * source_stride as usize),
                    (mapped.pData as *mut u8).add(row * mapped.RowPitch as usize),
                    row_bytes as usize,
                );
            }
            device_context.Unmap(texture, 0);
        }
        Ok(())
    }
}

struct DirectXAtlasTextures {
    device: ID3D11Device,
    device_context: ID3D11DeviceContext,
    monochrome_textures: AtlasTextureList<DirectXAtlasTexture>,
    polychrome_textures: AtlasTextureList<DirectXAtlasTexture>,
    subpixel_textures: AtlasTextureList<DirectXAtlasTexture>,
}

struct DirectXAtlasTexture {
    id: AtlasTextureId,
    bytes_per_pixel: u32,
    allocator: BucketedAtlasAllocator,
    texture: ID3D11Texture2D,
    view: [Option<ID3D11ShaderResourceView>; 1],
    live_atlas_keys: u32,
}

impl DirectXAtlas {
    pub(crate) fn new(device: &ID3D11Device, device_context: &ID3D11DeviceContext) -> Self {
        DirectXAtlas(
            Mutex::new(AtlasState::new(DirectXAtlasTextures {
                device: device.clone(),
                device_context: device_context.clone(),
                monochrome_textures: Default::default(),
                polychrome_textures: Default::default(),
                subpixel_textures: Default::default(),
            })),
            DirectXVideo::default(),
        )
    }

    /// Writes each surface's latest parked frame into its textures. Runs on the render thread.
    pub(crate) fn flush_video(&self) -> anyhow::Result<()> {
        let (pending, removed) = {
            let mut state = self.1.queue.0.lock();
            if state.pending.is_empty() && state.removed.is_empty() {
                return Ok(());
            }
            (
                std::mem::take(&mut state.pending),
                std::mem::take(&mut state.removed),
            )
        };
        let (device, device_context) = {
            let lock = self.0.lock();
            (lock.backend.device.clone(), lock.backend.device_context.clone())
        };
        let mut textures = self.1.textures.lock();
        for id in removed {
            textures.remove(&id);
        }
        let mut spare = Vec::with_capacity(pending.len());
        for (id, frame) in pending {
            let current = textures
                .get(&id)
                .is_some_and(|texture| texture.size == (frame.width, frame.height));
            if !current {
                textures.insert(id, DirectXVideoTexture::new(&device, frame.width, frame.height)?);
            }
            let texture = &textures[&id];
            DirectXVideoTexture::write_plane(
                &device_context,
                &texture.y,
                &frame.y,
                frame.y_stride,
                frame.width,
                frame.height,
            )?;
            DirectXVideoTexture::write_plane(
                &device_context,
                &texture.uv,
                &frame.uv,
                frame.uv_stride,
                frame.width.div_ceil(2) * 2,
                frame.height.div_ceil(2),
            )?;
            spare.push(frame);
        }
        self.1.queue.0.lock().spare.append(&mut spare);
        Ok(())
    }

    /// The luma and chroma views of a surface that has received a frame.
    pub(crate) fn video_views(
        &self,
        id: gpui::VideoSurfaceId,
    ) -> Option<(
        [Option<ID3D11ShaderResourceView>; 1],
        [Option<ID3D11ShaderResourceView>; 1],
    )> {
        let textures = self.1.textures.lock();
        let texture = textures.get(&id)?;
        Some((texture.y_view.clone(), texture.uv_view.clone()))
    }

    /// Returns the view backing `id`, or `None` once every tile in it has been
    /// removed. A scene can still reference such a texture when a cached view
    /// replays a paint from before the image was dropped, so callers must skip
    /// those sprites rather than assume the texture exists.
    pub(crate) fn get_texture_view(
        &self,
        id: AtlasTextureId,
    ) -> Option<[Option<ID3D11ShaderResourceView>; 1]> {
        let lock = self.0.lock();
        let texture = lock.backend.texture(id)?;
        Some(texture.view.clone())
    }

    pub(crate) fn handle_device_lost(
        &self,
        device: &ID3D11Device,
        device_context: &ID3D11DeviceContext,
    ) {
        // Textures died with the old device. The next upload to each surface recreates them.
        self.1.textures.lock().clear();
        let mut lock = self.0.lock();
        lock.clear(|textures| {
            textures.device = device.clone();
            textures.device_context = device_context.clone();
            textures.monochrome_textures = AtlasTextureList::default();
            textures.polychrome_textures = AtlasTextureList::default();
            textures.subpixel_textures = AtlasTextureList::default();
        });
    }
}

impl PlatformAtlas for DirectXAtlas {
    fn video_uploader(&self) -> Option<Arc<dyn gpui::VideoUploader>> {
        Some(self.1.queue.clone())
    }

    fn get_or_insert_with<'a>(
        &self,
        key: AtlasKey,
        build: &mut dyn FnMut() -> anyhow::Result<
            Option<(Size<DevicePixels>, std::borrow::Cow<'a, [u8]>)>,
        >,
    ) -> anyhow::Result<Option<AtlasTile>> {
        self.0.lock().get_or_insert_with(key, build)
    }

    fn remove(&self, key: &AtlasKey) {
        self.0.lock().remove(key);
    }
}

impl AtlasBackend for DirectXAtlasTextures {
    fn insert(
        &mut self,
        kind: AtlasTextureKind,
        size: Size<DevicePixels>,
        bytes: &[u8],
    ) -> anyhow::Result<AtlasTile> {
        let tile = self
            .allocate(size, kind)
            .ok_or_else(|| anyhow::anyhow!("failed to allocate"))?;
        let texture = self
            .texture(tile.texture_id)
            .ok_or_else(|| anyhow::anyhow!("allocated tile refers to a missing texture"))?;
        texture.upload(&self.device_context, tile.bounds, bytes);
        Ok(tile)
    }

    fn remove(&mut self, tile: AtlasTile) {
        let id = tile.texture_id;

        let textures = match id.kind {
            AtlasTextureKind::Monochrome => &mut self.monochrome_textures,
            AtlasTextureKind::Polychrome => &mut self.polychrome_textures,
            AtlasTextureKind::Subpixel => &mut self.subpixel_textures,
        };

        let Some(texture_slot) = textures.textures.get_mut(id.index as usize) else {
            return;
        };

        if let Some(mut texture) = texture_slot.take() {
            texture.allocator.deallocate(tile.tile_id.into());
            texture.decrement_ref_count();
            if texture.is_unreferenced() {
                textures.free_list.push(texture.id.index as usize);
            } else {
                *texture_slot = Some(texture);
            }
        }
    }
}

impl DirectXAtlasTextures {
    fn allocate(
        &mut self,
        size: Size<DevicePixels>,
        texture_kind: AtlasTextureKind,
    ) -> Option<AtlasTile> {
        {
            let textures = match texture_kind {
                AtlasTextureKind::Monochrome => &mut self.monochrome_textures,
                AtlasTextureKind::Polychrome => &mut self.polychrome_textures,
                AtlasTextureKind::Subpixel => &mut self.subpixel_textures,
            };

            if let Some(tile) = textures
                .iter_mut()
                .rev()
                .find_map(|texture| texture.allocate(size))
            {
                return Some(tile);
            }
        }

        let texture = self.push_texture(size, texture_kind)?;
        texture.allocate(size)
    }

    fn push_texture(
        &mut self,
        min_size: Size<DevicePixels>,
        kind: AtlasTextureKind,
    ) -> Option<&mut DirectXAtlasTexture> {
        const DEFAULT_ATLAS_SIZE: Size<DevicePixels> = Size {
            width: DevicePixels(1024),
            height: DevicePixels(1024),
        };
        // Max texture size for DirectX. See:
        // https://learn.microsoft.com/en-us/windows/win32/direct3d11/overviews-direct3d-11-resources-limits
        const MAX_ATLAS_SIZE: Size<DevicePixels> = Size {
            width: DevicePixels(16384),
            height: DevicePixels(16384),
        };
        let size = min_size.min(&MAX_ATLAS_SIZE).max(&DEFAULT_ATLAS_SIZE);
        let pixel_format;
        let bind_flag;
        let bytes_per_pixel;
        match kind {
            AtlasTextureKind::Monochrome => {
                pixel_format = DXGI_FORMAT_R8_UNORM;
                bind_flag = D3D11_BIND_SHADER_RESOURCE;
                bytes_per_pixel = 1;
            }
            AtlasTextureKind::Polychrome => {
                pixel_format = DXGI_FORMAT_B8G8R8A8_UNORM;
                bind_flag = D3D11_BIND_SHADER_RESOURCE;
                bytes_per_pixel = 4;
            }
            AtlasTextureKind::Subpixel => {
                pixel_format = DXGI_FORMAT_R8G8B8A8_UNORM;
                bind_flag = D3D11_BIND_SHADER_RESOURCE;
                bytes_per_pixel = 4;
            }
        }
        let texture_desc = D3D11_TEXTURE2D_DESC {
            Width: size.width.0 as u32,
            Height: size.height.0 as u32,
            MipLevels: 1,
            ArraySize: 1,
            Format: pixel_format,
            SampleDesc: DXGI_SAMPLE_DESC {
                Count: 1,
                Quality: 0,
            },
            Usage: D3D11_USAGE_DEFAULT,
            BindFlags: bind_flag.0 as u32,
            CPUAccessFlags: 0,
            MiscFlags: 0,
        };
        let mut texture: Option<ID3D11Texture2D> = None;
        unsafe {
            // This only returns None if the device is lost, which we will recreate later.
            // So it's ok to return None here.
            self.device
                .CreateTexture2D(&texture_desc, None, Some(&mut texture))
                .ok()?;
        }
        let texture = texture.unwrap();

        let texture_list = match kind {
            AtlasTextureKind::Monochrome => &mut self.monochrome_textures,
            AtlasTextureKind::Polychrome => &mut self.polychrome_textures,
            AtlasTextureKind::Subpixel => &mut self.subpixel_textures,
        };
        let index = texture_list.free_list.pop();
        let view = unsafe {
            let mut view = None;
            self.device
                .CreateShaderResourceView(&texture, None, Some(&mut view))
                .ok()?;
            [view]
        };
        let atlas_texture = DirectXAtlasTexture {
            id: AtlasTextureId {
                index: index.unwrap_or(texture_list.textures.len()) as u32,
                kind,
            },
            bytes_per_pixel,
            allocator: etagere::BucketedAtlasAllocator::new(device_size_to_etagere(size)),
            texture,
            view,
            live_atlas_keys: 0,
        };
        if let Some(ix) = index {
            texture_list.textures[ix] = Some(atlas_texture);
            texture_list.textures.get_mut(ix).unwrap().as_mut()
        } else {
            texture_list.textures.push(Some(atlas_texture));
            texture_list.textures.last_mut().unwrap().as_mut()
        }
    }

    fn texture(&self, id: AtlasTextureId) -> Option<&DirectXAtlasTexture> {
        let textures = match id.kind {
            AtlasTextureKind::Monochrome => &self.monochrome_textures,
            AtlasTextureKind::Polychrome => &self.polychrome_textures,
            AtlasTextureKind::Subpixel => &self.subpixel_textures,
        };
        textures.textures.get(id.index as usize)?.as_ref()
    }
}

impl DirectXAtlasTexture {
    fn allocate(&mut self, size: Size<DevicePixels>) -> Option<AtlasTile> {
        let allocation = self.allocator.allocate(device_size_to_etagere(size))?;
        let tile = AtlasTile {
            texture_id: self.id,
            tile_id: allocation.id.into(),
            bounds: Bounds {
                origin: etagere_point_to_device(allocation.rectangle.min),
                size,
            },
            padding: 0,
        };
        self.live_atlas_keys += 1;
        Some(tile)
    }

    fn upload(
        &self,
        device_context: &ID3D11DeviceContext,
        bounds: Bounds<DevicePixels>,
        bytes: &[u8],
    ) {
        // `UpdateSubresource` reads `row_pitch * height` bytes from `bytes` based on the
        // `D3D11_BOX` below. If the caller hands us a slice shorter than that, the driver would
        // over-read past the end of the source buffer (potentially by multiple megabytes), so bail
        // out instead. This is a first-insert path rather than a per-frame one, so the check is
        // effectively free.
        let row_bytes = bounds.size.width.to_bytes(self.bytes_per_pixel as u8) as usize;
        let expected = row_bytes * bounds.size.height.0.max(0) as usize;
        if bytes.len() < expected {
            log::error!(
                "DirectXAtlasTexture::upload: source slice is {} bytes but the {}x{} region \
                 requires {} bytes; skipping upload to avoid a driver over-read",
                bytes.len(),
                bounds.size.width.0,
                bounds.size.height.0,
                expected,
            );
            return;
        }
        unsafe {
            device_context.UpdateSubresource(
                &self.texture,
                0,
                Some(&D3D11_BOX {
                    left: bounds.left().0 as u32,
                    top: bounds.top().0 as u32,
                    front: 0,
                    right: bounds.right().0 as u32,
                    bottom: bounds.bottom().0 as u32,
                    back: 1,
                }),
                bytes.as_ptr() as _,
                bounds.size.width.to_bytes(self.bytes_per_pixel as u8),
                0,
            );
        }
    }

    fn decrement_ref_count(&mut self) {
        self.live_atlas_keys -= 1;
    }

    fn is_unreferenced(&mut self) -> bool {
        self.live_atlas_keys == 0
    }
}

fn device_size_to_etagere(size: Size<DevicePixels>) -> etagere::Size {
    etagere::Size::new(size.width.into(), size.height.into())
}

fn etagere_point_to_device(value: etagere::Point) -> Point<DevicePixels> {
    Point {
        x: DevicePixels::from(value.x),
        y: DevicePixels::from(value.y),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use gpui::{ImageId, RenderImageParams};
    use std::borrow::Cow;
    use windows::Win32::{
        Foundation::HMODULE,
        Graphics::{
            Direct3D::D3D_DRIVER_TYPE_WARP,
            Direct3D11::{D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_SDK_VERSION, D3D11CreateDevice},
        },
    };

    fn create_atlas() -> Option<DirectXAtlas> {
        let mut device: Option<ID3D11Device> = None;
        let mut device_context: Option<ID3D11DeviceContext> = None;
        unsafe {
            D3D11CreateDevice(
                None,
                D3D_DRIVER_TYPE_WARP,
                HMODULE::default(),
                D3D11_CREATE_DEVICE_BGRA_SUPPORT,
                None,
                D3D11_SDK_VERSION,
                Some(&mut device),
                None,
                Some(&mut device_context),
            )
        }
        .ok()?;
        Some(DirectXAtlas::new(&device?, &device_context?))
    }

    fn make_image_key(image_id: usize) -> AtlasKey {
        AtlasKey::Image(RenderImageParams {
            image_id: ImageId(image_id),
            frame_index: 0,
        })
    }

    fn insert_tile(atlas: &DirectXAtlas, key: AtlasKey, size: Size<DevicePixels>) -> AtlasTile {
        atlas
            .get_or_insert_with(key, &mut || {
                let byte_count = (size.width.0 as usize) * (size.height.0 as usize) * 4;
                Ok(Some((size, Cow::Owned(vec![0u8; byte_count]))))
            })
            .expect("allocation should succeed")
            .expect("callback returns Some")
    }

    #[test]
    fn test_remove_deallocates_tile_space_for_reuse() {
        let Some(atlas) = create_atlas() else {
            return;
        };

        let small = Size {
            width: DevicePixels(64),
            height: DevicePixels(64),
        };
        let big = Size {
            width: DevicePixels(700),
            height: DevicePixels(700),
        };

        let keeper_key = make_image_key(1);
        let big_key_a = make_image_key(2);
        let big_key_b = make_image_key(3);

        let keeper_tile = insert_tile(&atlas, keeper_key, small);
        let tile_a = insert_tile(&atlas, big_key_a.clone(), big);
        assert_eq!(keeper_tile.texture_id, tile_a.texture_id);

        atlas.remove(&big_key_a);

        let tile_b = insert_tile(&atlas, big_key_b, big);
        assert_eq!(tile_b.texture_id, keeper_tile.texture_id);
    }
}
