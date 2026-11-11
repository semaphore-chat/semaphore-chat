//! Whether a notification the server sent should raise an OS notification, and with what sound.
//! Pure: everything it reads is in [`NotifyInput`], so the rules are tested as a table.
//!
//! The server has already applied most rules before it sends `newNotification`: it never notifies
//! the author, a muted channel gets nothing (not even a mention), `mentions` channels get no
//! channel-message notifications, and `dmNotifications: false` stops DM ones. Core checks those
//! again from what it has cached, because a setting changed on another device may not have reached
//! the server's decision yet, and adds what the server leaves to the client, as the web's
//! `useNotificationSideEffects` does:
//!
//! 1. once per notification id (a reconnect can replay one);
//! 2. not when already read, nor for this user's own message;
//! 3. not when desktop notifications are off (`desktopEnabled`, which the web ignores);
//! 4. DMs only with `dmNotifications`; a channel's level (its own, else the default): `Muted`
//!    stops everything, `Mentions` stops channel messages; thread replies ignore the level;
//! 5. not while the window is focused on that conversation (its channel or DM is the main view,
//!    or its thread is the open thread);
//! 6. not during do-not-disturb, DMs included.
//!
//! Sound: none without `playSound`. The `default` sound type picks one by kind as the web does
//! (a DM its own, a mention or thread reply the mention sound, a channel message the default);
//! `mention` or `dm` is the user's choice for every kind.

use crate::model::{
    Conversation, NotificationKind, NotificationSettings, NotifyLevel, NotifySound,
};

/// What [`decide`] looks at.
#[derive(Debug, Clone)]
pub struct NotifyInput<'a> {
    pub kind: NotificationKind,
    pub author_id: &'a str,
    pub read: bool,
    /// Its channel or DM.
    pub conversation: &'a Conversation,
    /// Set when the server says which thread a reply is in.
    pub parent_message_id: Option<&'a str>,
    pub me_id: &'a str,
    /// Raised for this id already.
    pub already_raised: bool,
    /// The user's settings, or the server's defaults while they load.
    pub settings: &'a NotificationSettings,
    /// The channel's own level, when known.
    pub channel_level: Option<NotifyLevel>,
    pub window_focused: bool,
    pub main_conversation: Option<&'a Conversation>,
    pub thread_conversation: Option<&'a Conversation>,
    pub now_ms: u64,
}

/// Why no notification is raised.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Skip {
    AlreadyRaised,
    Read,
    Own,
    DesktopOff,
    DmsOff,
    ChannelLevel,
    Focused,
    DoNotDisturb,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verdict {
    Raise { sound: Option<NotifySound> },
    Skip(Skip),
}

pub fn decide(input: &NotifyInput<'_>) -> Verdict {
    let settings = input.settings;
    if input.already_raised {
        return Verdict::Skip(Skip::AlreadyRaised);
    }
    if input.read {
        return Verdict::Skip(Skip::Read);
    }
    if !input.me_id.is_empty() && input.author_id == input.me_id {
        return Verdict::Skip(Skip::Own);
    }
    if !settings.desktop_enabled {
        return Verdict::Skip(Skip::DesktopOff);
    }
    match input.conversation {
        Conversation::DirectMessage { .. } => {
            if !settings.dm_notifications {
                return Verdict::Skip(Skip::DmsOff);
            }
        }
        _ if input.kind == NotificationKind::ThreadReply => {}
        _ => match input.channel_level.unwrap_or(settings.default_level) {
            NotifyLevel::Muted => return Verdict::Skip(Skip::ChannelLevel),
            NotifyLevel::Mentions if input.kind == NotificationKind::ChannelMessage => {
                return Verdict::Skip(Skip::ChannelLevel);
            }
            _ => {}
        },
    }
    if input.window_focused {
        let main = input.main_conversation == Some(input.conversation);
        let thread = input.parent_message_id.is_some_and(|parent| {
            matches!(input.thread_conversation,
                Some(Conversation::Thread { parent_message_id }) if parent_message_id == parent)
        });
        if main || thread {
            return Verdict::Skip(Skip::Focused);
        }
    }
    if dnd_active(settings, input.now_ms) {
        return Verdict::Skip(Skip::DoNotDisturb);
    }
    let sound = settings.play_sound.then_some(match settings.sound {
        NotifySound::Default => match input.kind {
            NotificationKind::DirectMessage => NotifySound::Dm,
            NotificationKind::Mention | NotificationKind::ThreadReply => NotifySound::Mention,
            NotificationKind::ChannelMessage => NotifySound::Default,
        },
        chosen => chosen,
    });
    Verdict::Raise { sound }
}

