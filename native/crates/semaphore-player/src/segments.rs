//! The replay preview: the replay buffer's HLS segments (MPEG-TS, H.264 and AAC) played as one
//! media. The app lists the segments (`Core::replay_preview`) and fetches each with the session's
//! token (`Core::replay_segment`) behind [`SegmentFetch`]; this module demuxes them ([`crate::ts`])
//! and decodes with standalone FFmpeg decoders (`sp_decoder` in the shim).
//!
//! - **Timeline.** Segment `i` starts at the sum of the `#EXTINF` lengths before it, the model
//!   the backend captures with (`floor(start / 10)` and an offset). Inside a segment, time is the
//!   PTS less the segment's first video PTS (its opening keyframe), so the preview shows what a
//!   capture of that range gets. Audio muxed ahead of the video keeps its place relative to it.
//! - **Seek.** To the segment holding the target, then its last video keyframe at or before the
//!   target; audio from that keyframe's time. Frames before the target still come out: the
//!   engine drops them.
//! - **Fetching** on the decode thread, retried with backoff for [`FetchError::Transient`]; the
//!   next segment is prefetched on a thread of its own. Fetched segments stay in a cache of
//!   [`CACHE_BYTES`], least recently used out first, so a looped selection is fetched once.
//! - **Broken data.** A later segment that isn't TS is skipped and counted; packets and PES the
//!   demuxer drops, and units a decoder rejects, are counted in `skipped_packets`.
//! - **Streams** are those of the first segment opened, by PID (else by stream type). Opus in
//!   TS and anything but H.264 and AAC are listed and refused; AAC needs the `aac` feature.

use crate::buffered::BufferedReport;
use crate::engine::Cancel;
use crate::ts::{self, StreamType, TsError, Unit, unwrap_pts};
use crate::{Codec, Error, Frame, Kind, StreamInfo, ffi, frame_from_raw};
use std::collections::VecDeque;
use std::ffi::c_int;
use std::ops::Range;
use std::ptr::NonNull;
use std::sync::Arc;
use std::sync::mpsc;
use std::time::Duration;

/// Fetches one segment of the replay buffer, by its index in the playlist. Called from the
/// player's decode thread and a prefetch thread, so it may block; give up when `cancel` is set.
pub trait SegmentFetch: Send + Sync {
    fn fetch(&self, index: usize, cancel: &Cancel) -> Result<Vec<u8>, FetchError>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FetchError {
    /// A network error, a 5xx or a 429: worth retrying.
    Transient,
    /// Refused or gone (4xx, a session that ended): retrying won't help.
    Failed,
    /// The player went away.
    Cancelled,
}

/// Retries after the first attempt, with [`BACKOFF`] doubling between them.
pub const RETRIES: u32 = 3;
const BACKOFF: Duration = Duration::from_millis(250);
/// Fetched segments kept in memory, per player (one preview is open at a time).
pub const CACHE_BYTES: usize = 64 << 20;
/// Units fed to a probe decoder looking for the video's size.
const PROBE_UNITS: usize = 64;

/// A segment fetched with retries.
fn fetch_with_retries(
    fetch: &dyn SegmentFetch,
    index: usize,
    cancel: &Cancel,
) -> Result<Vec<u8>, FetchError> {
    let mut attempt = 0;
    loop {
        if cancel.is_cancelled() {
            return Err(FetchError::Cancelled);
        }
        match fetch.fetch(index, cancel) {
            Err(FetchError::Transient) if attempt < RETRIES => {
                // A bounded retry's backoff, not a wait for something to happen.
                std::thread::sleep(BACKOFF * 2u32.pow(attempt));
                attempt += 1;
            }
            other => return other,
        }
    }
}

/// Fetched segments, least recently used first, within a byte budget. The newest always stays.
#[derive(Debug)]
pub(crate) struct SegmentCache {
    cap: usize,
    entries: VecDeque<(usize, Arc<Vec<u8>>)>,
}

impl SegmentCache {
    pub(crate) fn new(cap: usize) -> Self {
        Self {
            cap,
            entries: VecDeque::new(),
        }
    }

    pub(crate) fn get(&mut self, index: usize) -> Option<Arc<Vec<u8>>> {
        let at = self.entries.iter().position(|(i, _)| *i == index)?;
        let entry = self.entries.remove(at)?;
        let bytes = entry.1.clone();
        self.entries.push_back(entry);
        Some(bytes)
    }

