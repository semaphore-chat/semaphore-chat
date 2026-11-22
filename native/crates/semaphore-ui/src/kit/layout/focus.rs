//! Focus follows the shown pane: the native side of `useFollowFocus`.

use crate::kit::BehaviourHost;
use gpui_kit::*;

struct PaneFocus {
    handles: Vec<FocusHandle>,
    /// The pane focus was last seen in, while it was in one.
    last: Option<usize>,
}

/// What to do about focus this frame, from where it is now.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum FocusMove {
    /// Leave focus where it is.
    Stay,
    /// Move it into the target pane.
    ToTarget,
}

/// The rule, apart from GPUI. `holder` is the pane holding focus in the last drawn frame,
/// `focused` whether anything has focus, `last` the pane focus was last seen in.
pub(crate) fn decide(
    holder: Option<usize>,
    focused: bool,
    last: Option<usize>,
    shown: &[usize],
) -> FocusMove {
    match holder {
        // Focus is in a pane that is no longer shown.
        Some(pane) if !shown.contains(&pane) => FocusMove::ToTarget,
        Some(_) => FocusMove::Stay,
        // Focus was dropped (it went with what was drawn) right after being in a pane that is
        // gone now.
        None if !focused && last.is_some_and(|pane| !shown.contains(&pane)) => FocusMove::ToTarget,
        // Elsewhere (an overlay, outside the layout): left alone.
        None => FocusMove::Stay,
    }
}

/// Keeps keyboard and screen-reader focus from being lost when the pane that holds it stops
/// being shown: the `target` pane takes it. Returns one focus handle per pane (`count` of them,
/// in order) for the panes to `track_focus`; none of them is a Tab stop. `key` names the
/// layout's state. Focus that is somewhere else (an overlay, the toast region) is left alone.
pub(crate) fn follow_focus(
    key: &'static str,
    count: usize,
    shown: &[usize],
    target: usize,
    window: &mut Window,
    cx: &mut App,
) -> Vec<FocusHandle> {
    let state = window.use_keyed_state(key, cx, |_, cx| PaneFocus {
        handles: (0..count).map(|_| cx.focus_handle()).collect(),
        last: None,
    });
    // `contains_focused` reads the last drawn frame: the one where the panes were as they were.
    let (handles, last) = {
        let state = state.read(cx);
        (state.handles.clone(), state.last)
    };
    // Focus in the toast region (drawn inside the main pane) is not the pane's: on the web the
    // region is outside the panes. It counts as elsewhere.
    let in_toast = BehaviourHost::of(window, cx).is_some_and(|host| {
        host.read(cx)
            .toasts
            .region
            .as_ref()
            .is_some_and(|region| region.contains_focused(window, cx))
    });
    let holder = if in_toast {
        None
    } else {
        handles
            .iter()
            .position(|handle| handle.contains_focused(window, cx))
    };
    let focused = window.focused(cx).is_some();
    let step = decide(holder, focused, last, shown);
    let now = match step {
        FocusMove::ToTarget => Some(target),
        FocusMove::Stay if holder.is_some() => holder,
        FocusMove::Stay if focused => None,
        FocusMove::Stay => last,
    };
    state.update(cx, |state, _| state.last = now);
    if step == FocusMove::ToTarget
        && let Some(handle) = handles.get(target).cloned()
    {
        // Not while drawing: the next frame has the pane drawn.
        window.defer(cx, move |window, cx| window.focus(&handle, cx));
    }
    handles
}
