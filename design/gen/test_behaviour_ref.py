"""Tests for `design/gen/behaviour_ref.py`, run with the Python standard library only.

`behaviour_ref.py` defines the behaviour patterns: the TypeScript and Rust ports
must reproduce the vectors generated from it, so these tests pin the reference
with hand-written expectations. Each pattern has one test class, and each rule
sentence of its pattern file has at least one test named `test_rNN_...`.

    python3 -m unittest discover -s design/gen -p 'test_*.py' -v
"""

from __future__ import annotations

import copy
import json
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import behaviour_ref as ref  # noqa: E402  (after the path fix above)

REPO = pathlib.Path(__file__).resolve().parents[2]
PATTERN_DIR = REPO / "design" / "behaviour"

TOAST = {"durationMs": 4000, "durationWithActionMs": 8000, "maxQueued": 3}
LIST = {"wrap": False, "selectionFollowsFocus": False, "typeaheadMs": 1000}
LOAD = {"notifyId": "load"}


def toast(id: str, tone: str = "neutral", message: str | None = None, action: str | None = None) -> dict:
    return {"id": id, "tone": tone, "message": message or f"msg {id}", "action": action}


def layer(id: str, kind: str, parent: str | None = None, opener: str | None = None,
          opener_layer: str | None = None) -> dict:
    return {"id": id, "kind": kind, "parent": parent, "opener": opener, "openerLayer": opener_layer}


def row(id: str, label: str | None = None, disabled: bool = False) -> dict:
    return {"id": id, "label": label or id, "disabled": disabled}


class Machine:
    """Drive one reducer: `send` returns the effects and keeps the state."""

    def __init__(self, pattern: str, params: dict, **initial: object) -> None:
        self.pattern = pattern
        self.params = params
        self.state = ref.initial_state(pattern, params, initial)

    def send(self, name: str, **fields: object) -> list:
        step = ref.PATTERNS[self.pattern][1]
        self.state, effects = step(self.state, {name: fields}, self.params)
        return effects


def start_timer(token: int, ms: int) -> dict:
    return {"startTimer": {"token": token, "ms": ms}}


def cancel_timer(token: int) -> dict:
    return {"cancelTimer": {"token": token}}


def announce(message: str, politeness: str = "polite", action: str | None = None) -> dict:
    return {"announce": {"message": message, "politeness": politeness, "action": action}}


def request_close(id: str, reason: str) -> dict:
    return {"requestClose": {"id": id, "reason": reason}}


def restore(to: str | None) -> list:
    return [{"restoreFocus": {"to": to}}]


ESC = {"composing": False, "focusOwnsEscape": False}


