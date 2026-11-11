//! The tray's pictures: the app icon at tray sizes, and the same with the unread dot.
//!
//! One 512 px PNG is decoded once and box-filtered down, so there's a single source of truth for
//! the artwork. The dot is drawn here, anti-aliased, in the top-right corner, with a ring of
//! transparency around it so it reads on any panel colour.

use std::sync::OnceLock;

/// The app icon, as the desktop entry installs it.
pub const ICON_PNG: &[u8] = include_bytes!("../assets/icon.png");

/// Straight-alpha RGBA, rows top to bottom.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Rgba {
    pub size: u32,
    pub pixels: Vec<u8>,
}

/// The dot's colour: the web's error red.
const DOT: [u8; 3] = [0xe5, 0x39, 0x35];

fn decoded() -> &'static Rgba {
    static ICON: OnceLock<Rgba> = OnceLock::new();
    ICON.get_or_init(|| decode(ICON_PNG).expect("the bundled icon is a square RGBA PNG"))
}

fn decode(bytes: &[u8]) -> Option<Rgba> {
    let mut decoder = png::Decoder::new(std::io::Cursor::new(bytes));
    decoder.set_transformations(png::Transformations::EXPAND);
    let mut reader = decoder.read_info().ok()?;
    let mut buffer = vec![0; reader.output_buffer_size()?];
    let info = reader.next_frame(&mut buffer).ok()?;
    if info.width != info.height || info.bit_depth != png::BitDepth::Eight {
        return None;
    }
    let pixels = match info.color_type {
        png::ColorType::Rgba => buffer[..info.buffer_size()].to_vec(),
        png::ColorType::Rgb => buffer[..info.buffer_size()]
            .as_chunks::<3>()
            .0
            .iter()
            .flat_map(|rgb| [rgb[0], rgb[1], rgb[2], 255])
            .collect(),
        _ => return None,
    };
    Some(Rgba {
        size: info.width,
        pixels,
    })
}

/// `source` scaled to `size` by averaging, weighted by alpha so transparent edges don't darken.
fn scaled(source: &Rgba, size: u32) -> Rgba {
    let mut pixels = vec![0u8; (size * size * 4) as usize];
    let scale = source.size as f64 / size as f64;
    for y in 0..size {
        for x in 0..size {
            let (x0, x1) = (
                (x as f64 * scale) as u32,
                (((x + 1) as f64 * scale).ceil() as u32).min(source.size),
            );
            let (y0, y1) = (
                (y as f64 * scale) as u32,
                (((y + 1) as f64 * scale).ceil() as u32).min(source.size),
            );
            let (mut r, mut g, mut b, mut a, mut n) = (0f64, 0f64, 0f64, 0f64, 0f64);
            for sy in y0..y1 {
                for sx in x0..x1 {
                    let i = ((sy * source.size + sx) * 4) as usize;
                    let alpha = source.pixels[i + 3] as f64;
                    r += source.pixels[i] as f64 * alpha;
                    g += source.pixels[i + 1] as f64 * alpha;
                    b += source.pixels[i + 2] as f64 * alpha;
                    a += alpha;
                    n += 1.;
                }
            }
            let o = ((y * size + x) * 4) as usize;
            if a > 0. {
                pixels[o] = (r / a).round() as u8;
                pixels[o + 1] = (g / a).round() as u8;
                pixels[o + 2] = (b / a).round() as u8;
            }
            pixels[o + 3] = (a / n).round() as u8;
        }
    }
    Rgba { size, pixels }
}

/// The app icon at `size` px.
pub fn app_icon(size: u32) -> Rgba {
    scaled(decoded(), size)
}

/// How much of the pixel at (`x`, `y`) a circle covers, 4x4 supersampled.
fn coverage(x: u32, y: u32, cx: f64, cy: f64, radius: f64) -> f64 {
    let mut inside = 0;
    for sy in 0..4 {
        for sx in 0..4 {
            let px = x as f64 + (sx as f64 + 0.5) / 4.;
            let py = y as f64 + (sy as f64 + 0.5) / 4.;
            if (px - cx).powi(2) + (py - cy).powi(2) <= radius * radius {
                inside += 1;
            }
        }
    }
    inside as f64 / 16.
}

