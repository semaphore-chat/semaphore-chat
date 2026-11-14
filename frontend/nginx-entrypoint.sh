#!/bin/sh
# Entrypoint of the production frontend image (frontend/Dockerfile.prod).
set -e

# Replace placeholders in JS files with runtime env vars
for file in /usr/share/nginx/html/assets/*.js; do
  if [ -f "$file" ]; then
    sed -i "s|__VITE_APP_VERSION__|${VITE_APP_VERSION:-1.0.0}|g" "$file"
  fi
done

# Proxies whose X-Forwarded-For nginx believes (set_real_ip_from), so rate
# limits and the backend see the real client instead of the proxy in front.
# Unset: private ranges and loopback, where the documented proxies run (a
# proxy on the host or the Docker network, an ingress controller). Empty:
# trust nobody (the frontend port is exposed to clients directly). Public
# clients connecting directly are never trusted either way.
TRUSTED_PROXIES="${TRUSTED_PROXIES-127.0.0.0/8 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 100.64.0.0/10 ::1/128 fc00::/7}"
REAL_IP_CONF=/tmp/nginx/real-ip.conf
mkdir -p /tmp/nginx
: >"$REAL_IP_CONF"
for proxy in $(echo "$TRUSTED_PROXIES" | tr ',' ' '); do
  case "$proxy" in
    *[!0-9A-Fa-f:./]*)
      echo "TRUSTED_PROXIES: '$proxy' is not an IP address or CIDR" >&2
      exit 1
      ;;
  esac
  echo "set_real_ip_from $proxy;" >>"$REAL_IP_CONF"
done
if [ -s "$REAL_IP_CONF" ]; then
  printf 'real_ip_header X-Forwarded-For;\nreal_ip_recursive on;\n' >>"$REAL_IP_CONF"
fi

# Substitute nginx environment variables
export BACKEND_URL=${BACKEND_URL:-http://backend:3000}
envsubst "\$BACKEND_URL" < /etc/nginx/nginx.conf.template > /tmp/nginx.conf

# Run nginx from /tmp config (non-root friendly)
exec nginx -c /tmp/nginx.conf -g "daemon off; pid /tmp/nginx.pid;"