class ToastQueueTest(unittest.TestCase):
    def setUp(self) -> None:
        self.m = Machine("toastQueue", TOAST)

    def ids(self) -> tuple:
        showing = self.m.state["showing"]
        return (showing and showing["id"], [item["id"] for item in self.m.state["queue"]])

    def dismiss(self, id: str, focus_inside: bool = False) -> list:
        return self.m.send("dismiss", id=id, focusInside=focus_inside)

    def test_r01_first_toast_shows_at_once_with_timer_and_announcement(self):
        effects = self.m.send("show", toast=toast("a", message="Saved"))
        self.assertEqual(self.ids(), ("a", []))
        self.assertEqual(self.m.state["token"], 1)
        self.assertEqual(effects, [start_timer(1, 4000), announce("Saved")])

    def test_r02_later_toasts_wait_in_order_silently(self):
        self.m.send("show", toast=toast("a"))
        self.assertEqual(self.m.send("show", toast=toast("b")), [])
        self.assertEqual(self.m.send("show", toast=toast("c")), [])
        self.assertEqual(self.ids(), ("a", ["b", "c"]))

    def test_r03_same_id_replaces_the_showing_toast(self):
        self.m.send("show", toast=toast("up", message="Uploading"))
        effects = self.m.send("show", toast=toast("up", "positive", "Uploaded"))
        self.assertEqual(effects, [cancel_timer(1), start_timer(2, 4000), announce("Uploaded")])
        self.assertEqual(self.m.state["showing"]["message"], "Uploaded")

    def test_r03_same_message_is_not_announced_again(self):
        self.m.send("show", toast=toast("off", message="Offline"))
        self.assertEqual(self.m.send("show", toast=toast("off", message="Offline")),
                         [cancel_timer(1), start_timer(2, 4000)])
        self.assertEqual(self.m.send("show", toast=toast("off", message="Offline", action="Retry")),
                         [cancel_timer(2), start_timer(3, 8000), announce("Offline", action="Retry")])

    def test_r03_replacing_a_toast_with_no_timer_cancels_nothing(self):
        self.m.send("show", toast=toast("s", "danger", "Couldn't send", "Retry"))
        self.assertEqual(self.m.send("show", toast=toast("s", "danger", "Still failing", "Retry")),
                         [announce("Still failing", "assertive", "Retry")])

    def test_r04_same_id_replaces_a_queued_toast_in_place(self):
        for id in ("a", "b", "c"):
            self.m.send("show", toast=toast(id))
        self.assertEqual(self.m.send("show", toast=toast("b", message="newer")), [])
        self.assertEqual(self.ids(), ("a", ["b", "c"]))
        self.assertEqual(self.m.state["queue"][0]["message"], "newer")

    def test_r05_a_full_queue_drops_the_oldest_plain_toast(self):
        self.m.send("show", toast=toast("a"))
        self.m.send("show", toast=toast("u", action="Undo"))
        self.m.send("show", toast=toast("b", "danger"))
        self.m.send("show", toast=toast("c"))
        self.m.send("show", toast=toast("d", "positive"))
        self.assertEqual(self.ids(), ("a", ["u", "b", "d"]))

    def test_r05_with_no_plain_toast_the_oldest_non_danger_goes(self):
        self.m.send("show", toast=toast("a"))
        for id in ("u", "v"):
            self.m.send("show", toast=toast(id, action="Undo"))
        self.m.send("show", toast=toast("b", "danger"))
        self.m.send("show", toast=toast("w"))
        self.assertEqual(self.ids(), ("a", ["v", "b", "w"]))

    def test_r05_never_the_incoming_or_a_danger_toast(self):
        self.m.send("show", toast=toast("a"))
        for id in ("b", "c", "d"):
            self.m.send("show", toast=toast(id, "danger"))
        self.assertEqual(self.m.send("show", toast=toast("u", action="Undo")), [])
        self.assertEqual(self.ids(), ("a", ["b", "c", "d", "u"]))
        # A danger toast arriving now drops the only waiting non-danger toast.
        self.m.send("show", toast=toast("e", "danger"))
        self.assertEqual(self.ids(), ("a", ["b", "c", "d", "e"]))

    def test_r06_durations_by_action(self):
        self.assertEqual(self.m.send("show", toast=toast("a", "positive"))[0], start_timer(1, 4000))
        self.assertIn(start_timer(2, 8000), self.m.send("show", toast=toast("a", action="Undo")))

    def test_r07_danger_is_assertive_and_uses_the_longer_duration(self):
        effects = self.m.send("show", toast=toast("x", "danger", "Couldn't send"))
        self.assertEqual(effects, [start_timer(1, 8000), announce("Couldn't send", "assertive")])
        self.assertEqual(self.m.send("timerFired", token=1), [])
        self.assertIsNone(self.m.state["showing"])

    def test_r07_positive_is_polite(self):
        effects = self.m.send("show", toast=toast("p", "positive", "Joined"))
        self.assertEqual(effects[1], announce("Joined", "polite"))

    def test_r07_danger_with_an_action_stays_and_holds_the_queue(self):
        effects = self.m.send("show", toast=toast("s", "danger", "Couldn't send", "Retry"))
        self.assertEqual(effects, [announce("Couldn't send", "assertive", "Retry")])
        self.m.send("show", toast=toast("a"))
        self.assertEqual(self.m.send("timerFired", token=1), [])
        self.assertEqual(self.ids(), ("s", ["a"]))
        self.assertEqual(self.dismiss("s"), [start_timer(2, 4000), announce("msg a")])

    def test_r08_dismissing_the_showing_toast_shows_the_next(self):
        self.m.send("show", toast=toast("a"))
        self.m.send("show", toast=toast("b", message="B"))
        self.assertEqual(self.dismiss("a"), [cancel_timer(1), start_timer(2, 4000), announce("B")])
        self.assertEqual(self.dismiss("b"), [cancel_timer(2)])
        self.assertEqual(self.ids(), (None, []))

    def test_r09_dismissing_a_queued_or_unknown_id(self):
        self.m.send("show", toast=toast("a"))
        self.m.send("show", toast=toast("b"))
        self.assertEqual(self.dismiss("b"), [])
        self.assertEqual(self.ids(), ("a", []))
        before = copy.deepcopy(self.m.state)
        self.assertEqual(self.dismiss("zzz", True), [])
        self.assertEqual(self.m.state, before)

    def test_r10_current_timer_dismisses_without_cancel(self):
        self.m.send("show", toast=toast("a"))
        self.m.send("show", toast=toast("b", message="B"))
        self.assertEqual(self.m.send("timerFired", token=1), [start_timer(2, 4000), announce("B")])

    def test_r10_stale_timer_does_nothing(self):
        self.m.send("show", toast=toast("a"))
        self.m.send("show", toast=toast("a", message="again"))
        before = copy.deepcopy(self.m.state)
        self.assertEqual(self.m.send("timerFired", token=1), [])
        self.assertEqual(self.m.state, before)

    def test_r11_pause_cancels_the_timer_once(self):
        self.m.send("show", toast=toast("a"))
        self.assertEqual(self.m.send("pause"), [cancel_timer(1)])
        self.assertTrue(self.m.state["paused"])
        self.assertEqual(self.m.send("pause"), [])
        self.assertEqual(self.m.send("timerFired", token=1), [])
        self.assertEqual(self.ids(), ("a", []))

    def test_r11_pause_with_nothing_showing_or_no_timer(self):
        self.assertEqual(self.m.send("pause"), [])
        self.assertFalse(self.m.state["paused"])
        self.m.send("show", toast=toast("s", "danger", action="Retry"))
        self.assertEqual(self.m.send("pause"), [])
        self.assertTrue(self.m.state["paused"])

    def test_r12_resume_restarts_the_full_duration_with_a_new_token(self):
        self.m.send("show", toast=toast("a", action="Undo"))
        self.m.send("pause")
        self.assertEqual(self.m.send("resume"), [start_timer(2, 8000)])
        self.assertFalse(self.m.state["paused"])
        self.assertEqual(self.m.send("resume"), [])

    def test_r12_resume_starts_no_timer_for_a_toast_without_one(self):
        self.m.send("show", toast=toast("s", "danger", action="Retry"))
        self.m.send("pause")
        self.assertEqual(self.m.send("resume"), [])
        self.assertFalse(self.m.state["paused"])

    def test_r13_the_pause_carries_to_the_next_toast(self):
        self.m.send("show", toast=toast("a"))
        self.m.send("show", toast=toast("b", message="B"))
        self.m.send("pause")
        self.assertEqual(self.dismiss("a"), [announce("B")])
        self.assertTrue(self.m.state["paused"])
        self.assertEqual(self.m.send("resume"), [start_timer(3, 4000)])

    def test_r13_the_pause_ends_with_the_last_toast_and_the_host_pauses_again(self):
        self.m.send("show", toast=toast("a"))
        self.m.send("pause")
        self.assertEqual(self.dismiss("a"), [])
        self.assertFalse(self.m.state["paused"])
        self.assertEqual(self.m.send("show", toast=toast("b", message="B"))[0], start_timer(2, 4000))
        self.assertEqual(self.m.send("pause"), [cancel_timer(2)])

    def test_r13_replacing_while_paused_starts_no_timer(self):
        self.m.send("show", toast=toast("a"))
        self.m.send("pause")
        self.assertEqual(self.m.send("show", toast=toast("a", message="A2")), [announce("A2")])

    def test_r14_announcements_carry_the_action_label(self):
        self.assertEqual(self.m.send("show", toast=toast("d", message="Deleted", action="Undo"))[1],
                         announce("Deleted", action="Undo"))

    def test_r15_one_pause_for_every_reason(self):
        # Pointer, focus, a hidden window and an open modal are one pause to the reducer.
        self.m.send("show", toast=toast("a"))
        self.assertEqual(self.m.send("pause"), [cancel_timer(1)])
        self.assertEqual(self.m.send("pause"), [])
        self.assertEqual(self.m.send("resume"), [start_timer(2, 4000)])

    def test_r16_dismissing_with_focus_inside_returns_focus(self):
        self.m.send("show", toast=toast("d", action="Undo"))
        self.m.send("show", toast=toast("a", message="A"))
        self.assertEqual(self.dismiss("d", True), [cancel_timer(1), {"returnFocus": {}},
                                                  start_timer(2, 4000), announce("A")])
        self.assertEqual(self.dismiss("a", False), [cancel_timer(2)])


