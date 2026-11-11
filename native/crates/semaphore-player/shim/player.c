/* See player.h. Everything this calls lives in LiveKit's prebuilt libwebrtc: FFmpeg (demuxers,
 * H.264 and audio decoders), libvpx (VP8, VP9) and dav1d (AV1). Nothing here allocates on a hot
 * path except the float buffer for audio, which grows to the largest frame and stays. */
#ifdef SP_LK_PREFIX
#include "lk_prefix.h"
#endif

#include <errno.h>
#include <limits.h>
#include <stdlib.h>
#include <string.h>

#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libavutil/mathematics.h>

#include <dav1d/dav1d.h>
#include "vpx/vp8dx.h"
#include "vpx/vpx_decoder.h"

#include "player.h"

#define IO_BUFFER_SIZE (64 * 1024)

enum { DEC_NONE = 0, DEC_FFMPEG, DEC_VPX, DEC_DAV1D };

/* decoder_receive's results besides errors. Not SP_OK/SP_EOF: those are the public API's. */
enum { RECV_NEED_INPUT = 0, RECV_FRAME = 1, RECV_DRAINED = 2 };

typedef struct decoder {
  int type;
  int draining; /* sent the end of input */
  int done;     /* drained */
  AVRational time_base;
  /* FFmpeg */
  AVCodecContext *av;
  AVFrame *frame;
  /* libvpx: one shown frame per packet, so the packet's pts is the frame's. */
  vpx_codec_ctx_t vpx;
  vpx_codec_iter_t iter;
  int64_t vpx_pts;
  /* dav1d */
  Dav1dContext *dav1d;
  Dav1dData pending;
  Dav1dPicture picture;
  int has_picture;
} decoder;

struct sp_media {
  sp_read_fn read;
  sp_seek_fn seek;
  void *opaque;
  AVIOContext *io;
  AVFormatContext *format;
  AVPacket *packet;
  decoder *decoders; /* one per stream; DEC_NONE until enabled */
  int count;
  int current; /* the stream whose decoder may have output, or -1 */
  int eof;     /* the demuxer has no more packets */
  int draining_index;
  float *pcm;
  size_t pcm_capacity; /* floats */
};

static int io_read(void *opaque, uint8_t *buf, int size) {
  sp_media *media = opaque;
  int n = media->read(media->opaque, buf, size);
  if (n == 0) return AVERROR_EOF;
  if (n < 0) return AVERROR(EIO);
  return n;
}

static int64_t io_seek(void *opaque, int64_t offset, int whence) {
  sp_media *media = opaque;
  if (whence & AVSEEK_SIZE) return media->seek(media->opaque, 0, SP_SEEK_SIZE);
  return media->seek(media->opaque, offset, whence & ~AVSEEK_FORCE);
}

static int64_t to_us(int64_t ts, AVRational time_base) {
  if (ts == AV_NOPTS_VALUE) return INT64_MIN;
  return av_rescale_q(ts, time_base, (AVRational){1, 1000000});
}

static int map_codec(enum AVCodecID id) {
  switch (id) {
    case AV_CODEC_ID_H264: return SP_CODEC_H264;
    case AV_CODEC_ID_VP8: return SP_CODEC_VP8;
    case AV_CODEC_ID_VP9: return SP_CODEC_VP9;
    case AV_CODEC_ID_AV1: return SP_CODEC_AV1;
    case AV_CODEC_ID_HEVC: return SP_CODEC_HEVC;
    case AV_CODEC_ID_THEORA: return SP_CODEC_THEORA;
    case AV_CODEC_ID_MPEG4: return SP_CODEC_MPEG4;
    case AV_CODEC_ID_AAC: return SP_CODEC_AAC;
    case AV_CODEC_ID_MP3: return SP_CODEC_MP3;
    case AV_CODEC_ID_VORBIS: return SP_CODEC_VORBIS;
    case AV_CODEC_ID_OPUS: return SP_CODEC_OPUS;
    case AV_CODEC_ID_FLAC: return SP_CODEC_FLAC;
    case AV_CODEC_ID_PCM_U8:
    case AV_CODEC_ID_PCM_S16LE:
    case AV_CODEC_ID_PCM_S16BE:
    case AV_CODEC_ID_PCM_S24LE:
    case AV_CODEC_ID_PCM_S24BE:
    case AV_CODEC_ID_PCM_S32LE:
    case AV_CODEC_ID_PCM_F32LE:
    case AV_CODEC_ID_PCM_ALAW:
    case AV_CODEC_ID_PCM_MULAW: return SP_CODEC_PCM;
    default: return SP_CODEC_OTHER;
  }
}

