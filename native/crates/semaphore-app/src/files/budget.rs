//! WM: the frame and pixel budget for animated pictures from other sites (GIFs, animated WebP).
//!
//! GPUI decodes every frame of an animation up front, each to the full canvas in RGBA, so one GIF
//! costs `frames x width x height x 4` bytes however small its file is. Before such bytes reach the
//! store, [`animation_cost`] reads only the header and the block structure (no LZW, no VP8
//! decoding) and [`plan`] decides:
//!
//! - [`Plan::Keep`]: it animates (still images, and animations inside the budget);
//! - [`Plan::FirstFrame`]: over the budget, but one frame is fine: the store keeps frame 0 alone,
//!   re-encoded as a PNG ([`first_frame_png`]), so GPUI never sees the other frames;
//! - [`Plan::Refuse`]: not even one frame fits, or the header can't be trusted: `Missing`, and the
//!   row shows its URL fallback.
//!
//! Reduced motion and the number of animations on screen at once stay the message list's: it
//! paints the first frame under reduced motion and animates only the rows it paints.

use super::{MAX_ANIMATED_PIXELS, MAX_IMAGE_PIXELS};

/// What one animated picture may cost decoded: 32 MiB, a quarter of the list's 128 MiB decoded
/// image cache (`semaphore_ui::messages::IMAGE_BUDGET_BYTES`, which the GIF picker's own cache
/// also uses), so at least four animations fit beside the stills on screen without evicting each
/// other every frame. It holds what the GIF service sends: a 480x270 GIF of 60 frames is 31 MB, a
/// 200x150 picker preview of 30 frames 3.6 MB. A longer or larger one shows its first frame.
pub const ANIMATED_IMAGE_BUDGET: u64 = 32 * 1024 * 1024;

const _: () = assert!(
    ANIMATED_IMAGE_BUDGET <= semaphore_ui::messages::IMAGE_BUDGET_BYTES as u64 / 4,
    "an animation must leave room for others in the decoded cache"
);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Format {
    Gif,
    WebP,
    /// Anything else the image crate recognises: one frame.
    Still,
}

/// What the header says, without decoding a frame.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Header {
    pub format: Format,
    /// The canvas every frame is decoded to.
    pub width: u32,
    pub height: u32,
    pub frames: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HeaderError {
    /// The bytes end inside a block, before a whole frame was seen.
    Truncated,
    /// A block that isn't one of the format's, or a field out of range.
    Malformed,
    /// Not an image format we know.
    NotAnImage,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Plan {
    Keep,
    FirstFrame,
    Refuse,
}

/// The header of `bytes`: canvas size and frame count. GIF and WebP are walked block by block;
/// anything else is one frame of whatever size its header says.
pub fn animation_cost(bytes: &[u8]) -> Result<Header, HeaderError> {
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return gif(bytes);
    }
    if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return webp(bytes);
    }
    let reader = image::ImageReader::new(std::io::Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|_| HeaderError::NotAnImage)?;
    if reader.format().is_none() {
        return Err(HeaderError::NotAnImage);
    }
    let (width, height) = reader
        .into_dimensions()
        .map_err(|_| HeaderError::Malformed)?;
    Ok(Header {
        format: Format::Still,
        width,
        height,
        frames: 1,
    })
}

/// What to keep of a picture with this header.
pub fn plan(header: &Header) -> Plan {
    let (width, height) = (u64::from(header.width), u64::from(header.height));
    if width == 0 || height == 0 || header.frames == 0 {
        return Plan::Refuse;
    }
    let pixels = width * height; // u32 x u32 fits u64.
    let frame_limit = match header.format {
        Format::Gif | Format::WebP => MAX_ANIMATED_PIXELS,
        Format::Still => MAX_IMAGE_PIXELS,
    };
    if pixels > frame_limit {
        return Plan::Refuse;
    }
    if header.frames == 1 {
        return Plan::Keep;
    }
    let total = u128::from(pixels) * 4 * u128::from(header.frames);
    if total <= u128::from(ANIMATED_IMAGE_BUDGET) {
        Plan::Keep
    } else {
        Plan::FirstFrame
    }
}

