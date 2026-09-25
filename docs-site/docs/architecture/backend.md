# Backend Architecture

The backend is a **NestJS** application in `backend/src/` using modular architecture with Prisma ORM, Socket.IO, and LiveKit integration.

## Module Organization

### Core Infrastructure

| Module | Purpose |
|--------|---------|
| `auth/` | JWT authentication, Passport strategies, RBAC guards |
| `database/` | Prisma service and connection management |
| `redis/` | Redis connection, pub/sub |
| `cache/` | Redis caching service |
| `roles/` | Role definitions and permission checking |
| `health/` | Health check endpoints |

### User & Social

| Module | Purpose |
|--------|---------|
| `user/` | User CRUD, profiles, avatars, banners |
| `friends/` | Friend requests, accept/decline/block |
| `presence/` | Online status tracking (multi-connection aware) |
| `appearance-settings/` | Theme preferences (accent color, intensity) |

### Community & Channels

| Module | Purpose |
|--------|---------|
| `community/` | Community CRUD, settings, invites |
| `channels/` | Text/voice channel management, reordering |
| `membership/` | Community membership (join/leave) |
| `channel-membership/` | Private channel access control |
| `invite/` | Instance and community invitation system |
| `onboarding/` | First-time instance setup wizard |
| `alias-groups/` | Mention groups within communities |

### Messaging

| Module | Purpose |
|--------|---------|
| `messages/` | Message CRUD with spans, attachments, reactions |
| `threads/` | Thread replies, subscription, notifications |
| `direct-messages/` | 1:1 and group DM management |
| `notifications/` | Notification creation and delivery |
| `read-receipts/` | Message read tracking |

### Voice & Media

| Module | Purpose |
|--------|---------|
| `livekit/` | Token generation, room management, replay buffer |
| `rooms/` | Room state for voice/video sessions |
| `file/` | Authenticated file serving with range support |
| `file-upload/` | File upload handling |
| `storage/` | Storage abstraction layer |
| `storage-quota/` | Per-user storage quota enforcement |

### Moderation

| Module | Purpose |
|--------|---------|
| `moderation/` | Ban, kick, timeout, moderation logs |
| `instance/` | Instance-level settings and admin panel |

---

## Request Flow

```
HTTP Request
    |
Controller (route + decorators)
    |-- @RequiredActions(RbacActions.CREATE_MESSAGE)
    |-- @RbacResource({ type: CHANNEL, idKey: 'channelId', source: PAYLOAD })
    |
Guards (JwtAuthGuard -> RbacGuard)
    |
Service (business logic)
    |
Prisma (database operations)
    |
EventEmitter2 (domain events) --> RoomSubscriptionHandler --> WebsocketService
```

### Authentication Flow

1. **Login**: `POST /auth/login` -> validates credentials -> returns JWT access + refresh tokens
2. **Access**: Every request includes `Authorization: Bearer <token>` -> `JwtAuthGuard` validates
3. **Refresh**: `POST /auth/refresh` -> validates refresh token -> issues new pair
4. **RBAC**: `RbacGuard` checks user's roles against `@RequiredActions()` decorator

Access tokens live 1 hour and carry a session id (`sid`, the refresh token
family). Revocation is remembered in Redis until the tokens would have
expired anyway (`TokenBlacklistService`): logout revokes that token and its
session, revoking a session revokes all of its tokens, and a password reset
revokes every token the user holds. REST (`JwtStrategy`) and WebSocket auth
check the same revocations.

Refresh tokens rotate on every refresh. A rotated token presented again
within 30 seconds (tabs sharing the refresh cookie, a retry after a lost
response) gets the token it was rotated to, not a new one
(`RefreshTokenGraceService`), so the session never forks. Only the client
that did the rotation gets it: the same user agent and IP address (the same
/64 for IPv6, `client-match.util.ts`; `req.ip`, so behind a reverse proxy
set `TRUST_PROXY`). Presented later, or within the window by another client,
it counts as stolen: the whole session is revoked, including its access
tokens and sockets. Rotation times come from the database's clock, so
backend instances with clocks that disagree agree on the window. Logins,
refreshes and revocations of a user's sessions are serialized with a lock on
the user's row (`session-lock.util.ts`), so none of them can leave a token
behind that a concurrent password reset or logout should have removed.

