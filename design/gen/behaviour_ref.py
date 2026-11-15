"""The reference reducers of the behaviour layer: the definition of each pattern.

Each pattern in `design/behaviour/<pattern>.json` is a small state machine.
This module is its executable definition, as `colour_ref.py` is for the
palette: `gen_tokens.py` runs every scenario of every pattern file through
these reducers and writes the resulting vectors, and the TypeScript and Rust
ports must reproduce every one of them.

A reducer is pure:

    step_<pattern>(state, event, params) -> (state, effects)

It never reads a clock, makes an id or touches a screen. A timer is an effect
(`startTimer{token, ms}`, `cancelTimer{token}`) and comes back as an event
(`timerFired{token}`); a token that is not the current one does nothing.

An event is an object with one key, its name: `{"show": {"toast": {...}}}`.
An effect has the same shape: `{"startTimer": {"token": 1, "ms": 4000}}`.
State, events and effects hold only objects, lists, strings, whole numbers,
booleans and null, so they have one canonical JSON form (see
`design/README.md`, "Behaviour").

The comments marked `Rule N` quote the rule sentences of the pattern file, so
the code and the human statement of the behaviour can be read side by side.
Only the Python standard library is used.
"""

from __future__ import annotations

import copy
from typing import Callable

Effects = list
Step = Callable[[dict, dict, dict], "tuple[dict, Effects]"]


class BehaviourError(ValueError):
    """An event the pattern does not declare, or one that is not an event at all."""


def _event(pattern: str, event: object, handled: tuple[str, ...]) -> tuple[str, dict]:
    """Split `{"name": {fields}}` into its name and fields; reject unknown names."""
    if not isinstance(event, dict) or len(event) != 1:
        raise BehaviourError(f"{pattern}: an event is an object with one key, got {event!r}")
    ((name, fields),) = event.items()
    if name not in handled:
        known = ", ".join(handled)
        raise BehaviourError(f"{pattern}: unknown event {name!r} (expected one of {known})")
    if not isinstance(fields, dict):
        raise BehaviourError(f"{pattern}: event {name!r} needs an object of fields, got {fields!r}")
    return name, fields


def _effect(name: str, **fields: object) -> dict:
    return {name: fields}


# ---------------------------------------------------------------------------
# toastQueue
# ---------------------------------------------------------------------------

TOAST_EVENTS = ("show", "dismiss", "timerFired", "pause", "resume")


def initial_toast_queue(params: dict) -> dict:
    return {"showing": None, "queue": [], "waits": [], "paused": False, "token": 0, "timer": None}


def _toast_ms(toast: dict, params: dict) -> int | None:
    """How long `toast` stays, or None when it has no timer and stays until dismissed."""
    if toast["tone"] == "danger":
        # Rule 7: a danger toast with an action has no timer; one without an
        # action dismisses itself after durationWithActionMs.
        return None if toast["action"] is not None else params["durationWithActionMs"]
    # Rule 6: a neutral or positive toast stays for durationMs; a toast with an
    # action stays for durationWithActionMs.
    return params["durationWithActionMs"] if toast["action"] is not None else params["durationMs"]


def _politeness(toast: dict) -> str:
    # Rule 7: a danger toast is announced assertively, every other toast politely.
    return "assertive" if toast["tone"] == "danger" else "polite"


def _cancel_showing_timer(state: dict, effects: Effects) -> None:
    """Cancel the showing toast's timer, if one runs."""
    if state["timer"] is not None:
        effects.append(_effect("cancelTimer", token=state["timer"]))
        state["timer"] = None


def _unqueue(state: dict, index: int, effects: Effects) -> dict:
    """Take the waiting toast at `index` out of the queue and cancel its wait (rule 17)."""
    wait = state["waits"].pop(index)
    if wait is not None:
        effects.append(_effect("cancelTimer", token=wait))
    return state["queue"].pop(index)


