//! RIFF/WAVE: integer PCM (8, 16, 24, 32 bit) and float (32, 64 bit), plain or
//! `WAVE_FORMAT_EXTENSIBLE`. Everything is read through bounds-checked slices; a declared size
//! larger than the file is an error, except the `data` chunk's, which streaming writers leave at
//! 0 or `u32::MAX` (it then runs to the end of the file).

use super::{DecodeError, MAX_CHANNELS, MAX_RATE, MAX_SECONDS, MIN_RATE, Pcm};

const PCM: u16 = 1;
const FLOAT: u16 = 3;
const ALAW: u16 = 6;
const MULAW: u16 = 7;
const EXTENSIBLE: u16 = 0xFFFE;

struct Format {
    tag: u16,
    channels: u16,
    rate: u32,
    bits: u16,
    block_align: u16,
}

fn u16_at(bytes: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_le_bytes(bytes.get(at..at + 2)?.try_into().ok()?))
}

fn u32_at(bytes: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_le_bytes(bytes.get(at..at + 4)?.try_into().ok()?))
}

fn invalid(why: &str) -> DecodeError {
    DecodeError::Invalid(why.to_owned())
}

fn parse_format(body: &[u8]) -> Result<Format, DecodeError> {
    let short = || invalid("its format chunk is too short");
    let mut tag = u16_at(body, 0).ok_or_else(short)?;
    let channels = u16_at(body, 2).ok_or_else(short)?;
    let rate = u32_at(body, 4).ok_or_else(short)?;
    let block_align = u16_at(body, 12).ok_or_else(short)?;
    let bits = u16_at(body, 14).ok_or_else(short)?;
    if tag == EXTENSIBLE {
        // cbSize (2), valid bits (2), channel mask (4), then the sub-format GUID, whose first two
        // bytes are the real format tag.
        tag = u16_at(body, 24).ok_or_else(short)?;
    }
    Ok(Format {
        tag,
        channels,
        rate,
        bits,
        block_align,
    })
}

fn check(format: &Format) -> Result<(), DecodeError> {
    match format.tag {
        PCM | FLOAT => {}
        ALAW | MULAW => return Err(DecodeError::Unsupported("A-law or μ-law WAV")),
        _ => return Err(DecodeError::Unsupported("compressed WAV")),
    }
    if format.channels == 0 || format.channels > MAX_CHANNELS {
        return Err(invalid("it has an impossible channel count"));
    }
    if !(MIN_RATE..=MAX_RATE).contains(&format.rate) {
        return Err(invalid("it has an impossible sample rate"));
    }
    let sizes_ok = match format.tag {
        PCM => matches!(format.bits, 8 | 16 | 24 | 32),
        _ => matches!(format.bits, 32 | 64),
    };
    if !sizes_ok {
        return Err(DecodeError::Unsupported("WAV with an unusual sample size"));
    }
    let expected = u32::from(format.channels) * u32::from(format.bits / 8);
    if u32::from(format.block_align) != expected {
        return Err(invalid("its block size doesn't match its format"));
    }
    Ok(())
}

fn sample(format: &Format, bytes: &[u8]) -> f32 {
    match (format.tag, format.bits) {
        (PCM, 8) => (f32::from(bytes[0]) - 128.0) / 128.0,
        (PCM, 16) => f32::from(i16::from_le_bytes([bytes[0], bytes[1]])) / 32_768.0,
        (PCM, 24) => {
            let value = i32::from_le_bytes([0, bytes[0], bytes[1], bytes[2]]) >> 8;
            value as f32 / 8_388_608.0
        }
        (PCM, 32) => {
            i32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) as f32 / 2_147_483_648.0
        }
        (_, 32) => f32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]),
        _ => {
            let mut wide = [0u8; 8];
            wide.copy_from_slice(&bytes[..8]);
            f64::from_le_bytes(wide) as f32
        }
    }
}

