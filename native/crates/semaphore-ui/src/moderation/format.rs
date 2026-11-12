//! The words and numbers moderation shows, as pure functions: reasons (the soft cap and the
//! preview), lengths and presets, "until" and "left" times, the log's wording and why an action on
//! a member is off. Times take the app's `TimeFormat` (the zone and clock message times use), so
//! stories and tests fix both.

use crate::dms::names::user_name;
use crate::messages::TimeFormat;
use chrono::{DateTime, FixedOffset, Local, Utc};
use semaphore_core::model::{
    AdminAction, AdminActionKind, BAN_PRESETS_SECONDS, BanDuration, BanRequest,
    ModerationActionKind, ModerationLogRow, ModerationTargetView, NotAllowed,
    TIMEOUT_PRESETS_SECONDS, TimeoutRequest, UserView,
};
use unicode_segmentation::UnicodeSegmentation as _;

// ---- Reasons. ----

/// The reason's soft cap, in characters (grapheme clusters). The server sets none; this keeps the
/// log readable.
pub const REASON_MAX: usize = 512;

/// How long a reason is, as the counter counts it: what is sent, trimmed, in characters.
pub fn reason_len(raw: &str) -> usize {
    raw.trim().graphemes(true).count()
}

/// "12/512".
pub fn reason_counter(raw: &str) -> String {
    format!("{}/{REASON_MAX}", reason_len(raw))
}

/// Whether the reason is over the cap, with what to say then.
pub fn reason_error(raw: &str) -> Option<String> {
    (reason_len(raw) > REASON_MAX).then(|| format!("Keep the reason to {REASON_MAX} characters"))
}

/// What a dialog sends: the reason trimmed, or nothing when it is blank.
pub fn reason_for_send(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_owned())
}

/// A reason on one line, at most `max` characters including the ellipsis, cut between
/// characters (never inside an emoji or a combining sequence).
pub fn reason_preview(reason: &str, max: usize) -> String {
    let joined = reason.split_whitespace().collect::<Vec<_>>().join(" ");
    let count = joined.graphemes(true).count();
    if count <= max {
        return joined;
    }
    if max == 0 {
        return String::new();
    }
    let cut: String = joined.graphemes(true).take(max - 1).collect();
    format!("{}\u{2026}", cut.trim_end())
}

// ---- Lengths and presets. ----

/// The ban dialog's temporary length until one is picked (the web's 1 day).
pub const BAN_DEFAULT_SECONDS: u32 = 86_400;
/// The timeout dialog's length until one is picked (the web's 10 minutes).
pub const TIMEOUT_DEFAULT_SECONDS: u32 = 600;

/// A length as the web's presets name it: "60 seconds", "5 minutes", "1 hour", "1 day", "1 week",
/// "1 month" (30 days). Under two minutes, and anything no larger unit divides, stays in seconds.
pub fn duration_label(seconds: u32) -> String {
    const UNITS: [(u32, &str); 5] = [
        (2_592_000, "month"),
        (604_800, "week"),
        (86_400, "day"),
        (3_600, "hour"),
        (60, "minute"),
    ];
    if seconds >= 120 {
        for (size, unit) in UNITS {
            if seconds.is_multiple_of(size) {
                return plural(seconds / size, unit);
            }
        }
    }
    plural(seconds, "second")
}

fn plural(count: u32, unit: &str) -> String {
    if count == 1 {
        format!("1 {unit}")
    } else {
        format!("{count} {unit}s")
    }
}

/// The presets a dialog offers: core's, or the web's when given none.
pub fn presets_or_default(presets: &[u32], timeout: bool) -> Vec<u32> {
    if !presets.is_empty() {
        presets.to_vec()
    } else if timeout {
        TIMEOUT_PRESETS_SECONDS.to_vec()
    } else {
        BAN_PRESETS_SECONDS.to_vec()
    }
}

/// Which preset is picked: `wanted` when it is offered, else `default` when that is, else the
/// first. `None` only when nothing is offered.
pub fn pick_preset(presets: &[u32], wanted: Option<u32>, default: u32) -> Option<u32> {
    wanted
        .filter(|seconds| presets.contains(seconds))
        .or_else(|| presets.contains(&default).then_some(default))
        .or_else(|| presets.first().copied())
}

