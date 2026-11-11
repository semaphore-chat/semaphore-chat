//! Ogg (RFC 3533) with Opus in it (RFC 7845). The first logical stream is read; any other is
//! ignored. Pages are walked with checked offsets, and a packet may not grow past
//! `opus::MAX_PACKET`, so a file can't make us allocate more than it is, plus the capped output.

use super::opus::{self, Decoder};
use super::{DecodeError, Pcm};

const HEADER: usize = 27;

struct Page<'a> {
    granule: i64,
    serial: u32,
    continued: bool,
    lacing: &'a [u8],
    body: &'a [u8],
}

fn invalid(why: &str) -> DecodeError {
    DecodeError::Invalid(why.to_owned())
}

/// The page at `at`, and where the next one starts.
fn page(bytes: &[u8], at: usize) -> Result<(Page<'_>, usize), DecodeError> {
    let header = bytes
        .get(at..at + HEADER)
        .ok_or_else(|| invalid("it ends inside an Ogg page"))?;
    if &header[..4] != b"OggS" || header[4] != 0 {
        return Err(invalid("an Ogg page is damaged"));
    }
    let segments = usize::from(header[26]);
    let lacing = bytes
        .get(at + HEADER..at + HEADER + segments)
        .ok_or_else(|| invalid("it ends inside an Ogg page"))?;
    let body_len: usize = lacing.iter().map(|&l| usize::from(l)).sum();
    let body_start = at + HEADER + segments;
    let body = bytes
        .get(body_start..body_start + body_len)
        .ok_or_else(|| invalid("it ends inside an Ogg page"))?;
    let granule = i64::from_le_bytes(header[6..14].try_into().expect("8 bytes"));
    let serial = u32::from_le_bytes(header[14..18].try_into().expect("4 bytes"));
    Ok((
        Page {
            granule,
            serial,
            continued: header[5] & 1 != 0,
            lacing,
            body,
        },
        body_start + body_len,
    ))
}

/// Calls `on_packet` with each whole packet of the first stream, in order, and returns the last
/// page's granule position.
fn packets(
    bytes: &[u8],
    mut on_packet: impl FnMut(&[u8]) -> Result<(), DecodeError>,
) -> Result<Option<i64>, DecodeError> {
    let mut at = 0;
    let mut serial = None;
    let mut packet: Vec<u8> = Vec::new();
    let mut last_granule = None;
    while at < bytes.len() {
        let (page, next) = page(bytes, at)?;
        at = next;
        if *serial.get_or_insert(page.serial) != page.serial {
            continue;
        }
        if !page.continued {
            // A packet left open by the last page and not continued here was cut off.
            packet.clear();
        }
        let mut offset = 0;
        for &lace in page.lacing {
            let lace = usize::from(lace);
            if packet.len() + lace > opus::MAX_PACKET {
                return Err(invalid("an Ogg packet is impossibly big"));
            }
            packet.extend_from_slice(&page.body[offset..offset + lace]);
            offset += lace;
            if lace < 255 {
                on_packet(&packet)?;
                packet.clear();
            }
        }
        // -1: no packet ends on this page.
        if page.granule >= 0 {
            last_granule = Some(page.granule);
        }
    }
    Ok(last_granule)
}

