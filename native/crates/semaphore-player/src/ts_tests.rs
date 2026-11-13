//! `ts.rs` on packets built here, byte by byte, from the spec.

use super::*;

const VIDEO: u16 = 0x100;
const AUDIO: u16 = 0x101;
const PMT: u16 = 0x1000;

/// One 188-byte packet; a short payload is padded with adaptation-field stuffing, as muxers do.
fn packet(pid: u16, unit_start: bool, cc: u8, random_access: bool, payload: &[u8]) -> Vec<u8> {
    assert!(payload.len() <= 184);
    let mut p = vec![
        SYNC,
        (u8::from(unit_start) << 6) | (pid >> 8) as u8,
        pid as u8,
        0,
    ];
    let needs_af = payload.len() < 184 || random_access;
    let control = if needs_af { 0x30 } else { 0x10 };
    p[3] = control | (cc & 0x0F);
    if needs_af {
        let room = 184 - payload.len();
        let af_length = room - 1;
        p.push(af_length as u8);
        if af_length > 0 {
            p.push(if random_access { 0x40 } else { 0 });
            p.extend(std::iter::repeat_n(0xFF, af_length - 1));
        }
    }
    p.extend_from_slice(payload);
    assert_eq!(p.len(), 188);
    p
}

/// `bytes` cut into packets of `pid`, the first a unit start, counters from `cc`.
fn packetize(pid: u16, bytes: &[u8], cc: &mut u8, random_access: bool) -> Vec<Vec<u8>> {
    let mut out = Vec::new();
    let mut first = true;
    for chunk in bytes.chunks(if random_access { 182 } else { 184 }) {
        out.push(packet(pid, first, *cc, random_access && first, chunk));
        *cc = (*cc + 1) & 0x0F;
        first = false;
    }
    out
}

fn with_crc(mut section: Vec<u8>) -> Vec<u8> {
    let crc = crc32_mpeg2(&section);
    section.extend_from_slice(&crc.to_be_bytes());
    section
}

/// A section from table id and body (after the 5 bytes of id, version and numbers).
fn section(table_id: u8, id: u16, body: &[u8]) -> Vec<u8> {
    let length = 5 + body.len() + 4;
    let mut s = vec![
        table_id,
        0xB0 | (length >> 8) as u8,
        length as u8,
        (id >> 8) as u8,
        id as u8,
        0xC1,
        0,
        0,
    ];
    s.extend_from_slice(body);
    with_crc(s)
}

fn pat(pmt_pid: u16) -> Vec<u8> {
    // A NIT entry (program 0) first: skipped.
    section(
        0x00,
        1,
        &[
            0,
            0,
            0xE0,
            0x10,
            0,
            1,
            0xE0 | (pmt_pid >> 8) as u8,
            pmt_pid as u8,
        ],
    )
}

fn pmt(streams: &[(u8, u16, &[u8])]) -> Vec<u8> {
    let mut body = vec![0xE0 | (VIDEO >> 8) as u8, VIDEO as u8, 0xF0, 0];
    for (stream_type, pid, descriptors) in streams {
        body.push(*stream_type);
        body.push(0xE0 | (pid >> 8) as u8);
        body.push(*pid as u8);
        body.push(0xF0 | (descriptors.len() >> 8) as u8);
        body.push(descriptors.len() as u8);
        body.extend_from_slice(descriptors);
    }
    section(0x02, 1, &body)
}

fn psi(pid: u16, section: &[u8]) -> Vec<u8> {
    let mut payload = vec![0];
    payload.extend_from_slice(section);
    packet(pid, true, 0, false, &payload)
}

fn ts_field(prefix: u8, t: u64) -> [u8; 5] {
    [
        (prefix << 4) | (((t >> 30) as u8 & 0x07) << 1) | 1,
        (t >> 22) as u8,
        (((t >> 15) as u8) << 1) | 1,
        (t >> 7) as u8,
        ((t as u8) << 1) | 1,
    ]
}

