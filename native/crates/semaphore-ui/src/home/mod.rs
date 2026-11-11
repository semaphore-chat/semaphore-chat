//! Home (built with W3-ui-profile): the home sections and the zero-community gate, from `pages/HomePage.tsx` and
//! `components/Home/`, and the create community form (`pages/CreateCommunityPage.tsx`).
//!
//! - `HomeScreen`: "Home" with Mentions, Unread messages and In voice now, side by side where
//!   there's room; "You're all caught up" when there's nothing; and, for a user in no communities,
//!   the one next step (`NewUserNextStep.tsx`) instead.
//! - `ZeroCommunityGate` (`ZeroCommunityGate.tsx`): that next step alone, for the phone's "no
//!   community selected" panes.
//! - `CreateCommunityForm`: name and description in a dialog. No images at creation, as the web.
//!
//! The owner builds `HomeData` from what the rail, sidebar and DM list already read
//! (`Core::load_state(ViewKey::Communities)` and `communities()`, the channels' mention counts,
//! `dm_list()`, voice presence), as `useHomeSummary` does. Like every view here they emit what the
//! user asked for; the owner calls core.

mod create;
mod sections;
#[cfg(feature = "stories")]
pub(crate) mod stories;
#[cfg(test)]
mod tests;

pub use create::{
    COMMUNITY_DESCRIPTION_MAX, COMMUNITY_NAME_MAX, COMMUNITY_NAME_MIN, CommunityField,
    validate_community,
};

use gpui_kit::component::input::InputState;
use gpui_kit::*;
use semaphore_core::model::{DmRow, ErrorView, UserView};

/// One part of Home, as the owner has it.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum Section<T> {
    #[default]
    Loading,
    Failed(ErrorView),
    Ready(Vec<T>),
}

impl<T> Section<T> {
    pub fn items(&self) -> &[T] {
        match self {
            Self::Ready(items) => items,
            _ => &[],
        }
    }
}

/// A channel with unread mentions of this user.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct HomeMention {
    pub community_id: String,
    pub community_name: String,
    pub channel_id: String,
    pub channel_name: String,
    pub mention_count: u32,
}

/// A voice channel with people in it.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct HomeVoiceChannel {
    pub community_id: String,
    pub community_name: String,
    pub channel_id: String,
    pub channel_name: String,
    pub users: Vec<UserView>,
}

/// What Home shows.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct HomeData {
    /// The ids of this user's communities: `Core::load_state(ViewKey::Communities)` for the state.
    /// Ready and empty shows the next step instead of the sections.
    pub communities: Section<String>,
    pub mentions: Section<HomeMention>,
    /// DMs and groups with unread messages (`DmRow::unread > 0`), most recent first.
    pub unread_dms: Section<DmRow>,
    pub voice: Section<HomeVoiceChannel>,
}

/// Which section a Retry is for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum HomeSection {
    Communities,
    Mentions,
    UnreadDms,
    Voice,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HomeEvent {
    OpenChannel {
        community_id: String,
        channel_id: String,
    },
    OpenDm {
        group_id: String,
    },
    /// Mentions' "Notifications".
    OpenNotifications,
    /// Unread messages' "All messages", and the next step's "Message someone".
    OpenDms,
    Retry(HomeSection),
    /// "Create a community": the owner shows a `CreateCommunityForm`.
    CreateCommunity,
}

/// `HomePage`.
pub struct HomeScreen {
    data: HomeData,
    can_create_community: bool,
}

impl EventEmitter<HomeEvent> for HomeScreen {}

impl HomeScreen {
    pub fn new(_: &mut Context<Self>) -> Self {
        Self {
            data: HomeData::default(),
            can_create_community: false,
        }
    }

    pub fn set_data(&mut self, data: HomeData, cx: &mut Context<Self>) {
        self.data = data;
        cx.notify();
    }

    /// The instance's `CREATE_COMMUNITY` permission for this user.
    pub fn set_can_create_community(&mut self, can: bool, cx: &mut Context<Self>) {
        self.can_create_community = can;
        cx.notify();
    }
}

/// `ZeroCommunityGate`: for a user in no communities, the one next step, centred in the pane.
/// The owner shows it where the phone would say "pick a community", once communities are ready
/// and empty, and its own pane otherwise.
pub struct ZeroCommunityGate {
    can_create_community: bool,
}

impl EventEmitter<HomeEvent> for ZeroCommunityGate {}

impl ZeroCommunityGate {
    pub fn new(_: &mut Context<Self>) -> Self {
        Self {
            can_create_community: false,
        }
    }

    pub fn set_can_create_community(&mut self, can: bool, cx: &mut Context<Self>) {
        self.can_create_community = can;
        cx.notify();
    }

    /// Whether the gate replaces the pane: communities are read and there are none.
    pub fn applies(communities: &Section<String>) -> bool {
        matches!(communities, Section::Ready(ids) if ids.is_empty())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CreateCommunityEvent {
    /// "Create Community" with a valid form: `Core::create_community(community)`, then
    /// `set_busy(false)` and the owner opens the new community, or `set_error`.
    Submit(semaphore_core::model::NewCommunity),
    Cancel,
}

/// "Create Community", in a dialog.
pub struct CreateCommunityForm {
    name: Entity<InputState>,
    description: Entity<InputState>,
    busy: bool,
    error: Option<String>,
    tried: bool,
    took_focus: bool,
    _subscriptions: Vec<Subscription>,
}

impl EventEmitter<CreateCommunityEvent> for CreateCommunityForm {}

impl CreateCommunityForm {
    /// Creating is on its way: the form waits.
    pub fn set_busy(&mut self, busy: bool, cx: &mut Context<Self>) {
        self.busy = busy;
        if busy {
            self.error = None;
        }
        cx.notify();
    }

    /// Why creating failed (the server's message), until the next try.
    pub fn set_error(&mut self, error: Option<String>, cx: &mut Context<Self>) {
        self.error = error;
        self.busy = false;
        cx.notify();
    }
}

#[cfg(feature = "stories")]
pub fn stories() -> Vec<crate::stories::Story> {
    stories::stories()
}
