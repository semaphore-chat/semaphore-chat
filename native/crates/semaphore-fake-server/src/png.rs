//! A small PNG that is a pure function of a file id, for the file routes.
//!
//! The real server returns stored bytes; the fake only has the id, and the client only
//! needs something an image decoder accepts and that never changes between runs.

use image::codecs::png::PngEncoder;
use image::{ExtendedColorType, ImageEncoder};

// Larger than anything draws them, so a scaled image never samples within half a texel of its
// edge: GPUI packs images edge to edge in its atlas, and an upscaled image's edge picks up its
// neighbour, which depends on the order images were decoded in (random in a headless run).
// Avatars and emoji draw small; attachments and preview images up to a few hundred pixels.
const SMALL: u32 = 256;
const LARGE: u32 = 640;

fn hash(id: &str) -> u32 {
    let mut value: u32 = 0x811c_9dc5;
    for byte in id.bytes() {
        value ^= u32::from(byte);
        value = value.wrapping_mul(0x0100_0193);
    }
    value
}

/// An RGBA PNG whose pixels derive only from `id`: 256 pixels square for avatars and emoji, 640
/// for everything else.
pub fn png_for(id: &str) -> Vec<u8> {
    let seed = hash(id);
    let size = if id.contains("avatar") || id.contains("emoji") {
        SMALL
    } else {
        LARGE
    };
    let mut pixels = Vec::with_capacity((size * size * 4) as usize);
    for y in 0..size {
        for x in 0..size {
            let mixed = seed
                .wrapping_add(x.wrapping_mul(0x9e37_79b9))
                .wrapping_add(y.wrapping_mul(0x85eb_ca6b));
            pixels.extend_from_slice(&[
                (mixed & 0xff) as u8,
                ((mixed >> 8) & 0xff) as u8,
                ((mixed >> 16) & 0xff) as u8,
                0xff,
            ]);
        }
    }
    let mut out = Vec::new();
    PngEncoder::new(&mut out)
        .write_image(&pixels, size, size, ExtendedColorType::Rgba8)
        .expect("writing an RGBA image into memory cannot fail");
    out
}
