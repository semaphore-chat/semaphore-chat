#!/bin/sh
# Regenerates the player's test fixtures. The files are committed: tests read them, never this
# script. Needs an ffmpeg with libx264, libx265, libvpx, libaom, libtheora, libvorbis, libopus
# and libmp3lame, which the video rig's image has (scripts/desk/t1-video.sh builds it):
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

# The faststart MP4 cut inside its moov box: a known container that fails to open.
head -c 600 h264-aac.mp4 > truncated.mp4

ls -l
du -cb ./*.mp4 ./*.mov ./*.webm ./*.mkv ./*.avi ./*.ogv ./*.ogg ./*.mp3 ./*.wav ./*.flac ./*.m4a | tail -n 1
