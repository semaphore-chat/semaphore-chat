//! Image dimensions and thumbnails, as the backend's `MediaDimensionsService` and
//! `ThumbnailService.generateImageThumbnail` produce them.
//!
//! The fake server's `image` dependency enables only the PNG codec (it was there for the
//! generated stand-in pictures), so PNG dimensions and pixels come from it and the other three
//! formats the backend measures — JPEG, GIF and WebP — are read by the small header parsers
//! below. A thumbnail of a non-PNG is therefore a valid PNG of the original's shape rather than
//! a JPEG of its pixels; the route serves it as `image/png`, its true type.
//!
//! Best-effort throughout, like the backend: an upload must never fail because its bytes could
//! not be measured, so every failure is `None`. Only raster images are measured here; SVG is
//! resolution-independent, and the fake has no video probe (video uploads keep the null
//! dimensions they always had).

use image::codecs::png::PngEncoder;
use image::{DynamicImage, ExtendedColorType, ImageEncoder, RgbImage};

/// The backend's `THUMBNAIL_MAX_DIMENSION`: a thumbnail's longest side.
pub const THUMBNAIL_MAX_DIMENSION: u32 = 480;

/// SVG is resolution-independent; every other `image/*` is raster data.
fn is_raster_image(mime_type: &str) -> bool {
    let mime_type = mime_type.to_ascii_lowercase();
    mime_type.starts_with("image/") && !mime_type.starts_with("image/svg")
}

/// The display size of `bytes`, or `None` for a non-raster MIME type, bytes no decoder
/// recognises, or a header with a zero side. EXIF orientation is applied to JPEGs, as ffmpeg's
/// autorotate applies it for the backend.
pub fn dimensions(mime_type: &str, bytes: &[u8]) -> Option<(u32, u32)> {
    if !is_raster_image(mime_type) {
        return None;
    }
    let dimensions = png_dimensions(bytes)
        .or_else(|| jpeg_dimensions(bytes))
        .or_else(|| gif_dimensions(bytes))
        .or_else(|| webp_dimensions(bytes))?;
    if dimensions.0 == 0 || dimensions.1 == 0 {
        return None;
    }
    Some(match (format_of(bytes), orientation(bytes)) {
        // A 90/270 rotation turns the displayed box on its side, as the backend's
        // `MediaDimensionsService.fromStreams` does.
        (Some(Format::Jpeg), Some(orientation)) if orientation == 6 || orientation == 8 => {
            (dimensions.1, dimensions.0)
        }
        _ => dimensions,
    })
}

/// Whether the backend would generate a thumbnail: a raster image whose longest side is over
/// the bound. Unknown dimensions never qualify.
pub fn wants_thumbnail(mime_type: &str, dimensions: Option<(u32, u32)>) -> bool {
    if !is_raster_image(mime_type) {
        return false;
    }
    dimensions.is_some_and(|(width, height)| width.max(height) > THUMBNAIL_MAX_DIMENSION)
}

/// A PNG fitted inside `THUMBNAIL_MAX_DIMENSION` without cropping or upscaling, or `None` for
/// an image that already fits. A PNG is resized from its pixels; any other format gets a flat
/// picture of the same shape, because its codec is not compiled in.
pub fn thumbnail(bytes: &[u8], dimensions: (u32, u32)) -> Option<Vec<u8>> {
    if dimensions.0.max(dimensions.1) <= THUMBNAIL_MAX_DIMENSION {
        return None;
    }
    let (width, height) = fitted(dimensions.0, dimensions.1);
    decoded_png(bytes)
        .map(|image| image.resize_exact(width, height, image::imageops::FilterType::Triangle))
        .and_then(|image| encode_png(&image))
        .or_else(|| Some(placeholder_png(width, height)))
}

/// The size a `width` x `height` image takes inside the box, longest side at the bound.
fn fitted(width: u32, height: u32) -> (u32, u32) {
    let (long, short) = if width >= height {
        (width, height)
    } else {
        (height, width)
    };
    if long <= THUMBNAIL_MAX_DIMENSION {
        return (width, height);
    }
    let scaled = (u64::from(short) * u64::from(THUMBNAIL_MAX_DIMENSION) + u64::from(long) / 2)
        / u64::from(long);
    let scaled = scaled.max(1) as u32;
    if width >= height {
        (THUMBNAIL_MAX_DIMENSION, scaled)
    } else {
        (scaled, THUMBNAIL_MAX_DIMENSION)
    }
}

