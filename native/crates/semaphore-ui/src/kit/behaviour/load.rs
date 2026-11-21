//! The load-state host (`design/guide/behaviour.md`, "Load state"), the native side of the web's
//! `useLoadState` and `<LoadState>`: loading, empty, error, ready and refreshing for a screen that
//! fetches, where an error replaces the screen only when there is nothing to show.
//!
//! [`use_load_state`] keeps the reducer in the screen's element state, under the screen's id, for
//! one subject: a new `reset_key` loads from scratch, and only the latest fetch's answer is kept, so
//! a late answer for an earlier subject never shows. [`LoadStateView`] draws the five faces. A
//! refresh that fails while something is shown becomes a danger toast (the reducer's `notify`).

use super::machine::{Machine, drive};
use super::toasts::{ToastRequest, Toasts};
use crate::kit::{Alert, Severity, Skeleton};
use crate::theme::SemTheme;
use gpui_kit::prelude::*;
use gpui_kit::*;
pub use semaphore_design::behaviour::load_state::Status as LoadState;
use semaphore_design::behaviour::load_state::{self as pattern, Effect, Event, Params, State};
use semaphore_design::lounge::{self as t, SPACE_SM};
use std::rc::Rc;

/// The text the error face shows when the fetch gave none.
pub const DEFAULT_ERROR_MESSAGE: &str = "Couldn't load this. Try again.";

type Fetch<T> = Rc<dyn Fn(&mut Window, &mut App) -> Task<Result<T, String>>>;
/// Try again.
pub type Action = Rc<dyn Fn(&mut Window, &mut App)>;
/// A refresh: `true` when the user started it.
pub type Refresh = Rc<dyn Fn(bool, &mut Window, &mut App)>;

type LoadMachine = Machine<State, Event, Effect, Params>;

struct Load<T> {
    machine: LoadMachine,
    reset_key: String,
    data: Option<T>,
    fetch: Fetch<T>,
    is_empty: fn(&T) -> bool,
    /// The fetch in flight; dropping it stops it.
    task: Option<Task<()>>,
}

fn machine<T>(load: &mut Load<T>) -> &mut LoadMachine {
    &mut load.machine
}

/// What the screen draws: the face, the latest answer, and the controls' actions.
pub struct LoadResult<T> {
    pub state: LoadState,
    pub error: Option<String>,
    pub data: Option<T>,
    /// A refresh the user started is in flight: show busy on the control that started it.
    pub refresh_by_user: bool,
    /// Try again, for the error face.
    pub retry: Action,
    /// A refresh: `true` for a refresh button, `false` for a refetch on focus or reconnect.
    pub refresh: Refresh,
}

/// Loads the subject `reset_key` names with `fetch`, keyed by `id` in the screen's element state.
/// `is_empty` says when an answer has nothing in it. Call it in every render.
pub fn use_load_state<T: Clone + 'static>(
    id: impl Into<ElementId>,
    reset_key: impl Into<String>,
    fetch: impl Fn(&mut Window, &mut App) -> Task<Result<T, String>> + 'static,
    is_empty: fn(&T) -> bool,
    window: &mut Window,
    cx: &mut App,
) -> LoadResult<T> {
    let id: ElementId = id.into();
    let reset_key = reset_key.into();
    let fetch: Fetch<T> = Rc::new(fetch);
    // The toast a failed refresh shows: one per screen, so two screens' never replace each other.
    let params = Params {
        notify_id: format!("load-{id}"),
    };
    let mut fresh = false;
    let state = window.use_keyed_state(id.clone(), cx, |_, _| {
        fresh = true;
        Load {
            machine: Machine::new(pattern::step, pattern::initial(&params), params.clone()),
            reset_key: reset_key.clone(),
            data: None,
            fetch: fetch.clone(),
            is_empty,
            task: None,
        }
    });
    // Rule 2: a new subject starts from scratch; its old answer never shows.
    let changed = state.update(cx, |load, _| {
        load.fetch = fetch;
        load.is_empty = is_empty;
        if load.reset_key != reset_key {
            load.reset_key = reset_key;
            load.data = None;
            load.task = None;
            true
        } else {
            false
        }
    });
    if fresh || changed {
        let state = state.clone();
        // Not while rendering: the fetch it starts may update what renders.
        window.defer(cx, move |window, cx| send(&state, Event::Start, window, cx));
    }
    let (status, error, data, refresh_by_user) = {
        let load = state.read(cx);
        let machine = load.machine.state();
        // Until `start` runs, a new subject reads as loading.
        let status = if fresh || changed {
            LoadState::Loading
        } else {
            machine.status
        };
        (
            status,
            machine.error.clone(),
            load.data.clone(),
            machine.refresh_by_user,
        )
    };
    let retry: Action = {
        let state = state.clone();
        Rc::new(move |window, cx| send(&state, Event::Retry, window, cx))
    };
    let refresh: Refresh = {
        let state = state.clone();
        Rc::new(move |by_user, window, cx| send(&state, Event::Refresh { by_user }, window, cx))
    };
    LoadResult {
        state: status,
        error,
        data,
        refresh_by_user,
        retry,
        refresh,
    }
}