/// A cursor over the bytes that fails with `Truncated` instead of panicking.
struct Reader<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl<'a> Reader<'a> {
    fn take(&mut self, count: usize) -> Result<&'a [u8], HeaderError> {
        let end = self.at.checked_add(count).ok_or(HeaderError::Truncated)?;
        let slice = self.bytes.get(self.at..end).ok_or(HeaderError::Truncated)?;
        self.at = end;
        Ok(slice)
    }

    fn byte(&mut self) -> Result<u8, HeaderError> {
        Ok(self.take(1)?[0])
    }

    fn done(&self) -> bool {
        self.at >= self.bytes.len()
    }

    /// GIF data sub-blocks: a length byte, that many bytes, until a zero length.
    fn skip_sub_blocks(&mut self) -> Result<(), HeaderError> {
        loop {
            let length = self.byte()?;
            if length == 0 {
                return Ok(());
            }
            self.take(usize::from(length))?;
        }
    }
}

fn u16_le(bytes: &[u8]) -> u32 {
    u32::from(u16::from_le_bytes([bytes[0], bytes[1]]))
}

fn u24_le(bytes: &[u8]) -> u32 {
    u32::from(bytes[0]) | u32::from(bytes[1]) << 8 | u32::from(bytes[2]) << 16
}

fn u32_le(bytes: &[u8]) -> u32 {
    u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])
}

/// GIF: the logical screen is the canvas; each image descriptor is a frame. Bytes that end after
/// a whole frame without the trailer count what was seen, as browsers draw them; bytes that end
/// before any whole frame are `Truncated`.
fn gif(bytes: &[u8]) -> Result<Header, HeaderError> {
    let mut reader = Reader { bytes, at: 6 };
    let screen = reader.take(7)?;
    let (width, height, packed) = (u16_le(&screen[0..2]), u16_le(&screen[2..4]), screen[4]);
    if packed & 0x80 != 0 {
        reader.take(3 << ((packed & 0x07) + 1))?;
    }
    let mut frames: u64 = 0;
    let header = |frames| Header {
        format: Format::Gif,
        width,
        height,
        frames,
    };
    loop {
        if reader.done() {
            // No trailer: what came whole is drawn, as browsers do.
            return if frames > 0 {
                Ok(header(frames))
            } else {
                Err(HeaderError::Truncated)
            };
        }
        match gif_block(&mut reader) {
            Ok(GifBlock::Frame) => frames += 1,
            Ok(GifBlock::Other) => {}
            // Whatever follows the trailer is ignored, as decoders do.
            Ok(GifBlock::Trailer) if frames > 0 => return Ok(header(frames)),
            Ok(GifBlock::Trailer) => return Err(HeaderError::Malformed),
            // Cut inside a later block: draw the frames that came whole.
            Err(HeaderError::Truncated) if frames > 0 => return Ok(header(frames)),
            Err(error) => return Err(error),
        }
    }
}

enum GifBlock {
    Frame,
    Other,
    Trailer,
}

fn gif_block(reader: &mut Reader<'_>) -> Result<GifBlock, HeaderError> {
    match reader.byte()? {
        0x2C => {
            let descriptor = reader.take(9)?;
            let local = descriptor[8];
            if local & 0x80 != 0 {
                reader.take(3 << ((local & 0x07) + 1))?;
            }
            let _minimum_code_size = reader.byte()?;
            reader.skip_sub_blocks()?;
            Ok(GifBlock::Frame)
        }
        0x21 => {
            let _label = reader.byte()?;
            reader.skip_sub_blocks()?;
            Ok(GifBlock::Other)
        }
        0x3B => Ok(GifBlock::Trailer),
        _ => Err(HeaderError::Malformed),
    }
}

