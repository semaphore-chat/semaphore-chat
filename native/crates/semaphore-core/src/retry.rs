//! When a failed query may be fetched again.
//!
//! Every failed fetch is remembered, whether a view shows it or not, so a UI that reads on every
//! frame can't turn one failure into a stream of requests: [`State::ensure_query`] skips a key
//! until its `retry_at_ms`. How long that is depends on the failure ([`RetryClass`]):
//!
//! - **Transient** (the server said `retryable`, or answered 429): 1 s, doubling each time to a
//!   60 s cap, less up to a quarter of jitter so clients that failed together don't come back
//!   together. Never sooner than the server's `Retry-After` / `retryAfterMs`.
//! - **Permanent** (a response that won't decode, a 4xx other than 429, anything core itself
//!   refused): a fixed 5 minutes. Asking sooner gets the same answer.
//!
//! A success forgets the failure, as do an invalidation of the key, a new connection and
//! `Core::retry_failed`. Keys a view shows also come back on their own: the host calls
//! `Core::retry_due_queries` on a timer (`semaphore-app`'s `services.rs`), which refetches those
//! whose wait is over, so the view recovers without anything re-rendering it.
//!
//! [`State::ensure_query`]: crate::client::State::ensure_query

use std::collections::HashMap;
use std::hash::{Hash, Hasher};

use crate::backend::BackendError;
use crate::cache::QueryKey;
use crate::model::ErrorView;

/// The first transient wait.
pub const BASE_MS: u64 = 1_000;
/// The longest transient wait.
pub const CAP_MS: u64 = 60_000;
/// The wait after a permanent failure.
pub const PERMANENT_MS: u64 = 5 * 60_000;
/// The longest server-requested wait honoured: a broken or hostile `Retry-After` can't park a
/// query for days.
pub const MAX_RETRY_AFTER_MS: u64 = 15 * 60_000;
/// The longest the host's retry timer sleeps, so a failure recorded meanwhile is seen in time.
pub const MAX_TIMER_MS: u64 = 1_000;

/// What a failure says about asking again.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RetryClass {
    /// Worth asking again soon, but no sooner than `retry_after_ms` when the server said.
    Transient { retry_after_ms: Option<u64> },
    /// The same request will fail the same way.
    Permanent,
}

impl RetryClass {
    /// A REST failure: transient when the server marked it retryable or it's a 429, whatever the
    /// body says. Anything else, including a response that didn't decode (status 0, not
    /// retryable), is permanent.
    pub fn of(error: &BackendError) -> Self {
        if error.retryable || error.status == 429 {
            RetryClass::Transient {
                retry_after_ms: error.retry_after_ms,
            }
        } else {
            RetryClass::Permanent
        }
    }
}

/// How long to wait after the `attempt`th failure in a row (1 for the first). `jitter` is any
/// number; the same one gives the same wait, so a fake clock gets the same schedule every run.
pub fn delay_ms(attempt: u32, class: RetryClass, jitter: u64) -> u64 {
    match class {
        RetryClass::Permanent => PERMANENT_MS,
        RetryClass::Transient { retry_after_ms } => {
            let doublings = attempt.saturating_sub(1).min(16);
            let full = BASE_MS.saturating_mul(1 << doublings).min(CAP_MS);
            let spread = full / 4;
            let backoff = full - jitter % (spread + 1);
            backoff.max(retry_after_ms.unwrap_or(0).min(MAX_RETRY_AFTER_MS))
        }
    }
}

/// A jitter for this key's `attempt`th failure, from the core's `seed`: spread across keys and
/// across clients (each seeds from its start time), fixed for a given seed.
pub fn jitter(seed: u64, key: &QueryKey, attempt: u32) -> u64 {
    // `DefaultHasher::new()` has fixed keys, so this doesn't change from run to run.
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    key.hash(&mut hasher);
    attempt.hash(&mut hasher);
    splitmix64(seed ^ hasher.finish())
}