/// Minutes since midnight for `HH:mm`, or `None` if malformed.
pub(crate) fn parse_time(value: Option<&str>) -> Option<u32> {
    let value = value?;
    let (hours, minutes) = value.split_once(':')?;
    if hours.len() != 2 || minutes.len() != 2 {
        return None;
    }
    let (hours, minutes): (u32, u32) = (hours.parse().ok()?, minutes.parse().ok()?);
    (hours < 24 && minutes < 60).then_some(hours * 60 + minutes)
}

/// Do-not-disturb in effect at `now_ms`, as the server's `isDndActive`: off when off; always on
/// without a well-formed window, or when start equals end; otherwise inside the window in the
/// user's timezone (UTC when unset or unknown), an overnight window wrapping midnight.
pub fn dnd_active(settings: &NotificationSettings, now_ms: u64) -> bool {
    if !settings.dnd {
        return false;
    }
    let (Some(start), Some(end)) = (
        parse_time(settings.dnd_start.as_deref()),
        parse_time(settings.dnd_end.as_deref()),
    ) else {
        return true;
    };
    if start == end {
        return true;
    }
    let current = local_minutes(settings.dnd_timezone.as_deref(), now_ms);
    if start > end {
        current >= start || current < end
    } else {
        current >= start && current < end
    }
}

/// This device's IANA time zone, such as `Europe/Berlin`, which do-not-disturb hours are saved
/// with. `None` when the system's zone can't be read or has no IANA name (a bare offset or a
/// copied `/etc/localtime`); hours saved without a zone count as UTC, as on the server.
pub fn system_timezone() -> Option<String> {
    iana_name(&jiff::tz::TimeZone::try_system().ok()?)
}

fn iana_name(tz: &jiff::tz::TimeZone) -> Option<String> {
    tz.iana_name().map(Into::into)
}

