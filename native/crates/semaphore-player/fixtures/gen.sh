#!/bin/sh
# Regenerates the player's test fixtures. The files are committed: tests read them, never this
# script. Needs an ffmpeg with libx264, libx265, libvpx, libaom, libtheora, libvorbis, libopus
# and libmp3lame, which the video rig's image has (scripts/desk/t1-video.sh builds it). That
# ffmpeg has no libfdk_aac, so it encodes AAC-LC only: the HE-AAC and AAC-Main refusal fixtures
# are made by relabelling LC headers (aac_fixtures.py), never by encoding those profiles.
#
#   NATIVE_IMAGE=semaphore-native-video:<tag> scripts/in-image.sh sh crates/semaphore-player/fixtures/gen.sh
#
# Every video is 64x64 at 10 fps for 2 s: the first second solid red, the second solid blue, so
# a decoded frame's colour says where it is. Audio is a 440 Hz sine, mono 48 kHz, 2 s next to
# video and 1 s alone. Expected values live in tests/fixtures.rs; after regenerating, rerun the
# tests and fix the table if an encoder changed.
set -eu
cd "$(dirname "$0")"
ff() { ffmpeg -hide_banner -loglevel error -y -bitexact "$@"; }

video='color=c=red:s=64x64:r=10:d=1[r];color=c=blue:s=64x64:r=10:d=1[b];[r][b]concat=n=2:v=1:a=0,format=yuv420p[v]'
tone() { echo "sine=frequency=440:sample_rate=48000:duration=$1"; }
av() { # <out> <audio seconds> <encoder args...>
  out=$1; secs=$2; shift 2
  ff -f lavfi -i "$(tone "$secs")" -filter_complex "$video" -map '[v]' -map 0:a "$@" "$out"
}

x264='-c:v libx264 -preset veryslow -crf 30 -g 10 -x264-params log-level=none'
aac='-c:a aac -b:a 24k'

# shellcheck disable=SC2086 # the codec argument strings split on purpose
{
  av h264-aac.mp4 2 $x264 $aac -movflags +faststart
  av h264-aac-moov-at-end.mp4 2 $x264 $aac
  av h264-aac.mov 2 $x264 $aac
  av vp8-vorbis.webm 2 -c:v libvpx -b:v 40k -g 10 -c:a libvorbis -q:a 0
  av vp9-opus.webm 2 -c:v libvpx-vp9 -crf 50 -b:v 0 -g 10 -c:a libopus -b:a 16k
  av av1-opus.mkv 2 -c:v libaom-av1 -cpu-used 8 -crf 55 -g 10 -c:a libopus -b:a 16k
  # Containers and codecs the player refuses: no AVI demuxer, no HEVC or Theora decoder.
  av mpeg4-mp3.avi 2 -c:v mpeg4 -q:v 20 -c:a libmp3lame -b:a 32k
  av hevc-aac.mp4 2 -c:v libx265 -preset medium -crf 35 -x265-params log-level=none $aac
  av theora-vorbis.ogv 2 -c:v libtheora -q:v 1 -c:a libvorbis -q:a 0

  ff -f lavfi -i "$(tone 1)" -c:a libvorbis -q:a 0 vorbis.ogg
  ff -f lavfi -i "$(tone 1)" -c:a libopus -b:a 16k opus.ogg
  ff -f lavfi -i "$(tone 1)" -c:a libmp3lame -b:a 32k sine.mp3
  ff -f lavfi -i "$(tone 1)" -ar 16000 -c:a pcm_s16le sine.wav
  ff -f lavfi -i "$(tone 1)" -c:a flac sine.flac
  ff -f lavfi -i "$(tone 1)" $aac sine.m4a
}

# The refusal fixtures (aac_fixtures.py): both carry LC payloads under headers that say otherwise,
# because the player must refuse them on the header or config alone.
# - h264-aac-he.mp4: h264-aac.mp4's AudioSpecificConfig relabelled AAC-LC -> explicit HE-AAC (AOT
#   5, SBR announced). The MP4's box sizes are unchanged (the config keeps its byte length).
# - ts/h264-aac-main.ts: 2 s the same red/blue video with ADTS frames whose header profile field
#   says Main (object type 1) instead of LC, muxed into MPEG-TS as egress would.
python3 aac_fixtures.py mp4-he h264-aac.mp4 h264-aac-he.mp4

# The faststart MP4 cut inside its moov box: a known container that fails to open.
head -c 600 h264-aac.mp4 > truncated.mp4

# The replay preview (src/ts.rs, src/segments.rs): an HLS cut into three 10 s MPEG-TS segments,
# as the backend serves the replay buffer (H.264 and stereo AAC, timestamps continuing across
# segments). Segment 0 is red with a 440 Hz tone, 1 green with 660 Hz, 2 blue with 880 Hz; a
# keyframe every 2 s. Then segment 1 as 192-byte M2TS packets (LiveKit egress's HDMV-style TS,
# which the backend serves unremuxed when its remux fails), and 2 s of H.264 with Opus in TS (a
# stream the player reports and refuses).
mkdir -p ts
tsv='color=c=red:s=64x64:r=10:d=10[r];color=c=green:s=64x64:r=10:d=10[g];color=c=blue:s=64x64:r=10:d=10[b];[r][g][b]concat=n=3:v=1:a=0,format=yuv420p[v]'
tsa='sine=frequency=440:sample_rate=48000:duration=10[a0];sine=frequency=660:sample_rate=48000:duration=10[a1];sine=frequency=880:sample_rate=48000:duration=10[a2];[a0][a1][a2]concat=n=3:v=0:a=1,pan=stereo|c0=c0|c1=c0[a]'
gop='-g 20 -keyint_min 20 -sc_threshold 0'
# shellcheck disable=SC2086
ff -filter_complex "$tsv;$tsa" -map '[v]' -map '[a]' $x264 $gop -c:a aac -b:a 32k \
  -f hls -hls_time 10 -hls_list_size 0 -hls_segment_type mpegts \
  -hls_segment_filename 'ts/seg%d.ts' ts/playlist.m3u8
rm ts/playlist.m3u8
ff -i ts/seg1.ts -map 0 -c copy -copyts -f mpegts -mpegts_m2ts_mode 1 ts/seg1-m2ts.ts
# shellcheck disable=SC2086
ff -filter_complex 'color=c=red:s=64x64:r=10:d=2,format=yuv420p[v];sine=frequency=440:sample_rate=48000:duration=2[a]' \
  -map '[v]' -map '[a]' $x264 -c:a libopus -b:a 16k -f mpegts ts/h264-opus.ts
# The Main-profile ADTS TS: an LC encode, its ADTS headers relabelled.
lc="$(mktemp -d)"
ff -f lavfi -i "$(tone 2)" -c:a aac -b:a 24k -f adts "$lc/lc.aac"
python3 aac_fixtures.py adts-profile "$lc/lc.aac" "$lc/main.aac" main
# shellcheck disable=SC2086
ff -i "$lc/main.aac" -filter_complex "$video" -map '[v]' -map 0:a $x264 -c:a copy -f mpegts ts/h264-aac-main.ts
rm -rf "$lc"
ls -l ts

ls -l
du -cb ./*.mp4 ./*.mov ./*.webm ./*.mkv ./*.avi ./*.ogv ./*.ogg ./*.mp3 ./*.wav ./*.flac ./*.m4a | tail -n 1