fn pes(
    stream_id: u8,
    pts: Option<u64>,
    dts: Option<u64>,
    payload: &[u8],
    bounded: bool,
) -> Vec<u8> {
    let mut fields = Vec::new();
    let flags = match (pts, dts) {
        (Some(p), Some(d)) => {
            fields.extend(ts_field(3, p));
            fields.extend(ts_field(1, d));
            0xC0
        }
        (Some(p), None) => {
            fields.extend(ts_field(2, p));
            0x80
        }
        _ => 0,
    };
    let length = if bounded {
        3 + fields.len() + payload.len()
    } else {
        0
    };
    let mut out = vec![0, 0, 1, stream_id, (length >> 8) as u8, length as u8];
    out.extend([0x80, flags, fields.len() as u8]);
    out.extend(fields);
    out.extend_from_slice(payload);
    out
}

/// An ADTS frame of AAC-LC at 48 kHz stereo with `body` after its header.
fn adts(body: &[u8], crc: bool) -> Vec<u8> {
    let header = if crc { 9 } else { 7 };
    let length = header + body.len();
    let mut f = vec![
        0xFF,
        0xF0 | u8::from(!crc),
        (1 << 6) | (3 << 2),
        (2 << 6) | ((length >> 11) as u8 & 0x03),
        (length >> 3) as u8,
        ((length as u8 & 0x07) << 5) | 0x1F,
        0xFC,
    ];
    if crc {
        f.extend([0xAB, 0xCD]);
    }
    f.extend_from_slice(body);
    f
}

const IDR: &[u8] = &[
    0, 0, 0, 1, 0x09, 0xF0, 0, 0, 0, 1, 0x67, 0x42, 0, 0, 1, 0x65, 0x88, 0x84,
];
const P_SLICE: &[u8] = &[0, 0, 0, 1, 0x09, 0xF0, 0, 0, 1, 0x41, 0x9A, 0x02];

fn header() -> Vec<Vec<u8>> {
    vec![
        psi(0, &pat(PMT)),
        psi(PMT, &pmt(&[(0x1B, VIDEO, &[]), (0x0F, AUDIO, &[])])),
    ]
}

fn join(packets: Vec<Vec<u8>>) -> Vec<u8> {
    packets.concat()
}

#[test]
fn crc32_matches_the_mpeg2_check_value() {
    assert_eq!(crc32_mpeg2(b"123456789"), 0x0376_E6E7);
    assert_eq!(crc32_mpeg2(&with_crc(b"anything".to_vec())), 0);
}

#[test]
fn timestamps_decode_every_bit_and_check_markers() {
    for t in [0, 1, 90_000, 0x1_2345_6789 & (PTS_WRAP - 1), PTS_WRAP - 1] {
        assert_eq!(timestamp(&ts_field(2, t)), Some(t), "{t}");
    }
    let mut broken = ts_field(2, 5);
    broken[2] &= !1;
    assert_eq!(timestamp(&broken), None);
    assert_eq!(timestamp(&[0x21, 0, 1]), None);
}

#[test]
fn unwrapping_keeps_counting_across_the_33_bit_wrap() {
    assert_eq!(unwrap_pts(100, 50), 100);
    assert_eq!(unwrap_pts(50, 100), 50);
    assert_eq!(unwrap_pts(10, PTS_WRAP - 10), PTS_WRAP as i64 + 10);
    assert_eq!(unwrap_pts(PTS_WRAP - 10, 10), -10);
    assert_eq!(unwrap_pts(PTS_WRAP + 5, 0), 5);
}

