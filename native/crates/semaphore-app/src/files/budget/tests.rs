use super::*;
use std::prelude::rust_2024::test;

/// A GIF whose structure is real but whose image data is filler: enough for the header walk.
pub(crate) fn gif_shape(width: u16, height: u16, frames: usize, trailer: bool) -> Vec<u8> {
    let mut bytes = b"GIF89a".to_vec();
    bytes.extend_from_slice(&width.to_le_bytes());
    bytes.extend_from_slice(&height.to_le_bytes());
    // A two-colour global table.
    bytes.extend_from_slice(&[0x80, 0, 0]);
    bytes.extend_from_slice(&[0, 0, 0, 255, 255, 255]);
    // NETSCAPE loop extension: an extension that isn't a frame.
    bytes.extend_from_slice(&[0x21, 0xFF, 11]);
    bytes.extend_from_slice(b"NETSCAPE2.0");
    bytes.extend_from_slice(&[3, 1, 0, 0, 0]);
    for _ in 0..frames {
        // Graphic control, then the descriptor (a local table on every other frame).
        bytes.extend_from_slice(&[0x21, 0xF9, 4, 0, 10, 0, 0, 0]);
        bytes.push(0x2C);
        bytes.extend_from_slice(&[0, 0, 0, 0]);
        bytes.extend_from_slice(&width.to_le_bytes());
        bytes.extend_from_slice(&height.to_le_bytes());
        bytes.push(0);
        bytes.push(2);
        bytes.extend_from_slice(&[3, 0x44, 0x01, 0x00]);
        bytes.push(0);
    }
    if trailer {
        bytes.push(0x3B);
    }
    bytes
}

/// A real, decodable GIF with `frames` frames of `width` x `height`.
pub(crate) fn real_gif(width: u16, height: u16, frames: usize) -> Vec<u8> {
    let mut bytes = Vec::new();
    {
        let mut encoder = image::codecs::gif::GifEncoder::new(&mut bytes);
        let frames = (0..frames).map(|index| {
            let shade = (index * 40 % 256) as u8;
            image::Frame::new(image::RgbaImage::from_pixel(
                u32::from(width),
                u32::from(height),
                image::Rgba([shade, 0, 255 - shade, 255]),
            ))
        });
        encoder.encode_frames(frames).unwrap();
    }
    bytes
}

pub(crate) fn riff(chunks: &[(&[u8; 4], Vec<u8>)]) -> Vec<u8> {
    let mut body = b"WEBP".to_vec();
    for (fourcc, payload) in chunks {
        body.extend_from_slice(*fourcc);
        body.extend_from_slice(&(payload.len() as u32).to_le_bytes());
        body.extend_from_slice(payload);
        if payload.len() % 2 == 1 {
            body.push(0);
        }
    }
    let mut bytes = b"RIFF".to_vec();
    bytes.extend_from_slice(&(body.len() as u32).to_le_bytes());
    bytes.extend_from_slice(&body);
    bytes
}

pub(crate) fn vp8x(width: u32, height: u32, animated: bool) -> Vec<u8> {
    let mut payload = vec![if animated { 0x02 } else { 0 }, 0, 0, 0];
    payload.extend_from_slice(&(width - 1).to_le_bytes()[..3]);
    payload.extend_from_slice(&(height - 1).to_le_bytes()[..3]);
    payload
}

fn vp8l(width: u32, height: u32) -> Vec<u8> {
    let bits = (width - 1) | (height - 1) << 14;
    let mut payload = vec![0x2f];
    payload.extend_from_slice(&bits.to_le_bytes());
    payload.push(0);
    payload
}

fn animated_webp(width: u32, height: u32, frames: usize) -> Vec<u8> {
    let mut chunks: Vec<(&[u8; 4], Vec<u8>)> = vec![(b"VP8X", vp8x(width, height, true))];
    chunks.push((b"ANIM", vec![0; 6]));
    for _ in 0..frames {
        chunks.push((b"ANMF", vec![0; 17]));
    }
    riff(&chunks)
}

fn png(width: u32, height: u32) -> Vec<u8> {
    let mut bytes = Vec::new();
    image::DynamicImage::ImageRgba8(image::RgbaImage::new(width, height))
        .write_to(
            &mut std::io::Cursor::new(&mut bytes),
            image::ImageFormat::Png,
        )
        .unwrap();
    bytes
}

fn header(format: Format, width: u32, height: u32, frames: u64) -> Header {
    Header {
        format,
        width,
        height,
        frames,
    }
}

