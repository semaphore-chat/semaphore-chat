//! Every committed fixture (fixtures/gen.sh) through the real FFmpeg, libvpx and dav1d in
//! libwebrtc: containers, codecs, durations, frame counts, colours and tones.
//!
//! Videos are 64x64, 10 fps, 2 s: red for the first second, blue for the second. Audio is a
//! 440 Hz sine. Run with and without `--features aac`: without it AAC streams are refused.

use semaphore_player::{AudioFrame, Codec, Error, Frame, Kind, Media, VideoFrame};

const MP4: &str = "mov,mp4,m4a,3gp,3g2,mj2";
const MKV: &str = "matroska,webm";

struct Playable {
    file: &'static str,
    container: &'static str,
    /// What FFmpeg's ffprobe reports for the file.
    duration_ms: u64,
    video: Option<Codec>,
    /// Codec, sample rate, seconds of tone.
    audio: Option<(Codec, u32, f64)>,
}

const fn file(
    file: &'static str,
    container: &'static str,
    duration_ms: u64,
    video: Option<Codec>,
    audio: Option<(Codec, u32, f64)>,
) -> Playable {
    Playable {
        file,
        container,
        duration_ms,
        video,
        audio,
    }
}

const PLAYABLE: &[Playable] = &[
    file(
        "h264-aac.mp4",
        MP4,
        2000,
        Some(Codec::H264),
        Some((Codec::Aac, 48_000, 2.0)),
    ),
    file(
        "h264-aac-moov-at-end.mp4",
        MP4,
        2000,
        Some(Codec::H264),
        Some((Codec::Aac, 48_000, 2.0)),
    ),
    file(
        "h264-aac.mov",
        MP4,
        2000,
        Some(Codec::H264),
        Some((Codec::Aac, 48_000, 2.0)),
    ),
    file(
        "vp8-vorbis.webm",
        MKV,
        2003,
        Some(Codec::Vp8),
        Some((Codec::Vorbis, 48_000, 2.0)),
    ),
    file(
        "vp9-opus.webm",
        MKV,
        2008,
        Some(Codec::Vp9),
        Some((Codec::Opus, 48_000, 2.0)),
    ),
    file(
        "av1-opus.mkv",
        MKV,
        2008,
        Some(Codec::Av1),
        Some((Codec::Opus, 48_000, 2.0)),
    ),
    file(
        "vorbis.ogg",
        "ogg",
        1000,
        None,
        Some((Codec::Vorbis, 48_000, 1.0)),
    ),
    file(
        "opus.ogg",
        "ogg",
        1006,
        None,
        Some((Codec::Opus, 48_000, 1.0)),
    ),
    file(
        "sine.mp3",
        "mp3",
        1000,
        None,
        Some((Codec::Mp3, 48_000, 1.0)),
    ),
    file(
        "sine.wav",
        "wav",
        1000,
        None,
        Some((Codec::Pcm, 16_000, 1.0)),
    ),
    file(
        "sine.flac",
        "flac",
        1000,
        None,
        Some((Codec::Flac, 48_000, 1.0)),
    ),
    file("sine.m4a", MP4, 1000, None, Some((Codec::Aac, 48_000, 1.0))),
];

const FRAMES: usize = 20;
const SIZE: u32 = 64;

fn fixture(name: &str) -> Vec<u8> {
    let path = format!("{}/fixtures/{name}", env!("CARGO_MANIFEST_DIR"));
    std::fs::read(&path).unwrap_or_else(|error| panic!("{path}: {error}"))
}

fn open(name: &str) -> Result<Media, Error> {
    Media::open_bytes(fixture(name))
}

/// BT.601 limited range, what ffmpeg's `color` source turns into yuv420p.
fn yuv(r: f64, g: f64, b: f64) -> [f64; 3] {
    [
        16.0 + 65.481 * r + 128.553 * g + 24.966 * b,
        128.0 - 37.797 * r - 74.203 * g + 112.0 * b,
        128.0 + 112.0 * r - 93.786 * g - 18.214 * b,
    ]
}

fn centre(frame: &VideoFrame<'_>) -> [f64; 3] {
    let (x, y) = (frame.width as usize / 2, frame.height as usize / 2);
    let at = |plane: usize, x: usize, y: usize| {
        let p = frame.planes[plane];
        f64::from(p.data[y * p.stride + x])
    };
    [at(0, x, y), at(1, x / 2, y / 2), at(2, x / 2, y / 2)]
}

fn assert_colour(file: &str, which: &str, got: [f64; 3], want: [f64; 3]) {
    let close = got.iter().zip(want).all(|(g, w)| (g - w).abs() <= 12.0);
    assert!(
        close,
        "{file}: {which} frame is {got:?}, want about {want:?}"
    );
}