/// `icon` with the unread dot.
pub fn with_dot(icon: &Rgba) -> Rgba {
    let size = icon.size as f64;
    let radius = size * 0.22;
    let ring = (size * 0.06).max(1.);
    let (cx, cy) = (size - radius - ring * 0.5, radius + ring * 0.5);
    let mut out = icon.clone();
    for y in 0..icon.size {
        for x in 0..icon.size {
            let i = ((y * icon.size + x) * 4) as usize;
            // Clear a ring around the dot, then draw the dot over it.
            let cut = coverage(x, y, cx, cy, radius + ring);
            if cut == 0. {
                continue;
            }
            let alpha = out.pixels[i + 3] as f64 * (1. - cut);
            let dot = coverage(x, y, cx, cy, radius);
            let total = dot * 255. + alpha * (1. - dot);
            for (channel, dot_channel) in DOT.iter().enumerate() {
                let under = out.pixels[i + channel] as f64 * alpha * (1. - dot);
                let over = *dot_channel as f64 * 255. * dot;
                out.pixels[i + channel] = if total > 0. {
                    ((under + over) / total).round() as u8
                } else {
                    0
                };
            }
            out.pixels[i + 3] = total.round() as u8;
        }
    }
    out
}

impl Rgba {
    /// ARGB32 in network byte order, as StatusNotifierItem's `IconPixmap` wants.
    pub fn to_argb_be(&self) -> Vec<u8> {
        self.pixels
            .as_chunks::<4>()
            .0
            .iter()
            .flat_map(|p| [p[3], p[0], p[1], p[2]])
            .collect()
    }

    /// BGRA, as a 32-bit Windows DIB wants.
    pub fn to_bgra(&self) -> Vec<u8> {
        self.pixels
            .as_chunks::<4>()
            .0
            .iter()
            .flat_map(|p| [p[2], p[1], p[0], p[3]])
            .collect()
    }

    pub fn pixel(&self, x: u32, y: u32) -> [u8; 4] {
        let i = ((y * self.size + x) * 4) as usize;
        [
            self.pixels[i],
            self.pixels[i + 1],
            self.pixels[i + 2],
            self.pixels[i + 3],
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_icon_scales_to_tray_sizes() {
        for size in [16, 22, 24, 32, 48, 64] {
            let icon = app_icon(size);
            assert_eq!(icon.size, size);
            assert_eq!(icon.pixels.len(), (size * size * 4) as usize);
            // The artwork is opaque in the middle.
            assert!(
                icon.pixel(size / 2, size / 2)[3] > 200,
                "{size}: {:?}",
                icon.pixel(size / 2, size / 2)
            );
        }
    }

    #[test]
    fn the_dot_is_red_in_the_top_right_and_leaves_the_rest() {
        let icon = app_icon(32);
        let dotted = with_dot(&icon);
        let centre = (
            32. - 32. * 0.22 - 32. * 0.06 * 0.5,
            32. * 0.22 + 32. * 0.06 * 0.5,
        );
        let at = dotted.pixel(centre.0 as u32, centre.1 as u32);
        assert_eq!(at, [DOT[0], DOT[1], DOT[2], 255]);
        // The bottom-left quarter is untouched.
        for y in 20..32 {
            for x in 0..12 {
                assert_eq!(dotted.pixel(x, y), icon.pixel(x, y));
            }
        }
        assert_ne!(dotted, icon);
    }

    #[test]
    fn byte_orders() {
        let icon = Rgba {
            size: 1,
            pixels: vec![1, 2, 3, 4],
        };
        assert_eq!(icon.to_argb_be(), vec![4, 1, 2, 3]);
        assert_eq!(icon.to_bgra(), vec![3, 2, 1, 4]);
    }
}
