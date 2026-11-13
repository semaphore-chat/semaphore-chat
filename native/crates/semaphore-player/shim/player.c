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
/* A corrupt packet is skipped, as browsers do; this many in a row means the stream is garbage. */
#define MAX_REJECTED_IN_A_ROW 64

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

/* What a decoder's output and errors are counted in: a media's, or a standalone decoder's. */
typedef struct common {
  /* Packets the decoders rejected and were skipped, in all and in a row. */
  uint64_t skipped;
  int rejected_in_a_row;
  float *pcm;
  size_t pcm_capacity; /* floats */
} common;

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
  common common;
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
  free(media->common.pcm);
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

/* A packet the decoder rejected: skipped, unless too many in a row. */
static int rejected(common *c) {
  c->skipped++;
  return ++c->rejected_in_a_row > MAX_REJECTED_IN_A_ROW ? SP_E_DECODE : SP_OK;
}

/* NULL packet: the end of input. An empty packet (which dav1d can't take) is ignored. */
static int decoder_send(common *c, decoder *d, const AVPacket *packet) {
  if (!packet) d->draining = 1;
  if (packet && packet->size <= 0) return SP_OK;
  switch (d->type) {
    case DEC_FFMPEG: {
      int r = avcodec_send_packet(d->av, packet);
      if (r < 0 && r != AVERROR_EOF) return packet ? rejected(c) : SP_E_DECODE;
      break;
    }
    case DEC_VPX:
      d->iter = NULL;
      if (!packet) return vpx_codec_decode(&d->vpx, NULL, 0, NULL, 0) == VPX_CODEC_OK ? SP_OK : SP_E_DECODE;
      d->vpx_pts = packet->pts;
      if (vpx_codec_decode(&d->vpx, packet->data, (unsigned)packet->size, NULL, 0) != VPX_CODEC_OK)
        return rejected(c);
      break;
    case DEC_DAV1D: {
      if (!packet) return SP_OK;
      uint8_t *bytes = dav1d_data_create(&d->pending, (size_t)packet->size);
      if (!bytes) return SP_E_NOMEM;
      memcpy(bytes, packet->data, (size_t)packet->size);
      d->pending.m.timestamp = packet->pts;
      break;
    }
    default:
      return SP_E_ARG;
  }
  return SP_OK;
}

static int pcm_reserve(common *c, size_t floats) {
  if (floats <= c->pcm_capacity) return SP_OK;
  float *grown = realloc(c->pcm, floats * sizeof(float));
  if (!grown) return SP_E_NOMEM;
  c->pcm = grown;
  c->pcm_capacity = floats;
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

static int fill_ffmpeg(common *c, decoder *d, sp_frame *out) {
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
  if (pcm_reserve(c, total > 0 ? total : 1) != SP_OK) return SP_E_NOMEM;
  for (int i = 0; i < f->nb_samples; i++)
    for (int ch = 0; ch < channels; ch++) c->pcm[(size_t)i * channels + ch] = sample_at(f, ch, i, channels);
  out->kind = SP_KIND_AUDIO;
  out->samples = f->nb_samples;
  out->channels = channels;
  out->sample_rate = f->sample_rate;
  out->pcm = c->pcm;
  return SP_OK;
}

/* RECV_FRAME (a frame in `out`), RECV_NEED_INPUT, RECV_DRAINED, or a negative error. */
static int decoder_receive(common *c, decoder *d, sp_frame *out) {
  switch (d->type) {
    case DEC_FFMPEG: {
      av_frame_unref(d->frame);
      int r = avcodec_receive_frame(d->av, d->frame);
      if (r == AVERROR(EAGAIN)) return RECV_NEED_INPUT;
      if (r == AVERROR_EOF) return RECV_DRAINED;
      if (r < 0) {
        r = rejected(c);
        return r < 0 ? r : (d->draining ? RECV_DRAINED : RECV_NEED_INPUT);
      }
      r = fill_ffmpeg(c, d, out);
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
            s = rejected(c);
            if (s < 0) return s;
          }
        }
        int r = dav1d_get_picture(d->dav1d, &d->picture);
        if (r == 0) break;
        if (r != DAV1D_ERR(EAGAIN)) {
          r = rejected(c);
          if (r < 0) return r;
        }
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
      int r = decoder_receive(&media->common, d, out);
      if (r == RECV_FRAME) {
        media->common.rejected_in_a_row = 0;
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
        r = decoder_send(&media->common, &media->decoders[s], media->packet);
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
      int r = decoder_send(&media->common, d, NULL);
      if (r < 0) return r;
    }
    media->current = media->draining_index;
  }
}

uint64_t sp_skipped_packets(const sp_media *media) { return media->common.skipped; }

