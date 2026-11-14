//! An MPEG-TS demuxer for the replay preview's HLS segments (ISO/IEC 13818-1), by hand: the
//! FFmpeg inside libwebrtc has no MPEG-TS demuxer (docs/player.md). A whole segment is in memory,
//! so [`demux`] parses it at once into access units in file order.
//!
//! - **Packets** of 188 bytes, or 192 (M2TS, a 4-byte timestamp before each: LiveKit egress's
//!   "HDMV-style" TS, which the backend serves as is when its remux fails), found by the sync
//!   byte's spacing. Lost sync is found again; packets with the error bit or scrambling are
//!   dropped.
//! - **PSI**: the PAT's first program, its PMT (sections may span packets; CRC-32 checked).
//! - **Streams** by PMT stream type: H.264 (0x1B), AAC in ADTS (0x0F), Opus (0x06 with an
//!   `Opus` registration descriptor). The rest are listed as [`StreamType::Other`].
//! - **PES** reassembled per stream, 33-bit PTS and DTS read. A continuity-counter gap drops the
//!   PES it broke (counted in [`Demuxed::skipped`]); a repeated counter is a duplicate packet.
//! - **AAC**: one unit per ADTS frame, header included (FFmpeg's AAC decoder reads it), timed
//!   from the PES's PTS plus 1024 samples per frame. A frame cut across PES packets is joined.
//! - **Keyframes**: the adaptation field's random-access flag, or an IDR NAL in the unit.

use std::collections::HashMap;

