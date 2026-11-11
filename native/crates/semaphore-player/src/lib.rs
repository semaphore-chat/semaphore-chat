//! Video and audio attachment playback, decoded by the FFmpeg, libvpx and dav1d that LiveKit's
//! prebuilt libwebrtc already contains (docs/player.md has why, and what that means for licences
//! and patents).
//!
//! Two layers. [`Media`] decodes: open a source, list its streams, decode frames, seek. FFmpeg
//! demuxes (MP4/MOV/M4A, MKV/WebM, Ogg, WAV, MP3, FLAC, ADTS AAC); H.264 and every audio codec
//! decode in FFmpeg, VP8 and VP9 in libvpx, AV1 in dav1d. Video comes out as 8-bit I420, audio
//! as interleaved `f32`. [`DesktopPlayers`] plays: a thread per player, audio to an
//! [`AudioIo`](semaphore_media_livekit::audio::AudioIo) output through a ring, video as NV12 to
//! a [`VideoSink`] timed by the audio clock, behind `semaphore-core`'s player traits.
//!
//! - **A corrupt packet is skipped**, as browsers do, and counted ([`Media::skipped_packets`]);
//!   64 rejected in a row end decoding with [`Error::Decode`].
//! - **FFmpeg's log** goes to stderr at its default level. Its callback and level are one
//!   process-wide setting that libwebrtc's H.264 decoder shares, so the player leaves both alone.
//!
//! - **Unsupported** is not **invalid**: bytes no demuxer recognises (AVI, say) are
//!   [`Error::UnsupportedContainer`]; a known container that won't parse is [`Error::Invalid`];
//!   a stream with no decoder here (HEVC, Theora, AAC without the `aac` feature) is
//!   [`Error::UnsupportedCodec`] from [`Media::enable`], and the other streams still play.
//! - **Short sounds** decode whole with [`decode_audio`] (the soundboard's MP3, AAC and Vorbis):
//!   mono 48 kHz, length-capped.
//! - **Desktop only.** `build.rs` refuses a target or a libwebrtc without this FFmpeg.

mod decode;
mod engine;
mod ffi;
pub mod resample;

pub mod buffered;
pub mod range;
pub use buffered::BufferedReport;

pub use decode::{DECODED_RATE, DecodeAudioError, decode_audio};
pub use engine::{Cancel, DesktopPlayers, Nv12Frame, Opener, Player, VideoSink};

// Links libwebrtc.a, where every symbol the shim calls lives. None of webrtc-sys's Rust is used.
use webrtc_sys as _;

use std::ffi::{CStr, c_int, c_void};
use std::fmt;
use std::io::{Cursor, ErrorKind, Read, Seek, SeekFrom};
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::ptr::NonNull;
use std::time::Duration;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Error {
    /// No demuxer here recognises the bytes.
    UnsupportedContainer,
    /// A container we know, that doesn't parse: truncated or corrupt.
    Invalid,
    /// A stream with no decoder here.
    UnsupportedCodec,
    /// The source failed to read or seek.
    Io,
    /// The decoder rejected the data.
    Decode,
    /// Decoded, but not 8-bit 4:2:0.
    PixelFormat,
    OutOfMemory,
    /// No such stream.
    BadStream,
}

impl Error {
    fn from_code(code: c_int) -> Self {
        match code {
            ffi::SP_E_UNSUPPORTED_CONTAINER => Self::UnsupportedContainer,
            ffi::SP_E_INVALID => Self::Invalid,
            ffi::SP_E_UNSUPPORTED_CODEC => Self::UnsupportedCodec,
            ffi::SP_E_IO => Self::Io,
            ffi::SP_E_NOMEM => Self::OutOfMemory,
            ffi::SP_E_PIXEL_FORMAT => Self::PixelFormat,
            ffi::SP_E_ARG => Self::BadStream,
            ffi::SP_E_DECODE => Self::Decode,
            _ => Self::Decode,
        }
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::UnsupportedContainer => "not a container this player reads",
            Self::Invalid => "the file is truncated or corrupt",
            Self::UnsupportedCodec => "a codec this player doesn't decode",
            Self::Io => "reading the file failed",
            Self::Decode => "the decoder rejected the data",
            Self::PixelFormat => "a pixel format this player doesn't show",
            Self::OutOfMemory => "out of memory",
            Self::BadStream => "no such stream",
        })
    }
}

impl std::error::Error for Error {}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Video,
    Audio,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Codec {
    H264,
    Vp8,
    Vp9,
    Av1,
    Hevc,
    Theora,
    Mpeg4,
    Aac,
    Mp3,
    Vorbis,
    Opus,
    Flac,
    Pcm,
    Other,
}