def _present(state: dict, toast: dict, params: dict, effects: Effects, announce: bool = True) -> None:
    """Put `toast` on screen with a fresh token, its timer (unless paused) and its announcement."""
    state["showing"] = toast
    state["token"] += 1
    ms = _toast_ms(toast, params)
    # Rule 13: a toast that takes the place of a dismissed one while paused
    # shows without a timer until resume.
    if not state["paused"] and ms is not None:
        state["timer"] = state["token"]
        effects.append(_effect("startTimer", token=state["token"], ms=ms))
    if announce:
        # Rule 14: every announcement carries the toast's action label, or null.
        effects.append(
            _effect(
                "announce",
                message=toast["message"],
                politeness=_politeness(toast),
                action=toast["action"],
            )
        )


def _leave(state: dict, params: dict, effects: Effects) -> None:
    """The showing toast has gone: show the next queued one, or nothing."""
    if state["queue"]:
        # Rule 17: a waiting toast that shows before its wait ends is never dropped.
        _present(state, _unqueue(state, 0, effects), params, effects)
    else:
        state["showing"] = None
        # Rule 13: when the last toast leaves, the pause ends.
        state["paused"] = False


def step_toast_queue(state: dict, event: dict, params: dict) -> tuple[dict, Effects]:
    name, fields = _event("toastQueue", event, TOAST_EVENTS)
    state = copy.deepcopy(state)
    effects: Effects = []
    showing = state["showing"]

    if name == "show":
        toast = copy.deepcopy(fields["toast"])
        if showing is None:
            # Rule 1: one toast shows at a time; shown while nothing is showing,
            # it appears at once, takes the next token, starts its timer and is announced.
            _present(state, toast, params, effects)
        elif showing["id"] == toast["id"]:
            # Rule 3: the same id as the showing toast replaces it in place: the
            # old timer (if any) is cancelled and a new one starts with a new
            # token; it is announced only when the message or the action changed.
            _cancel_showing_timer(state, effects)
            changed = (showing["message"], showing["action"]) != (toast["message"], toast["action"])
            _present(state, toast, params, effects, announce=changed)
        else:
            queued = [item["id"] for item in state["queue"]]
            if toast["id"] in queued:
                # Rule 4: the same id as a queued toast replaces it in its place, with
                # no effects; it keeps its wait (rule 17).
                state["queue"][queued.index(toast["id"])] = toast
            else:
                # Rule 2: it waits at the end of the queue; nothing is announced until it shows.
                waiting = state["queue"]
                if len(waiting) >= params["maxQueued"]:
                    # Rule 5: when the queue is full, drop the oldest waiting toast
                    # with no action that is not danger; failing that, the oldest
                    # waiting non-danger toast. Never the incoming toast or a
                    # danger toast: with only danger waiting, the queue grows.
                    plain = [i for i, item in enumerate(waiting)
                             if item["tone"] != "danger" and item["action"] is None]
                    other = [i for i, item in enumerate(waiting) if item["tone"] != "danger"]
                    drop = (plain or other or [None])[0]
                    if drop is not None:
                        _unqueue(state, drop, effects)
                waiting.append(toast)
                # Rule 17: every waiting toast's wait is timed from when it joined the queue.
                state["token"] += 1
                state["waits"].append(state["token"])
                effects.append(_effect("startTimer", token=state["token"], ms=params["maxWaitMs"]))

    elif name == "dismiss":
        if showing is not None and showing["id"] == fields["id"]:
            # Rule 8: dismissing the showing toast cancels its timer (when it has
            # one) and shows the next queued toast, or nothing.
            _cancel_showing_timer(state, effects)
            # Rule 16: focus that was inside the toast area goes back where it was.
            if fields["focusInside"]:
                effects.append(_effect("returnFocus"))
            _leave(state, params, effects)
        else:
            # Rule 9: dismissing a queued toast removes it and cancels its wait;
            # an unknown id does nothing.
            queued = [item["id"] for item in state["queue"]]
            if fields["id"] in queued:
                _unqueue(state, queued.index(fields["id"]), effects)

    elif name == "timerFired":
        token = fields["token"]
        if state["timer"] is not None and token == state["timer"]:
            # Rule 10: the showing toast's timer makes it leave as if dismissed,
            # without a cancelTimer.
            state["timer"] = None
            _leave(state, params, effects)
        elif token in state["waits"]:
            # Rule 17: a waiting toast whose wait ends is dropped with no other
            # effect, unless it is danger then; a danger toast keeps waiting.
            at = state["waits"].index(token)
            if state["queue"][at]["tone"] != "danger":
                del state["queue"][at]
                del state["waits"][at]
            else:
                state["waits"][at] = None
        # Rule 10: a timer with any other token does nothing.

    elif name == "pause":
        # Rule 11: pause cancels the showing toast's timer (when there is one);
        # while already paused, or while nothing is showing, it does nothing.
        # Rule 15: the host sends one pause for all its reasons to pause.
        # Rule 17: the waits of the waiting toasts go on.
        if showing is not None and not state["paused"]:
            _cancel_showing_timer(state, effects)
            state["paused"] = True

    elif name == "resume":
        # Rule 12: resume starts the timer again (when the toast has one) with the
        # full duration and a new token; while not paused it does nothing.
        if state["paused"]:
            state["paused"] = False
            state["token"] += 1
            ms = _toast_ms(showing, params)
            if ms is not None:
                state["timer"] = state["token"]
                effects.append(_effect("startTimer", token=state["token"], ms=ms))

    return state, effects


