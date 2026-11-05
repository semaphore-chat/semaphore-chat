#!/usr/bin/env bash
# Proves the guards can fail: a check that has never rejected anything proves nothing.
# Run inside the image from native/. Builds throwaway workspaces under a temp directory.
#
#   native/scripts/in-image.sh scripts/test-policy.sh
set -uo pipefail

NATIVE_DIR="$(pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
failures=0

# expect <description> <grep pattern> <fail|pass> <command...>
expect() {
  local description="$1" pattern="$2" want="$3"; shift 3
  local output rc=0
  output="$("$@" 2>&1)" || rc=$?
  local ok=true
  if [ "$want" = fail ] && [ "$rc" = 0 ]; then ok=false; fi
  if [ "$want" = pass ] && [ "$rc" != 0 ]; then ok=false; fi
  if ! grep -qE -- "$pattern" <<<"$output"; then ok=false; fi
  if [ "$ok" = true ]; then
    echo "ok   $description (exit $rc)"
    grep -E -- "$pattern" <<<"$output" | head -2 | cut -c1-130 | sed 's/^/       /'
  else
    echo "FAIL $description (exit $rc, wanted $want, pattern '$pattern')"
    echo "$output" | tail -15 | cut -c1-160 | sed 's/^/       /'
    failures=$((failures + 1))
  fi
}

# --- cargo-deny: an AGPL crate of ours is allowed, a GPL dependency is rejected.
fixture="$TMP/deny"
mkdir -p "$fixture/app/src" "$fixture/gpl-dep/src"
printf '[workspace]\nresolver = "3"\nmembers = ["app", "gpl-dep"]\n' >"$fixture/Cargo.toml"
cat >"$fixture/app/Cargo.toml" <<'EOF'
[package]
name = "semaphore-app"
version = "0.0.0"
edition = "2024"
license = "AGPL-3.0-only"
publish = false
[dependencies]
gpl-dep = { path = "../gpl-dep" }
EOF
cat >"$fixture/gpl-dep/Cargo.toml" <<'EOF'
[package]
name = "gpl-dep"
version = "0.0.0"
edition = "2024"
license = "GPL-3.0-only"
publish = false
EOF
touch "$fixture/app/src/lib.rs" "$fixture/gpl-dep/src/lib.rs"
deny_output="$TMP/deny.out"
( cd "$fixture" && cargo generate-lockfile -q && \
  cargo deny --config "$NATIVE_DIR/deny.toml" check licenses ) >"$deny_output" 2>&1
deny_rc=$?
expect "cargo-deny rejects a GPL dependency" 'gpl-dep = GPL-3.0-only|GPL-3.0-only' fail \
  sh -c "cat '$deny_output'; exit $deny_rc"
if grep -qE 'semaphore-app = AGPL' "$deny_output"; then
  echo "FAIL cargo-deny rejected our own AGPL crate"
  failures=$((failures + 1))
else
  echo "ok   cargo-deny accepts our own AGPL crate in the same run"
fi

expect "cargo-deny accepts the real workspace's licenses" 'licenses ok' pass \
  cargo deny check licenses

# --- Boundary: core plus one bad dependency must fail.
boundary_fixture() { # <name> <dependency line> [<path crate name>]
  local dir="$TMP/$1"
  mkdir -p "$dir/crates"
  cp -r "$NATIVE_DIR/crates/semaphore-core" "$dir/crates/semaphore-core"
  # Core's API speaks wire types, so the fixture needs that crate too. It's checked as well, which
  # doesn't change what these cases prove: the bad dependency is added to core.
  cp -r "$NATIVE_DIR/crates/semaphore-wire" "$dir/crates/semaphore-wire"
  cat >"$dir/Cargo.toml" <<'EOF'
[workspace]
resolver = "3"
members = ["crates/*"]
[workspace.package]
version = "0.0.0"
edition = "2024"
license = "AGPL-3.0-only"
publish = false
[workspace.dependencies]
semaphore-wire = { path = "crates/semaphore-wire" }
async-trait = "0.1"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
thiserror = "2"
EOF
  echo "$2" >>"$dir/crates/semaphore-core/Cargo.toml"
  if [ -n "${3:-}" ]; then
    mkdir -p "$dir/crates/$3/src"
    printf '[package]\nname = "%s"\nversion = "0.0.0"\nedition = "2024"\n' "$3" >"$dir/crates/$3/Cargo.toml"
    touch "$dir/crates/$3/src/lib.rs"
  fi
  echo "$dir/Cargo.toml"
}

expect "boundary rejects a C build (ring)" 'ring: C build dependency' fail \
  python3 scripts/check-core-boundary.py --manifest-path "$(boundary_fixture ring 'ring = "0.17"')"
expect "boundary rejects a UI crate" 'gpui-fake: UI crate' fail \
  python3 scripts/check-core-boundary.py --manifest-path \
  "$(boundary_fixture ui 'gpui-fake = { path = "../gpui-fake" }' gpui-fake)"
expect "boundary rejects a desktop-only crate" 'livekit-fake: desktop-only crate' fail \
  python3 scripts/check-core-boundary.py --manifest-path \
  "$(boundary_fixture media 'livekit-fake = { path = "../livekit-fake" }' livekit-fake)"
expect "boundary accepts the real core" 'boundary ok' pass \
  python3 scripts/check-core-boundary.py

# --- Results: the validator must reject a result the schema forbids.
if [ -n "${RESULT_SCHEMA:-}" ]; then
  echo '{"schema_version": 1, "client": "native"}' >"$TMP/bad.json"
  expect "validator rejects an incomplete result" 'INVALID' fail \
    python3 scripts/validate-result.py "$TMP/bad.json"
else
  echo "FAIL RESULT_SCHEMA is not set, so the validator was not tested"
  failures=$((failures + 1))
fi

echo "policy failures: $failures"
[ "$failures" = 0 ]