    pub(crate) fn contains(&self, index: usize) -> bool {
        self.entries.iter().any(|(i, _)| *i == index)
    }

    pub(crate) fn insert(&mut self, index: usize, bytes: Arc<Vec<u8>>) {
        self.entries.retain(|(i, _)| *i != index);
        self.entries.push_back((index, bytes));
        while self.entries.len() > 1 && self.bytes() > self.cap {
            self.entries.pop_front();
        }
    }

    pub(crate) fn bytes(&self) -> usize {
        self.entries.iter().map(|(_, b)| b.len()).sum()
    }

    /// Cached indices, ascending.
    pub(crate) fn indices(&self) -> Vec<usize> {
        let mut indices: Vec<usize> = self.entries.iter().map(|(i, _)| *i).collect();
        indices.sort_unstable();
        indices
    }
}

/// Where each segment starts, in microseconds, and the total.
pub(crate) fn starts_us(durations: &[Duration]) -> (Vec<i64>, i64) {
    let mut starts = Vec::with_capacity(durations.len());
    let mut at: i64 = 0;
    for d in durations {
        starts.push(at);
        at = at.saturating_add(i64::try_from(d.as_micros()).unwrap_or(i64::MAX));
    }
    (starts, at)
}

/// The segment holding `us`: the last one starting at or before it (the last for a time past the
/// end, the first for one before the start).
pub(crate) fn segment_at(starts: &[i64], us: i64) -> usize {
    starts.partition_point(|&s| s <= us).saturating_sub(1)
}

/// Cached segments as fractions of the timeline, adjacent ones merged.
pub(crate) fn buffered_ranges(indices: &[usize], starts: &[i64], total: i64) -> Vec<Range<f32>> {
    if total <= 0 {
        return Vec::new();
    }
    let mut ranges: Vec<Range<f32>> = Vec::new();
    let mut previous: Option<usize> = None;
    for &i in indices {
        let start = starts[i] as f32 / total as f32;
        let end = starts.get(i + 1).copied().unwrap_or(total) as f32 / total as f32;
        match (previous, ranges.last_mut()) {
            (Some(p), Some(last)) if p + 1 == i => last.end = end,
            _ => ranges.push(start..end),
        }
        previous = Some(i);
    }
    ranges
}

/// One access unit placed on the timeline.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Placed {
    pub stream: usize,
    pub pts_us: Option<i64>,
    pub dts_us: Option<i64>,
    pub data: Vec<u8>,
    pub keyframe: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Track {
    pub pid: u16,
    pub stream_type: StreamType,
}

/// Which of `tracks` a unit of `pid` (of `pids`' stream type in this segment) belongs to.
fn track_of(tracks: &[Track], pid: u16, stream_type: Option<StreamType>) -> Option<usize> {
    tracks.iter().position(|t| t.pid == pid).or_else(|| {
        tracks
            .iter()
            .position(|t| Some(t.stream_type) == stream_type)
    })
}

/// A demuxed segment's units on the timeline: time 0 of the segment is its first video PTS
/// (its first PTS of any stream when it has no video), at `start_us`.
pub(crate) fn place(demuxed: &ts::Demuxed, tracks: &[Track], start_us: i64) -> Vec<Placed> {
    let type_of = |pid: u16| {
        demuxed
            .streams
            .iter()
            .find(|s| s.pid == pid)
            .map(|s| s.stream_type)
    };
    let is_video = |u: &Unit| type_of(u.pid) == Some(StreamType::H264);
    let reference = demuxed
        .units
        .iter()
        .find(|u| is_video(u) && u.pts.is_some())
        .or_else(|| demuxed.units.iter().find(|u| u.pts.is_some()))
        .and_then(|u| u.pts);
    let Some(reference) = reference else {
        return Vec::new();
    };
    // The earliest video PTS (B-frames can come later in file order with earlier times).
    let base = demuxed
        .units
        .iter()
        .filter(|u| is_video(u))
        .filter_map(|u| u.pts)
        .map(|p| unwrap_pts(p, reference))
        .min()
        .unwrap_or_else(|| {
            demuxed
                .units
                .iter()
                .filter_map(|u| u.pts)
                .map(|p| unwrap_pts(p, reference))
                .min()
                .unwrap_or(reference as i64)
        });
    let to_us = |t: u64| start_us + (unwrap_pts(t, reference) - base) * 100 / 9;
    demuxed
        .units
        .iter()
        .filter_map(|u| {
            Some(Placed {
                stream: track_of(tracks, u.pid, type_of(u.pid))?,
                pts_us: u.pts.map(to_us),
                dts_us: u.dts.map(to_us),
                data: u.data.clone(),
                keyframe: u.keyframe,
            })
        })
        .collect()
}

/// Where decoding starts after a seek to `to_us` in `units`: per stream, the first unit index
/// to feed. Video from its last keyframe at or before the target (else its first keyframe);
/// other streams from their first unit at or after that keyframe's time, or, with no video,
/// from their last unit at or before the target.
pub(crate) fn seek_points(
    units: &[Placed],
    streams: usize,
    video: Option<usize>,
    to_us: i64,
) -> Vec<usize> {
    let mut from = vec![units.len(); streams];
    let mut anchor = to_us;
    if let Some(v) = video {
        let keyframes = || {
            units
                .iter()
                .enumerate()
                .filter(move |(_, u)| u.stream == v && u.keyframe)
        };
        let chosen = keyframes()
            .rfind(|(_, u)| u.pts_us.is_none_or(|p| p <= to_us))
            .or_else(|| keyframes().next());
        if let Some((index, unit)) = chosen {
            from[v] = index;
            anchor = unit.pts_us.unwrap_or(to_us).min(to_us);
        }
    }
    for (s, slot) in from.iter_mut().enumerate() {
        if Some(s) == video {
            continue;
        }
        let ofs = |u: &Placed| u.stream == s;
        *slot = if video.is_some() {
            units
                .iter()
                .position(|u| ofs(u) && u.pts_us.is_some_and(|p| p >= anchor))
                .unwrap_or(units.len())
        } else {
            units
                .iter()
                .enumerate()
                .filter(|(_, u)| ofs(u) && u.pts_us.is_none_or(|p| p <= to_us))
                .map(|(i, _)| i)
                .next_back()
                .or_else(|| units.iter().position(ofs))
                .unwrap_or(units.len())
        };
    }
    from
}

/// One standalone FFmpeg decoder (`sp_decoder`).
struct Decoder {
    raw: NonNull<ffi::sp_decoder>,
    /// Sent the end of input.
    draining: bool,
    /// Drained.
    done: bool,
}

// SAFETY: the decoder is only used through `&mut self` of its owner, on one thread at a time.
unsafe impl Send for Decoder {}

impl Decoder {
    fn open(codec: c_int) -> Result<Self, Error> {
        let mut code: c_int = 0;
        // SAFETY: a valid out pointer.
        let raw = unsafe { ffi::sp_decoder_open(codec, &mut code) };
        NonNull::new(raw)
            .map(|raw| Self {
                raw,
                draining: false,
                done: false,
            })
            .ok_or_else(|| Error::from_code(code))
    }

