//! What the player accepts as AAC: the AudioSpecificConfig a container's extradata carries
//! (ISO/IEC 14496-3, 1.6.2.1), and the rule for what the decoder may report after a frame.
//!
//! Only AAC-LC (audio object type 2) may be decoded; `docs/player.md` says why. The checks live
//! here, in Rust, so every path that reaches the AAC decoder goes through the same decision:
//!
//! - a container's `AudioSpecificConfig` with another object type (AAC Main, SSR, LTP, the ER
//!   profiles, USAC) or with explicit SBR/PS signalling (object types 5 and 29, the sync
//!   extension 0x2b7 announcing SBR, or the 0x548 one announcing PS) is an unsupported stream;
//! - a decoder that reports a profile other than LC, or a frame rate other than the stream
//!   header's (an SBR stream doubles it), is stopped and its stream reported the same way.
//!
//! The config is hand-parsed: FFmpeg's structs are not ours to read (the shim keeps them), and a
//! truncated or hostile config must be refused, never trusted. FFmpeg's own
//! `ff_mpeg4audio_get_config_gb` is the reference for the sync-extension scan.

/// FFmpeg's `AV_PROFILE_UNKNOWN`: the decoder has not said yet.
pub(crate) const PROFILE_UNKNOWN: i32 = -99;
/// FFmpeg's `AV_PROFILE_AAC_LOW`.
pub(crate) const PROFILE_AAC_LOW: i32 = 1;

/// Audio object type 2, plain AAC-LC.
const AOT_AAC_LC: u8 = 2;
const AOT_SBR: u8 = 5;
const AOT_PS: u8 = 29;

/// The sampling frequencies of the index field, ISO/IEC 14496-3 Table 1.18.
const SAMPLING_RATES: [u32; 13] = [
    96_000, 88_200, 64_000, 48_000, 44_100, 32_000, 24_000, 22_050, 16_000, 12_000, 11_025, 8_000,
    7_350,
];

/// `channelConfiguration` to a channel count (0 means a program config element follows).
const CHANNELS: [u8; 8] = [0, 1, 2, 3, 4, 5, 6, 8];

/// The parts of an AudioSpecificConfig the player cares about.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Config {
    /// MPEG-4 audio object type: 2 is AAC-LC.
    pub object_type: u8,
    pub sample_rate: u32,
    /// 0 when a program config element describes the layout.
    pub channels: u8,
    /// Explicit SBR/HE-AAC signalling, from the object type or the sync extension.
    pub sbr: bool,
    /// Explicit PS/HE-AACv2 signalling.
    pub ps: bool,
}

impl Config {
    /// Plain AAC-LC and nothing else (no SBR or PS announced).
    pub fn is_plain_lc(&self) -> bool {
        self.object_type == AOT_AAC_LC && !self.sbr && !self.ps
    }
}

/// Whether a decoder's report allows the stream to go on: only AAC-LC, at the rate the stream's
/// header gave. `profile` is FFmpeg's `AV_PROFILE_AAC_LOW` (1) for LC; HE-AAC and HE-AACv2 report
/// 4 and 28, Main 0, and an SBR stream's frame comes out at twice the header's rate. An unknown
/// profile passes: the decoder often has not decided at open, and the per-frame check follows.
pub(crate) fn decoder_is_lc(profile: i32, reported_rate: u32, header_rate: u32) -> bool {
    profile_is_lc(profile)
        && (header_rate == 0 || reported_rate == 0 || reported_rate == header_rate)
}

/// Whether a decoder's profile is plain AAC-LC, or not decided yet.
pub(crate) fn profile_is_lc(profile: i32) -> bool {
    profile == PROFILE_AAC_LOW || profile == PROFILE_UNKNOWN
}

/// Reads the config in `bytes`. `None` for anything truncated, reserved or malformed: the caller
/// refuses the stream rather than guess.
pub(crate) fn parse(bytes: &[u8]) -> Option<Config> {
    let mut bits = Bits::new(bytes);
    let object_type = object_type(&mut bits)?;
    let sample_rate = sample_rate(&mut bits)?;
    let channel_config = bits.take(4)?;
    if channel_config as usize >= CHANNELS.len() {
        return None;
    }
    let mut config = Config {
        object_type,
        sample_rate,
        channels: CHANNELS[channel_config as usize],
        sbr: false,
        ps: false,
    };
    // Explicit HE-AAC (5) or HE-AACv2 (29): the extension fields that follow are irrelevant, the
    // stream is refused for what the object type already says.
    if object_type == AOT_SBR || object_type == AOT_PS {
        config.sbr = true;
        config.ps = object_type == AOT_PS;
        return Some(config);
    }
    // Every other object type is refused by `is_plain_lc`; only LC has to be walked to its end to
    // find the sync extensions.
    if object_type != AOT_AAC_LC {
        return Some(config);
    }
    gaspecific_config(&mut bits, channel_config)?;
    sync_extensions(&mut bits, &mut config)?;
    Some(config)
}

/// `audioObjectType`: five bits, 31 escaping to six more plus 32.
fn object_type(bits: &mut Bits<'_>) -> Option<u8> {
    let small = bits.take(5)? as u8;
    if small == 31 {
        let escaped = bits.take(6)? as u8;
        u8::try_from(32 + u32::from(escaped)).ok()
    } else {
        Some(small)
    }
}