impl Codec {
    fn from_code(code: c_int) -> Self {
        match code {
            ffi::SP_CODEC_H264 => Self::H264,
            ffi::SP_CODEC_VP8 => Self::Vp8,
            ffi::SP_CODEC_VP9 => Self::Vp9,
            ffi::SP_CODEC_AV1 => Self::Av1,
            ffi::SP_CODEC_HEVC => Self::Hevc,
            ffi::SP_CODEC_THEORA => Self::Theora,
            ffi::SP_CODEC_MPEG4 => Self::Mpeg4,
            ffi::SP_CODEC_AAC => Self::Aac,
            ffi::SP_CODEC_MP3 => Self::Mp3,
            ffi::SP_CODEC_VORBIS => Self::Vorbis,
            ffi::SP_CODEC_OPUS => Self::Opus,
            ffi::SP_CODEC_FLAC => Self::Flac,
            ffi::SP_CODEC_PCM => Self::Pcm,
            _ => Self::Other,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StreamInfo {
    pub kind: Kind,
    pub codec: Codec,
    /// Video only, else 0.
    pub width: u32,
    pub height: u32,
    /// Audio only, else 0.
    pub sample_rate: u32,
    pub channels: u32,
    pub duration: Option<Duration>,
}

/// One plane of a video frame: `stride` bytes per row, at least the plane's width.
#[derive(Debug, Clone, Copy)]
pub struct Plane<'a> {
    pub data: &'a [u8],
    pub stride: usize,
}

#[derive(Debug)]
pub struct VideoFrame<'a> {
    pub stream: usize,
    /// Presentation time in microseconds, when the container says.
    pub pts_us: Option<i64>,
    pub width: u32,
    pub height: u32,
    /// I420: full-size Y, then half-size U and V (rounded up).
    pub planes: [Plane<'a>; 3],
}

impl VideoFrame<'_> {
    /// Into NV12 (libyuv), reusing `out`'s buffers.
    pub fn to_nv12(&self, out: &mut Nv12Image) -> Result<(), Error> {
        let (width, height) = (self.width as usize, self.height as usize);
        let y_stride = width;
        let uv_stride = width.div_ceil(2) * 2;
        out.y.resize(y_stride * height, 0);
        out.uv.resize(uv_stride * height.div_ceil(2), 0);
        let mut frame = ffi::sp_frame {
            kind: ffi::SP_KIND_VIDEO,
            width: c_int::try_from(self.width).map_err(|_| Error::PixelFormat)?,
            height: c_int::try_from(self.height).map_err(|_| Error::PixelFormat)?,
            ..ffi::sp_frame::default()
        };
        for (i, plane) in self.planes.iter().enumerate() {
            frame.planes[i] = plane.data.as_ptr();
            frame.strides[i] = c_int::try_from(plane.stride).map_err(|_| Error::PixelFormat)?;
        }
        let (ys, uvs) = (
            c_int::try_from(y_stride).map_err(|_| Error::PixelFormat)?,
            c_int::try_from(uv_stride).map_err(|_| Error::PixelFormat)?,
        );
        // SAFETY: the planes hold the frame's rows (see `next_frame`) and `out`'s buffers were
        // sized for its strides and rows just above.
        let code = unsafe {
            ffi::sp_i420_to_nv12(&frame, out.y.as_mut_ptr(), ys, out.uv.as_mut_ptr(), uvs)
        };
        if code != ffi::SP_OK {
            return Err(Error::PixelFormat);
        }
        out.width = self.width;
        out.height = self.height;
        out.y_stride = y_stride as u32;
        out.uv_stride = uv_stride as u32;
        out.pts_us = self.pts_us;
        Ok(())
    }
}

/// A decoded frame converted to NV12, owned: what the video queue holds.
#[derive(Debug, Clone, Default)]
pub struct Nv12Image {
    pub width: u32,
    pub height: u32,
    pub y: Vec<u8>,
    pub y_stride: u32,
    pub uv: Vec<u8>,
    pub uv_stride: u32,
    pub pts_us: Option<i64>,
}

#[derive(Debug)]
pub struct AudioFrame<'a> {
    pub stream: usize,
    pub pts_us: Option<i64>,
    pub sample_rate: u32,
    pub channels: u32,
    /// Interleaved, `channels` per sample time.
    pub samples: &'a [f32],
}

