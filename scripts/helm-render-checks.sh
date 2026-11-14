#!/usr/bin/env bash
#
# Render checks for the Helm chart (helm/semaphore-chat), run with `helm
# template` in a container: no cluster, nothing is installed.
#
# Each case renders the chart with some values and asserts that it fails
# with a given message, or that the output does / doesn't contain something.
# The chart's Bitnami dependencies are fetched into a temporary copy of the
# chart (network needed, like `helm dependency build` in helm-publish.yml).
#
# Usage: scripts/helm-render-checks.sh        (exit 0 = every case passed)
#        CHART_DIR=/path/to/chart scripts/helm-render-checks.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HELM_IMAGE="${HELM_IMAGE:-alpine/helm:3.22.0}"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
# CHART_DIR: another copy of the chart, e.g. an older revision to compare
cp -r "${CHART_DIR:-$ROOT/helm/semaphore-chat}" "$WORK/chart"
rm -rf "$WORK/chart/charts"

cat >"$WORK/cases.sh" <<'CASES'
set -u
cd /work
helm repo add bitnami https://charts.bitnami.com/bitnami >/dev/null
helm dependency build chart >/dev/null || { echo "FAIL: helm dependency build"; exit 1; }

# Valid secrets: 44+ random characters, all different.
JWT=Q2hhbmdlZEluVGhlUmVuZGVyQ2hlY2tzT25seUFhYWFhYWE=
REFRESH=UmVmcmVzaFNlY3JldEZvclJlbmRlckNoZWNrc0JiYmJiYmI=
LKSECRET=6c6976656b69742d7265616c2d7365637265742d666f722d636865636b73
PGPASS='p@ss/w:rd?with&chars'
REDISPASS=cmVkaXMtcGFzc3dvcmQtZm9yLXJlbmRlci1jaGVja3M
VALID="--set secrets.jwtSecret=$JWT --set secrets.jwtRefreshSecret=$REFRESH
  --set livekit.url=wss://lk.chat.test --set livekit.apiKey=APIk3y --set livekit.apiSecret=$LKSECRET
  --set-string postgresql.auth.password=$PGPASS --set redis.auth.password=$REDISPASS"

PASS=0
FAILED=0
pass() { PASS=$((PASS + 1)); echo "ok   - $1"; }
fail() { FAILED=$((FAILED + 1)); echo "FAIL - $1"; [ -n "${2:-}" ] && echo "$2" | head -20 | sed 's/^/       /'; }

render() { helm template t chart "$@" 2>&1; }

# The rendered document of a kind whose name ends in a suffix.
doc() { # doc <kind> <name-suffix>   (reads the render on stdin)
  awk -v kind="$1" -v suffix="$2" '
    /^---/ { if (match_kind && match_name) printf "%s", buf; buf=""; match_kind=0; match_name=0; next }
    { buf = buf $0 "\n" }
    $0 == "kind: " kind { match_kind=1 }
    /^  name: / { n=$2; if (substr(n, length(n)-length(suffix)+1) == suffix) match_name=1 }
    END { if (match_kind && match_name) printf "%s", buf }'
}

expect_fail() { # expect_fail <name> <message-regex> <helm args...>
  name=$1; pattern=$2; shift 2
  out=$(render "$@"); code=$?
  if [ $code -ne 0 ] && echo "$out" | grep -Eq "$pattern"; then pass "$name"
  else fail "$name (exit $code, wanted /$pattern/)" "$out"; fi
}

expect_ok() { # expect_ok <name> <helm args...>; leaves the render in $OUT
  name=$1; shift
  OUT=$(render "$@"); code=$?
  if [ $code -eq 0 ]; then pass "$name"; else fail "$name (exit $code)" "$OUT"; OUT=""; fi
}

check() { # check <name> <command...>: passes when the command succeeds
  name=$1; shift
  if "$@"; then pass "$name"; else fail "$name"; fi
}

has() { echo "$1" | grep -Eq -- "$2"; }
lacks() { ! echo "$1" | grep -Eq -- "$2"; }

# ---------------------------------------------------------------- OPS-1 secrets
expect_fail "defaults fail (no JWT secrets)" 'secrets.jwtSecret is empty' \
  --set-string postgresql.auth.password=$PGPASS --set redis.auth.password=$REDISPASS
for placeholder in CHANGE-ME-long-random-secret-for-jwt-signing replace-with-a-long-random-string \
  'some long elaborate secret that you really need to change'; do
  expect_fail "jwtSecret placeholder '$placeholder' fails" 'secrets.jwtSecret is a published placeholder' \
    $VALID --set "secrets.jwtSecret=$placeholder"
