//! WebM (Matroska) with Opus in it, as browsers record it: the first audio track, from
//! `SimpleBlock`s or `BlockGroup`s, unlaced. The walk is flat: the masters that matter (Segment,
//! Cluster, Tracks, TrackEntry, BlockGroup) are stepped into rather than parsed as trees, so the
//! "unknown size" a live recorder writes for Segment and Cluster needs nothing special. Every other
//! element is skipped by its size, which must fit in the file.

use super::opus::{self, Decoder};
use super::{DecodeError, Pcm};

const EBML: u32 = 0x1A45_DFA3;
const SEGMENT: u32 = 0x1853_8067;
const CLUSTER: u32 = 0x1F43_B675;
const TRACKS: u32 = 0x1654_AE6B;
const TRACK_ENTRY: u32 = 0xAE;
const TRACK_NUMBER: u32 = 0xD7;
const TRACK_TYPE: u32 = 0x83;
const CODEC_ID: u32 = 0x86;
const CODEC_PRIVATE: u32 = 0x63A2;
const BLOCK_GROUP: u32 = 0xA0;
const BLOCK: u32 = 0xA1;
const SIMPLE_BLOCK: u32 = 0xA3;

const AUDIO: u64 = 2;
const MAX_TRACKS: usize = 64;

fn invalid(why: &str) -> DecodeError {
    DecodeError::Invalid(why.to_owned())
}

/// An element ID, marker bits kept, and its length (1 to 4 bytes).
fn read_id(bytes: &[u8], at: usize) -> Result<(u32, usize), DecodeError> {
    let first = *bytes
        .get(at)
        .ok_or_else(|| invalid("it ends inside a WebM element"))?;
    let length = first.leading_zeros() as usize + 1;
    if length > 4 {
        return Err(invalid("a WebM element ID is damaged"));
    }
    let raw = bytes
        .get(at..at + length)
        .ok_or_else(|| invalid("it ends inside a WebM element"))?;
    Ok((
        raw.iter().fold(0, |id, &b| (id << 8) | u32::from(b)),
        length,
    ))
}

/// A size (or a block's track number), marker removed; `None` is the all-ones "unknown".
fn read_vint(bytes: &[u8], at: usize) -> Result<(Option<u64>, usize), DecodeError> {
    let first = *bytes
        .get(at)
        .ok_or_else(|| invalid("it ends inside a WebM element"))?;
    let length = first.leading_zeros() as usize + 1;
    if length > 8 {
        return Err(invalid("a WebM size is damaged"));
    }
    let raw = bytes
        .get(at..at + length)
        .ok_or_else(|| invalid("it ends inside a WebM element"))?;
    let marker_free = u64::from(first) & (0xFF >> length);
    let value = raw[1..]
        .iter()
        .fold(marker_free, |value, &b| (value << 8) | u64::from(b));
    let all_ones = (1u64 << (7 * length)) - 1;
    Ok(((value != all_ones).then_some(value), length))
}

fn uint(body: &[u8]) -> Result<u64, DecodeError> {
    if body.len() > 8 {
        return Err(invalid("a WebM number is too long"));
    }
    Ok(body.iter().fold(0, |value, &b| (value << 8) | u64::from(b)))
}

#[derive(Default)]
struct Track {
    number: Option<u64>,
    kind: Option<u64>,
    codec: Vec<u8>,
    private: Vec<u8>,
}

/// The audio track's decoder, made at its first block.
enum Audio {
    NotYet,
    Opus { number: u64, decoder: Decoder },
}

