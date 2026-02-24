#!/bin/sh
# livekit-ip-watcher.sh
#
# Monitors the host's external IP and restarts the LiveKit container when it
# changes. LiveKit resolves its external IP once at startup (via STUN) and
# bakes it into ICE candidates — there is no periodic re-resolution. If the
# host IP changes (common with residential ISPs), voice/video breaks until
# LiveKit is restarted.
#
# Designed to run as a sidecar in Docker Compose. Communicates with the Docker
# Engine API over the mounted Unix socket.
#
# Environment variables:
#   CHECK_INTERVAL      Seconds between checks (default: 300)
#   LIVEKIT_CONTAINER   Compose service name to restart (default: livekit)
#   IP_CHECK_URLS       Comma-separated external IP check URLs
#                       (default: https://api.ipify.org,https://ifconfig.me/ip,https://icanhazip.com)

set -e

CHECK_INTERVAL="${CHECK_INTERVAL:-300}"
LIVEKIT_CONTAINER="${LIVEKIT_CONTAINER:-livekit}"
IP_CHECK_URLS="${IP_CHECK_URLS:-https://api.ipify.org,https://ifconfig.me/ip,https://icanhazip.com}"
DOCKER_SOCKET="/var/run/docker.sock"

LAST_IP=""

log() {
  echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') [ip-watcher] $1"
}

# Check if a string looks like a valid IPv4 or IPv6 address.
is_valid_ip() {
  echo "$1" | grep -qE '^([0-9]{1,3}\.){3}[0-9]{1,3}$' && return 0
  echo "$1" | grep -qE '^[0-9a-fA-F:]+$' && return 0
  return 1
}

# Fetch external IP, trying each URL in order until one succeeds.
get_external_ip() {
  _old_ifs="$IFS"
  IFS=","
  for url in $IP_CHECK_URLS; do
    ip=$(curl -sf --max-time 10 "$url" 2>/dev/null | tr -d '[:space:]')
    if [ -n "$ip" ] && is_valid_ip "$ip"; then
      IFS="$_old_ifs"
      echo "$ip"
      return 0
    fi
  done
  IFS="$_old_ifs"
  return 1
}

# Find LiveKit container ID by Compose service label.
find_livekit_container() {
  filters_json=$(printf '{"label":["com.docker.compose.service=%s"]}' "$LIVEKIT_CONTAINER")
  id=$(curl -sf --unix-socket "$DOCKER_SOCKET" \
    --get --data-urlencode "filters=$filters_json" \
    "http://localhost/containers/json" \
    | sed -n 's/.*"Id":"\([a-f0-9]*\)".*/\1/p' | head -1)
  echo "$id"
}

# Restart a container by ID via the Docker Engine API.
restart_container() {
  container_id="$1"
  err=$(curl -sf --unix-socket "$DOCKER_SOCKET" \
    -X POST "http://localhost/containers/${container_id}/restart?t=10" \
    2>&1) || { log "ERROR: Docker API: $err"; return 1; }
}

# --- Startup checks ---

if [ ! -S "$DOCKER_SOCKET" ]; then
  log "ERROR: Docker socket not found at $DOCKER_SOCKET"
  log "Mount it with: -v /var/run/docker.sock:/var/run/docker.sock"
  exit 1
fi

log "Starting LiveKit IP watcher"
log "  Check interval: ${CHECK_INTERVAL}s"
log "  LiveKit service: ${LIVEKIT_CONTAINER}"

# --- Main loop ---

while true; do
  current_ip=$(get_external_ip) || true

  if [ -z "$current_ip" ]; then
    log "WARNING: Could not determine external IP, will retry in ${CHECK_INTERVAL}s"
    sleep "$CHECK_INTERVAL"
    continue
  fi

  if [ -z "$LAST_IP" ]; then
    # First run — just record the IP without restarting.
    LAST_IP="$current_ip"
    log "Initial external IP: ${current_ip}"
  elif [ "$current_ip" != "$LAST_IP" ]; then
    log "IP changed: ${LAST_IP} -> ${current_ip}"

    container_id=$(find_livekit_container) || true
    if [ -z "$container_id" ]; then
      log "ERROR: Could not find container for service '${LIVEKIT_CONTAINER}'"
    else
      short_id=$(echo "$container_id" | cut -c1-12)
      log "Restarting LiveKit container ${short_id}..."
      if restart_container "$container_id"; then
        log "LiveKit container restarted successfully"
        LAST_IP="$current_ip"
      else
        log "ERROR: Failed to restart LiveKit container"
      fi
    fi
  else
    log "IP unchanged: ${current_ip}"
  fi

  sleep "$CHECK_INTERVAL"
done