# ---------------------------------------------------------------------------
# overlayStack
# ---------------------------------------------------------------------------

OVERLAY_EVENTS = ("open", "closed", "escape", "pressOutside", "tab")
MODAL_KINDS = ("dialog", "sheet")


def initial_overlay_stack(params: dict) -> dict:
    return {"layers": []}


def _ancestors(layers: list[dict], layer_id: object) -> list[object]:
    """`layer_id` and the ids of the layers that own it, innermost first."""
    by_id = {layer["id"]: layer for layer in layers}
    chain = []
    current = layer_id
    while current is not None and current not in chain:
        chain.append(current)
        current = by_id[current]["parent"] if current in by_id else None
    return chain


def _descendants(layers: list[dict], layer_id: str) -> list[dict]:
    """The layers owned by `layer_id`, directly or not, topmost (innermost) first."""
    return [
        layer
        for layer in reversed(layers)
        if layer["id"] != layer_id and layer_id in _ancestors(layers, layer["id"])
    ]


def step_overlay_stack(state: dict, event: dict, params: dict) -> tuple[dict, Effects]:
    name, fields = _event("overlayStack", event, OVERLAY_EVENTS)
    state = copy.deepcopy(state)
    effects: Effects = []
    layers = state["layers"]
    others = [layer for layer in layers if layer["kind"] != "tooltip"]
    tooltips = [layer for layer in reversed(layers) if layer["kind"] == "tooltip"]

    if name == "open":
        layer = copy.deepcopy(fields["layer"])
        ids = {item["id"] for item in layers}
        # Rule 2: opening a layer whose id is already in the stack does nothing.
        if layer["id"] not in ids:
            # Rule 19: a parent or openerLayer that is not in the stack is stored as null.
            for key in ("parent", "openerLayer"):
                if layer[key] not in ids:
                    layer[key] = None
            # Rule 1: layers stack in the order they open, and a tooltip always
            # sits on top: anything else goes just below the tooltips.
            at = len(layers)
            if layer["kind"] != "tooltip":
                while at > 0 and layers[at - 1]["kind"] == "tooltip":
                    at -= 1
            layers.insert(at, layer)

    elif name == "escape":
        if fields["composing"] or fields["focusOwnsEscape"]:
            # Rule 18: Escape during composition never reaches the stack, and a
            # focused control that owns Escape gets it first.
            pass
        elif tooltips:
            # Rule 4: a tooltip takes the Escape: every tooltip is asked to close,
            # topmost first, and the key goes no further.
            for layer in tooltips:
                effects.append(_effect("requestClose", id=layer["id"], reason="escape"))
        elif others:
            # Rule 3: Escape asks the topmost layer to close, one layer per Escape.
            effects.append(_effect("requestClose", id=others[-1]["id"], reason="escape"))
        else:
            # Rule 5: with nothing open, the screen gets the key.
            effects.append(_effect("passToScreen", key="Escape"))

    elif name == "pressOutside":
        # Rule 6: a press is inside a layer when it lands in it or in any layer it owns.
        inside = _ancestors(layers, fields["insideId"])
        for layer in reversed(layers):
            if layer["id"] in inside:
                break
            kind = layer["kind"]
            if kind == "tooltip":
                # Rule 10: presses never close a tooltip.
                continue
            if kind == "popover":
                # Rule 7: a press outside a popover asks it to close and carries on below.
                effects.append(_effect("requestClose", id=layer["id"], reason="pressOutside"))
                continue
            if kind == "menu":
                # Rule 8: a press outside a menu asks it to close and goes no further.
                effects.append(_effect("requestClose", id=layer["id"], reason="pressOutside"))
                break
            # Rule 9: a press outside a dialog or sheet is a press on its scrim.
            effects.append(_effect("requestClose", id=layer["id"], reason="scrim"))
            break

    elif name == "tab":
        # Rule 11: Tab closes a menu that is topmost under the tooltips; otherwise nothing.
        if others and others[-1]["kind"] == "menu":
            effects.append(_effect("requestClose", id=others[-1]["id"], reason="tab"))

    elif name == "closed":
        # Rule 12: a layer leaves the stack only when its owner reports closed.
        at = next((i for i, layer in enumerate(layers) if layer["id"] == fields["id"]), None)
        if at is not None:
            target = layers[at]
            # Rule 13: the layers it owns are told to close (a command), innermost
            # first, and leave with it.
            children = _descendants(layers, target["id"])
            for child in children:
                effects.append(_effect("requestClose", id=child["id"], reason="parentClosed"))
            gone = {target["id"]: target} | {child["id"]: child for child in children}
            above = layers[at + 1 :]
            state["layers"] = [layer for layer in layers if layer["id"] not in gone]
            # Rule 17: a layer whose opener was inside a closed layer takes over that
            # layer's opener and openerLayer.
            for layer in state["layers"]:
                while layer["openerLayer"] in gone:
                    source = gone[layer["openerLayer"]]
                    layer["opener"], layer["openerLayer"] = source["opener"], source["openerLayer"]
            remaining = {layer["id"] for layer in state["layers"]}
            under_modal = any(
                layer["kind"] in MODAL_KINDS and layer["id"] in remaining for layer in above
            )
            if target["kind"] == "tooltip":
                # Rule 15: closing a tooltip moves no focus.
                pass
            elif under_modal:
                # Rule 16: never restore focus beneath a dialog or sheet that is still open.
                pass
            elif fields["focus"] in ("inside", "lost"):
                # Rule 14: focus inside the layer or lost goes to the opener if it is
                # still on the page, else the layer the opener was in, else the screen.
                if fields["openerPresent"] and target["opener"] is not None:
                    to = target["opener"]
                elif target["openerLayer"] in remaining:
                    to = target["openerLayer"]
                else:
                    to = None
                effects.append(_effect("restoreFocus", to=to))
            # Rule 14: focus the user moved outside the layer stays where it is.
        # Rule 15: a closed event for an id not in the stack does nothing.

    return state, effects


