//! W2-ui-dms: the DM and group list, the DM header and the create DM or group dialog, from
//! `DirectMessageList.tsx`, `DmListItem.tsx`, `DMChatHeader.tsx`, `CreateDmDialog.tsx` and the
//! sidebar of `DirectMessagesPage.tsx`. Reads `DmList` and `DmRow`.
//!
//! - `DmSidebar`: the column the shell's route sidebar slot draws on `/direct-messages`: a
//!   heading, Messages and Friends tabs, and under them the `DmListView` or a `FriendsPanel`.
//! - `DmListView`: one row per conversation, newest first.
//! - `DmHeader`: the top of an open conversation.
//! - `CreateDmDialog`: pick users for a DM (one) or a group (several, optionally named).
//! - `names`: what a row says, with no GPUI in it. `picker`: the user search both dialogs use.
//!
//! The views take plain data and emit what the user asked for; the owner calls core.

mod create;
pub(crate) mod face;
mod header;
mod list;
pub mod names;
pub mod picker;
#[cfg(test)]
pub(crate) mod rig;
mod sidebar;
#[cfg(feature = "stories")]
pub(crate) mod stories;
#[cfg(test)]
mod tests;

pub use create::create_request;
pub use picker::{SEARCH_LIMIT, UserPicker, UserPickerEvent};

use crate::friends::{FriendsEvent, FriendsPanel};
use crate::messages::TimeFormat;
use crate::panel::PanelClock;
use gpui_kit::component::input::InputState;
use gpui_kit::*;
use semaphore_core::model::{DmList, DmRow};
use std::collections::HashSet;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DmListEvent {
    /// A row was clicked: the owner navigates to `Route::DirectMessage`.
    Open { dm_id: String },
    /// "Start a conversation" or the sidebar's "+": the owner shows a `CreateDmDialog`.
    NewMessage,
    /// The list failed and the user asked again: `Core::retry_failed`.
    Retry,
}

/// The conversation list. Named for the view, since `DmList` is core's model it reads.
pub struct DmListView {
    list: DmList,
    selected: Option<String>,
    in_call: Option<String>,
    online: HashSet<String>,
    clock: PanelClock,
}

impl EventEmitter<DmListEvent> for DmListView {}

impl DmListView {
    pub fn new(_: &mut Context<Self>) -> Self {
        Self {
            list: DmList::default(),
            selected: None,
            in_call: None,
            online: HashSet::new(),
            clock: PanelClock::default(),
        }
    }

    /// `Core::dm_list`, read again on `ViewChanged { DirectMessages }`.
    pub fn set_list(&mut self, list: DmList, cx: &mut Context<Self>) {
        self.list = list;
        cx.notify();
    }

    /// The open conversation: highlighted, and without an unread mark.
    pub fn set_selected(&mut self, dm_id: Option<String>, cx: &mut Context<Self>) {
        self.selected = dm_id;
        cx.notify();
    }

    /// The DM this user is in a call in, from the voice state: a phone icon on its row.
    pub fn set_in_call(&mut self, dm_id: Option<String>, cx: &mut Context<Self>) {
        self.in_call = dm_id;
        cx.notify();
    }

    /// Extra users to draw as online on a 1:1 row, on top of `DmRow.online` (which core keeps
    /// current). For stories and for an owner that knows presence core hasn't reported yet.
    pub fn set_online(&mut self, user_ids: HashSet<String>, cx: &mut Context<Self>) {
        self.online = user_ids;
        cx.notify();
    }

    /// What "5m ago" is measured from. The real clock unless a story fixes it.
    pub fn set_clock(&mut self, clock: PanelClock, cx: &mut Context<Self>) {
        self.clock = clock;
        cx.notify();
    }

    pub fn list(&self) -> &DmList {
        &self.list
    }
}

/// What the header knows about the conversation.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum DmHeaderState {
    /// Still loading: a skeleton for the name.
    #[default]
    Loading,
    Ready(DmRow),
    /// It failed to load, or isn't this user's: "Conversation unavailable", no buttons.
    Unavailable,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DmHeaderEvent {
    /// The phone layout's back arrow: the owner goes back to `Route::DirectMessages`.
    Back,
    /// W4: the voice or video call button (`dm_call_controls`), offered with `set_call_state`.
    /// `video`: the camera goes on once joined.
    Call { video: bool },
    /// Only offered with `members_button`: the members drawer in a narrow window.
    OpenMembers,
    /// Only offered with `search`: the search panel, for this conversation.
    Search,
    /// A one-to-one DM's name: the other person's profile.
    OpenProfile { user_id: String },
}