#[test]
fn packets_are_found_by_their_spacing() {
    let plain = join(header());
    assert_eq!(detect_packets(&plain), Some((188, 0)));

    let mut prefixed = vec![0x47, 1, 2, 0x47, 9];
    prefixed.extend_from_slice(&plain);
    assert_eq!(detect_packets(&prefixed), Some((188, 5)));

    // Arrival timestamps count up.
    let m2ts: Vec<u8> = header()
        .into_iter()
        .chain(header())
        .enumerate()
        .flat_map(|(i, p)| [vec![0, 1, i as u8, 3 * i as u8], p].concat())
        .collect();
    assert_eq!(detect_packets(&m2ts), Some((192, 4)));

    assert_eq!(detect_packets(b"#EXTM3U\n#EXT-X-VERSION:3\n"), None);
    assert_eq!(detect_packets(&[]), None);
    assert_eq!(demux(&[0u8; 1000]), Err(TsError::NotTs));
}

#[test]
fn a_video_pes_across_packets_comes_out_whole_with_pts_and_dts() {
    let payload: Vec<u8> = IDR
        .iter()
        .copied()
        .chain((0..1000).map(|i| i as u8))
        .collect();
    let mut cc = 0;
    let mut packets = header();
    packets.extend(packetize(
        VIDEO,
        &pes(0xE0, Some(126_000), Some(117_000), &payload, false),
        &mut cc,
        true,
    ));
    packets.extend(packetize(
        VIDEO,
        &pes(0xE0, Some(135_000), None, P_SLICE, false),
        &mut cc,
        false,
    ));
    let out = demux(&join(packets)).unwrap();
    assert_eq!(out.packet_size, 188);
    assert_eq!(
        out.streams,
        vec![
            EsInfo {
                pid: VIDEO,
                stream_type: StreamType::H264
            },
            EsInfo {
                pid: AUDIO,
                stream_type: StreamType::AacAdts
            }
        ]
    );
    assert_eq!(out.units.len(), 2);
    assert_eq!(out.units[0].data, payload);
    assert_eq!(out.units[0].pts, Some(126_000));
    assert_eq!(out.units[0].dts, Some(117_000));
    assert!(out.units[0].keyframe);
    assert_eq!(out.units[1].data, P_SLICE);
    assert_eq!(out.units[1].dts, Some(135_000), "DTS defaults to the PTS");
    assert!(!out.units[1].keyframe);
    assert_eq!(out.skipped, 0);
}

#[test]
fn an_idr_marks_a_keyframe_without_the_random_access_flag() {
    let mut cc = 0;
    let mut packets = header();
    packets.extend(packetize(
        VIDEO,
        &pes(0xE0, Some(1), None, IDR, false),
        &mut cc,
        false,
    ));
    let out = demux(&join(packets)).unwrap();
    assert!(out.units[0].keyframe);
    assert!(h264_has_idr(IDR));
    assert!(!h264_has_idr(P_SLICE));
    assert!(!h264_has_idr(&[0, 0, 1]));
}

#[test]
fn a_bounded_pes_length_cuts_trailing_bytes() {
    let mut bytes = pes(0xE0, Some(9), None, P_SLICE, true);
    bytes.extend([0xEE; 7]);
    let parsed = parse_pes(&bytes).unwrap();
    assert_eq!(parsed.payload, P_SLICE);
    assert_eq!(parsed.pts, Some(9));
    assert_eq!(parse_pes(&[0, 0, 2, 0xE0, 0, 0, 0x80, 0, 0]), None);
    assert_eq!(
        parse_pes(&[0, 0, 1, 0xE0, 0, 0, 0x40, 0, 0]),
        None,
        "bad marker bits"
    );
    assert_eq!(
        parse_pes(&[0, 0, 1, 0xE0, 0, 0, 0x80, 0x80, 9, 1]),
        None,
        "header past the end"
    );
    let padding = parse_pes(&[0, 0, 1, 0xBE, 0, 2, 0xFF, 0xFF]).unwrap();
    assert_eq!(padding.payload, [0xFF, 0xFF]);
    assert_eq!(padding.pts, None);
}