    fn send(&mut self, data: &[u8], pts_us: Option<i64>, dts_us: Option<i64>) -> Result<(), Error> {
        let size = c_int::try_from(data.len()).map_err(|_| Error::Invalid)?;
        // SAFETY: `data` is `size` readable bytes, copied before the call returns.
        let code = unsafe {
            ffi::sp_decoder_send(
                self.raw.as_ptr(),
                data.as_ptr(),
                size,
                pts_us.unwrap_or(i64::MIN),
                dts_us.unwrap_or(i64::MIN),
            )
        };
        if code == ffi::SP_OK {
            Ok(())
        } else {
            Err(Error::from_code(code))
        }
    }

    fn drain(&mut self) -> Result<(), Error> {
        self.draining = true;
        // SAFETY: NULL data is the end of input.
        let code = unsafe { ffi::sp_decoder_send(self.raw.as_ptr(), std::ptr::null(), 0, 0, 0) };
        if code == ffi::SP_OK {
            Ok(())
        } else {
            Err(Error::from_code(code))
        }
    }

    /// `Ok(true)`: a frame in `out`; `Ok(false)`: wants input, or drained (see `done`).
    fn receive(&mut self, out: &mut ffi::sp_frame) -> Result<bool, Error> {
        // SAFETY: an open decoder and a valid out pointer.
        match unsafe { ffi::sp_decoder_receive(self.raw.as_ptr(), out) } {
            ffi::SP_OK => Ok(true),
            ffi::SP_AGAIN => {
                if self.draining {
                    self.done = true;
                }
                Ok(false)
            }
            ffi::SP_EOF => {
                self.done = true;
                Ok(false)
            }
            code => Err(Error::from_code(code)),
        }
    }

