//! The Lounge shell's pieces (design §3, epic #848 row B10), the native side of
//! `frontend/src/shell/lounge/pieces/`: the dock, the "All communities" sheet, the community's
//! left island (header, channels, voice rooms, your card), the members island, and the community
//! home's centre (B12).
//!
//! Each is a view with closed props, as the web's views are: the shell reads its source and
//! builds them (the web's `*Connected` wrappers), stories and tests hand them data. What a piece
//! does is a callback; what it shows of a load is a [`Face`].

mod all_sheet;
pub mod call;
mod community_home;
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
pub use community_home::{CommunityHome, HomeState, home_line};
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
use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

/// What a piece does when used.
pub type Act = Rc<dyn Fn(&mut Window, &mut App)>;
/// Likewise, with the id of the row used (a community's, a channel's, a member's).
pub type IdAct = Rc<dyn Fn(&str, &mut Window, &mut App)>;

/// Try again, for a failed load: required with [`Face::Error`], so an error face never shows a
/// button that does nothing.
#[derive(Clone)]
pub struct Retry(pub Act);

impl Retry {
    pub fn new(handler: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        Self(Rc::new(handler))
    }
}

impl std::fmt::Debug for Retry {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Retry")
    }
}

impl PartialEq for Retry {
    fn eq(&self, other: &Self) -> bool {
        Rc::ptr_eq(&self.0, &other.0)
    }
}

/// What a piece shows of its list's load.
#[derive(Debug, Clone, PartialEq)]
pub enum Face {
    Loading,
    /// Loaded, with nothing in it.
    Empty,
    /// The message, and what Try again does.
    Error(String, Retry),
    Ready,
}

