#!/usr/bin/env bash
# Tests ui-review-needed.sh with sample path lists. No image, no network.
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fail=0
check() { # <expected> <name> <paths...>
  local want="$1" name="$2"; shift 2
  local got
  got="$(printf '%s\n' "$@" | "$here/ui-review-needed.sh" 2>/dev/null)"
  if [[ "$got" == "$want" ]]; then echo "ok   $name -> $got"; else echo "FAIL $name: want $want, got $got"; fail=1; fi
}
check skip "android only" native/android/app/build.gradle.kts native/android/README.md
check skip "player parser only" native/crates/semaphore-player/src/parser.rs
check skip "net and media" native/crates/semaphore-net/src/lib.rs native/crates/semaphore-media-livekit/src/lib.rs
check run "core outside model (links decide how labels draw)" native/crates/semaphore-core/src/links.rs
check skip "docs and other workflows" docs-site/docs/a.md .github/workflows/native-android.yml
check skip "design Kotlin output" design/gen/kotlin/Tokens.kt
check skip "empty list"
check run "semaphore-ui change" native/crates/semaphore-ui/src/kit/button.rs
check run "ui mixed with android" native/android/a.kt native/crates/semaphore-ui/src/lib.rs
check run "Cargo.lock" native/Cargo.lock
check run "Cargo.toml" native/Cargo.toml
check run "toolchain" native/rust-toolchain.toml
check run "app crate" native/crates/semaphore-app/src/main.rs
check run "design crate" native/crates/semaphore-design/src/lib.rs
check run "core model" native/crates/semaphore-core/src/model/message.rs
check run "third_party" native/third_party/vendor/gpui/src/x.rs
check run "ui-review script" native/scripts/ui-review-report.py
check run "rig" native/rigs/shot/src/main.rs
check run "gen-design" native/tools/gen-design/src/main.rs
check run "design tokens" design/tokens.json
check run "design colour" design/colour.json
check run "design icons" design/icons/add.svg
check run "design fonts" design/fonts/Roboto.ttf
check run "the workflow" .github/workflows/native-spike.yml
check run "scenarios" native/fixtures/scenarios/a.json
exit "$fail"