fn decoded_png(bytes: &[u8]) -> Option<DynamicImage> {
    image::load_from_memory_with_format(bytes, image::ImageFormat::Png).ok()
}

fn encode_png(image: &DynamicImage) -> Option<Vec<u8>> {
    let rgba = image.to_rgba8();
    let mut out = Vec::new();
    PngEncoder::new(&mut out)
        .write_image(
            rgba.as_raw(),
            rgba.width(),
            rgba.height(),
            ExtendedColorType::Rgba8,
        )
        .ok()?;
    Some(out)
}

/// A plain gradient at the fitted shape, for an image whose header could be measured but whose
/// pixels the fake cannot decode.
fn placeholder_png(width: u32, height: u32) -> Vec<u8> {
    let mut image = RgbImage::new(width, height);
    for (x, y, pixel) in image.enumerate_pixels_mut() {
        let shade = (x * 255 / width.max(1)) as u8;
        let shade = shade.saturating_add((y * 64 / height.max(1)) as u8);
        *pixel = image::Rgb([shade, 128, 255u8.saturating_sub(shade)]);
    }
    encode_png(&DynamicImage::ImageRgb8(image)).expect("writing an RGBA image into memory")
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Format {
    Png,
    Jpeg,
    Gif,
    Webp,
}

fn format_of(bytes: &[u8]) -> Option<Format> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some(Format::Png)
    } else if bytes.starts_with(&[0xFF, 0xD8]) {
        Some(Format::Jpeg)
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some(Format::Gif)
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        Some(Format::Webp)
    } else {
        None
    }
}

/// PNG: the IHDR chunk's width and height, big-endian.
fn png_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 24
        || &bytes[12..16] != b"IHDR"
        || u32::from_be_bytes(bytes[8..12].try_into().ok()?) != 13
    {
        return None;
    }
    let width = u32::from_be_bytes(bytes[16..20].try_into().ok()?);
    let height = u32::from_be_bytes(bytes[20..24].try_into().ok()?);
    Some((width, height))
}

/// JPEG: the first frame (SOFn) header, then EXIF's orientation.
fn jpeg_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    let mut offset = 2;
    while offset + 4 <= bytes.len() {
        if bytes[offset] != 0xFF {
            return None;
        }
        let marker = bytes[offset + 1];
        if marker == 0xD8 || marker == 0x01 || (0xD0..=0xD7).contains(&marker) {
            offset += 2;
            continue;
        }
        if marker == 0xDA {
            return None;
        }
        let length = usize::from(u16::from_be_bytes([bytes[offset + 2], bytes[offset + 3]]));
        if length < 2 || offset + 2 + length > bytes.len() {
            return None;
        }
        // SOF0..SOF3, SOF5..SOF7, SOF9..SOF11 and SOF13..SOF15 all carry the frame size.
        if matches!(
            marker,
            0xC0..=0xC3 | 0xC5..=0xC7 | 0xC9..=0xCB | 0xCD..=0xCF
        ) && length >= 7
        {
            let segment = &bytes[offset + 4..offset + 2 + length];
            let height = u32::from(u16::from_be_bytes([segment[1], segment[2]]));
            let width = u32::from(u16::from_be_bytes([segment[3], segment[4]]));
            return Some((width, height));
        }
        offset += 2 + length;
    }
    None
}

/// GIF: the logical screen descriptor's width and height, little-endian.
fn gif_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if !(bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a")) || bytes.len() < 10 {
        return None;
    }
    let width = u32::from(u16::from_le_bytes([bytes[6], bytes[7]]));
    let height = u32::from(u16::from_le_bytes([bytes[8], bytes[9]]));
    Some((width, height))
}

