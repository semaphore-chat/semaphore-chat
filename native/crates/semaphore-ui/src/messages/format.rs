//! Times and sizes as the web client writes them (`utils/messageTime.ts`, `utils/format.ts`), in
//! English for now. `now` and the zone are parameters so stories and tests don't depend on the clock.

use crate::panel::PanelClock;
use jiff::civil::Date;
use jiff::tz::{Offset, TimeZone};
use jiff::{Timestamp, ToSpan as _, Zoned};

#[derive(Debug, Clone, Copy, Default)]
pub struct TimeFormat {
    /// `None` is the user's local zone.
    pub zone: Option<Offset>,
    /// The app's one display clock: what "Today" is and what every relative age is measured from.
    /// The real one unless a rig or a story fixes it.
    pub now: PanelClock,
}

impl TimeFormat {
    /// A fixed clock in UTC, for stories and tests.
    pub fn fixed(now_ms: i64) -> Self {
        Self {
            zone: Some(Offset::UTC),
            now: PanelClock::fixed(now_ms),
        }
    }

    /// The zone this format displays in: the fixed one a story pins, or the user's.
    fn time_zone(&self) -> TimeZone {
        match self.zone {
            Some(offset) => TimeZone::fixed(offset),
            None => TimeZone::system(),
        }
    }

    fn zoned(&self, ms: i64) -> Zoned {
        zoned_in(&self.time_zone(), ms)
    }

    /// `ms` in this zone, or `None` when it isn't an instant the wire can carry (which is
    /// everything outside the years a `Timestamp` holds).
    pub fn at(&self, ms: i64) -> Option<Zoned> {
        Timestamp::from_millisecond(ms)
            .ok()
            .map(|at| at.to_zoned(self.time_zone()))
    }

    /// "4:12 PM"
    pub fn clock(&self, ms: i64) -> String {
        self.zoned(ms).strftime("%-I:%M %p").to_string()
    }

    /// `ms` in this zone, written with `format`, or `""` when it isn't a time.
    pub fn format_at(&self, ms: i64, format: &str) -> String {
        self.at(ms)
            .map(|at| at.strftime(format).to_string())
            .unwrap_or_default()
    }

    /// The calendar day, for comparing two rows.
    pub fn day(&self, ms: i64) -> Date {
        self.zoned(ms).date()
    }

    /// "Today", "Yesterday", "Friday, September 18", with the year when it isn't this year.
    pub fn day_label(&self, ms: i64) -> String {
        let now = self.day(self.now.now_ms());
        let day = self.day(ms);
        if day == now {
            "Today".into()
        } else if now.checked_sub(1.day()).ok() == Some(day) {
            "Yesterday".into()
        } else if day.year() == now.year() {
            self.zoned(ms).strftime("%A, %B %-d").to_string()
        } else {
            self.zoned(ms).strftime("%A, %B %-d, %Y").to_string()
        }
    }
}

