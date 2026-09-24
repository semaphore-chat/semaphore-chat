#!/usr/bin/env bash
# Self-test for pr-screenshots.sh against a throwaway local bare "remote" —
# never touches the real repository. Needs only bash + git:
#   frontend/scripts/ui-review/test-pr-screenshots.sh
# Covers: no-op prune without the branch, orphan creation, per-PR replace that
# preserves other PRs, single parentless commit, a lost --force-with-lease race
# (retried), prune by PR / by PR state (gh stubbed) / dry run, the read-only
# exit code, and that no other branch is touched.
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

git init -q --bare -b main "$T/remote.git"
git clone -q "$T/remote.git" "$T/work" 2>/dev/null
git -C "$T/work" commit -q --allow-empty -m init
git -C "$T/work" push -q origin main
MAIN_SHA="$(git -C "$T/remote.git" rev-parse main)"
mkdir -p "$T/files1" "$T/files2" "$T/files3"
echo a >"$T/files1/a.webp"; echo b >"$T/files1/b.webp"
echo c >"$T/files2/c.webp"
echo d >"$T/files3/d.webp"
run() { (cd "$T/work" && bash "$SCRIPT" "$@"); }

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

run prune --pr 2 2>/dev/null
[[ "$(tree_of)" == "README.md pr-1/run2/d.webp pr-3/run1/c.webp pr-4/run1/a.webp pr-4/run1/b.webp " ]] || fail "prune --pr 2: $(tree_of)"
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
before="$(git -C "$T/remote.git" rev-parse pr-screenshots)"
PATH="$T/bin:$PATH" run prune --dry-run 2>"$T/dry.log"
grep -q "would remove pr-3/" "$T/dry.log" || fail "dry run output: $(cat "$T/dry.log")"
[[ "$(git -C "$T/remote.git" rev-parse pr-screenshots)" == "$before" ]] || fail "dry run pushed"
ok "prune --dry-run reports and changes nothing"

PATH="$T/bin:$PATH" run prune 2>/dev/null
[[ "$(tree_of)" == "README.md pr-1/run2/d.webp pr-4/run1/a.webp pr-4/run1/b.webp " ]] || fail "prune by state: $(tree_of)"
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
[[ -z "$(git -C "$T/work" for-each-ref refs/ui-review)" ]] || fail "private ref left behind"
[[ "$(git -C "$T/work" branch --format='%(refname:short)')" == "main" ]] || fail "local branches created"
ok "no other branch touched, no refs left behind"

echo "all $pass checks passed"
