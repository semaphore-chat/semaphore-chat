//! W2-ui-friends: the friends panel, pending requests both ways and the add friend form, from
//! `components/Friends/`. Reads `FriendsView`.
//!
//! - `FriendsPanel`: "All (n)" and "Pending (n)" tabs (`FriendsPanel.tsx`), the friends
//!   (`FriendList`, `FriendCard`), and the requests with Received and Sent tabs
//!   (`FriendRequestList`, `FriendRequestCard`). It sits in the DM sidebar's Friends tab.
//! - `AddFriendForm` (`AddFriendForm.tsx`): a user search with a chip for where this user stands
//!   with each one found, and "Send Friend Request". `AddFriendDialog` puts it in a dialog.
//!
//! Like every view here they emit what the user asked for; the owner calls core.

mod add;
mod panel;
#[cfg(feature = "stories")]
pub(crate) mod stories;
#[cfg(test)]
mod tests;

pub use add::{AddOutcome, friendly_error, relationship_tags};

use crate::dms::picker::UserPicker;
use crate::panel::PanelClock;
use gpui_kit::*;
use semaphore_core::model::FriendsView;

/// The panel's tabs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum FriendsTab {
    #[default]
    All,
    Pending,
}

/// The Pending tab's own tabs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum RequestsTab {
    #[default]
    Received,
    Sent,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FriendsEvent {
    /// A friend's row, or "Message" in its menu: the owner opens (or creates) the DM with them,
    /// `Core::create_dm(vec![user_id], None)`.
    Message {
        user_id: String,
    },
    /// "View Profile" in a friend's menu.
    OpenProfile {
        user_id: String,
    },
    Remove {
        friendship_id: String,
    },
    Accept {
        friendship_id: String,
    },
    Decline {
        friendship_id: String,
    },
    Cancel {
        friendship_id: String,
    },
    /// "Add Friend": the owner shows an `AddFriendDialog`.
    AddFriend,
    /// The view failed and the user asked again: `Core::retry_failed`.
    Retry,
}

pub struct FriendsPanel {
    view: FriendsView,
    tab: FriendsTab,
    requests_tab: RequestsTab,
    show_title: bool,
    /// The friend whose "more" menu is open.
    menu: Option<String>,
    clock: PanelClock,
}

impl EventEmitter<FriendsEvent> for FriendsPanel {}

impl FriendsPanel {
    pub fn new(_: &mut Context<Self>) -> Self {
        Self {
            view: FriendsView::default(),
            tab: FriendsTab::All,
            requests_tab: RequestsTab::Received,
            show_title: true,
            menu: None,
            clock: PanelClock::default(),
        }
    }

    /// `Core::friends`, read again on `ViewChanged { Friends }`.
    pub fn set_view(&mut self, view: FriendsView, cx: &mut Context<Self>) {
        if let Some(open) = &self.menu
            && !view.friends.iter().any(|row| &row.friendship_id == open)
        {
            self.menu = None;
        }
        self.view = view;
        cx.notify();
    }

    pub fn set_tab(&mut self, tab: FriendsTab, cx: &mut Context<Self>) {
        self.tab = tab;
        self.menu = None;
        cx.notify();
    }

    pub fn tab(&self) -> FriendsTab {
        self.tab
    }

    pub fn set_requests_tab(&mut self, tab: RequestsTab, cx: &mut Context<Self>) {
        self.requests_tab = tab;
        cx.notify();
    }

    /// The "Friends" heading; off where something above already says it (the DM sidebar).
    pub fn set_show_title(&mut self, show: bool, cx: &mut Context<Self>) {
        self.show_title = show;
        cx.notify();
    }

    /// What "Today" and "3 days ago" are measured from. The real clock unless a story fixes it.
    pub fn set_clock(&mut self, clock: PanelClock, cx: &mut Context<Self>) {
        self.clock = clock;
        cx.notify();
    }

    /// Requests sent to this user, for a badge on whatever opens this panel.
    pub fn incoming_count(&self) -> usize {
        self.view.incoming.len()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AddFriendEvent {
    /// Debounced, as `UserPickerEvent::Search`: `Core::search_users(query, Some(25))`, answered
    /// with `AddFriendForm::set_results`.
    Search { query: String },
    /// `Core::send_friend_request(user_id)`; answer with `set_outcome`.
    Send { user_id: String },
}

pub struct AddFriendForm {
    pub(crate) picker: Entity<UserPicker>,
    outcome: AddOutcome,
    _subscriptions: Vec<Subscription>,
}

impl EventEmitter<AddFriendEvent> for AddFriendForm {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AddFriendDialogEvent {
    Form(AddFriendEvent),
    Close,
}

/// `AddFriendDialog.tsx`: the form in a dialog titled "Add Friend".
pub struct AddFriendDialog {
    form: Entity<AddFriendForm>,
    _subscriptions: Vec<Subscription>,
}

impl EventEmitter<AddFriendDialogEvent> for AddFriendDialog {}

#[cfg(feature = "stories")]
pub fn stories() -> Vec<crate::stories::Story> {
    stories::stories()
}
