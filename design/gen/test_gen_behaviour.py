"""Tests for `design/gen/gen_behaviour.py` and its wiring into `gen_tokens.py`.

    python3 -m unittest discover -s design/gen -p 'test_*.py' -v
"""

from __future__ import annotations

import contextlib
import io
import json
import pathlib
import re
import shutil
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import behaviour_ref  # noqa: E402  (after the path fix above)
import gen_behaviour as gb  # noqa: E402
import gen_tokens as gen  # noqa: E402

REPO = pathlib.Path(__file__).resolve().parents[2]
REAL_TOKENS = REPO / "design" / "tokens.json"
MOTION = json.loads(REAL_TOKENS.read_text(encoding="utf-8"))["motion"]
PATTERN_DIR = REPO / "design" / "behaviour"


def real_patterns() -> list[dict]:
    return gb.load_patterns(REPO, {"motion": MOTION})


class TempPatterns(unittest.TestCase):
    """A temporary repo root with copies of the real pattern files."""

    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = pathlib.Path(temporary.name)
        shutil.copytree(PATTERN_DIR, self.root / "design" / "behaviour")

    def path(self, stem: str) -> pathlib.Path:
        return self.root / "design" / "behaviour" / f"{stem}.json"

    def edit(self, stem: str, change) -> None:
        data = json.loads(self.path(stem).read_text(encoding="utf-8"))
        change(data)
        self.path(stem).write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")

    def load(self) -> list[dict]:
        return gb.load_patterns(self.root, {"motion": MOTION})

    def assert_error(self, pattern: str) -> None:
        with self.assertRaisesRegex(gen.TokenError, "^" + re.escape(pattern)):
            gb.build(self.load())


class LoadTest(TempPatterns):
    def test_real_files_load_in_file_name_order(self):
        names = [pattern["pattern"] for pattern in real_patterns()]
        self.assertEqual(
            names, ["confirmDestructive", "listFocus", "loadState", "overlayStack", "toastQueue"]
        )

    def test_durations_resolve_to_motion_tokens(self):
        toast = next(p for p in real_patterns() if p["pattern"] == "toastQueue")
        self.assertEqual(
            toast["resolved"], {"durationMs": 4000, "durationWithActionMs": 8000, "maxQueued": 3}
        )

    def test_unknown_event_in_a_scenario(self):
        self.edit("toast-queue", lambda d: d["scenarios"][0]["events"].append({"bogus": {}}))
        self.assert_error("behaviour.toastQueue.scenarios[0].events[5].bogus: unknown event")

    def test_event_fields_must_match_the_declaration(self):
        self.edit("toast-queue", lambda d: d["scenarios"][0]["events"].append({"timerFired": {}}))
        self.assert_error("behaviour.toastQueue.scenarios[0].events[5].timerFired.token: missing")
        self.edit("toast-queue", lambda d: d["scenarios"][0]["events"].__setitem__(5, {"pause": {"x": 1}}))
        self.assert_error("behaviour.toastQueue.scenarios[0].events[5].pause.x: unknown field")

    def test_an_event_is_one_key(self):
        self.edit("load-state", lambda d: d["scenarios"][0]["events"].append({"start": {}, "retry": {}}))
        self.assert_error("behaviour.loadState.scenarios[0].events[2]")

    def test_duplicate_scenario_name(self):
        self.edit("load-state", lambda d: d["scenarios"].append(dict(d["scenarios"][0])))
        self.assert_error("behaviour.loadState.scenarios[8].name: duplicate scenario name")

    def test_every_rule_must_be_covered(self):
        self.edit("load-state", lambda d: d["rules"].append("A new rule nothing covers."))
        self.assert_error("behaviour.loadState.rules: no scenario covers rule 12")

    def test_covers_must_name_real_rules(self):
        self.edit("load-state", lambda d: d["scenarios"][0]["covers"].append(99))
        self.assert_error("behaviour.loadState.scenarios[0].covers")

    def test_duplicate_rule(self):
        self.edit("load-state", lambda d: d["rules"].append(d["rules"][0]))
        self.assert_error("behaviour.loadState.rules[11]: duplicate rule")

    def test_file_name_must_match_the_pattern(self):
        self.edit("load-state", lambda d: d.__setitem__("pattern", "loadingState"))
        self.assert_error("behaviour.loadingState.pattern: expected the file to be named loading-state.json")

    def test_unknown_and_missing_entries(self):
        self.edit("load-state", lambda d: d.__setitem__("extra", 1))
        self.assert_error("behaviour.loadState.extra: unknown entry")
        self.edit("load-state", lambda d: (d.pop("extra"), d.pop("rules")))
        self.assert_error("behaviour.loadState.rules: missing")

    def test_unknown_motion_token(self):
        self.edit("toast-queue", lambda d: d["params"].__setitem__("durationMs", "motion.nope"))
        self.assert_error("behaviour.toastQueue.params.durationMs: unknown token 'motion.nope'")

    def test_scenario_params_must_be_declared(self):
        self.edit("list-focus", lambda d: d["scenarios"][0].__setitem__("params", {"loop": True}))
        self.assert_error("behaviour.listFocus.scenarios[0].params.loop: unknown parameter")

    def test_scenario_initial_must_name_state_fields(self):
        self.edit("list-focus", lambda d: d["scenarios"][0].__setitem__("initial", {"cursor": 1}))
        self.assert_error("behaviour.listFocus.scenarios[0].initial.cursor: unknown state field")

    def test_fractions_and_control_characters_are_rejected(self):
        self.edit("load-state", lambda d: d["scenarios"][0]["events"].__setitem__(
            1, {"succeeded": {"token": 1.5, "empty": False}}))
        self.assert_error("behaviour.loadState.scenarios[0].events[1].succeeded.token: expected a whole number")
        self.edit("load-state", lambda d: d["scenarios"][0]["events"].__setitem__(
            1, {"failed": {"token": 1, "message": "a\nb"}}))
        self.assert_error("behaviour.loadState.scenarios[0].events[1].failed.message")

    def test_duplicate_json_key(self):
        path = self.path("load-state")
        path.write_text(path.read_text(encoding="utf-8").replace('"doc":', '"params": {},\n  "doc":', 1),
                        encoding="utf-8")
        self.assert_error("behaviour.load-state: ")

    def test_broken_json_names_the_file(self):
        self.path("load-state").write_text("{ bad", encoding="utf-8")
        self.assert_error("behaviour.load-state: ")

    def test_a_copied_pattern_file_cannot_share_the_name(self):
        # The file name follows the pattern name, so a copy must be renamed.
        shutil.copy(self.path("load-state"), self.root / "design" / "behaviour" / "zz.json")
        self.assert_error("behaviour.loadState.pattern: expected the file to be named load-state.json")

    def test_pattern_without_a_reducer(self):
        def rename(data: dict) -> None:
            data["pattern"] = "loadStateTwo"

        shutil.copy(self.path("load-state"), self.root / "design" / "behaviour" / "load-state-two.json")
        self.edit("load-state-two", rename)
        self.assert_error("behaviour.loadStateTwo: no reference reducer")

    def test_declared_events_must_match_the_reducer(self):
        self.edit("load-state", lambda d: d["events"].__setitem__("cancel", {}))
        self.assert_error("behaviour.loadState.events: the file declares")

    def test_undeclared_effect_from_the_reference(self):
        self.edit("load-state", lambda d: d["effects"].pop("notify"))
        self.assert_error("behaviour.loadState.scenarios[4].events[3].effects.notify")

    def test_no_pattern_files(self):
        for path in (self.root / "design" / "behaviour").glob("*.json"):
            path.unlink()
        with self.assertRaisesRegex(gen.TokenError, r"^behaviour: no pattern files"):
            self.load()


