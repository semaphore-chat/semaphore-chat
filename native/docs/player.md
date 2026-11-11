# Attachment player: decoders, licences and patents

Unit W3-player ([parity-plan.md](parity-plan.md)). This page records why the player decodes with
what it does, what that means for the two licence editions and for codec patents, and the spike's
measurements. Build-order step 1 (the gated spike) is done; the state machine, decode thread,
fetching and UI are not started.

## The decision: the FFmpeg that libwebrtc already carries

LiveKit's prebuilt libwebrtc (`webrtc-a545de4`, linked statically by `webrtc-sys`) is built with
`rtc_use_h264 = true` and `ffmpeg_branding = "Chrome"`. For its H.264 decoder that pulls in
Chromium's FFmpeg in the "Chrome" configuration, which is the media stack Chrome and Electron play
attachments with. Read from the archive and its headers (`llvm-nm`, `args.gn`,
`include/third_party/ffmpeg/chromium/config/Chrome/linux/x64/config_components.h`):

| | |
|---|---|
| Version | libavformat 62.17, libavcodec 62.33 (FFmpeg 8.x), Chromium's fork |
| Licence | `FFMPEG_LICENSE "LGPL version 2.1 or later"`, `CONFIG_GPL 0`, `CONFIG_NONFREE 0` |
| Demuxers | mov (MP4, MOV, M4A), matroska (MKV, WebM), ogg, wav, flac, mp3, aac (ADTS) |
| Decoders | h264, aac (incl. USAC), mp3, vorbis, flac, libopus, pcm (u8, s16le/be, s24le/be, s32le, f32le, alaw, mulaw) |
| Not there | swscale, swresample, any MPEG-TS, AVI, HEVC, Theora, MPEG-4 Part 2 support |
| Symbols | Linux: every FFmpeg symbol renamed `LK_...` by LiveKit's `build_linux.sh` (`llvm-objcopy --redefine-syms`) so an app can link its own FFmpeg too. Windows (`build_windows.cmd`, same args): plain names. Android: `rtc_use_h264 = false`, no FFmpeg |