static void decoder_close(decoder *d) {
  switch (d->type) {
    case DEC_FFMPEG:
      av_frame_free(&d->frame);
      avcodec_free_context(&d->av);
      break;
    case DEC_VPX:
      vpx_codec_destroy(&d->vpx);
      break;
    case DEC_DAV1D:
      if (d->has_picture) dav1d_picture_unref(&d->picture);
      dav1d_data_unref(&d->pending);
      dav1d_close(&d->dav1d);
      break;
    default:
      break;
  }
  memset(d, 0, sizeof(*d));
}

void sp_close(sp_media *media) {
  if (!media) return;
  for (int i = 0; i < media->count; i++) decoder_close(&media->decoders[i]);
  free(media->decoders);
  av_packet_free(&media->packet);
  if (media->format) avformat_close_input(&media->format);
  if (media->io) {
    av_free(media->io->buffer);
    avio_context_free(&media->io);
  }
  free(media->pcm);
  free(media);
}

sp_media *sp_open(sp_read_fn read, sp_seek_fn seek, void *opaque, int *error) {
  int err = SP_E_NOMEM;
  sp_media *media = calloc(1, sizeof(*media));
  if (!media) goto fail;
  media->read = read;
  media->seek = seek;
  media->opaque = opaque;
  media->current = -1;

  unsigned char *buffer = av_malloc(IO_BUFFER_SIZE);
  if (!buffer) goto fail;
  media->io = avio_alloc_context(buffer, IO_BUFFER_SIZE, 0, media, io_read, NULL, io_seek);
  if (!media->io) {
    av_free(buffer);
    goto fail;
  }

  /* Probe first, so "nothing recognises this" (unsupported) differs from "a known container
   * that won't parse" (invalid). A guess at or below FFmpeg's retry score (a stray MP3 frame
   * inside an AVI, say) counts as unrecognised. */
  const AVInputFormat *input = NULL;
  int score = av_probe_input_buffer2(media->io, &input, "", NULL, 0, 0);
  if (score == AVERROR(EIO)) {
    err = SP_E_IO;
    goto fail;
  }
  if (score <= AVPROBE_SCORE_RETRY || !input) {
    err = SP_E_UNSUPPORTED_CONTAINER;
    goto fail;
  }

  media->format = avformat_alloc_context();
  if (!media->format) goto fail;
  media->format->pb = media->io;
  media->format->flags |= AVFMT_FLAG_CUSTOM_IO;
  int r = avformat_open_input(&media->format, NULL, input, NULL);
  if (r < 0) { /* frees the context and NULLs it */
    err = r == AVERROR(EIO) ? SP_E_IO : SP_E_INVALID;
    goto fail;
  }
  r = avformat_find_stream_info(media->format, NULL);
  if (r < 0) {
    err = r == AVERROR(EIO) ? SP_E_IO : SP_E_INVALID;
    goto fail;
  }

  media->count = (int)media->format->nb_streams;
  media->decoders = calloc(media->count > 0 ? (size_t)media->count : 1, sizeof(decoder));
  media->packet = av_packet_alloc();
  if (!media->decoders || !media->packet) goto fail;
  *error = SP_OK;
  return media;

fail:
  sp_close(media);
  *error = err;
  return NULL;
}

const char *sp_container(const sp_media *media) { return media->format->iformat->name; }

int64_t sp_duration_us(const sp_media *media) {
  return media->format->duration == AV_NOPTS_VALUE ? -1 : media->format->duration;
}

int sp_stream_count(const sp_media *media) { return media->count; }