class BuildTest(unittest.TestCase):
    def setUp(self) -> None:
        self.built = gb.build(real_patterns())

    def test_vectors_are_the_reference_run_over_each_scenario(self):
        for pattern in real_patterns():
            name = pattern["pattern"]
            for index, scenario in enumerate(pattern["scenarios"]):
                vector = self.built[name]["vectors"][index]
                self.assertEqual(vector["name"], scenario["name"])
                records = behaviour_ref.run_scenario(
                    name,
                    {"params": vector["params"], "initial": scenario.get("initial"), "events": scenario["events"]},
                )
                self.assertEqual(vector["steps"], records, f"{name}: {scenario['name']}")

    def test_scenario_params_override_the_defaults(self):
        wrap = next(v for v in self.built["listFocus"]["vectors"] if v["name"] == "wrap goes round")
        self.assertEqual(wrap["params"], {"selectionFollowsFocus": False, "typeaheadMs": 500, "wrap": True})
        self.assertEqual(self.built["listFocus"]["params"]["wrap"], False)

    def test_the_first_toast_vector_matches_the_worked_example(self):
        first = self.built["toastQueue"]["vectors"][0]["steps"]
        self.assertEqual(
            first[0]["effects"],
            [{"startTimer": {"ms": 4000, "token": 1}},
             {"announce": {"message": "Saved", "politeness": "polite"}}],
        )
        self.assertEqual(first[3]["effects"], [])

    def test_data_keys_are_sorted_and_structure_keeps_its_order(self):
        vector = self.built["toastQueue"]["vectors"][0]
        self.assertEqual(list(vector), ["name", "params", "initial", "steps"])
        self.assertEqual(list(vector["steps"][0]), ["event", "state", "effects"])
        self.assertEqual(list(vector["initial"]), ["paused", "queue", "showing", "token"])


class CanonicalTest(unittest.TestCase):
    def test_canonical_form(self):
        value = {"b": 1, "a": [None, True, False, 'q"b\\', "é"], "c": {"z": -2, "y": {}}}
        self.assertEqual(
            gb.canonical(value),
            '{"a":[null,true,false,"q\\"b\\\\","é"],"b":1,"c":{"y":{},"z":-2}}',
        )


