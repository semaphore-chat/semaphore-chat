#!/bin/sh
set -e

if [ "${SKIP_PRISMA_DB_PUSH:-false}" = "true" ]; then
  echo "Skipping Prisma db push (SKIP_PRISMA_DB_PUSH=true)"
else
  max_retries="${PRISMA_DB_PUSH_RETRIES:-5}"
  delay="${PRISMA_DB_PUSH_RETRY_DELAY:-5}"
  attempt=1

  while [ "$attempt" -le "$max_retries" ]; do
    echo "Running Prisma db push (attempt ${attempt}/${max_retries})..."
    if /app/node_modules/.bin/prisma db push --schema=prisma/schema.prisma --skip-generate; then
      echo "Prisma db push complete."
      break
    fi

    if [ "$attempt" -eq "$max_retries" ]; then
      echo "Prisma db push failed after ${max_retries} attempts."
      exit 1
    fi

    echo "Retrying in ${delay}s..."
    attempt=$((attempt + 1))
    sleep "$delay"
  done
fi

exec "$@"
