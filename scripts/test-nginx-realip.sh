#!/usr/bin/env bash
#
# Checks the production frontend nginx (frontend/nginx.conf, run by
# frontend/nginx-entrypoint.sh) behind a proxy: per-client rate limits,
# the client address and scheme the backend sees, and that X-Forwarded-For
# is ignored from untrusted peers.
#
# Runs nginx:1.31-alpine containers (the image's base) on the shared
# `semaphore-test` network (scripts/test-net.sh): an echo "backend", the
# frontend nginx with TRUSTED_PROXIES set to the private ranges (the client
# is a trusted proxy), one with the image default (unset: trust nobody), one
# trusting only an address the client doesn't have (untrusted peer), and a
# client that plays the outer proxy. The containers are removed on exit; no
# network is created.
#
# Usage: scripts/test-nginx-realip.sh     (exit 0 = every check passed)
#        FRONTEND_DIR=/path/to/frontend scripts/test-nginx-realip.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_DIR="${FRONTEND_DIR:-$ROOT/frontend}"
IMAGE=nginx:1.31-alpine
NET=semaphore-test
P="nginx-realip-$$"

"$ROOT/scripts/test-net.sh"

WORK="$(mktemp -d)"
cleanup() {
  docker rm -f "$P-echo" "$P-fe" "$P-fe-default" "$P-fe-other" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT INT TERM

mkdir -p "$WORK/html"
echo '<!doctype html><title>t</title>' >"$WORK/html/index.html"
cat >"$WORK/echo.conf" <<'EOF'
events {}
http {
  server {
    listen 3000;
    location / {
      return 200 "xff=$http_x_forwarded_for proto=$http_x_forwarded_proto upgrade=$http_upgrade\n";
    }
  }
}
EOF

docker run -d --name "$P-echo" --network "$NET" \
  -v "$WORK/echo.conf:/etc/nginx/nginx.conf:ro" "$IMAGE" >/dev/null

start_frontend() { # start_frontend <name> [docker run args...]
  local name=$1
  shift
  local entry=(sh -c 'envsubst "\$BACKEND_URL" < /etc/nginx/nginx.conf.template > /tmp/nginx.conf && mkdir -p /tmp/nginx && exec nginx -c /tmp/nginx.conf -g "daemon off; pid /tmp/nginx.pid;"')
  local mounts=(-v "$FRONTEND_DIR/nginx.conf:/etc/nginx/nginx.conf.template:ro" -v "$WORK/html:/usr/share/nginx/html:ro")
  if [[ -f "$FRONTEND_DIR/nginx-entrypoint.sh" ]]; then
    mounts+=(-v "$FRONTEND_DIR/nginx-entrypoint.sh:/nginx-entrypoint.sh:ro")
    entry=(sh /nginx-entrypoint.sh)
  fi
  docker run -d --name "$name" --network "$NET" -e "BACKEND_URL=http://$P-echo:3000" \
    "${mounts[@]}" "$@" "$IMAGE" "${entry[@]}" >/dev/null
}
start_frontend "$P-fe" -e "TRUSTED_PROXIES=127.0.0.0/8 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 100.64.0.0/10 ::1/128 fc00::/7"
start_frontend "$P-fe-default"
start_frontend "$P-fe-other" -e "TRUSTED_PROXIES=198.51.100.7, 2001:db8::/32"

# Every client request runs in one container (the "outer proxy", whose
# address on the Docker network is a private one). Prints one line per check.
docker run --rm --network "$NET" -e FE="$P-fe" -e FE2="$P-fe-default" -e FE3="$P-fe-other" "$IMAGE" sh -c '
get() { # get <url> [header...]: prints "<status> <body>"
  url=$1; shift
  out=$(wget -S -q -O - "$@" "$url" 2>/tmp/h) || true
  status=$(grep -m1 "HTTP/" /tmp/h | awk "{print \$2}")
  echo "${status:-000} $out"
}
for _ in $(seq 1 50); do wget -q -O /dev/null "http://$FE:5173/health" 2>/dev/null && wget -q -O /dev/null "http://$FE2:5173/health" 2>/dev/null && wget -q -O /dev/null "http://$FE3:5173/health" 2>/dev/null && break; sleep 0.2; done

# 1. Client A floods /api/ (10 r/s, burst 20) through the proxy.
limited=0
for _ in $(seq 1 60); do
  s=$(get "http://$FE:5173/api/x" --header "X-Forwarded-For: 203.0.113.10" | cut -d" " -f1)
  [ "$s" = 503 ] && limited=$((limited + 1))
done
echo "check flood-limited $([ $limited -gt 0 ] && echo pass || echo fail) (A got $limited x 503)"

# 2. Client B, same proxy, right after: not limited by A.
r=$(get "http://$FE:5173/api/x" --header "X-Forwarded-For: 203.0.113.20")
echo "check other-client-not-limited $([ "${r%% *}" = 200 ] && echo pass || echo fail) ($r)"
echo "check backend-sees-client $(echo "$r" | grep -q "xff=203.0.113.20 " && echo pass || echo fail) ($r)"

# 3. A client-made chain: only the address the proxy saw counts.
r=$(get "http://$FE:5173/api/x" --header "X-Forwarded-For: 6.6.6.6, 203.0.113.30")
echo "check spoofed-chain-ignored $(echo "$r" | grep -q "xff=203.0.113.30 " && echo pass || echo fail) ($r)"

# 4. Page loads (/) are limited per client too.
for _ in $(seq 1 120); do get "http://$FE:5173/" --header "X-Forwarded-For: 203.0.113.40" >/dev/null; done
r=$(get "http://$FE:5173/" --header "X-Forwarded-For: 203.0.113.50")
echo "check pages-per-client $([ "${r%% *}" = 200 ] && echo pass || echo fail) (${r%% *})"

# 5. Image default (TRUSTED_PROXIES unset): X-Forwarded-For is not believed;
#    the backend gets the peer address.
r=$(get "http://$FE2:5173/api/x" --header "X-Forwarded-For: 203.0.113.60")
echo "check default-xff-ignored $(echo "$r" | grep -q "xff=203.0.113.60" && echo fail || echo pass) ($r)"
echo "check default-peer-address $(echo "$r" | grep -Eq "xff=[0-9a-f.:]+ " && echo pass || echo fail) ($r)"

# 5b. Default: spoofed addresses do not get fresh rate-limit buckets.
limited=0
for i in $(seq 1 60); do
  s=$(get "http://$FE2:5173/api/x" --header "X-Forwarded-For: 203.0.113.$i" | cut -d" " -f1)
  [ "$s" = 503 ] && limited=$((limited + 1))
done
echo "check default-no-bucket-per-spoofed-ip $([ $limited -gt 0 ] && echo pass || echo fail) ($limited x 503)"

# 5c. TRUSTED_PROXIES set, but the peer is not in it: not believed.
r=$(get "http://$FE3:5173/api/x" --header "X-Forwarded-For: 203.0.113.61")
echo "check untrusted-peer-xff-ignored $(echo "$r" | grep -q "xff=203.0.113.61" && echo fail || echo pass) ($r)"

# 6. Scheme: the outer proxy`s X-Forwarded-Proto passes through, else http.
r=$(get "http://$FE:5173/api/x" --header "X-Forwarded-For: 203.0.113.70" --header "X-Forwarded-Proto: https")
echo "check proto-forwarded $(echo "$r" | grep -q "proto=https" && echo pass || echo fail) ($r)"
r=$(get "http://$FE:5173/api/x" --header "X-Forwarded-For: 203.0.113.71")
echo "check proto-default-http $(echo "$r" | grep -q "proto=http " && echo pass || echo fail) ($r)"

# 7. The Socket.IO path still proxies the WebSocket upgrade.
r=$(get "http://$FE:5173/socket.io/?EIO=4" --header "X-Forwarded-For: 203.0.113.80" --header "Upgrade: websocket" --header "Connection: Upgrade")
echo "check socketio-upgrade $(echo "$r" | grep -q "upgrade=websocket" && echo "$r" | grep -q "xff=203.0.113.80 " && echo pass || echo fail) ($r)"
' | tee "$WORK/results"

passed=$(grep -c ' pass ' "$WORK/results" || true)
failed=$(grep -c ' fail ' "$WORK/results" || true)
echo
echo "$passed passed, $failed failed"
[[ "$failed" -eq 0 && "$passed" -gt 0 ]]