/// WebP: RIFF chunks. `VP8X` gives the canvas and whether it animates; each `ANMF` is a frame. A
/// simple WebP is one `VP8 ` or `VP8L` frame, sized in its own header.
fn webp(bytes: &[u8]) -> Result<Header, HeaderError> {
    let mut reader = Reader { bytes, at: 12 };
    let mut canvas: Option<(u32, u32, bool)> = None;
    let mut frames: u64 = 0;
    let mut simple: Option<(u32, u32)> = None;
    while !reader.done() {
        let head = reader.take(8)?;
        let (fourcc, size) = (&head[0..4], u32_le(&head[4..8]) as usize);
        let payload = reader.take(size)?;
        if size % 2 == 1 && !reader.done() {
            reader.take(1)?;
        }
        match fourcc {
            b"VP8X" => {
                if payload.len() < 10 {
                    return Err(HeaderError::Malformed);
                }
                let animated = payload[0] & 0x02 != 0;
                canvas = Some((
                    u24_le(&payload[4..7]) + 1,
                    u24_le(&payload[7..10]) + 1,
                    animated,
                ));
            }
            b"ANMF" => frames += 1,
            b"VP8 " => {
                if payload.len() < 10 || payload[3..6] != [0x9d, 0x01, 0x2a] {
                    return Err(HeaderError::Malformed);
                }
                simple = Some((
                    u16_le(&payload[6..8]) & 0x3fff,
                    u16_le(&payload[8..10]) & 0x3fff,
                ));
            }
            b"VP8L" => {
                if payload.len() < 5 || payload[0] != 0x2f {
                    return Err(HeaderError::Malformed);
                }
                let bits = u32_le(&payload[1..5]);
                simple = Some(((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1));
            }
            _ => {}
        }
    }
    let (width, height, frames) = match (canvas, simple) {
        (Some((width, height, true)), _) => (width, height, frames),
        (Some((width, height, false)), Some(_)) => (width, height, 1),
        (None, Some((width, height))) => (width, height, 1),
        _ => return Err(HeaderError::Truncated),
    };
    if frames == 0 {
        return Err(HeaderError::Truncated);
    }
    Ok(Header {
        format: Format::WebP,
        width,
        height,
        frames,
    })
}

/// Frame 0 alone, as a PNG: only that frame is decoded.
pub fn first_frame_png(bytes: &[u8], format: Format) -> Result<Vec<u8>, String> {
    use image::AnimationDecoder as _;
    let cursor = std::io::Cursor::new(bytes);
    let frame = match format {
        Format::Gif => image::codecs::gif::GifDecoder::new(cursor)
            .map_err(|error| error.to_string())?
            .into_frames()
            .next(),
        Format::WebP => image::codecs::webp::WebPDecoder::new(cursor)
            .map_err(|error| error.to_string())?
            .into_frames()
            .next(),
        Format::Still => return Ok(bytes.to_vec()),
    };
    let first = match frame {
        Some(Ok(frame)) => image::DynamicImage::ImageRgba8(frame.into_buffer()),
        // A still WebP has no animation frames: it is its own first frame.
        _ => image::load_from_memory(bytes).map_err(|error| error.to_string())?,
    };
    let mut png = Vec::new();
    first
        .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
        .map_err(|error| error.to_string())?;
    Ok(png)
}

/// What the store keeps of a third-party picture: the bytes, frame 0 alone, or nothing.
pub fn within_budget(bytes: Vec<u8>) -> Result<Vec<u8>, String> {
    let header = animation_cost(&bytes).map_err(|error| format!("{error:?}"))?;
    match plan(&header) {
        Plan::Keep => Ok(bytes),
        Plan::FirstFrame => {
            log::info!(
                "{}x{} x {} frames is over the animation budget: first frame only",
                header.width,
                header.height,
                header.frames
            );
            first_frame_png(&bytes, header.format)
        }
        Plan::Refuse => Err(format!("over the frame budget: {header:?}")),
    }
}

#[cfg(test)]
mod tests;
