#!/usr/bin/env bash
# Self-test for pr-screenshots.sh against a throwaway local bare "remote" —
# never touches the real repository. Needs only bash + git:
#   frontend/scripts/ui-review/test-pr-screenshots.sh
# Covers: no-op prune without the branch, orphan creation, per-PR replace that
# preserves other PRs, single parentless commit, a lost --force-with-lease race
# (retried), concurrent publishers, --keep-previous + prune --keep, prune by
# PR / by PR state (gh stubbed) / dry run, failing git steps and a missing gh
# abort without pushing, refusing a branch that isn't a screenshots branch, the
# read-only exit code, and that no other branch is touched.
set -euo pipefail

SCRIPT="$(cd "$(dirname "$0")" && pwd)/pr-screenshots.sh"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
export GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@example.com GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@example.com
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1

pass=0
ok() { echo "ok - $*"; pass=$((pass + 1)); }
fail() { echo "FAIL - $*" >&2; exit 1; }
tree_of() { git -C "$T/remote.git" ls-tree -r --name-only pr-screenshots | LC_ALL=C sort | tr '\n' ' '; }
tip() { git -C "$T/remote.git" rev-parse pr-screenshots; }

git init -q --bare -b main "$T/remote.git"
git clone -q "$T/remote.git" "$T/work" 2>/dev/null
echo code >"$T/work/code.txt"
git -C "$T/work" add code.txt
git -C "$T/work" commit -q -m init
git -C "$T/work" commit -q --allow-empty -m second
git -C "$T/work" push -q origin main
MAIN_SHA="$(git -C "$T/remote.git" rev-parse main)"
mkdir -p "$T/files1" "$T/files2" "$T/files3"
echo a >"$T/files1/a.webp"; echo b >"$T/files1/b.webp"
echo c >"$T/files2/c.webp"
echo d >"$T/files3/d.webp"
run() { (cd "$T/work" && bash "$SCRIPT" "$@"); }
# Expect failure: run "$@", succeed only if it exits non-zero; its stderr goes to $T/err.log.
run_fails() { if run "$@" 2>"$T/err.log"; then return 1; fi; }

run prune --pr 1 2>/dev/null || fail "prune without the branch should be a no-op"
git -C "$T/remote.git" rev-parse -q --verify pr-screenshots >/dev/null && fail "prune created the branch"
ok "prune is a no-op when the branch does not exist"

run publish --pr 1 --folder pr-1/run1 --dir "$T/files1" 2>/dev/null
[[ "$(tree_of)" == "README.md pr-1/run1/a.webp pr-1/run1/b.webp " ]] || fail "tree after first publish: $(tree_of)"
[[ -z "$(git -C "$T/remote.git" log --format=%P -1 pr-screenshots)" ]] || fail "first commit has a parent"
ok "publish creates the orphan branch"

run publish --pr 2 --folder pr-2/run1 --dir "$T/files2" 2>/dev/null
run publish --pr 1 --folder pr-1/run2 --dir "$T/files3" 2>/dev/null
[[ "$(tree_of)" == "README.md pr-1/run2/d.webp pr-2/run1/c.webp " ]] || fail "tree after republish: $(tree_of)"
[[ "$(git -C "$T/remote.git" rev-list --count pr-screenshots)" == 1 ]] || fail "branch has history"
ok "republish replaces only pr-1/, keeps pr-2/, branch stays one commit"

# Lost race: a pre-push hook publishes pr-3 from another clone first, so our
# lease is stale on the first attempt; the script must re-fetch and keep pr-3.
git clone -q "$T/remote.git" "$T/other" 2>/dev/null
cat >"$T/work/.git/hooks/pre-push" <<EOF
#!/usr/bin/env bash
if [[ ! -e "$T/raced" ]]; then
  touch "$T/raced"
  (cd "$T/other" && unset GIT_DIR GIT_INDEX_FILE && bash "$SCRIPT" publish --pr 3 --folder pr-3/run1 --dir "$T/files2" >/dev/null 2>&1)