class OverlayStackTest(unittest.TestCase):
    def setUp(self) -> None:
        self.m = Machine("overlayStack", {})

    def open(self, *layers: dict) -> None:
        for item in layers:
            self.assertEqual(self.m.send("open", layer=item), [])

    def escape(self, **flags: bool) -> list:
        return self.m.send("escape", **{**ESC, **flags})

    def closed(self, id: str, present: bool = True, focus: str = "inside") -> list:
        return self.m.send("closed", id=id, openerPresent=present, focus=focus)

    def ids(self) -> list:
        return [item["id"] for item in self.m.state["layers"]]

    def test_r01_layers_stack_in_order_with_tooltips_on_top(self):
        self.open(layer("d", "dialog"), layer("tip", "tooltip", "d"), layer("p", "popover", "d"))
        self.assertEqual(self.ids(), ["d", "p", "tip"])
        self.open(layer("tip2", "tooltip", "p"))
        self.assertEqual(self.ids(), ["d", "p", "tip", "tip2"])

    def test_r02_opening_an_open_id_does_nothing(self):
        self.open(layer("p", "popover", opener="a"))
        self.open(layer("p", "menu", opener="b"))
        self.assertEqual(self.m.state["layers"], [layer("p", "popover", opener="a")])

    def test_r03_escape_asks_only_the_topmost(self):
        self.open(layer("d", "dialog"), layer("m", "menu", "d"))
        self.assertEqual(self.escape(), [request_close("m", "escape")])

    def test_r04_a_tooltip_takes_the_escape(self):
        self.open(layer("d", "dialog"), layer("t1", "tooltip"), layer("t2", "tooltip"))
        self.assertEqual(self.escape(), [request_close("t2", "escape"), request_close("t1", "escape")])

    def test_r04_a_lone_tooltip_keeps_escape_from_the_screen(self):
        self.open(layer("t", "tooltip"))
        self.assertEqual(self.escape(), [request_close("t", "escape")])

    def test_r05_escape_with_nothing_open_goes_to_the_screen(self):
        self.assertEqual(self.escape(), [{"passToScreen": {"key": "Escape"}}])

    def test_r06_a_press_in_a_grandchild_is_inside_every_ancestor(self):
        self.open(layer("p", "popover"), layer("d", "dialog", "p"), layer("m", "menu", "d"))
        self.assertEqual(self.m.send("pressOutside", insideId="m"), [])

    def test_r07_a_press_outside_popovers_carries_on(self):
        self.open(layer("a", "popover"), layer("b", "popover"))
        self.assertEqual(self.m.send("pressOutside", insideId=None),
                         [request_close("b", "pressOutside"), request_close("a", "pressOutside")])
        self.assertEqual(self.m.send("pressOutside", insideId="a"), [request_close("b", "pressOutside")])

    def test_r08_a_menu_swallows_the_press(self):
        self.open(layer("p", "popover"), layer("m", "menu", "p"))
        self.assertEqual(self.m.send("pressOutside", insideId=None), [request_close("m", "pressOutside")])

    def test_r09_a_press_outside_a_modal_is_on_its_scrim(self):
        for kind in ("dialog", "sheet"):
            with self.subTest(kind=kind):
                m = Machine("overlayStack", {})
                m.send("open", layer=layer("p", "popover"))
                m.send("open", layer=layer("x", kind))
                self.assertEqual(m.send("pressOutside", insideId="p"), [request_close("x", "scrim")])

    def test_r10_a_press_never_closes_a_tooltip(self):
        self.open(layer("t", "tooltip"))
        self.assertEqual(self.m.send("pressOutside", insideId=None), [])

    def test_r11_tab_closes_a_menu_under_tooltips_only(self):
        self.open(layer("d", "dialog"))
        self.assertEqual(self.m.send("tab"), [])
        self.open(layer("p", "popover", "d"))
        self.assertEqual(self.m.send("tab"), [])
        self.open(layer("m", "menu", "p"), layer("t", "tooltip", "m"))
        self.assertEqual(self.m.send("tab"), [request_close("m", "tab")])

    def test_r12_request_close_changes_nothing_until_closed(self):
        self.open(layer("d", "dialog"))
        before = copy.deepcopy(self.m.state)
        self.escape()
        self.m.send("pressOutside", insideId=None)
        self.assertEqual(self.m.state, before)
        self.closed("d", present=False)
        self.assertEqual(self.ids(), [])

    def test_r13_closing_a_parent_commands_children_innermost_first(self):
        self.open(layer("d", "dialog", opener="b"), layer("p", "popover", "d"),
                  layer("m", "menu", "p"), layer("t", "tooltip", "m"), layer("other", "popover"))
        self.assertEqual(
            self.closed("d"),
            [request_close("t", "parentClosed"), request_close("m", "parentClosed"),
             request_close("p", "parentClosed"), {"restoreFocus": {"to": "b"}}],
        )
        self.assertEqual(self.ids(), ["other"])
        self.assertEqual(self.closed("m"), [])  # it already left: a later closed does nothing

    def test_r14_focus_goes_to_the_opener(self):
        self.open(layer("d", "dialog"), layer("m", "menu", "d", opener="more", opener_layer="d"))
        self.assertEqual(self.closed("m"), restore("more"))

    def test_r14_focus_falls_back_to_the_opener_layer_then_the_screen(self):
        self.open(layer("d", "dialog", opener="row"), layer("m", "menu", "d", opener="more", opener_layer="d"))
        self.assertEqual(self.closed("m", present=False), restore("d"))
        self.assertEqual(self.closed("d", present=False), restore(None))

    def test_r14_lost_focus_is_restored_and_moved_focus_is_not(self):
        self.open(layer("p", "popover", opener="emoji"))
        self.assertEqual(self.closed("p", focus="lost"), restore("emoji"))
        self.open(layer("q", "popover", opener="gif"))
        self.assertEqual(self.closed("q", focus="outside"), [])

    def test_r15_closing_a_tooltip_moves_no_focus(self):
        self.open(layer("t", "tooltip", opener="x"))
        self.assertEqual(self.closed("t"), [])
        self.assertEqual(self.ids(), [])

    def test_r15_closed_for_an_unknown_id_does_nothing(self):
        self.open(layer("d", "dialog"))
        before = copy.deepcopy(self.m.state)
        self.assertEqual(self.closed("zzz"), [])
        self.assertEqual(self.m.state, before)

    def test_r16_no_focus_restore_beneath_an_open_modal(self):
        for kind in ("dialog", "sheet"):
            with self.subTest(kind=kind):
                m = Machine("overlayStack", {})
                m.send("open", layer=layer("p", "popover", opener="status"))
                m.send("open", layer=layer("x", kind, opener="more"))
                self.assertEqual(m.send("closed", id="p", openerPresent=True, focus="lost"), [])

    def test_r17_a_dialog_from_a_menu_item_returns_to_the_menu_opener(self):
        self.open(layer("m", "menu", opener="more"), layer("d", "dialog", opener="deleteItem", opener_layer="m"))
        self.assertEqual(self.closed("m", present=False, focus="outside"), [])
        self.assertEqual(self.m.state["layers"], [layer("d", "dialog", opener="more")])
        self.assertEqual(self.closed("d"), restore("more"))

    def test_r17_inheritance_follows_a_chain_of_closed_layers(self):
        self.open(layer("p", "popover", opener="b", opener_layer=None),
                  layer("m", "menu", "p", opener="pItem", opener_layer="p"),
                  layer("d", "dialog", opener="mItem", opener_layer="m"))
        self.closed("p", focus="outside")  # p and its child m leave together
        self.assertEqual(self.m.state["layers"], [layer("d", "dialog", opener="b")])

    def test_r18_composition_and_focused_controls_keep_escape(self):
        self.open(layer("d", "dialog"))
        self.assertEqual(self.escape(composing=True), [])
        self.assertEqual(self.escape(focusOwnsEscape=True), [])
        self.m = Machine("overlayStack", {})
        self.assertEqual(self.escape(composing=True), [])

    def test_r19_an_unknown_parent_or_opener_layer_becomes_null(self):
        self.open(layer("p", "popover", "gone", opener="b", opener_layer="gone"))
        self.assertEqual(self.m.state["layers"], [layer("p", "popover", opener="b")])


