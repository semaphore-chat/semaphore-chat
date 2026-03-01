# Development Setup

All development is done through Docker — never run `pnpm`/`npm` commands directly on the host.

## Prerequisites

- **[Docker](https://docs.docker.com/get-docker/)** (v20+) and **Docker Compose** (v2+)
- **[Git](https://git-scm.com/)**

## Starting the dev environment

```bash
git clone https://github.com/krakenchat/kraken.git
cd kraken
cp backend/env.sample backend/.env
docker-compose up
```

This starts all services with hot reload — changes to `backend/` and `frontend/` are automatically picked up.

| Service | URL |
|---------|-----|
| Frontend | [http://localhost:5173](http://localhost:5173) |
| Backend API | [http://localhost:3000](http://localhost:3000) |
| PostgreSQL | `localhost:5432` |
| Redis | `localhost:6379` |

## Common commands

### Backend

```bash
# Open a shell in the backend container
docker compose run --rm backend bash

# Run tests
docker compose run --rm backend pnpm run test

# Run a single test file
docker compose run --rm backend pnpm exec jest <test-pattern>

# Lint
docker compose run --rm backend pnpm run lint

# Build
docker compose run --rm backend pnpm run build
```

### Frontend

```bash
# Open a shell in the frontend container
docker compose run --rm frontend bash

# Lint
docker compose run --rm frontend pnpm run lint

# Build
docker compose run --rm frontend pnpm run build

# Run tests
docker compose run --rm frontend pnpm run test
```

### Database (Prisma)

```bash
# Generate Prisma client + push schema (combined)
docker compose run --rm backend pnpm run prisma

# Generate Prisma client only
docker compose run --rm backend pnpm run prisma:generate

# Run migrations
docker compose run --rm backend pnpm run prisma:migrate

# Create a new migration after schema changes
docker compose run --rm backend pnpm run prisma:migrate:dev

# Open Prisma Studio (database browser)
docker compose run --rm -p 5555:5555 backend npx prisma studio
```

### Docker

```bash
# Start all services in background
docker-compose up -d

# Stop all services
docker-compose down

# View logs for a specific service
docker-compose logs backend -f

# Rebuild containers (after Dockerfile changes)
docker-compose build --no-cache

# Full reset (removes all data)
docker-compose down -v && docker-compose build --no-cache && docker-compose up
```

## Regenerating the API client

When backend controllers or DTOs change, regenerate the frontend API client:

```bash
# 1. Generate the OpenAPI spec
docker compose run --rm backend pnpm run generate:openapi

# 2. Regenerate the frontend SDK
docker compose run --rm frontend sh -c 'OPENAPI_SPEC_PATH=/spec/openapi.json pnpm exec openapi-ts'
```

The backend directory is mounted at `/spec` inside the frontend container. The generated client goes to `frontend/src/api-client/` (gitignored — regenerated at build time).

!!! note
    Always use generated SDK functions (e.g., `voicePresenceControllerJoinPresence(...)`) instead of raw `client.post()` calls.

## Testing

### Backend tests

- Framework: Jest with `@suites/unit` TestBed automocks
- Test files: `*.spec.ts` alongside source files
- E2E tests: `backend/test/` directory

```bash
docker compose run --rm backend pnpm run test        # All unit tests
docker compose run --rm backend pnpm run test:e2e     # E2E tests
docker compose run --rm backend pnpm run test -- --coverage  # With coverage
```

### Frontend tests

- Framework: Vitest + jsdom + Testing Library + MSW v2
- Test files: `frontend/src/__tests__/`

```bash
docker compose run --rm frontend pnpm run test       # All tests
docker compose run --rm frontend pnpm run test:cov   # With coverage
```

## Project structure

```
kraken/
├── backend/
│   ├── src/           # NestJS application (modules, services, controllers)
│   ├── prisma/        # Database schema (single schema.prisma for PostgreSQL)
│   └── test/          # E2E tests
├── frontend/
│   ├── src/           # React application
│   └── electron/      # Electron desktop app
├── shared/            # Shared types and utilities (mounted in both containers)
├── helm/              # Kubernetes Helm chart
├── docs-site/         # Documentation site (MkDocs Material)
└── docker-compose.yml
```

## Troubleshooting

### Services not starting

```bash
docker-compose down
docker-compose build --no-cache
docker-compose up
```

### Database connection issues

Check that the PostgreSQL container is healthy:

```bash
docker-compose ps
```

### Port conflicts

Ensure ports 3000, 5173, 5432, and 6379 are available. Stop any conflicting services or change the ports in `docker-compose.yml`.
