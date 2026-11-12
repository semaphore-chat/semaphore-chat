//! Times and sizes as the web client writes them (`utils/messageTime.ts`, `utils/format.ts`), in
//! English for now. `now` and the zone are parameters so stories and tests don't depend on the clock.

use crate::panel::PanelClock;
use chrono::{DateTime, Datelike as _, FixedOffset, Local, NaiveDate, Utc};

#[derive(Debug, Clone, Copy, Default)]
pub struct TimeFormat {
    /// `None` is the user's local zone.
    pub zone: Option<FixedOffset>,
    /// The app's one display clock: what "Today" is and what every relative age is measured from.
    /// The real one unless a rig or a story fixes it.
    pub now: PanelClock,
}

impl TimeFormat {
    /// A fixed clock in UTC, for stories and tests.
    pub fn fixed(now_ms: i64) -> Self {
        Self {
            zone: FixedOffset::east_opt(0),
            now: PanelClock::fixed(now_ms),
        }
    }

    fn zoned(&self, ms: i64) -> DateTime<FixedOffset> {
        let utc = DateTime::<Utc>::from_timestamp_millis(ms).unwrap_or_default();
        match self.zone {
            Some(zone) => utc.with_timezone(&zone),
            None => utc.with_timezone(&Local).fixed_offset(),
        }
    }

    /// "4:12 PM"
    pub fn clock(&self, ms: i64) -> String {
        self.zoned(ms).format("%-I:%M %p").to_string()
    }

    /// `ms` in this zone, written with `format`, or `""` when it isn't a time.
    pub fn format_at(&self, ms: i64, format: &str) -> String {
        DateTime::<Utc>::from_timestamp_millis(ms)
            .map(|_| self.zoned(ms).format(format).to_string())
            .unwrap_or_default()
    }

    /// The calendar day, for comparing two rows.
    pub fn day(&self, ms: i64) -> NaiveDate {
        self.zoned(ms).date_naive()
    }

    /// "Today", "Yesterday", "Friday, September 18", with the year when it isn't this year.
    pub fn day_label(&self, ms: i64) -> String {
        let now = self.day(self.now.now_ms());
        let day = self.day(ms);
        if day == now {
            "Today".into()
        } else if now.pred_opt() == Some(day) {
            "Yesterday".into()
        } else if day.year() == now.year() {
            self.zoned(ms).format("%A, %B %-d").to_string()
        } else {
            self.zoned(ms).format("%A, %B %-d, %Y").to_string()
        }
    }
}

/// "1.4 MB", as `formatFileSize` writes it.
pub fn file_size(bytes: u64) -> String {
    const UNITS: [&str; 4] = ["KB", "MB", "GB", "TB"];
    if bytes < 1024 {
        return format!("{bytes} B");
    }
    let mut value = bytes as f64 / 1024.0;
    let mut unit = 0;
    while value >= 1024.0 && unit + 1 < UNITS.len() {
        value /= 1024.0;
        unit += 1;
    }
    format!("{value:.1} {}", UNITS[unit])
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
        let real = Utc::now().timestamp_millis();
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
    fn written_times_follow_the_chosen_zone() {
        // 2026-11-04 15:01 UTC, already the 5th in +09:00.
        let after_midnight = 1_793_804_460_000;
        let east = TimeFormat {
            zone: FixedOffset::east_opt(9 * 3600),
            now: PanelClock::fixed(NOW),
        };
        assert_eq!(east.format_at(after_midnight, "%b %-d, %Y"), "Nov 5, 2026");
        assert_eq!(
            TimeFormat::fixed(NOW).format_at(after_midnight, "%b %-d, %Y"),
            "Nov 4, 2026"
        );
        // 2026-11-05 18:16 UTC, already the 6th in +05:45.
        let nepal = TimeFormat {
            zone: FixedOffset::east_opt(5 * 3600 + 45 * 60),
            now: PanelClock::fixed(NOW),
        };
        assert_eq!(
            nepal.format_at(1_793_902_560_000, "%-m/%-d/%Y"),
            "11/6/2026"
        );
        assert_eq!(east.format_at(i64::MAX, "%Y"), "");
    }

    #[test]
    fn sizes_read_like_the_web_client() {
        assert_eq!(file_size(512), "512 B");
        assert_eq!(file_size(2048), "2.0 KB");
        assert_eq!(file_size(5 * 1024 * 1024 + 300_000), "5.3 MB");
    }
}