#[derive(Debug)]
pub enum Frame<'a> {
    Video(VideoFrame<'a>),
    Audio(AudioFrame<'a>),
}

/// What the player reads from: anything seekable. Attachments arrive over HTTP range requests
/// later (docs/player.md); tests read bytes in memory.
pub trait Source: Read + Seek + Send {}
impl<T: Read + Seek + Send> Source for T {}

/// One open file. Not shareable between threads, but can move to one (the decode thread).
pub struct Media {
    raw: NonNull<ffi::sp_media>,
    /// Owned through a raw pointer because C holds it as `opaque` for the media's lifetime.
    source: *mut Box<dyn Source>,
    frame: ffi::sp_frame,
}

// SAFETY: the shim's state and the source are only reached through `&mut self` or `&self`
// methods of this one value, never shared; FFmpeg, libvpx and dav1d contexts may move between
// threads as long as one thread uses them at a time.
unsafe impl Send for Media {}

impl Media {
    pub fn open(source: impl Source + 'static) -> Result<Self, Error> {
        let boxed: Box<Box<dyn Source>> = Box::new(Box::new(source));
        let source = Box::into_raw(boxed);
        let mut code: c_int = 0;
        // SAFETY: the callbacks match the shim's signatures and `source` stays valid until
        // Drop, which closes the media before freeing it.
        let raw = unsafe { ffi::sp_open(read, seek, source.cast::<c_void>(), &mut code) };
        match NonNull::new(raw) {
            Some(raw) => Ok(Self {
                raw,
                source,
                frame: ffi::sp_frame::default(),
            }),
            None => {
                // SAFETY: sp_open failed and has dropped every reference to `source`.
                drop(unsafe { Box::from_raw(source) });
                Err(Error::from_code(code))
            }
        }
    }

    /// Bytes in memory, such as a fixture or a small cached attachment.
    pub fn open_bytes(bytes: impl AsRef<[u8]> + Send + 'static) -> Result<Self, Error> {
        Self::open(Cursor::new(bytes))
    }

    /// FFmpeg's name for the demuxer, such as `matroska,webm`.
    pub fn container(&self) -> String {
        // SAFETY: a static string owned by FFmpeg's demuxer table.
        unsafe { CStr::from_ptr(ffi::sp_container(self.raw.as_ptr())) }
            .to_string_lossy()
            .into_owned()
    }

    pub fn duration(&self) -> Option<Duration> {
        // SAFETY: an open media.
        let us = unsafe { ffi::sp_duration_us(self.raw.as_ptr()) };
        u64::try_from(us).ok().map(Duration::from_micros)
    }

    pub fn streams(&self) -> Vec<StreamInfo> {
        // SAFETY: an open media.
        let count = unsafe { ffi::sp_stream_count(self.raw.as_ptr()) };
        (0..count)
            .filter_map(|index| {
                let mut info = ffi::sp_stream_info::default();
                // SAFETY: `index` is in range and `info` is a valid out pointer.
                let code = unsafe { ffi::sp_stream_info_get(self.raw.as_ptr(), index, &mut info) };
                (code == ffi::SP_OK).then(|| StreamInfo {
                    kind: match info.kind {
                        ffi::SP_KIND_VIDEO => Kind::Video,
                        ffi::SP_KIND_AUDIO => Kind::Audio,
                        _ => Kind::Other,
                    },
                    codec: Codec::from_code(info.codec),
                    width: u32::try_from(info.width).unwrap_or(0),
                    height: u32::try_from(info.height).unwrap_or(0),
                    sample_rate: u32::try_from(info.sample_rate).unwrap_or(0),
                    channels: u32::try_from(info.channels).unwrap_or(0),
                    duration: u64::try_from(info.duration_us)
                        .ok()
                        .map(Duration::from_micros),
                })
            })
            .collect()
    }

    /// Opens the stream's decoder; [`Self::next_frame`] yields frames of enabled streams only.
    pub fn enable(&mut self, stream: usize) -> Result<(), Error> {
        let index = c_int::try_from(stream).map_err(|_| Error::BadStream)?;
        // SAFETY: an open media; the shim checks the index.
        match unsafe { ffi::sp_enable(self.raw.as_ptr(), index) } {
            ffi::SP_OK => Ok(()),
            code => Err(Error::from_code(code)),
        }
    }

    /// To the keyframe at or before `to`, decoders flushed. Frames before `to` still come out:
    /// the caller drops them (an accurate seek).
    pub fn seek(&mut self, to: Duration) -> Result<(), Error> {
        let us = i64::try_from(to.as_micros()).map_err(|_| Error::Invalid)?;
        // SAFETY: an open media.
        match unsafe { ffi::sp_seek(self.raw.as_ptr(), us) } {
            ffi::SP_OK => Ok(()),
            code => Err(Error::from_code(code)),
        }
    }

    /// Packets the decoders rejected as corrupt and skipped.
    pub fn skipped_packets(&self) -> u64 {
        // SAFETY: an open media.
        unsafe { ffi::sp_skipped_packets(self.raw.as_ptr()) }
    }

    /// The next frame of any enabled stream in file order, or `None` once all are drained. The
    /// frame borrows decoder memory until the next call.
    pub fn next_frame(&mut self) -> Result<Option<Frame<'_>>, Error> {
        // SAFETY: an open media and a valid out pointer.
        let code = unsafe { ffi::sp_next_frame(self.raw.as_ptr(), &mut self.frame) };
        match code {
            ffi::SP_OK => {}
            ffi::SP_EOF => return Ok(None),
            code => return Err(Error::from_code(code)),
        }
        let f = &self.frame;
        let stream = usize::try_from(f.stream).map_err(|_| Error::Decode)?;
        let pts_us = (f.pts_us != i64::MIN).then_some(f.pts_us);
        if f.kind == ffi::SP_KIND_VIDEO {
            let width = u32::try_from(f.width).map_err(|_| Error::Decode)?;
            let height = u32::try_from(f.height).map_err(|_| Error::Decode)?;
            let chroma_rows = height.div_ceil(2) as usize;
            let rows = [height as usize, chroma_rows, chroma_rows];
            let mut planes = [Plane {
                data: &[],
                stride: 0,
            }; 3];
            for (i, plane) in planes.iter_mut().enumerate() {
                let stride = usize::try_from(f.strides[i]).map_err(|_| Error::PixelFormat)?;
                if f.planes[i].is_null() {
                    return Err(Error::Decode);
                }
                // SAFETY: the decoder's plane holds `rows` rows of `stride` bytes and stays
                // alive until the next call, which the borrow of `self` prevents.
                let data = unsafe { std::slice::from_raw_parts(f.planes[i], stride * rows[i]) };
                *plane = Plane { data, stride };
            }
            return Ok(Some(Frame::Video(VideoFrame {
                stream,
                pts_us,
                width,
                height,
                planes,
            })));
        }
        let channels = u32::try_from(f.channels).map_err(|_| Error::Decode)?;
        let count = usize::try_from(f.samples).map_err(|_| Error::Decode)? * channels as usize;
        let samples = if count == 0 || f.pcm.is_null() {
            &[][..]
        } else {
            // SAFETY: the shim's float buffer holds `samples * channels` values until the
            // next call.
            unsafe { std::slice::from_raw_parts(f.pcm, count) }
        };
        Ok(Some(Frame::Audio(AudioFrame {
            stream,
            pts_us,
            sample_rate: u32::try_from(f.sample_rate).map_err(|_| Error::Decode)?,
            channels,
            samples,
        })))
    }
}