# ---------------------------------------------------------------------------
# confirmDestructive
# ---------------------------------------------------------------------------

CONFIRM_EVENTS = ("request", "confirm", "cancel", "succeeded", "failed")


def initial_confirm_destructive(params: dict) -> dict:
    return {"phase": "idle", "error": None, "attempt": 0}


def step_confirm_destructive(state: dict, event: dict, params: dict) -> tuple[dict, Effects]:
    name, fields = _event("confirmDestructive", event, CONFIRM_EVENTS)
    state = copy.deepcopy(state)
    effects: Effects = []
    phase = state["phase"]

    if name == "request":
        # Rule 1: request opens the closed dialog; while it is open it does nothing.
        if phase == "idle":
            state["phase"] = "confirming"

    elif name == "confirm":
        # Rule 2: confirm while confirming starts the action.
        # Rule 8: confirm while failed retries, with the error cleared.
        # Rule 3: while working, a second confirm does nothing.
        if phase in ("confirming", "failed"):
            state["phase"] = "working"
            state["error"] = None
            state["attempt"] += 1
            effects.append(_effect("run", attempt=state["attempt"]))

    elif name == "cancel":
        # Rule 5: cancel (the button, Escape or the scrim) while confirming or
        # failed closes the dialog and clears the error.
        # Rule 4: while working, nothing closes the dialog.
        if phase in ("confirming", "failed"):
            state["phase"] = "idle"
            state["error"] = None

    elif name in ("succeeded", "failed"):
        # Rule 9: a result for another attempt, or when nothing is working, does nothing.
        if phase == "working" and fields["attempt"] == state["attempt"]:
            if name == "succeeded":
                # Rule 6: success closes the dialog and emits done.
                state["phase"] = "idle"
                effects.append(_effect("done"))
            else:
                # Rule 7: failure keeps the dialog open, showing the error.
                state["phase"] = "failed"
                state["error"] = fields["message"]

    return state, effects


