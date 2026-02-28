#!/bin/sh
set -e

echo "Running Prisma db push..."
npx prisma db push --schema=prisma/schema.prisma --skip-generate
echo "Prisma db push complete."

exec "$@"
