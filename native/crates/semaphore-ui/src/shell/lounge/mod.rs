//! The Lounge shell's pieces (design §3, epic #848 row B10), the native side of
//! `frontend/src/shell/lounge/pieces/`: the dock, the "All communities" sheet, the community's
//! left island (header, channels, voice rooms, your card) and the members island.
//!
//! Each is a view with closed props, as the web's views are: the shell reads its source and
//! builds them (the web's `*Connected` wrappers), stories and tests hand them data. What a piece
//! does is a callback; what it shows of a load is a [`Face`].

mod all_sheet;
mod community_left;
mod dock;
pub mod lines;
mod members_island;
#[cfg(feature = "stories")]
pub mod stories;
#[cfg(test)]
mod tests;
mod user_card;
mod voice_room;

pub use all_sheet::{AllCommunitiesSheet, FootRow, SheetCommunity};
pub use community_left::{
    ChannelItem, ChannelSection, CommunityHeader, CommunityLeft, CommunityLeftAccess,
};
pub use dock::{DockCommunity, DockCurrent, DockStatus, ShellDock};
pub use members_island::MembersIsland;
pub use user_card::UserCard;
pub use voice_room::VoiceRoomCard;

use crate::kit::list_focus::{ListFocusHost, ListKeys, ListOrientation, list_key};
use crate::kit::{LoadResult, LoadState, LoadStateView};
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_design::behaviour::list_focus;
use std::rc::Rc;

/// What a piece does when used.
pub type Act = Rc<dyn Fn(&mut Window, &mut App)>;
/// Likewise, with the id of the row used (a community's, a channel's, a member's).
pub type IdAct = Rc<dyn Fn(&str, &mut Window, &mut App)>;

/// What a piece shows of its list's load.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Face {
    Loading,
    /// Loaded, with nothing in it.
    Empty,
    Error(String),
    Ready,
}

impl Face {
    /// The kit's load faces for this one: a skeleton, the empty text, the error with Try again.
    pub(crate) fn view(&self, id: impl Into<ElementId>, retry: Option<Act>) -> LoadStateView {
        let (state, error) = match self {
            Face::Loading => (LoadState::Loading, None),
            Face::Empty => (LoadState::Empty, None),
            Face::Error(message) => (LoadState::Error, Some(message.clone())),
            Face::Ready => (LoadState::Ready, None),
        };
        let retry: Act = retry.unwrap_or_else(|| Rc::new(|_, _| {}));
        let result: LoadResult<()> = LoadResult {
            state,
            error,
            data: None,
            refresh_by_user: false,
            retry,
            refresh: Rc::new(|_, _, _| {}),
        };
        LoadStateView::new(id, &result)
    }
}

/// One person in a voice room.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RoomPerson {
    pub id: String,
    pub name: String,
    pub file: Option<String>,
}

/// One member in the members island.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MemberSummary {
    pub id: String,
    pub name: String,
    pub file: Option<String>,
    /// The hoisted role, as written ("Mods").
    pub role: Option<String>,
    pub online: bool,
    pub status: Option<String>,
    /// The voice room of this community they are in.
    pub in_room: Option<String>,
}

// ---------------------------------------------------------------------------------------------
// A vertical keyboard list: one Tab stop, Up/Down/Home/End and typeahead, as the web's
// `useListFocus` (vertical) over the rows of a channel list, a sheet or the members.

pub(crate) struct RowList {
    focus: ListFocusHost,
}

fn row_list(state: &mut RowList) -> &mut ListFocusHost {
    &mut state.focus
}

const LIST_PARAMS: list_focus::Params = list_focus::Params {
    wrap: false,
    selection_follows_focus: false,
    typeahead_ms: semaphore_design::lounge::MOTION_TYPEAHEAD_MS,
};

const LIST_KEYS: ListKeys = ListKeys {
    orientation: ListOrientation::Vertical,
    typeahead: true,
    allow_shift: false,
};

/// The focus of one list's rows for this render.
pub(crate) struct Rows {
    state: Entity<RowList>,
    handles: Vec<(String, FocusHandle)>,
    stop: Option<String>,
}

impl Rows {
    /// `rows` are `(id, label)` in order, the label what typeahead matches; `selected` holds the
    /// Tab stop while focus is outside the list.
    pub(crate) fn new(
        id: impl Into<ElementId>,
        rows: Vec<(String, String)>,
        selected: Option<String>,
        window: &mut Window,
        cx: &mut App,
    ) -> Self {
        let state = window.use_keyed_state(id.into(), cx, |_, _| RowList {
            focus: ListFocusHost::new(LIST_PARAMS, LIST_KEYS),
        });
        let rows: Vec<list_focus::Row> = rows
            .into_iter()
            .map(|(id, label)| list_focus::Row {
                id,
                label,
                disabled: false,
            })
            .collect();
        let (handles, stop) = state.update(cx, |state, cx| {
            let synced = state.focus.sync(rows, Some(selected), window, cx);
            (synced.handles, state.focus.tab_stop())
        });
        Self {
            state,
            handles,
            stop,
        }
    }

    /// A row's handle, and whether it is the list's Tab stop.
    pub(crate) fn focus(&self, id: &str) -> Option<(FocusHandle, bool)> {
        self.handles
            .iter()
            .find(|(known, _)| known == id)
            .map(|(_, handle)| (handle.clone(), self.stop.as_deref() == Some(id)))
    }

    /// The list's keys on the element around its rows.
    pub(crate) fn keys(&self, element: Div) -> Div {
        let state = self.state.clone();
        element.on_key_down(move |event: &KeyDownEvent, window, cx| {
            let Some(list_event) = state.read(cx).focus.event_for(&event.keystroke) else {
                return;
            };
            if list_key(&state, row_list, list_event, window, cx).is_some() {
                cx.stop_propagation();
            }
        })
    }
}

/// A `ListRow` with its row focus, when the list has it.
pub(crate) fn focused(row: crate::kit::ListRow, rows: &Rows, id: &str) -> crate::kit::ListRow {
    match rows.focus(id) {
        Some((handle, stop)) => row.focus(&handle, stop),
        None => row,
    }
}

pub(crate) fn column() -> Div {
    div().flex().flex_col().min_w_0()
}

pub(crate) fn text_line(
    style: semaphore_design::lounge::TextStyle,
    content: impl Into<SharedString>,
) -> Div {
    crate::kit::type_text(style, content)
}