done
expect_fail "jwtRefreshSecret under 32 characters fails" 'secrets.jwtRefreshSecret is shorter than 32' \
  $VALID --set secrets.jwtRefreshSecret=short-but-random-9f8e7d
expect_fail "equal JWT secrets fail" 'are the same value' $VALID --set secrets.jwtRefreshSecret=$JWT
expect_fail "LiveKit placeholder secret fails" 'livekit.apiSecret is a published placeholder' \
  $VALID --set livekit.apiSecret=your-livekit-api-secret
expect_fail "LiveKit dev pair fails" 'livekit.apiSecret is a published placeholder' \
  $VALID --set livekit.apiKey=devkey --set livekit.apiSecret=secret-that-is-at-least-32-characters-long
expect_fail "partial LiveKit config fails" 'livekit.url, livekit.apiKey and livekit.apiSecret together' \
  $VALID --set livekit.url=
expect_ok "valid secrets render" $VALID
expect_ok "no LiveKit at all renders" $VALID --set livekit.url= --set livekit.apiKey= --set livekit.apiSecret=
expect_ok "secrets.existingSecret skips the secret values" \
  --set secrets.existingSecret=my-secrets --set-string postgresql.auth.password=$PGPASS \
  --set redis.auth.password=$REDISPASS
check "existingSecret: chart's own -secrets Secret not rendered" lacks "$OUT" 'name: t-semaphore-chat-secrets$'
CASES

cat >>"$WORK/cases.sh" <<'CASES'

# ---------------------------------------------------------------- OPS-2 DATABASE_URL
for mode in install upgrade; do
  flag=""; [ $mode = upgrade ] && flag="--is-upgrade"
  expect_ok "bundled DB renders ($mode)" $VALID $flag
  cm=$(echo "$OUT" | doc ConfigMap -backend-config)
  db=$(echo "$OUT" | doc Secret -database)
  dep=$(echo "$OUT" | doc Deployment -backend)
  job=$(echo "$OUT" | doc Job -backend-migrate)
  check "$mode: ConfigMap has no DATABASE_URL" lacks "$cm" 'DATABASE_URL|postgresql://'
  check "$mode: database Secret holds the URL, password URL-encoded" has "$db" 'DATABASE_URL: "postgresql://semaphore:p%40ss%2Fw%3Ard%3Fwith%26chars@t-semaphore-chat-postgresql:5432/semaphore"'
  check "$mode: database Secret exists before the migration hook" has "$db" 'helm.sh/hook"?: pre-install,pre-upgrade'
  check "$mode: backend reads DATABASE_URL from the Secret" has "$dep" 'name: t-semaphore-chat-database'
  check "$mode: migration job reads DATABASE_URL from the Secret" has "$job" 'name: t-semaphore-chat-database'
  check "$mode: migration job needs no non-hook ConfigMap/Secret" lacks "$job" 'configMapRef|secretRef'
done
expect_ok "secrets.existingSecret still gets the database Secret" \
  --set secrets.existingSecret=my-secrets --set-string postgresql.auth.password=$PGPASS --set redis.auth.password=$REDISPASS
check "existingSecret: database Secret rendered" has "$(echo "$OUT" | doc Secret -database)" 'DATABASE_URL'
expect_ok "external DB URI renders" $VALID --set postgresql.bundled=false \
  --set postgresql.external.uri=postgresql://app:s3cret@db.internal:5432/chat
check "external URI: in the database Secret" has "$(echo "$OUT" | doc Secret -database)" 'postgresql://app:s3cret@db.internal'
check "external URI: not in any ConfigMap" lacks "$(echo "$OUT" | doc ConfigMap -backend-config)" 's3cret'
expect_ok "external DB existingSecret renders" $VALID --set postgresql.bundled=false \
  --set postgresql.external.existingSecret=pg-creds --set postgresql.external.existingSecretKey=url
check "external existingSecret: no chart database Secret" lacks "$OUT" 'name: t-semaphore-chat-database$'
check "external existingSecret: backend uses it" has "$(echo "$OUT" | doc Deployment -backend)" 'name: pg-creds'
check "external existingSecret: with its key" has "$(echo "$OUT" | doc Deployment -backend)" 'key: url'
expect_fail "external DB without a URI or secret fails" 'postgresql.external.uri or postgresql.external.existingSecret' \
  $VALID --set postgresql.bundled=false

# ---------------------------------------------------------------- OPS-12 hardening
expect_fail "default Redis password fails" 'redis.auth.password' \
  $VALID --set redis.auth.password=changeme-redis-password
