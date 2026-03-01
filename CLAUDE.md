# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Documentation

Project documentation: [docs.krakenchat.app](https://docs.krakenchat.app) (source: `docs-site/`).

## 🐳 **CRITICAL**: ALL DEVELOPMENT USES DOCKER

**Never run pnpm/npm/yarn/node commands directly on the host. Always use Docker containers as shown in the Development Commands section below.**

## Project Overview

**Kraken** is a self-hosted voice and text chat application built with NestJS backend and React frontend.

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

**Kraken supports both web browsers and Electron desktop app. Use these patterns for clean platform separation:**

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

### Essential Docker Commands

- **Start development**: `docker-compose up` (starts all services with hot reload)
- **Start in background**: `docker-compose up -d`
- **Stop all services**: `docker-compose down`
- **View logs**: `docker-compose logs [service-name]` (e.g., `docker-compose logs backend`)
- **Rebuild containers**: `docker-compose build --no-cache`
- **Clean up**: `docker-compose down -v` (removes volumes)

### Backend Development (NestJS in Docker)

- **Backend shell**: `docker compose run backend bash`
- **Run tests**: `docker compose run backend pnpm run test`
- **Run e2e tests**: `docker compose run backend pnpm run test:e2e`
- **Lint code**: `docker compose run backend pnpm run lint`
- **Build**: `docker compose run backend pnpm run build`
- **Single test**: `docker compose run backend pnpm exec jest <test-pattern>`

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
```

The backend dir is mounted at `/spec` inside the frontend container (see `docker-compose.yml`). The generated client goes to `frontend/src/api-client/`. Always use generated SDK functions (`voicePresenceControllerJoinPresence(...)`) instead of raw `client.post()` calls.

### 📹 **LiveKit (Voice/Video & Egress)**

LiveKit Server and LiveKit Egress are included in the dev Docker Compose and start automatically with `docker-compose up`. Voice/video and replay capture work out of the box — no external LiveKit server needed.

**Egress storage** uses a shared Docker named volume (`egress-data`) between `livekit-egress` and `backend`. To use a local bind mount or NFS instead, see `docker-compose.override.yml.example`.

### 🚨 **Important Notes**

- **Never run pnpm/npm commands directly on host** - always use Docker containers
- **Hot reload is enabled** - file changes automatically update in containers
- **Ports**: Frontend (5173), Backend (3000), PostgreSQL (5432), Redis (6379), LiveKit (7880)
- **Data persistence**: PostgreSQL and Redis data is persisted in Docker volumes

### 📋 **Daily Development Workflow**

```bash
# 1. Start development environment
docker-compose up

# 2. In separate terminal: Run backend tests
docker compose run backend pnpm run test

# 3. In separate terminal: Check backend linting
docker compose run backend pnpm run lint

# 4. In separate terminal: Run database migrations
docker compose run backend pnpm run prisma:migrate

# 5. View logs for specific service
docker-compose logs backend -f

# 6. Stop everything when done
docker-compose down
```

### 🔧 **Troubleshooting**

- **Services not starting**: Try `docker-compose down` then `docker-compose build --no-cache`
- **Database connection issues**: Ensure PostgreSQL container is healthy with `docker-compose ps`
- **Port conflicts**: Check if ports 3000, 5173, 5432, 6379, 7880 are available
- **Permission issues**: Use `docker compose run --rm backend bash` to debug
- **Fresh start**: `docker-compose down -v && docker-compose build --no-cache && docker-compose up`

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
- To create a new migration after schema changes: `docker compose run backend pnpm run prisma:migrate:dev`

### Environment Variables

Copy `backend/env.sample` to `backend/.env` and configure:

- `DATABASE_URL` PostgreSQL connection string
- JWT secrets (change defaults!)
- Redis host configuration

### Testing

When implementing a feature, fixing a bug, or modifying behavior in either the backend or frontend, write or update corresponding unit tests. Tests are the primary safety net against regressions — E2E tests are slow and coarse-grained, so fast unit/component tests should cover as much behavior as possible.

#### Backend Tests

- Uses Jest with `@suites/unit` TestBed automocks
- Test files follow `*.spec.ts` pattern alongside source files
- E2E tests in `backend/test/` directory
- Run: `docker compose run --rm backend pnpm run test`

#### Frontend Tests

- Uses Vitest + jsdom + `@testing-library/react` + MSW v2
- Test files live in `frontend/src/__tests__/` organized by type: `components/`, `hooks/`, `features/`
- Run: `docker compose run --rm frontend pnpm run test` (or `pnpm run test:cov` for coverage)
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

**Pre-push requirement**: Always run the full test suite locally before pushing to remote or opening a PR. This catches failures early and avoids wasting CI minutes:
- Frontend: `docker compose run --rm frontend pnpm run test`
- Backend: `docker compose run --rm backend pnpm run test`

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

**See [WebSocket Patterns](https://docs.krakenchat.app/architecture/websocket-patterns/) for the full guide.**

Kraken uses three patterns for WebSocket events. Choosing the right one matters:

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