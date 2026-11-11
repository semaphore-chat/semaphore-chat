//! [`PlayerEvent::Buffered`]: which parts of a file are fetched, as fractions of its bytes,
//! reported when they change and at most every [`THROTTLE`], so a fast download doesn't flood
//! the UI. The last change in a burst is always sent: on the source's tokio runtime once the
//! throttle window ends, or (with no runtime) on the next report or [`BufferedReport::flush`].

use semaphore_core::player::{PlayerEvent, PlayerEvents};
use std::ops::Range;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};
use tokio::runtime::Handle;

/// At most four reports a second.
pub const THROTTLE: Duration = Duration::from_millis(250);

#[derive(Default)]
struct State {
    /// What was last sent.
    sent: Option<Vec<Range<f32>>>,
    sent_at: Option<Instant>,
    /// Newer than `sent`, waiting for the throttle window.
    pending: Option<Vec<Range<f32>>>,
    /// A trailing flush is scheduled on the runtime.
    scheduled: bool,
}

struct Inner {
    events: PlayerEvents,
    state: Mutex<State>,
}

/// Where a player's source reports its fetched ranges. Cheap to clone; every clone throttles
/// together.
#[derive(Clone)]
pub struct BufferedReport {
    inner: Arc<Inner>,
}

impl BufferedReport {
    pub fn new(events: PlayerEvents) -> Self {
        Self {
            inner: Arc::new(Inner {
                events,
                state: Mutex::new(State::default()),
            }),
        }
    }

    /// The whole file is here (read from memory).
    pub fn full(&self) {
        self.report(vec![0.0..1.0], None);
    }

    /// The fetched ranges are now `ranges`. Sent at once unless one was sent within
    /// [`THROTTLE`]; then the latest goes out when the window ends.
    pub fn report(&self, ranges: Vec<Range<f32>>, runtime: Option<&Handle>) {
        let mut state = self.lock();
        if state.pending.is_none() && state.sent.as_ref() == Some(&ranges) {
            return;
        }
        state.pending = Some(ranges);
        let wait = state
            .sent_at
            .map_or(Duration::ZERO, |at| THROTTLE.saturating_sub(at.elapsed()));
        if wait.is_zero() {
            self.send(state);
            return;
        }
        if let Some(runtime) = runtime
            && !state.scheduled
        {
            state.scheduled = true;
            let this = self.clone();
            runtime.spawn(async move {
                // The end of the throttle window: a rate limit, not a wait for an event.
                tokio::time::sleep(wait).await;
                let mut state = this.lock();
                state.scheduled = false;
                this.send(state);
            });
        }
    }

    /// Sends a held-back report whose window has ended.
    pub fn flush(&self) {
        let state = self.lock();
        let due = state.sent_at.is_none_or(|at| at.elapsed() >= THROTTLE);
        if due {
            self.send(state);
        }
    }

    fn send(&self, mut state: MutexGuard<'_, State>) {
        let Some(ranges) = state.pending.take() else {
            return;
        };
        if state.sent.as_ref() == Some(&ranges) {
            return;
        }
        state.sent = Some(ranges.clone());
        state.sent_at = Some(Instant::now());
        drop(state);
        (self.inner.events)(PlayerEvent::Buffered(ranges));
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        self.inner.state.lock().unwrap_or_else(|p| p.into_inner())
    }
}

/// Block indices (any order, duplicates allowed) of `block`-byte blocks of a `size`-byte file,
/// as merged fractions of the file.
pub fn merged_ranges(mut indices: Vec<u64>, block: u64, size: u64) -> Vec<Range<f32>> {
    if size == 0 || size == u64::MAX || block == 0 {
        return Vec::new();
    }
    indices.sort_unstable();
    indices.dedup();
    let mut bytes: Vec<Range<u64>> = Vec::new();
    for index in indices {
        let start = index.saturating_mul(block);
        if start >= size {
            continue;
        }
        let end = (start + block).min(size);
        match bytes.last_mut() {
            Some(last) if last.end >= start => last.end = last.end.max(end),
            _ => bytes.push(start..end),
        }
    }
    bytes
        .into_iter()
        .map(|r| (r.start as f64 / size as f64) as f32..(r.end as f64 / size as f64) as f32)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    #[test]
    fn blocks_merge_into_sorted_fractions() {
        assert_eq!(merged_ranges(vec![], 10, 100), Vec::<Range<f32>>::new());
        assert_eq!(
            merged_ranges(vec![3, 0, 1, 1], 10, 100),
            [0.0..0.2, 0.3..0.4]
        );
        assert_eq!(merged_ranges(vec![9, 8], 10, 100), [0.8..1.0],);
        assert_eq!(
            merged_ranges(vec![9], 10, 95),
            [(90.0f64 / 95.0) as f32..1.0],
            "the last block is short"
        );
        assert!(merged_ranges(vec![12], 10, 95).is_empty(), "past the end");
        assert!(
            merged_ranges(vec![0], 10, u64::MAX).is_empty(),
            "size unknown"
        );
    }

    #[test]
    fn reports_are_throttled_and_the_latest_is_kept() {
        let (tx, rx) = mpsc::channel();
        let tx = Mutex::new(tx);
        let report = BufferedReport::new(Arc::new(move |event| {
            let _ = tx.lock().unwrap().send(event);
        }));
        report.report(vec![0.0..0.1], None);
        report.report(vec![0.0..0.2], None);
        report.report(vec![0.0..0.3], None);
        let got: Vec<_> = rx.try_iter().collect();
        assert_eq!(
            got,
            [PlayerEvent::Buffered(vec![0.0..0.1])],
            "one inside the window"
        );
        report.flush();
        assert!(rx.try_iter().next().is_none(), "the window hasn't ended");
        report.inner.state.lock().unwrap().sent_at = Some(Instant::now() - THROTTLE);
        report.flush();
        assert_eq!(
            rx.try_iter().collect::<Vec<_>>(),
            [PlayerEvent::Buffered(vec![0.0..0.3])]
        );
        report.inner.state.lock().unwrap().sent_at = Some(Instant::now() - THROTTLE);
        report.report(vec![0.0..0.3], None);
        assert!(rx.try_iter().next().is_none(), "no change, nothing sent");
    }
}
