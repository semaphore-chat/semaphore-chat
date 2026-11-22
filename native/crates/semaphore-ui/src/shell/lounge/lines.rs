//! The words the Lounge shell's pieces put together from data, pure so tests and stories share
//! them: the web's `communitiesModel.ts`, `community/lines.ts` and `memberLines.ts`.

use super::{MemberSummary, RoomPerson};
use crate::shell::MemberRow;
use semaphore_core::model::{ChannelKind, ChannelRow, CommunityRow};
use semaphore_design::LoungeIcon;
use std::collections::HashSet;

/// The dock's name, and its "All communities" button's and the sheet's title.
pub const DOCK_LABEL: &str = "Communities";
pub const ALL_LABEL: &str = "All communities";
/// More communities than this and the sheet shows its filter field.
pub const FILTER_THRESHOLD: usize = 8;

/// A count as the web's `toLocaleString()` writes it in English: 1,234.
pub fn grouped(count: u32) -> String {
    let digits = count.to_string();
    let mut out = String::new();
    for (index, digit) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index).is_multiple_of(3) {
            out.push(',');
        }
        out.push(digit);
    }
    out
}

/// "1 mention", "3 mentions".
pub fn mention_text(count: u32) -> String {
    if count == 1 {
        "1 mention".into()
    } else {
        format!("{} mentions", grouped(count))
    }
}

/// The foot's Notifications row's count as words: "3 unread"; none at 0.
pub fn notification_count_text(count: u32) -> Option<String> {
    (count > 0).then(|| format!("{} unread", grouped(count)))
}

/// What a sheet row says about a community, besides its name.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct CommunityState {
    pub mentions: u32,
    pub new_messages: bool,
    pub in_your_call: bool,
}

/// A sheet row's second line: the call first, then mentions, new messages, or quiet.
pub fn state_line(state: &CommunityState) -> String {
    if state.in_your_call {
        "You're in a call here".into()
    } else if state.mentions > 0 {
        mention_text(state.mentions)
    } else if state.new_messages {
        "New messages".into()
    } else {
        "Quiet".into()
    }
}

/// The filter: a case-insensitive part of the name; blank matches everything.
pub fn matches_filter(name: &str, filter: &str) -> bool {
    let query = filter.trim().to_lowercase();
    query.is_empty() || name.to_lowercase().contains(&query)
}

/// How long typing must pause before the filter's result is announced.
pub const FILTER_ANNOUNCE_DELAY_MS: u64 = 600;

/// What the filter's result says to a screen reader: the count, or that nothing matches.
pub fn filter_announcement(query: &str, count: usize) -> String {
    match count {
        0 => format!("No community called “{}”", query.trim()),
        1 => "1 community".into(),
        n => format!("{} communities", grouped(n as u32)),
    }
}

/// The Inbox's count (design PA-6): DM unread plus the mentions in every community's channels.
pub fn inbox_count(dm_unread: u32, communities: &[CommunityRow]) -> u32 {
    communities.iter().fold(dm_unread, |sum, community| {
        sum.saturating_add(community.mention_count)
    })
}

/// "9 around"; none when no source knows the number.
pub fn around_line(count: Option<u32>) -> Option<String> {
    count.map(|count| format!("{} around", grouped(count)))
}

/// The header's members button (while the members are not beside the list): its visible words
/// and its name. "12 around" / "12 around, show members"; with no count "Members" for both.
pub fn members_button_text(count: Option<u32>) -> (String, String) {
    match around_line(count) {
        Some(line) => (line.clone(), format!("{line}, show members")),
        None => ("Members".into(), "Members".into()),
    }
}

/// The words a channel row adds to its name: its kind, privacy and mention count.
pub fn channel_trailing_label(announcement: bool, private: bool, mentions: u32) -> String {
    let mut parts = Vec::new();
    if announcement {
        parts.push("announcement channel".to_owned());
    }
    if private {
        parts.push("private".to_owned());
    }
    if mentions > 0 {
        parts.push(mention_text(mentions));
    }
    parts.join(", ")
}

const SHOWN_NAMES: usize = 3;

fn person_name(person: &RoomPerson) -> &str {
    if person.name.is_empty() {
        "Unknown user"
    } else {
        &person.name
    }
}

/// "You, dropbear and pri", "dropbear and 9 more": you first, then the room's order. Listed in a
/// room this device is not in, you are "You on another device".
pub fn people_line(people: &[RoomPerson], you: Option<&str>, you_are_here: bool) -> String {
    let is_you = |person: &RoomPerson| you.is_some_and(|you| person.id == you);
    let mut names: Vec<String> = people
        .iter()
        .filter(|person| is_you(person))
        .map(|_| {
            if you_are_here {
                "You".to_owned()
            } else {
                "You on another device".to_owned()
            }
        })
        .collect();
    names.extend(
        people
            .iter()
            .filter(|person| !is_you(person))
            .map(|person| person_name(person).to_owned()),
    );
    match names.len() {
        0 => String::new(),
        1 => names.remove(0),
        n if n <= SHOWN_NAMES => {
            let last = names.pop().unwrap_or_default();
            format!("{} and {last}", names.join(", "))
        }
        n => {
            let shown = &names[..SHOWN_NAMES - 1];
            format!("{} and {} more", shown.join(", "), n - shown.len())
        }
    }
}