int sp_seek(sp_media *media, int64_t us) {
  /* The keyframe at or before `us`, in AV_TIME_BASE (microseconds) across all streams. */
  int r = avformat_seek_file(media->format, -1, INT64_MIN, us, us, 0);
  if (r < 0) return r == AVERROR(EIO) ? SP_E_IO : SP_E_INVALID;
  for (int i = 0; i < media->count; i++) {
    decoder *d = &media->decoders[i];
    d->draining = 0;
    d->done = 0;
    switch (d->type) {
      case DEC_FFMPEG:
        avcodec_flush_buffers(d->av);
        av_frame_unref(d->frame);
        break;
      case DEC_VPX:
        /* Nothing buffered with one thread and no frame parallelism; the keyframe resets it. */
        d->iter = NULL;
        break;
      case DEC_DAV1D:
        if (d->has_picture) {
          dav1d_picture_unref(&d->picture);
          d->has_picture = 0;
        }
        dav1d_data_unref(&d->pending);
        dav1d_flush(d->dav1d);
        break;
      default:
        break;
    }
  }
  media->current = -1;
  media->eof = 0;
  media->draining_index = 0;
  media->common.rejected_in_a_row = 0;
  return SP_OK;
}

struct sp_decoder {
  decoder d;
  common common;
  AVPacket *packet;
};

void sp_decoder_close(sp_decoder *dec) {
  if (!dec) return;
  decoder_close(&dec->d);
  av_packet_free(&dec->packet);
  free(dec->common.pcm);
  free(dec);
}

sp_decoder *sp_decoder_open(int codec, int *error) {
  enum AVCodecID id = AV_CODEC_ID_NONE;
  switch (codec) {
    case SP_CODEC_H264:
      id = AV_CODEC_ID_H264;
      break;
    case SP_CODEC_AAC:
#ifdef SP_ENABLE_AAC
      id = AV_CODEC_ID_AAC;
#endif
      break;
    default:
      break;
  }
  if (id == AV_CODEC_ID_NONE) {
    *error = SP_E_UNSUPPORTED_CODEC;
    return NULL;
  }
  const AVCodec *codec_impl = avcodec_find_decoder(id);
  if (!codec_impl) {
    *error = SP_E_UNSUPPORTED_CODEC;
    return NULL;
  }
  int err = SP_E_NOMEM;
  sp_decoder *dec = calloc(1, sizeof(*dec));
  if (!dec) goto fail;
  dec->packet = av_packet_alloc();
  if (!dec->packet) goto fail;
  AVCodecContext *av = avcodec_alloc_context3(codec_impl);
  if (!av) goto fail;
  /* H.264 as Annex B and AAC as ADTS carry their parameters in band: no extradata. */
  av->pkt_timebase = (AVRational){1, 1000000};
  av->thread_count = 1;
  if (avcodec_open2(av, codec_impl, NULL) < 0) {
    avcodec_free_context(&av);
    err = SP_E_DECODE;
    goto fail;
  }
  dec->d.frame = av_frame_alloc();
  if (!dec->d.frame) {
    avcodec_free_context(&av);
    goto fail;
  }
  dec->d.av = av;
  dec->d.type = DEC_FFMPEG;
  dec->d.time_base = (AVRational){1, 1000000};
  *error = SP_OK;
  return dec;

fail:
  sp_decoder_close(dec);
  *error = err;
  return NULL;
}

int sp_decoder_send(sp_decoder *dec, const uint8_t *data, int size, int64_t pts_us, int64_t dts_us) {
  if (!data) return decoder_send(&dec->common, &dec->d, NULL);
  if (size <= 0) return SP_OK;
  if (av_new_packet(dec->packet, size) < 0) return SP_E_NOMEM;
  memcpy(dec->packet->data, data, (size_t)size);
  dec->packet->pts = pts_us == INT64_MIN ? AV_NOPTS_VALUE : pts_us;
  dec->packet->dts = dts_us == INT64_MIN ? AV_NOPTS_VALUE : dts_us;
  int r = decoder_send(&dec->common, &dec->d, dec->packet);
  av_packet_unref(dec->packet);
  return r;
}

int sp_decoder_receive(sp_decoder *dec, sp_frame *out) {
  memset(out, 0, sizeof(*out));
  int r = decoder_receive(&dec->common, &dec->d, out);
  if (r < 0) return r;
  if (r == RECV_FRAME) {
    dec->common.rejected_in_a_row = 0;
    return SP_OK;
  }
  return r == RECV_DRAINED ? SP_EOF : SP_AGAIN;
}

void sp_decoder_flush(sp_decoder *dec) {
  avcodec_flush_buffers(dec->d.av);
  av_frame_unref(dec->d.frame);
  dec->d.draining = 0;
  dec->d.done = 0;
  dec->common.rejected_in_a_row = 0;
}

uint64_t sp_decoder_skipped(const sp_decoder *dec) { return dec->common.skipped; }

/* libyuv, in the same archive; C linkage on every platform. Declared here so the shim needs no
 * libyuv headers (they pull C++ on some configurations). */
extern int I420ToNV12(const uint8_t *src_y, int src_stride_y, const uint8_t *src_u,
                      int src_stride_u, const uint8_t *src_v, int src_stride_v, uint8_t *dst_y,
                      int dst_stride_y, uint8_t *dst_uv, int dst_stride_uv, int width, int height);

int sp_i420_to_nv12(const sp_frame *frame, uint8_t *y, int y_stride, uint8_t *uv, int uv_stride) {
  if (frame->kind != SP_KIND_VIDEO) return SP_E_ARG;
  return I420ToNV12(frame->planes[0], frame->strides[0], frame->planes[1], frame->strides[1],
                    frame->planes[2], frame->strides[2], y, y_stride, uv, uv_stride, frame->width,
                    frame->height) == 0
             ? SP_OK
             : SP_E_ARG;
}