pub(super) fn decode(bytes: &[u8]) -> Result<Pcm, DecodeError> {
    let mut index = 0usize;
    let mut decoder: Option<Decoder> = None;
    let mut pre_skip = 0u64;
    let last_granule = packets(bytes, |packet| {
        index += 1;
        match index {
            1 => {
                if packet.starts_with(b"\x01vorbis") {
                    return Err(DecodeError::Unsupported("Ogg Vorbis"));
                }
                if packet.starts_with(b"fLaC") || packet.starts_with(b"\x7fFLAC") {
                    return Err(DecodeError::Unsupported("Ogg FLAC"));
                }
                let head = opus::parse_head(packet)?;
                pre_skip = u64::from(head.pre_skip);
                decoder = Some(Decoder::new(head)?);
                Ok(())
            }
            // OpusTags: nothing we need.
            2 => Ok(()),
            _ => decoder
                .as_mut()
                .ok_or_else(|| invalid("its Opus header is missing"))?
                .push(packet),
        }
    })?;
    let decoder = decoder.ok_or_else(|| invalid("it has no audio"))?;
    // The last granule position counts samples at 48 kHz from the start, pre-skip included.
    let total = last_granule
        .and_then(|granule| u64::try_from(granule).ok())
        .map(|granule| granule.saturating_sub(pre_skip));
    decoder.finish(total)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::soundboard::opus::encode;

    /// One page of stream 7, as a test writes it. CRCs are left at 0: nothing here checks them.
    pub(crate) fn raw_page(flags: u8, granule: i64, lacing: &[u8], body: &[u8]) -> Vec<u8> {
        let mut out = b"OggS\0".to_vec();
        out.push(flags);
        out.extend_from_slice(&granule.to_le_bytes());
        out.extend_from_slice(&7u32.to_le_bytes());
        out.extend_from_slice(&[0; 8]);
        out.push(lacing.len() as u8);
        out.extend_from_slice(lacing);
        out.extend_from_slice(body);
        out
    }

    /// An Ogg stream: one page per packet, laced in 255s.
    pub(crate) fn ogg(packets: &[Vec<u8>], granules: &[i64]) -> Vec<u8> {
        let mut out = Vec::new();
        for (sequence, (packet, granule)) in packets.iter().zip(granules).enumerate() {
            let mut lacing = vec![255u8; packet.len() / 255];
            lacing.push((packet.len() % 255) as u8);
            let flags = if sequence == 0 { 2 } else { 0 };
            out.extend(raw_page(flags, *granule, &lacing, packet));
        }
        out
    }

    pub(crate) fn tone(samples: usize, channels: usize) -> Vec<i16> {
        (0..samples * channels)
            .map(|i| {
                let t = (i / channels) as f32 / 48_000.0;
                ((t * 2.0 * std::f32::consts::PI * 440.0).sin() * 10_000.0) as i16
            })
            .collect()
    }

    /// 0.5 s of 440 Hz in Ogg Opus.
    pub(crate) fn ogg_opus(channels: u8) -> Vec<u8> {
        let wide = usize::from(channels);
        // An encoder sends the pre-skip's worth more than the sound.
        let audio = encode::packets(&tone(24_000 + 312, wide), wide);
        let mut packets = vec![
            encode::head(channels, 312),
            b"OpusTags\0\0\0\0\0\0\0\0".to_vec(),
        ];
        let mut granules = vec![0, 0];
        for (i, packet) in audio.into_iter().enumerate() {
            packets.push(packet);
            granules.push(312 + 960 * (i as i64 + 1));
        }
        // The end trims to exactly 0.5 s.
        *granules.last_mut().unwrap() = 312 + 24_000;
        ogg(&packets, &granules)
    }

    #[test]
    fn mono_and_stereo_opus_decode_to_their_length() {
        let pcm = decode(&ogg_opus(1)).unwrap();
        assert_eq!(
            (pcm.sample_rate, pcm.channels, pcm.samples.len()),
            (48_000, 1, 24_000)
        );
        let pcm = decode(&ogg_opus(2)).unwrap();
        assert_eq!((pcm.channels, pcm.samples.len()), (2, 48_000));
    }

    #[test]
    fn a_packet_split_across_pages_is_joined() {
        // A 600-byte packet over two pages: 255, 255 on the first (left open), 90 on the second.
        let packet: Vec<u8> = (0..600).map(|i| i as u8).collect();
        let mut file = raw_page(2, -1, &[255, 255], &packet[..510]);
        file.extend(raw_page(1, 0, &[90], &packet[510..]));
        let mut seen = Vec::new();
        packets(&file, |p| {
            seen.push(p.to_vec());
            Ok(())
        })
        .unwrap();
        assert_eq!(seen, vec![packet]);
    }

    #[test]
    fn malformed_streams_are_refused_without_panicking() {
        let good = ogg_opus(1);
        for cut in (0..good.len()).step_by(7) {
            let _ = decode(&good[..cut]);
        }
        assert!(matches!(
            decode(&good[..good.len() - 3]),
            Err(DecodeError::Invalid(_))
        ));
        assert!(decode(&good[..HEADER + 1]).is_err());

        // A zero-segment page carries nothing, and is no error.
        assert!(matches!(
            decode(&ogg(&[], &[])),
            Err(DecodeError::Invalid(_))
        ));
        let mut with_zero = raw_page(2, -1, &[], &[]);
        with_zero.extend_from_slice(&good);
        assert_eq!(decode(&with_zero).unwrap().samples.len(), 24_000);

        // A packet that never ends: all 255 laces, page after page, past the cap.
        let mut endless = Vec::new();
        for _ in 0..2 {
            endless.extend(raw_page(1, -1, &[255; 255], &vec![0u8; 255 * 255]));
        }
        assert!(matches!(decode(&endless), Err(DecodeError::Invalid(_))));

        // Not Opus.
        let vorbis = ogg(&[b"\x01vorbis....".to_vec()], &[0]);
        assert!(matches!(
            decode(&vorbis),
            Err(DecodeError::Unsupported("Ogg Vorbis"))
        ));
        assert!(decode(&ogg(&[b"garbage".to_vec()], &[0])).is_err());
        let mut bad_magic = good.clone();
        bad_magic[0] = b'X';
        assert!(decode(&bad_magic).is_err());
    }
}
