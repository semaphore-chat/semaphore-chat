//! Opus packets to PCM with the libopus that libwebrtc already links (BSD-3-Clause; its symbols
//! are not renamed in LiveKit's prebuilt), and the `OpusHead` both Ogg and WebM carry.

use super::{DecodeError, MAX_SECONDS, Pcm};
use std::os::raw::c_int;

/// Opus always decodes at 48 kHz here, so no resampling.
pub(super) const RATE: u32 = 48_000;
/// The longest packet Opus has: 120 ms.
const MAX_FRAME: usize = 5_760;
/// Far above anything Opus makes (120 ms of 1275-byte frames is under 8 KiB).
pub(super) const MAX_PACKET: usize = 64 * 1024;

#[repr(C)]
struct OpusDecoder {
    _private: [u8; 0],
}

unsafe extern "C" {
    fn opus_decoder_create(fs: i32, channels: c_int, error: *mut c_int) -> *mut OpusDecoder;
    fn opus_decode(
        st: *mut OpusDecoder,
        data: *const u8,
        len: i32,
        pcm: *mut i16,
        frame_size: c_int,
        decode_fec: c_int,
    ) -> c_int;
    fn opus_decoder_destroy(st: *mut OpusDecoder);
    fn opus_packet_get_nb_samples(data: *const u8, len: i32, fs: i32) -> c_int;
}

/// What `OpusHead` says (RFC 7845 section 5.1). Only channel mapping family 0: mono or stereo.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) struct Head {
    pub channels: u16,
    pub pre_skip: u16,
    /// Linear, from the header's Q7.8 dB.
    pub gain: f32,
}

pub(super) fn parse_head(packet: &[u8]) -> Result<Head, DecodeError> {
    let invalid = |why: &str| DecodeError::Invalid(why.to_owned());
    if packet.len() < 19 || &packet[..8] != b"OpusHead" {
        return Err(invalid("its Opus header is missing"));
    }
    if packet[8] >> 4 != 0 {
        return Err(DecodeError::Unsupported("a newer Opus header version"));
    }
    let channels = u16::from(packet[9]);
    let pre_skip = u16::from_le_bytes([packet[10], packet[11]]);
    let gain_q8 = i16::from_le_bytes([packet[16], packet[17]]);
    let family = packet[18];
    if family != 0 {
        return Err(DecodeError::Unsupported("Opus with more than two channels"));
    }
    if channels == 0 || channels > 2 {
        return Err(invalid("its Opus header has an impossible channel count"));
    }
    let gain = 10f32.powf(f32::from(gain_q8) / (20.0 * 256.0));
    Ok(Head {
        channels,
        pre_skip,
        gain,
    })
}

/// One libopus decoder, freed on drop.
pub(super) struct Decoder {
    state: *mut OpusDecoder,
    head: Head,
    pcm: Vec<i16>,
    out: Vec<f32>,
    /// Samples (per channel) still to drop from the front.
    skip: usize,
}

impl Drop for Decoder {
    fn drop(&mut self) {
        // SAFETY: `state` came from `opus_decoder_create`, is non-null, and is freed once.
        unsafe { opus_decoder_destroy(self.state) };
    }
}

impl Decoder {
    pub(super) fn new(head: Head) -> Result<Self, DecodeError> {
        let mut error: c_int = 0;
        // SAFETY: plain values in, and `error` outlives the call.
        let state =
            unsafe { opus_decoder_create(RATE as i32, c_int::from(head.channels), &mut error) };
        if state.is_null() || error != 0 {
            if !state.is_null() {
                // SAFETY: as in `drop`.
                unsafe { opus_decoder_destroy(state) };
            }
            return Err(DecodeError::Invalid(format!(
                "libopus wouldn't start ({error})"
            )));
        }
        Ok(Self {
            state,
            head,
            pcm: vec![0; MAX_FRAME * usize::from(head.channels)],
            out: Vec::new(),
            skip: usize::from(head.pre_skip),
        })
    }

    /// Decodes one packet onto the output. An empty packet means nothing here.
    pub(super) fn push(&mut self, packet: &[u8]) -> Result<(), DecodeError> {
        if packet.is_empty() {
            return Ok(());
        }
        if packet.len() > MAX_PACKET {
            return Err(DecodeError::Invalid(
                "an Opus packet is impossibly big".into(),
            ));
        }
        let len = packet.len() as i32;
        // SAFETY: `packet` is valid for `len` bytes.
        let frames = unsafe { opus_packet_get_nb_samples(packet.as_ptr(), len, RATE as i32) };
        if frames <= 0 || frames as usize > MAX_FRAME {
            return Err(DecodeError::Invalid("an Opus packet is damaged".into()));
        }
        let channels = usize::from(self.head.channels);
        if (self.out.len() / channels) + frames as usize > MAX_SECONDS as usize * RATE as usize {
            return Err(DecodeError::TooLong);
        }
        // SAFETY: `pcm` holds `MAX_FRAME * channels` samples, the most `frame_size = MAX_FRAME`
        // lets libopus write, and `packet` is valid for `len` bytes.
        let decoded = unsafe {
            opus_decode(
                self.state,
                packet.as_ptr(),
                len,
                self.pcm.as_mut_ptr(),
                MAX_FRAME as c_int,
                0,
            )
        };
        if decoded < 0 || decoded as usize > MAX_FRAME {
            return Err(DecodeError::Invalid("an Opus packet is damaged".into()));
        }
        let decoded = decoded as usize;
        let drop_front = self.skip.min(decoded);
        self.skip -= drop_front;
        let gain = self.head.gain;
        self.out.extend(
            self.pcm[drop_front * channels..decoded * channels]
                .iter()
                .map(|&sample| f32::from(sample) / 32_768.0 * gain),
        );
        Ok(())
    }

