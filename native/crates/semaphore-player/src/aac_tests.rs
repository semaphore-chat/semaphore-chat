//! The AudioSpecificConfig parser and the LC-only decision, on bits written here: every object
//! type the parser may see, the sync extensions, escapes, a program config element, and inputs
//! cut short or built to make it read past its end.

use super::*;

/// Bits into bytes, for building a config the way an encoder would.
#[derive(Default)]
struct Writer {
    bits: Vec<bool>,
}

impl Writer {
    fn put(&mut self, value: u32, count: u32) -> &mut Self {
        for i in (0..count).rev() {
            self.bits.push((value >> i) & 1 == 1);
        }
        self
    }

    fn bytes(&self) -> Vec<u8> {
        let mut out = vec![0u8; self.bits.len().div_ceil(8)];
        for (i, &bit) in self.bits.iter().enumerate() {
            if bit {
                out[i / 8] |= 1 << (7 - i % 8);
            }
        }
        out
    }
}

/// The flags of an LC GASpecificConfig with no program config element.
fn gaspecific(writer: &mut Writer) -> &mut Writer {
    writer.put(0, 1).put(0, 1).put(0, 1)
}

/// AAC-LC at `rate_index`, `channel_config`, with the GASpecificConfig.
fn lc(rate_index: u32, channel_config: u32) -> Writer {
    let mut w = Writer::default();
    w.put(2, 5).put(rate_index, 4).put(channel_config, 4);
    gaspecific(&mut w);
    w
}

/// The bytes FFmpeg's native encoder writes for mono 48 kHz LC: the GASpecificConfig, then the
/// 0x2b7 sync extension with SBR announced as not present.
const FFMPEG_LC: [u8; 5] = [0x11, 0x88, 0x56, 0xe5, 0x00];

#[test]
fn plain_lc_is_accepted_with_its_rate_and_channels() {
    let config = parse(&lc(3, 2).bytes()).expect("parsed");
    assert_eq!(
        config,
        Config {
            object_type: 2,
            sample_rate: 48_000,
            channels: 2,
            sbr: false,
            ps: false,
        }
    );
    assert!(config.is_plain_lc());
    // The two-byte form has no room for a sync extension.
    let config = parse(&[0x11, 0x90]).expect("parsed");
    assert_eq!((config.sample_rate, config.channels), (48_000, 2));
    assert!(config.is_plain_lc());
}

#[test]
fn ffmpegs_sync_extension_that_announces_no_sbr_is_accepted() {
    // What ffmpeg's encoder puts in every LC MP4/M4A: 0x2b7, EXT_SBR, sbrPresentFlag 0.
    let config = parse(&FFMPEG_LC).expect("parsed");
    assert!(config.is_plain_lc(), "{config:?}");
    assert_eq!((config.sample_rate, config.channels), (48_000, 1));
}

#[test]
fn object_types_other_than_lc_are_not_plain_lc() {
    // Main (1), SSR (3), LTP (4), and an escaped type (31 + 10 = 42, USAC).
    let cases = [(1, 5, 0u32), (3, 5, 0), (4, 5, 0), (31, 5, 10)];
    for (value, count, escape) in cases {
        let mut writer = Writer::default();
        writer.put(value, count);
        if value == 31 {
            writer.put(escape, 6);
        }
        writer.put(3, 4).put(2, 4);
        let object_type = (if value == 31 { 32 + escape } else { value }) as u8;
        let bytes = writer.bytes();
        let config = parse(&bytes).expect("parsed");
        assert_eq!(config.object_type, object_type, "{bytes:02x?}");
        assert!(!config.is_plain_lc(), "{bytes:02x?}");
    }
}

#[test]
fn explicit_sbr_and_ps_object_types_are_refused() {
    // AOT 5: extensionSamplingFrequencyIndex, then the core's AOT and its config.
    let mut explicit_sbr = Writer::default();
    explicit_sbr
        .put(5, 5)
        .put(6, 4)
        .put(1, 4)
        .put(3, 4)
        .put(2, 5);
    gaspecific(&mut explicit_sbr);
    let config = parse(&explicit_sbr.bytes()).expect("parsed");
    assert_eq!(config.object_type, 5);
    assert!(config.sbr && !config.ps);
    assert!(!config.is_plain_lc());

    // AOT 29: explicit HE-AACv2 (PS as well as SBR).
    let mut explicit_ps = Writer::default();
    explicit_ps
        .put(29, 5)
        .put(6, 4)
        .put(1, 4)
        .put(3, 4)
        .put(2, 5);
    gaspecific(&mut explicit_ps);
    let config = parse(&explicit_ps.bytes()).expect("parsed");
    assert_eq!(config.object_type, 29);
    assert!(config.sbr && config.ps);
    assert!(!config.is_plain_lc());
}