    fn flush(&mut self) {
        // SAFETY: an open decoder.
        unsafe { ffi::sp_decoder_flush(self.raw.as_ptr()) };
        self.draining = false;
        self.done = false;
    }

    fn skipped(&self) -> u64 {
        // SAFETY: an open decoder.
        unsafe { ffi::sp_decoder_skipped(self.raw.as_ptr()) }
    }
}

impl Drop for Decoder {
    fn drop(&mut self) {
        // SAFETY: closed once, here.
        unsafe { ffi::sp_decoder_close(self.raw.as_ptr()) };
    }
}

fn decoder_codec(codec: Codec) -> Option<c_int> {
    match codec {
        Codec::H264 => Some(ffi::SP_CODEC_H264),
        Codec::Aac => Some(ffi::SP_CODEC_AAC),
        _ => None,
    }
}

fn stream_info(stream_type: StreamType) -> (Kind, Codec) {
    match stream_type {
        StreamType::H264 => (Kind::Video, Codec::H264),
        StreamType::AacAdts => (Kind::Audio, Codec::Aac),
        StreamType::Opus => (Kind::Audio, Codec::Opus),
        StreamType::Other(_) => (Kind::Other, Codec::Other),
    }
}

fn demux_error(error: TsError) -> Error {
    match error {
        TsError::NotTs => Error::UnsupportedContainer,
        TsError::NoProgram => Error::Invalid,
    }
}

fn fetch_error(_: FetchError) -> Error {
    Error::Io
}

struct Prefetch {
    index: usize,
    result: mpsc::Receiver<Result<Vec<u8>, FetchError>>,
}

pub(crate) struct SegmentedMedia {
    fetch: Arc<dyn SegmentFetch>,
    cancel: Cancel,
    buffered: Option<BufferedReport>,
    starts: Vec<i64>,
    total: i64,
    start: Duration,
    tracks: Vec<Track>,
    infos: Vec<StreamInfo>,
    decoders: Vec<Option<Decoder>>,
    cache: SegmentCache,
    prefetch: Option<Prefetch>,
    /// The segment being read, its units and the next to feed.
    segment: usize,
    units: Vec<Placed>,
    next: usize,
    /// Per stream: units before this index (of the segment a seek landed in) are not fed.
    from: Vec<usize>,
    /// The stream whose decoder may have output.
    current: Option<usize>,
    /// Every segment fed: the decoders drain.
    input_done: bool,
    frame: ffi::sp_frame,
    demux_skipped: u64,
    /// The last seek's target, until a unit is fed after it.
    positioned_at: Option<i64>,
}

// SAFETY: `frame`'s pointers point into this media's own decoders, which it owns and uses only
// through `&mut self` or `&self`; FFmpeg decoder contexts may move between threads as long as one
// thread uses them at a time.
unsafe impl Send for SegmentedMedia {}

impl SegmentedMedia {
    pub(crate) fn open(
        fetch: Arc<dyn SegmentFetch>,
        durations: Vec<Duration>,
        start: Duration,
        cancel: Cancel,
        buffered: Option<BufferedReport>,
    ) -> Result<Self, Error> {
        if durations.is_empty() {
            return Err(Error::Invalid);
        }
        let (starts, total) = starts_us(&durations);
        let start_us = i64::try_from(start.as_micros())
            .unwrap_or(i64::MAX)
            .clamp(0, total);
        let first = segment_at(&starts, start_us);
        let bytes = fetch_with_retries(fetch.as_ref(), first, &cancel).map_err(fetch_error)?;
        let demuxed = ts::demux(&bytes).map_err(demux_error)?;
        let tracks: Vec<Track> = demuxed
            .streams
            .iter()
            .map(|s| Track {
                pid: s.pid,
                stream_type: s.stream_type,
            })
            .collect();
        let infos = tracks
            .iter()
            .map(|track| probe_stream(&demuxed, *track))
            .collect();
        let mut media = Self {
            fetch,
            cancel,
            buffered,
            starts,
            total,
            start: Duration::from_micros(u64::try_from(start_us).unwrap_or(0)),
            decoders: tracks.iter().map(|_| None).collect(),
            from: vec![0; tracks.len()],
            tracks,
            infos,
            cache: SegmentCache::new(CACHE_BYTES),
            prefetch: None,
            segment: first,
            units: Vec::new(),
            next: 0,
            current: None,
            input_done: false,
            frame: ffi::sp_frame::default(),
            demux_skipped: demuxed.skipped,
            positioned_at: None,
        };
        media.cache.insert(first, Arc::new(bytes));
        media.report_buffered();
        media.units = place(&demuxed, &media.tracks, media.starts[first]);
        media.position(start_us);
        Ok(media)
    }

