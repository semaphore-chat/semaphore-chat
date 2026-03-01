#!/bin/sh
set -e

if [ "${SKIP_PRISMA_MIGRATE:-false}" = "true" ]; then
  echo "Skipping Prisma migrate (SKIP_PRISMA_MIGRATE=true)"
else
  max_retries="${PRISMA_MIGRATE_RETRIES:-5}"
  delay="${PRISMA_MIGRATE_RETRY_DELAY:-5}"
  attempt=1

  while [ "$attempt" -le "$max_retries" ]; do
    echo "Running Prisma migrate deploy (attempt ${attempt}/${max_retries})..."
    if /app/node_modules/.bin/prisma migrate deploy --schema=prisma/schema.prisma; then
      echo "Prisma migrate deploy complete."
      break
    fi

    if [ "$attempt" -eq "$max_retries" ]; then
      echo "Prisma migrate deploy failed after ${max_retries} attempts."
      exit 1
    fi

    echo "Retrying in ${delay}s..."
    attempt=$((attempt + 1))
    sleep "$delay"
  done
fi

exec "$@"
