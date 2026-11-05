//! Generated images and emoji, so the rig needs no fixtures.

use crate::data::{ANIMATED_FROM, EMOJI_COUNT, IMAGE_FILES, image_size};
use gpui_kit::RenderImage;
use image::{Delay, Frame, RgbaImage};
use std::path::{Path, PathBuf};
use std::sync::Arc;

pub fn image_path(dir: &Path, file: u32) -> PathBuf {
    dir.join(format!("img-{file:04}.png"))
}

fn write_one(dir: &Path, file: u32) -> anyhow::Result<()> {
    let path = image_path(dir, file);
    if path.exists() {
        return Ok(());
    }
    let (w, h) = image_size(file);
    let image = RgbaImage::from_fn(w as u32, h as u32, |x, y| {
        let f = file;
        let cell = ((x / 40) ^ (y / 40))
            .wrapping_mul(2_654_435_761)
            .wrapping_add(f.wrapping_mul(97));
        image::Rgba([
            (x * 255 / w as u32) as u8 ^ (cell >> 24) as u8 & 0x3f,
            (y * 255 / h as u32) as u8 ^ (cell >> 16) as u8 & 0x3f,
            (f * 37 % 255) as u8 ^ (cell >> 8) as u8 & 0x3f,
            255,
        ])
    });
    let tmp = path.with_extension(format!("tmp-{}", std::process::id()));
    image.save_with_format(&tmp, image::ImageFormat::Png)?;
    std::fs::rename(&tmp, &path)?;
    Ok(())
}

/// Writes `IMAGE_FILES` distinct PNGs. A file is only written if it is missing.
pub fn ensure_images(dir: &Path) -> anyhow::Result<()> {
    std::fs::create_dir_all(dir)?;
    let threads = 8u32;
    std::thread::scope(|scope| {
        let handles: Vec<_> = (0..threads)
            .map(|t| {
                scope.spawn(move || -> anyhow::Result<()> {
                    for file in (t..IMAGE_FILES).step_by(threads as usize) {
                        write_one(dir, file)?;
                    }
                    Ok(())
                })
            })
            .collect();
        handles
            .into_iter()
            .try_for_each(|h| h.join().expect("image thread panicked"))
    })
}

fn emoji_frame(emoji: u16, frame: u32, frames: u32) -> Frame {
    const SIZE: u32 = 32;
    let hue = emoji as f32 / EMOJI_COUNT as f32;
    let phase = frame as f32 / frames as f32 * std::f32::consts::TAU;
    let radius = 13.0 + 2.5 * phase.sin();
    let buffer = RgbaImage::from_fn(SIZE, SIZE, |x, y| {
        let dx = x as f32 - 15.5;
        let dy = y as f32 - 15.5 + 2.0 * phase.cos();
        if dx * dx + dy * dy <= radius * radius {
            // GPUI's RenderImage frames are BGRA.
            image::Rgba([
                (255.0 * (1.0 - hue)) as u8,
                (127.0 + 127.0 * phase.cos()) as u8,
                (255.0 * hue) as u8,
                255,
            ])
        } else {
            image::Rgba([0, 0, 0, 0])
        }
    });
    Frame::from_parts(buffer, 0, 0, Delay::from_numer_denom_ms(80, 1))
}

/// Emoji, decoded once and held for the process, as the real client's emoji set would be. Those
/// from `ANIMATED_FROM` on have eight frames.
pub fn build_emoji() -> Vec<Arc<RenderImage>> {
    (0..EMOJI_COUNT)
        .map(|emoji| {
            let frames = if emoji >= ANIMATED_FROM { 8 } else { 1 };
            let frames: Vec<Frame> = (0..frames)
                .map(|frame| emoji_frame(emoji, frame, frames))
                .collect();
            Arc::new(RenderImage::new(frames))
        })
        .collect()
}