pub(super) fn decode(bytes: &[u8]) -> Result<Pcm, DecodeError> {
    if bytes.get(0..4) != Some(b"RIFF") || bytes.get(8..12) != Some(b"WAVE") {
        return Err(invalid("it isn't a WAV file"));
    }
    let mut at = 12usize;
    let mut format: Option<Format> = None;
    while at < bytes.len() {
        let id = bytes
            .get(at..at + 4)
            .ok_or_else(|| invalid("it ends inside a chunk header"))?;
        let size = u32_at(bytes, at + 4).ok_or_else(|| invalid("it ends inside a chunk header"))?;
        let body_start = at + 8;
        let remaining = bytes.len() - body_start.min(bytes.len());
        if id == b"data" {
            let format = format.ok_or_else(|| invalid("its audio comes before its format"))?;
            let declared = usize::try_from(size).unwrap_or(usize::MAX);
            let length = if size == 0 || declared > remaining {
                remaining
            } else {
                declared
            };
            return samples(&format, &bytes[body_start..body_start + length]);
        }
        let size = usize::try_from(size).unwrap_or(usize::MAX);
        if size > remaining {
            return Err(invalid("a chunk is longer than the file"));
        }
        if id == b"fmt " {
            let parsed = parse_format(&bytes[body_start..body_start + size])?;
            check(&parsed)?;
            format = Some(parsed);
        }
        // Chunks are padded to an even length.
        at = body_start + size + (size & 1);
    }
    Err(invalid("it has no audio"))
}

