# Semaphore Chat Backend

NestJS backend for Semaphore Chat — a self-hosted voice and text chat application.

## Development

All development uses Docker. See the root [CLAUDE.md](../CLAUDE.md) for commands.

```bash
# Start all services
docker-compose up

# Run tests
docker compose run --rm backend pnpm run test

# Lint
docker compose run --rm backend pnpm run lint
```

From a git worktree, use `scripts/test-stack.sh <ticket> run-backend <cmd>` (or `run` for a per-ticket Postgres, Redis and MinIO) instead of `docker compose run`; see the root CLAUDE.md.

## License

[AGPL-3.0-only](../LICENSE)