    pub(crate) fn duration(&self) -> Duration {
        Duration::from_micros(u64::try_from(self.total).unwrap_or(0))
    }

    pub(crate) fn initial_position(&self) -> Duration {
        self.start
    }

    pub(crate) fn streams(&self) -> Vec<StreamInfo> {
        self.infos.clone()
    }

    pub(crate) fn skipped_packets(&self) -> u64 {
        self.demux_skipped
            + self
                .decoders
                .iter()
                .flatten()
                .map(Decoder::skipped)
                .sum::<u64>()
    }

    fn video(&self) -> Option<usize> {
        (0..self.infos.len())
            .find(|&i| self.infos[i].kind == Kind::Video && self.decoders[i].is_some())
    }

    pub(crate) fn enable(&mut self, stream: usize) -> Result<(), Error> {
        let info = self.infos.get(stream).ok_or(Error::BadStream)?;
        if self.decoders[stream].is_some() {
            return Ok(());
        }
        let codec = decoder_codec(info.codec).ok_or(Error::UnsupportedCodec)?;
        self.decoders[stream] = Some(Decoder::open(codec)?);
        match self.positioned_at {
            // Nothing fed since the last seek: place every stream again, this one included.
            Some(to_us) => self.position(to_us),
            // Mid-stream: from here on.
            None => self.from[stream] = self.next,
        }
        Ok(())
    }

    pub(crate) fn seek(&mut self, to: Duration) -> Result<(), Error> {
        let to_us = i64::try_from(to.as_micros())
            .unwrap_or(i64::MAX)
            .clamp(0, self.total);
        let index = segment_at(&self.starts, to_us);
        self.load(index)?;
        for decoder in self.decoders.iter_mut().flatten() {
            decoder.flush();
        }
        self.position(to_us);
        Ok(())
    }

    /// Points the cursor at `to_us` in the loaded segment.
    fn position(&mut self, to_us: i64) {
        self.from = seek_points(&self.units, self.tracks.len(), self.video(), to_us);
        self.next = self
            .from
            .iter()
            .enumerate()
            .filter(|(s, _)| self.decoders[*s].is_some())
            .map(|(_, &i)| i)
            .min()
            .unwrap_or_else(|| self.from.iter().copied().min().unwrap_or(0));
        self.current = None;
        self.input_done = false;
        self.positioned_at = Some(to_us);
    }

    /// Makes `index` the segment being read, from its start.
    fn load(&mut self, index: usize) -> Result<(), Error> {
        let bytes = self.bytes(index)?;
        self.segment = index;
        self.next = 0;
        self.from = vec![0; self.tracks.len()];
        self.units = match ts::demux(&bytes) {
            Ok(demuxed) => {
                self.demux_skipped += demuxed.skipped;
                place(&demuxed, &self.tracks, self.starts[index])
            }
            Err(error) => {
                log::warn!("player: replay segment {index} is unreadable ({error:?}); skipped");
                self.demux_skipped += 1;
                Vec::new()
            }
        };
        self.start_prefetch(index + 1);
        Ok(())
    }

    /// A segment's bytes: cached, prefetched, or fetched now.
    fn bytes(&mut self, index: usize) -> Result<Arc<Vec<u8>>, Error> {
        if let Some(bytes) = self.cache.get(index) {
            return Ok(bytes);
        }
        let prefetched = match self.prefetch.take() {
            Some(prefetch) if prefetch.index == index => prefetch.result.recv().ok(),
            other => {
                self.prefetch = other;
                None
            }
        };
        let fetched = match prefetched {
            Some(Ok(bytes)) => bytes,
            // A failed prefetch gets its own fetch, with retries again.
            _ => {
                fetch_with_retries(self.fetch.as_ref(), index, &self.cancel).map_err(fetch_error)?
            }
        };
        let bytes = Arc::new(fetched);
        self.cache.insert(index, bytes.clone());
        self.report_buffered();
        Ok(bytes)
    }

