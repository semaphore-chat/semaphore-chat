# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Documentation

Project documentation: [docs.semaphorechat.app](https://docs.semaphorechat.app) (source: `docs-site/`).

## 🐳 **CRITICAL**: ALL DEVELOPMENT USES DOCKER

**Never run pnpm/npm/yarn/node commands directly on the host. Always use Docker containers as shown in the Development Commands section below.**

## Project Overview

**Semaphore Chat** is a self-hosted voice and text chat application built with NestJS backend and React frontend.

### Core Concepts

- **Instance**: The application stack running in hosted or self-hosted environments
- **Communities**: User/admin-created servers with members, channels, and voice/video contexts
- **Members**: Users registered with the instance and added to communities
- **Channels**: Text and voice channels within communities
- **Direct Messages & Groups**: Private messaging between users (✅ implemented with file attachments)

### Platform Goals

- **Current**: Browser-based application
- **Future Roadmap**:
  - Mobile app (React Native or Electron)
  - Desktop application (Electron)

### Key Features

- Real-time messaging via WebSockets with file attachments
- Voice/video calls powered by LiveKit integration
- Community-based organization with channels and roles
- Role-based permissions system (RBAC)
- Private channels and direct messaging
- User presence and online status
- User profiles with avatars and banners
- Authenticated file caching system

### Voice Channel Implementation Notes

- **LiveKit Integration**: Channel IDs are used as LiveKit room IDs for voice/video sessions
- **Persistent Connections**: Voice connections should persist across page navigation
- **Presence System**: Track users currently in voice channels for REST API and real-time updates
- **Channel Types**: `VOICE` channels support both audio-only and video modes with screen sharing
- **UI Pattern**: Bottom persistent bar when connected + video tiles overlay when video enabled

### 🔌 Platform Separation Pattern (Web vs Electron)

**Semaphore Chat supports both web browsers and Electron desktop app. Use these patterns for clean platform separation:**

#### **1. Platform Detection Utility**

Always use the centralized platform utility instead of inline checks:

```typescript
// ✅ CORRECT: Use platform utility
import { isElectron, isWeb, hasElectronFeature } from './utils/platform';

if (isElectron()) {
  // Electron-specific code
}

if (hasElectronFeature('getDesktopSources')) {
  // Feature-specific check
}
```

```typescript
// ❌ WRONG: Inline platform checks
if (window.electronAPI) {  // Don't do this
  // ...
}
```

#### **2. Platform-Specific Hooks**

Use hooks to encapsulate platform differences (see `src/hooks/`):

- `useScreenShare()` - Platform-aware screen sharing (Electron picker vs browser native)
- `useMediaDevices()` - Cross-platform media device management

**Example:**
```typescript
// ✅ CORRECT: Use platform hook
import { useScreenShare } from '../../hooks/useScreenShare';

const MyComponent = () => {
  const { toggleScreenShare, isScreenSharing, showSourcePicker } = useScreenShare();

  return (
    <button onClick={toggleScreenShare}>
      {isScreenSharing ? 'Stop' : 'Share'} Screen
    </button>
  );
};
```

```typescript
// ❌ WRONG: Platform checks in component
const MyComponent = () => {
  const handleClick = () => {
    if (window.electronAPI?.getDesktopSources) {
      // Electron code
    } else {
      // Browser code
    }
  };
  // Messy and hard to test
};
```

#### **3. Platform Separation Guidelines**

**When to create platform-specific code:**
- Screen capture/sharing (different APIs)
- Native file system access
- Desktop notifications
- Auto-updates (Electron only)
- System tray integration (Electron only)

**What should be platform-agnostic:**
- Voice/video connection logic (LiveKit works on both)
- UI components (Material-UI works on both)
- State management (TanStack Query works on both)
- WebSocket communication (works on both)
- REST API calls (works on both)

#### **4. Testing Platform Code**

```typescript
// Mock platform detection in tests
jest.mock('./utils/platform', () => ({
  isElectron: jest.fn(() => false),  // Test web behavior
  isWeb: jest.fn(() => true),
}));
```

#### **5. Common Pitfalls**

❌ **Don't**: Override browser APIs globally (breaks LiveKit)
```typescript
// NEVER DO THIS - Deprecated pattern
navigator.mediaDevices.getDisplayMedia = myCustomFunction;
```

✅ **Do**: Let Electron intercept via `setDisplayMediaRequestHandler` in main process
```typescript
// main.ts (Electron only)
session.defaultSession.setDisplayMediaRequestHandler(...)
```

❌ **Don't**: Scatter platform checks throughout components
```typescript
// Hard to maintain
if (window.electronAPI) { /* ... */ }
if (window.electronAPI?.feature) { /* ... */ }
```

✅ **Do**: Centralize in utility or hooks
```typescript
import { isElectron, hasElectronFeature } from './utils/platform';
```

## Development Commands

**🐳 ALL DEVELOPMENT SHOULD BE DONE WITH DOCKER**

**Main checkout vs worktrees:** every `docker compose ...` command in this file (in this section, in Testing, in Database Operations, anywhere) drives the long-running dev stack (`docker-compose.yml`, project `semaphore-chat`) and is for the **main checkout only**. In a git worktree or any other checkout, use the `scripts/test-stack.sh` equivalent from the table in **Test stacks, worktrees and the shared `semaphore-test` network** below. `docker compose run/up` in a worktree starts a new project named after the directory, which creates a `<dir>_default` network (and a later `down` removes it). A worktree needs no `backend/.env`: don't create one to make `docker compose` work there.

### Essential Docker Commands

- **Start development**: `docker-compose up` (starts all services with hot reload)
- **Start in background**: `docker-compose up -d`
- **Stop all services**: `docker compose stop` (not `down`: it removes the `semaphore-chat_default` network, and the next `up` creates it again)
- **View logs**: `docker-compose logs [service-name]` (e.g., `docker-compose logs backend`)
- **Rebuild containers**: `docker-compose build --no-cache`
- **Clean up** (containers and volumes, keeps the network): `docker compose rm -s -f -v && docker volume rm $(docker volume ls -q --filter label=com.docker.compose.project=semaphore-chat)`

### Backend Development (NestJS in Docker)

- **Backend shell**: `docker compose run backend bash`
- **Run tests**: `docker compose run backend pnpm run test`
- **Run e2e tests**: `docker compose run backend pnpm run test:e2e`
- **Lint code**: `docker compose run backend pnpm run lint`
- **Build**: `docker compose run backend pnpm run build`
- **Single test**: `docker compose run backend pnpm run test <test-pattern>` (not `pnpm exec jest`: the `test` script sets the Node flag Jest needs to load the ESM-only NestJS packages)

### Frontend Development (React + Vite in Docker)

- **Frontend shell**: `docker compose run frontend bash`
- **Lint frontend**: `docker compose run frontend pnpm run lint`
- **Build frontend**: `docker compose run frontend pnpm run build`
- **Type check**: `docker compose run frontend pnpm run type-check`

### Database Operations (Prisma in Docker)

- **Generate Prisma client**: `docker compose run backend pnpm run prisma:generate`
- **Run migrations**: `docker compose run backend pnpm run prisma:migrate`
- **Create new migration**: `docker compose run backend pnpm run prisma:migrate:dev`
- **Full setup**: `docker compose run backend pnpm run prisma` (generates + migrates)
- **Prisma studio**: `docker compose run -p 5555:5555 backend pnpm exec prisma studio`

### OpenAPI SDK Client Regeneration

When backend controllers or DTOs change (new endpoints, modified responses), regenerate the frontend API client:

```bash
# 1. Generate the OpenAPI spec from the backend
docker compose run --rm backend pnpm run generate:openapi

# 2. Regenerate the frontend SDK (must run inside frontend container)
docker compose run --rm frontend sh -c 'OPENAPI_SPEC_PATH=/spec/openapi.json pnpm exec openapi-ts'

# The same from a worktree (no dev stack, no compose project):
scripts/test-stack.sh <ticket> run-backend pnpm run generate:openapi
scripts/test-stack.sh <ticket> run-frontend sh -c 'OPENAPI_SPEC_PATH=/spec/openapi.json pnpm exec openapi-ts'
```

The backend dir is mounted at `/spec` inside the frontend container (see `docker-compose.yml`; `test-stack.sh run-frontend` does the same). The generated client goes to `frontend/src/api-client/`. Always use generated SDK functions (`voicePresenceControllerJoinPresence(...)`) instead of raw `client.post()` calls.

### 📹 **LiveKit (Voice/Video & Egress)**

LiveKit Server and LiveKit Egress are included in the dev Docker Compose and start automatically with `docker-compose up`. Voice/video and replay capture work out of the box — no external LiveKit server needed.

**Egress storage** uses a shared Docker named volume (`egress-data`) between `livekit-egress` and `backend`. To use a local bind mount or NFS instead, see `docker-compose.override.yml.example`.

### 🚨 **Important Notes**

- **Never run pnpm/npm commands directly on host** - always use Docker containers
- **Hot reload is enabled** - file changes automatically update in containers
- **Ports**: Frontend (5173), Backend (3000), PostgreSQL (5432), Redis (6379), LiveKit (7880)
- **Data persistence**: PostgreSQL and Redis data is persisted in Docker volumes

### 🌐 **Test stacks, worktrees and the shared `semaphore-test` network**

**Never create per-ticket Docker networks or use `docker compose down` in a way that removes networks. Use `scripts/test-stack.sh`; all test containers go on `semaphore-test`.**

Every network create/remove adds/removes a `br-*` bridge with an IPv4 address on the host, and Chromium-based browsers on this machine drop their open connections on each one. So:

- **Don't use `docker compose -p <name> ...` from a worktree** (or plain `docker compose run/up` there, which names the project after the directory): the project's first `up`/`run` creates `<name>_default` and `down` removes it. Use `scripts/test-stack.sh` instead. **All** dev-stack `docker compose` commands in this file are for the main checkout only (project `semaphore-chat`, network `semaphore-chat_default`, which stays up).
- `scripts/test-net.sh` creates `semaphore-test` once (idempotent), plus an idle `semaphore-test-anchor` container that keeps it in use so a prune can't delete it. Nothing removes either: no `docker network rm`/`docker network prune`/`docker system prune`.
- Never `docker compose down` the dev stack either: stop it with `docker compose stop` (keeps `semaphore-chat_default`).
- Per-ticket services and commands (`<ticket>`: `[a-z0-9-]`, unique to your worktree, e.g. the branch or issue name):

```bash
scripts/test-stack.sh <ticket> up                                  # <ticket>-pg, <ticket>-redis, <ticket>-minio on semaphore-test
scripts/test-stack.sh <ticket> run pnpm run prisma:migrate         # backend container, DATABASE_URL/REDIS_*/S3_* -> the ticket's containers
scripts/test-stack.sh <ticket> run pnpm run test <pattern>
scripts/test-stack.sh <ticket> run pnpm run test:e2e               # backend e2e (migrate first)
scripts/test-stack.sh <ticket> run-backend pnpm run type-check     # no services needed: type-check, lint, unit tests, build
scripts/test-stack.sh <ticket> run-frontend pnpm run type-check    # likewise for the frontend (lint, test, build)
scripts/test-stack.sh <ticket> media                               # README/docs media (MEDIA_STEPS/MEDIA_FILTER from the env)
scripts/test-stack.sh <ticket> down                                # containers only; never a network
scripts/test-stack.sh ls                                           # every ticket's containers (don't `down` another session's)
```

| Task | Main checkout (dev stack) | Worktree / any other checkout |
|------|---------------------------|-------------------------------|
| Backend unit tests (pre-push) | `docker compose run --rm backend pnpm run test` | `scripts/test-stack.sh <ticket> run-backend pnpm run test` |
| Frontend tests (pre-push) | `docker compose run --rm frontend pnpm run test` | `scripts/test-stack.sh <ticket> run-frontend pnpm run test` |
| Lint / type-check / build | `docker compose run --rm backend\|frontend pnpm run lint` | `scripts/test-stack.sh <ticket> run-backend\|run-frontend pnpm run lint` |
| Backend e2e (jest) | `docker compose run --rm backend pnpm run test:e2e` | `scripts/test-stack.sh <ticket> run sh -c 'pnpm run prisma:migrate && pnpm run test:e2e'` |
| Apply migrations | `docker compose run --rm backend pnpm run prisma:migrate` | `scripts/test-stack.sh <ticket> run pnpm run prisma:migrate` |
| New migration | `docker compose run --rm backend pnpm run prisma:migrate:dev` | `scripts/test-stack.sh <ticket> run pnpm exec prisma migrate dev --name <name>` |
| Prisma client | `docker compose run --rm backend pnpm run prisma:generate` | automatic: `run`/`run-backend` regenerate it when the schema differs from the image |
| OpenAPI spec + client | see OpenAPI SDK Client Regeneration | `run-backend pnpm run generate:openapi`, then `run-frontend sh -c 'OPENAPI_SPEC_PATH=/spec/openapi.json pnpm exec openapi-ts'` |
| README/docs media | `docker compose --profile tools run --rm media` | `scripts/test-stack.sh <ticket> media` |
| Playwright / voice E2E, UI review | `scripts/run-e2e.sh`, `scripts/run-voice-e2e.sh`, `frontend/scripts/ui-review/ui-review.sh` | the same scripts: they already use `semaphore-test` |

- Services address each other by the ticket-prefixed container name (`<ticket>-pg`), never by generic names like `postgres`/`redis`: several tickets share the network.
- Playwright E2E (`scripts/run-e2e.sh`), voice E2E (`scripts/run-voice-e2e.sh`) and the UI review tool also run on `semaphore-test`, with per-checkout container names.
- A run killed with SIGKILL (e.g. a tool timeout) can leave its container running: `scripts/test-stack.sh <ticket> down` (or `ls` to find it) cleans up. INT/TERM are handled.

### 📋 **Daily Development Workflow**

In the main checkout (in a worktree, use the `scripts/test-stack.sh` column of the table above):

```bash
# 1. Start development environment
docker-compose up

# 2. In separate terminal: Run backend tests
docker compose run --rm backend pnpm run test

# 3. In separate terminal: Check backend linting
docker compose run --rm backend pnpm run lint

# 4. In separate terminal: Run database migrations
docker compose run --rm backend pnpm run prisma:migrate

# 5. View logs for specific service
docker-compose logs backend -f

# 6. Stop everything when done (stop, not down: keeps the network)
docker compose stop
```

### 🔧 **Troubleshooting**

- **Services not starting**: Try `docker compose rm -s -f` then `docker-compose build --no-cache`
- **Database connection issues**: Ensure PostgreSQL container is healthy with `docker-compose ps`
- **Port conflicts**: Check if ports 3000, 5173, 5432, 6379, 7880 are available
- **Permission issues**: Use `docker compose run --rm backend bash` to debug (main checkout; elsewhere `scripts/test-stack.sh <ticket> run-backend bash`)
- **Fresh start** (wipes the dev data, keeps the network): `docker compose rm -s -f -v && docker volume rm $(docker volume ls -q --filter label=com.docker.compose.project=semaphore-chat) && docker-compose build --no-cache && docker-compose up`

## Architecture Overview

### Tech Stack

- **Backend**: NestJS (TypeScript) with modular architecture
- **Database**: PostgreSQL with Prisma ORM (uses migrations)
- **Frontend**: React 19 + TypeScript + Vite + Material-UI
- **State Management**: TanStack Query (React Query) for server state
- **Real-time**: WebSockets via Socket.IO with Redis adapter
- **Authentication**: JWT with Passport.js strategies
- **Video Calls**: LiveKit integration
- **Development**: Docker Compose with hot reload

### Key Backend Modules

The backend follows NestJS modular architecture in `backend/src/`:

- **Core Modules**:

  - `auth/` - JWT authentication, RBAC guards, Passport strategies
  - `user/` - User management and profiles
  - `database/` - Prisma service and database connection
  - `roles/` - Role-based access control system
  - `cache/` - Redis caching service

- **Chat Features**:

  - `community/` - Community/server management
  - `channels/` - Text and voice channels
  - `messages/` - Message handling with spans, attachments, reactions
  - `membership/` - Community membership management
  - `channel-membership/` - Private channel access control
  - `presence/` - User online status
  - `invite/` - Instance and community invitations

- **Real-time**:

  - `websocket/` - WebSocket service and event handling
  - `messages.gateway` - Real-time message events
  - `presence.gateway` - User presence updates
  - `rooms/` - Room management for voice/video

- **Integrations**:
  - `livekit/` - Video call token generation and room management
  - `redis/` - Redis connection and pub/sub

### Frontend Architecture

The frontend uses feature-based organization in `frontend/src/`:

- **State Management**:

  - TanStack Query (React Query) for all server state
  - Generated API client from OpenAPI spec (`api-client/`)
  - WebSocket handlers sync cache via `setQueryData` or `invalidateQueries`

- **Features** (`components/`):

  - Feature-organized component structure
  - Matches backend module structure (auth, community, channels, etc.)
  - Role-based component rendering system

- **Components** (`components/`):

  - Feature-organized component structure
  - Material-UI based design system
  - LiveKit integration for video calls

- **Real-time** (`hooks/`, `utils/`):
  - WebSocket hooks for different features
  - Socket.IO singleton for connection management
  - Event-driven message updates

### Database Schema

PostgreSQL with Prisma schema defines:

- **Users**: Authentication, profiles, instance roles
- **Communities**: Servers with channels, roles, and memberships
- **Channels**: Text/voice channels with private channel support
- **Messages**: Rich messages with spans (mentions, formatting), attachments, reactions
- **Memberships**: Community and channel membership tracking
- **Roles & Permissions**: RBAC system with granular permissions
- **Direct Messages**: Private messaging between users
- **LiveKit Integration**: Video call room management

### Authentication & Authorization

- JWT-based auth with refresh tokens
- Role-based access control (RBAC) with granular permissions
- Instance-level and community-level roles
- WebSocket authentication guards
- Private channel membership system

### Development Environment

- Docker Compose orchestrates PostgreSQL, Redis, backend, and frontend
- Hot reload enabled for both frontend and backend
- Redis used for WebSocket scaling and caching

## OpenAPI / Swagger Patterns

### Prisma Enums in DTOs

The NestJS Swagger plugin can't introspect Prisma enum types (generated into `node_modules/.prisma/client`), so DTO properties typed with Prisma enums render as `"type": "object"` in the OpenAPI spec (and `{ [key: string]: unknown }` in generated client types).

**Fix:** Add `@ApiProperty({ enum: XxxValues })` using the const arrays from `@/common/enums/swagger-enums.ts`:

```typescript
import { ApiProperty } from '@nestjs/swagger';
import { ChannelTypeValues } from '@/common/enums/swagger-enums';

export class ChannelDto {
  @ApiProperty({ enum: ChannelTypeValues })
  type: ChannelType;
}
```

For enum arrays: `@ApiProperty({ enum: RbacActionsValues, isArray: true })`

### Controller Response Types

Controllers need `@ApiOkResponse({ type: FooDto })` (or `@ApiCreatedResponse`) decorators for the OpenAPI spec to know the response shape. Without these, endpoints generate as `200: unknown`. The Swagger plugin auto-infers return types in simple cases, but fails for many controller patterns.

### PartialType Import

Always import `PartialType` from `@nestjs/swagger`, **not** `@nestjs/mapped-types`. The mapped-types version doesn't preserve Swagger metadata, causing the entire DTO to render as `{ [key: string]: unknown }`.

## Important Notes

### Database Operations

- PostgreSQL uses Prisma migrations (`prisma migrate deploy` for production, `prisma migrate dev` for development)
- Always run `prisma generate` after schema changes
- To create a new migration after schema changes: `docker compose run --rm backend pnpm run prisma:migrate:dev` (main checkout); in a worktree `scripts/test-stack.sh <ticket> run pnpm exec prisma migrate dev --name <name>` (applies the existing migrations to the ticket's empty database, then writes the new one into `backend/prisma/migrations/`)

### Environment Variables

For the dev stack in the main checkout, copy `backend/env.sample` to `backend/.env` and configure (worktrees don't need one: `scripts/test-stack.sh` sets the environment itself, and a `backend/.env` there only lets `docker compose` create a network per worktree):

- `DATABASE_URL` PostgreSQL connection string
- JWT secrets (change defaults!)
- Redis host configuration

### Testing

When implementing a feature, fixing a bug, or modifying behavior in either the backend or frontend, write or update corresponding unit tests. Tests are the primary safety net against regressions — E2E tests are slow and coarse-grained, so fast unit/component tests should cover as much behavior as possible.

#### Backend Tests

- Uses Jest with `@suites/unit` TestBed automocks
- Test files follow `*.spec.ts` pattern alongside source files
- E2E tests in `backend/test/` directory
- Run: `docker compose run --rm backend pnpm run test` (main checkout); in a worktree `scripts/test-stack.sh <ticket> run-backend pnpm run test`

#### Frontend Tests

- Uses Vitest + jsdom + `@testing-library/react` + MSW v2
- Test files live in `frontend/src/__tests__/` organized by type: `components/`, `hooks/`, `features/`
- Run: `docker compose run --rm frontend pnpm run test` (or `pnpm run test:cov` for coverage) in the main checkout; in a worktree `scripts/test-stack.sh <ticket> run-frontend pnpm run test`
- CI runs automatically on PRs touching `frontend/**` or `shared/**`

**Test infrastructure** (in `frontend/src/__tests__/test-utils/`):
- `renderWithProviders()` — wraps components with QueryClient, MemoryRouter, ThemeProvider, SocketContext, NotificationProvider. Returns `{ user, queryClient, ...renderResult }` where `user` is a `userEvent` instance for realistic interaction simulation.
- `factories.ts` — `createMessage()`, `createChannel()`, `createUser()`, `createDmGroup()`, etc.
- `msw/handlers.ts` — default MSW request handlers for auth, user profile, channels, DMs. Override per-test with `server.use(...)`.

**What to test**: Component rendering and user interactions, hook behavior (state changes, side effects), action functions (dispatch sequences, API calls, error handling). Mock external dependencies (hooks, child components, API client) to isolate the unit under test.

**Key patterns**:
- Mock API client: `vi.mock('../../api-client/client.gen', async (importOriginal) => { ... })` with `createClient(createConfig({ baseUrl: 'http://localhost:3000' }))` so MSW can intercept
- Mock hooks: `vi.mock('../../hooks/useFoo', () => ({ useFoo: vi.fn(() => mockValue) }))` — remember that `vi.clearAllMocks()` does NOT reset `mockReturnValue`, so reset mocks explicitly in `beforeEach` if any test overrides them
- Mock `useParams`/`useNavigate`: mock `react-router-dom` with `importOriginal` spread + overrides
- Test async error flows: rejected promises from mocked functions trigger catch blocks; use `findByRole`/`waitFor` to assert on resulting DOM changes

**Pre-push requirement**: Always run the full test suite locally before pushing to remote or opening a PR. This catches failures early and avoids wasting CI minutes. From a worktree (where branches are usually pushed from), never `docker compose run` (it creates a `<worktree>_default` network):
- Frontend: `scripts/test-stack.sh <ticket> run-frontend pnpm run test` (main checkout: `docker compose run --rm frontend pnpm run test`)
- Backend: `scripts/test-stack.sh <ticket> run-backend pnpm run test` (main checkout: `docker compose run --rm backend pnpm run test`)

**UI changes**: before opening or updating a PR that changes frontend UI, follow the ui-pr-review skill (`.claude/skills/ui-pr-review`) — render affected stories on base vs head at phone/tablet/desktop, review every screenshot, and include the generated before/after section in the PR description.

### Code Quality

- ESLint configured for both backend and frontend
- Prettier for code formatting
- TypeScript strict mode enabled
- Consistent import path aliases using `@/` for backend src

### Important Code Patterns

#### RBAC Usage

```typescript
@RequiredActions(RbacActions.CREATE_MESSAGE)
@RbacResource({
  type: RbacResourceType.CHANNEL,
  idKey: 'channelId',
  source: ResourceIdSource.PAYLOAD,
})
```

#### WebSocket Event Patterns

**See [WebSocket Patterns](https://docs.semaphorechat.app/architecture/websocket-patterns/) for the full guide.**

Semaphore Chat uses three patterns for WebSocket events. Choosing the right one matters:

| Pattern | When | Example |
|---------|------|---------|
| **Direct cache update** (`setQueryData`) | High-frequency, full payload, instant UX needed | Messages, reactions, presence |
| **Cache invalidation** (`invalidateQueries`) | Low-frequency, structural changes, complex cache | Roles, channels, communities |
| **Ephemeral UI state** (`useServerEvent`) | Transient, no persistence needed | Typing indicators, sounds |

**Quick rule**: If the event fires multiple times per second and carries a full object, use direct update. If it's an admin/structural change that happens rarely, use invalidation. When in doubt, default to invalidation.

**Backend emission**: Services use `EventEmitter2` domain events handled by `RoomSubscriptionHandler`. Gateways and services that already have `WebsocketService` can call `sendToRoom()` directly for broadcasts.

#### TanStack Query State Management

Frontend server state is managed entirely through TanStack Query (React Query). There is no Redux store — all API data flows through `useQuery` / `useMutation` hooks with the generated API client.

- Remove orphan containers when using docker to run commands

## Sensitive User Fields Policy

**Preventing user data leaks requires defense-in-depth. Follow these rules when working with User data:**

1. **Never return raw Prisma `User` objects** to clients - always wrap in `new UserEntity(user)` which applies `@Exclude()` decorators
2. **Use `PUBLIC_USER_SELECT`** (`@/common/constants/user-select.constant`) instead of `include: { user: true }` to prevent sensitive fields from being fetched at the query level
3. **Never create duplicate `@Exclude()` declarations** - reuse `UserEntity` instead of creating feature-specific user DTOs
4. **Test with `expectNoSensitiveUserFields()`** (from `@/test-utils`) when creating DTOs that include user data
5. **When adding new fields to the User model**, update all of:
   - `UserEntity` `@Exclude()` decorators (if sensitive)
   - `SENSITIVE_USER_FIELDS` constant in `test-utils/helpers/user-dto.helper.ts`
   - `PUBLIC_USER_SELECT` constant (add if public, omit if sensitive)
   - `UserFactory.buildComplete()` (add non-null values for testing)

## Future TODOs

### Configurable LiveKit Egress Output Storage

**Current State**: LiveKit egress writes HLS segments to local NFS mount (`/out/` via Docker volume).

**Future Enhancement**: Support S3/Azure Blob storage for egress output to enable multi-instance scalability.

**Requirements**:
- Configure LiveKit egress to write directly to S3 bucket (LiveKit supports this natively)
- Update segment discovery to list objects from S3 prefix instead of local filesystem
- Add `StorageService.downloadFile()` method to download segments to local temp directory before FFmpeg processing
- FFmpeg still requires local filesystem access, so segments must be downloaded temporarily
- After processing, upload final clip to remote storage via `StorageService.writeFile()`
- Consider caching downloaded segments to reduce S3 egress costs
- Update environment variables: `REPLAY_EGRESS_STORAGE_TYPE`, `REPLAY_EGRESS_S3_BUCKET`, etc.