#[test]
fn several_adts_frames_in_one_pes_are_timed_1024_samples_apart() {
    let frames: Vec<Vec<u8>> = (0..3).map(|i| adts(&[i; 20], false)).collect();
    let mut cc = 0;
    let mut packets = header();
    packets.extend(packetize(
        AUDIO,
        &pes(0xC0, Some(90_000), None, &frames.concat(), true),
        &mut cc,
        false,
    ));
    let out = demux(&join(packets)).unwrap();
    let pts: Vec<_> = out.units.iter().map(|u| u.pts).collect();
    assert_eq!(pts, [Some(90_000), Some(91_920), Some(93_840)]);
    assert_eq!(out.units[1].data, frames[1]);
    assert!(out.units.iter().all(|u| u.pid == AUDIO && u.keyframe));
}

#[test]
fn adts_headers_parse_with_and_without_crc_and_reject_nonsense() {
    let plain = adts_header(&adts(&[0; 10], false)).unwrap();
    assert_eq!(
        plain,
        AdtsHeader {
            object_type: 2,
            sample_rate: 48_000,
            channels: 2,
            frame_length: 17,
            header_length: 7,
            blocks: 1,
        }
    );
    let crc = adts_header(&adts(&[0; 10], true)).unwrap();
    assert_eq!((crc.header_length, crc.frame_length), (9, 19));
    assert_eq!(adts_header(&[0xFF, 0xF1, 0x4C]), None, "too short");
    let mut layer = adts(&[0; 4], false);
    layer[1] |= 0x02;
    assert_eq!(adts_header(&layer), None, "layer must be 0");
    let mut rate = adts(&[0; 4], false);
    rate[2] = (1 << 6) | (13 << 2);
    assert_eq!(adts_header(&rate), None, "reserved sampling index");
    let mut short = adts(&[], false);
    short[4] = 0;
    short[3] &= !0x03;
    short[5] &= 0x1F;
    assert_eq!(adts_header(&short), None, "length below the header");
}

#[test]
fn an_adts_frame_cut_across_pes_packets_is_joined_and_keeps_its_time() {
    let a = adts(&[1; 30], false);
    let b = adts(&[2; 30], true);
    let c = adts(&[3; 30], false);
    let mut splitter = AdtsSplitter::default();
    let first: Vec<u8> = [a.clone(), b[..10].to_vec()].concat();
    let second: Vec<u8> = [b[10..].to_vec(), c.clone()].concat();
    let out1 = splitter.push(&first, Some(1000));
    assert_eq!(out1.len(), 1);
    assert_eq!(out1[0].pts, Some(1000));
    // The second PES's PTS belongs to `c`, the first frame starting in it.
    let out2 = splitter.push(&second, Some(5000));
    assert_eq!(out2.len(), 2);
    assert_eq!(out2[0].data, b);
    assert_eq!(out2[0].pts, Some(1000 + 1920));
    assert_eq!(out2[1].data, c);
    assert_eq!(out2[1].pts, Some(5000));
}

#[test]
fn junk_before_an_adts_sync_is_skipped_and_counted() {
    let mut splitter = AdtsSplitter::default();
    let mut bytes = vec![0x12, 0xFF, 0x00];
    bytes.extend(adts(&[7; 8], false));
    let out = splitter.push(&bytes, Some(0));
    assert_eq!(out.len(), 1);
    assert_eq!(splitter.skipped_bytes, 3);
    // A PES with no frame start passes its PTS to the next frame.
    let mut splitter = AdtsSplitter::default();
    assert!(splitter.push(&[], Some(777)).is_empty());
    assert_eq!(splitter.push(&adts(&[0; 4], false), None)[0].pts, Some(777));
}

#[test]
fn psi_sections_spanning_packets_are_reassembled() {
    // A PMT long enough to need two packets: many streams with descriptors.
    let descriptor = [0x0A, 4, b'e', b'n', b'g', 0];
    let mut streams: Vec<(u8, u16, &[u8])> = vec![(0x1B, VIDEO, &[])];
    for i in 0..30u16 {
        streams.push((0x90, 0x200 + i, &descriptor));
    }
    let table = pmt(&streams);
    assert!(table.len() > 184);
    let mut payload = vec![0];
    payload.extend_from_slice(&table);
    let mut packets = vec![psi(0, &pat(PMT))];
    packets.push(packet(PMT, true, 0, false, &payload[..184]));
    packets.push(packet(PMT, false, 1, false, &payload[184..]));
    let out = demux(&join(packets)).unwrap();
    assert_eq!(out.streams.len(), 31);
    assert_eq!(out.streams[0].stream_type, StreamType::H264);
    assert_eq!(out.streams[30].stream_type, StreamType::Other(0x90));
}

