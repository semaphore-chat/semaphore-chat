//! `shim/player.h`, by hand. Change both together.

#![allow(non_camel_case_types)]

use std::ffi::{c_char, c_int, c_void};

pub const SP_OK: c_int = 0;
pub const SP_EOF: c_int = 1;
pub const SP_AGAIN: c_int = 2;
pub const SP_E_UNSUPPORTED_CONTAINER: c_int = -1;
pub const SP_E_INVALID: c_int = -2;
pub const SP_E_UNSUPPORTED_CODEC: c_int = -3;
pub const SP_E_IO: c_int = -4;
pub const SP_E_NOMEM: c_int = -5;
pub const SP_E_DECODE: c_int = -6;
pub const SP_E_ARG: c_int = -7;
pub const SP_E_PIXEL_FORMAT: c_int = -8;

pub const SP_KIND_VIDEO: c_int = 1;
pub const SP_KIND_AUDIO: c_int = 2;

pub const SP_CODEC_H264: c_int = 1;
pub const SP_CODEC_VP8: c_int = 2;
pub const SP_CODEC_VP9: c_int = 3;
pub const SP_CODEC_AV1: c_int = 4;
pub const SP_CODEC_HEVC: c_int = 5;
pub const SP_CODEC_THEORA: c_int = 6;
pub const SP_CODEC_MPEG4: c_int = 7;
pub const SP_CODEC_AAC: c_int = 20;
pub const SP_CODEC_MP3: c_int = 21;
pub const SP_CODEC_VORBIS: c_int = 22;
pub const SP_CODEC_OPUS: c_int = 23;
pub const SP_CODEC_FLAC: c_int = 24;
pub const SP_CODEC_PCM: c_int = 25;

pub const SP_SEEK_SIZE: c_int = 0x10000;

/// FFmpeg's `AV_PROFILE_UNKNOWN`.
pub const SP_PROFILE_UNKNOWN: c_int = -99;

pub type sp_read_fn = unsafe extern "C" fn(opaque: *mut c_void, buf: *mut u8, size: c_int) -> c_int;
pub type sp_seek_fn = unsafe extern "C" fn(opaque: *mut c_void, offset: i64, whence: c_int) -> i64;

#[repr(C)]
#[derive(Default, Clone, Copy)]
pub struct sp_stream_info {
    pub kind: c_int,
    pub codec: c_int,
    pub width: c_int,
    pub height: c_int,
    pub sample_rate: c_int,
    pub channels: c_int,
    pub duration_us: i64,
    pub profile: c_int,
}

#[repr(C)]
pub struct sp_frame {
    pub stream: c_int,
    pub kind: c_int,
    pub pts_us: i64,
    pub width: c_int,
    pub height: c_int,
    pub planes: [*const u8; 3],
    pub strides: [c_int; 3],
    pub samples: c_int,
    pub channels: c_int,
    pub sample_rate: c_int,
    pub pcm: *const f32,
    pub profile: c_int,
}

impl Default for sp_frame {
    fn default() -> Self {
        Self {
            stream: 0,
            kind: 0,
            pts_us: 0,
            width: 0,
            height: 0,
            planes: [std::ptr::null(); 3],
            strides: [0; 3],
            samples: 0,
            channels: 0,
            sample_rate: 0,
            pcm: std::ptr::null(),
            profile: 0,
        }
    }
}

#[repr(C)]
pub struct sp_media {
    _private: [u8; 0],
}

#[repr(C)]
pub struct sp_decoder {
    _private: [u8; 0],
}

unsafe extern "C" {
    pub fn sp_open(
        read: sp_read_fn,
        seek: sp_seek_fn,
        opaque: *mut c_void,
        error: *mut c_int,
    ) -> *mut sp_media;
    pub fn sp_close(media: *mut sp_media);
    pub fn sp_container(media: *const sp_media) -> *const c_char;
    pub fn sp_duration_us(media: *const sp_media) -> i64;
    pub fn sp_stream_count(media: *const sp_media) -> c_int;
    pub fn sp_stream_info_get(
        media: *const sp_media,
        index: c_int,
        out: *mut sp_stream_info,
    ) -> c_int;
    pub fn sp_enable(media: *mut sp_media, index: c_int) -> c_int;
    pub fn sp_stream_extradata(
        media: *const sp_media,
        index: c_int,
        data: *mut *const u8,
        size: *mut c_int,
    ) -> c_int;
    pub fn sp_stream_profile(media: *const sp_media, index: c_int) -> c_int;
    pub fn sp_disable(media: *mut sp_media, index: c_int);
    pub fn sp_next_frame(media: *mut sp_media, out: *mut sp_frame) -> c_int;
    pub fn sp_skipped_packets(media: *const sp_media) -> u64;
    pub fn sp_seek(media: *mut sp_media, us: i64) -> c_int;
    pub fn sp_decoder_open(codec: c_int, error: *mut c_int) -> *mut sp_decoder;
    pub fn sp_decoder_close(decoder: *mut sp_decoder);
    pub fn sp_decoder_send(
        decoder: *mut sp_decoder,
        data: *const u8,
        size: c_int,
        pts_us: i64,
        dts_us: i64,
    ) -> c_int;
    pub fn sp_decoder_receive(decoder: *mut sp_decoder, out: *mut sp_frame) -> c_int;
    pub fn sp_decoder_flush(decoder: *mut sp_decoder);
    pub fn sp_decoder_skipped(decoder: *const sp_decoder) -> u64;
    pub fn sp_decoder_profile(decoder: *const sp_decoder) -> c_int;
    pub fn sp_i420_to_nv12(
        frame: *const sp_frame,
        y: *mut u8,
        y_stride: c_int,
        uv: *mut u8,
        uv_stride: c_int,
    ) -> c_int;
}