# ---------------------------------------------------------------------------
# listFocus
# ---------------------------------------------------------------------------

LIST_EVENTS = (
    "setRows",
    "focusIn",
    "up",
    "down",
    "home",
    "end",
    "type",
    "timerFired",
    "activate",
    "press",
)


def initial_list_focus(params: dict) -> dict:
    return {"rows": [], "focused": None, "selected": None, "typeahead": "", "token": 0}


def _enabled(rows: list[dict]) -> list[str]:
    # Rule 1: only enabled rows take focus.
    return [row["id"] for row in rows if not row["disabled"]]


def _focus(state: dict, target: str, params: dict, effects: Effects) -> None:
    """Move focus by key or typeahead."""
    if target == state["focused"]:
        return
    state["focused"] = target
    # Rule 12: with selectionFollowsFocus on, every focus move also selects.
    # Rule 11: with it off, moving focus never selects.
    if params["selectionFollowsFocus"] and state["selected"] != target:
        state["selected"] = target
        effects.append(_effect("select", id=target))


def fold(text: str) -> str:
    """Rule 16: map each character on its own with the Unicode default lower-case
    mapping, which is locale independent: Python `str.lower()` applied to one
    character at a time (so the final-sigma rule never applies). JavaScript's
    `toLowerCase()` on each code point and Rust's `char::to_lowercase` give the
    same mapping. The result is compared by Unicode scalar values (code points)."""
    return "".join(ch.lower() for ch in text)


def _typeahead_match(state: dict, buffer: str) -> str | None:
    rows = state["rows"]
    ids = [row["id"] for row in rows]
    start = ids.index(state["focused"]) if state["focused"] in ids else 0
    if len(set(buffer)) == 1 and state["focused"] in ids:
        # Rule 8: one letter repeated steps through the rows that start with it,
        # from the row after the focused one.
        prefix, start = buffer[0], start + 1
    else:
        # Rule 7: the first enabled row from the focused one onwards, wrapping round.
        prefix = buffer
    for offset in range(len(rows)):
        row = rows[(start + offset) % len(rows)]
        if not row["disabled"] and fold(row["label"]).startswith(prefix):
            return row["id"]
    return None


