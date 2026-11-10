#!/usr/bin/env bash
# Run the real app on this desktop against the fake server. For Mike's hands-on tests (T4 IME, T5
# screen reader, T6 soak once voice lands), not for agents: it opens a window on the live session.
#
#   native/scripts/slice-run.sh [scenario]                  # showcase by default
#   native/scripts/slice-run.sh --server-only [scenario]    # the server alone, until Ctrl-C
#
# Builds semaphore-app (release) and fake-server in the pinned image, starts the fake server in a
# container on semaphore-test, copies the app out of the build volume and runs it here with the
# server's address filled in. Sign in with any username and any password except "wrong". Closing
# the app stops the server. Extra environment: SEMAPHORE_LOG=info for logs on stderr.
set -euo pipefail

NATIVE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "$NATIVE_DIR/.." && pwd)"
server_only=false
if [ "${1:-}" = "--server-only" ]; then
  server_only=true
  shift
fi
scenario="${1:-showcase}"
port=3999

if ! $server_only && [ -z "${WAYLAND_DISPLAY:-}${DISPLAY:-}" ]; then
  echo "slice-run: no display; run this from a terminal on the desktop session" >&2
  exit 1
fi

echo "slice-run: building (first time: several minutes) ..." >&2
"$NATIVE_DIR/scripts/in-image.sh" nice -n 10 \
  cargo build --locked --release -p semaphore-app -p semaphore-fake-server >&2

checkout="$(printf '%s' "$ROOT" | sha256sum | cut -c1-8)"
volume="semaphore-native-target-$checkout"
bin_dir="${XDG_CACHE_HOME:-$HOME/.cache}/semaphore-slice"
mkdir -p "$bin_dir"
docker run --rm -v "$volume:/t:ro" alpine cat /t/release/semaphore-app >"$bin_dir/semaphore-app.new"
chmod +x "$bin_dir/semaphore-app.new"
mv "$bin_dir/semaphore-app.new" "$bin_dir/semaphore-app"

name="semaphore-slice-fake-$$"
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM

# The same image and mounts as in-image.sh, detached, bound to the container's own address.
NATIVE_DOCKER_ARGS="-d" "$NATIVE_DIR/scripts/in-image.sh" \
  /cache/target/release/fake-server --scenario "$scenario" --port "$port" --bind 0.0.0.0 >"$bin_dir/server.id"
container="$(cat "$bin_dir/server.id")"
docker rename "$container" "$name" >/dev/null

ip=""
for _ in $(seq 1 100); do
  if docker logs "$name" 2>&1 | grep -q 'listening on'; then
    ip="$(docker inspect -f '{{with index .NetworkSettings.Networks "semaphore-test"}}{{.IPAddress}}{{end}}' "$name")"
    break
  fi
  if ! docker inspect "$name" >/dev/null 2>&1; then break; fi
  sleep 0.1
done
if [ -z "$ip" ]; then
  echo "slice-run: the fake server didn't start:" >&2
  docker logs "$name" >&2 || true
  exit 1
fi

url="http://$ip:$port"
if $server_only; then
  echo "slice-run: fake server ($scenario) at $url until Ctrl-C" >&2
  echo "$url"
  docker wait "$name" >/dev/null
  exit 0
fi
echo "slice-run: fake server ($scenario) at $url; sign in as anyone, any password but \"wrong\"" >&2
"$bin_dir/semaphore-app" --server "$url"