class ConfirmDestructiveTest(unittest.TestCase):
    def setUp(self) -> None:
        self.m = Machine("confirmDestructive", {})

    def working(self) -> None:
        self.m.send("request")
        self.m.send("confirm")

    def test_r01_request_opens_the_closed_dialog_only(self):
        self.assertEqual(self.m.state["phase"], "idle")
        self.assertEqual(self.m.send("request"), [])
        self.assertEqual(self.m.state["phase"], "confirming")
        self.m.send("confirm")
        self.assertEqual(self.m.send("request"), [])
        self.assertEqual(self.m.state["phase"], "working")

    def test_r02_confirm_runs_the_action(self):
        self.m.send("request")
        self.assertEqual(self.m.send("confirm"), [{"run": {"attempt": 1}}])
        self.assertEqual(self.m.state, {"phase": "working", "error": None, "attempt": 1})

    def test_r03_double_confirm_while_working_does_nothing(self):
        self.working()
        before = copy.deepcopy(self.m.state)
        self.assertEqual(self.m.send("confirm"), [])
        self.assertEqual(self.m.state, before)

    def test_r04_nothing_closes_the_dialog_while_working(self):
        self.working()
        for reason in ("button", "escape", "scrim"):
            self.assertEqual(self.m.send("cancel", reason=reason), [])
            self.assertEqual(self.m.state["phase"], "working")

    def test_r05_cancel_closes_from_confirming_and_failed(self):
        for reason in ("button", "escape", "scrim"):
            with self.subTest(reason=reason):
                m = Machine("confirmDestructive", {})
                m.send("request")
                self.assertEqual(m.send("cancel", reason=reason), [])
                self.assertEqual(m.state["phase"], "idle")
        self.working()
        self.m.send("failed", attempt=1, message="nope")
        self.m.send("cancel", reason="escape")
        self.assertEqual(self.m.state, {"phase": "idle", "error": None, "attempt": 1})

    def test_r06_success_closes_and_emits_done(self):
        self.working()
        self.assertEqual(self.m.send("succeeded", attempt=1), [{"done": {}}])
        self.assertEqual(self.m.state["phase"], "idle")

    def test_r07_failure_keeps_the_dialog_open_with_the_error(self):
        self.working()
        self.assertEqual(self.m.send("failed", attempt=1, message="Offline"), [])
        self.assertEqual(self.m.state, {"phase": "failed", "error": "Offline", "attempt": 1})

    def test_r08_confirm_after_failure_retries(self):
        self.working()
        self.m.send("failed", attempt=1, message="Offline")
        self.assertEqual(self.m.send("confirm"), [{"run": {"attempt": 2}}])
        self.assertEqual(self.m.state, {"phase": "working", "error": None, "attempt": 2})

    def test_r09_stale_or_unexpected_results_do_nothing(self):
        self.assertEqual(self.m.send("succeeded", attempt=0), [])
        self.working()
        self.m.send("failed", attempt=1, message="x")
        self.m.send("confirm")
        before = copy.deepcopy(self.m.state)
        self.assertEqual(self.m.send("succeeded", attempt=1), [])
        self.assertEqual(self.m.send("failed", attempt=1, message="x"), [])
        self.assertEqual(self.m.state, before)
        self.m.send("succeeded", attempt=2)
        self.assertEqual(self.m.send("succeeded", attempt=2), [])


