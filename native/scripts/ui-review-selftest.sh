#!/usr/bin/env bash
# Checks that native/scripts/ui-review.sh still does what it says, without needing a second commit.
#
#   native/scripts/ui-review-selftest.sh
#
# Three checks on three small stories, each a real run of the tool:
#   (a) base = HEAD reports nothing changed;
#   (b) a one-line change to the kit-cjk story in the working tree is reported changed, with a
#       composite, while the stories that don't render it stay unchanged;
#   (c) an unknown story id fails the run.
# The edited file is put back exactly, and `git status` is clean afterwards.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NATIVE="$REPO_ROOT/native"
TOOL="$NATIVE/scripts/ui-review.sh"
UIR="$NATIVE/.ui-review"
REPORT="$UIR/out/report.json"
WORK="$(mktemp -d)"
STORIES="about,kit-cjk,theme-swatches"
EDITED="$NATIVE/crates/semaphore-ui/src/kit/stories.rs"
BEFORE='"H5 · Japanese"'
AFTER='"H5 · Japanese, edited"'
BACKUP="$WORK/stories.rs"

fail() {
  echo "ui-review-selftest: FAILED: $*" >&2
  exit 1
}
ok() { echo "ui-review-selftest: ok: $*"; }

restore() {
  if [[ -f "$BACKUP" ]]; then cp "$BACKUP" "$EDITED"; fi
}
cleanup() {
  local status=$?
  restore
  rm -rf "$WORK"
  exit "$status"
}
trap cleanup EXIT

summary() { # <tool args...> -> the summary line, stderr in $WORK/stderr
  local output
  output="$("$TOOL" "$@" 2>"$WORK/stderr")" || {
    cat "$WORK/stderr" >&2
    fail "the run failed: $*"
  }
  tail -n 1 <<<"$output"
}

expect_summary() { # <what> <expected counts> <got>
  [[ "$3" == "[native-ui-review] diff: $2" ]] ||
    fail "$1: expected '[native-ui-review] diff: $2', got '$3'"
}

# (a) The working tree against itself changes nothing.
got="$(summary --base HEAD --stories "$STORIES")"
expect_summary "base = HEAD" "0 changed, 0 new, 0 removed, 0 unstable, 3 unchanged, 0 failed" "$got"
ok "(a) base = HEAD: $got"

# (b) One visible line changed in one story: that story changes, the others don't.
cp "$EDITED" "$BACKUP"
grep -qF -- "$BEFORE" "$EDITED" || fail "the story text to edit is gone from $EDITED"
sed -i "s/$BEFORE/$AFTER/" "$EDITED"
! grep -qF -- "$BEFORE" "$EDITED" || fail "the edit did not apply to $EDITED"

got="$(summary --base HEAD --stories "$STORIES" --reuse)"
expect_summary "an edited story" "1 changed, 0 new, 0 removed, 0 unstable, 2 unchanged, 0 failed" "$got"
restore
git -C "$REPO_ROOT" diff --quiet -- "$EDITED" || fail "$EDITED was not restored exactly"

python3 - "$REPORT" "$REPO_ROOT" <<'PY' || fail "the report of an edited story is wrong"
import json, os, sys

report = json.load(open(sys.argv[1]))
root = sys.argv[2]
stories = {story["id"]: story for story in report["stories"]}
problems = []
if stories.get("kit-cjk", {}).get("status") != "changed":
    problems.append(f"kit-cjk is {stories.get('kit-cjk', {}).get('status')}, not changed")
for size in ("desktop", "phone"):
    shots = [shot for shot in stories.get("kit-cjk", {}).get("shots", []) if shot["size"] == size]
    if not shots or shots[0]["status"] != "changed":
        problems.append(f"kit-cjk at {size} is not changed")
    elif not shots[0]["composite"]:
        problems.append(f"kit-cjk at {size} has no composite")
    elif not os.path.exists(os.path.join(root, shots[0]["composite"])):
        problems.append(f"kit-cjk at {size}: no composite at {shots[0]['composite']}")
for other in ("about", "theme-swatches"):
    if stories.get(other, {}).get("status") != "unchanged":
        problems.append(f"{other} is {stories.get(other, {}).get('status')}, not unchanged")
if problems:
    print("\n".join(problems), file=sys.stderr)
    sys.exit(1)
PY
ok "(b) an edited story: $got"

# (c) A story id that doesn't exist is a failure, not an empty review.
status=0
output="$("$TOOL" --base HEAD --stories "no-such-story-$$" 2>&1)" || status=$?
(( status != 0 )) || fail "an unknown story id must exit non-zero"
grep -q "unknown story id" <<<"$output" || fail "an unknown story id must be named: $output"
ok "(c) an unknown story id exits $status"

if git -C "$REPO_ROOT" status --porcelain -- "$EDITED" | grep -q .; then
  fail "$EDITED is still modified"
fi
echo "ui-review-selftest: all three checks passed"