/// A name, the bytes, what the header walk answers, and the plan.
type Case = (&'static str, Vec<u8>, Result<Header, HeaderError>, Plan);

#[test]
fn animation_cost_cases() {
    let cases: Vec<Case> = vec![
        (
            "tiny still GIF",
            gif_shape(1, 1, 1, true),
            Ok(header(Format::Gif, 1, 1, 1)),
            Plan::Keep,
        ),
        (
            "tiny animated GIF",
            gif_shape(2, 2, 3, true),
            Ok(header(Format::Gif, 2, 2, 3)),
            Plan::Keep,
        ),
        (
            "a real picker preview: 200x150, 30 frames",
            real_gif(200, 150, 30),
            Ok(header(Format::Gif, 200, 150, 30)),
            Plan::Keep,
        ),
        (
            "480x270 x 60 frames is 31 MB: animates",
            gif_shape(480, 270, 60, true),
            Ok(header(Format::Gif, 480, 270, 60)),
            Plan::Keep,
        ),
        (
            "480x480 x 100 frames is 92 MB: first frame",
            gif_shape(480, 480, 100, true),
            Ok(header(Format::Gif, 480, 480, 100)),
            Plan::FirstFrame,
        ),
        (
            "thousands of frames of a small GIF: first frame",
            gif_shape(100, 100, 5000, true),
            Ok(header(Format::Gif, 100, 100, 5000)),
            Plan::FirstFrame,
        ),
        (
            "huge canvas, one frame over 4 MP: refused",
            gif_shape(10_000, 10_000, 1, true),
            Ok(header(Format::Gif, 10_000, 10_000, 1)),
            Plan::Refuse,
        ),
        (
            "largest canvas a GIF can claim: refused",
            gif_shape(u16::MAX, u16::MAX, 2, true),
            Ok(header(Format::Gif, 65_535, 65_535, 2)),
            Plan::Refuse,
        ),
        (
            "zero width",
            gif_shape(0, 10, 2, true),
            Ok(header(Format::Gif, 0, 10, 2)),
            Plan::Refuse,
        ),
        (
            "zero height",
            gif_shape(10, 0, 2, true),
            Ok(header(Format::Gif, 10, 0, 2)),
            Plan::Refuse,
        ),
        (
            "no trailer after whole frames: counted",
            gif_shape(10, 10, 4, false),
            Ok(header(Format::Gif, 10, 10, 4)),
            Plan::Keep,
        ),
        (
            "header only",
            b"GIF89a\x10\x00\x10\x00\x00\x00\x00".to_vec(),
            Err(HeaderError::Truncated),
            Plan::Refuse,
        ),
        (
            "trailer before any frame",
            b"GIF89a\x10\x00\x10\x00\x00\x00\x00\x3b".to_vec(),
            Err(HeaderError::Malformed),
            Plan::Refuse,
        ),
        (
            "an unknown block",
            b"GIF89a\x10\x00\x10\x00\x00\x00\x00\x99".to_vec(),
            Err(HeaderError::Malformed),
            Plan::Refuse,
        ),
        (
            "PNG bytes behind a .gif URL: a still",
            png(40, 30),
            Ok(header(Format::Still, 40, 30, 1)),
            Plan::Keep,
        ),
        (
            "text behind a .gif URL",
            b"<html>not a gif</html>".to_vec(),
            Err(HeaderError::NotAnImage),
            Plan::Refuse,
        ),
        (
            "empty",
            Vec::new(),
            Err(HeaderError::NotAnImage),
            Plan::Refuse,
        ),
        (
            "animated WebP inside the budget",
            animated_webp(320, 240, 20),
            Ok(header(Format::WebP, 320, 240, 20)),
            Plan::Keep,
        ),
        (
            "animated WebP over the budget",
            animated_webp(1000, 1000, 40),
            Ok(header(Format::WebP, 1000, 1000, 40)),
            Plan::FirstFrame,
        ),
        (
            "animated WebP with no frames",
            animated_webp(10, 10, 0),
            Err(HeaderError::Truncated),
            Plan::Refuse,
        ),
        (
            "still lossless WebP",
            riff(&[(b"VP8L", vp8l(64, 48))]),
            Ok(header(Format::WebP, 64, 48, 1)),
            Plan::Keep,
        ),
        (
            "still extended WebP takes the canvas",
            riff(&[(b"VP8X", vp8x(70, 50, false)), (b"VP8L", vp8l(70, 50))]),
            Ok(header(Format::WebP, 70, 50, 1)),
            Plan::Keep,
        ),
        (
            "WebP canvas at the 24-bit maximum: refused",
            animated_webp(1 << 24, 1 << 24, 2),
            Ok(header(Format::WebP, 1 << 24, 1 << 24, 2)),
            Plan::Refuse,
        ),
        (
            "WebP chunk claiming more bytes than there are",
            {
                let mut bytes = riff(&[(b"VP8L", vp8l(8, 8))]);
                bytes[16..20].copy_from_slice(&u32::MAX.to_le_bytes());
                bytes
            },
            Err(HeaderError::Truncated),
            Plan::Refuse,
        ),
    ];
    for (name, bytes, expected, expected_plan) in cases {
        let got = animation_cost(&bytes);
        assert_eq!(got, expected, "{name}");
        let got_plan = got.map(|header| plan(&header)).unwrap_or(Plan::Refuse);
        assert_eq!(got_plan, expected_plan, "{name}: plan");
    }
}

#[test]
fn a_header_cut_at_every_offset_never_panics_and_never_claims_more_frames() {
    for bytes in [
        gif_shape(30, 20, 5, true),
        real_gif(16, 16, 4),
        animated_webp(30, 20, 5),
    ] {
        let whole = animation_cost(&bytes).unwrap();
        for cut in 0..bytes.len() {
            if let Ok(header) = animation_cost(&bytes[..cut]) {
                assert!(header.frames <= whole.frames, "cut at {cut}");
                assert!(header.frames >= 1, "cut at {cut}");
            }
        }
        // Before the first frame is whole, nothing is claimed.
        assert!(animation_cost(&bytes[..13]).is_err());
    }
}

#[test]
fn plan_thresholds_are_exact() {
    // 1024 x 1024 x 4 = 4 MiB a frame: eight frames are exactly the budget.
    let frame = 1024u32;
    assert_eq!(ANIMATED_IMAGE_BUDGET, 8 * 4 * 1024 * 1024);
    assert_eq!(plan(&header(Format::Gif, frame, frame, 8)), Plan::Keep);
    assert_eq!(
        plan(&header(Format::Gif, frame, frame, 9)),
        Plan::FirstFrame
    );
    // Exactly 4 MP a frame passes; one pixel more is refused.
    assert_eq!(
        plan(&header(Format::Gif, 2000, 2000, 1)),
        Plan::Keep,
        "4 000 000 pixels"
    );
    assert_eq!(plan(&header(Format::Gif, 2000, 2001, 1)), Plan::Refuse);
    // A still may be larger: up to 64 MP.
    assert_eq!(plan(&header(Format::Still, 8000, 8000, 1)), Plan::Keep);
    assert_eq!(plan(&header(Format::Still, 8000, 8001, 1)), Plan::Refuse);
    // No overflow at the extremes.
    assert_eq!(
        plan(&header(Format::Gif, 1, 1, u64::MAX)),
        Plan::FirstFrame,
        "u64::MAX frames"
    );
    assert_eq!(
        plan(&header(Format::Gif, u32::MAX, u32::MAX, u64::MAX)),
        Plan::Refuse
    );
    assert_eq!(plan(&header(Format::Gif, 10, 10, 0)), Plan::Refuse);
}

#[test]
fn over_budget_keeps_a_single_decodable_frame() {
    // 600x600 x 30 frames = 43 MB: over.
    let bytes = real_gif(600, 600, 30);
    assert_eq!(plan(&animation_cost(&bytes).unwrap()), Plan::FirstFrame);
    let kept = within_budget(bytes).unwrap();
    let header = animation_cost(&kept).unwrap();
    assert_eq!(
        header,
        Header {
            format: Format::Still,
            width: 600,
            height: 600,
            frames: 1
        }
    );
    let image = image::load_from_memory(&kept).unwrap().to_rgba8();
    // Frame 0's colour, not a later one's.
    assert_eq!(image.get_pixel(10, 10).0, [0, 0, 255, 255]);
}

#[test]
fn within_budget_keeps_small_animations_and_refuses_junk() {
    let small = real_gif(32, 32, 5);
    assert_eq!(within_budget(small.clone()).unwrap(), small);
    assert!(within_budget(b"<html>".to_vec()).is_err());
    assert!(within_budget(gif_shape(10_000, 10_000, 2, true)).is_err());
    let still = png(5, 5);
    assert_eq!(within_budget(still.clone()).unwrap(), still);
}

#[test]
fn a_real_still_webp_is_kept_and_its_first_frame_decodes() {
    // The image crate encodes lossless stills only; animated WebP is covered by the header table.
    let mut bytes = Vec::new();
    image::codecs::webp::WebPEncoder::new_lossless(&mut bytes)
        .encode(&[9u8; 8 * 6 * 4], 8, 6, image::ExtendedColorType::Rgba8)
        .unwrap();
    let header = animation_cost(&bytes).unwrap();
    assert_eq!(
        (header.format, header.width, header.height, header.frames),
        (Format::WebP, 8, 6, 1)
    );
    assert_eq!(within_budget(bytes.clone()).unwrap(), bytes);
    let png = first_frame_png(&bytes, Format::WebP).unwrap();
    assert_eq!(image::load_from_memory(&png).unwrap().width(), 8);
}

/// A GIF on a `width` x `height` screen whose frames have the given descriptors
/// (left, top, width, height), each with filler image data.
pub(crate) fn gif_frames(width: u16, height: u16, frames: &[(u16, u16, u16, u16)]) -> Vec<u8> {
    let mut bytes = b"GIF89a".to_vec();
    bytes.extend_from_slice(&width.to_le_bytes());
    bytes.extend_from_slice(&height.to_le_bytes());
    bytes.extend_from_slice(&[0x80, 0, 0]);
    bytes.extend_from_slice(&[0, 0, 0, 255, 255, 255]);
    for (left, top, frame_width, frame_height) in frames {
        bytes.push(0x2C);
        for field in [left, top, frame_width, frame_height] {
            bytes.extend_from_slice(&field.to_le_bytes());
        }
        bytes.push(0);
        bytes.push(2);
        bytes.extend_from_slice(&[3, 0x44, 0x01, 0x00]);
        bytes.push(0);
    }
    bytes.push(0x3B);
    bytes
}

/// An animated WebP on a `width` x `height` canvas whose `ANMF` frames have the given
/// (x, y, width, height); x and y are stored halved, as the format does.
fn webp_frames(width: u32, height: u32, frames: &[(u32, u32, u32, u32)]) -> Vec<u8> {
    let mut chunks: Vec<(&[u8; 4], Vec<u8>)> = vec![(b"VP8X", vp8x(width, height, true))];
    chunks.push((b"ANIM", vec![0; 6]));
    for (x, y, frame_width, frame_height) in frames {
        let mut payload = Vec::new();
        for field in [x / 2, y / 2, frame_width - 1, frame_height - 1] {
            payload.extend_from_slice(&field.to_le_bytes()[..3]);
        }
        payload.extend_from_slice(&[0; 5]);
        chunks.push((b"ANMF", payload));
    }
    riff(&chunks)
}

/// NAT-2: a frame is decoded at its own size before it is placed on the canvas, so a frame
/// bigger than the canvas (or off its edge) costs what the canvas check never saw.
#[test]
fn gif_frames_that_leave_the_canvas_are_refused() {
    // On the edge, and wholly inside: fine.
    for frames in [
        vec![(0, 0, 10, 10)],
        vec![(5, 5, 5, 5)],
        vec![(0, 0, 1, 1), (9, 9, 1, 1)],
        vec![(0, 9, 10, 1)],
    ] {
        let header = animation_cost(&gif_frames(10, 10, &frames)).unwrap();
        assert_eq!(header.frames, frames.len() as u64, "{frames:?}");
    }
    // Past an edge by one, far past it, or huge on a tiny screen.
    for frames in [
        vec![(0, 0, 11, 10)],
        vec![(0, 0, 10, 11)],
        vec![(5, 0, 6, 1)],
        vec![(0, 5, 1, 6)],
        vec![(10, 0, 1, 1)],
        vec![(0, 10, 1, 1)],
        vec![(0, 0, 65535, 65535)],
        vec![(65535, 65535, 1, 1)],
        vec![(0, 0, 1, 1), (0, 0, 65535, 2)],
    ] {
        assert_eq!(
            animation_cost(&gif_frames(10, 10, &frames)),
            Err(HeaderError::Malformed),
            "{frames:?}"
        );
        assert!(
            within_budget(gif_frames(10, 10, &frames)).is_err(),
            "{frames:?}"
        );
    }
    // A screen of zero is refused by the plan already; a zero-sized frame inside it isn't a
    // cost, and fits.
    assert!(animation_cost(&gif_frames(10, 10, &[(3, 3, 0, 0)])).is_ok());
}

#[test]
fn webp_frames_that_leave_the_canvas_are_refused() {
    for frames in [
        vec![(0, 0, 10, 10)],
        vec![(4, 4, 6, 6)],
        vec![(0, 0, 1, 1), (8, 8, 2, 2)],
    ] {
        let header = animation_cost(&webp_frames(10, 10, &frames)).unwrap();
        assert_eq!(header.frames, frames.len() as u64, "{frames:?}");
    }
    for frames in [
        vec![(0, 0, 11, 10)],
        vec![(0, 0, 10, 11)],
        vec![(2, 0, 9, 1)],
        vec![(10, 0, 1, 1)],
        vec![(0, 0, 1 << 24, 1 << 24)],
        vec![(0, 0, 1, 1), (0, 0, 4000, 4000)],
    ] {
        assert_eq!(
            animation_cost(&webp_frames(10, 10, &frames)),
            Err(HeaderError::Malformed),
            "{frames:?}"
        );
    }
    // An ANMF too short to hold its frame header is malformed, not a frame of size zero.
    let short = riff(&[
        (b"VP8X", vp8x(10, 10, true)),
        (b"ANIM", vec![0; 6]),
        (b"ANMF", vec![0; 11]),
    ]);
    assert_eq!(animation_cost(&short), Err(HeaderError::Malformed));
}
