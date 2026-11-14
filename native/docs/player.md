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

**What plays:** MP4, MOV and M4A with H.264 and AAC (AAC-LC only, below); WebM and MKV with VP8,
VP9 or AV1 and Vorbis or Opus; Ogg Vorbis and Opus; MP3; WAV; FLAC. That is Chromium's set. **What doesn't:** AVI (no
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
- **The AAC decoder already ships**, as unreachable code until the player uses it. It decodes in
  every shipped build now (the `aac` feature is on by default); it only ever decodes AAC-LC.
- What the player adds is the demuxer side (libavformat and the seven demuxers), the shim and
  its Rust.

## AAC: LC only, in every shipped build

Owner decision (2026-11-13): AAC decoding ships enabled, restricted to the AAC-LC profile. The
decoder is FFmpeg's native one (already linked, above), which also carries HE-AAC's SBR and PS and
turns them on by itself when a stream carries them implicitly. Only AAC-LC may decode: it is the
profile whose patents have mostly expired, while HE-AAC's (2003) run longer (below).

**Features.** `semaphore-player`'s `aac` feature is a default feature, and `semaphore-app`'s
`player` enables it (`semaphore-player/aac`). The packaged builds pass `--features player`
(`scripts/package-linux.sh`, `native-package.yml`'s Windows job), so the Linux packages, the
Windows zip and the installer all decode AAC-LC. The player without AAC still exists for tests and
is how the refusal paths are proven: `cargo test -p semaphore-player --no-default-features` (Linux
in `scripts/verify.sh`, Windows in `native-spike.yml`). `player-aac` is gone.

**Where it is enforced** (four layers, so no path reaches the decoder unchecked):

| Path | Check | Where |
|---|---|---|
| ADTS in the replay buffer's MPEG-TS | Every frame's header must say profile LC (object type 2). Otherwise the stream is listed as audio, `enable` returns `Error::UnsupportedCodec` (exactly as Opus-in-TS), and the video plays. Each segment loaded later is scanned the same way, and a stream that turns bad mid-play has its decoder dropped. | `src/ts.rs` (`AdtsHeader::is_lc`), `src/segments.rs` (`adts_units_lc`, `note_aac_profiles`, `enable`) |
| Any demuxed container (MP4/M4A/MOV, MKV, raw ADTS) | The demuxer's extradata is the `AudioSpecificConfig`. It is hand-parsed: object type 2 only, no explicit SBR/PS — object types 5 and 29, the 0x2b7 sync extension announcing SBR, and the 0x548 one announcing PS are all refused, as is anything truncated or reserved. A raw ADTS file has no config; the demuxer's profile, when it has one, is checked instead. | `src/aac.rs` (`parse`, `Config::is_plain_lc`), `src/lib.rs` (`FfmpegMedia::check_aac_config`) |
| After the decoder opens | The decoder's profile must be LC, or not decided yet. | `sp_stream_profile` / `sp_decoder_profile` in the shim, checked in `FfmpegMedia::enable` and `SegmentedMedia::enable` |
| Every decoded AAC frame | The decoder's profile must still be LC and the frame's rate must equal the stream header's (an SBR stream doubles it, and FFmpeg sets profile HE-AAC/HE-AACv2 implicitly on the first SBR frame). Otherwise the frame is discarded, the stream is stopped, and the player reports unsupported audio: `Media::refused_audio()` reaches the engine, which drops the sound, tells the UI (`Metadata` with `has_audio: false`) and plays the video on the wall clock. The soundboard's `decode_audio` returns `UnsupportedCodec`. | `src/aac.rs` (`decoder_is_lc`), `src/lib.rs`, `src/segments.rs`, `src/engine.rs` (`stop_refused_audio`), `src/decode.rs` |

The shim's FFmpeg API has no "do not apply SBR" switch reachable through libavcodec (SBR is part
of the decoder's profile selection), so the policy is enforced around it: refuse the config, stop
the decoder, and drop its frames. An ADTS header can only say Main, LC, SSR or LTP, so a stream
carrying implicit SBR looks like LC until its first SBR frame; that is what the per-frame check is
for.

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
  HE-AAC (2003) ones run longer. The decoder is in the binary already (above); it decodes now, and
  only the LC profile (the owner's decision, above).
- **MP3:** the last patents expired in 2017.
- **VP8, VP9, AV1, Opus, Vorbis, FLAC:** published royalty-free (Google's VP8/VP9 grants, the AOM
  licence for AV1, the Opus IPR declarations). Sisvel runs pools claiming VP9 and AV1 patents;
  nobody we know of pays them for software decoders.
- **The OS route** (Media Foundation on Windows) would put the H.264/AAC licence on Microsoft, but
  N editions lack it and Linux has nothing equivalent; not taken (above).

## The spike (build-order step 1)

- `crates/semaphore-player`: the shim, `build.rs` with the `args.gn` and component checks, and a
  Rust API: `Media::open(Read + Seek)`, `streams()`, `duration()`, `enable(stream)`,
  `next_frame()` giving 8-bit I420 video or interleaved `f32` audio. Feature `aac`, on by default.
- `semaphore-app` feature `player`, which enables `aac`, **off by default in the crate**. The
  packaged builds turn it on (above). With it off the crate is not in the app's dependency graph
  and the release binary is byte-for-byte unchanged (below).
- Fixtures: `crates/semaphore-player/fixtures/`, made by `fixtures/gen.sh` in the video rig's
  image: 64x64, 10 fps, 2 s, red then blue, with a 440 Hz tone. Plus the AAC refusal fixtures:
  `h264-aac-he.mp4` (an MP4 whose config says explicit HE-AAC) and `ts/h264-aac-main.ts` (ADTS
  headers saying AAC Main), both made by `fixtures/aac_fixtures.py` from LC encodes, since the
  image's ffmpeg (no libfdk_aac) cannot encode either profile. The player's tests read the files,
  never the scripts.
- Tests (`tests/fixtures.rs`, `tests/segments.rs`): every playable fixture opens from memory with
  its container, duration, streams and codecs; decodes exactly 20 video frames with rising
  timestamps, first red and last blue; audio has the right rate, sample count and 880 zero
  crossings a second. An LC stream plays with sound in MP4 (`h264-aac.mp4`) and in TS
  (`fixtures/ts/seg0.ts`); the explicit HE-AAC MP4 and the Main-profile TS are
  `UnsupportedCodec` for the audio while the video plays. The truncated MP4 is `Invalid`, the AVI
  `UnsupportedContainer`, plain text `UnsupportedContainer`; HEVC and Theora `UnsupportedCodec`
  while Theora's Vorbis still plays; a media moves to another thread. `src/aac_tests.rs` covers
  the AudioSpecificConfig parser bit by bit (escapes, PCE, both sync extensions, truncated,
  reserved and hostile inputs) and the per-frame decision (LC at the header's rate, HE/HEv2,
  doubled rate). Run on Linux in the image with and without `aac`, and on Windows in
  `windows-link`.
- **What is not covered by a fixture**: no encoder in the toolchain writes implicit SBR (FFmpeg's
  native AAC encoder is LC-only; HE-AAC needs libfdk_aac, absent), so the implicit-SBR runtime
  path is covered by the `aac::decoder_is_lc` unit tests and the code path above, not by a
  committed HE-AAC ADTS stream. The header-level refusals have real fixtures.

### Size (measured 2026-11-11, Linux x86_64, in the build image)

The method from [size.md](size.md): one target directory, `cargo build --locked --release` and
`--profile dist` of `-p semaphore-app`, compressed with `xz -T1 -6`. "On" is the player
(`--features player`, then called `player-aac`: AAC now comes with it) plus a temporary `main.rs`
hook (not committed) that calls `open_bytes`, `streams`, `enable` and
`next_frame`, so the linker keeps everything the player will reach; without a caller the
crate isn't linked at all. Bytes, MB = 10^6:

| Build | Raw | xz -6 | sha256 (first 16) |
|---|---:|---:|---|
| `release`, before (`48508690`) | 82,747,824 | 21,783,532 | `3affa7f23e5da168` |
| `release`, feature off (this commit) | 82,747,824 | 21,783,532 | `3affa7f23e5da168` |
| `release`, player (AAC) on | 83,218,992 | 21,978,220 | `27d6686d45977292` |
| `dist`, before | 67,843,088 | 20,082,248 | `e9971cfeb232333a` |
| `dist`, feature off | 67,843,088 | 20,082,248 | `e9971cfeb232333a` |
| `dist`, player (AAC) on | 68,312,208 | 20,276,664 | `8b340c1e0d458b1f` |

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

Not in this round: the feature on by default.

## The replay preview's segments (W14, lane 1)

The trim preview plays the replay buffer's HLS (`GET /livekit/replay/preview/playlist.m3u8`,
segments of MPEG-TS with H.264 and AAC, `#EXTINF:10.0` each). The FFmpeg here has no MPEG-TS
demuxer, so:

- **`src/ts.rs`** demuxes by hand: 188- or 192-byte (M2TS, LiveKit egress's "HDMV-style")
  packets found by sync spacing, PAT and PMT with CRC-32, PES with 33-bit PTS/DTS, ADTS frames
  split and timed. H.264 (0x1B) and AAC (0x0F) are read; Opus in TS (0x06 with an `Opus`
  registration) and anything else is listed and refused. A continuity gap drops the PES it broke.
- **The shim's `sp_decoder`** decodes those units with the same FFmpeg decoders (Annex B H.264,
  ADTS AAC, parameters in band). AAC-LC decodes (in every shipped build, above); a segment whose
  ADTS profile is not LC is audio this player refuses, so the preview is video only.
- **`src/segments.rs`** (`Media::open_segments`, or `Opened::Segments` from an `Opener`): segment
  `i` starts at the sum of the `#EXTINF` lengths before it and time inside it counts from its
  first video PTS, the model the backend captures with. A seek decodes from the segment's last
  keyframe at or before the target. Segments come through `SegmentFetch` (the app's will call
  `Core::replay_segment`), retried 3 times for transient failures, the next one prefetched, kept
  in a 64 MiB cache; the opened segment is fetched first, so opening at the selection's start
  doesn't fetch the buffer's beginning.
- **Fixtures**: `fixtures/ts/` (gen.sh): three 10 s segments cut by ffmpeg's HLS muxer (red, green,
  blue; 440, 660, 880 Hz; a keyframe every 2 s), segment 1 again as M2TS, and H.264 with Opus.
- **Core and the app (lane 2):** `PlaybackSource` is an enum, `Attachment(AttachmentSource)` (the
  old struct, renamed) or `ReplayBuffer { session_id, segments, start }`. The app's opener plays
  the latter as `Opened::Segments`: an empty `segments` is listed on the player's thread
  (`Core::replay_preview`), each segment fetched by `CoreSegments` through
  `Core::fetch_replay_segment` (no answer, 5xx, 429: `Transient`; a refusal: `Failed`; a cancelled
  player: `Cancelled`). `semaphore_core::player::selection_step` is the web's end-of-selection
  rule (within 0.1 s of the end: loop to the start, or pause). The fake server serves these
  fixtures as the preview's segments (`fixtures/replay/`, segment `i` is fixture `i % 3`).
- **The trim preview (lane 3):** `semaphore_ui::replay::TrimPreview` above the capture dialog's
  trim timeline, only while the trim is shown and the window has `Players` (the app's `player`
  feature). It opens paused at the selection's start; the web's controls (jump to start,
  play/pause, play selection from start, jump to end less 1 s, Loop off at first, Refresh
  segments); `selection_step` on every position while playing. The timeline draws the playhead; a
  press on a handle drags it, anywhere else seeks; a start dragged past the playhead takes it
  along; Refresh reopens the preview at the playhead with the newest playlist. States: loading,
  "Could not load the video preview. Please try again." with Retry, and "Video only" only when
  the recording has no sound this player can decode (no audio track, or unsupported audio such as
  a non-LC AAC profile); the wording is the web's. Stories `replay-preview-*` (`rigs/shot/
  scripts/w14-trim-preview.steps`); `rigs/slice/scripts/voice-w4.steps` plays it against the fake
  server's segments and asserts the sound is heard on the virtual speaker.
- **Not verified yet** against a segment LiveKit egress wrote (raw and remuxed), nor which audio
  codec egress uses when it falls back to its `H264_1080P_30` preset.

## In the app (W3-player-wire)

- **Who owns a player:** the message list a row is in (`semaphore_ui::player::ListPlayers`, keyed
  by message and file). Rows are drawn by functions, so the player entity lives in the list and
  survives re-rendering and virtualising. It goes, and playback stops, when its message leaves the
  list (deleted, removed by a moderator, a reset) or the list goes (a channel switch). Idle players
  not drawn lately are pruned once a list holds more than 32.
- **The window's `Players`** (built by `semaphore-app/src/player.rs`) holds the engine opener, the
  window's `VideoFrames` and a weak handle to every player; a sign-out calls `stop_all`. One
  playing at a time is the engine's `Exclusive` rule across every list, threads and DMs included.
- **Which attachments play:** audio or video whose type or extension is in Chromium's set
  (`semaphore_core::player::playable`), on a message that isn't removed. The rest keep today's
  rows; a file that only fails once opened (HEVC in a MOV) shows the player's "Can't play this
  here" with Download and Open externally (a temporary copy handed to the OS).
- **Feature off** (the default): no `Players`, and every attachment renders as before.
- **Sound** goes through the app's `AudioIo`: the rig's virtual speaker in rigs, never the host's
  devices. `scripts/in-image.sh scripts/slice-e2e.sh --player` runs
  `rigs/slice/scripts/w3-player-wire.steps` against the fake server's Range responses.
- **Not yet:** the voice settings' output device isn't passed to the players
  (`DesktopPlayers::set_output_device`), and the video poster before the first play is the plain
  box (the first decoded frame shows once opened). Buffering is reported only once a slow read returns,
because the decode thread does the reading.