/// `samplingFrequencyIndex`: four bits; 15 escapes to an explicit 24-bit rate; 13 and 14 are
/// reserved.
fn sample_rate(bits: &mut Bits<'_>) -> Option<u32> {
    let index = bits.take(4)?;
    match index {
        15 => match bits.take(24)? {
            0 => None,
            rate => Some(rate),
        },
        index => SAMPLING_RATES.get(index as usize).copied(),
    }
}

/// The `GASpecificConfig` of an AAC-LC config (ISO/IEC 14496-3, 4.4.1.1): the flags, the program
/// config element when the channel configuration is 0, and the extension flag's payload.
fn gaspecific_config(bits: &mut Bits<'_>, channel_config: u32) -> Option<()> {
    bits.take(1)?; // frameLengthFlag
    if bits.take(1)? == 1 {
        bits.skip(14)?; // coreCoderDelay
    }
    let extension = bits.take(1)? == 1;
    if channel_config == 0 {
        program_config_element(bits)?;
    }
    if extension {
        // AAC-LC has no extension payload of its own; only extensionFlag3 (TBD in version 3).
        bits.take(1)?;
    }
    Some(())
}

/// A `program_config_element` (ISO/IEC 14496-3, 4.4.1.1), walked so that what follows it (the
/// sync extension) is where the config says. The layout itself is not needed: the decoder reads
/// it too.
fn program_config_element(bits: &mut Bits<'_>) -> Option<()> {
    bits.skip(4)?; // element_instance_tag
    bits.skip(2)?; // object_type
    bits.skip(4)?; // sampling_frequency_index
    let front = bits.take(4)?;
    let side = bits.take(4)?;
    let back = bits.take(4)?;
    let lfe = bits.take(2)?;
    let assoc = bits.take(3)?;
    let cc = bits.take(4)?;
    if bits.take(1)? == 1 {
        bits.skip(4)?; // mono_mixdown_present: mono_mixdown_element_number
    }
    if bits.take(1)? == 1 {
        bits.skip(4)?; // stereo_mixdown_present: stereo_mixdown_element_number
    }
    if bits.take(1)? == 1 {
        bits.skip(2)?; // matrix_mixdown_idx
        bits.take(1)?; // pseudo_surround_enable
    }
    for _ in 0..front.saturating_add(side).saturating_add(back) {
        bits.take(1)?; // *_element_is_cpe
        bits.skip(4)?; // *_element_tag_select
    }
    for _ in 0..lfe {
        bits.skip(4)?; // lfe_element_tag_select
    }
    for _ in 0..assoc {
        bits.skip(4)?; // assoc_data_element_tag_select
    }
    for _ in 0..cc {
        bits.take(1)?; // cc_element_is_ind_sw
        bits.skip(4)?; // valid_cc_element_tag_select
    }
    bits.align()?; // byte_alignment()
    let comment = bits.take(8)?;
    bits.skip(comment as usize * 8)?; // comment_field_data
    Some(())
}

/// The backward-compatible sync extensions after the config: 0x2b7 announces SBR (and, with a
/// further 0x548, PS), 0x548 on its own announces PS. FFmpeg scans for 0x2b7 bit by bit, as its
/// own parser does; a config with neither (padding) is plain LC.
fn sync_extensions(bits: &mut Bits<'_>, config: &mut Config) -> Option<()> {
    while bits.left() > 15 {
        if bits.peek(11)? != 0x2b7 {
            bits.skip(1)?;
            continue;
        }
        bits.skip(11)?;
        let extension = object_type(bits)?;
        if extension == AOT_PS {
            config.ps = true;
            return Some(());
        }
        if extension == AOT_SBR {
            // sbrPresentFlag: an explicitly announced SBR stream (HE-AAC). The extension rate
            // follows when it is set; FFmpeg reads that and then looks for the PS sync.
            let sbr = bits.take(1)? == 1;
            config.sbr = sbr;
            if sbr {
                sample_rate(bits)?;
            }
        }
        // FFmpeg checks for PS next (11 bits: 0x548), whether or not SBR was announced.
        if bits.left() > 11 && bits.peek(11)? == 0x548 {
            bits.skip(11)?;
            config.ps = bits.take(1)? == 1;
        }
        return Some(());
    }
    Some(())
}

/// A big-endian bit reader over the config, never reading past the end.
struct Bits<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl<'a> Bits<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, at: 0 }
    }

    fn left(&self) -> usize {
        self.bytes.len() * 8 - self.at
    }

    /// The next `count` bits (at most 32) without consuming them.
    fn peek(&self, count: u32) -> Option<u32> {
        let count = count as usize;
        if count > 32 || count > self.left() {
            return None;
        }
        let mut value = 0u32;
        for i in 0..count {
            let bit = self.at + i;
            let set = self.bytes[bit / 8] >> (7 - bit % 8) & 1;
            value = value << 1 | u32::from(set);
        }
        Some(value)
    }

    /// The next `count` bits (at most 32).
    fn take(&mut self, count: u32) -> Option<u32> {
        let value = self.peek(count)?;
        self.at += count as usize;
        Some(value)
    }

    fn skip(&mut self, count: usize) -> Option<()> {
        if count > self.left() {
            return None;
        }
        self.at += count;
        Some(())
    }

    /// To the next byte boundary.
    fn align(&mut self) -> Option<()> {
        self.skip((8 - self.at % 8) % 8)
    }
}

#[cfg(test)]
#[path = "aac_tests.rs"]
mod tests;
