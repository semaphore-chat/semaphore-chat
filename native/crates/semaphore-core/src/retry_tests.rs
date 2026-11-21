use super::*;
use crate::backend::BackendError;
use semaphore_wire::enums::ErrorCode;

fn key(segments: &[&str]) -> QueryKey {
    QueryKey::new(segments)
}

fn error(status: u16, retryable: bool, retry_after_ms: Option<u64>) -> BackendError {
    BackendError {
        status,
        code: ErrorCode::Unknown("X".into()),
        message: "m".into(),
        retryable,
        retry_after_ms,
    }
}

fn view() -> ErrorView {
    ErrorView {
        code: "FAILED".into(),
        message: "m".into(),
        retryable: true,
        retry_after_ms: None,
    }
}

const TRANSIENT: RetryClass = RetryClass::Transient {
    retry_after_ms: None,
};

// --- classification ---

#[test]
fn a_retryable_error_or_any_429_is_transient_and_everything_else_permanent() {
    assert_eq!(
        RetryClass::of(&error(503, true, None)),
        RetryClass::Transient {
            retry_after_ms: None
        }
    );
    assert_eq!(
        RetryClass::of(&error(429, false, Some(2_500))),
        RetryClass::Transient {
            retry_after_ms: Some(2_500)
        },
        "a 429 is transient whatever the body says"
    );
    assert_eq!(
        RetryClass::of(&error(429, true, None)),
        RetryClass::Transient {
            retry_after_ms: None
        }
    );
    assert_eq!(
        RetryClass::of(&error(0, true, None)),
        RetryClass::Transient {
            retry_after_ms: None
        },
        "a timeout"
    );
    // A response that didn't decode: status 0, not retryable.
    assert_eq!(
        RetryClass::of(&error(0, false, None)),
        RetryClass::Permanent
    );
    for status in [400, 401, 403, 404, 409, 410, 422] {
        assert_eq!(
            RetryClass::of(&error(status, false, None)),
            RetryClass::Permanent,
            "{status}"
        );
    }
    assert_eq!(
        RetryClass::of(&error(500, false, Some(1_000))),
        RetryClass::Permanent,
        "a server error the server says not to retry"
    );
}

// --- the table, without jitter ---

#[test]
fn transient_waits_double_from_one_second_to_a_sixty_second_cap() {
    let table: Vec<u64> = (1..=10)
        .map(|attempt| delay_ms(attempt, TRANSIENT, 0))
        .collect();
    assert_eq!(
        table,
        vec![
            1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000, 60_000, 60_000
        ]
    );
}

#[test]
fn attempt_zero_reads_as_the_first_and_huge_attempts_stay_at_the_cap() {
    assert_eq!(delay_ms(0, TRANSIENT, 0), 1_000);
    for attempt in [17, 63, 64, 1_000, u32::MAX] {
        assert_eq!(delay_ms(attempt, TRANSIENT, 0), CAP_MS, "{attempt}");
        let jittered = delay_ms(attempt, TRANSIENT, u64::MAX);
        assert!(
            (45_000..=CAP_MS).contains(&jittered),
            "{attempt}: {jittered}"
        );
    }
}

#[test]
fn a_permanent_failure_waits_five_minutes_every_time() {
    for attempt in [0, 1, 2, 7, 100, u32::MAX] {
        for jitter in [0, 1, 12_345, u64::MAX] {
            assert_eq!(delay_ms(attempt, RetryClass::Permanent, jitter), 300_000);
        }
    }
}

// --- jitter ---

#[test]
fn jitter_takes_off_at_most_a_quarter_and_never_adds() {
    for attempt in 1..=12 {
        let full = delay_ms(attempt, TRANSIENT, 0);
        for jitter in (0..2_000).chain([u64::MAX - 1, u64::MAX]) {
            let wait = delay_ms(attempt, TRANSIENT, jitter);
            assert!(
                wait <= full,
                "attempt {attempt} jitter {jitter}: {wait} > {full}"
            );
            assert!(
                wait >= full - full / 4,
                "attempt {attempt} jitter {jitter}: {wait} < {}",
                full - full / 4
            );
        }
    }
    // The extremes of the window are reachable.
    assert_eq!(delay_ms(1, TRANSIENT, 250), 750);
    assert_eq!(delay_ms(1, TRANSIENT, 251), 1_000);
    assert_eq!(delay_ms(7, TRANSIENT, 15_000), 45_000);
}