impl Face {
    /// The kit's load faces for this one: a skeleton, the empty text, the error with Try again.
    pub(crate) fn view(&self, id: impl Into<ElementId>) -> LoadStateView {
        let (state, error, retry) = match self {
            Face::Loading => (LoadState::Loading, None, None),
            Face::Empty => (LoadState::Empty, None, None),
            Face::Error(message, retry) => (
                LoadState::Error,
                Some(message.clone()),
                Some(retry.0.clone()),
            ),
            Face::Ready => (LoadState::Ready, None, None),
        };
        // Only the error face has a Try again; the others never call this.
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
    /// Each row's bounds in the last frame, from [`Rows::row`].
    bounds: Rc<RefCell<HashMap<String, Bounds<Pixels>>>>,
    /// [`Rows::centre_once`] has brought its row into view.
    centred: bool,
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

/// Room kept above and below a row brought into view.
const REVEAL_MARGIN: f32 = semaphore_design::lounge::SPACE_SM;

/// How far to move a vertical scroll offset (GPUI's: 0 at the top, negative further down) so a
/// row from `top` to `bottom` is inside the view from `view_top` to `view_bottom`, with `margin`
/// beside it; `None` when it already is. The result stays within `-max..=0`.
pub(crate) fn reveal_offset(
    row: (f32, f32),
    view: (f32, f32),
    offset: f32,
    max: f32,
    margin: f32,
) -> Option<f32> {
    let (top, bottom) = row;
    let (view_top, view_bottom) = view;
    let next = if top < view_top + margin {
        offset + (view_top + margin - top)
    } else if bottom > view_bottom - margin {
        offset - (bottom - (view_bottom - margin))
    } else {
        return None;
    };
    let next = next.clamp(-max.max(0.), 0.);
    (next != offset).then_some(next)
}

/// The offset that puts a row in the middle of the view, within `-max..=0`.
pub(crate) fn centre_offset(row: (f32, f32), view: (f32, f32), offset: f32, max: f32) -> f32 {
    let row_middle = (row.0 + row.1) / 2.;
    let view_middle = (view.0 + view.1) / 2.;
    (offset + (view_middle - row_middle)).clamp(-max.max(0.), 0.)
}

/// The focus of one list's rows for this render.
pub(crate) struct Rows {
    state: Entity<RowList>,
    handles: Vec<(String, FocusHandle)>,
    stop: Option<String>,
    scroll: Option<ScrollHandle>,
}

impl Rows {
    /// `rows` are `(id, label)` in order, the label what typeahead matches; `selected` holds the
    /// Tab stop while focus is outside the list. With `scroll` (the handle of the island or sheet
    /// body the list scrolls in), a row that takes focus is brought into view, as a browser does.
    pub(crate) fn new(
        id: impl Into<ElementId>,
        rows: Vec<(String, String)>,
        selected: Option<String>,
        scroll: Option<ScrollHandle>,
        window: &mut Window,
        cx: &mut App,
    ) -> Self {
        let state = window.use_keyed_state(id.into(), cx, |_, _| RowList {
            focus: ListFocusHost::new(LIST_PARAMS, LIST_KEYS),
            bounds: Rc::default(),
            centred: false,
        });
        let rows: Vec<list_focus::Row> = rows
            .into_iter()
            .map(|(id, label)| list_focus::Row {
                id,
                label,
                disabled: false,
            })
            .collect();
        let (handles, stop, entered, bounds) = state.update(cx, |state, cx| {
            let synced = state.focus.sync(rows, Some(selected), window, cx);
            (
                synced.handles,
                state.focus.tab_stop(),
                synced.entered,
                state.bounds.clone(),
            )
        });
        if let (Some(id), Some(handle)) = (entered, scroll.clone()) {
            // After the frame: the row's bounds are the ones this frame lays out.
            window.defer(cx, move |window, _| {
                let Some(row) = bounds.borrow().get(&id).copied() else {
                    return;
                };
                if reveal(&handle, row, false) {
                    window.refresh();
                }
            });
        }
        Self {
            state,
            handles,
            stop,
            scroll,
        }
    }

    /// A row's handle, and whether it is the list's Tab stop.
    pub(crate) fn focus(&self, id: &str) -> Option<(FocusHandle, bool)> {
        self.handles
            .iter()
            .find(|(known, _)| known == id)
            .map(|(_, handle)| (handle.clone(), self.stop.as_deref() == Some(id)))
    }

    /// The row's element, measured for bringing it into view.
    pub(crate) fn row(&self, id: &str, row: impl IntoElement, cx: &App) -> AnyElement {
        let bounds = self.state.read(cx).bounds.clone();
        let id = id.to_owned();
        div()
            .relative()
            .min_w_0()
            .child(row)
            .child(
                canvas(
                    move |measured, _, _| {
                        bounds.borrow_mut().insert(id.clone(), measured);
                    },
                    |_, _, _, _| {},
                )
                .absolute()
                .top_0()
                .left_0()
                .size_full(),
            )
            .into_any_element()
    }

    /// Brings `id` to the middle of the view once, the first frame it is laid out in (the sheet
    /// opening on the current community).
    pub(crate) fn centre_once(&self, id: Option<&str>, window: &mut Window, cx: &mut App) {
        let (Some(id), Some(handle)) = (id.map(str::to_owned), self.scroll.clone()) else {
            return;
        };
        if self.state.read(cx).centred {
            return;
        }
        let state = self.state.clone();
        window.defer(cx, move |window, cx| {
            let row = state.read(cx).bounds.borrow().get(&id).copied();
            let laid_out = handle.bounds().size.height > px(0.);
            match row {
                Some(row) if laid_out => {
                    state.update(cx, |state, _| state.centred = true);
                    if reveal(&handle, row, true) {
                        window.refresh();
                    }
                }
                // Not measured yet: the next frame has it.
                _ => window.refresh(),
            }
        });
    }

    /// The list's keys on the element around its rows.
    pub(crate) fn keys(&self, element: Div) -> Div {
        let state = self.state.clone();
        let scroll = self.scroll.clone();
        element.on_key_down(move |event: &KeyDownEvent, window, cx| {
            let Some(list_event) = state.read(cx).focus.event_for(&event.keystroke) else {
                return;
            };
            if list_key(&state, row_list, list_event, window, cx).is_none() {
                return;
            }
            cx.stop_propagation();
            // The row the key moved to, brought into view from this frame's layout.
            let list = state.read(cx);
            let row = list
                .focus
                .state()
                .focused
                .as_ref()
                .and_then(|id| list.bounds.borrow().get(id).copied());
            if let (Some(row), Some(handle)) = (row, &scroll)
                && reveal(handle, row, false)
            {
                window.refresh();
            }
        })
    }
}

/// Scrolls `handle` so `row` (window coordinates) is in view, or in the middle with `centre`.
/// Whether it moved.
fn reveal(handle: &ScrollHandle, row: Bounds<Pixels>, centre: bool) -> bool {
    let view = handle.bounds();
    if view.size.height <= px(0.) {
        return false;
    }
    let offset = handle.offset();
    let max = f32::from(handle.max_offset().y);
    let row_span = (f32::from(row.top()), f32::from(row.bottom()));
    let view_span = (f32::from(view.top()), f32::from(view.bottom()));
    let current = f32::from(offset.y);
    let next = if centre {
        Some(centre_offset(row_span, view_span, current, max)).filter(|next| *next != current)
    } else {
        reveal_offset(row_span, view_span, current, max, REVEAL_MARGIN)
    };
    match next {
        Some(next) => {
            handle.set_offset(point(offset.x, px(next)));
            true
        }
        None => false,
    }
}

/// A `ListRow` with its row focus, when the list has it, measured for bringing it into view.
pub(crate) fn focused(row: crate::kit::ListRow, rows: &Rows, id: &str, cx: &App) -> AnyElement {
    let row = match rows.focus(id) {
        Some((handle, stop)) => row.focus(&handle, stop),
        None => row,
    };
    rows.row(id, row, cx)
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