/// `ms` on the wall clock of `zone`. An instant outside a `Timestamp`'s range (only an `i64`
/// that is not a time at all) reads as the epoch, as it always has for `clock` and `day`.
fn zoned_in(zone: &TimeZone, ms: i64) -> Zoned {
    Timestamp::from_millisecond(ms)
        .unwrap_or(Timestamp::UNIX_EPOCH)
        .to_zoned(zone.clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    // 2026-11-05 16:12:00 UTC
    const NOW: i64 = 1_793_895_120_000;
    const DAY: i64 = 86_400_000;

    #[test]
    fn clock_is_twelve_hour_with_no_leading_zero() {
        let format = TimeFormat::fixed(NOW);
        assert_eq!(format.clock(NOW), "4:12 PM");
        assert_eq!(format.clock(NOW - 12 * 3_600_000), "4:12 AM");
    }

    #[test]
    fn a_fixed_display_clock_decides_each_day_label() {
        // Just before and just after midnight in the fixed UTC zone.
        let midnight = 1_793_923_200_000; // 2026-11-06T00:00:00Z
        let before = TimeFormat::fixed(midnight - 1);
        assert_eq!(before.day_label(midnight - 1), "Today");
        assert_eq!(before.day_label(midnight), "Friday, November 6");
        let after = TimeFormat::fixed(midnight);
        assert_eq!(after.day_label(midnight - 1), "Yesterday");
        assert_eq!(after.day_label(midnight), "Today");
        // An hour earlier is still yesterday; a day and a minute earlier is the date itself.
        assert_eq!(after.day_label(midnight - 3_600_000), "Yesterday");
        assert_eq!(after.day_label(midnight - 86_400_000), "Yesterday");
        assert_eq!(
            after.day_label(midnight - 86_400_001),
            "Wednesday, November 4"
        );
    }

    #[test]
    fn an_unpinned_format_uses_the_real_day() {
        let format = TimeFormat::default();
        assert!(format.now.is_real(), "unpinned means the real clock");
        // Not the rendered day: two reads of the clock can straddle midnight.
        let real = Timestamp::now().as_millisecond();
        assert!(
            (format.now.now_ms() - real).abs() < 5_000,
            "{} is not now ({real})",
            format.now.now_ms()
        );
    }

    #[test]
    fn day_labels_follow_the_web_rules() {
        let format = TimeFormat::fixed(NOW);
        assert_eq!(format.day_label(NOW), "Today");
        assert_eq!(format.day_label(NOW - DAY), "Yesterday");
        assert_eq!(format.day_label(NOW - 3 * DAY), "Monday, November 2");
        assert_eq!(
            format.day_label(NOW - 400 * DAY),
            "Wednesday, October 1, 2025"
        );
    }

    #[test]
    fn days_compare_in_the_chosen_zone() {
        let format = TimeFormat::fixed(NOW);
        assert_ne!(format.day(NOW), format.day(NOW + DAY));
        assert_eq!(format.day(NOW), format.day(NOW + 60_000));
    }

    #[test]
    fn the_users_zone_follows_a_dst_change() {
        // Berlin springs forward on 2026-03-29 at 02:00 CET (01:00 UTC): 01:30 is CET, and half an
        // hour of UTC later the wall clock reads 03:30 CEST.
        let berlin = TimeZone::get("Europe/Berlin")
            .unwrap_or_else(|error| panic!("no Europe/Berlin in the tz database: {error}"));
        let at = |ms| zoned_in(&berlin, ms);
        assert_eq!(
            at(1_774_744_200_000).strftime("%-I:%M %p").to_string(),
            "1:30 AM"
        );
        assert_eq!(
            at(1_774_747_800_000).strftime("%-I:%M %p").to_string(),
            "3:30 AM"
        );
        // The day the clocks went back (2026-10-25) is 25 hours long: from 22:00 UTC on the 24th
        // to 23:00 UTC on the 25th, every instant is that Sunday.
        let midnight = 1_792_879_200_000; // 2026-10-25T00:00 CEST
        let date = |ms| at(ms).date().to_string();
        assert_eq!(date(midnight - 1), "2026-10-24");
        assert_eq!(date(midnight), "2026-10-25");
        assert_eq!(date(midnight + 24 * 3_600_000), "2026-10-25");
        assert_eq!(date(midnight + 25 * 3_600_000), "2026-10-26");
    }

    #[test]
    fn written_times_follow_the_chosen_zone() {
        // 2026-11-04 15:01 UTC, already the 5th in +09:00.
        let after_midnight = 1_793_804_460_000;
        let east = TimeFormat {
            zone: Some(jiff::tz::Offset::constant(9)),
            now: PanelClock::fixed(NOW),
        };
        assert_eq!(east.format_at(after_midnight, "%b %-d, %Y"), "Nov 5, 2026");
        assert_eq!(
            TimeFormat::fixed(NOW).format_at(after_midnight, "%b %-d, %Y"),
            "Nov 4, 2026"
        );
        // 2026-11-05 18:16 UTC, already the 6th in +05:45.
        let nepal = TimeFormat {
            zone: Some(jiff::tz::Offset::from_seconds(5 * 3600 + 45 * 60).expect("a zone")),
            now: PanelClock::fixed(NOW),
        };
        assert_eq!(
            nepal.format_at(1_793_902_560_000, "%-m/%-d/%Y"),
            "11/6/2026"
        );
        assert_eq!(east.format_at(i64::MAX, "%Y"), "");
    }
}