VP8 and VP9 decode with the archive's libvpx, AV1 with its dav1d, both through their C APIs.
`crates/semaphore-player` wraps all of it in a small C shim (`shim/player.c`, compiled by its
`build.rs` against the prebuilt's headers), so Rust never sees FFmpeg's structs.

**What plays:** MP4, MOV and M4A with H.264 and AAC; WebM and MKV with VP8, VP9 or AV1 and Vorbis
or Opus; Ogg Vorbis and Opus; MP3; WAV; FLAC. That is Chromium's set. **What doesn't:** AVI (no
demuxer: `UnsupportedContainer`), HEVC (the iPhone camera's default) and Theora (no decoder:
`UnsupportedCodec`, other streams still play). Chrome and Electron refuse the same, except HEVC
where a hardware decoder exists. Owner decision (2026-11-11): these show "can't play this here"
with Download and Open externally; no Media Foundation path.

`build.rs` fails the build, loudly, if a LiveKit bump drops `rtc_use_h264 = true`, the Chrome
branding, or any demuxer or decoder in its list. On a bump, rerun the player tests on Linux and the
`windows-link` CI job (which runs them on Windows), and check the prefix still covers every
function in `shim/lk_prefix.h`: a missing one is an undefined `LK_...` symbol at link time.

## Already in the shipped app (verified 2026-11-11)

libwebrtc's `h264_decoder_impl.o` calls `avcodec_find_decoder`, which references FFmpeg's whole
decoder table, so the linker keeps **every** decoder of that configuration. The current app
binary (an unstripped debug build of `semaphore-app`) defines `LK_ff_h264_decoder`,
`LK_ff_aac_decoder`, `LK_ff_mp3_decoder`, `LK_ff_vorbis_decoder`, `LK_ff_flac_decoder`,
`LK_ff_libopus_decoder` and the PCM decoders. No demuxer is linked yet. So:

- **LGPL FFmpeg code is statically linked into the app today**, about 2 MB of it
  ([size.md](size.md) section 1, "ffmpeg: H.264 decoder"). `cargo deny` can't see it: it is inside
  the prebuilt archive of `webrtc-sys`, whose crate licence is Apache-2.0. This is true whatever
  the player does.
- **The AAC decoder already ships**, as unreachable code until the player uses it. The `aac`
  feature of `semaphore-player` decides whether the player decodes AAC, not whether the bytes are
  in the binary.
- What the player adds is the demuxer side (libavformat and the seven demuxers), the shim and
  its Rust.

## What each licence edition needs (owner question)

FFmpeg here is LGPL-2.1-or-later, statically linked. LGPL-2.1 section 6 allows static linking of
a "work that uses the Library" if the recipient can relink it with a modified copy of the library.
In practice, for each binary we distribute:

| Obligation | AGPL edition | Commercial edition |
|---|---|---|
| Give the FFmpeg source we ship (Chromium's FFmpeg at the revision LiveKit's `webrtc-a545de4` pins), or a written offer for it, with our build instructions | needed | needed |
| Ship the LGPL text and a notice that the app contains FFmpeg (an "about / licences" screen plus a file in the package) | needed | needed |
| Let users relink with a modified FFmpeg | met by the AGPL source of the whole app plus `LK_CUSTOM_WEBRTC` (webrtc-sys builds against any libwebrtc build) | **not met by default.** Options: ship the app's object files or a relinkable static archive with the commercial package (section 6a); or move FFmpeg into a separate shared library loaded at runtime (section 6b), which means a custom libwebrtc build without FFmpeg plus our own LGPL FFmpeg `.so`/`.dll`; or replace the H.264 decoder and drop the player's use of FFmpeg |
| No terms forbidding reverse engineering for debugging those modifications (section 6) | AGPL already allows it | the commercial EULA must allow it for the FFmpeg part |

None of this is legal advice; it is the reading the owner asked to be written down so counsel can
check it. The question is the same with or without the player, because the H.264 decoder already
links FFmpeg statically.

## Codec patents (recollection, not legal advice)

Nothing here was checked against a source in this work; treat it as a list of questions for counsel.

- **H.264 (AVC):** licensed through the Via LA pool (formerly MPEG LA), per unit of an end product
  that contains a decoder or encoder, with a free tier for the first units each year. The app
  already ships an H.264 decoder (for peers who publish H.264), so the player adds a use, not a new
  decoder. The last pool patents expire around 2027 to 2030, varying by country.
- **AAC:** a separate Via LA pool, also per unit. Many AAC-LC patents (1997 standard) have expired;
  HE-AAC (2003) ones run longer. The decoder is in the binary already (above); decoding with it is
  behind the `aac` feature until the owner decides.
- **MP3:** the last patents expired in 2017.
- **VP8, VP9, AV1, Opus, Vorbis, FLAC:** published royalty-free (Google's VP8/VP9 grants, the AOM
  licence for AV1, the Opus IPR declarations). Sisvel runs pools claiming VP9 and AV1 patents;
  nobody we know of pays them for software decoders.
- **The OS route** (Media Foundation on Windows) would put the H.264/AAC licence on Microsoft, but
  N editions lack it and Linux has nothing equivalent; not taken (above).

## The spike (build-order step 1)

- `crates/semaphore-player`: the shim, `build.rs` with the `args.gn` and component checks, and a
  Rust API: `Media::open(Read + Seek)`, `streams()`, `duration()`, `enable(stream)`,
  `next_frame()` giving 8-bit I420 video or interleaved `f32` audio. Feature `aac`.
- `semaphore-app` feature `player` (plus `player-aac`), **off by default**. With it off the crate
  is not in the app's dependency graph and the release binary is byte-for-byte unchanged (below).
- Fixtures: `crates/semaphore-player/fixtures/`, made by `fixtures/gen.sh` in the video rig's
  image: 64x64, 10 fps, 2 s, red then blue, with a 440 Hz tone; 16 files, 167 KB.
- Tests (`tests/fixtures.rs`): every playable fixture opens from memory with its container,
  duration, streams and codecs; decodes exactly 20 video frames with rising timestamps, first red
  and last blue; audio has the right rate, sample count and 880 zero crossings a second. The
  truncated MP4 is `Invalid`, the AVI `UnsupportedContainer`, plain text `UnsupportedContainer`;
  HEVC and Theora `UnsupportedCodec` while Theora's Vorbis still plays; a media moves to another
  thread. Run on Linux in the image, with and without `aac`, and on Windows in `windows-link`.

### Size (measured 2026-11-11, Linux x86_64, in the build image)

The method from [size.md](size.md): one target directory, `cargo build --locked --release` and
`--profile dist` of `-p semaphore-app`, compressed with `xz -T1 -6`. "On" is `--features player-aac`
plus a temporary `main.rs` hook (not committed) that calls `open_bytes`, `streams`, `enable` and
`next_frame`, so the linker keeps everything the player will reach; without a caller the
crate isn't linked at all. Bytes, MB = 10^6:

| Build | Raw | xz -6 | sha256 (first 16) |
|---|---:|---:|---|
| `release`, before (`48508690`) | 82,747,824 | 21,783,532 | `3affa7f23e5da168` |
| `release`, feature off (this commit) | 82,747,824 | 21,783,532 | `3affa7f23e5da168` |
| `release`, `player-aac` on | 83,218,992 | 21,978,220 | `27d6686d45977292` |
| `dist`, before | 67,843,088 | 20,082,248 | `e9971cfeb232333a` |
| `dist`, feature off | 67,843,088 | 20,082,248 | `e9971cfeb232333a` |
| `dist`, `player-aac` on | 68,312,208 | 20,276,664 | `8b340c1e0d458b1f` |

- **Off is byte-for-byte unchanged** in both profiles (same sha256), though cargo rebuilt
  `semaphore-app` for its manifest change.
- **On costs +0.47 MB raw and +0.19 MB compressed** (release +471,168 / +194,688 bytes; dist
  +469,120 / +194,416), against the spike's gate of +1.5 MB raw and the owner's budget of +1 MB
  compressed. That is libavformat with its seven demuxers, the shim and its Rust; the decoders
  were linked already. Below the design's estimate (+0.9 to 1.2 MB raw for FFmpeg alone), because
  most of the archive's other FFmpeg objects were already in the app.
- `player` without AAC would be the same size: the AAC decoder is linked either way (above).
- The measured binary decodes the fixtures: `SEMAPHORE_PLAYER_PROBE=<fixture> semaphore-app` via
  the temporary hook gave non-zero results for H.264+AAC, VP9+Opus, AV1+Opus and M4A, and 0
  (refused) for the AVI.

## Steps 2 to 4: the player behind core's traits

- **`semaphore-core::player`** (UI-free, checked for Android and iOS): `PlaybackSource`, the
  `MediaPlayer` and `PlayerFactory` traits, the pure state machine (`Machine`: commands and
  decoder signals in, effects out), `AudioClock`, `WallClock`, `frame_action` and `Exclusive`
  (one player at a time). Not in `semaphore-ffi` yet: a platform player on mobile needs UniFFI
  callback interfaces for these traits, whose shape the mobile work should choose.
- **`semaphore-player::DesktopPlayers`**: a thread per player. Audio is resampled to 48 kHz
  (windowed sinc, `resample.rs`), cut to mono or stereo, queued in an `rtrb` ring for
  `AudioIo::open_output_channels` (new: a channel count on the output seam; the default mixes
  down, `cpal_io` maps stereo channel for channel, calls stay on mono `open_output`). Video is
  converted to NV12 by libyuv into a 3-frame queue and handed to a `VideoSink` (the UI adapts
  GPUI's `VideoUploader` and a `VideoSurfaceId` to it) when the audio clock reaches it, dropped
  when more than a frame late. A seek has a generation: the ring is flushed by the output
  callback acknowledging it, frames before the target are dropped, and the landing frame shows
  even when paused. The first frame shows as the poster on open. Dropping a `Player` cancels
  its reads, stops its thread and removes its surface. The output device stays open while
  paused.
- **Corrupt data**: a packet a decoder rejects is skipped and counted (64 in a row is an error);
  an empty packet is ignored (dav1d refuses them).
- **FFmpeg logging is left alone**: `av_log_set_callback` and `av_log_set_level` are one
  process-wide setting, shared with libwebrtc's H.264 decoder, so the player can't route its
  own messages without changing libwebrtc's. FFmpeg's default prints warnings to stderr (for
  example "Protocol name not provided" for custom I/O).
- **`semaphore-player::range`**: `RangeSource` reads 1 MiB blocks with `Range` through
  `HttpBackend::file_range` (bearer token, one refresh on a refused token, as every call), four
  blocks ahead, 3 retries with backoff for network errors, 5xx and 429, none for the rest. The
  `BlockCache` is memory only: 16 MiB per player, 32 MiB in all, least recently used out
  first, freed when a player goes. `http_opener` puts it behind `DesktopPlayers`.
- **The fake server** answers `Range` on `GET /api/file/{id}` as the backend does (206 with
  `Content-Range`, 416 with `bytes */size`).

Not in this round: the UI (`ui/src/player`), the app wiring, HLS (the replay preview's
MPEG-TS), and the feature on by default. Buffering is reported only once a slow read returns,
because the decode thread does the reading.
