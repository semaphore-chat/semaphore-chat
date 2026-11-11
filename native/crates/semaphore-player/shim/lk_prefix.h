/* LiveKit's Linux build renames every FFmpeg symbol in libwebrtc.a with an LK_ prefix
 * (build_linux.sh, llvm-objcopy --redefine-syms), so an app can link its own FFmpeg too.
 * Windows keeps the plain names. build.rs defines SP_LK_PREFIX on Linux. Every FFmpeg function
 * player.c calls must be listed here; a missing one is an undefined symbol at link time. */
#ifndef SEMAPHORE_PLAYER_LK_PREFIX_H
#define SEMAPHORE_PLAYER_LK_PREFIX_H

#define av_free LK_av_free
#define av_frame_alloc LK_av_frame_alloc
#define av_frame_free LK_av_frame_free
#define av_frame_unref LK_av_frame_unref
#define av_malloc LK_av_malloc
#define av_packet_alloc LK_av_packet_alloc
#define av_packet_free LK_av_packet_free
#define av_packet_unref LK_av_packet_unref
#define av_probe_input_buffer2 LK_av_probe_input_buffer2
#define av_read_frame LK_av_read_frame
#define av_rescale_q LK_av_rescale_q
#define av_sample_fmt_is_planar LK_av_sample_fmt_is_planar
#define avcodec_alloc_context3 LK_avcodec_alloc_context3
#define avcodec_find_decoder LK_avcodec_find_decoder
#define avcodec_free_context LK_avcodec_free_context
#define avcodec_open2 LK_avcodec_open2
#define avcodec_parameters_to_context LK_avcodec_parameters_to_context
#define avcodec_receive_frame LK_avcodec_receive_frame
#define avcodec_send_packet LK_avcodec_send_packet
#define avformat_alloc_context LK_avformat_alloc_context
#define avformat_close_input LK_avformat_close_input
#define avformat_find_stream_info LK_avformat_find_stream_info
#define avformat_open_input LK_avformat_open_input
#define avio_alloc_context LK_avio_alloc_context
#define avio_context_free LK_avio_context_free

#endif
