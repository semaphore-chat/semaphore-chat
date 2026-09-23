# E2E Tests

End-to-end tests using Playwright to verify critical user flows.

> **Voice / LiveKit E2E** (real audio/video over a real LiveKit server,
> multi-participant, no second human) lives in [`voice/`](./voice/README.md) and
> runs as a separate Playwright `voice` project via `scripts/run-voice-e2e.sh`.
> See that README for running, the available fixtures/hooks, and **how to add a
> spec for a new voice feature**.

## Quick Start

### Run in Docker (Recommended)

This runs tests in complete isolation with a fresh database:

```bash
# From project root
./scripts/run-e2e.sh

# Or from frontend directory
npm run test:e2e:docker
```

### Options

```bash
# Run all browsers (Chrome, Firefox, Safari, Mobile)
./scripts/run-e2e.sh --all
npm run test:e2e:docker:all

# Run with Playwright UI (interactive debugging)
./scripts/run-e2e.sh --ui
npm run test:e2e:docker:ui

# Run with visible browser
./scripts/run-e2e.sh --headed

# Run specific test file
./scripts/run-e2e.sh auth
./scripts/run-e2e.sh messaging

# Clean up Docker containers
./scripts/run-e2e.sh --clean
npm run test:e2e:docker:clean
```

### Local Development (Against Running Containers)

If you already have `docker-compose up` running:

```bash
cd frontend
npm run test:e2e              # Run all tests
npm run test:e2e:chromium     # Chrome only (fastest)
npm run test:e2e:ui           # Interactive UI mode
npm run test:e2e:debug        # Debug mode
npm run test:e2e:report       # View HTML report
```

## Test Structure

```
e2e/
├── fixtures/
│   ├── auth.fixture.ts    # Authentication helpers
│   ├── test-data.ts       # Test data setup/teardown
│   └── index.ts           # Re-exports
├── auth.spec.ts           # Login, register, logout tests
├── community.spec.ts      # Community management tests
├── messaging.spec.ts      # Messaging and channel tests
├── mobile.spec.ts         # Mobile UX and PWA tests
├── voice/                 # Real-LiveKit voice E2E (own project + README)
└── README.md              # This file
```

## Test Credentials

When running with `./scripts/run-e2e.sh`, the database is seeded with:

| Username   | Password      | Role  |
|------------|---------------|-------|
| testuser   | Test123!@#    | USER  |
| testuser2  | Test123!@#    | USER  |
| admin      | Admin123!@#   | ADMIN |

Invite code: `test-invite`

## Browser Coverage

| Project       | Device          |
|---------------|-----------------|
| chromium      | Desktop Chrome  |
| firefox       | Desktop Firefox |
| webkit        | Desktop Safari  |
| mobile-chrome | Pixel 5         |
| mobile-safari | iPhone 12       |

## Viewing Reports

After tests complete:

```bash
npm run test:e2e:report
```

Reports are saved to `playwright-report/` and `test-results/`.

## CI/CD

Tests run automatically on:
- All pull requests: `@smoke` tests only, or the full suite if the PR has the `e2e-full` label
- Push to `main`, the nightly schedule and manual dispatch: the full suite

CI builds no Docker images for this. Postgres and Redis run as GitHub Actions
service containers, and the backend (`pnpm run start:dev`) and frontend (Vite
with `vite.config.e2e.ts`) run directly on the runner, with the same
environment, ports (3001 / 5174), migrations and seed as
`docker-compose.e2e.yml`. If you change that file's backend-test or
frontend-test environment, update the `e2e` job to match: the job runs
`scripts/check-e2e-env.sh`, which fails it if the two differ.

See `.github/workflows/e2e-tests.yml` for configuration.

## Troubleshooting

### Tests timeout waiting for elements

- Check that the app is rendering correctly
- Use `--headed` to see what's happening
- Use `--ui` for interactive debugging

### Docker containers won't start

```bash
# Clean up and rebuild
./scripts/run-e2e.sh --clean
docker compose -p kraken-e2e -f docker-compose.e2e.yml build --no-cache
```

If the e2e Postgres port (5433) collides with something already running on your
host, override it:

```bash
E2E_POSTGRES_PORT=5533 ./scripts/run-e2e.sh
```

### Database seed fails

```bash
# Check backend logs
docker compose -p kraken-e2e -f docker-compose.e2e.yml logs backend-test
```

### Browser not installed

```bash
cd frontend
npx playwright install --with-deps
```