#[test]
fn the_first_wait_is_between_three_quarters_of_a_second_and_one_second() {
    for seed in 0..500 {
        let wait = delay_ms(1, TRANSIENT, jitter(seed, &key(&["k"]), 1));
        assert!((750..=1_000).contains(&wait), "{wait}");
    }
}

#[test]
fn jitter_is_the_same_for_the_same_seed_key_and_attempt() {
    let k = key(&["channelPermissions", "c-1"]);
    assert_eq!(jitter(42, &k, 3), jitter(42, &k, 3));
    // And different for nearly anything else, so clients and keys spread out.
    assert_ne!(jitter(42, &k, 3), jitter(43, &k, 3));
    assert_ne!(jitter(42, &k, 3), jitter(42, &k, 4));
    assert_ne!(
        jitter(42, &k, 3),
        jitter(42, &key(&["channelPermissions", "c-2"]), 3)
    );
}

#[test]
fn jitter_spreads_clients_across_the_window() {
    let k = key(&["k"]);
    let waits: std::collections::HashSet<u64> = (0..200)
        .map(|seed| delay_ms(5, TRANSIENT, jitter(seed, &k, 5)))
        .collect();
    assert!(waits.len() > 100, "only {} distinct waits", waits.len());
}

// --- Retry-After ---

#[test]
fn the_servers_wait_wins_when_longer_and_never_shortens_the_backoff() {
    let after = |ms| RetryClass::Transient {
        retry_after_ms: Some(ms),
    };
    assert_eq!(delay_ms(1, after(5_000), 0), 5_000, "longer than 1 s");
    assert_eq!(
        delay_ms(1, after(5_000), u64::MAX),
        5_000,
        "jitter doesn't cut it"
    );
    assert_eq!(
        delay_ms(4, after(500), 0),
        8_000,
        "shorter: the backoff stands"
    );
    assert_eq!(delay_ms(1, after(0), 0), 1_000);
    assert_eq!(delay_ms(9, after(120_000), 0), 120_000, "past the cap");
    assert_eq!(
        delay_ms(1, after(u64::MAX), 0),
        MAX_RETRY_AFTER_MS,
        "a broken header is capped"
    );
    assert_eq!(
        delay_ms(1, after(MAX_RETRY_AFTER_MS + 1), 0),
        MAX_RETRY_AFTER_MS
    );
}

// --- FailedQueries ---

#[test]
fn failures_in_a_row_count_up_and_push_the_wait_out() {
    let mut failed = FailedQueries::default();
    let k = key(&["caps", "c"]);
    let mut now = 10_000;
    let mut waits = Vec::new();
    for _ in 0..8 {
        let at = failed.record(k.clone(), None, TRANSIENT, now, 7);
        assert!(failed.waiting(&k, now));
        assert!(failed.waiting(&k, at - 1));
        assert!(!failed.waiting(&k, at));
        waits.push(at - now);
        now = at;
    }
    assert_eq!(failed.attempts(&k), 8);
    for (i, wait) in waits.iter().enumerate() {
        let full = delay_ms(i as u32 + 1, TRANSIENT, 0);
        assert!(
            *wait <= full && *wait >= full - full / 4,
            "attempt {}: {wait}",
            i + 1
        );
    }
    assert!(waits[6] >= 45_000 && waits[7] <= 60_000);
}

#[test]
fn a_key_that_never_failed_is_not_waiting_and_has_no_attempts() {
    let failed = FailedQueries::default();
    let k = key(&["k"]);
    assert!(!failed.waiting(&k, 0));
    assert!(!failed.waiting(&k, u64::MAX));
    assert_eq!(failed.attempts(&k), 0);
    assert_eq!(failed.retry_at(&k), None);
    assert_eq!(failed.get(&k), None);
}

#[test]
fn only_a_key_a_view_shows_reads_as_failed() {
    let mut failed = FailedQueries::default();
    failed.record(key(&["shown"]), Some(view()), TRANSIENT, 0, 0);
    failed.record(key(&["hidden"]), None, TRANSIENT, 0, 0);
    assert_eq!(failed.get(&key(&["shown"])), Some(&view()));
    assert_eq!(failed.get(&key(&["hidden"])), None);
    assert!(
        failed.waiting(&key(&["hidden"]), 0),
        "but it waits all the same"
    );
}