def step_list_focus(state: dict, event: dict, params: dict) -> tuple[dict, Effects]:
    name, fields = _event("listFocus", event, LIST_EVENTS)
    if name == "type" and (not isinstance(fields.get("char"), str) or len(fields["char"]) != 1):
        # `type.char` is exactly one Unicode scalar value; anything else is a host bug.
        raise BehaviourError(f"listFocus: type.char must be one character, got {fields.get('char')!r}")
    state = copy.deepcopy(state)
    effects: Effects = []

    if name == "setRows":
        old_ids = [row["id"] for row in state["rows"]]
        state["rows"] = copy.deepcopy(fields["rows"])
        enabled = _enabled(state["rows"])
        present = {row["id"] for row in state["rows"]}
        focused = state["focused"]
        if focused is not None and focused not in enabled:
            # Rule 14: the focused row is gone or disabled: focus moves to the
            # nearest enabled survivor after it in the old order, else before it,
            # else the first enabled row, else nothing. The selection moves with
            # it only when selectionFollowsFocus is on.
            at = old_ids.index(focused)
            after = old_ids[at + 1 :]
            before = list(reversed(old_ids[:at]))
            survivors = [row_id for row_id in after + before if row_id in enabled]
            state["focused"] = survivors[0] if survivors else (enabled[0] if enabled else None)
            if params["selectionFollowsFocus"] and state["focused"] is not None:
                state["selected"] = state["focused"]
                effects.append(_effect("select", id=state["focused"]))
        if state["selected"] is not None and state["selected"] not in present:
            # Rule 15: a selected row that is gone clears the selection: deselect.
            state["selected"] = None
            effects.append(_effect("deselect"))
        return state, effects

    enabled = _enabled(state["rows"])
    # Rule 2: with no enabled rows, every key does nothing.
    if not enabled and name != "timerFired":
        return state, effects
    focused = state["focused"]

    if name in ("down", "up"):
        # Rule 3: Down moves to the next enabled row, Up to the previous one; with
        # nothing focused, Down takes the first and Up the last.
        order = enabled if name == "down" else list(reversed(enabled))
        if focused is None:
            _focus(state, order[0], params, effects)
        else:
            at = order.index(focused)
            if at + 1 < len(order):
                _focus(state, order[at + 1], params, effects)
            elif params["wrap"]:
                # Rule 4: at the ends they stay put unless wrap is on.
                _focus(state, order[0], params, effects)

    elif name == "home":
        # Rule 5: Home focuses the first enabled row.
        _focus(state, enabled[0], params, effects)

    elif name == "end":
        # Rule 5: End focuses the last enabled row.
        _focus(state, enabled[-1], params, effects)

    elif name == "focusIn":
        # Rule 6: focus entering the list goes to the selected row if enabled,
        # else the first enabled row, and never changes the selection.
        if focused is None:
            selected = state["selected"]
            state["focused"] = selected if selected in enabled else enabled[0]

    elif name == "type":
        # Rule 7: the character joins the buffer, folded (rule 16), and the timer
        # restarts with a new token.
        if state["typeahead"]:
            effects.append(_effect("cancelTimer", token=state["token"]))
        state["typeahead"] += fold(fields["char"])
        state["token"] += 1
        effects.append(_effect("startTimer", token=state["token"], ms=params["typeaheadMs"]))
        match = _typeahead_match(state, state["typeahead"])
        # Rule 9: no match leaves focus where it is; the buffer still grows.
        if match is not None:
            _focus(state, match, params, effects)

    elif name == "timerFired":
        # Rule 10: the current token empties the buffer; any other does nothing.
        if fields["token"] == state["token"] and state["typeahead"]:
            state["typeahead"] = ""

    elif name == "activate":
        # Rule 11: Enter or Space selects the focused row and emits select, even
        # when it was already selected; with nothing focused it does nothing.
        if focused is not None:
            state["selected"] = focused
            effects.append(_effect("select", id=focused))

    elif name == "press":
        # Rule 13: a press on an enabled row focuses and selects it; on a disabled
        # or unknown row it does nothing.
        if fields["id"] in enabled:
            state["focused"] = fields["id"]
            state["selected"] = fields["id"]
            effects.append(_effect("select", id=fields["id"]))

    return state, effects


# ---------------------------------------------------------------------------
# loadState
# ---------------------------------------------------------------------------

LOAD_EVENTS = ("start", "refresh", "retry", "succeeded", "failed")


def initial_load_state(params: dict) -> dict:
    # Rule 1: a screen starts as loading, before any fetch.
    return {"status": "loading", "error": None, "token": 0, "fetching": False, "refreshByUser": False}


