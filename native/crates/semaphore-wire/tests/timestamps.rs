//! A `date-time` in the contract is a `jiff::Timestamp`: the RFC 3339 text the server sends, read
//! as an instant whatever offset it carries, and written back the way the app has always written
//! it (UTC, `Z`, only as many fractional digits as the value has).

use semaphore_wire::types::VoicePresenceUserDto;
use serde_json::{Value, json};

/// A `VoicePresenceUserDto` with the given `joinedAt`, decoded the way a socket frame is.
fn parse(joined_at: &str) -> Result<VoicePresenceUserDto, serde_json::Error> {
    serde_json::from_value(json!({
        "id": "u1",
        "isDeafened": false,
        "isServerMuted": false,
        "joinedAt": joined_at,
        "username": "ava",
    }))
}

fn joined_at(dto: &VoicePresenceUserDto) -> Value {
    serde_json::to_value(dto).expect("a DTO serializes")["joinedAt"].clone()
}

#[test]
fn any_offset_reads_as_the_same_instant() {
    // 2026-09-22T18:00:00Z, written four ways a server may write it.
    let cases = [
        ("2026-09-22T18:00:00Z", 1_790_100_000_000),
        ("2026-09-22T18:00:00.000Z", 1_790_100_000_000),
        ("2026-09-22T18:00:00+00:00", 1_790_100_000_000),
        ("2026-09-22T13:00:00-05:00", 1_790_100_000_000),
        ("2026-09-23T03:30:00+09:30", 1_790_100_000_000),
        ("2026-09-22T18:00:00.123Z", 1_790_100_000_123),
        ("2026-09-22T18:00:00.123456Z", 1_790_100_000_123),
        ("2026-09-22T18:00:00.123456789Z", 1_790_100_000_123),
    ];
    for (text, millis) in cases {
        let dto = parse(text).unwrap_or_else(|error| panic!("{text}: {error}"));
        assert_eq!(dto.joined_at.as_millisecond(), millis, "{text}");
    }
}

#[test]
fn written_timestamps_are_utc_with_the_fraction_the_value_needs() {
    let cases = [
        ("2026-09-22T18:00:00Z", "2026-09-22T18:00:00Z"),
        ("2026-09-22T13:00:00-05:00", "2026-09-22T18:00:00Z"),
        ("2026-09-22T18:00:00.123Z", "2026-09-22T18:00:00.123Z"),
        ("2026-09-22T18:00:00.123456Z", "2026-09-22T18:00:00.123456Z"),
        (
            "2026-09-22T18:00:00.123456789Z",
            "2026-09-22T18:00:00.123456789Z",
        ),
    ];
    for (read, written) in cases {
        let dto = parse(read).unwrap_or_else(|error| panic!("{read}: {error}"));
        assert_eq!(joined_at(&dto), json!(written), "{read}");
    }
}

#[test]
fn text_that_is_not_an_instant_is_refused() {
    // No offset at all is not an instant, and neither is a date alone: a read that would have to
    // guess the zone fails instead.
    for text in [
        "2026-09-22T18:00:00",
        "2026-09-22",
        "yesterday",
        "2026-13-01T00:00:00Z",
    ] {
        assert!(parse(text).is_err(), "{text} was accepted");
    }
}
