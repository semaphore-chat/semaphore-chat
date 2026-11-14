/* The player's C shim over the FFmpeg, libvpx and dav1d inside LiveKit's prebuilt libwebrtc.
 *
 * A small, stable surface so that Rust never sees FFmpeg's structs (their layout follows the
 * FFmpeg revision LiveKit's libwebrtc pins). FFmpeg demuxes; H.264 and audio decode in FFmpeg,
 * VP8 and VP9 in libvpx, AV1 in dav1d. One sp_media is used from one thread at a time.
 * Mirrored by src/ffi.rs: change both together. */
#ifndef SEMAPHORE_PLAYER_SHIM_H
#define SEMAPHORE_PLAYER_SHIM_H

#include <stdint.h>

/* Return codes. Errors are negative. */
#define SP_OK 0
#define SP_EOF 1
#define SP_AGAIN 2 /* a decoder wants more input before its next frame */
#define SP_E_UNSUPPORTED_CONTAINER (-1) /* no demuxer recognises the bytes */
#define SP_E_INVALID (-2)               /* a known container that fails to parse */
#define SP_E_UNSUPPORTED_CODEC (-3)     /* a stream we can't decode (or AAC, built without it) */
#define SP_E_IO (-4)                    /* the source's read or seek failed */
#define SP_E_NOMEM (-5)
#define SP_E_DECODE (-6)                /* the decoder rejected the data */
#define SP_E_ARG (-7)                   /* bad stream index, or a stream not enabled */
#define SP_E_PIXEL_FORMAT (-8)          /* decoded, but not 8-bit 4:2:0 */

/* FFmpeg's AV_PROFILE_UNKNOWN: the demuxer or decoder has not said which profile this is. */
#define SP_PROFILE_UNKNOWN (-99)

#define SP_KIND_OTHER 0
#define SP_KIND_VIDEO 1
#define SP_KIND_AUDIO 2

#define SP_CODEC_OTHER 0
#define SP_CODEC_H264 1
#define SP_CODEC_VP8 2
#define SP_CODEC_VP9 3
#define SP_CODEC_AV1 4
#define SP_CODEC_HEVC 5
#define SP_CODEC_THEORA 6
#define SP_CODEC_MPEG4 7
#define SP_CODEC_AAC 20
#define SP_CODEC_MP3 21
#define SP_CODEC_VORBIS 22
#define SP_CODEC_OPUS 23
#define SP_CODEC_FLAC 24
#define SP_CODEC_PCM 25

/* Reads up to `size` bytes into `buf`: the count, 0 at the end, negative on error. */
typedef int (*sp_read_fn)(void *opaque, uint8_t *buf, int size);
/* Seeks like lseek (whence 0, 1, 2) and returns the new position; whence SP_SEEK_SIZE returns
 * the total size instead, without moving. Negative on error. */
typedef int64_t (*sp_seek_fn)(void *opaque, int64_t offset, int whence);
#define SP_SEEK_SIZE 0x10000

typedef struct sp_stream_info {
  int kind;
  int codec;
  int width;
  int height;
  int sample_rate;
  int channels;
  int64_t duration_us; /* -1 when the container doesn't say */
  /* The demuxer's codec profile (FFmpeg's AVCodecParameters.profile: AAC-LC is 1, HE-AAC 4);
   * SP_PROFILE_UNKNOWN when it says nothing. */
  int profile;
} sp_stream_info;

/* Valid until the next sp_next_frame or sp_close on the same media. */
typedef struct sp_frame {
  int stream;
  int kind;
  int64_t pts_us; /* INT64_MIN when unknown */
  /* Video: 8-bit I420. */
  int width;
  int height;
  const uint8_t *planes[3];
  int strides[3];
  /* Audio: interleaved float, `samples` per channel. */
  int samples;
  int channels;
  int sample_rate;
  const float *pcm;
  /* The decoder's profile for this frame (FFmpeg's AVCodecContext.profile). */
  int profile;
} sp_frame;

typedef struct sp_media sp_media;

/* Probes and opens. NULL with *error set on failure. The callbacks and opaque must outlive it. */
sp_media *sp_open(sp_read_fn read, sp_seek_fn seek, void *opaque, int *error);
void sp_close(sp_media *media);
const char *sp_container(const sp_media *media);
int64_t sp_duration_us(const sp_media *media); /* -1 when unknown */
int sp_stream_count(const sp_media *media);
int sp_stream_info_get(const sp_media *media, int index, sp_stream_info *out);
/* Opens the stream's decoder. Frames come only from enabled streams. */
int sp_enable(sp_media *media, int index);
/* The stream's extradata (an AAC track's AudioSpecificConfig): 0, *data NULL and *size 0 when it
 * has none. Valid while the media is open. */
int sp_stream_extradata(const sp_media *media, int index, const uint8_t **data, int *size);
/* The enabled decoder's profile (FFmpeg's AV_PROFILE_*), SP_PROFILE_UNKNOWN before it decides. */
int sp_stream_profile(const sp_media *media, int index);
/* Stops a stream's decoder for good: its packets are dropped from the next sp_next_frame on. */
void sp_disable(sp_media *media, int index);
/* The next decoded frame of any enabled stream, in demux order: SP_OK, SP_EOF or an error.
 * A packet a decoder rejects (corrupt) is skipped and counted; many in a row is SP_E_DECODE. */
int sp_next_frame(sp_media *media, sp_frame *out);
uint64_t sp_skipped_packets(const sp_media *media);
/* To the keyframe at or before `us`, decoders flushed; frames before `us` still come out, for
 * the caller to drop. */
int sp_seek(sp_media *media, int64_t us);
/* A video frame from sp_next_frame into NV12 buffers of at least y_stride * height and
 * uv_stride * ceil(height / 2) bytes (libyuv). */
/* A standalone decoder for elementary streams demuxed elsewhere (the replay preview's MPEG-TS,
 * src/ts.rs): H.264 as Annex B access units, AAC as ADTS frames (only with SP_ENABLE_AAC, else
 * SP_E_UNSUPPORTED_CODEC). Timestamps are microseconds, INT64_MIN when unknown. One thread at a
 * time. */
typedef struct sp_decoder sp_decoder;
sp_decoder *sp_decoder_open(int codec, int *error);
void sp_decoder_close(sp_decoder *decoder);
/* One access unit; `data` NULL ends the input (drain). A unit the decoder rejects is skipped and
 * counted; many in a row is SP_E_DECODE. */
int sp_decoder_send(sp_decoder *decoder, const uint8_t *data, int size, int64_t pts_us,
                    int64_t dts_us);
/* SP_OK with a frame (valid until the next call), SP_AGAIN for more input, SP_EOF once drained. */
int sp_decoder_receive(sp_decoder *decoder, sp_frame *out);
/* Drops buffered input and output, as before a seek. */
void sp_decoder_flush(sp_decoder *decoder);
uint64_t sp_decoder_skipped(const sp_decoder *decoder);
/* The decoder's profile once open (FFmpeg's AV_PROFILE_*), SP_PROFILE_UNKNOWN when unknown. */
int sp_decoder_profile(const sp_decoder *decoder);

int sp_i420_to_nv12(const sp_frame *frame, uint8_t *y, int y_stride, uint8_t *uv, int uv_stride);

#endif