/// "dropbear is talking", "dropbear and pri are talking"; you are left out (you know).
pub fn talking_line(
    people: &[RoomPerson],
    speaking: &HashSet<String>,
    you: Option<&str>,
) -> Option<String> {
    let names: Vec<&str> = people
        .iter()
        .filter(|person| you != Some(person.id.as_str()) && speaking.contains(&person.id))
        .map(person_name)
        .collect();
    match names.as_slice() {
        [] => None,
        [one] => Some(format!("{one} is talking")),
        [a, b] => Some(format!("{a} and {b} are talking")),
        [a, b, rest @ ..] => Some(format!("{a}, {b} and {} more are talking", rest.len())),
    }
}

/// Your mic in the call, as the user card shows it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mic {
    On,
    Muted,
    /// A moderator muted you.
    ServerMuted,
    /// No SPEAK permission here: listening only.
    Blocked,
    PushToTalk,
}

/// In a call: how your mic and sound are.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CallStatus {
    pub mic: Mic,
    pub deafened: bool,
    /// The push-to-talk key ("V"), with `Mic::PushToTalk`.
    pub key_label: Option<String>,
}

/// What the card says about the call: deafened wins (you hear nothing), then the mic.
pub fn call_state(call: &CallStatus) -> (LoungeIcon, String) {
    if call.deafened {
        return (LoungeIcon::HeadphoneOff, "Deafened".into());
    }
    match call.mic {
        Mic::ServerMuted => (LoungeIcon::MicOff, "Muted by a moderator".into()),
        Mic::Blocked => (LoungeIcon::MicOff, "Listening only".into()),
        Mic::PushToTalk => (
            LoungeIcon::Mic,
            match &call.key_label {
                Some(key) => format!("Push to talk ({key})"),
                None => "Push to talk".into(),
            },
        ),
        Mic::Muted => (LoungeIcon::MicOff, "Muted".into()),
        Mic::On => (LoungeIcon::Mic, "Mic on".into()),
    }
}

/// The line under a member's name: their status text, else the voice room they are in. (Core
/// has no last-seen time, so an away member's "Seen 2h ago" is not shown.)
pub fn member_line(member: &MemberSummary) -> Option<String> {
    if let Some(status) = member
        .status
        .as_ref()
        .filter(|status| !status.trim().is_empty())
    {
        return Some(status.clone());
    }
    member.in_room.as_ref().map(|room| format!("In {room}"))
}

/// The members island's three groups.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct MemberGroups {
    /// Members with a hoisted role, highest role first.
    pub hosts: Vec<MemberSummary>,
    /// Online, without one.
    pub around: Vec<MemberSummary>,
    /// Offline, without one.
    pub away: Vec<MemberSummary>,
}

impl MemberGroups {
    /// Online members, hosts included.
    pub fn online(&self) -> u32 {
        let hosts = self.hosts.iter().filter(|member| member.online).count();
        (hosts + self.around.len()) as u32
    }
}

/// The web's `displayName || username`: an empty display name is no name.
fn shown_name(row: &MemberRow) -> String {
    row.user
        .display_name
        .as_deref()
        .filter(|name| !name.trim().is_empty())
        .unwrap_or(&row.user.username)
        .to_owned()
}

/// Groups the shell's member rows for the island: hosts by role position (highest first), then
/// by name; Around and Away by name. "In <room>" comes from the community's voice channels.
pub fn group_members(rows: &[MemberRow], channels: &[ChannelRow]) -> MemberGroups {
    let room_of = |user_id: &str| {
        channels
            .iter()
            .filter(|channel| channel.kind == ChannelKind::Voice)
            .find(|channel| channel.voice_users.iter().any(|user| user.id == user_id))
            .map(|channel| channel.name.clone())
    };
    let mut hosts: Vec<(i32, MemberSummary)> = Vec::new();
    let mut groups = MemberGroups::default();
    for row in rows {
        let summary = MemberSummary {
            id: row.user.id.clone(),
            name: shown_name(row),
            file: row.user.avatar_file_id.clone(),
            role: row.display_role.as_ref().map(|(name, _)| name.clone()),
            online: row.online,
            status: row.status.clone(),
            in_room: room_of(&row.user.id),
        };
        match &row.display_role {
            Some((_, position)) => hosts.push((*position, summary)),
            None if row.online => groups.around.push(summary),
            None => groups.away.push(summary),
        }
    }
    let by_name =
        |a: &MemberSummary, b: &MemberSummary| a.name.to_lowercase().cmp(&b.name.to_lowercase());
    hosts.sort_by(|(pa, a), (pb, b)| pb.cmp(pa).then_with(|| by_name(a, b)));
    groups.hosts = hosts.into_iter().map(|(_, member)| member).collect();
    groups.around.sort_by(by_name);
    groups.away.sort_by(by_name);
    groups
}

/// The community's "N around": only when the list holds every member (core has no community-wide
/// online count, the web's presence endpoint); none otherwise.
pub fn around_count(groups: &MemberGroups, truncated: bool) -> Option<u32> {
    (!truncated).then(|| groups.online())
}