expect_fail "empty Redis password fails" 'redis.auth.password' $VALID --set redis.auth.password=
expect_ok "Redis auth off needs no password" $VALID --set redis.auth.enabled=false --set redis.auth.password=
expect_fail "empty bundled PostgreSQL password fails" 'postgresql.auth.password' \
  $VALID --set-string postgresql.auth.password=
expect_ok "networkPolicy off renders no NetworkPolicy" $VALID
check "networkPolicy off: none of the chart's own" lacks "$OUT" 'name: t-semaphore-chat-[a-z]+-ingress$'
expect_ok "networkPolicy on renders" $VALID --set networkPolicy.enabled=true
np_backend=$(echo "$OUT" | doc NetworkPolicy -backend-ingress)
np_pg=$(echo "$OUT" | doc NetworkPolicy -semaphore-chat-postgresql-ingress)
np_redis=$(echo "$OUT" | doc NetworkPolicy -semaphore-chat-redis-ingress)
check "networkPolicy: backend policy" has "$np_backend" 'app.kubernetes.io/component: backend'
check "networkPolicy: backend admits the frontend" has "$np_backend" 'app.kubernetes.io/component: frontend'
check "networkPolicy: backend admits the ingress namespace" has "$np_backend" 'kubernetes.io/metadata.name: ingress-nginx'
check "networkPolicy: frontend policy" has "$(echo "$OUT" | doc NetworkPolicy -frontend-ingress)" 'port: 5173'
check "networkPolicy: PostgreSQL only from the backend" has "$np_pg" 'port: 5432'
check "networkPolicy: PostgreSQL policy selects its pods" has "$np_pg" 'app.kubernetes.io/name: postgresql'
check "networkPolicy: Redis only from the backend" has "$np_redis" 'port: 6379'
check "networkPolicy: ingress only (no egress rules)" lacks "$np_backend$np_pg$np_redis" 'Egress'
expect_ok "networkPolicy with external DB/Redis" $VALID --set networkPolicy.enabled=true \
  --set postgresql.bundled=false --set postgresql.external.uri=postgresql://a:b@db:5432/c \
  --set redis.bundled=false --set redis.external.host=redis.internal
check "external: no PostgreSQL/Redis policies" lacks "$OUT" 'name: t-semaphore-chat-(postgresql|redis)-ingress$'
# NOTES.txt: helm template doesn't render it, so a copy as YAML comments does.
sed 's/^/# /' chart/templates/NOTES.txt > chart/templates/zz-notes-check.yaml
notes() { helm template t chart --show-only templates/zz-notes-check.yaml "$@" 2>&1; }
OUT=$(notes $VALID --set networkPolicy.enabled=true)
check "NOTES warn about Bitnami allowExternal" has "$OUT" 'allowExternal=false'
OUT=$(notes $VALID --set networkPolicy.enabled=true \
  --set postgresql.primary.networkPolicy.allowExternal=false --set redis.networkPolicy.allowExternal=false)
check "NOTES quiet once allowExternal=false" lacks "$OUT" 'still admit every pod'
check "NOTES render" has "$OUT" 'Thank you for installing'

# ---------------------------------------------------------------- OPS-7 trusted proxies
expect_ok "frontend trustedProxies unset (ingress, ClusterIP)" $VALID
check "trustedProxies unset behind the ingress: private ranges" has "$(echo "$OUT" | doc Deployment -frontend)" 'value: "10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 100.64.0.0/10 fc00::/7"'
expect_ok "frontend trustedProxies unset, no ingress" $VALID --set ingress.enabled=false
check "trustedProxies unset, no ingress: trust nobody (no env)" lacks "$(echo "$OUT" | doc Deployment -frontend)" 'TRUSTED_PROXIES'
expect_ok "frontend trustedProxies unset, LoadBalancer" $VALID --set frontend.service.type=LoadBalancer
check "trustedProxies unset, LoadBalancer: trust nobody (no env)" lacks "$(echo "$OUT" | doc Deployment -frontend)" 'TRUSTED_PROXIES'
expect_ok "frontend trustedProxies empty" $VALID --set-string frontend.trustedProxies=
check "trustedProxies empty: trust nobody" has "$(echo "$OUT" | doc Deployment -frontend)" 'value: ""'
expect_ok "frontend trustedProxies set" $VALID --set-string frontend.trustedProxies=10.42.0.0/16
check "trustedProxies set: passed on" has "$(echo "$OUT" | doc Deployment -frontend)" 'value: "10.42.0.0/16"'

echo
echo "$PASS passed, $FAILED failed"
[ "$FAILED" -eq 0 ]
CASES

docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -v "$WORK:/work" \
  --entrypoint sh "$HELM_IMAGE" /work/cases.sh
