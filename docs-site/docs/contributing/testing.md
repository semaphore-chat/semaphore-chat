# Testing Guide

!!! note "Main checkout or git worktree?"
    The `docker compose run` commands on this page (and elsewhere in these docs)
    use the dev stack's compose project, so run them from the main checkout.
    From a git worktree, use the `scripts/test-stack.sh` equivalents in
    [Test Stacks and the Shared Docker Network](#test-stacks-and-the-shared-docker-network),
    e.g. `scripts/test-stack.sh <ticket> run-backend pnpm run test`.

## Backend Tests

**Stack**: Jest + `@suites/unit` TestBed automocks

Test files live alongside source files as `*.spec.ts`. E2E tests are in `backend/test/`.

```bash
# All unit tests
docker compose run --rm backend pnpm run test

# E2E tests
docker compose run --rm backend pnpm run test:e2e

# Single test file
docker compose run --rm backend pnpm run test <test-pattern>

# With coverage
docker compose run --rm backend pnpm run test -- --coverage
```

### Backend Test Patterns

`@suites/unit` auto-mocks all dependencies injected into the service under test:

```typescript
import { TestBed } from '@suites/unit';

describe('MessagesService', () => {
  let service: MessagesService;
  let prisma: Mocked<DatabaseService>;

  beforeAll(async () => {
    const { unit, unitRef } = await TestBed.create(MessagesService).compile();
    service = unit;
    prisma = unitRef.get(DatabaseService);
  });

  it('should create a message', async () => {
    prisma.message.create.mockResolvedValue(mockMessage);
    const result = await service.create(dto);
    expect(result).toEqual(mockMessage);
  });
});
```

### Sensitive User Fields

When creating DTOs that include user data, test with `expectNoSensitiveUserFields()`:

```typescript
import { expectNoSensitiveUserFields } from '@/test-utils';

it('should not expose sensitive fields', () => {
  expectNoSensitiveUserFields(response.user);
});
```

---

## Frontend Tests

**Stack**: Vitest + jsdom + Testing Library + MSW v2

Test files live in `frontend/src/__tests__/` organized by type: `components/`, `hooks/`, `features/`.

```bash
# All tests
docker compose run --rm frontend pnpm run test

# With coverage
docker compose run --rm frontend pnpm run test:cov
```

### In CI

`.github/workflows/frontend-tests.yml` splits the unit tests across three parallel
`Unit Tests (shard k/3)` jobs. A `Unit Tests` job then merges their results into
one summary and prints the coverage table. Lint, type check, build and the
bundle budget run in their own `Lint, Type Check & Build` job. On `main`, a
`Coverage Badge` job pushes the badge once all of these have passed. To
reproduce one shard locally:

```bash
docker compose run --rm frontend pnpm exec vitest run --shard=2/3
```

The shards' coverage is merged by `frontend/scripts/merge-coverage-shards.mjs`,
not by `vitest --merge-reports --coverage`, so the totals match an unsharded
`pnpm run test:cov`. The script explains why.

### Test Infrastructure

Located in `frontend/src/__tests__/test-utils/`:

**`renderWithProviders()`** wraps components with QueryClient, MemoryRouter, ThemeProvider, SocketContext, and NotificationProvider:

```typescript
import { renderWithProviders } from '../test-utils';

it('renders channel list', async () => {
  const { user, queryClient } = renderWithProviders(<ChannelList />);
  // `user` is a userEvent instance for realistic interactions
  await user.click(screen.getByText('general'));
});
```

**`factories.ts`** provides factory functions:

```typescript
import { createMessage, createChannel, createUser, createDmGroup } from '../test-utils/factories';

const message = createMessage({ content: 'hello' });
const channel = createChannel({ name: 'general', type: 'TEXT' });
```

**`msw/handlers.ts`** provides default MSW request handlers for auth, user profile, channels, and DMs. Override per-test with `server.use(...)`.

### Frontend Test Patterns

#### Mock API Client

```typescript
vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await importOriginal();
  return {
    ...await importOriginal(),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});
```

This lets MSW intercept requests from the generated client.

#### Mock Hooks

```typescript
vi.mock('../../hooks/useFoo', () => ({
  useFoo: vi.fn(() => mockValue),
}));
```

!!! warning
    `vi.clearAllMocks()` does **not** reset `mockReturnValue`. If any test overrides a mock, reset it explicitly in `beforeEach`.

#### Mock React Router

```typescript
vi.mock('react-router-dom', async (importOriginal) => ({
  ...await importOriginal(),
  useParams: vi.fn(() => ({ channelId: '123' })),
  useNavigate: vi.fn(() => mockNavigate),
}));
```

#### Test Async Error Flows

```typescript
it('shows error on failure', async () => {
  mockMutationFn.mockRejectedValue(new Error('Network error'));
  const { user } = renderWithProviders(<MyComponent />);

  await user.click(screen.getByRole('button', { name: 'Submit' }));

  expect(await screen.findByText('Network error')).toBeInTheDocument();
});
```

### What to Test

- **Components**: Rendering, user interactions, conditional display
- **Hooks**: State changes, side effects, return values
- **Action functions**: API calls, error handling, cache updates
- **Mock external dependencies** to isolate the unit under test

---

## Test Stacks and the Shared Docker Network

Every dev-stack `docker compose` command in these docs (on this page, in
[Development Setup](development-setup.md), [Code Patterns](code-patterns.md) and
elsewhere) uses the dev stack's compose project, so run it from the main
checkout. For a git worktree, a ticket's own database or several branches side
by side, use `scripts/test-stack.sh`. A worktree needs no `backend/.env`.

**Why:** a compose project creates its own network (`<project>_default`) on its
first `up` or `run`, and `down` removes it. Every network create or remove adds
or removes a `br-*` bridge with an IPv4 address on the host, and Chromium-based
browsers on the same machine treat that as a network change and drop their open
connections. So `docker compose -p <name> ...` from worktrees (or plain
`docker compose run` there, which names the project after the directory) must
not be used, and the dev stack is stopped with `docker compose stop`, not
`down`. All ephemeral test containers join one long-lived network,
`semaphore-test`, which `scripts/test-net.sh` creates once and nothing removes
(don't `docker network rm`, `docker network prune` or `docker system prune`
it). It also keeps an idle `semaphore-test-anchor` container attached, so the
network is never unused and a prune can't delete it.

| Task | Main checkout (dev stack) | Worktree / any other checkout |
|------|---------------------------|-------------------------------|
| Backend unit tests | `docker compose run --rm backend pnpm run test` | `scripts/test-stack.sh <ticket> run-backend pnpm run test` |
| Frontend tests | `docker compose run --rm frontend pnpm run test` | `scripts/test-stack.sh <ticket> run-frontend pnpm run test` |
| Lint, type check, build | `docker compose run --rm frontend pnpm run lint` | `scripts/test-stack.sh <ticket> run-frontend pnpm run lint` |
| Backend e2e | `docker compose run --rm backend pnpm run test:e2e` | `scripts/test-stack.sh <ticket> run sh -c 'pnpm run prisma:migrate && pnpm run test:e2e'` |
| New migration | `docker compose run --rm backend pnpm run prisma:migrate:dev` | `scripts/test-stack.sh <ticket> run pnpm exec prisma migrate dev --name <name>` |
| OpenAPI spec | `docker compose run --rm backend pnpm run generate:openapi` | `scripts/test-stack.sh <ticket> run-backend pnpm run generate:openapi` |
| API client | `docker compose run --rm frontend sh -c 'OPENAPI_SPEC_PATH=/spec/openapi.json pnpm exec openapi-ts'` | `scripts/test-stack.sh <ticket> run-frontend sh -c 'OPENAPI_SPEC_PATH=/spec/openapi.json pnpm exec openapi-ts'` |
| README/docs media | `docker compose --profile tools run --rm media` | `scripts/test-stack.sh <ticket> media` |

```bash
scripts/test-stack.sh <ticket> up                                # <ticket>-pg, <ticket>-redis, <ticket>-minio
scripts/test-stack.sh <ticket> run pnpm run prisma:migrate       # backend container on semaphore-test
scripts/test-stack.sh <ticket> run pnpm run test <test-pattern>
scripts/test-stack.sh <ticket> run pnpm run test:e2e             # backend e2e suite (migrate first)
scripts/test-stack.sh <ticket> run -e KEY=VALUE -- <cmd...>        # extra or overriding environment
scripts/test-stack.sh <ticket> run-backend pnpm run type-check   # no services: type-check, lint, unit tests, build
scripts/test-stack.sh <ticket> run-frontend pnpm run type-check  # frontend: type-check, lint, test, build
scripts/test-stack.sh <ticket> media                             # README/docs media (MEDIA_STEPS, MEDIA_FILTER from the env)
scripts/test-stack.sh <ticket> env                               # the environment `run` sets
scripts/test-stack.sh <ticket> down                              # removes the ticket's containers, never a network
scripts/test-stack.sh ls                                         # all tickets' containers
```

- `<ticket>` is 1–32 characters of `[a-z0-9-]`, such as the branch or issue
  name. Names starting with `semaphore`, `e2e-`, `uir-` or `kraken` are
  reserved.
- The services publish no host ports and are addressed by their
  ticket-prefixed container names (`DATABASE_URL=...@<ticket>-pg:5432/semaphore_test`,
  `REDIS_HOST=<ticket>-redis`, `S3_ENDPOINT=http://<ticket>-minio:9000`),
  never by generic names such as `postgres` or `redis`: other tickets share the
  network. Every container is labelled with its ticket, so tickets can run at
  the same time and `down` only removes its own.
- `run`, `run-backend` and `run-frontend` bind-mount this checkout's
  `backend/`, `frontend/` and `shared/` the way `docker-compose.yml` does, on
  content-addressed dependency images (`semaphore-test-backend:<hash>`, and the
  `uir-frontend:<hash>` image the UI review tool also uses) built on first use.
  A Prisma schema that differs from the image's is generated at run time, and
  `shared/dist` is built when it is missing or stale. Files the containers
  write as root are handed back to you, also after Ctrl-C or a SIGTERM (which
  remove the running container). A SIGKILL can leave it running: `down`
  removes it.
- `media` runs the README/docs media pipeline
  ([Regenerating Screenshots](regenerating-screenshots.md)) on this checkout:
  `<ticket>-ladle` serves its Ladle with no host port (it stays up between
  runs; restart it with `docker restart <ticket>-ladle` after adding a
  `*.stories.tsx` file), and the capture and encode containers write to
  `frontend/.media-out/`.
- Playwright E2E (`scripts/run-e2e.sh`, Playwright itself in Docker), voice
  E2E (`scripts/run-voice-e2e.sh`) and the UI review tool also use
  `semaphore-test`, with per-checkout container names, so they never create
  or remove a network either.