fn samples(format: &Format, data: &[u8]) -> Result<Pcm, DecodeError> {
    let block = usize::from(format.block_align);
    let frames = data.len() / block;
    if frames == 0 {
        return Err(invalid("it has no audio"));
    }
    let limit = MAX_SECONDS as usize * format.rate as usize;
    if frames > limit {
        return Err(DecodeError::TooLong);
    }
    let width = usize::from(format.bits / 8);
    let samples = data[..frames * block]
        .chunks_exact(width)
        .map(|bytes| sample(format, bytes))
        .collect();
    Ok(Pcm {
        sample_rate: format.rate,
        channels: format.channels,
        samples,
    })
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// A WAV with a `fmt ` and a `data` chunk, as a test writes it.
    pub(crate) fn wav(tag: u16, channels: u16, rate: u32, bits: u16, data: &[u8]) -> Vec<u8> {
        let block = channels * (bits / 8);
        let mut out = Vec::new();
        out.extend_from_slice(b"RIFF");
        out.extend_from_slice(&(36 + data.len() as u32).to_le_bytes());
        out.extend_from_slice(b"WAVE");
        out.extend_from_slice(b"fmt ");
        out.extend_from_slice(&16u32.to_le_bytes());
        out.extend_from_slice(&tag.to_le_bytes());
        out.extend_from_slice(&channels.to_le_bytes());
        out.extend_from_slice(&rate.to_le_bytes());
        out.extend_from_slice(&rate.wrapping_mul(u32::from(block)).to_le_bytes());
        out.extend_from_slice(&block.to_le_bytes());
        out.extend_from_slice(&bits.to_le_bytes());
        out.extend_from_slice(b"data");
        out.extend_from_slice(&(data.len() as u32).to_le_bytes());
        out.extend_from_slice(data);
        out
    }

    pub(crate) fn wav16(channels: u16, rate: u32, samples: &[i16]) -> Vec<u8> {
        let data: Vec<u8> = samples.iter().flat_map(|s| s.to_le_bytes()).collect();
        wav(PCM, channels, rate, 16, &data)
    }

    #[test]
    fn reads_each_sample_format() {
        let pcm = decode(&wav16(1, 48_000, &[0, 16_384, -32_768])).unwrap();
        assert_eq!(pcm.samples, vec![0.0, 0.5, -1.0]);

        let pcm = decode(&wav(PCM, 1, 8_000, 8, &[128, 192, 0])).unwrap();
        assert_eq!(pcm.samples, vec![0.0, 0.5, -1.0]);

        let pcm = decode(&wav(PCM, 1, 44_100, 24, &[0, 0, 0x40, 0, 0, 0x80])).unwrap();
        assert_eq!(pcm.samples, vec![0.5, -1.0]);

        let data: Vec<u8> = [0.25f32, -0.75]
            .iter()
            .flat_map(|s| s.to_le_bytes())
            .collect();
        let pcm = decode(&wav(FLOAT, 2, 48_000, 32, &data)).unwrap();
        assert_eq!((pcm.channels, pcm.samples), (2, vec![0.25, -0.75]));

        let data: Vec<u8> = [0.5f64].iter().flat_map(|s| s.to_le_bytes()).collect();
        assert_eq!(
            decode(&wav(FLOAT, 1, 48_000, 64, &data)).unwrap().samples,
            vec![0.5]
        );
    }

    #[test]
    fn skips_other_chunks_and_their_padding() {
        let mut file = wav16(1, 48_000, &[1000]);
        // An odd-sized LIST chunk between fmt and data.
        let list = [b'L', b'I', b'S', b'T', 3, 0, 0, 0, 1, 2, 3, 0];
        file.splice(36..36, list);
        assert_eq!(decode(&file).unwrap().samples.len(), 1);
    }

    #[test]
    fn a_streamed_data_size_runs_to_the_end() {
        let mut file = wav16(1, 48_000, &[1, 2, 3, 4]);
        file[40..44].copy_from_slice(&u32::MAX.to_le_bytes());
        assert_eq!(decode(&file).unwrap().samples.len(), 4);
        file[40..44].copy_from_slice(&0u32.to_le_bytes());
        assert_eq!(decode(&file).unwrap().samples.len(), 4);
    }

    #[test]
    fn malformed_files_are_refused_without_panicking() {
        let good = wav16(1, 48_000, &[1, 2, 3, 4]);
        for cut in 0..good.len() {
            let _ = decode(&good[..cut]);
        }
        assert!(matches!(decode(&good[..20]), Err(DecodeError::Invalid(_))));

        // A fmt chunk that claims 4 GiB.
        let mut huge = good.clone();
        huge[16..20].copy_from_slice(&u32::MAX.to_le_bytes());
        assert!(matches!(decode(&huge), Err(DecodeError::Invalid(_))));

        let cases = [
            wav(PCM, 0, 48_000, 16, &[0, 0]),
            wav(PCM, 200, 48_000, 16, &[0, 0]),
            wav(PCM, 1, 1, 16, &[0, 0]),
            wav(PCM, 1, 4_000_000_000, 16, &[0, 0]),
            wav(PCM, 1, 48_000, 16, &[]),
        ];
        for case in cases {
            assert!(matches!(decode(&case), Err(DecodeError::Invalid(_))));
        }
        let mut misaligned = good.clone();
        misaligned[32..34].copy_from_slice(&7u16.to_le_bytes());
        assert!(matches!(decode(&misaligned), Err(DecodeError::Invalid(_))));

        assert!(matches!(
            decode(&wav(MULAW, 1, 8_000, 8, &[0])),
            Err(DecodeError::Unsupported(_))
        ));
        assert!(matches!(
            decode(&wav(0x55, 1, 8_000, 8, &[0])),
            Err(DecodeError::Unsupported(_))
        ));
        assert!(matches!(
            decode(&wav(PCM, 1, 8_000, 12, &[0])),
            Err(DecodeError::Unsupported(_))
        ));
    }

    #[test]
    fn audio_past_the_length_cap_is_refused() {
        let rate = 8_000;
        let too_long = vec![0u8; (MAX_SECONDS as usize * rate + 1) * 2];
        let file = wav(PCM, 1, rate as u32, 16, &too_long);
        assert!(matches!(decode(&file), Err(DecodeError::TooLong)));
    }
}