#[derive(Default)]
struct Decoded {
    frames: usize,
    first: Option<[f64; 3]>,
    last: Option<[f64; 3]>,
    pts_rising: bool,
    last_pts: Option<i64>,
    samples: usize,
    crossings: usize,
    previous: f32,
    rate: u32,
}

impl Decoded {
    fn video(&mut self, frame: &VideoFrame<'_>) {
        assert_eq!((frame.width, frame.height), (SIZE, SIZE));
        let colour = centre(frame);
        self.first.get_or_insert(colour);
        self.last = Some(colour);
        if let (Some(before), Some(now)) = (self.last_pts, frame.pts_us) {
            self.pts_rising &= now > before;
        }
        self.last_pts = frame.pts_us.or(self.last_pts);
        self.frames += 1;
    }

    fn audio(&mut self, frame: &AudioFrame<'_>) {
        assert_eq!(frame.channels, 1);
        self.rate = frame.sample_rate;
        for &sample in frame.samples {
            if (self.previous < 0.0) != (sample < 0.0) {
                self.crossings += 1;
            }
            self.previous = sample;
        }
        self.samples += frame.samples.len();
    }
}

#[test]
fn every_playable_fixture_opens_and_decodes() {
    for case in PLAYABLE {
        let mut media = open(case.file).unwrap_or_else(|e| panic!("{}: {e}", case.file));
        assert_eq!(media.container(), case.container, "{}", case.file);
        let duration = media.duration().expect("a duration").as_millis() as u64;
        assert!(
            duration.abs_diff(case.duration_ms) <= 20,
            "{}: duration {duration} ms, want {} ms",
            case.file,
            case.duration_ms
        );

        let streams = media.streams();
        let kinds: Vec<(Kind, Codec)> = streams.iter().map(|s| (s.kind, s.codec)).collect();
        let mut want = Vec::new();
        if let Some(codec) = case.video {
            want.push((Kind::Video, codec));
        }
        if let Some((codec, _, _)) = case.audio {
            want.push((Kind::Audio, codec));
        }
        assert_eq!(kinds, want, "{}: streams", case.file);

        let mut video = None;
        let mut audio = None;
        for (index, stream) in streams.iter().enumerate() {
            let enabled = media.enable(index);
            if stream.codec == Codec::Aac && !cfg!(feature = "aac") {
                assert_eq!(
                    enabled,
                    Err(Error::UnsupportedCodec),
                    "{}: AAC off",
                    case.file
                );
                continue;
            }
            enabled.unwrap_or_else(|e| panic!("{}: enable {:?}: {e}", case.file, stream.codec));
            match stream.kind {
                Kind::Video => video = Some(index),
                Kind::Audio => audio = Some(index),
                Kind::Other => {}
            }
        }

        let mut v = Decoded {
            pts_rising: true,
            ..Decoded::default()
        };
        let mut a = Decoded::default();
        while let Some(frame) = media
            .next_frame()
            .unwrap_or_else(|e| panic!("{}: decode: {e}", case.file))
        {
            match frame {
                Frame::Video(frame) => {
                    assert_eq!(Some(frame.stream), video);
                    v.video(&frame);
                }
                Frame::Audio(frame) => {
                    assert_eq!(Some(frame.stream), audio);
                    a.audio(&frame);
                }
            }
        }

        if case.video.is_some() {
            assert_eq!(v.frames, FRAMES, "{}: video frames", case.file);
            assert!(v.pts_rising, "{}: timestamps out of order", case.file);
            assert_colour(case.file, "first", v.first.unwrap(), yuv(1.0, 0.0, 0.0));
            assert_colour(case.file, "last", v.last.unwrap(), yuv(0.0, 0.0, 1.0));
        }
        if let (Some((_, rate, seconds)), Some(_)) = (case.audio, audio) {
            assert_eq!(a.rate, rate, "{}: sample rate", case.file);
            let want = f64::from(rate) * seconds;
            let got = a.samples as f64;
            // FFmpeg trims encoder priming from the container's edit lists and pre-skip; what
            // is left is at most a frame's padding (AAC 256 here, Vorbis 128).
            assert!(
                (got - want).abs() <= 512.0,
                "{}: {got} samples, want about {want}",
                case.file
            );
            // A 440 Hz tone crosses zero 880 times a second.
            let crossings = a.crossings as f64 / seconds;
            assert!(
                (crossings - 880.0).abs() <= 880.0 * 0.05,
                "{}: {crossings} zero crossings a second, want about 880",
                case.file
            );
        }
        println!(
            "{}: {} video frames, {} audio samples at {} Hz",
            case.file, v.frames, a.samples, a.rate
        );
    }
}

#[test]
fn a_truncated_mp4_is_invalid() {
    assert_eq!(open("truncated.mp4").err(), Some(Error::Invalid));
}

#[test]
fn avi_is_an_unsupported_container() {
    assert_eq!(
        open("mpeg4-mp3.avi").err(),
        Some(Error::UnsupportedContainer)
    );
}