#[test]
fn remove_forgets_the_wait_and_the_count() {
    let mut failed = FailedQueries::default();
    let k = key(&["k"]);
    failed.record(k.clone(), Some(view()), TRANSIENT, 0, 0);
    failed.record(k.clone(), Some(view()), TRANSIENT, 0, 0);
    assert_eq!(failed.remove(&k), Some(view()));
    assert!(!failed.waiting(&k, 0));
    assert_eq!(failed.attempts(&k), 0);
    failed.record(k.clone(), None, TRANSIENT, 0, 0);
    assert_eq!(failed.attempts(&k), 1, "counting starts again");
    assert!(
        failed
            .retry_at(&k)
            .is_some_and(|at| (750..=1_000).contains(&at)),
        "a first wait again"
    );
    assert_eq!(failed.remove(&k), None, "no view");
}

#[test]
fn releasing_a_prefix_lets_its_keys_go_now_and_keeps_shown_errors() {
    let mut failed = FailedQueries::default();
    let shown = key(&["caps", "c-1"]);
    let hidden = key(&["caps", "c-2"]);
    let other = key(&["unread"]);
    for _ in 0..3 {
        failed.record(shown.clone(), Some(view()), TRANSIENT, 0, 0);
        failed.record(hidden.clone(), None, TRANSIENT, 0, 0);
        failed.record(other.clone(), Some(view()), TRANSIENT, 0, 0);
    }
    assert_eq!(failed.release_prefix(&key(&["caps"])), vec![shown.clone()]);
    assert!(!failed.waiting(&shown, 0));
    assert!(!failed.waiting(&hidden, 0));
    assert_eq!(
        failed.get(&shown),
        Some(&view()),
        "shown until the answer comes"
    );
    assert_eq!(failed.attempts(&shown), 0);
    assert_eq!(
        failed.retry_at(&hidden),
        None,
        "a hidden one is just forgotten"
    );
    assert!(failed.waiting(&other, 0), "outside the prefix");
    assert_eq!(failed.attempts(&other), 3);
}

#[test]
fn drain_shown_forgets_everything_and_names_the_shown_keys() {
    let mut failed = FailedQueries::default();
    failed.record(key(&["b"]), Some(view()), TRANSIENT, 0, 0);
    failed.record(key(&["a"]), Some(view()), RetryClass::Permanent, 0, 0);
    failed.record(key(&["hidden"]), None, TRANSIENT, 0, 0);
    assert_eq!(failed.drain_shown(), vec![key(&["a"]), key(&["b"])]);
    assert!(!failed.waiting(&key(&["hidden"]), 0));
    assert_eq!(failed.drain_shown(), Vec::<QueryKey>::new());
}

#[test]
fn due_and_next_cover_only_shown_keys() {
    let mut failed = FailedQueries::default();
    let soon = key(&["soon"]);
    let later = key(&["later"]);
    let hidden = key(&["hidden"]);
    let soon_at = failed.record(soon.clone(), Some(view()), TRANSIENT, 0, 0);
    let later_at = failed.record(later.clone(), Some(view()), RetryClass::Permanent, 0, 0);
    failed.record(hidden.clone(), None, TRANSIENT, 0, 0); // due as soon, but no view
    assert!((750..=1_000).contains(&soon_at));
    assert_eq!(later_at, 300_000);
    assert_eq!(failed.next_shown_retry(0), Some(soon_at));
    assert_eq!(failed.due_shown(soon_at - 1), Vec::<QueryKey>::new());
    assert_eq!(failed.due_shown(soon_at), vec![soon.clone()]);
    assert_eq!(
        failed.due_shown(10_000),
        vec![soon.clone()],
        "hidden is never due here"
    );
    assert_eq!(failed.next_shown_retry(soon_at), Some(300_000));
    assert_eq!(failed.due_shown(300_000), vec![later.clone(), soon.clone()]);
    assert_eq!(failed.next_shown_retry(300_000), None);
    failed.clear();
    assert_eq!(failed.next_shown_retry(0), None);
}

#[test]
fn a_clock_near_the_end_saturates_instead_of_wrapping() {
    let mut failed = FailedQueries::default();
    let k = key(&["k"]);
    assert_eq!(
        failed.record(k.clone(), None, RetryClass::Permanent, u64::MAX - 5, 0),
        u64::MAX
    );
    assert!(failed.waiting(&k, u64::MAX - 1));
}
