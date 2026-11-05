#!/usr/bin/env bash
# A LiveKit server for native rigs, on semaphore-test, and the port measurement T1 needs.
#
#   native/scripts/lk-stack.sh up [<udp ports, default 200>]
#   native/scripts/lk-stack.sh down
#   native/scripts/lk-stack.sh url           # ws:// address, reachable from containers and the host
#   native/scripts/lk-stack.sh measure <publishers> <subscribers>
#
# Why not the voice-e2e compose stack: it brings up the whole app, and its host overlay
# publishes fixed ports. A rig that only needs media gets this instead. Nothing is
# published: a host binary reaches the container's semaphore-test address directly, which
# means no port mapping and no fixed host ports. No Docker network is created or removed.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NAME="${LK_STACK_NAME:-native-spike-livekit}"
PORT_START=51000
# The same tags as docker-compose.yml's server and the CLI verified for this spike.
SERVER_IMAGE=livekit/livekit-server:v1.13.7
CLI_IMAGE=livekit/livekit-cli@sha256:04eff828f8edd810b996c18456a6260ba0698a60f8ea309d0f015c2b09696413
KEY=devkey
SECRET=secret-that-is-at-least-32-characters-long
ROOM=native-port-measure
WORKERS=()

ip_of() {
  docker inspect -f '{{(index .NetworkSettings.Networks "semaphore-test").IPAddress}}' "$NAME"
}

up() {
  local ports="${1:-200}"
  "$ROOT/scripts/test-net.sh" >/dev/null
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker run -d --name "$NAME" --network semaphore-test \
    -e LIVEKIT_CONFIG="$(printf 'port: 7880\nrtc:\n  tcp_port: 7881\n  port_range_start: %d\n  port_range_end: %d\n  use_external_ip: false\nkeys:\n  %s: %s\n' \
      "$PORT_START" "$((PORT_START + ports - 1))" "$KEY" "$SECRET")" \
    "$SERVER_IMAGE" >/dev/null
  local address; address="$(ip_of)"
  for _ in $(seq 1 60); do
    curl -sf -o /dev/null "http://$address:7880" && { echo "ws://$address:7880"; return 0; }
    sleep 0.5
  done
  docker logs --tail 20 "$NAME" >&2
  echo "lk-stack: server did not answer on $address:7880" >&2
  return 1
}

down() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }

lk() {
  docker run --rm --network semaphore-test "$CLI_IMAGE" \
    --url "ws://$NAME:7880" --api-key "$KEY" --api-secret "$SECRET" "$@"
}

# Sockets the server holds in its ICE range. The helper joins the server's namespace, which
# creates no network.
udp_ports_in_use() {
  docker run --rm --network "container:$NAME" alpine:3 cat /proc/net/udp \
    | awk 'NR > 1 { split($2, local_addr, ":"); print local_addr[2] }' \
    | while read -r hex; do
        port=$((16#$hex))
        [ "$port" -ge "$PORT_START" ] && echo "$port"
      done | sort -u | wc -l
}

# ACTIVE means ICE connected, which is the part a too-small range would break.
active_participants() {
  lk room participants list "$ROOM" 2>/dev/null | grep -c 'ACTIVE' || true
}

stop_workers() {
  [ "${#WORKERS[@]}" -gt 0 ] && docker rm -f "${WORKERS[@]}" >/dev/null 2>&1
  WORKERS=()
}

measure() {
  local publishers="$1" subscribers="$2" total=$(($1 + $2)) i name
  trap stop_workers EXIT
  echo "participants=0 udp_ports=$(udp_ports_in_use)"
  for i in $(seq 1 "$total"); do
    name="$NAME-peer-$i"
    WORKERS+=("$name")
    if [ "$i" -le "$publishers" ]; then
      docker run -d --name "$name" --network semaphore-test "$CLI_IMAGE" \
        --url "ws://$NAME:7880" --api-key "$KEY" --api-secret "$SECRET" \
        room join --identity "pub-$i" --publish-demo "$ROOM" >/dev/null
    else
      docker run -d --name "$name" --network semaphore-test "$CLI_IMAGE" \
        --url "ws://$NAME:7880" --api-key "$KEY" --api-secret "$SECRET" \
        room join --identity "sub-$i" --auto-subscribe "$ROOM" >/dev/null
    fi
    # Bounded poll on the condition: this peer's connection is up, or we report it isn't.
    local active=0
    for _ in $(seq 1 40); do
      active="$(active_participants)"
      [ "$active" -ge "$i" ] && break
      sleep 0.5
    done
    echo "participants=$i active=$active udp_ports=$(udp_ports_in_use)"
  done
  echo "final active=$(active_participants)/$total udp_ports=$(udp_ports_in_use)"
  # grep -c prints 0 and exits 1 on no matches, which is the good case.
  docker logs "$NAME" 2>&1 | grep -c -E 'address already in use|ports? exhausted|no available port|ICE failed|could not listen' \
    | sed 's/^/server_port_errors=/' || true
}

case "${1:-}" in
  up) shift; up "$@" ;;
  down) down ;;
  url) echo "ws://$(ip_of):7880" ;;
  measure) shift; measure "$@" ;;
  *) sed -n '2,6p' "$0" >&2; exit 2 ;;
esac