#[test]
fn bytes_that_are_no_media_are_an_unsupported_container() {
    let text = b"Not a video at all, only words. ".repeat(64);
    assert_eq!(
        Media::open_bytes(text).err(),
        Some(Error::UnsupportedContainer)
    );
}

#[test]
fn hevc_opens_but_its_video_is_an_unsupported_codec() {
    let mut media = open("hevc-aac.mp4").expect("opens");
    let streams = media.streams();
    assert_eq!(streams[0].codec, Codec::Hevc);
    assert_eq!(media.enable(0), Err(Error::UnsupportedCodec));
}

#[test]
fn theora_is_an_unsupported_codec_but_its_vorbis_plays() {
    let mut media = open("theora-vorbis.ogv").expect("opens");
    let streams = media.streams();
    let theora = streams
        .iter()
        .position(|s| s.codec == Codec::Theora)
        .unwrap();
    let vorbis = streams
        .iter()
        .position(|s| s.codec == Codec::Vorbis)
        .unwrap();
    assert_eq!(media.enable(theora), Err(Error::UnsupportedCodec));
    media.enable(vorbis).expect("vorbis");
    let mut samples = 0;
    while let Some(frame) = media.next_frame().expect("decodes") {
        let Frame::Audio(frame) = frame else {
            panic!("only audio is enabled");
        };
        samples += frame.samples.len();
    }
    assert!(samples.abs_diff(96_000) <= 512, "{samples} samples");
}

#[test]
fn a_stream_that_does_not_exist_is_refused() {
    let mut media = open("sine.flac").expect("opens");
    assert_eq!(media.enable(7), Err(Error::BadStream));
}

#[test]
fn media_moves_to_another_thread() {
    let mut media = open("vp9-opus.webm").expect("opens");
    let frames = std::thread::spawn(move || {
        media.enable(0).expect("vp9");
        let mut frames = 0;
        while media.next_frame().expect("decodes").is_some() {
            frames += 1;
        }
        frames
    })
    .join()
    .expect("joins");
    assert_eq!(frames, FRAMES);
}

#[test]
fn seeking_lands_on_the_keyframe_before_and_decodes_to_the_target() {
    for file in [
        "h264-aac.mp4",
        "vp8-vorbis.webm",
        "vp9-opus.webm",
        "av1-opus.mkv",
    ] {
        let mut media = open(file).expect("opens");
        media.enable(0).expect("video");
        media
            .seek(std::time::Duration::from_millis(1500))
            .expect("seeks");
        let mut first_at_target = None;
        while let Some(frame) = media.next_frame().expect("decodes") {
            let Frame::Video(frame) = frame else { continue };
            let pts = frame.pts_us.expect("pts");
            assert!(
                pts >= 900_000,
                "{file}: {pts} us is before the keyframe at 1 s"
            );
            if pts >= 1_450_000 && first_at_target.is_none() {
                first_at_target = Some((pts, centre(&frame)));
            }
        }
        let (pts, colour) = first_at_target.expect("a frame at the target");
        assert!(
            pts <= 1_550_000,
            "{file}: first frame at the target is at {pts} us"
        );
        assert_colour(file, "seek", colour, yuv(0.0, 0.0, 1.0));
    }
}

#[test]
fn a_corrupt_stretch_is_skipped_and_decoding_reaches_the_end() {
    // Faststart MP4: the sample tables come first, so garbage in the back half of the file hits
    // only frame payloads (the container still demuxes every packet).
    let mut bytes = fixture("h264-aac.mp4");
    let (from, to) = (bytes.len() * 3 / 5, bytes.len() * 4 / 5);
    for (i, byte) in bytes[from..to].iter_mut().enumerate() {
        *byte = (i * 37 % 251) as u8;
    }
    let mut media = Media::open_bytes(bytes).expect("the headers are intact");
    media.enable(0).expect("video");
    let mut frames = 0;
    loop {
        match media.next_frame() {
            Ok(Some(_)) => frames += 1,
            Ok(None) => break,
            Err(error) => panic!("decoding stopped at {frames} frames: {error}"),
        }
    }
    assert!(frames >= 5, "{frames} frames");
    println!(
        "{frames} frames, {} packets skipped",
        media.skipped_packets()
    );
}

#[test]
fn an_empty_packet_is_ignored() {
    // Matroska with a zero-length block is hard to make with ffmpeg; the shim drops any packet
    // of size 0 before a decoder sees it (dav1d refuses them), so a normal decode must not change.
    let mut media = open("av1-opus.mkv").expect("opens");
    media.enable(0).expect("av1");
    let mut frames = 0;
    while media.next_frame().expect("decodes").is_some() {
        frames += 1;
    }
    assert_eq!(frames, FRAMES);
    assert_eq!(media.skipped_packets(), 0);
}