fn splitmix64(mut x: u64) -> u64 {
    x = x.wrapping_add(0x9E37_79B9_7F4A_7C15);
    x = (x ^ (x >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    x = (x ^ (x >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    x ^ (x >> 31)
}

/// One query's failure.
#[derive(Debug, Clone, PartialEq)]
struct Failure {
    /// What its view shows: `None` for a key no view shows.
    view: Option<ErrorView>,
    /// Failures in a row.
    attempts: u32,
    /// Not fetched again before this, by core's clock.
    retry_at_ms: u64,
}

/// Every query whose last fetch failed: what its view shows, and when it may be asked again.
#[derive(Debug, Default)]
pub struct FailedQueries(HashMap<QueryKey, Failure>);

impl FailedQueries {
    /// What a view showing this key should say: its error, for a key a view shows.
    pub fn get(&self, key: &QueryKey) -> Option<&ErrorView> {
        self.0.get(key)?.view.as_ref()
    }

    /// Forgets the failure: it's shown no more and may be fetched at once. Returns its view's
    /// error, if it had one.
    pub fn remove(&mut self, key: &QueryKey) -> Option<ErrorView> {
        self.0.remove(key)?.view
    }

    pub fn clear(&mut self) {
        self.0.clear();
    }

    /// Records a failed fetch at `now`, one more in a row. `view` is what its view shows, for a key
    /// a view shows. Returns when it may be fetched again.
    pub fn record(
        &mut self,
        key: QueryKey,
        view: Option<ErrorView>,
        class: RetryClass,
        now: u64,
        seed: u64,
    ) -> u64 {
        let attempts = self.0.get(&key).map_or(0, |failure| failure.attempts) + 1;
        let retry_at_ms =
            now.saturating_add(delay_ms(attempts, class, jitter(seed, &key, attempts)));
        self.0.insert(
            key,
            Failure {
                view,
                attempts,
                retry_at_ms,
            },
        );
        retry_at_ms
    }

    /// Whether this key is still waiting out a failure at `now`.
    pub fn waiting(&self, key: &QueryKey, now: u64) -> bool {
        self.0
            .get(key)
            .is_some_and(|failure| now < failure.retry_at_ms)
    }

    /// Failures in a row for this key; 0 when its last fetch didn't fail.
    pub fn attempts(&self, key: &QueryKey) -> u32 {
        self.0.get(key).map_or(0, |failure| failure.attempts)
    }

    /// When this key may be fetched again, if it's failed.
    pub fn retry_at(&self, key: &QueryKey) -> Option<u64> {
        self.0.get(key).map(|failure| failure.retry_at_ms)
    }

    /// The data under `prefix` changed: its failures may be fetched at once, and start counting
    /// again. A view keeps showing its error until the answer comes. Returns the keys a view
    /// shows, which the caller refetches.
    pub fn release_prefix(&mut self, prefix: &QueryKey) -> Vec<QueryKey> {
        self.0
            .retain(|key, failure| !key.starts_with(prefix) || failure.view.is_some());
        let mut shown = Vec::new();
        for (key, failure) in &mut self.0 {
            if key.starts_with(prefix) {
                failure.attempts = 0;
                failure.retry_at_ms = 0;
                shown.push(key.clone());
            }
        }
        shown.sort();
        shown
    }

    /// Forgets every failure. Returns the keys a view showed, sorted.
    pub fn drain_shown(&mut self) -> Vec<QueryKey> {
        let mut shown: Vec<QueryKey> = self
            .0
            .drain()
            .filter_map(|(key, failure)| failure.view.map(|_| key))
            .collect();
        shown.sort();
        shown
    }

    /// The keys a view shows whose wait is over at `now`, sorted.
    pub fn due_shown(&self, now: u64) -> Vec<QueryKey> {
        let mut due: Vec<QueryKey> = self
            .0
            .iter()
            .filter(|(_, failure)| failure.view.is_some() && failure.retry_at_ms <= now)
            .map(|(key, _)| key.clone())
            .collect();
        due.sort();
        due
    }

    /// The soonest wait among the keys a view shows, still to come at `now`.
    pub fn next_shown_retry(&self, now: u64) -> Option<u64> {
        self.0
            .values()
            .filter(|failure| failure.view.is_some() && failure.retry_at_ms > now)
            .map(|failure| failure.retry_at_ms)
            .min()
    }
}

#[cfg(test)]
#[path = "retry_tests.rs"]
mod tests;