fi
EOF
chmod +x "$T/work/.git/hooks/pre-push"
run publish --pr 4 --folder pr-4/run1 --dir "$T/files1" 2>"$T/race.log"
grep -q "push rejected" "$T/race.log" || fail "expected a rejected first push: $(cat "$T/race.log")"
[[ "$(tree_of)" == "README.md pr-1/run2/d.webp pr-2/run1/c.webp pr-3/run1/c.webp pr-4/run1/a.webp pr-4/run1/b.webp " ]] ||
  fail "tree after race: $(tree_of)"
rm "$T/work/.git/hooks/pre-push"
ok "a concurrent publish is not lost (force-with-lease + retry)"

# Several publishers at once, each from its own clone: every one lands.
for n in 11 12 13 14 15; do git clone -q "$T/remote.git" "$T/racer$n" 2>/dev/null; done
pids=()
for n in 11 12 13 14 15; do
  (cd "$T/racer$n" && bash "$SCRIPT" publish --pr "$n" --folder "pr-$n/run1" --dir "$T/files3" >"$T/racer$n.log" 2>&1) &
  pids+=($!)
done
for pid in "${pids[@]}"; do wait "$pid" || fail "a concurrent publisher failed: $(cat "$T"/racer*.log)"; done
for n in 11 12 13 14 15; do [[ "$(tree_of)" == *"pr-$n/run1/d.webp"* ]] || fail "pr-$n lost in the race: $(tree_of)"; done
[[ "$(tree_of)" == *"pr-3/run1/c.webp"* && "$(git -C "$T/remote.git" rev-list --count pr-screenshots)" == 1 ]] || fail "after racing: $(tree_of)"
for n in 11 12 13 14 15; do run prune --pr "$n" 2>/dev/null; done
ok "five simultaneous publishers all land, other folders kept"

run publish --pr 4 --folder pr-4/run2 --dir "$T/files3" --keep-previous 2>/dev/null
[[ "$(tree_of)" == *"pr-4/run1/a.webp pr-4/run1/b.webp pr-4/run2/d.webp "* ]] || fail "--keep-previous: $(tree_of)"
run prune --pr 4 --keep pr-4/run2 2>/dev/null
[[ "$(tree_of)" == "README.md pr-1/run2/d.webp pr-2/run1/c.webp pr-3/run1/c.webp pr-4/run2/d.webp " ]] || fail "prune --keep: $(tree_of)"
ok "publish --keep-previous keeps earlier runs until prune --keep drops them"

# A failing git step (disk full, corrupt object, ...) must abort before pushing.
mkdir -p "$T/shim"
REAL_GIT="$(command -v git)"
cat >"$T/shim/git" <<EOF
#!/usr/bin/env bash
if [[ "\${FAIL_GIT:-}" == read-tree && "\$1" == read-tree && "\$2" != --empty ]]; then echo "fatal: simulated read-tree failure" >&2; exit 128; fi
if [[ "\${FAIL_GIT:-}" == hash-object && "\$1" == hash-object && " \$* " == *" -w "* ]]; then echo "fatal: simulated write error" >&2; exit 128; fi
exec "$REAL_GIT" "\$@"
EOF
chmod +x "$T/shim/git"
for step in read-tree hash-object; do
  before="$(tip)"
  PATH="$T/shim:$PATH" FAIL_GIT=$step run_fails publish --pr 9 --folder pr-9/run1 --dir "$T/files1" ||
    fail "publish succeeded although git $step failed"
  [[ "$(tip)" == "$before" ]] || fail "pushed after git $step failed: $(tree_of)"
  PATH="$T/shim:$PATH" FAIL_GIT=$step run_fails prune --pr 2 || fail "prune succeeded although git $step failed"
  [[ "$(tip)" == "$before" ]] || fail "prune pushed after git $step failed: $(tree_of)"
done
ok "a failing git step aborts publish and prune without pushing"