    /// The sound, cut to `total` samples per channel when the container says where it ends.
    pub(super) fn finish(mut self, total: Option<u64>) -> Result<Pcm, DecodeError> {
        let channels = usize::from(self.head.channels);
        if let Some(total) = total {
            let keep = usize::try_from(total)
                .unwrap_or(usize::MAX)
                .saturating_mul(channels);
            self.out.truncate(keep);
        }
        if self.out.is_empty() {
            return Err(DecodeError::Invalid("it has no audio".into()));
        }
        Ok(Pcm {
            sample_rate: RATE,
            channels: self.head.channels,
            samples: std::mem::take(&mut self.out),
        })
    }
}

/// Opus from the same libopus, for tests to make fixtures with.
#[cfg(test)]
pub(crate) mod encode {
    use std::os::raw::c_int;

    #[repr(C)]
    struct OpusEncoder {
        _private: [u8; 0],
    }

    const OPUS_APPLICATION_AUDIO: c_int = 2049;

    unsafe extern "C" {
        fn opus_encoder_create(
            fs: i32,
            channels: c_int,
            application: c_int,
            error: *mut c_int,
        ) -> *mut OpusEncoder;
        fn opus_encode(
            st: *mut OpusEncoder,
            pcm: *const i16,
            frame_size: c_int,
            data: *mut u8,
            max_data_bytes: i32,
        ) -> i32;
        fn opus_encoder_destroy(st: *mut OpusEncoder);
    }

    /// 20 ms packets of interleaved 48 kHz `samples`; the tail is padded with silence.
    pub(crate) fn packets(samples: &[i16], channels: usize) -> Vec<Vec<u8>> {
        let frame = 960;
        let mut error = 0;
        // SAFETY: plain values in; checked below.
        let encoder = unsafe {
            opus_encoder_create(
                48_000,
                channels as c_int,
                OPUS_APPLICATION_AUDIO,
                &mut error,
            )
        };
        assert!(!encoder.is_null() && error == 0, "encoder: {error}");
        let mut packets = Vec::new();
        for chunk in samples.chunks(frame * channels) {
            let mut padded = chunk.to_vec();
            padded.resize(frame * channels, 0);
            let mut out = vec![0u8; 4000];
            // SAFETY: `padded` holds a whole frame, `out` 4000 bytes.
            let len = unsafe {
                opus_encode(
                    encoder,
                    padded.as_ptr(),
                    frame as c_int,
                    out.as_mut_ptr(),
                    4000,
                )
            };
            assert!(len > 0, "encode: {len}");
            out.truncate(len as usize);
            packets.push(out);
        }
        // SAFETY: created above, freed once.
        unsafe { opus_encoder_destroy(encoder) };
        packets
    }

    /// An `OpusHead` for family 0.
    pub(crate) fn head(channels: u8, pre_skip: u16) -> Vec<u8> {
        let mut head = b"OpusHead".to_vec();
        head.push(1);
        head.push(channels);
        head.extend_from_slice(&pre_skip.to_le_bytes());
        head.extend_from_slice(&48_000u32.to_le_bytes());
        head.extend_from_slice(&0i16.to_le_bytes());
        head.push(0);
        head
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_head_is_read_and_checked() {
        let head = parse_head(&encode::head(2, 312)).unwrap();
        assert_eq!((head.channels, head.pre_skip, head.gain), (2, 312, 1.0));
        assert!(matches!(
            parse_head(&encode::head(3, 0)),
            Err(DecodeError::Invalid(_))
        ));
        let mut family = encode::head(2, 0);
        family[18] = 1;
        assert!(matches!(
            parse_head(&family),
            Err(DecodeError::Unsupported(_))
        ));
        assert!(parse_head(&encode::head(1, 0)[..18]).is_err());
        assert!(parse_head(b"OpusTags...........").is_err());
    }

    #[test]
    fn garbage_packets_are_refused() {
        let mut decoder = Decoder::new(parse_head(&encode::head(1, 0)).unwrap()).unwrap();
        decoder.push(&[]).unwrap();
        // Code 3 (arbitrary frames) with a frame count of 63 at 120 ms: far past 120 ms in all.
        assert!(decoder.push(&[0xFB, 0x3F]).is_err());
        assert!(decoder.push(&vec![0u8; MAX_PACKET + 1]).is_err());
        assert!(matches!(decoder.finish(None), Err(DecodeError::Invalid(_))));
    }

    #[test]
    fn packets_decode_back_and_pre_skip_is_dropped() {
        let tone: Vec<i16> = (0..9600)
            .map(|i| ((i as f32 * 0.05).sin() * 8000.0) as i16)
            .collect();
        let packets = encode::packets(&tone, 1);
        let mut decoder = Decoder::new(parse_head(&encode::head(1, 312)).unwrap()).unwrap();
        for packet in &packets {
            decoder.push(packet).unwrap();
        }
        // 10 whole packets, less the pre-skip.
        let pcm = decoder.finish(None).unwrap();
        assert_eq!(pcm.samples.len(), 9600 - 312);
        // The container's length cuts it.
        let mut decoder = Decoder::new(parse_head(&encode::head(1, 0)).unwrap()).unwrap();
        for packet in &packets {
            decoder.push(packet).unwrap();
        }
        assert_eq!(decoder.finish(Some(5000)).unwrap().samples.len(), 5000);
        let energy: f32 = pcm.samples.iter().map(|s| s * s).sum();
        assert!(energy > 10.0, "{energy}");
    }
}