def ts_to_json(text: str) -> object:
    """Read the generated TypeScript literal back, for comparison with the JSON."""
    body = text[text.index("export const behaviourVectors = ") + len("export const behaviourVectors = "):]
    body = body[: body.index(" as const;")]
    out = []
    for line in body.split("\n"):
        line = re.sub(r"^(\s*)([A-Za-z_$][A-Za-z0-9_$]*): ", r'\1"\2": ', line)

        def string(match: re.Match) -> str:
            return json.dumps(match.group(1).replace("\\'", "'").replace("\\\\", "\\"), ensure_ascii=False)

        line = re.sub(r"'((?:[^'\\]|\\.)*)'", string, line)
        out.append(line)
    joined = re.sub(r",(\s*[}\]])", r"\1", "\n".join(out))
    return json.loads(joined)


RS_FIELD = re.compile(r'^\s+(name|params|initial|event|state|effects): "((?:[^"\\]|\\.)*)",$', re.MULTILINE)


def rs_unescape(value: str) -> str:
    return re.sub(r"\\(.)", r"\1", value)


class RenderTest(unittest.TestCase):
    def setUp(self) -> None:
        self.built = gb.build(real_patterns())

    def test_json_round_trips(self):
        self.assertEqual(json.loads(gb.render_json(self.built)), self.built)

    def test_ts_holds_the_same_data(self):
        out = gb.render_ts(self.built)
        self.assertTrue(out.startswith("// @generated by design/gen/gen_tokens.py from design/behaviour/*.json."))
        self.assertTrue(out.endswith("} as const;\n\nexport type BehaviourPattern = keyof typeof behaviourVectors;\n"))
        self.assertEqual(ts_to_json(out), self.built)

    def test_ts_escapes_quotes(self):
        out = gb.render_ts({"p": {"m": "Couldn't \\ send"}})
        self.assertIn("m: 'Couldn\\'t \\\\ send',", out)
        self.assertEqual(ts_to_json(out), {"p": {"m": "Couldn't \\ send"}})

    def test_rs_holds_the_same_data_as_canonical_strings(self):
        out = gb.render_rs(self.built)
        fields = [(key, rs_unescape(value)) for key, value in RS_FIELD.findall(out)]
        expected = []
        for name, pattern in self.built.items():
            expected += [("name", name), ("params", gb.canonical(pattern["params"])),
                         ("initial", gb.canonical(pattern["initial"]))]
            for vector in pattern["vectors"]:
                expected += [("name", vector["name"]), ("params", gb.canonical(vector["params"])),
                             ("initial", gb.canonical(vector["initial"]))]
                for step in vector["steps"]:
                    expected += [(key, gb.canonical(step[key])) for key in ("event", "state", "effects")]
        self.assertEqual(fields, expected)

    def test_rs_is_headed_and_skips_rustfmt_on_the_data(self):
        out = gb.render_rs(self.built)
        self.assertTrue(out.startswith("// @generated by design/gen/gen_tokens.py from design/behaviour/*.json."))
        self.assertIn("#[rustfmt::skip]\npub(crate) const PATTERNS: &[Pattern] = &[", out)
        self.assertIn("fn behaviour_vectors_are_complete()", out)

    def test_renders_are_deterministic(self):
        again = gb.build(real_patterns())
        for render in (gb.render_json, gb.render_ts, gb.render_rs):
            self.assertEqual(render(self.built), render(again))


class RunTest(TempPatterns):
    def setUp(self) -> None:
        super().setUp()
        (self.root / "design" / "tokens.json").write_bytes(REAL_TOKENS.read_bytes())
        (self.root / "design" / "colour.json").write_bytes((REPO / "design" / "colour.json").read_bytes())
        shutil.copytree(REPO / "design" / "icons", self.root / "design" / "icons")

    def test_run_writes_the_behaviour_outputs_and_check_passes(self):
        self.assertEqual(gen.run(self.root, check=False), 0)
        for path in (gb.VECTORS_OUTPUT, gb.TS_OUTPUT, gb.RS_OUTPUT):
            self.assertTrue((self.root / path).is_file(), path)
        self.assertEqual(gen.run(self.root, check=True), 0)

    def test_a_changed_scenario_makes_the_outputs_stale(self):
        self.assertEqual(gen.run(self.root, check=False), 0)
        self.edit("load-state", lambda d: d["scenarios"][0]["events"].append({"refresh": {}}))
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            self.assertEqual(gen.run(self.root, check=True), 1)
        for path in (gb.VECTORS_OUTPUT, gb.TS_OUTPUT, gb.RS_OUTPUT):
            self.assertIn(f"stale: {path.as_posix()}", stderr.getvalue())

    def test_main_reports_a_behaviour_error_on_one_line(self):
        self.edit("load-state", lambda d: d["scenarios"][0]["events"].append({"bogus": {}}))
        stderr = io.StringIO()
        with mock.patch.object(gen, "ROOT", self.root), contextlib.redirect_stderr(stderr):
            self.assertEqual(gen.main(["--check"]), 1)
        err = stderr.getvalue()
        self.assertTrue(err.startswith("error: behaviour.loadState.scenarios[0].events[2].bogus"), err)
        self.assertEqual(len(err.strip().splitlines()), 1)

    def test_repo_outputs_are_current(self):
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            self.assertEqual(gen.run(REPO, check=True), 0, stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
