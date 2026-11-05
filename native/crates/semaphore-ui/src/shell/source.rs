//! What the shell reads. It needs a little more than `Core`'s frozen reads carry, so it reads through
//! this trait: stories implement it over a scenario, and the app over `Core` ([`CoreSource`]).

use semaphore_core::Core;
use semaphore_core::model::{
    ChannelRow, CommunityRow, ErrorView, SessionState, UserView, VoiceView,
};
use std::sync::Arc;

/// A list that may still be on its way.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Load<T> {
    Loading,
    Failed(ErrorView),
    Ready(T),
}

/// One row of the members panel. The frozen `UserView` has no presence, status or role, and core has
/// no read for them yet: a gap for U5, which the shell's model already allows for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MemberRow {
    pub user: UserView,
    pub status: Option<String>,
    pub online: bool,
    /// A hoisted role: its name and position. The rest group under Online and Offline.
    pub display_role: Option<(String, i32)>,
}

/// The rail's counters. Core has no DM or notification read yet.
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
    fn rail_counts(&self) -> RailCounts;
    fn voice(&self) -> VoiceView;
}

/// The app's source: core's reads. Lists read as `Ready`, because core's reads have no loading state.
pub struct CoreSource(pub Arc<Core>);

impl ShellSource for CoreSource {
    fn session(&self) -> SessionState {
        self.0.session()
    }

    fn communities(&self) -> Load<Vec<CommunityRow>> {
        Load::Ready(self.0.communities())
    }

    fn channels(&self, community_id: &str) -> Load<Vec<ChannelRow>> {
        Load::Ready(self.0.channels(community_id.to_owned()))
    }

    fn members(&self, _community_id: &str) -> Load<Vec<MemberRow>> {
        Load::Ready(Vec::new())
    }

    fn rail_counts(&self) -> RailCounts {
        RailCounts::default()
    }

    fn voice(&self) -> VoiceView {
        self.0.voice()
    }
}