int sp_stream_info_get(const sp_media *media, int index, sp_stream_info *out) {
  if (index < 0 || index >= media->count) return SP_E_ARG;
  const AVStream *stream = media->format->streams[index];
  const AVCodecParameters *par = stream->codecpar;
  memset(out, 0, sizeof(*out));
  out->kind = par->codec_type == AVMEDIA_TYPE_VIDEO   ? SP_KIND_VIDEO
              : par->codec_type == AVMEDIA_TYPE_AUDIO ? SP_KIND_AUDIO
                                                      : SP_KIND_OTHER;
  out->codec = map_codec(par->codec_id);
  out->width = par->width;
  out->height = par->height;
  out->sample_rate = par->sample_rate;
  out->channels = par->ch_layout.nb_channels;
  out->duration_us =
      stream->duration == AV_NOPTS_VALUE ? -1 : to_us(stream->duration, stream->time_base);
  return SP_OK;
}

int sp_enable(sp_media *media, int index) {
  if (index < 0 || index >= media->count) return SP_E_ARG;
  decoder *d = &media->decoders[index];
  if (d->type != DEC_NONE) return SP_OK;
  const AVStream *stream = media->format->streams[index];
  const AVCodecParameters *par = stream->codecpar;
  d->time_base = stream->time_base;

  switch (par->codec_id) {
    case AV_CODEC_ID_VP8:
    case AV_CODEC_ID_VP9: {
      vpx_codec_dec_cfg_t cfg = {1, (unsigned)par->width, (unsigned)par->height};
      vpx_codec_iface_t *iface =
          par->codec_id == AV_CODEC_ID_VP8 ? vpx_codec_vp8_dx() : vpx_codec_vp9_dx();
      if (vpx_codec_dec_init(&d->vpx, iface, &cfg, 0) != VPX_CODEC_OK) return SP_E_DECODE;
      d->type = DEC_VPX;
      return SP_OK;
    }
    case AV_CODEC_ID_AV1: {
      Dav1dSettings settings;
      dav1d_default_settings(&settings);
      settings.n_threads = 1;
      settings.max_frame_delay = 1;
      if (dav1d_open(&d->dav1d, &settings) < 0) return SP_E_DECODE;
      d->type = DEC_DAV1D;
      return SP_OK;
    }
    case AV_CODEC_ID_AAC:
#ifndef SP_ENABLE_AAC
      return SP_E_UNSUPPORTED_CODEC;
#endif
      /* fall through */
    case AV_CODEC_ID_H264:
    case AV_CODEC_ID_MP3:
    case AV_CODEC_ID_VORBIS:
    case AV_CODEC_ID_OPUS:
    case AV_CODEC_ID_FLAC:
      break;
    default:
      if (map_codec(par->codec_id) != SP_CODEC_PCM) return SP_E_UNSUPPORTED_CODEC;
      break;
  }

  const AVCodec *codec = avcodec_find_decoder(par->codec_id);
  if (!codec) return SP_E_UNSUPPORTED_CODEC;
  AVCodecContext *av = avcodec_alloc_context3(codec);
  if (!av) return SP_E_NOMEM;
  if (avcodec_parameters_to_context(av, par) < 0) {
    avcodec_free_context(&av);
    return SP_E_DECODE;
  }
  av->pkt_timebase = stream->time_base;
  av->thread_count = 1;
  if (avcodec_open2(av, codec, NULL) < 0) {
    avcodec_free_context(&av);
    return SP_E_DECODE;
  }
  d->frame = av_frame_alloc();
  if (!d->frame) {
    avcodec_free_context(&av);
    return SP_E_NOMEM;
  }
  d->av = av;
  d->type = DEC_FFMPEG;
  return SP_OK;
}

/* NULL packet: the end of input. */
static int decoder_send(decoder *d, const AVPacket *packet) {
  if (!packet) d->draining = 1;
  switch (d->type) {
    case DEC_FFMPEG: {
      int r = avcodec_send_packet(d->av, packet);
      if (r < 0 && r != AVERROR_EOF) return SP_E_DECODE;
      return SP_OK;
    }
    case DEC_VPX:
      d->iter = NULL;
      if (!packet) return vpx_codec_decode(&d->vpx, NULL, 0, NULL, 0) == VPX_CODEC_OK ? SP_OK : SP_E_DECODE;
      d->vpx_pts = packet->pts;
      if (vpx_codec_decode(&d->vpx, packet->data, (unsigned)packet->size, NULL, 0) != VPX_CODEC_OK)
        return SP_E_DECODE;
      return SP_OK;
    case DEC_DAV1D:
      if (!packet) return SP_OK;
    {
      uint8_t *bytes = dav1d_data_create(&d->pending, (size_t)packet->size);
      if (!bytes) return SP_E_NOMEM;
      memcpy(bytes, packet->data, (size_t)packet->size);
    }
      d->pending.m.timestamp = packet->pts;
      return SP_OK;
    default:
      return SP_E_ARG;
  }
}