/// WebP: the canvas in a VP8X chunk, or the frame in a VP8 (lossy) or VP8L (lossless) one.
fn webp_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 12 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WEBP" {
        return None;
    }
    let mut offset = 12;
    while offset + 8 <= bytes.len() {
        let fourcc = &bytes[offset..offset + 4];
        let length = u32::from_le_bytes(bytes[offset + 4..offset + 8].try_into().ok()?) as usize;
        let data = bytes.get(offset + 8..offset + 8 + length)?;
        match fourcc {
            b"VP8X" if data.len() >= 10 => {
                let width = 1 + u32::from_le_bytes([data[4], data[5], data[6], 0]);
                let height = 1 + u32::from_le_bytes([data[7], data[8], data[9], 0]);
                return Some((width, height));
            }
            b"VP8L" if data.len() >= 5 && data[0] == 0x2F => {
                let bits = u32::from_le_bytes(data[1..5].try_into().ok()?);
                return Some(((bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1));
            }
            b"VP8 " if data.len() >= 10 && data[3..6] == [0x9D, 0x01, 0x2A] => {
                let width = u32::from(u16::from_le_bytes([data[6], data[7]]) & 0x3FFF);
                let height = u32::from(u16::from_le_bytes([data[8], data[9]]) & 0x3FFF);
                return Some((width, height));
            }
            _ => {}
        }
        offset += 8 + length + (length & 1);
    }
    None
}

/// The EXIF orientation of a JPEG, or `None` when it has none. Values are the TIFF orientations
/// 1..8; only 6 and 8 turn the display box on its side.
fn orientation(bytes: &[u8]) -> Option<u16> {
    if !bytes.starts_with(&[0xFF, 0xD8]) {
        return None;
    }
    let mut offset = 2;
    while offset + 4 <= bytes.len() {
        if bytes[offset] != 0xFF {
            return None;
        }
        let marker = bytes[offset + 1];
        if marker == 0xD8 || marker == 0x01 || (0xD0..=0xD7).contains(&marker) {
            offset += 2;
            continue;
        }
        if marker == 0xDA {
            break;
        }
        let length = usize::from(u16::from_be_bytes([bytes[offset + 2], bytes[offset + 3]]));
        if length < 2 || offset + 2 + length > bytes.len() {
            return None;
        }
        let segment = &bytes[offset + 4..offset + 2 + length];
        if marker == 0xE1
            && let Some(tiff) = segment.strip_prefix(b"Exif\0\0")
            && let Some(value) = tiff_orientation(tiff)
        {
            return Some(value);
        }
        offset += 2 + length;
    }
    None
}