pub(super) fn decode(bytes: &[u8]) -> Result<Pcm, DecodeError> {
    let (id, _) = read_id(bytes, 0)?;
    if id != EBML {
        return Err(invalid("it isn't a WebM file"));
    }
    let mut tracks: Vec<Track> = Vec::new();
    let mut audio = Audio::NotYet;
    let mut at = 0;
    while at < bytes.len() {
        let (id, id_len) = read_id(bytes, at)?;
        let (size, size_len) = read_vint(bytes, at + id_len)?;
        let body_start = at + id_len + size_len;
        if matches!(id, SEGMENT | CLUSTER | TRACKS | TRACK_ENTRY | BLOCK_GROUP) {
            if id == TRACK_ENTRY {
                if tracks.len() == MAX_TRACKS {
                    return Err(invalid("it has too many tracks"));
                }
                tracks.push(Track::default());
            }
            at = body_start;
            continue;
        }
        let size = size.ok_or_else(|| invalid("a WebM element has no size"))?;
        let size = usize::try_from(size).unwrap_or(usize::MAX);
        let body = bytes
            .get(body_start..)
            .and_then(|rest| rest.get(..size))
            .ok_or_else(|| invalid("a WebM element is longer than the file"))?;
        at = body_start + size;
        match id {
            TRACK_NUMBER | TRACK_TYPE | CODEC_ID | CODEC_PRIVATE => {
                let Some(track) = tracks.last_mut() else {
                    continue;
                };
                match id {
                    TRACK_NUMBER => track.number = Some(uint(body)?),
                    TRACK_TYPE => track.kind = Some(uint(body)?),
                    CODEC_ID => track.codec = body.to_vec(),
                    _ => track.private = body.to_vec(),
                }
            }
            SIMPLE_BLOCK | BLOCK => {
                if let Audio::NotYet = audio {
                    audio = open_audio(&tracks)?;
                }
                let Audio::Opus { number, decoder } = &mut audio else {
                    unreachable!("opened above");
                };
                block(body, *number, decoder)?;
            }
            _ => {}
        }
    }
    match audio {
        Audio::Opus { decoder, .. } => decoder.finish(None),
        Audio::NotYet => Err(invalid("it has no audio")),
    }
}

fn open_audio(tracks: &[Track]) -> Result<Audio, DecodeError> {
    let track = tracks
        .iter()
        .find(|track| track.kind == Some(AUDIO))
        .ok_or_else(|| invalid("it has no audio track"))?;
    let number = track
        .number
        .ok_or_else(|| invalid("its audio track has no number"))?;
    match track.codec.as_slice() {
        b"A_OPUS" => {}
        b"A_VORBIS" => return Err(DecodeError::Unsupported("WebM Vorbis")),
        _ => return Err(DecodeError::Unsupported("WebM with an unusual codec")),
    }
    let head = opus::parse_head(&track.private)?;
    Ok(Audio::Opus {
        number,
        decoder: Decoder::new(head)?,
    })
}

