#!/usr/bin/env bash
#
# Fails if the current environment is missing, or has a different value for,
# any variable a service sets in docker-compose.e2e.yml.
#
# The `e2e` job in .github/workflows/e2e-tests.yml runs the backend-test and
# frontend-test processes directly on the runner, with a copy of their compose
# environment. This keeps that copy from drifting. The compose hostnames of the
# database and Redis (postgres-test, redis-test) become localhost, where the
# job's service containers are published. Variables the job sets on top of the
# compose ones (e.g. PORT) are not checked.
#
# Usage (needs docker and jq): scripts/check-e2e-env.sh <compose-service>
set -euo pipefail

service="${1:?usage: scripts/check-e2e-env.sh <compose-service>}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

expected="$(
  docker compose -f "$root/docker-compose.e2e.yml" config --format json |
    jq -r --arg s "$service" '
      (.services[$s] // error("no service \($s) in docker-compose.e2e.yml"))
      | .environment // {}
      | to_entries[]
      | select(.value != null)
      | "\(.key)=\(.value | gsub("\\b(postgres-test|redis-test)\\b"; "localhost"))"'
)"

status=0
checked=0
while IFS= read -r line; do
  [ -n "$line" ] || continue
  key="${line%%=*}"
  want="${line#*=}"
  checked=$((checked + 1))
  if [ -z "${!key+set}" ]; then
    echo "::error::$key is set for $service in docker-compose.e2e.yml ('$want') but not in this job"
    status=1
  elif [ "${!key}" != "$want" ]; then
    echo "::error::$key should be '$want' ($service in docker-compose.e2e.yml, compose hostnames as localhost), but this job has '${!key}'"
    status=1
  fi
done <<<"$expected"

if [ "$status" -eq 0 ]; then
  echo "$service: all $checked variables from docker-compose.e2e.yml match."
fi
exit "$status"