# prune without --pr needs gh: without it on PATH it must fail, not report "nothing to change".
mkdir -p "$T/nogh"
for tool in git bash env xargs grep head find wc basename mktemp rm sleep; do ln -sf "$(command -v "$tool")" "$T/nogh/$tool"; done
before="$(tip)"
if (cd "$T/work" && PATH="$T/nogh" bash "$SCRIPT" prune 2>"$T/err.log"); then fail "prune without gh exited 0"; fi
grep -q "needs the gh CLI" "$T/err.log" || fail "prune without gh: $(cat "$T/err.log")"
[[ "$(tip)" == "$before" ]] || fail "prune without gh pushed"
ok "prune without --pr fails when gh is missing"

before_main="$(git -C "$T/remote.git" rev-parse main)"
run_fails publish --pr 5 --folder pr-5/run1 --dir "$T/files1" --branch main || fail "publish to main was allowed"
grep -q "not a screenshots branch" "$T/err.log" || fail "publish to main: $(cat "$T/err.log")"
[[ "$(git -C "$T/remote.git" rev-parse main)" == "$before_main" ]] || fail "main moved"
git -C "$T/remote.git" branch -q single-code "$(git -C "$T/remote.git" commit-tree "main^{tree}" -m orphan-code)"
run_fails prune --pr 5 --branch single-code || fail "prune on a code branch was allowed"
grep -q "holds 'code.txt'" "$T/err.log" || fail "prune on a code branch: $(cat "$T/err.log")"
git -C "$T/remote.git" branch -q -D single-code
ok "refuses a --branch that isn't a screenshots branch (history, or foreign files)"

run prune --pr 2 2>/dev/null
[[ "$(tree_of)" == "README.md pr-1/run2/d.webp pr-3/run1/c.webp pr-4/run2/d.webp " ]] || fail "prune --pr 2: $(tree_of)"
ok "prune --pr removes just that PR"

mkdir -p "$T/bin"
cat >"$T/bin/gh" <<'EOF'
#!/usr/bin/env bash
case "$3" in
  1) echo OPEN ;;
  3) echo MERGED ;;
  *) echo "no such PR" >&2; exit 1 ;;
esac
EOF
chmod +x "$T/bin/gh"
before="$(tip)"
PATH="$T/bin:$PATH" run prune --dry-run 2>"$T/dry.log"
grep -q "would remove pr-3/" "$T/dry.log" || fail "dry run output: $(cat "$T/dry.log")"
[[ "$(tip)" == "$before" ]] || fail "dry run pushed"
ok "prune --dry-run reports and changes nothing"

PATH="$T/bin:$PATH" run prune 2>/dev/null
[[ "$(tree_of)" == "README.md pr-1/run2/d.webp pr-4/run2/d.webp " ]] || fail "prune by state: $(tree_of)"
ok "prune drops merged/closed PRs, keeps open and unresolvable ones"

cat >"$T/remote.git/hooks/pre-receive" <<'EOF'
#!/usr/bin/env bash
echo "Permission to example/repo.git denied to github-actions[bot]." >&2
exit 1
EOF
chmod +x "$T/remote.git/hooks/pre-receive"
set +e
run prune --pr 4 2>/dev/null
code=$?
set -e
[[ $code -eq 3 ]] || fail "read-only push should exit 3, got $code"
rm "$T/remote.git/hooks/pre-receive"
ok "a push refused for lack of permission exits 3"

[[ "$(git -C "$T/remote.git" rev-parse main)" == "$MAIN_SHA" ]] || fail "main moved"
[[ "$(git -C "$T/remote.git" for-each-ref --format='%(refname)' refs/heads | sort | tr '\n' ' ')" == "refs/heads/main refs/heads/pr-screenshots " ]] ||
  fail "unexpected remote branches"
[[ "$(git -C "$T/work" for-each-ref --format='%(refname)' refs/ui-review)" == "refs/ui-review/pr-screenshots" ]] ||
  fail "private refs: $(git -C "$T/work" for-each-ref refs/ui-review)"
[[ "$(git -C "$T/work" rev-parse refs/ui-review/pr-screenshots)" == "$(tip)" ]] || fail "private ref is not the remote tip"
[[ "$(git -C "$T/work" branch --format='%(refname:short)')" == "main" ]] || fail "local branches created"
ok "no other branch touched; only the private tracking ref (at the remote tip) is kept"

echo "all $pass checks passed"