static int pcm_reserve(sp_media *media, size_t floats) {
  if (floats <= media->pcm_capacity) return SP_OK;
  float *grown = realloc(media->pcm, floats * sizeof(float));
  if (!grown) return SP_E_NOMEM;
  media->pcm = grown;
  media->pcm_capacity = floats;
  return SP_OK;
}

static float sample_at(const AVFrame *f, int channel, int index, int channels) {
  int planar = av_sample_fmt_is_planar((enum AVSampleFormat)f->format);
  int plane = planar ? channel : 0;
  int at = planar ? index : index * channels + channel;
  const uint8_t *p = f->extended_data[plane];
  switch (f->format) {
    case AV_SAMPLE_FMT_FLT:
    case AV_SAMPLE_FMT_FLTP: return ((const float *)p)[at];
    case AV_SAMPLE_FMT_DBL:
    case AV_SAMPLE_FMT_DBLP: return (float)((const double *)p)[at];
    case AV_SAMPLE_FMT_S16:
    case AV_SAMPLE_FMT_S16P: return ((const int16_t *)p)[at] / 32768.0f;
    case AV_SAMPLE_FMT_S32:
    case AV_SAMPLE_FMT_S32P: return (float)(((const int32_t *)p)[at] / 2147483648.0);
    case AV_SAMPLE_FMT_U8:
    case AV_SAMPLE_FMT_U8P: return (p[at] - 128) / 128.0f;
    default: return 0.0f;
  }
}

static int fill_ffmpeg(sp_media *media, decoder *d, sp_frame *out) {
  const AVFrame *f = d->frame;
  out->pts_us = to_us(f->best_effort_timestamp, d->time_base);
  if (d->av->codec_type == AVMEDIA_TYPE_VIDEO) {
    if (f->format != AV_PIX_FMT_YUV420P && f->format != AV_PIX_FMT_YUVJ420P) return SP_E_PIXEL_FORMAT;
    out->kind = SP_KIND_VIDEO;
    out->width = f->width;
    out->height = f->height;
    for (int i = 0; i < 3; i++) {
      out->planes[i] = f->data[i];
      out->strides[i] = f->linesize[i];
    }
    return SP_OK;
  }
  switch (f->format) {
    case AV_SAMPLE_FMT_FLT: case AV_SAMPLE_FMT_FLTP: case AV_SAMPLE_FMT_DBL:
    case AV_SAMPLE_FMT_DBLP: case AV_SAMPLE_FMT_S16: case AV_SAMPLE_FMT_S16P:
    case AV_SAMPLE_FMT_S32: case AV_SAMPLE_FMT_S32P: case AV_SAMPLE_FMT_U8:
    case AV_SAMPLE_FMT_U8P: break;
    default: return SP_E_DECODE;
  }
  int channels = f->ch_layout.nb_channels > 0 ? f->ch_layout.nb_channels : 1;
  size_t total = (size_t)f->nb_samples * (size_t)channels;
  if (pcm_reserve(media, total > 0 ? total : 1) != SP_OK) return SP_E_NOMEM;
  for (int i = 0; i < f->nb_samples; i++)
    for (int c = 0; c < channels; c++) media->pcm[(size_t)i * channels + c] = sample_at(f, c, i, channels);
  out->kind = SP_KIND_AUDIO;
  out->samples = f->nb_samples;
  out->channels = channels;
  out->sample_rate = f->sample_rate;
  out->pcm = media->pcm;
  return SP_OK;
}