#[test]
fn a_pat_after_a_pointer_field_and_stuffing_is_read() {
    // The pointer skips the tail of a previous section that never started here.
    let mut payload = vec![3, 0xAA, 0xBB, 0xCC];
    payload.extend(pat(PMT));
    payload.extend([0xFF; 10]);
    let packets = vec![
        packet(0, true, 0, false, &payload),
        psi(PMT, &pmt(&[(0x1B, VIDEO, &[])])),
    ];
    assert_eq!(demux(&join(packets)).unwrap().streams.len(), 1);
}

#[test]
fn a_corrupt_pmt_crc_means_no_program() {
    let mut table = pmt(&[(0x1B, VIDEO, &[])]);
    let last = table.len() - 1;
    table[last] ^= 1;
    let out = demux(&join(vec![psi(0, &pat(PMT)), psi(PMT, &table)]));
    assert_eq!(out, Err(TsError::NoProgram));
}

#[test]
fn opus_hdmv_and_unknown_streams_are_told_apart() {
    let opus = [0x05, 4, b'O', b'p', b'u', b's'];
    let hdmv = [0x05, 4, b'H', b'D', b'M', b'V'];
    let packets = vec![
        psi(0, &pat(PMT)),
        psi(
            PMT,
            &pmt(&[
                (0x1B, VIDEO, &hdmv),
                (0x06, AUDIO, &opus),
                (0x06, 0x102, &hdmv),
                (0x11, 0x103, &[]),
                (0x81, 0x104, &[]),
            ]),
        ),
    ];
    let types: Vec<_> = demux(&join(packets))
        .unwrap()
        .streams
        .iter()
        .map(|s| s.stream_type)
        .collect();
    assert_eq!(
        types,
        [
            StreamType::H264,
            StreamType::Opus,
            StreamType::Other(0x06),
            StreamType::Other(0x11),
            StreamType::Other(0x81),
        ]
    );
}

#[test]
fn a_continuity_gap_drops_the_broken_pes_only() {
    let payload = vec![7u8; 600];
    let mut cc = 0;
    let mut broken = packetize(
        VIDEO,
        &pes(0xE0, Some(1), None, &payload, false),
        &mut cc,
        false,
    );
    broken.remove(1);
    let mut packets = header();
    packets.extend(broken);
    packets.extend(packetize(
        VIDEO,
        &pes(0xE0, Some(2), None, P_SLICE, false),
        &mut cc,
        false,
    ));
    let out = demux(&join(packets)).unwrap();
    assert_eq!(out.units.len(), 1);
    assert_eq!(out.units[0].pts, Some(2));
    assert_eq!(out.skipped, 1);
}

#[test]
fn a_duplicate_packet_is_ignored() {
    let mut cc = 0;
    let mut video = packetize(
        VIDEO,
        &pes(0xE0, Some(1), None, &[5u8; 400], false),
        &mut cc,
        false,
    );
    video.insert(2, video[1].clone());
    let mut packets = header();
    packets.extend(video);
    let out = demux(&join(packets)).unwrap();
    assert_eq!(out.units.len(), 1);
    assert_eq!(out.units[0].data, vec![5u8; 400]);
    assert_eq!(out.skipped, 0);
}