def _fetch(state: dict, status: str, effects: Effects, by_user: bool = False) -> None:
    state["status"] = status
    state["error"] = None
    state["token"] += 1
    state["fetching"] = True
    # Rule 12: refreshByUser is true only while a refresh the user started is in flight.
    state["refreshByUser"] = by_user
    effects.append(_effect("fetch", token=state["token"]))


def step_load_state(state: dict, event: dict, params: dict) -> tuple[dict, Effects]:
    name, fields = _event("loadState", event, LOAD_EVENTS)
    state = copy.deepcopy(state)
    effects: Effects = []
    status = state["status"]

    if name == "start":
        # Rule 2: start, from any state, discards what is shown and fetches.
        _fetch(state, "loading", effects)

    elif name == "refresh":
        by_user = fields["byUser"]
        if state["fetching"]:
            # Rule 6: refresh while a fetch is in flight starts no new fetch; one the
            # user started marks the fetch in flight as theirs, unless it is loading.
            if by_user and status != "loading":
                state["refreshByUser"] = True
        elif status == "ready":
            # Rule 3: refresh while ready keeps the content on screen: refreshing.
            _fetch(state, "refreshing", effects, by_user)
        elif status == "empty":
            # Rule 4: refresh while empty keeps the empty screen.
            _fetch(state, "empty", effects, by_user)
        elif status == "error":
            # Rule 5: refresh while error is a retry.
            _fetch(state, "loading", effects)

    elif name == "retry":
        # Rule 7: retry while error loads again; in any other state it does nothing.
        if status == "error" and not state["fetching"]:
            _fetch(state, "loading", effects)

    elif name in ("succeeded", "failed"):
        # Rule 11: a stale token, or a result when nothing is in flight, does nothing.
        if state["fetching"] and fields["token"] == state["token"]:
            state["fetching"] = False
            # Rule 12: any result clears refreshByUser.
            state["refreshByUser"] = False
            if name == "succeeded":
                # Rule 8: success shows the empty screen or the content.
                state["status"] = "empty" if fields["empty"] else "ready"
            elif status == "loading":
                # Rule 9: failure with nothing to show replaces the skeleton with the error.
                state["status"] = "error"
                state["error"] = fields["message"]
            else:
                # Rule 10: failure during a refresh keeps what is shown and notifies,
                # with the screen's stable notifyId so repeated failures replace one toast.
                state["status"] = "ready" if status == "refreshing" else status
                effects.append(_effect("notify", id=params["notifyId"], message=fields["message"]))

    return state, effects


# ---------------------------------------------------------------------------
# Registry and scenarios
# ---------------------------------------------------------------------------

# Pattern name -> (initial, step, the event names it handles).
PATTERNS: dict[str, tuple[Callable[[dict], dict], Step, tuple[str, ...]]] = {
    "toastQueue": (initial_toast_queue, step_toast_queue, TOAST_EVENTS),
    "overlayStack": (initial_overlay_stack, step_overlay_stack, OVERLAY_EVENTS),
    "confirmDestructive": (initial_confirm_destructive, step_confirm_destructive, CONFIRM_EVENTS),
    "listFocus": (initial_list_focus, step_list_focus, LIST_EVENTS),
    "loadState": (initial_load_state, step_load_state, LOAD_EVENTS),
}


def initial_state(pattern: str, params: dict, overrides: dict | None = None) -> dict:
    """The pattern's initial state for `params`, with `overrides` merged over its fields."""
    initial, _, _ = PATTERNS[pattern]
    state = initial(params)
    state.update(copy.deepcopy(overrides or {}))
    return state


def run_scenario(pattern: str, scenario: dict) -> list[dict]:
    """Run a scenario's events from its initial state: one `{event, state, effects}` per event.

    `scenario` holds `events` and the resolved `params` in full, and optionally
    `initial` (fields merged over the pattern's initial state).
    """
    _, step, _ = PATTERNS[pattern]
    params = scenario["params"]
    state = initial_state(pattern, params, scenario.get("initial"))
    records = []
    for event in scenario["events"]:
        state, effects = step(state, event, params)
        records.append(
            {"event": copy.deepcopy(event), "state": copy.deepcopy(state), "effects": effects}
        )
    return records