/// IFD0's orientation tag (0x0112) from a TIFF header.
fn tiff_orientation(tiff: &[u8]) -> Option<u16> {
    if tiff.len() < 8 {
        return None;
    }
    let little_endian = match &tiff[..2] {
        b"II" => true,
        b"MM" => false,
        _ => return None,
    };
    let u16_at = |offset: usize| -> Option<u16> {
        let pair = tiff.get(offset..offset + 2)?;
        Some(if little_endian {
            u16::from_le_bytes([pair[0], pair[1]])
        } else {
            u16::from_be_bytes([pair[0], pair[1]])
        })
    };
    let u32_at = |offset: usize| -> Option<u32> {
        let quad = tiff.get(offset..offset + 4)?;
        Some(if little_endian {
            u32::from_le_bytes([quad[0], quad[1], quad[2], quad[3]])
        } else {
            u32::from_be_bytes([quad[0], quad[1], quad[2], quad[3]])
        })
    };
    if u16_at(2)? != 42 {
        return None;
    }
    let ifd = u32_at(4)? as usize;
    let count = u16_at(ifd)? as usize;
    for index in 0..count {
        let entry = ifd + 2 + index * 12;
        if u16_at(entry)? == 0x0112 {
            return u16_at(entry + 8);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::RgbaImage;

    fn rgba(width: u32, height: u32) -> RgbaImage {
        let mut image = RgbaImage::new(width, height);
        for (x, y, pixel) in image.enumerate_pixels_mut() {
            *pixel = image::Rgba([(x % 256) as u8, (y % 256) as u8, 128, 255]);
        }
        image
    }

    fn zero_png() -> Vec<u8> {
        let mut bytes = png(1, 1);
        bytes[16..24].copy_from_slice(&[0; 8]);
        bytes
    }

    fn png(width: u32, height: u32) -> Vec<u8> {
        let pixels = rgba(width, height);
        let mut out = Vec::new();
        PngEncoder::new(&mut out)
            .write_image(pixels.as_raw(), width, height, ExtendedColorType::Rgba8)
            .unwrap();
        out
    }

    /// A GIF's logical screen descriptor: enough for the header parser.
    fn gif_header(width: u32, height: u32) -> Vec<u8> {
        let mut out = b"GIF89a".to_vec();
        out.extend_from_slice(&(width as u16).to_le_bytes());
        out.extend_from_slice(&(height as u16).to_le_bytes());
        out.extend_from_slice(&[0x00, 0x00, 0x00, 0x3B]);
        out
    }

    /// A VP8X WebP: the canvas size in the extended header.
    fn webp_vp8x(width: u32, height: u32) -> Vec<u8> {
        let mut chunk = vec![0u8; 10];
        chunk[4..7].copy_from_slice(&(width - 1).to_le_bytes()[..3]);
        chunk[7..10].copy_from_slice(&(height - 1).to_le_bytes()[..3]);
        let mut out = b"RIFF".to_vec();
        out.extend_from_slice(&(4 + 8 + chunk.len() as u32).to_le_bytes());
        out.extend_from_slice(b"WEBP");
        out.extend_from_slice(b"VP8X");
        out.extend_from_slice(&(chunk.len() as u32).to_le_bytes());
        out.extend_from_slice(&chunk);
        out
    }

    /// A JPEG header with a SOF0 frame but no scan data: dimensions read, pixels do not.
    fn jpeg_header(width: u32, height: u32) -> Vec<u8> {
        let mut out = vec![0xFF, 0xD8, 0xFF, 0xC0, 0x00, 0x11, 0x08];
        out.extend_from_slice(&(height as u16).to_be_bytes());
        out.extend_from_slice(&(width as u16).to_be_bytes());
        out.extend_from_slice(&[0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]);
        out.extend_from_slice(&[0xFF, 0xD9]);
        out
    }

    /// Insert an EXIF APP1 segment (orientation `orientation`) after a JPEG's SOI.
    fn with_exif_orientation(jpeg: &[u8], orientation: u16) -> Vec<u8> {
        let mut exif = Vec::new();
        exif.extend_from_slice(b"Exif\0\0");
        exif.extend_from_slice(b"II");
        exif.extend_from_slice(&42u16.to_le_bytes());
        exif.extend_from_slice(&8u32.to_le_bytes());
        exif.extend_from_slice(&1u16.to_le_bytes());
        exif.extend_from_slice(&0x0112u16.to_le_bytes());
        exif.extend_from_slice(&3u16.to_le_bytes());
        exif.extend_from_slice(&1u32.to_le_bytes());
        exif.extend_from_slice(&orientation.to_le_bytes());
        exif.extend_from_slice(&0u16.to_le_bytes());
        exif.extend_from_slice(&0u32.to_le_bytes());

        let length = (exif.len() + 2) as u16;
        let mut out = Vec::with_capacity(jpeg.len() + exif.len() + 4);
        out.extend_from_slice(&jpeg[..2]);
        out.extend_from_slice(&[0xFF, 0xE1]);
        out.extend_from_slice(&length.to_be_bytes());
        out.extend_from_slice(&exif);
        out.extend_from_slice(&jpeg[2..]);
        out
    }

    #[test]
    fn reads_every_raster_format_the_backend_measures() {
        assert_eq!(dimensions("image/png", &png(600, 1200)), Some((600, 1200)));
        assert_eq!(
            dimensions("image/jpeg", &jpeg_header(1600, 300)),
            Some((1600, 300))
        );
        assert_eq!(dimensions("image/gif", &gif_header(64, 64)), Some((64, 64)));
        assert_eq!(
            dimensions("image/webp", &webp_vp8x(300, 500)),
            Some((300, 500))
        );
    }

    #[test]
    fn a_jpegs_exif_orientation_turns_the_display_box() {
        let upright = jpeg_header(600, 1200);
        assert_eq!(dimensions("image/jpeg", &upright), Some((600, 1200)));
        for orientation in [6, 8] {
            let rotated = with_exif_orientation(&upright, orientation);
            assert_eq!(
                dimensions("image/jpeg", &rotated),
                Some((1200, 600)),
                "orientation {orientation}"
            );
        }
        let flipped = with_exif_orientation(&upright, 3);
        assert_eq!(dimensions("image/jpeg", &flipped), Some((600, 1200)));
    }

    #[test]
    fn svg_and_non_image_bytes_have_no_dimensions() {
        assert_eq!(dimensions("image/svg+xml", b"<svg/>"), None);
        assert_eq!(dimensions("text/plain", b"not an image"), None);
        assert_eq!(dimensions("image/png", b"not a png"), None);
        assert_eq!(dimensions("image/png", b""), None);
        assert_eq!(
            dimensions("image/png", &jpeg_header(600, 1200)),
            Some((600, 1200)),
            "content, not extension"
        );
    }

    #[test]
    fn truncated_bytes_without_a_complete_header_have_no_dimensions() {
        let whole = png(600, 1200);
        for length in 0..24 {
            assert_eq!(
                dimensions("image/png", &whole[..length]),
                None,
                "{length} bytes"
            );
        }
        let jpeg = jpeg_header(600, 1200);
        for length in 0..12 {
            assert_eq!(
                dimensions("image/jpeg", &jpeg[..length]),
                None,
                "jpeg, {length} bytes"
            );
        }
    }

    #[test]
    fn a_zero_side_has_no_dimensions() {
        assert_eq!(dimensions("image/jpeg", &jpeg_header(0, 1200)), None);
        assert_eq!(dimensions("image/jpeg", &jpeg_header(600, 0)), None);
        assert_eq!(dimensions("image/gif", &gif_header(0, 0)), None);
        assert_eq!(dimensions("image/png", &zero_png()), None);
    }

    #[test]
    fn a_huge_header_is_measured_and_its_thumbnail_stays_bounded() {
        let huge = jpeg_header(50_000, 50_000);
        assert_eq!(dimensions("image/jpeg", &huge), Some((50_000, 50_000)));
        assert!(wants_thumbnail("image/jpeg", Some((50_000, 50_000))));
        let thumbnail = thumbnail(&huge, (50_000, 50_000)).expect("a placeholder thumbnail");
        let decoded =
            image::load_from_memory_with_format(&thumbnail, image::ImageFormat::Png).expect("PNG");
        assert_eq!((decoded.width(), decoded.height()), (480, 480));
    }

    #[test]
    fn a_small_image_wants_no_thumbnail() {
        assert!(!wants_thumbnail("image/png", Some((480, 480))));
        assert!(!wants_thumbnail("image/png", Some((64, 64))));
        assert!(wants_thumbnail("image/png", Some((481, 100))));
        assert!(!wants_thumbnail("image/svg+xml", Some((4000, 4000))));
        assert!(!wants_thumbnail("image/png", None));
        assert_eq!(thumbnail(&png(64, 64), (64, 64)), None);
    }

    #[test]
    fn thumbnails_fit_the_box_and_keep_their_aspect() {
        for (width, height) in [(600, 1200), (1600, 300), (3000, 500)] {
            let thumbnail = thumbnail(&png(width, height), (width, height)).expect("a thumbnail");
            let decoded = image::load_from_memory_with_format(&thumbnail, image::ImageFormat::Png)
                .expect("it decodes");
            assert!(
                decoded.width().max(decoded.height()) <= THUMBNAIL_MAX_DIMENSION,
                "{width}x{height}: {}x{}",
                decoded.width(),
                decoded.height()
            );
            let expected = width as f32 / height as f32;
            let actual = decoded.width() as f32 / decoded.height() as f32;
            assert!(
                (expected - actual).abs() < 0.01,
                "{width}x{height}: aspect {actual} vs {expected}"
            );
        }
    }

    #[test]
    fn a_non_png_thumbnail_is_a_png_of_the_same_shape() {
        let thumbnail = thumbnail(&jpeg_header(600, 1200), (600, 1200)).expect("a thumbnail");
        assert_eq!(&thumbnail[..8], b"\x89PNG\r\n\x1a\n");
        let decoded = image::load_from_memory_with_format(&thumbnail, image::ImageFormat::Png)
            .expect("it decodes");
        assert_eq!((decoded.width(), decoded.height()), (240, 480));
    }
}