pub struct DmHeader {
    state: DmHeaderState,
    back: bool,
    /// W4: where this DM stands for calling; `None`: no call buttons.
    call: Option<crate::voice::DmCallState>,
    members_button: bool,
    search: bool,
}

impl EventEmitter<DmHeaderEvent> for DmHeader {}

impl DmHeader {
    pub fn new(_: &mut Context<Self>) -> Self {
        Self {
            state: DmHeaderState::Loading,
            back: false,
            call: None,
            members_button: false,
            search: false,
        }
    }

    /// `Core::dm(id)` when `Some`; `Loading` while `Core::dm_list` loads, `Unavailable` once it
    /// is ready without this conversation, or failed.
    pub fn set_state(&mut self, state: DmHeaderState, cx: &mut Context<Self>) {
        self.state = state;
        cx.notify();
    }

    /// The phone layout's back arrow.
    pub fn state(&self) -> &DmHeaderState {
        &self.state
    }

    pub fn set_back(&mut self, back: bool, cx: &mut Context<Self>) {
        self.back = back;
        cx.notify();
    }

    /// W4: the call buttons, in this state (`DmCallState::of`); `None` hides them.
    pub fn set_call_state(
        &mut self,
        state: Option<crate::voice::DmCallState>,
        cx: &mut Context<Self>,
    ) {
        if self.call != state {
            self.call = state;
            cx.notify();
        }
    }

    /// A search button, as the channel header's: messages in this conversation.
    pub fn set_search(&mut self, shown: bool, cx: &mut Context<Self>) {
        self.search = shown;
        cx.notify();
    }

    /// A members button, for a window too narrow to show the members beside the messages.
    pub fn set_members_button(&mut self, shown: bool, cx: &mut Context<Self>) {
        self.members_button = shown;
        cx.notify();
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CreateDmEvent {
    /// Debounced: `Core::search_users(query, Some(SEARCH_LIMIT))`, answered with
    /// `dialog.picker().update(.., |picker, cx| picker.set_results(query, .., cx))`.
    Search { query: String },
    /// `Core::create_dm(user_ids, name)`. `name` is only set for a group (two or more users) given
    /// one. The owner calls `set_busy(true)`, then on success `reset` and navigates to the new
    /// conversation, or on failure `set_busy(false)` and `set_failed`.
    Create {
        user_ids: Vec<String>,
        name: Option<String>,
    },
    /// Cancel, Escape or the backdrop: the owner drops the dialog.
    Cancel,
}

pub struct CreateDmDialog {
    picker: Entity<UserPicker>,
    name: Entity<InputState>,
    busy: bool,
    failed: Option<String>,
    _subscriptions: Vec<Subscription>,
}

impl EventEmitter<CreateDmEvent> for CreateDmDialog {}

/// The sidebar's tabs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum DmTab {
    #[default]
    Messages,
    Friends,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DmSidebarEvent {
    List(DmListEvent),
    Friends(FriendsEvent),
    TabChanged(DmTab),
}

/// `DirectMessagesPage`'s sidebar: holds a `DmListView` and a `FriendsPanel`; feed them through
/// `list()` and `friends()`.
pub struct DmSidebar {
    list: Entity<DmListView>,
    friends: Entity<FriendsPanel>,
    tab: DmTab,
    _subscriptions: Vec<Subscription>,
}

impl DmSidebar {
    /// The display clock its list and friends panel measure ages against (`TimeFormat`'s zone
    /// writes a request's date): the app's, unless a story fixes them.
    pub fn set_time(&mut self, time: TimeFormat, cx: &mut Context<Self>) {
        self.list
            .update(cx, |list, cx| list.set_clock(time.now, cx));
        self.friends.update(cx, |friends, cx| {
            friends.set_clock(time.now, cx);
            friends.set_time(time, cx);
        });
    }
}

impl EventEmitter<DmSidebarEvent> for DmSidebar {}

#[cfg(feature = "stories")]
pub fn stories() -> Vec<crate::stories::Story> {
    stories::stories()
}