/// Minutes past midnight at `now_ms` in `timezone`. The database is the system's (Linux, macOS,
/// Android, iOS) or, on Windows, the copy jiff bundles.
fn local_minutes(timezone: Option<&str>, now_ms: u64) -> u32 {
    let tz = timezone
        .and_then(|name| jiff::tz::TimeZone::get(name).ok())
        .unwrap_or(jiff::tz::TimeZone::UTC);
    let zoned = jiff::Timestamp::from_millisecond(now_ms as i64)
        .unwrap_or_default()
        .to_zoned(tz);
    (zoned.hour() as u32) * 60 + zoned.minute() as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    const ME: &str = "00000000-0000-4000-8000-0000000000aa";
    const THEM: &str = "00000000-0000-4000-8000-0000000000bb";
    const CHANNEL: &str = "00000000-0000-4000-8000-0000000000c1";
    const DM: &str = "00000000-0000-4000-8000-0000000000d1";
    const PARENT: &str = "00000000-0000-4000-8000-0000000000e1";

    /// 2026-11-11T12:00:00Z.
    const NOON_UTC: u64 = 1_794_398_400_000;

    fn channel() -> Conversation {
        Conversation::Channel { id: CHANNEL.into() }
    }

    fn dm() -> Conversation {
        Conversation::DirectMessage { id: DM.into() }
    }

    fn at(hour: u64, minute: u64) -> u64 {
        NOON_UTC - 12 * 3_600_000 + hour * 3_600_000 + minute * 60_000
    }

    struct Case {
        kind: NotificationKind,
        conversation: Conversation,
        settings: NotificationSettings,
        level: Option<NotifyLevel>,
        focused_on: Option<Conversation>,
        thread_open: Option<Conversation>,
        parent: Option<&'static str>,
        author: &'static str,
        read: bool,
        raised: bool,
        now: u64,
    }

    fn case(kind: NotificationKind, conversation: Conversation) -> Case {
        Case {
            kind,
            conversation,
            settings: NotificationSettings::default(),
            level: None,
            focused_on: None,
            thread_open: None,
            parent: None,
            author: THEM,
            read: false,
            raised: false,
            now: NOON_UTC,
        }
    }

    fn run(case: &Case) -> Verdict {
        decide(&NotifyInput {
            kind: case.kind,
            author_id: case.author,
            read: case.read,
            conversation: &case.conversation,
            parent_message_id: case.parent,
            me_id: ME,
            already_raised: case.raised,
            settings: &case.settings,
            channel_level: case.level,
            window_focused: case.focused_on.is_some() || case.thread_open.is_some(),
            main_conversation: case.focused_on.as_ref(),
            thread_conversation: case.thread_open.as_ref(),
            now_ms: case.now,
        })
    }

    fn dnd(start: Option<&str>, end: Option<&str>, tz: Option<&str>) -> NotificationSettings {
        NotificationSettings {
            dnd: true,
            dnd_start: start.map(Into::into),
            dnd_end: end.map(Into::into),
            dnd_timezone: tz.map(Into::into),
            ..NotificationSettings::default()
        }
    }

    use NotificationKind::*;

    #[test]
    fn the_system_zone_is_named_only_when_it_has_an_iana_name() {
        let berlin = jiff::tz::TimeZone::get("Europe/Berlin").unwrap();
        assert_eq!(iana_name(&berlin).as_deref(), Some("Europe/Berlin"));
        let offset = jiff::tz::TimeZone::fixed(jiff::tz::offset(2));
        assert_eq!(iana_name(&offset), None);
        if let Some(zone) = system_timezone() {
            assert!(
                jiff::tz::TimeZone::get(&zone).is_ok(),
                "{zone} is a real zone"
            );
        }
    }

    #[test]
    fn the_decision_table() {
        let raise = |sound| Verdict::Raise { sound: Some(sound) };
        let skip = Verdict::Skip;
        let rows: Vec<(&str, Case, Verdict)> = vec![
            (
                "a mention",
                case(Mention, channel()),
                raise(NotifySound::Mention),
            ),
            ("a DM", case(DirectMessage, dm()), raise(NotifySound::Dm)),
            (
                "a thread reply",
                case(ThreadReply, channel()),
                raise(NotifySound::Mention),
            ),
            (
                "a channel message in an `all` channel",
                Case {
                    level: Some(NotifyLevel::All),
                    ..case(ChannelMessage, channel())
                },
                raise(NotifySound::Default),
            ),
            (
                "raised before",
                Case {
                    raised: true,
                    ..case(Mention, channel())
                },
                skip(Skip::AlreadyRaised),
            ),
            (
                "already read",
                Case {
                    read: true,
                    ..case(Mention, channel())
                },
                skip(Skip::Read),
            ),
            (
                "my own message",
                Case {
                    author: ME,
                    ..case(DirectMessage, dm())
                },
                skip(Skip::Own),
            ),
            (
                "desktop notifications off",
                Case {
                    settings: NotificationSettings {
                        desktop_enabled: false,
                        ..Default::default()
                    },
                    ..case(DirectMessage, dm())
                },
                skip(Skip::DesktopOff),
            ),
            (
                "DM notifications off",
                Case {
                    settings: NotificationSettings {
                        dm_notifications: false,
                        ..Default::default()
                    },
                    ..case(DirectMessage, dm())
                },
                skip(Skip::DmsOff),
            ),
            (
                "a muted channel, even a mention",
                Case {
                    level: Some(NotifyLevel::Muted),
                    ..case(Mention, channel())
                },
                skip(Skip::ChannelLevel),
            ),
            (
                "muted by default",
                Case {
                    settings: NotificationSettings {
                        default_level: NotifyLevel::Muted,
                        ..Default::default()
                    },
                    ..case(Mention, channel())
                },
                skip(Skip::ChannelLevel),
            ),
            (
                "a channel's own level beats the default",
                Case {
                    settings: NotificationSettings {
                        default_level: NotifyLevel::Muted,
                        ..Default::default()
                    },
                    level: Some(NotifyLevel::Mentions),
                    ..case(Mention, channel())
                },
                raise(NotifySound::Mention),
            ),
            (
                "a channel message in a `mentions` channel",
                case(ChannelMessage, channel()),
                skip(Skip::ChannelLevel),
            ),
            (
                "a thread reply in a muted channel",
                Case {
                    level: Some(NotifyLevel::Muted),
                    ..case(ThreadReply, channel())
                },
                raise(NotifySound::Mention),
            ),
            (
                "focused on that channel",
                Case {
                    focused_on: Some(channel()),
                    ..case(Mention, channel())
                },
                skip(Skip::Focused),
            ),
            (
                "focused on that DM",
                Case {
                    focused_on: Some(dm()),
                    ..case(DirectMessage, dm())
                },
                skip(Skip::Focused),
            ),
            (
                "focused elsewhere",
                Case {
                    focused_on: Some(dm()),
                    ..case(Mention, channel())
                },
                raise(NotifySound::Mention),
            ),
            (
                "the reply's thread is open",
                Case {
                    parent: Some(PARENT),
                    thread_open: Some(Conversation::Thread {
                        parent_message_id: PARENT.into(),
                    }),
                    ..case(ThreadReply, channel())
                },
                skip(Skip::Focused),
            ),
            (
                "another thread is open",
                Case {
                    parent: Some(PARENT),
                    thread_open: Some(Conversation::Thread {
                        parent_message_id: "other".into(),
                    }),
                    ..case(ThreadReply, channel())
                },
                raise(NotifySound::Mention),
            ),
            (
                "DND with no window",
                Case {
                    settings: dnd(None, None, None),
                    ..case(Mention, channel())
                },
                skip(Skip::DoNotDisturb),
            ),
            (
                "DND silences DMs too",
                Case {
                    settings: dnd(None, None, None),
                    ..case(DirectMessage, dm())
                },
                skip(Skip::DoNotDisturb),
            ),
            (
                "DND outside its window",
                Case {
                    settings: dnd(Some("22:00"), Some("08:00"), None),
                    ..case(Mention, channel())
                },
                raise(NotifySound::Mention),
            ),
            (
                "no sound",
                Case {
                    settings: NotificationSettings {
                        play_sound: false,
                        ..Default::default()
                    },
                    ..case(Mention, channel())
                },
                Verdict::Raise { sound: None },
            ),
            (
                "a chosen sound for every kind",
                Case {
                    settings: NotificationSettings {
                        sound: NotifySound::Dm,
                        ..Default::default()
                    },
                    ..case(Mention, channel())
                },
                raise(NotifySound::Dm),
            ),
        ];
        for (name, case, expected) in rows {
            assert_eq!(run(&case), expected, "{name}");
        }
    }

    #[test]
    fn do_not_disturb_windows() {
        let rows = [
            // (start, end, timezone, now, active)
            ("22:00", "08:00", None, at(23, 30), true),
            ("22:00", "08:00", None, at(7, 59), true),
            ("22:00", "08:00", None, at(8, 0), false),
            ("22:00", "08:00", None, at(21, 59), false),
            ("09:00", "17:00", None, at(9, 0), true),
            ("09:00", "17:00", None, at(17, 0), false),
            ("10:00", "10:00", None, at(3, 0), true),
            ("25:00", "08:00", None, at(12, 0), true),
            ("9:00", "17:00", None, at(3, 0), true),
            // Berlin is UTC+1 in November: 12:00 UTC is 13:00 there.
            ("12:30", "13:30", Some("Europe/Berlin"), at(12, 0), true),
            ("12:30", "13:30", Some("Not/AZone"), at(12, 0), false),
            ("12:30", "13:30", Some("Not/AZone"), at(12, 45), true),
            // New York is UTC-5 in November: 03:00 UTC is 22:00 the day before.
            ("21:00", "23:00", Some("America/New_York"), at(3, 0), true),
        ];
        for (start, end, tz, now, active) in rows {
            assert_eq!(
                dnd_active(&dnd(Some(start), Some(end), tz), now),
                active,
                "{start}-{end} {tz:?} at {now}"
            );
        }
        assert!(!dnd_active(&NotificationSettings::default(), NOON_UTC));
    }

    #[test]
    fn summer_time_moves_the_window() {
        // 2026-07-01T12:00:00Z: Berlin is UTC+2, so 14:00 there.
        let july = 1_782_907_200_000;
        let settings = dnd(Some("13:30"), Some("14:30"), Some("Europe/Berlin"));
        assert!(dnd_active(&settings, july));
        assert!(!dnd_active(&settings, NOON_UTC));
    }
}
