//! A small PNG that is a pure function of a file id, for the file routes.
//!
//! The real server returns stored bytes; the fake only has the id, and the client only
//! needs something an image decoder accepts and that never changes between runs.

use image::codecs::png::PngEncoder;
use image::{ExtendedColorType, ImageEncoder};

const SIZE: u32 = 16;

fn hash(id: &str) -> u32 {
    let mut value: u32 = 0x811c_9dc5;
    for byte in id.bytes() {
        value ^= u32::from(byte);
        value = value.wrapping_mul(0x0100_0193);
    }
    value
}

/// A 16x16 RGBA PNG whose pixels derive only from `id`.
pub fn png_for(id: &str) -> Vec<u8> {
    let seed = hash(id);
    let mut pixels = Vec::with_capacity((SIZE * SIZE * 4) as usize);
    for y in 0..SIZE {
        for x in 0..SIZE {
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
        .write_image(&pixels, SIZE, SIZE, ExtendedColorType::Rgba8)
        .expect("writing a 16x16 RGBA image into memory cannot fail");
    out
}
