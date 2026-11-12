//! What the shell reads, through this trait: stories implement it over a scenario, and the app over
//! `Core` ([`CoreSource`]).

use semaphore_core::Core;
use semaphore_core::model::{
    ChannelRow, CommunityCaps, CommunityRow, ErrorView, LoadState, SessionState, UserView, ViewKey, VoiceView,
};
use std::sync::Arc;

/// A list that may still be on its way.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Load<T> {
    Loading,
    Failed(ErrorView),
    Ready(T),
}

/// One row of the members panel: core's `MemberView`, with the role as the panel groups by it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MemberRow {
    pub user: UserView,
    pub status: Option<String>,
    pub online: bool,
    /// A hoisted role: its name and position. The rest group under Online and Offline.
    pub display_role: Option<(String, i32)>,
}

/// The rail's counters: core's `RailCounts`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct RailCounts {
    pub dm_unread: u32,
    pub notifications_unread: u32,
}

pub trait ShellSource {
    fn session(&self) -> SessionState;
    fn communities(&self) -> Load<Vec<CommunityRow>>;
    fn channels(&self, community_id: &str) -> Load<Vec<ChannelRow>>;
    fn members(&self, community_id: &str) -> Load<Vec<MemberRow>>;
    /// The community has more members than `members` lists.
    fn members_truncated(&self, _community_id: &str) -> bool {
        false
    }
    fn rail_counts(&self) -> RailCounts;
    fn voice(&self) -> VoiceView;
    /// W5: what this user may do in the community, for the shell's gated entries (the settings
    /// button, the channel list's "+"). All false until known, and in sources that don't say.
    fn community_caps(&self, _community_id: &str) -> CommunityCaps {
        CommunityCaps::default()
    }
}

/// The app's source: core's reads, with `Core::load_state` saying whether each list is there yet.
pub struct CoreSource(pub Arc<Core>);

impl CoreSource {
    fn load<T>(&self, view: ViewKey, read: impl FnOnce() -> T) -> Load<T> {
        // Read first: the read is what asks core to fetch.
        let value = read();
        match self.0.load_state(view) {
            LoadState::Loading => Load::Loading,
            LoadState::Failed { error } => Load::Failed(error),
            LoadState::Ready => Load::Ready(value),
        }
    }
}

impl ShellSource for CoreSource {
    fn session(&self) -> SessionState {
        self.0.session()
    }

    fn communities(&self) -> Load<Vec<CommunityRow>> {
        self.load(ViewKey::Communities, || self.0.communities())
    }

    fn channels(&self, community_id: &str) -> Load<Vec<ChannelRow>> {
        let view = ViewKey::Channels {
            community_id: community_id.to_owned(),
        };
        self.load(view, || self.0.channels(community_id.to_owned()))
    }

    fn members(&self, community_id: &str) -> Load<Vec<MemberRow>> {
        let view = ViewKey::Members {
            community_id: community_id.to_owned(),
        };
        let list = self.0.members(community_id.to_owned());
        match (self.0.load_state(view), list) {
            (LoadState::Failed { error }, _) => Load::Failed(error),
            (_, None) => Load::Loading,
            (_, Some(list)) => Load::Ready(
                list.members
                    .into_iter()
                    .map(|member| MemberRow {
                        user: member.user,
                        status: member.status,
                        online: member.online,
                        display_role: member.display_role.map(|role| (role.name, role.position)),
                    })
                    .collect(),
            ),
        }
    }

    fn members_truncated(&self, community_id: &str) -> bool {
        self.0
            .members(community_id.to_owned())
            .is_some_and(|list| list.truncated)
    }

    fn rail_counts(&self) -> RailCounts {
        let counts = self.0.rail_counts();
        RailCounts {
            dm_unread: counts.dm_unread,
            notifications_unread: counts.notifications_unread,
        }
    }

    fn voice(&self) -> VoiceView {
        self.0.voice()
    }

    fn community_caps(&self, community_id: &str) -> CommunityCaps {
        self.0.community_permissions(community_id.to_owned()).caps
    }
}