/* RECV_FRAME (a frame in `out`), RECV_NEED_INPUT, RECV_DRAINED, or a negative error. */
static int decoder_receive(sp_media *media, decoder *d, sp_frame *out) {
  switch (d->type) {
    case DEC_FFMPEG: {
      av_frame_unref(d->frame);
      int r = avcodec_receive_frame(d->av, d->frame);
      if (r == AVERROR(EAGAIN)) return RECV_NEED_INPUT;
      if (r == AVERROR_EOF) return RECV_DRAINED;
      if (r < 0) return SP_E_DECODE;
      r = fill_ffmpeg(media, d, out);
      return r < 0 ? r : RECV_FRAME;
    }
    case DEC_VPX: {
      vpx_image_t *img = vpx_codec_get_frame(&d->vpx, &d->iter);
      if (!img) return d->draining ? RECV_DRAINED : RECV_NEED_INPUT;
      if (img->fmt != VPX_IMG_FMT_I420) return SP_E_PIXEL_FORMAT;
      out->kind = SP_KIND_VIDEO;
      out->pts_us = to_us(d->vpx_pts, d->time_base);
      out->width = (int)img->d_w;
      out->height = (int)img->d_h;
      for (int i = 0; i < 3; i++) {
        out->planes[i] = img->planes[i];
        out->strides[i] = img->stride[i];
      }
      return RECV_FRAME;
    }
    case DEC_DAV1D: {
      if (d->has_picture) {
        dav1d_picture_unref(&d->picture);
        d->has_picture = 0;
      }
      for (;;) {
        if (d->pending.sz) {
          int s = dav1d_send_data(d->dav1d, &d->pending);
          if (s < 0 && s != DAV1D_ERR(EAGAIN)) {
            dav1d_data_unref(&d->pending);
            return SP_E_DECODE;
          }
        }
        int r = dav1d_get_picture(d->dav1d, &d->picture);
        if (r == 0) break;
        if (r != DAV1D_ERR(EAGAIN)) return SP_E_DECODE;
        if (d->pending.sz) continue; /* dav1d wanted its output read before more input */
        return d->draining ? RECV_DRAINED : RECV_NEED_INPUT;
      }
      d->has_picture = 1;
      const Dav1dPicture *p = &d->picture;
      if (p->p.bpc != 8 || p->p.layout != DAV1D_PIXEL_LAYOUT_I420) return SP_E_PIXEL_FORMAT;
      out->kind = SP_KIND_VIDEO;
      out->pts_us = to_us(p->m.timestamp, d->time_base);
      out->width = p->p.w;
      out->height = p->p.h;
      for (int i = 0; i < 3; i++) {
        out->planes[i] = p->data[i];
        out->strides[i] = (int)p->stride[i == 0 ? 0 : 1];
      }
      return RECV_FRAME;
    }
    default:
      return SP_E_ARG;
  }
}

int sp_next_frame(sp_media *media, sp_frame *out) {
  memset(out, 0, sizeof(*out));
  for (;;) {
    if (media->current >= 0) {
      decoder *d = &media->decoders[media->current];
      int r = decoder_receive(media, d, out);
      if (r == RECV_FRAME) {
        out->stream = media->current;
        return SP_OK;
      }
      if (r < 0) return r;
      /* Drained, or a draining decoder that wants input it will never get. */
      if (r == RECV_DRAINED || d->draining) d->done = 1;
      media->current = -1;
    }
    if (!media->eof) {
      int r = av_read_frame(media->format, media->packet);
      if (r == AVERROR_EOF) {
        media->eof = 1;
        continue;
      }
      if (r < 0) return r == AVERROR(EIO) ? SP_E_IO : SP_E_INVALID;
      int s = media->packet->stream_index;
      if (s >= 0 && s < media->count && media->decoders[s].type != DEC_NONE) {
        r = decoder_send(&media->decoders[s], media->packet);
        av_packet_unref(media->packet);
        if (r < 0) return r;
        media->current = s;
      } else {
        av_packet_unref(media->packet);
      }
      continue;
    }
    while (media->draining_index < media->count &&
           (media->decoders[media->draining_index].type == DEC_NONE ||
            media->decoders[media->draining_index].done))
      media->draining_index++;
    if (media->draining_index >= media->count) return SP_EOF;
    decoder *d = &media->decoders[media->draining_index];
    if (!d->draining) {
      int r = decoder_send(d, NULL);
      if (r < 0) return r;
    }
    media->current = media->draining_index;
  }
}