fn send<T: Clone + 'static>(
    state: &Entity<Load<T>>,
    event: Event,
    window: &mut Window,
    cx: &mut App,
) {
    drive(
        state,
        machine::<T>,
        event,
        window,
        cx,
        |effect, window, cx| apply(state, effect, window, cx),
    );
    window.refresh();
}

fn apply<T: Clone + 'static>(
    state: &Entity<Load<T>>,
    effect: Effect,
    window: &mut Window,
    cx: &mut App,
) {
    match effect {
        Effect::Fetch { token } => {
            let fetch = state.read(cx).fetch.clone();
            let running = fetch(window, cx);
            let weak = state.downgrade();
            let task = window.spawn(cx, async move |cx| {
                let result = running.await;
                cx.update(|window, cx| {
                    let Some(state) = weak.upgrade() else { return };
                    let event = match result {
                        Ok(data) => {
                            let empty = (state.read(cx).is_empty)(&data);
                            // Only the latest fetch's answer is kept.
                            state.update(cx, |load, _| {
                                if load.machine.state().token == token {
                                    load.data = Some(data);
                                }
                            });
                            Event::Succeeded { token, empty }
                        }
                        Err(message) => Event::Failed {
                            token,
                            message: if message.trim().is_empty() {
                                DEFAULT_ERROR_MESSAGE.into()
                            } else {
                                message
                            },
                        },
                    };
                    send(&state, event, window, cx);
                })
                .ok();
            });
            state.update(cx, |load, _| load.task = Some(task));
        }
        Effect::Notify { id, message } => {
            if let Some(toasts) = Toasts::of(window, cx) {
                toasts.show(ToastRequest::new(message).id(id).danger(), cx);
            }
        }
    }
}

/// The five faces of a load: a skeleton while loading, the empty text, the error with Try again,
/// and the content (also while it refreshes).
#[derive(IntoElement)]
pub struct LoadStateView {
    id: ElementId,
    state: LoadState,
    error: Option<String>,
    retry: Action,
    empty: SharedString,
    error_title: SharedString,
    lines: usize,
    content: Option<AnyElement>,
}

impl LoadStateView {
    pub fn new<T>(id: impl Into<ElementId>, result: &LoadResult<T>) -> Self {
        Self {
            id: id.into(),
            state: result.state,
            error: result.error.clone(),
            retry: result.retry.clone(),
            empty: "Nothing here yet.".into(),
            error_title: "Couldn't load this".into(),
            lines: 3,
            content: None,
        }
    }

    /// What the empty face says.
    pub fn empty(mut self, text: impl Into<SharedString>) -> Self {
        self.empty = text.into();
        self
    }

    /// What failed, the error face's title: "Couldn't load members".
    pub fn error_title(mut self, title: impl Into<SharedString>) -> Self {
        self.error_title = title.into();
        self
    }

    /// The skeleton's lines.
    pub fn lines(mut self, lines: usize) -> Self {
        self.lines = lines.max(1);
        self
    }

    /// The content, drawn while ready and while it refreshes.
    pub fn content(mut self, content: impl IntoElement) -> Self {
        self.content = Some(content.into_any_element());
        self
    }
}

impl RenderOnce for LoadStateView {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let secondary = cx.sem().role.text_secondary;
        let face = div()
            .id(self.id.clone())
            .flex()
            .flex_col()
            .gap(px(SPACE_SM));
        match self.state {
            LoadState::Loading => face
                .role(Role::Status)
                .aria_label("Loading")
                .child(Skeleton::text((self.id.clone(), "skeleton"), self.lines))
                .into_any_element(),
            LoadState::Empty => face
                .child(
                    crate::kit::overlays::type_text(t::TEXT_BODY, self.empty).text_color(secondary),
                )
                .into_any_element(),
            LoadState::Error => {
                let retry = self.retry.clone();
                face.child(
                    Alert::new(
                        (self.id.clone(), "error"),
                        Severity::Danger,
                        self.error.unwrap_or_else(|| DEFAULT_ERROR_MESSAGE.into()),
                    )
                    .title(self.error_title)
                    .action("Try again", move |window, cx| retry(window, cx)),
                )
                .into_any_element()
            }
            LoadState::Ready | LoadState::Refreshing => {
                face.children(self.content).into_any_element()
            }
        }
    }
}