/// The ban dialog's choice. Picking Permanent keeps the temporary length for when Temporary is
/// picked again.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BanChoice {
    pub permanent: bool,
    pub seconds: u32,
}

impl Default for BanChoice {
    fn default() -> Self {
        Self {
            permanent: true,
            seconds: BAN_DEFAULT_SECONDS,
        }
    }
}

impl BanChoice {
    pub fn request(self, reason: &str) -> BanRequest {
        BanRequest {
            reason: reason_for_send(reason),
            duration: if self.permanent {
                BanDuration::Permanent
            } else {
                BanDuration::Seconds {
                    seconds: self.seconds,
                }
            },
        }
    }
}

pub fn timeout_request(seconds: u32, reason: &str) -> TimeoutRequest {
    TimeoutRequest {
        seconds,
        reason: reason_for_send(reason),
    }
}

// ---- Times. ----

/// `TimeFormat`'s clock: the fixed instant, or now.
pub fn now_ms(time: &TimeFormat) -> i64 {
    time.now.now_ms()
}

/// An instant in `TimeFormat`'s zone (the user's, unless a story fixes one), as message times are.
fn zoned(time: &TimeFormat, ms: i64) -> Option<DateTime<FixedOffset>> {
    let utc = DateTime::<Utc>::from_timestamp_millis(ms)?;
    Some(match time.zone {
        Some(zone) => utc.with_timezone(&zone),
        None => utc.with_timezone(&Local).fixed_offset(),
    })
}

/// "Nov 5, 2026 at 4:12 PM", in the user's zone.
pub fn date_time(time: &TimeFormat, ms: i64) -> String {
    zoned(time, ms)
        .map(|at| at.format("%b %-d, %Y at %-I:%M %p").to_string())
        .unwrap_or_else(|| "an unknown date".to_owned())
}

/// "Nov 5, 2026 at 4:12:07 PM", the log's time with seconds.
pub fn date_time_seconds(time: &TimeFormat, ms: i64) -> String {
    zoned(time, ms)
        .map(|at| at.format("%b %-d, %Y at %-I:%M:%S %p").to_string())
        .unwrap_or_else(|| "an unknown date".to_owned())
}

/// The furthest apart two instants are taken to be (a thousand years), so any `i64` is safe.
const SPAN_MAX_MS: i64 = 1_000 * 365 * 86_400_000;

/// `then - now` in milliseconds, saturated to a thousand years either way.
fn span(now: i64, then: i64) -> i64 {
    then.saturating_sub(now).clamp(-SPAN_MAX_MS, SPAN_MAX_MS)
}

/// "in 3 days", "5 minutes ago": date-fns' `formatDistanceToNow` with a suffix.
pub fn relative(now: i64, then: i64) -> String {
    crate::panel::common::relative_time(0, span(now, then))
}

/// A ban's status chip.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BanStatus {
    Permanent,
    Expired,
    /// "Expires in 3 days".
    Expires(String),
}

impl BanStatus {
    pub fn label(&self) -> String {
        match self {
            BanStatus::Permanent => "Permanent".to_owned(),
            BanStatus::Expired => "Expired".to_owned(),
            BanStatus::Expires(label) => label.clone(),
        }
    }
}

/// The web's `getBanStatus`: permanent, expired (at or past its end) or when it ends.
pub fn ban_status(now: i64, expires_at_ms: Option<i64>) -> BanStatus {
    match expires_at_ms {
        None => BanStatus::Permanent,
        Some(at) if span(now, at) <= 0 => BanStatus::Expired,
        Some(at) => BanStatus::Expires(format!("Expires {}", relative(now, at))),
    }
}

/// What is left of a timeout: "2d 3h left", "23h 59m left", "4m 05s left", "59s left", or
/// "Expired" at or past its end. A part-second counts as a whole one, so it never reads "0s left".
pub fn timeout_left(now: i64, expires_at_ms: i64) -> String {
    let ms = span(now, expires_at_ms);
    if ms <= 0 {
        return "Expired".to_owned();
    }
    let seconds = (ms + 999) / 1000;
    let (days, hours, minutes, secs) = (
        seconds / 86_400,
        seconds % 86_400 / 3_600,
        seconds % 3_600 / 60,
        seconds % 60,
    );
    if days > 0 {
        format!("{days}d {hours}h left")
    } else if hours > 0 {
        format!("{hours}h {minutes}m left")
    } else if minutes > 0 {
        format!("{minutes}m {secs:02}s left")
    } else {
        format!("{secs}s left")
    }
}