impl Drop for Media {
    fn drop(&mut self) {
        // SAFETY: closing first ends every use of `source` by the shim; then it is freed once.
        unsafe {
            ffi::sp_close(self.raw.as_ptr());
            drop(Box::from_raw(self.source));
        }
    }
}

fn source_at<'a>(opaque: *mut c_void) -> &'a mut Box<dyn Source> {
    // SAFETY: `opaque` is the `*mut Box<dyn Source>` from `Media::open`, used by one thread.
    unsafe { &mut *opaque.cast::<Box<dyn Source>>() }
}

unsafe extern "C" fn read(opaque: *mut c_void, buf: *mut u8, size: c_int) -> c_int {
    let result = catch_unwind(AssertUnwindSafe(|| {
        let len = usize::try_from(size).unwrap_or(0);
        if len == 0 || buf.is_null() {
            return -1;
        }
        // SAFETY: FFmpeg hands a buffer of `size` writable bytes.
        let out = unsafe { std::slice::from_raw_parts_mut(buf, len) };
        let source = source_at(opaque);
        loop {
            match source.read(out) {
                Ok(n) => return c_int::try_from(n).unwrap_or(-1),
                Err(error) if error.kind() == ErrorKind::Interrupted => continue,
                Err(_) => return -1,
            }
        }
    }));
    result.unwrap_or(-1)
}

unsafe extern "C" fn seek(opaque: *mut c_void, offset: i64, whence: c_int) -> i64 {
    let result = catch_unwind(AssertUnwindSafe(|| {
        let source = source_at(opaque);
        if whence == ffi::SP_SEEK_SIZE {
            let here = source.stream_position().ok()?;
            let end = source.seek(SeekFrom::End(0)).ok()?;
            source.seek(SeekFrom::Start(here)).ok()?;
            return i64::try_from(end).ok();
        }
        let to = match whence {
            0 => SeekFrom::Start(u64::try_from(offset).ok()?),
            1 => SeekFrom::Current(offset),
            2 => SeekFrom::End(offset),
            _ => return None,
        };
        i64::try_from(source.seek(to).ok()?).ok()
    }));
    result.ok().flatten().unwrap_or(-1)
}