/// Plain TS.
pub const TS_PACKET: usize = 188;
/// M2TS: a 4-byte arrival timestamp, then a TS packet.
pub const M2TS_PACKET: usize = 192;
const SYNC: u8 = 0x47;
const PID_PAT: u16 = 0;
const PID_NULL: u16 = 0x1FFF;
/// PTS and DTS wrap at 2^33 ticks of 90 kHz (about 26.5 hours).
pub const PTS_WRAP: u64 = 1 << 33;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StreamType {
    H264,
    AacAdts,
    Opus,
    Other(u8),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EsInfo {
    pub pid: u16,
    pub stream_type: StreamType,
}

/// One access unit: a video PES, or one ADTS frame.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Unit {
    pub pid: u16,
    /// 90 kHz ticks, 33 bits as in the stream (not unwrapped).
    pub pts: Option<u64>,
    pub dts: Option<u64>,
    pub data: Vec<u8>,
    pub keyframe: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Demuxed {
    pub packet_size: usize,
    /// In PMT order.
    pub streams: Vec<EsInfo>,
    /// In file order.
    pub units: Vec<Unit>,
    /// Packets or PES dropped as broken.
    pub skipped: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TsError {
    /// No run of sync bytes: not MPEG-TS.
    NotTs,
    /// TS, but no PAT and PMT naming a stream.
    NoProgram,
}

/// The packet size and the offset of the first sync byte: the first offset where sync bytes
/// repeat at that spacing (3 in a row, or to the end of a shorter buffer).
pub fn detect_packets(bytes: &[u8]) -> Option<(usize, usize)> {
    let limit = bytes.len().min(M2TS_PACKET * 4);
    for offset in 0..limit {
        for size in [TS_PACKET, M2TS_PACKET] {
            if syncs_from(bytes, offset, size) {
                return Some((size, offset));
            }
        }
    }
    None
}

fn syncs_from(bytes: &[u8], offset: usize, size: usize) -> bool {
    let mut seen = 0;
    let mut at = offset;
    while at < bytes.len() && seen < 5 {
        if bytes[at] != SYNC {
            break;
        }
        seen += 1;
        at += size;
    }
    // Three in a row (sync can be lost later), or every packet of a buffer too short for three.
    seen >= 3 || (seen >= 1 && at >= bytes.len() && bytes.len() - offset >= TS_PACKET)
}

/// MPEG-2's CRC-32 (polynomial 0x04C11DB7, initial all ones, not reflected, no final xor), as PSI
/// sections end with. A section including its CRC checks to zero.
pub fn crc32_mpeg2(bytes: &[u8]) -> u32 {
    let mut crc = 0xFFFF_FFFFu32;
    for &byte in bytes {
        crc ^= u32::from(byte) << 24;
        for _ in 0..8 {
            crc = if crc & 0x8000_0000 != 0 {
                (crc << 1) ^ 0x04C1_1DB7
            } else {
                crc << 1
            };
        }
    }
    crc
}

/// `pts` moved next to `reference`: the nearest value congruent to it mod 2^33, as a signed
/// tick count, so a stream that wraps keeps counting up.
pub fn unwrap_pts(pts: u64, reference: u64) -> i64 {
    let pts = pts % PTS_WRAP;
    let reference = reference % PTS_WRAP;
    let diff = (pts as i64 - reference as i64).rem_euclid(PTS_WRAP as i64);
    let diff = if diff >= (PTS_WRAP / 2) as i64 {
        diff - PTS_WRAP as i64
    } else {
        diff
    };
    reference as i64 + diff
}

/// A PTS or DTS field: 4 bits prefix, then 33 bits in 3, 15 and 15 with marker bits.
fn timestamp(b: &[u8]) -> Option<u64> {
    if b.len() < 5 || b[0] & 1 == 0 || b[2] & 1 == 0 || b[4] & 1 == 0 {
        return None;
    }
    Some(
        (u64::from(b[0] >> 1) & 0x07) << 30
            | u64::from(b[1]) << 22
            | (u64::from(b[2]) >> 1) << 15
            | u64::from(b[3]) << 7
            | u64::from(b[4]) >> 1,
    )
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Pes {
    pub pts: Option<u64>,
    pub dts: Option<u64>,
    pub payload: Vec<u8>,
}

/// A whole PES packet: its timestamps and payload. `None` if it isn't one.
pub fn parse_pes(bytes: &[u8]) -> Option<Pes> {
    if bytes.len() < 6 || bytes[..3] != [0, 0, 1] {
        return None;
    }
    let stream_id = bytes[3];
    let length = usize::from(u16::from_be_bytes([bytes[4], bytes[5]]));
    let end = if length == 0 {
        bytes.len()
    } else {
        (6 + length).min(bytes.len())
    };
    // Streams without the optional header (padding, private_stream_2, ECM, EMM, DSMCC, H.222.1
    // type E, program stream directory and map).
    if matches!(
        stream_id,
        0xBC | 0xBE | 0xBF | 0xF0 | 0xF1 | 0xF2 | 0xF8 | 0xFF
    ) {
        return Some(Pes {
            pts: None,
            dts: None,
            payload: bytes[6..end].to_vec(),
        });
    }
    if end < 9 || bytes[6] & 0xC0 != 0x80 {
        return None;
    }
    let flags = bytes[7] >> 6;
    let header = usize::from(bytes[8]);
    let start = 9 + header;
    if start > end {
        return None;
    }
    let fields = &bytes[9..start];
    let (pts, dts) = match flags {
        2 => (timestamp(fields), None),
        3 => {
            let pts = timestamp(fields);
            (pts, fields.get(5..).and_then(timestamp))
        }
        _ => (None, None),
    };
    Some(Pes {
        pts,
        dts,
        payload: bytes[start..end].to_vec(),
    })
}

/// An ADTS header (ISO/IEC 14496-3, 1.A.2).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AdtsHeader {
    /// MPEG-4 audio object type: profile + 1 (2 is AAC-LC).
    pub object_type: u8,
    pub sample_rate: u32,
    /// 0 means "in the bitstream" (a program config element).
    pub channels: u8,
    /// The whole frame, header included.
    pub frame_length: usize,
    pub header_length: usize,
    /// Raw data blocks in the frame, each 1024 samples.
    pub blocks: u8,
}

impl AdtsHeader {
    /// The profile field says AAC-LC: object type 2. ADTS can say Main, LC, SSR or LTP only, so
    /// this is the whole of what the header can promise (docs/player.md).
    pub fn is_lc(&self) -> bool {
        self.object_type == 2
    }
}

const ADTS_RATES: [u32; 13] = [
    96_000, 88_200, 64_000, 48_000, 44_100, 32_000, 24_000, 22_050, 16_000, 12_000, 11_025, 8_000,
    7_350,
];

/// The header at the start of `b`, if one is there and makes sense.
pub fn adts_header(b: &[u8]) -> Option<AdtsHeader> {
    if b.len() < 7 || b[0] != 0xFF || b[1] & 0xF0 != 0xF0 || b[1] & 0x06 != 0 {
        return None;
    }
    let protection_absent = b[1] & 1 == 1;
    let rate_index = usize::from((b[2] >> 2) & 0x0F);
    let sample_rate = *ADTS_RATES.get(rate_index)?;
    let channels = ((b[2] & 1) << 2) | (b[3] >> 6);
    let frame_length =
        (usize::from(b[3] & 0x03) << 11) | (usize::from(b[4]) << 3) | (usize::from(b[5]) >> 5);
    let header_length = if protection_absent { 7 } else { 9 };
    if frame_length < header_length {
        return None;
    }
    Some(AdtsHeader {
        object_type: (b[2] >> 6) + 1,
        sample_rate,
        channels,
        frame_length,
        header_length,
        blocks: (b[6] & 0x03) + 1,
    })
}

/// Splits ADTS payloads into frames, carrying a frame cut across PES packets to the next and
/// timing each from the PES's PTS (or the previous frame's end).
#[derive(Debug, Default)]
pub struct AdtsSplitter {
    carry: Vec<u8>,
    /// The next frame's PTS when a PES doesn't say, 90 kHz.
    next_pts: Option<u64>,
    /// Bytes thrown away while looking for a sync word.
    pub skipped_bytes: u64,
}

/// One ADTS frame, header included.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AdtsFrame {
    pub header: AdtsHeader,
    pub pts: Option<u64>,
    pub data: Vec<u8>,
}

impl AdtsSplitter {
    /// The frames that end in `payload`. A carried partial frame starts the list, timed from
    /// before `pts`, which belongs to the first frame that starts in this payload.
    pub fn push(&mut self, payload: &[u8], pts: Option<u64>) -> Vec<AdtsFrame> {
        let carried = self.carry.len();
        let mut buf = std::mem::take(&mut self.carry);
        buf.extend_from_slice(payload);
        let mut frames = Vec::new();
        let mut at = 0;
        // The PES's PTS applies to the first frame starting in its payload.
        let mut pending_pts = pts;
        while at + 7 <= buf.len() {
            let Some(header) = adts_header(&buf[at..]) else {
                at += 1;
                self.skipped_bytes += 1;
                continue;
            };
            if at + header.frame_length > buf.len() {
                break;
            }
            let starts_here = at >= carried;
            if starts_here && let Some(pts) = pending_pts.take() {
                self.next_pts = Some(pts);
            }
            let frame_pts = self.next_pts;
            let ticks = u64::from(header.blocks) * 1024 * 90_000 / u64::from(header.sample_rate);
            self.next_pts = frame_pts.map(|p| (p + ticks) % PTS_WRAP);
            frames.push(AdtsFrame {
                header,
                pts: frame_pts,
                data: buf[at..at + header.frame_length].to_vec(),
            });
            at += header.frame_length;
        }
        if let Some(pts) = pending_pts {
            // No frame started in this payload: the PTS times the next one.
            self.next_pts = Some(pts);
        }
        self.carry = buf[at..].to_vec();
        frames
    }

    /// Drops a partial frame (the stream broke).
    pub fn reset(&mut self) {
        self.carry.clear();
    }
}

/// An IDR slice (NAL type 5) among the Annex B NAL units of `data`.
pub fn h264_has_idr(data: &[u8]) -> bool {
    let mut i = 0;
    while i + 3 < data.len() {
        if data[i] == 0 && data[i + 1] == 0 && data[i + 2] == 1 {
            if data[i + 3] & 0x1F == 5 {
                return true;
            }
            i += 3;
        } else {
            i += 1;
        }
    }
    false
}

/// A PSI table's sections reassembled from packet payloads.
#[derive(Debug, Default)]
struct Section {
    buf: Vec<u8>,
    started: bool,
}

impl Section {
    /// Feeds one packet's payload; returns complete sections that passed their CRC.
    fn push(&mut self, payload: &[u8], unit_start: bool, skipped: &mut u64) -> Vec<Vec<u8>> {
        let mut out = Vec::new();
        let mut data = payload;
        if unit_start {
            let Some((&pointer, rest)) = data.split_first() else {
                return out;
            };
            let pointer = usize::from(pointer);
            if pointer > rest.len() {
                self.buf.clear();
                self.started = false;
                return out;
            }
            // The end of the previous section, then a new one.
            if self.started {
                self.buf.extend_from_slice(&rest[..pointer]);
                self.take(&mut out, skipped);
            }
            self.buf.clear();
            self.started = true;
            data = &rest[pointer..];
        } else if !self.started {
            return out;
        }
        self.buf.extend_from_slice(data);
        self.take(&mut out, skipped);
        out
    }

    fn take(&mut self, out: &mut Vec<Vec<u8>>, skipped: &mut u64) {
        loop {
            if self.buf.first().is_none_or(|&t| t == 0xFF) {
                // Stuffing after the last section.
                self.buf.clear();
                return;
            }
            if self.buf.len() < 3 {
                return;
            }
            let length = (usize::from(self.buf[1] & 0x0F) << 8) | usize::from(self.buf[2]);
            let total = 3 + length;
            if self.buf.len() < total {
                return;
            }
            let section: Vec<u8> = self.buf.drain(..total).collect();
            if section.len() >= 7 && crc32_mpeg2(&section) == 0 {
                out.push(section);
            } else {
                *skipped += 1;
            }
        }
    }
}

/// The PMT PID of the first program in a PAT section.
fn parse_pat(section: &[u8]) -> Option<u16> {
    if section.first() != Some(&0x00) || section.len() < 12 {
        return None;
    }
    let entries = &section[8..section.len() - 4];
    entries.as_chunks::<4>().0.iter().find_map(|e| {
        let program = u16::from_be_bytes([e[0], e[1]]);
        let pid = u16::from_be_bytes([e[2] & 0x1F, e[3]]);
        (program != 0).then_some(pid)
    })
}

fn parse_pmt(section: &[u8]) -> Option<Vec<EsInfo>> {
    if section.first() != Some(&0x02) || section.len() < 16 {
        return None;
    }
    let end = section.len() - 4;
    let info_length = (usize::from(section[10] & 0x0F) << 8) | usize::from(section[11]);
    let mut at = 12 + info_length;
    let mut streams = Vec::new();
    while at + 5 <= end {
        let raw_type = section[at];
        let pid = u16::from_be_bytes([section[at + 1] & 0x1F, section[at + 2]]);
        let es_length = (usize::from(section[at + 3] & 0x0F) << 8) | usize::from(section[at + 4]);
        let descriptors = section.get(at + 5..(at + 5 + es_length).min(end))?;
        let stream_type = match raw_type {
            0x1B => StreamType::H264,
            0x0F => StreamType::AacAdts,
            0x06 if registration(descriptors) == Some(*b"Opus") => StreamType::Opus,
            other => StreamType::Other(other),
        };
        streams.push(EsInfo { pid, stream_type });
        at += 5 + es_length;
    }
    Some(streams)
}

/// The format identifier of a registration descriptor (tag 5) among `descriptors`.
fn registration(mut descriptors: &[u8]) -> Option<[u8; 4]> {
    while descriptors.len() >= 2 {
        let (tag, length) = (descriptors[0], usize::from(descriptors[1]));
        let body = descriptors.get(2..2 + length)?;
        if tag == 0x05 && body.len() >= 4 {
            return Some([body[0], body[1], body[2], body[3]]);
        }
        descriptors = &descriptors[2 + length..];
    }
    None
}

/// A PES being reassembled.
#[derive(Debug, Default)]
struct Assembly {
    buf: Vec<u8>,
    random_access: bool,
    /// Started at a unit start and unbroken since.
    good: bool,
    last_cc: Option<u8>,
}

/// Parses a whole segment.
pub fn demux(bytes: &[u8]) -> Result<Demuxed, TsError> {
    let (size, first) = detect_packets(bytes).ok_or(TsError::NotTs)?;
    // The sync byte sits after M2TS's 4-byte timestamp: packets start at the sync byte.
    let mut out = Demuxed {
        packet_size: size,
        ..Demuxed::default()
    };
    let mut pat = Section::default();
    let mut pmt = Section::default();
    let mut pmt_pid: Option<u16> = None;
    let mut assemblies: HashMap<u16, Assembly> = HashMap::new();
    let mut adts: HashMap<u16, AdtsSplitter> = HashMap::new();
    let mut at = first;
    while at + TS_PACKET <= bytes.len() {
        if bytes[at] != SYNC {
            // Lost sync: the next offset where the spacing holds again.
            out.skipped += 1;
            match (at + 1..bytes.len())
                .find(|&o| bytes[o] == SYNC && (o + size >= bytes.len() || bytes[o + size] == SYNC))
            {
                Some(next) => {
                    at = next;
                    continue;
                }
                None => break,
            }
        }
        let packet = &bytes[at..at + TS_PACKET];
        at += size;
        let error = packet[1] & 0x80 != 0;
        let unit_start = packet[1] & 0x40 != 0;
        let pid = u16::from_be_bytes([packet[1] & 0x1F, packet[2]]);
        let scrambled = packet[3] & 0xC0 != 0;
        let control = (packet[3] >> 4) & 0x03;
        let cc = packet[3] & 0x0F;
        if pid == PID_NULL {
            continue;
        }
        if error || scrambled || control == 0 {
            out.skipped += 1;
            if let Some(a) = assemblies.get_mut(&pid) {
                a.good = false;
            }
            continue;
        }
        let mut payload_at = 4;
        let mut random_access = false;
        let mut discontinuity = false;
        if control & 0x02 != 0 {
            let length = usize::from(packet[4]);
            if 5 + length > TS_PACKET {
                out.skipped += 1;
                continue;
            }
            if length > 0 {
                discontinuity = packet[5] & 0x80 != 0;
                random_access = packet[5] & 0x40 != 0;
            }
            payload_at = 5 + length;
        }
        let has_payload = control & 0x01 != 0;
        let payload = if has_payload {
            &packet[payload_at..]
        } else {
            &[][..]
        };

        if pid == PID_PAT {
            for section in pat.push(payload, unit_start, &mut out.skipped) {
                if let Some(found) = parse_pat(&section) {
                    pmt_pid = Some(found);
                }
            }
            continue;
        }
        if Some(pid) == pmt_pid {
            for section in pmt.push(payload, unit_start, &mut out.skipped) {
                if let Some(streams) = parse_pmt(&section) {
                    // A new version replaces the list.
                    out.streams = streams;
                }
            }
            continue;
        }
        let Some(info) = out.streams.iter().find(|s| s.pid == pid).copied() else {
            continue;
        };
        let assembly = assemblies.entry(pid).or_default();
        if has_payload {
            if let Some(last) = assembly.last_cc
                && !discontinuity
            {
                if cc == last {
                    // A duplicate packet (allowed once): ignore it.
                    continue;
                }
                if cc != (last + 1) & 0x0F {
                    assembly.good = false;
                }
            }
            assembly.last_cc = Some(cc);
        }
        if unit_start {
            finish(&mut out, info, assembly, adts.entry(pid).or_default());
            assembly.buf.clear();
            assembly.good = true;
            assembly.random_access = random_access;
        }
        if assembly.good {
            assembly.buf.extend_from_slice(payload);
        }
    }
    for info in out.streams.clone() {
        if let Some(assembly) = assemblies.get_mut(&info.pid) {
            finish(&mut out, info, assembly, adts.entry(info.pid).or_default());
        }
    }
    if out.streams.is_empty() {
        return Err(TsError::NoProgram);
    }
    Ok(out)
}

/// The PES in `assembly` is complete: into units.
fn finish(out: &mut Demuxed, info: EsInfo, assembly: &mut Assembly, adts: &mut AdtsSplitter) {
    if assembly.buf.is_empty() {
        return;
    }
    let buf = std::mem::take(&mut assembly.buf);
    if !assembly.good {
        out.skipped += 1;
        adts.reset();
        return;
    }
    let Some(pes) = parse_pes(&buf) else {
        out.skipped += 1;
        adts.reset();
        return;
    };
    match info.stream_type {
        StreamType::AacAdts => {
            for frame in adts.push(&pes.payload, pes.pts) {
                out.units.push(Unit {
                    pid: info.pid,
                    pts: frame.pts,
                    dts: frame.pts,
                    data: frame.data,
                    keyframe: true,
                });
            }
        }
        _ => {
            let keyframe = assembly.random_access
                || (info.stream_type == StreamType::H264 && h264_has_idr(&pes.payload));
            out.units.push(Unit {
                pid: info.pid,
                pts: pes.pts,
                dts: pes.dts.or(pes.pts),
                data: pes.payload,
                keyframe,
            });
        }
    }
}

#[cfg(test)]
#[path = "ts_tests.rs"]
mod tests;