class ListFocusTest(unittest.TestCase):
    def machine(self, rows: list, **params: object) -> Machine:
        m = Machine("listFocus", {**LIST, **params})
        m.send("setRows", rows=rows)
        return m

    def test_r01_movement_skips_disabled_rows(self):
        m = self.machine([row("a"), row("b", disabled=True), row("c")])
        m.send("down")
        m.send("down")
        self.assertEqual(m.state["focused"], "c")
        m.send("up")
        self.assertEqual(m.state["focused"], "a")

    def test_r02_no_enabled_rows_every_key_does_nothing(self):
        for rows in ([], [row("a", disabled=True)]):
            m = self.machine(rows)
            before = copy.deepcopy(m.state)
            for name, fields in (("down", {}), ("up", {}), ("home", {}), ("end", {}),
                                 ("focusIn", {}), ("activate", {}), ("type", {"char": "a"}),
                                 ("press", {"id": "a"})):
                self.assertEqual(m.send(name, **fields), [])
            self.assertEqual(m.state, before)

    def test_r03_down_and_up_from_nothing(self):
        m = self.machine([row("a"), row("b"), row("c", disabled=True)])
        m.send("up")
        self.assertEqual(m.state["focused"], "b")
        m = self.machine([row("a", disabled=True), row("b"), row("c")])
        m.send("down")
        self.assertEqual(m.state["focused"], "b")
        m.send("down")
        self.assertEqual(m.state["focused"], "c")

    def test_r04_ends_stay_put_without_wrap(self):
        m = self.machine([row("a"), row("b")])
        m.send("end")
        self.assertEqual(m.send("down"), [])
        self.assertEqual(m.state["focused"], "b")
        m.send("home")
        m.send("up")
        self.assertEqual(m.state["focused"], "a")

    def test_r04_wrap_goes_round(self):
        m = self.machine([row("a"), row("b"), row("c", disabled=True)], wrap=True)
        m.send("end")
        m.send("down")
        self.assertEqual(m.state["focused"], "a")
        m.send("up")
        self.assertEqual(m.state["focused"], "b")

    def test_r05_home_and_end(self):
        m = self.machine([row("a", disabled=True), row("b"), row("c"), row("d", disabled=True)])
        m.send("end")
        self.assertEqual(m.state["focused"], "c")
        m.send("home")
        self.assertEqual(m.state["focused"], "b")

    def test_r06_focus_in_goes_to_the_selected_row(self):
        m = Machine("listFocus", LIST, rows=[row("a"), row("b")], selected="b")
        self.assertEqual(m.send("focusIn"), [])
        self.assertEqual((m.state["focused"], m.state["selected"]), ("b", "b"))

    def test_r06_focus_in_falls_back_to_the_first_enabled_row(self):
        m = Machine("listFocus", {**LIST, "selectionFollowsFocus": True},
                    rows=[row("a", disabled=True), row("b"), row("c", disabled=True)], selected="c")
        self.assertEqual(m.send("focusIn"), [])
        self.assertEqual((m.state["focused"], m.state["selected"]), ("b", "c"))

    def test_r06_focus_in_with_a_row_focused_does_nothing(self):
        m = self.machine([row("a"), row("b")])
        m.send("end")
        m.send("focusIn")
        self.assertEqual(m.state["focused"], "b")

    def test_r07_typeahead_matches_a_prefix_ignoring_case(self):
        m = self.machine([row("g", "General"), row("ga", "Games"), row("r", "Random")])
        self.assertEqual(m.send("type", char="R"), [start_timer(1, 1000)])
        self.assertEqual((m.state["focused"], m.state["typeahead"]), ("r", "r"))
        self.assertEqual(m.send("type", char="A"), [cancel_timer(1), start_timer(2, 1000)])
        self.assertEqual((m.state["focused"], m.state["typeahead"]), ("r", "ra"))

    def test_r07_typeahead_searches_from_the_focused_row_and_goes_round(self):
        m = self.machine([row("a", "Games"), row("b", "General"), row("c", "Random"), row("d", "Garden", True)])
        m.send("end")
        m.send("type", char="g")
        m.send("type", char="e")
        self.assertEqual(m.state["focused"], "b")

    def test_r08_a_repeated_letter_steps_through_the_matches(self):
        m = self.machine([row("a", "Games"), row("b", "Gifs"), row("c", "Garden", True), row("d", "Random")])
        seen = []
        for _ in range(3):
            m.send("type", char="g")
            seen.append(m.state["focused"])
        self.assertEqual(seen, ["a", "b", "a"])
        self.assertEqual(m.state["typeahead"], "ggg")

    def test_r08_a_single_letter_starts_after_the_focused_row(self):
        m = self.machine([row("a", "Games"), row("b", "Gifs")])
        m.send("home")
        m.send("type", char="g")
        self.assertEqual(m.state["focused"], "b")

    def test_r09_no_match_keeps_focus_and_grows_the_buffer(self):
        m = self.machine([row("a", "Alpha"), row("b", "Beta")])
        m.send("type", char="b")
        m.send("type", char="x")
        self.assertEqual((m.state["focused"], m.state["typeahead"]), ("b", "bx"))

    def test_r10_the_current_timer_empties_the_buffer(self):
        m = self.machine([row("a", "Alpha")])
        m.send("type", char="a")
        m.send("type", char="l")
        self.assertEqual(m.send("timerFired", token=1), [])
        self.assertEqual(m.state["typeahead"], "al")
        self.assertEqual(m.send("timerFired", token=2), [])
        self.assertEqual(m.state["typeahead"], "")

    def test_r11_moving_never_selects_and_activate_always_does(self):
        m = self.machine([row("a"), row("b")])
        self.assertEqual(m.send("activate"), [])
        m.send("down")
        m.send("type", char="b")
        self.assertIsNone(m.state["selected"])
        self.assertEqual(m.send("activate"), [{"select": {"id": "b"}}])
        self.assertEqual(m.send("activate"), [{"select": {"id": "b"}}])
        self.assertEqual(m.state["selected"], "b")

    def test_r12_selection_follows_focus_when_on(self):
        m = self.machine([row("a", "Alpha"), row("b", "Beta")], selectionFollowsFocus=True)
        self.assertEqual(m.send("down"), [{"select": {"id": "a"}}])
        self.assertEqual(m.send("end"), [{"select": {"id": "b"}}])
        self.assertEqual(m.send("end"), [])
        self.assertEqual(m.send("type", char="a"), [start_timer(1, 1000), {"select": {"id": "a"}}])

    def test_r13_press_focuses_and_selects_enabled_rows_only(self):
        m = self.machine([row("a"), row("b", disabled=True)])
        self.assertEqual(m.send("press", id="a"), [{"select": {"id": "a"}}])
        self.assertEqual((m.state["focused"], m.state["selected"]), ("a", "a"))
        before = copy.deepcopy(m.state)
        self.assertEqual(m.send("press", id="b"), [])
        self.assertEqual(m.send("press", id="zzz"), [])
        self.assertEqual(m.state, before)

    def test_r14_a_removed_row_moves_focus_next_then_previous(self):
        m = self.machine([row("a"), row("b"), row("c", disabled=True), row("d")])
        m.send("press", id="b")
        self.assertEqual(m.send("setRows", rows=[row("a"), row("c", disabled=True), row("d")]),
                         [{"deselect": {}}])
        self.assertEqual(m.state["focused"], "d")
        m.send("setRows", rows=[row("a"), row("c", disabled=True), row("d", disabled=True)])
        self.assertEqual(m.state["focused"], "a")

    def test_r14_with_no_survivor_focus_goes_to_the_first_enabled_or_nothing(self):
        m = self.machine([row("a")])
        m.send("down")
        m.send("setRows", rows=[row("x", disabled=True), row("y")])
        self.assertEqual(m.state["focused"], "y")
        m.send("setRows", rows=[row("z", disabled=True)])
        self.assertIsNone(m.state["focused"])

    def test_r14_the_selection_follows_the_move_only_when_it_follows_focus(self):
        m = self.machine([row("a"), row("b")], selectionFollowsFocus=True)
        m.send("press", id="a")
        self.assertEqual(m.send("setRows", rows=[row("a", disabled=True), row("b")]), [{"select": {"id": "b"}}])
        self.assertEqual((m.state["focused"], m.state["selected"]), ("b", "b"))
        m = self.machine([row("a"), row("b")])
        m.send("press", id="a")
        self.assertEqual(m.send("setRows", rows=[row("a", disabled=True), row("b")]), [])
        self.assertEqual((m.state["focused"], m.state["selected"]), ("b", "a"))

    def test_r14_a_removed_focused_and_selected_row_with_follow_on(self):
        m = self.machine([row("a"), row("b"), row("c")], selectionFollowsFocus=True)
        m.send("down")
        m.send("down")
        self.assertEqual(m.send("setRows", rows=[row("a"), row("c")]), [{"select": {"id": "c"}}])

    def test_r15_a_removed_selected_row_clears_the_selection(self):
        m = self.machine([row("a"), row("b")])
        m.send("press", id="b")
        self.assertEqual(m.send("setRows", rows=[row("a")]), [{"deselect": {}}])
        self.assertIsNone(m.state["selected"])
        self.assertEqual(m.send("setRows", rows=[]), [])

    def test_r15_with_follow_on_and_no_row_left_the_selection_clears(self):
        m = self.machine([row("a")], selectionFollowsFocus=True)
        m.send("down")
        self.assertEqual(m.send("setRows", rows=[]), [{"deselect": {}}])
        self.assertEqual((m.state["focused"], m.state["selected"]), (None, None))

    def test_r16_folding_is_per_character_lower_case(self):
        self.assertEqual(ref.fold("ÉLAN Ω İ ΟΔΟΣ"), "élan ω i̇ οδοσ")
        self.assertEqual(ref.fold("Straße"), "straße")  # lower-casing, not full case folding
        m = self.machine([row("e", "Élan"), row("u", "über"), row("o", "ΟΔΟΣ")])
        m.send("type", char="Ü")
        self.assertEqual((m.state["focused"], m.state["typeahead"]), ("u", "ü"))
        m.send("timerFired", token=1)
        for ch in "οδοσ":
            m.send("type", char=ch)
        self.assertEqual(m.state["focused"], "o")

    def test_r16_an_emoji_matches_only_itself(self):
        m = self.machine([row("p", "😀 party"), row("g", "😃 games")])
        m.send("type", char="😃")
        self.assertEqual(m.state["focused"], "g")
        m.send("type", char="😃")
        self.assertEqual(m.state["focused"], "g")
        m.send("timerFired", token=2)
        m.send("type", char="😀")
        self.assertEqual(m.state["focused"], "p")

    def test_type_char_must_be_one_character(self):
        m = self.machine([row("a")])
        for bad in ("", "AB", "😀😀"):
            with self.assertRaisesRegex(ref.BehaviourError, r"^listFocus: type\.char must be one character"):
                m.send("type", char=bad)