#[test]
fn a_sync_extension_announcing_sbr_is_refused() {
    let mut w = lc(3, 2);
    w.put(0x2b7, 11).put(5, 5).put(1, 1).put(3, 4);
    let config = parse(&w.bytes()).expect("parsed");
    assert!(config.sbr && !config.ps, "{config:?}");
    assert!(!config.is_plain_lc());
}

#[test]
fn a_sync_extension_announcing_ps_is_refused() {
    // 0x2b7, EXT_SBR, sbrPresentFlag 1, then 0x548 and psPresentFlag 1.
    let mut w = lc(3, 2);
    w.put(0x2b7, 11)
        .put(5, 5)
        .put(1, 1)
        .put(6, 4)
        .put(0x548, 11)
        .put(1, 1);
    let config = parse(&w.bytes()).expect("parsed");
    assert!(config.sbr && config.ps, "{config:?}");
    assert!(!config.is_plain_lc());

    // The 0x548 sync directly after a 0x2b7 that announces no SBR still means PS.
    let mut w = lc(3, 2);
    w.put(0x2b7, 11)
        .put(5, 5)
        .put(0, 1)
        .put(0x548, 11)
        .put(1, 1);
    let config = parse(&w.bytes()).expect("parsed");
    assert!(config.ps && !config.sbr, "{config:?}");
    assert!(!config.is_plain_lc());
}

#[test]
fn a_sync_extension_for_ps_as_the_object_type_is_refused() {
    let mut w = lc(3, 2);
    w.put(0x2b7, 11).put(29, 5);
    let config = parse(&w.bytes()).expect("parsed");
    assert!(config.ps, "{config:?}");
    assert!(!config.is_plain_lc());
}

#[test]
fn the_rate_escapes_and_reserved_indexes() {
    let mut escaped = Writer::default();
    escaped.put(2, 5).put(15, 4).put(44_100, 24).put(1, 4);
    gaspecific(&mut escaped);
    let config = parse(&escaped.bytes()).expect("parsed");
    assert_eq!(config.sample_rate, 44_100);

    for index in [13, 14] {
        let mut w = Writer::default();
        w.put(2, 5).put(index, 4).put(1, 4);
        gaspecific(&mut w);
        assert_eq!(parse(&w.bytes()), None, "index {index} is reserved");
    }
    // An escaped rate of zero is not a rate.
    let mut zero = Writer::default();
    zero.put(2, 5).put(15, 4).put(0, 24).put(1, 4);
    gaspecific(&mut zero);
    assert_eq!(parse(&zero.bytes()), None);
}

#[test]
fn a_program_config_element_is_walked_to_the_sync_extension_after_it() {
    let mut w = Writer::default();
    w.put(2, 5).put(3, 4).put(0, 4); // LC, 48 kHz, channel_config 0
    w.put(0, 1).put(0, 1).put(0, 1); // GASpecificConfig flags
    // The PCE: one front pair (is_cpe + tag), an LFE, no comments.
    w.put(0, 4).put(0, 2).put(3, 4); // element tag, object type, sampling index
    w.put(1, 4).put(0, 4).put(0, 4); // one front, no side, no back
    w.put(1, 2).put(0, 3).put(0, 4); // one LFE, no assoc data, no valid cc
    w.put(0, 1).put(0, 1).put(0, 1); // no mono/stereo/matrix mixdown
    w.put(1, 1).put(7, 4); // front element is a pair, tag 7
    w.put(1, 4); // LFE tag
    // byte_alignment to the next byte, then comment_field_bytes 0.
    let pad = (8 - w.bits.len() % 8) % 8;
    w.put(0, pad as u32).put(0, 8);
    w.put(0x2b7, 11).put(5, 5).put(1, 1).put(3, 4);
    let config = parse(&w.bytes()).expect("parsed");
    assert_eq!((config.channels, config.sample_rate), (0, 48_000));
    assert!(config.sbr, "the extension after the PCE was found");
    assert!(!config.is_plain_lc());
}

#[test]
fn a_pce_with_a_comment_is_walked() {
    let mut w = Writer::default();
    w.put(2, 5).put(3, 4).put(0, 4);
    w.put(0, 1).put(0, 1).put(0, 1);
    w.put(0, 4).put(0, 2).put(3, 4);
    w.put(0, 4).put(0, 4).put(0, 4);
    w.put(0, 2).put(0, 3).put(0, 4);
    w.put(0, 1).put(0, 1).put(0, 1);
    let pad = (8 - w.bits.len() % 8) % 8;
    w.put(0, pad as u32).put(2, 8).put(0xAB, 8).put(0xCD, 8);
    let config = parse(&w.bytes()).expect("parsed");
    assert_eq!((config.channels, config.sample_rate), (0, 48_000));
    assert!(config.is_plain_lc());
}

