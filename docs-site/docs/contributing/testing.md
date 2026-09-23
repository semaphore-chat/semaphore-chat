# Testing Guide

## Backend Tests

**Stack**: Jest + `@suites/unit` TestBed automocks

Test files live alongside source files as `*.spec.ts`. E2E tests are in `backend/test/`.

```bash
# All unit tests
docker compose run --rm backend pnpm run test

# E2E tests
docker compose run --rm backend pnpm run test:e2e

# Single test file
docker compose run --rm backend pnpm exec jest <test-pattern>

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
one summary, along with the coverage table and the coverage badge. Lint, type
check, build and the bundle budget run in their own `Lint, Type Check & Build`
job. To reproduce one shard locally:

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