    fn start_prefetch(&mut self, index: usize) {
        if index >= self.starts.len()
            || self.cache.contains(index)
            || self.prefetch.as_ref().is_some_and(|p| p.index == index)
        {
            return;
        }
        let (tx, rx) = mpsc::channel();
        let (fetch, cancel) = (self.fetch.clone(), self.cancel.clone());
        let spawned = std::thread::Builder::new()
            .name(format!("replay-prefetch-{index}"))
            .spawn(move || {
                let _ = tx.send(fetch_with_retries(fetch.as_ref(), index, &cancel));
            });
        if spawned.is_ok() {
            self.prefetch = Some(Prefetch { index, result: rx });
        }
    }

    fn report_buffered(&self) {
        if let Some(report) = &self.buffered {
            report.report(
                buffered_ranges(&self.cache.indices(), &self.starts, self.total),
                None,
            );
        }
    }

    pub(crate) fn next_frame(&mut self) -> Result<Option<Frame<'_>>, Error> {
        loop {
            if let Some(stream) = self.current {
                let decoder = self.decoders[stream].as_mut().ok_or(Error::BadStream)?;
                if decoder.receive(&mut self.frame)? {
                    self.frame.stream = c_int::try_from(stream).map_err(|_| Error::BadStream)?;
                    break;
                }
                self.current = None;
            }
            if !self.input_done {
                if let Some(unit) = self.units.get(self.next) {
                    let index = self.next;
                    self.next += 1;
                    let stream = unit.stream;
                    if index < self.from[stream] {
                        continue;
                    }
                    if let Some(decoder) = self.decoders[stream].as_mut() {
                        decoder.send(&unit.data, unit.pts_us, unit.dts_us)?;
                        self.current = Some(stream);
                        self.positioned_at = None;
                    }
                    continue;
                }
                if self.segment + 1 < self.starts.len() {
                    self.load(self.segment + 1)?;
                    continue;
                }
                self.input_done = true;
            }
            // The end: drain each decoder in turn.
            let Some(stream) = self
                .decoders
                .iter()
                .position(|d| d.as_ref().is_some_and(|d| !d.done))
            else {
                return Ok(None);
            };
            let decoder = self.decoders[stream].as_mut().ok_or(Error::BadStream)?;
            if !decoder.draining {
                decoder.drain()?;
            }
            self.current = Some(stream);
        }
        frame_from_raw(&self.frame).map(Some)
    }
}

/// What a segment says of a stream: AAC's rate and channels from its first ADTS header, H.264's
/// size from a frame decoded from its first keyframe.
fn probe_stream(demuxed: &ts::Demuxed, track: Track) -> StreamInfo {
    let (kind, codec) = stream_info(track.stream_type);
    let mut info = StreamInfo {
        kind,
        codec,
        width: 0,
        height: 0,
        sample_rate: 0,
        channels: 0,
        duration: None,
    };
    let mut units = demuxed.units.iter().filter(|u| u.pid == track.pid);
    match track.stream_type {
        StreamType::AacAdts => {
            if let Some(header) = units.find_map(|u| ts::adts_header(&u.data)) {
                info.sample_rate = header.sample_rate;
                info.channels = u32::from(header.channels);
            }
        }
        StreamType::H264 => {
            if let Some((width, height)) = probe_size(units.skip_while(|u| !u.keyframe)) {
                info.width = width;
                info.height = height;
            }
        }
        _ => {}
    }
    info
}

fn probe_size<'a>(units: impl Iterator<Item = &'a Unit>) -> Option<(u32, u32)> {
    let mut decoder = Decoder::open(ffi::SP_CODEC_H264).ok()?;
    let mut frame = ffi::sp_frame::default();
    for unit in units.take(PROBE_UNITS) {
        decoder.send(&unit.data, None, None).ok()?;
        if decoder.receive(&mut frame).ok()? {
            return Some((
                u32::try_from(frame.width).ok()?,
                u32::try_from(frame.height).ok()?,
            ));
        }
    }
    decoder.drain().ok()?;
    if decoder.receive(&mut frame).ok()? {
        return Some((
            u32::try_from(frame.width).ok()?,
            u32::try_from(frame.height).ok()?,
        ));
    }
    None
}

#[cfg(test)]
#[path = "segments_tests.rs"]
mod tests;
