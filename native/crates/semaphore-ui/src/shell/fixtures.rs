//! A [`ShellSource`] over an exported scenario, for stories and `rig-shot`. Editable, so a script can
//! change the data and then emit the event core would send.

use super::{Load, MemberRow, RailCounts, ShellSource};
use semaphore_core::model::{
    ChannelRow, CommunityRow, ErrorView, ParticipantView, SessionState, UserView, VoiceStatus,
    VoiceView,
};
use semaphore_core::scenario::ScenarioViews;
use serde_json::Value;
use std::cell::RefCell;
use std::collections::HashMap;
use std::path::Path;

/// Which lists to pretend are loading or failed.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum Fake {
    #[default]
    Ready,
    Loading,
    Failed,
}

#[derive(Default)]
pub struct Fixture {
    pub views: ScenarioViews,
    pub members: HashMap<String, Vec<MemberRow>>,
    pub counts: RailCounts,
    pub communities_state: Fake,
    pub channels_state: Fake,
    pub members_state: Fake,
}

fn failed<T>() -> Load<T> {
    Load::Failed(ErrorView {
        code: "NETWORK".into(),
        message: "Couldn't reach the server".into(),
        retryable: true,
        retry_after_ms: None,
    })
}

/// Holds a [`Fixture`] for a story. `rig-shot`'s `emit` edits it through the global.
pub struct FixtureSource(pub RefCell<Fixture>);

impl ShellSource for FixtureSource {
    fn session(&self) -> SessionState {
        SessionState::SignedIn {
            me: self.0.borrow().views.me.clone(),
        }
    }

    fn communities(&self) -> Load<Vec<CommunityRow>> {
        let fixture = self.0.borrow();
        match fixture.communities_state {
            Fake::Loading => Load::Loading,
            Fake::Failed => failed(),
            Fake::Ready => Load::Ready(fixture.views.communities.clone()),
        }
    }

    fn channels(&self, community_id: &str) -> Load<Vec<ChannelRow>> {
        let fixture = self.0.borrow();
        match fixture.channels_state {
            Fake::Loading => Load::Loading,
            Fake::Failed => failed(),
            Fake::Ready => Load::Ready(
                fixture
                    .views
                    .channels
                    .iter()
                    .filter(|channel| channel.community_id == community_id)
                    .cloned()
                    .collect(),
            ),
        }
    }

    fn members(&self, community_id: &str) -> Load<Vec<MemberRow>> {
        let fixture = self.0.borrow();
        match fixture.members_state {
            Fake::Loading => Load::Loading,
            Fake::Failed => failed(),
            Fake::Ready => Load::Ready(
                fixture
                    .members
                    .get(community_id)
                    .cloned()
                    .unwrap_or_default(),
            ),
        }
    }

    fn rail_counts(&self) -> RailCounts {
        self.0.borrow().counts
    }

    fn voice(&self) -> VoiceView {
        self.0.borrow().views.voice.clone()
    }
}

impl Fixture {
    /// Loads a scenario, with what `ScenarioViews` doesn't carry read from the JSON: members, by
    /// the sandbox's rule that a user with a status is online, and the rail's counters.
    pub fn load(views: ScenarioViews, json_path: &Path) -> Result<Self, String> {
        let raw = std::fs::read_to_string(json_path)
            .map_err(|error| format!("{}: {error}", json_path.display()))?;
        let scenario: Value = serde_json::from_str(&raw).map_err(|error| error.to_string())?;
        let mut members = HashMap::new();
        if let Some(by_community) = scenario["membershipsByCommunity"].as_object() {
            for (community, memberships) in by_community {
                let rows = memberships
                    .as_array()
                    .into_iter()
                    .flatten()
                    .map(member_row)
                    .collect();
                members.insert(community.clone(), rows);
            }
        }
        let dm_unread = scenario["unreadByContextId"]
            .as_object()
            .into_iter()
            .flatten()
            .filter(|(id, _)| id.starts_with("dm-"))
            .map(|(_, entry)| entry["unreadCount"].as_u64().unwrap_or(0) as u32)
            .sum();
        let notifications_unread = scenario["notifications"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|notification| !notification["read"].as_bool().unwrap_or(false))
            .count() as u32;
        Ok(Self {
            views,
            members,
            counts: RailCounts {
                dm_unread,
                notifications_unread,
            },
            ..Self::default()
        })
    }

    pub fn channel_named(&mut self, community_id: &str, name: &str) -> Option<&mut ChannelRow> {
        self.views
            .channels
            .iter_mut()
            .find(|channel| channel.community_id == community_id && channel.name == name)
    }

    pub fn first_community(&self) -> String {
        self.views
            .communities
            .first()
            .map(|community| community.id.clone())
            .unwrap_or_default()
    }

    /// `VoiceConnected`'s state: we're in this channel, everyone muted.
    pub fn connect_voice(&mut self, channel_id: &str) {
        let me = self.views.me.clone();
        let others = self
            .views
            .channels
            .iter()
            .find(|channel| channel.id == channel_id)
            .map(|channel| channel.voice_users.clone())
            .unwrap_or_default();
        let participant = |user: UserView, is_self: bool| ParticipantView {
            identity: user.id.clone(),
            user,
            is_self,
            muted: true,
            ..ParticipantView::default()
        };
        let mut participants = vec![participant(me, true)];
        participants.extend(others.into_iter().map(|user| participant(user, false)));
        self.views.voice = VoiceView {
            status: VoiceStatus::Connected,
            channel_id: Some(channel_id.to_owned()),
            muted: true,
            deafened: false,
            participants,
        };
    }
}

fn member_row(membership: &Value) -> MemberRow {
    let user = &membership["user"];
    let text = |value: &Value| value.as_str().map(str::to_owned);
    let id = text(&user["id"]).unwrap_or_default();
    let status = text(&user["status"]);
    // The first role by position, unless it's the catch-all: what `displayRole` hoists.
    let display_role = membership["roles"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|role| {
            let name = text(&role["name"])?;
            let position = role["position"].as_i64()? as i32;
            Some((name, position))
        })
        .filter(|(name, _)| name != "Member")
        .min_by_key(|(_, position)| *position);
    MemberRow {
        online: id == "me" || status.is_some(),
        user: UserView {
            id,
            username: text(&user["username"]).unwrap_or_default(),
            display_name: text(&user["displayName"]),
            avatar_file_id: text(&user["avatarUrl"]),
        },
        status,
        display_role,
    }
}
