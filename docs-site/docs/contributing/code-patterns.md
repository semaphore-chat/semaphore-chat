# Code Patterns

Key patterns and conventions used across the Semaphore Chat codebase.

## RBAC (Role-Based Access Control)

### Controller Decorators

```typescript
@RequiredActions(RbacActions.CREATE_MESSAGE)
@RbacResource({
  type: RbacResourceType.CHANNEL,
  idKey: 'channelId',
  source: ResourceIdSource.PAYLOAD,
})
@Post()
async createMessage(@Body() dto: CreateMessageDto) { ... }
```

The `RbacGuard` resolves the resource (channel -> community), loads the user's roles, and checks for the required action.

### Resource Types

| Type | Resolution |
|------|-----------|
| `CHANNEL` | Looks up channel to find community |
| `COMMUNITY` | Uses community ID directly |
| `INSTANCE` | Instance-level permission check |

---

## OpenAPI / Swagger

### Prisma Enums in DTOs

The NestJS Swagger plugin can't introspect Prisma enum types. Fix with explicit `@ApiProperty`:

```typescript
import { ApiProperty } from '@nestjs/swagger';
import { ChannelTypeValues } from '@/common/enums/swagger-enums';

export class ChannelDto {
  @ApiProperty({ enum: ChannelTypeValues })
  type: ChannelType;
}
```

For arrays: `@ApiProperty({ enum: RbacActionsValues, isArray: true })`

### Controller Response Types

Add `@ApiOkResponse({ type: FooDto })` (or `@ApiCreatedResponse`) so the OpenAPI spec knows the response shape. Without these, endpoints generate as `200: unknown`.

### PartialType Import

```typescript
// CORRECT
import { PartialType } from '@nestjs/swagger';

// WRONG - loses Swagger metadata
import { PartialType } from '@nestjs/mapped-types';
```

### Regenerating the API Client

When backend controllers or DTOs change:

```bash
docker compose run --rm backend pnpm run generate:openapi
docker compose run --rm frontend sh -c 'OPENAPI_SPEC_PATH=/spec/openapi.json pnpm exec openapi-ts'

# From a git worktree (no dev stack; see Testing > Test Stacks):
scripts/test-stack.sh <ticket> run-backend pnpm run generate:openapi
scripts/test-stack.sh <ticket> run-frontend sh -c 'OPENAPI_SPEC_PATH=/spec/openapi.json pnpm exec openapi-ts'
```

---

## Sensitive User Fields

Defense-in-depth to prevent user data leaks:

1. **Never return raw Prisma `User` objects** -- wrap in `new UserEntity(user)` which applies `@Exclude()` decorators
2. **Use `PUBLIC_USER_SELECT`** (`@/common/constants/user-select.constant`) instead of `include: { user: true }`
3. **Test with `expectNoSensitiveUserFields()`** when creating DTOs that include user data

When adding new fields to the User model, update:

- `UserEntity` `@Exclude()` decorators (if sensitive)
- `SENSITIVE_USER_FIELDS` constant in `test-utils/helpers/user-dto.helper.ts`
- `PUBLIC_USER_SELECT` constant (add if public, omit if sensitive)
- `UserFactory.buildComplete()` (add non-null values for testing)

---

## WebSocket Events

See the dedicated [WebSocket Patterns](../architecture/websocket-patterns.md) guide.

Quick rules:

- High-frequency + full payload -> direct cache update (`setQueryData`)
- Low-frequency + structural change -> cache invalidation (`invalidateQueries`)
- Transient + no persistence -> ephemeral state (`useServerEvent`)

---

## Platform Separation (Electron vs Web)

### Detection

```typescript
import { isElectron, isWeb, hasElectronFeature } from './utils/platform';
```

### The Electron bridge

The preload script exposes the Electron API as `window.electronAPI`. Only `src/utils/electronBridge.ts` reads it; ESLint rejects `.electronAPI` access anywhere else. Use:

| Where | How |
|-------|-----|
| Non-React code (utils, services) | `getElectronAPI()` from `utils/electronBridge` (or `utils/platform`) |
| Components and hooks | `useElectronAPI()` from `contexts/ElectronContext` |
| Yes/no checks | `isElectron()`, `hasElectronFeature()`, `isWayland()` from `utils/platform` |

`getElectronAPI()` and `useElectronAPI()` return `null` outside Electron, so a non-null value always means Electron. Individual methods can still be missing on older desktop builds, so call them optionally (`api?.checkForUpdates?.()`).

### Faking Electron in tests and stories

`createFakeElectronAPI(overrides)` (`src/__tests__/test-utils/fakeElectronAPI.ts`) implements the whole `ElectronAPI` with harmless defaults: queries resolve to neutral values, actions do nothing, and `on*` subscriptions return an unsubscribe function. Override what the test cares about and install it through one of the two seams. Don't assign `window.electronAPI`.

```typescript
// A component or hook that uses useElectronAPI(): give its tree a fake.
renderWithProviders(<AutoUpdater />, {
  electronAPI: createFakeElectronAPI({ onUpdateAvailable: emitOnSubscribe({ version: '1.4.0' }) }),
});
// renderHook: { wrapper: createElectronWrapper(fake) }; a web browser: electronAPI: null

// Non-React code (tokenService, isElectron()): swap the global bridge.
const api = createFakeElectronAPI({ getRefreshToken: vi.fn().mockResolvedValue('rt') });
setElectronAPIOverride(api); // null = web browser; setup.ts clears it after each test
```

The provider only reaches `useElectronAPI()`. Code that also calls `isElectron()` (layout, `useResponsive`) needs `setElectronAPIOverride()`. Ladle stories use `asElectron(Story, overrides)` (`stories/fixtures/electron.tsx`), which installs the fake with `setElectronAPIOverride()`.

### Guidelines

**Platform-specific** (use hooks): Screen capture, native file access, desktop notifications, auto-updates, system tray.

**Platform-agnostic** (no special handling): Voice/video (LiveKit), UI (Material-UI), state (TanStack Query), WebSocket, REST API.

### Rules

- Never override browser APIs globally (breaks LiveKit)
- Never read `window.electronAPI` directly: use `getElectronAPI()`, `useElectronAPI()` or the `utils/platform` checks (ESLint enforces this)
- Centralize platform logic in utility functions or hooks
- Let Electron intercept via `setDisplayMediaRequestHandler` in main process

---

## Docker Development

All development uses Docker. Never run `pnpm`/`npm` commands on the host. These commands use the dev stack, so run them in the main checkout; from a git worktree use `scripts/test-stack.sh <ticket> run-backend|run-frontend <cmd>` ([Test Stacks](testing.md#test-stacks-and-the-shared-docker-network)).

```bash
# Backend
docker compose run --rm backend pnpm run test
docker compose run --rm backend pnpm run lint

# Frontend
docker compose run --rm frontend pnpm run test
docker compose run --rm frontend pnpm run type-check

# Database
docker compose run --rm backend pnpm run prisma    # generate + push
```