class LoadStateTest(unittest.TestCase):
    def setUp(self) -> None:
        self.m = Machine("loadState", LOAD)

    def loaded(self, empty: bool = False) -> None:
        self.m.send("start")
        self.m.send("succeeded", token=1, empty=empty)

    def refresh(self, by_user: bool = False) -> list:
        return self.m.send("refresh", byUser=by_user)

    def state(self, status: str, token: int, fetching: bool, error=None, by_user: bool = False) -> dict:
        return {"status": status, "error": error, "token": token, "fetching": fetching, "refreshByUser": by_user}

    def test_r01_starts_as_loading_with_no_fetch(self):
        self.assertEqual(self.m.state, self.state("loading", 0, False))

    def test_r02_start_discards_from_any_state(self):
        self.assertEqual(self.m.send("start"), [{"fetch": {"token": 1}}])
        self.m.send("failed", token=1, message="x")
        self.assertEqual(self.m.send("start"), [{"fetch": {"token": 2}}])
        self.assertEqual(self.m.state, self.state("loading", 2, True))
        self.m.send("succeeded", token=2, empty=False)
        self.refresh(True)
        self.assertEqual(self.m.send("start"), [{"fetch": {"token": 4}}])
        self.assertEqual(self.m.state, self.state("loading", 4, True))

    def test_r03_refresh_while_ready_keeps_the_content(self):
        self.loaded()
        self.assertEqual(self.refresh(), [{"fetch": {"token": 2}}])
        self.assertEqual(self.m.state, self.state("refreshing", 2, True))

    def test_r04_refresh_while_empty_stays_empty(self):
        self.loaded(empty=True)
        self.assertEqual(self.refresh(True), [{"fetch": {"token": 2}}])
        self.assertEqual(self.m.state, self.state("empty", 2, True, by_user=True))

    def test_r05_refresh_while_error_is_a_retry(self):
        self.m.send("start")
        self.m.send("failed", token=1, message="x")
        self.assertEqual(self.refresh(True), [{"fetch": {"token": 2}}])
        self.assertEqual(self.m.state, self.state("loading", 2, True))

    def test_r06_refresh_in_flight_starts_no_fetch(self):
        self.m.send("start")
        self.assertEqual(self.refresh(True), [])
        self.assertEqual(self.m.state, self.state("loading", 1, True))
        self.m.send("succeeded", token=1, empty=False)
        self.refresh()
        self.assertEqual(self.refresh(), [])
        self.assertEqual(self.refresh(True), [])
        self.assertEqual(self.m.state, self.state("refreshing", 2, True, by_user=True))

    def test_r07_retry_only_from_error(self):
        self.m.send("start")
        self.assertEqual(self.m.send("retry"), [])
        self.m.send("failed", token=1, message="x")
        self.assertEqual(self.m.send("retry"), [{"fetch": {"token": 2}}])
        self.assertEqual(self.m.state, self.state("loading", 2, True))
        self.m.send("succeeded", token=2, empty=False)
        self.assertEqual(self.m.send("retry"), [])

    def test_r08_success_shows_empty_or_ready(self):
        self.loaded(empty=True)
        self.assertEqual(self.m.state, self.state("empty", 1, False))
        self.refresh()
        self.m.send("succeeded", token=2, empty=False)
        self.assertEqual(self.m.state["status"], "ready")

    def test_r09_failure_with_nothing_to_show_is_the_error_screen(self):
        self.m.send("start")
        self.assertEqual(self.m.send("failed", token=1, message="Couldn't load"), [])
        self.assertEqual(self.m.state, self.state("error", 1, False, "Couldn't load"))

    def test_r10_failure_during_a_refresh_notifies_and_keeps_what_is_shown(self):
        for empty, status in ((False, "ready"), (True, "empty")):
            with self.subTest(empty=empty):
                self.m = Machine("loadState", {"notifyId": "members"})
                self.loaded(empty=empty)
                self.refresh(True)
                self.assertEqual(self.m.send("failed", token=2, message="Offline"),
                                 [{"notify": {"id": "members", "message": "Offline"}}])
                self.assertEqual(self.m.state, self.state(status, 2, False))

    def test_r10_repeated_failures_reuse_the_notify_id(self):
        self.loaded()
        ids = []
        for token in (2, 3):
            self.refresh()
            ids += [effect["notify"]["id"] for effect in self.m.send("failed", token=token, message="Offline")]
        self.assertEqual(ids, ["load", "load"])

    def test_r11_stale_or_unexpected_results_do_nothing(self):
        self.loaded()
        self.refresh()
        self.m.send("start")
        before = copy.deepcopy(self.m.state)
        self.assertEqual(self.m.send("succeeded", token=2, empty=True), [])
        self.assertEqual(self.m.send("failed", token=2, message="x"), [])
        self.assertEqual(self.m.state, before)
        self.m.send("succeeded", token=3, empty=False)
        before = copy.deepcopy(self.m.state)
        self.assertEqual(self.m.send("failed", token=3, message="late"), [])
        self.assertEqual(self.m.state, before)

    def test_r12_refresh_by_user_lasts_while_its_fetch_is_in_flight(self):
        self.loaded()
        self.refresh(True)
        self.assertTrue(self.m.state["refreshByUser"])
        self.m.send("succeeded", token=2, empty=False)
        self.assertFalse(self.m.state["refreshByUser"])
        self.refresh(False)
        self.assertFalse(self.m.state["refreshByUser"])
        self.refresh(True)
        self.assertTrue(self.m.state["refreshByUser"])
        self.m.send("failed", token=3, message="x")
        self.assertFalse(self.m.state["refreshByUser"])