/// "until Nov 12, 2026 at 4:12 PM (in 7 days)", or "until it expires" for one already past.
pub fn until_label(time: &TimeFormat, until_ms: i64) -> String {
    let now = now_ms(time);
    if span(now, until_ms) <= 0 {
        return "until it expires".to_owned();
    }
    format!(
        "until {} ({})",
        date_time(time, until_ms),
        relative(now, until_ms)
    )
}

/// Where a picked length ends: "Until Nov 12, 2026 at 4:12 PM".
pub fn ends_label(time: &TimeFormat, seconds: u32) -> String {
    let end = now_ms(time).saturating_add(i64::from(seconds) * 1000);
    format!("Until {}", date_time(time, end))
}

// ---- The log. ----

/// Every kind the log's filter offers, in the web's order.
pub const LOG_KINDS: [ModerationActionKind; 8] = [
    ModerationActionKind::Ban,
    ModerationActionKind::Unban,
    ModerationActionKind::Kick,
    ModerationActionKind::Timeout,
    ModerationActionKind::RemoveTimeout,
    ModerationActionKind::DeleteMessage,
    ModerationActionKind::PinMessage,
    ModerationActionKind::UnpinMessage,
];

/// The web's `ACTION_CONFIG` label, for the chip and the filter.
pub fn action_label(kind: ModerationActionKind) -> &'static str {
    match kind {
        ModerationActionKind::Ban => "Ban User",
        ModerationActionKind::Unban => "Unban User",
        ModerationActionKind::Kick => "Kick User",
        ModerationActionKind::Timeout => "Timeout User",
        ModerationActionKind::RemoveTimeout => "Remove Timeout",
        ModerationActionKind::DeleteMessage => "Delete Message",
        ModerationActionKind::PinMessage => "Pin Message",
        ModerationActionKind::UnpinMessage => "Unpin Message",
        ModerationActionKind::Unknown => "Other Action",
    }
}

/// The colour an action's chip and icon take.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tone {
    Error,
    Success,
    Warning,
    Primary,
    Neutral,
}

pub fn action_tone(kind: ModerationActionKind) -> Tone {
    match kind {
        ModerationActionKind::Ban | ModerationActionKind::DeleteMessage => Tone::Error,
        ModerationActionKind::Unban | ModerationActionKind::RemoveTimeout => Tone::Success,
        ModerationActionKind::Kick | ModerationActionKind::Timeout => Tone::Warning,
        ModerationActionKind::PinMessage => Tone::Primary,
        ModerationActionKind::UnpinMessage | ModerationActionKind::Unknown => Tone::Neutral,
    }
}

/// The message an entry is about, when the server says (it doesn't yet: a backend fix is due).
fn message_ref(row: &ModerationLogRow) -> Option<String> {
    row.target_message_id
        .as_deref()
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .map(str::to_owned)
}

/// The web's `formatLogEntry`: "Target: Maple • Message: 1a2b3c4d… • For 1 day • Reason: spam", or
/// "No additional details".
pub fn log_detail(row: &ModerationLogRow) -> String {
    let mut parts = Vec::new();
    if let Some(target) = &row.target {
        parts.push(format!("Target: {}", user_name(target)));
    }
    if let Some(message) = message_ref(row) {
        let short: String = message.chars().take(8).collect();
        parts.push(format!("Message: {short}\u{2026}"));
    }
    if let Some(seconds) = row.duration_seconds {
        parts.push(format!("For {}", duration_label(seconds)));
    }
    if let Some(reason) = row
        .reason
        .as_deref()
        .map(str::trim)
        .filter(|r| !r.is_empty())
    {
        parts.push(format!("Reason: {}", reason_preview(reason, 200)));
    }
    if parts.is_empty() {
        "No additional details".to_owned()
    } else {
        parts.join(" \u{2022} ")
    }
}