#[test]
fn error_and_scrambled_packets_are_dropped_and_break_their_pes() {
    let mut cc = 0;
    let mut video = packetize(
        VIDEO,
        &pes(0xE0, Some(1), None, &[5u8; 400], false),
        &mut cc,
        false,
    );
    video[1][1] |= 0x80;
    let mut scrambled = packetize(
        VIDEO,
        &pes(0xE0, Some(2), None, &[6u8; 400], false),
        &mut cc,
        false,
    );
    scrambled[1][3] |= 0x80;
    let mut packets = header();
    packets.extend(video);
    packets.extend(scrambled);
    packets.extend(packetize(
        VIDEO,
        &pes(0xE0, Some(3), None, P_SLICE, false),
        &mut cc,
        false,
    ));
    let out = demux(&join(packets)).unwrap();
    assert_eq!(out.units.len(), 1);
    assert_eq!(out.units[0].pts, Some(3));
    assert_eq!(out.skipped, 4);
}

#[test]
fn lost_sync_is_found_again() {
    let mut cc = 0;
    let mut packets = header();
    packets.push(packet(PID_NULL, false, 0, false, &[0xFF; 184]));
    let mut bytes = join(packets);
    bytes.extend([0x00, 0x11, 0x22]);
    bytes.extend(join(packetize(
        VIDEO,
        &pes(0xE0, Some(4), None, P_SLICE, false),
        &mut cc,
        false,
    )));
    let out = demux(&bytes).unwrap();
    assert_eq!(out.units.len(), 1);
    assert_eq!(out.units[0].data, P_SLICE);
    assert!(out.skipped >= 1);
}

#[test]
fn m2ts_packets_demux_like_plain_ones() {
    let mut cc = 0;
    let mut packets = header();
    packets.extend(packetize(
        VIDEO,
        &pes(0xE0, Some(10), None, IDR, false),
        &mut cc,
        true,
    ));
    let plain = demux(&join(packets.clone())).unwrap();
    let m2ts: Vec<u8> = packets
        .into_iter()
        .enumerate()
        .flat_map(|(i, p)| [vec![0, 0, 0, i as u8], p].concat())
        .collect();
    let out = demux(&m2ts).unwrap();
    assert_eq!(out.packet_size, 192);
    assert_eq!(out.units, plain.units);
    assert_eq!(out.streams, plain.streams);
}

#[test]
fn null_packets_and_unlisted_pids_are_ignored() {
    let mut cc = 0;
    let mut packets = header();
    packets.push(packet(PID_NULL, false, 0, false, &[0xFF; 184]));
    packets.push(packet(
        0x555,
        true,
        0,
        false,
        &pes(0xE0, Some(1), None, IDR, false),
    ));
    packets.extend(packetize(
        VIDEO,
        &pes(0xE0, Some(2), None, IDR, false),
        &mut cc,
        false,
    ));
    let out = demux(&join(packets)).unwrap();
    assert_eq!(out.units.len(), 1);
    assert_eq!(out.skipped, 0);
}

#[test]
fn units_before_the_pmt_are_not_readable_and_a_truncated_tail_is_dropped() {
    let mut cc = 0;
    let mut bytes = join(header());
    bytes.extend(join(packetize(
        VIDEO,
        &pes(0xE0, Some(2), None, IDR, false),
        &mut cc,
        false,
    )));
    bytes.extend(
        &packet(
            VIDEO,
            true,
            cc,
            false,
            &pes(0xE0, Some(3), None, P_SLICE, false),
        )[..100],
    );
    let out = demux(&bytes).unwrap();
    assert_eq!(out.units.len(), 1, "the cut packet is not a packet");
    assert_eq!(out.units[0].pts, Some(2));
}

#[test]
fn an_adaptation_field_too_long_for_its_packet_is_skipped() {
    let mut cc = 0;
    let mut video = packetize(VIDEO, &pes(0xE0, Some(1), None, IDR, false), &mut cc, false);
    video[0][3] = 0x30 | (video[0][3] & 0x0F);
    video[0][4] = 200;
    let mut packets = header();
    packets.extend(video);
    let out = demux(&join(packets)).unwrap();
    assert!(out.units.is_empty());
    assert_eq!(out.skipped, 1);
}