#[test]
fn truncated_configs_are_refused() {
    let full = lc(3, 2).bytes();
    assert_eq!(full.len(), 2);
    for len in 0..full.len() {
        let cut = &full[..len];
        assert!(
            parse(cut).is_none_or(|c| !c.is_plain_lc()),
            "{} bytes: {cut:02x?}",
            len
        );
    }
    assert!(parse(&full).expect("parsed").is_plain_lc());
    assert_eq!(parse(&[]), None);
    // The whole config, then padding zeros: no room for a sync extension, still plain LC.
    let config = parse(&[0x11, 0x90, 0x00]).expect("parsed");
    assert!(config.is_plain_lc());
}

#[test]
fn a_sync_extension_cut_inside_its_sbr_flag_is_refused() {
    let mut w = lc(3, 2);
    w.put(0x2b7, 11).put(5, 5);
    // Exactly the extension's prefix and nothing to say whether SBR is present: 16 bits are left
    // at the scan (enough to look), but not the flag after the object type.
    let bytes = w.bytes();
    assert_eq!(bytes.len(), 4);
    assert_eq!(parse(&bytes), None, "{bytes:02x?}");
}

#[test]
fn hostile_program_config_elements_do_not_run_off_the_end() {
    // Channel configuration 0 with a PCE that says every element count is at its maximum.
    let mut w = Writer::default();
    w.put(2, 5).put(3, 4).put(0, 4);
    gaspecific(&mut w);
    w.put(0, 4).put(0, 2).put(3, 4);
    w.put(15, 4).put(15, 4).put(15, 4);
    w.put(3, 2).put(7, 3).put(15, 4);
    w.put(1, 1)
        .put(15, 4)
        .put(1, 1)
        .put(15, 4)
        .put(1, 1)
        .put(3, 2)
        .put(1, 1);
    let bytes = w.bytes();
    assert_eq!(parse(&bytes), None, "{bytes:02x?}");

    // A comment length past the end.
    let mut w = Writer::default();
    w.put(2, 5).put(3, 4).put(0, 4);
    gaspecific(&mut w);
    w.put(0, 4).put(0, 2).put(3, 4);
    w.put(0, 4).put(0, 4).put(0, 4);
    w.put(0, 2).put(0, 3).put(0, 4);
    w.put(0, 1).put(0, 1).put(0, 1);
    let pad = (8 - w.bits.len() % 8) % 8;
    w.put(0, pad as u32).put(255, 8);
    assert_eq!(parse(&w.bytes()), None);
}

#[test]
fn a_channel_configuration_outside_the_table_is_refused() {
    for channel_config in 8..16 {
        let mut w = Writer::default();
        w.put(2, 5).put(3, 4).put(channel_config, 4);
        gaspecific(&mut w);
        assert_eq!(parse(&w.bytes()), None, "channel config {channel_config}");
    }
}

#[test]
fn the_decoder_may_only_report_lc_at_the_headers_rate() {
    assert!(decoder_is_lc(PROFILE_AAC_LOW, 48_000, 48_000));
    // Before the decoder has decided.
    assert!(decoder_is_lc(PROFILE_UNKNOWN, 0, 48_000));
    assert!(decoder_is_lc(PROFILE_UNKNOWN, 48_000, 48_000));
    // A header that does not say a rate leaves the frame's alone.
    assert!(decoder_is_lc(PROFILE_AAC_LOW, 44_100, 0));

    // HE-AAC (4) and HE-AACv2 (28), and every other profile (Main 0, SSR 2, LTP 3, LD 23, ELD 38,
    // USAC 42), are refused even at a matching rate.
    for profile in [4, 28, 0, 2, 3, 23, 38, 42, -1] {
        assert!(
            !decoder_is_lc(profile, 48_000, 48_000),
            "profile {profile} passed"
        );
    }
    // SBR doubles the rate: the frame is at the extension rate, not the header's.
    assert!(!decoder_is_lc(PROFILE_AAC_LOW, 96_000, 48_000));
    assert!(!decoder_is_lc(PROFILE_UNKNOWN, 96_000, 48_000));
    // And half the rate is just as wrong.
    assert!(!decoder_is_lc(PROFILE_AAC_LOW, 24_000, 48_000));
}