def pattern_files() -> dict:
    return {
        data["pattern"]: data
        for data in (json.loads(path.read_text(encoding="utf-8")) for path in sorted(PATTERN_DIR.glob("*.json")))
    }


def walk(pattern: str, data: dict):
    """Every (state before, event, params) the pattern file's scenarios reach."""
    defaults = {key: value for key, value in data["params"].items() if not isinstance(value, str)}
    for key, value in data["params"].items():
        if isinstance(value, str):
            # A duration does not change the shape of the run; any other string is literal.
            defaults[key] = 1000 if value.startswith("motion.") else value
    for scenario in data["scenarios"]:
        params = {**defaults, **scenario.get("params", {})}
        state = ref.initial_state(pattern, params, scenario.get("initial"))
        for event in scenario["events"]:
            yield state, event, params
            state, _ = ref.PATTERNS[pattern][1](state, event, params)


class PropertyTest(unittest.TestCase):
    """Checks that hold for every pattern, over every state its scenarios reach."""

    def setUp(self) -> None:
        self.files = pattern_files()

    def test_every_pattern_file_has_a_reducer_and_back(self):
        self.assertEqual(set(self.files), set(ref.PATTERNS))

    def test_every_declared_event_is_handled(self):
        for pattern, data in self.files.items():
            self.assertEqual(set(data["events"]), set(ref.PATTERNS[pattern][2]), pattern)

    def test_unknown_events_raise_a_clear_error(self):
        for pattern in ref.PATTERNS:
            initial, step, _ = ref.PATTERNS[pattern]
            with self.assertRaisesRegex(ref.BehaviourError, rf"^{pattern}: unknown event 'bogus'"):
                step(initial({}), {"bogus": {}}, {})
            with self.assertRaisesRegex(ref.BehaviourError, rf"^{pattern}: an event is an object with one key"):
                step(initial({}), {"a": {}, "b": {}}, {})

    def test_no_reducer_mutates_its_input(self):
        for pattern, data in self.files.items():
            for state, event, params in walk(pattern, data):
                frozen = (copy.deepcopy(state), copy.deepcopy(event), copy.deepcopy(params))
                new_state, _ = ref.PATTERNS[pattern][1](state, event, params)
                self.assertEqual((state, event, params), frozen, f"{pattern} {event}")
                self.assertIsNot(new_state, state)

    def test_the_state_keeps_its_declared_fields(self):
        for pattern, data in self.files.items():
            for state, event, params in walk(pattern, data):
                new_state, _ = ref.PATTERNS[pattern][1](state, event, params)
                self.assertEqual(set(new_state), set(data["state"]), f"{pattern} {event}")

    def test_every_effect_is_declared(self):
        for pattern, data in self.files.items():
            for state, event, params in walk(pattern, data):
                _, effects = ref.PATTERNS[pattern][1](state, event, params)
                for effect in effects:
                    ((name, fields),) = effect.items()
                    self.assertIn(name, data["effects"], pattern)
                    self.assertEqual(set(fields), set(data["effects"][name]), f"{pattern} {name}")

    def test_a_stale_timer_token_never_changes_anything(self):
        for pattern, data in self.files.items():
            if "timerFired" not in data["events"]:
                continue
            for state, _, params in walk(pattern, data):
                for token in (state["token"] - 1, state["token"] + 1):
                    new_state, effects = ref.PATTERNS[pattern][1](state, {"timerFired": {"token": token}}, params)
                    self.assertEqual((new_state, effects), (state, []), pattern)

    def test_a_reducer_is_deterministic(self):
        for pattern, data in self.files.items():
            for state, event, params in walk(pattern, data):
                step = ref.PATTERNS[pattern][1]
                self.assertEqual(step(state, event, params), step(state, event, params))

    def test_every_rule_has_a_named_test(self):
        classes = {
            "toastQueue": ToastQueueTest,
            "overlayStack": OverlayStackTest,
            "confirmDestructive": ConfirmDestructiveTest,
            "listFocus": ListFocusTest,
            "loadState": LoadStateTest,
        }
        for pattern, data in self.files.items():
            names = [name for name in dir(classes[pattern]) if name.startswith("test_r")]
            for number in range(1, len(data["rules"]) + 1):
                self.assertTrue(
                    any(name.startswith(f"test_r{number:02d}_") for name in names),
                    f"{pattern} rule {number} has no test",
                )
            self.assertTrue(
                all(1 <= int(name[6:8]) <= len(data["rules"]) for name in names),
                f"{pattern}: a test names a rule that does not exist",
            )

    def test_run_scenario_records_every_step(self):
        records = ref.run_scenario(
            "confirmDestructive",
            {"params": {}, "events": [{"request": {}}, {"confirm": {}}]},
        )
        self.assertEqual(
            records,
            [
                {"event": {"request": {}}, "state": {"phase": "confirming", "error": None, "attempt": 0}, "effects": []},
                {"event": {"confirm": {}}, "state": {"phase": "working", "error": None, "attempt": 1},
                 "effects": [{"run": {"attempt": 1}}]},
            ],
        )

    def test_run_scenario_merges_the_initial_state(self):
        records = ref.run_scenario(
            "listFocus",
            {"params": LIST, "initial": {"rows": [row("a")], "selected": "a"}, "events": [{"focusIn": {}}]},
        )
        self.assertEqual(records[0]["state"]["focused"], "a")


if __name__ == "__main__":
    unittest.main()
