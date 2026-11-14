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
# Opt-in: unset or empty trusts nobody, and nginx uses the address of the
# peer that connected (behind a proxy, every client then shares the proxy's
# rate-limit bucket). Set it only when a proxy is in front and clients cannot
# reach this port directly: a client that can, from a trusted address, could
# put any address in X-Forwarded-For.
TRUSTED_PROXIES="${TRUSTED_PROXIES:-}"
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