/// "by Harbor", or "by someone" when the moderator isn't known.
pub fn log_by(moderator: Option<&UserView>) -> String {
    match moderator {
        Some(user) => format!("by {}", user_name(user)),
        None => "by someone".to_owned(),
    }
}

/// "Showing 20 of 57", or how many there are once all are read.
pub fn log_count(shown: usize, total: u32) -> String {
    let total = total as usize;
    if shown >= total {
        match total {
            1 => "1 entry".to_owned(),
            total => format!("{total} entries"),
        }
    } else {
        format!("Showing {shown} of {total}")
    }
}

// ---- What may be done to a member. ----

/// An action the moderation menu offers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MemberAction {
    Kick,
    Timeout,
    RemoveTimeout,
    Ban,
    ChangeRoles,
}

/// Why `action` is off for this member, or `None` when it's on: core's reason for that action.
/// Where core gives none for an action that is off, its shared reason stands in, and failing that
/// the permission is taken to be missing. Lifting a timeout has no rank rule, so only self and a
/// missing permission stop it.
pub fn blocked(target: &ModerationTargetView, action: MemberAction) -> Option<NotAllowed> {
    if target.not_allowed == Some(NotAllowed::SelfTarget) {
        return Some(NotAllowed::SelfTarget);
    }
    let (allowed, own) = match action {
        MemberAction::Kick => (target.can_kick, target.kick_not_allowed),
        MemberAction::Timeout => (target.can_timeout, target.timeout_not_allowed),
        MemberAction::Ban => (target.can_ban, target.ban_not_allowed),
        MemberAction::ChangeRoles => (target.can_change_roles, target.roles_not_allowed),
        MemberAction::RemoveTimeout => (target.can_remove_timeout, None),
    };
    if allowed {
        return None;
    }
    let shared = match action {
        MemberAction::RemoveTimeout => None,
        MemberAction::ChangeRoles => target
            .not_allowed
            .filter(|reason| *reason == NotAllowed::Rank),
        _ => target.not_allowed,
    };
    Some(own.or(shared).unwrap_or(NotAllowed::Missing))
}

/// The op entry for `action` on `user_id`.
pub fn admin_action(kind: AdminActionKind, user_id: &str) -> AdminAction {
    AdminAction {
        kind,
        target_id: Some(user_id.to_owned()),
    }
}

/// What a disabled item says under its label.
pub fn blocked_reason(reason: NotAllowed) -> &'static str {
    match reason {
        NotAllowed::Rank => "They rank the same as or above you",
        NotAllowed::SelfTarget => "You can't moderate yourself",
        NotAllowed::Missing => "You don't have permission",
    }
}

// ---- Being removed. ----

/// The notice's title: "You were removed from X", "You were banned from X" or "X was deleted".
pub fn removed_title(name: &str, cause: &semaphore_core::model::RemovalCause) -> String {
    use semaphore_core::model::RemovalCause;
    let name = name.trim();
    match cause {
        RemovalCause::Kicked { .. } => format!(
            "You were removed from {}",
            if name.is_empty() {
                "this community"
            } else {
                name
            }
        ),
        RemovalCause::Banned { .. } => format!(
            "You were banned from {}",
            if name.is_empty() {
                "this community"
            } else {
                name
            }
        ),
        RemovalCause::Deleted if name.is_empty() => "This community was deleted".to_owned(),
        RemovalCause::Deleted => format!("{name} was deleted"),
    }
}

/// The notice's sentence under the title.
pub fn removed_body(time: &TimeFormat, cause: &semaphore_core::model::RemovalCause) -> String {
    use semaphore_core::model::RemovalCause;
    match cause {
        RemovalCause::Kicked { .. } => {
            "A moderator removed you. You can rejoin if you have an invite link.".to_owned()
        }
        RemovalCause::Banned { until_ms: None, .. } => {
            "The ban is permanent: you can't rejoin.".to_owned()
        }
        RemovalCause::Banned {
            until_ms: Some(until),
            ..
        } => format!("You can't rejoin {}.", until_label(time, *until)),
        RemovalCause::Deleted => "The community no longer exists.".to_owned(),
    }
}

#[cfg(test)]
#[path = "format_tests.rs"]
mod tests;