`GET /auth/sessions` lists a session by its id (the token family, the `sid`
of its access tokens), which rotations don't change, and shows a rotation's
activity only a minute later, after its grace window: the list can't tell
the holder of a stolen token when to replay it. `DELETE /auth/sessions/:id`
takes that id (or, for older clients, a refresh token id).

`POST /auth/refresh` is rate-limited per user (the user of the presented
token, once its signature checks out) rather than per IP
(`RefreshThrottlerGuard`): every page load refreshes, and many users can
share one address.

On the client, `tokenService` refreshes under a Web Lock, so tabs take turns
instead of sending the same cookie at once. It signs out only when the server
refuses the session (401/403); a network error, 5xx or 429 is retried, and
the REST call that needed the refresh fails with a retryable 503. Retries
stop 12 seconds after the first attempt (`sessionRefreshPolicy.ts`), so one
that re-presents a rotated token still lands inside the grace window. On a
page load (`AuthGate`) the app keeps showing "Connecting..." and tries again
while the server can't answer, instead of showing the login page.

### RBAC Pattern

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

The guard resolves the resource (channel -> community), loads the user's roles for that community, and checks if any role includes the required action.

---

## WebSocket Architecture

### Gateways

- **MessagesGateway** -- `SEND_MESSAGE`, `EDIT_MESSAGE`, `DELETE_MESSAGE`, reactions, typing
- **PresenceGateway** -- User connect/disconnect, online status

Both gateways use `JwtWsGuard` for authentication.

### Socket Sessions

A socket authenticates once, in `RoomsGateway`'s connection middleware, and
stays bound to that access token (`SocketSessionService`):

- It joins `user:<id>`, `session:<sid>` and `token:<jti>` right away. Ending
  sessions (`SessionRevocationService` -> domain event ->
  `SessionRevocationHandler`) disconnects exactly those rooms with
  `disconnectSockets()`, on every instance through the Redis adapter. The
  client first gets `SESSION_TERMINATED` with the reason: `LOGGED_OUT`,
  `SESSION_REVOKED`, `PASSWORD_CHANGED`, `ACCOUNT_BANNED`, `ACCOUNT_DELETED`
  or `TOKEN_EXPIRED`.
- It ends when its token expires. Two minutes before, the server sends
  `TOKEN_EXPIRING`; the client refreshes its token and sends it with
  `REAUTHENTICATE`, which keeps the connection. `SocketProvider` does this,
  and refreshes and reconnects after a `SESSION_TERMINATED` disconnect (or
  signs out when the session can't be refreshed).

A community ban or kick doesn't end the session: it takes the user's sockets
out of that community's rooms (`RoomSubscriptionHandler`).

### WebsocketService

Central service for broadcasting events to rooms:

```typescript
this.websocketService.sendToRoom(
  RoomName.community(communityId),
  ServerEvents.CHANNEL_CREATED,
  payload,
);
```

### Redis Adapter

In multi-pod deployments, `RedisIoAdapter` ensures Socket.IO events reach all connected clients regardless of which pod they're connected to.

### Event Emission

Two patterns coexist:

1. **EventEmitter2** -- Services emit domain events; `RoomSubscriptionHandler` translates to WebSocket broadcasts. Used when the service doesn't have `WebsocketService` injected.
2. **Direct** -- Gateways and hybrid services call `websocketService.sendToRoom()` directly.

See [WebSocket Patterns](websocket-patterns.md) for the full guide.

---

## Key Patterns

### Sensitive User Fields

Never return raw Prisma `User` objects. Always wrap in `new UserEntity(user)` which applies `@Exclude()` decorators. Use `PUBLIC_USER_SELECT` constant for database queries to avoid fetching sensitive fields.

### OpenAPI/Swagger

- Add `@ApiProperty({ enum: XxxValues })` for Prisma enums (NestJS Swagger plugin can't introspect them)
- Import `PartialType` from `@nestjs/swagger`, **not** `@nestjs/mapped-types`
- Add `@ApiOkResponse({ type: FooDto })` to controllers for typed responses

### File Serving

Files are served through authenticated endpoints with range request support for video streaming. The `FileService` validates access permissions before serving.