/// A (Simple)Block: track number, a 16-bit timecode, flags, then the frame.
fn block(body: &[u8], audio_track: u64, decoder: &mut Decoder) -> Result<(), DecodeError> {
    let (track, length) = read_vint(body, 0)?;
    let header = length + 3;
    if body.len() < header {
        return Err(invalid("a WebM block is too short"));
    }
    if track != Some(audio_track) {
        return Ok(());
    }
    let lacing = (body[length + 2] >> 1) & 0b11;
    if lacing != 0 {
        return Err(DecodeError::Unsupported("WebM with laced audio"));
    }
    decoder.push(&body[header..])
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::soundboard::ogg::tests::tone;
    use crate::soundboard::opus::encode;

    fn id_bytes(id: u32) -> Vec<u8> {
        let bytes = id.to_be_bytes();
        let skip = bytes.iter().take_while(|&&b| b == 0).count();
        bytes[skip..].to_vec()
    }

    /// An element with an 8-byte size, or "unknown" with `None`.
    pub(crate) fn element(id: u32, body: &[u8], known: bool) -> Vec<u8> {
        let mut out = id_bytes(id);
        if known {
            out.push(0x01);
            out.extend_from_slice(&(body.len() as u64).to_be_bytes()[1..]);
        } else {
            out.extend_from_slice(&[0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF]);
        }
        out.extend_from_slice(body);
        out
    }

    fn simple_block(track: u8, flags: u8, frame: &[u8]) -> Vec<u8> {
        let mut body = vec![0x80 | track, 0, 0, flags];
        body.extend_from_slice(frame);
        element(SIMPLE_BLOCK, &body, true)
    }

    /// 0.5 s of 440 Hz as a browser would record it: unknown-size Segment and Cluster.
    pub(crate) fn webm_opus(codec: &[u8], flags: u8, in_groups: bool) -> Vec<u8> {
        let mut file = element(EBML, &element(0x4282, b"webm", true), true);
        let mut entry = element(TRACK_NUMBER, &[1], true);
        entry.extend(element(TRACK_TYPE, &[2], true));
        entry.extend(element(CODEC_ID, codec, true));
        entry.extend(element(CODEC_PRIVATE, &encode::head(1, 312), true));
        let mut segment = element(TRACKS, &element(TRACK_ENTRY, &entry, true), true);
        let mut cluster = element(0xE7, &[0], true);
        for packet in encode::packets(&tone(24_000, 1), 1) {
            let block = simple_block(1, flags, &packet);
            if in_groups {
                let mut plain = block.clone();
                // Same layout under the Block ID.
                plain[0] = BLOCK as u8;
                cluster.extend(element(BLOCK_GROUP, &plain, true));
            } else {
                cluster.extend(block);
            }
        }
        // A video track's block in the middle is ignored.
        cluster.extend(simple_block(2, 0x80, &[1, 2, 3]));
        segment.extend(element(CLUSTER, &cluster, false));
        file.extend(element(SEGMENT, &segment, false));
        file
    }

    #[test]
    fn simple_blocks_and_block_groups_decode() {
        for in_groups in [false, true] {
            let pcm = decode(&webm_opus(b"A_OPUS", 0x80, in_groups)).unwrap();
            // Whole 20 ms packets, less the pre-skip.
            assert_eq!(pcm.samples.len(), 25 * 960 - 312);
            let energy: f32 = pcm.samples.iter().map(|s| s * s).sum();
            assert!(energy > 100.0);
        }
    }

    #[test]
    fn malformed_files_are_refused_without_panicking() {
        let good = webm_opus(b"A_OPUS", 0x80, false);
        for cut in (0..good.len()).step_by(5) {
            let _ = decode(&good[..cut]);
        }
        assert!(matches!(
            decode(&webm_opus(b"A_OPUS", 0x80 | 0b10, false)),
            Err(DecodeError::Unsupported("WebM with laced audio"))
        ));
        assert!(matches!(
            decode(&webm_opus(b"A_VORBIS", 0x80, false)),
            Err(DecodeError::Unsupported("WebM Vorbis"))
        ));
        // An element claiming more than the file holds.
        let mut huge = element(EBML, &[], true);
        huge.extend(element(0xEC, &[0; 4], true));
        let at = huge.len() - 4 - 7;
        huge[at..at + 7].copy_from_slice(&[0x7F; 7]);
        assert!(matches!(decode(&huge), Err(DecodeError::Invalid(_))));
        // A non-master with an unknown size.
        let mut unknown = element(EBML, &[], true);
        unknown.extend(element(0xEC, &[], false));
        assert!(matches!(decode(&unknown), Err(DecodeError::Invalid(_))));
        // A zero byte can't start an ID or a size.
        assert!(decode(&[0x1A, 0x45, 0xDF, 0xA3, 0x00]).is_err());
        assert!(decode(&[0x00, 0x00]).is_err());
        // No tracks before the first block.
        let mut orphan = element(EBML, &[], true);
        orphan.extend(simple_block(1, 0x80, &[0xF8]));
        assert!(matches!(decode(&orphan), Err(DecodeError::Invalid(_))));
        // Too many track entries.
        let mut crowded = element(EBML, &[], true);
        for _ in 0..=MAX_TRACKS {
            crowded.extend(element(TRACK_ENTRY, &[], true));
        }
        assert!(matches!(decode(&crowded), Err(DecodeError::Invalid(_))));
        // A block too short for its header.
        let mut stub = good.clone();
        stub.extend(element(SIMPLE_BLOCK, &[0x81], true));
        assert!(decode(&stub).is_err());
    }
}
