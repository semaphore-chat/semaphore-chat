# WebSocket Event Patterns

Semaphore Chat uses three distinct patterns for handling WebSocket events on the frontend. This guide defines when to use each and why.

**This is not a style preference -- each pattern exists for specific technical reasons.**

---

## The Three Patterns

### Pattern 1: Direct Cache Update (`setQueryData`)

The WebSocket event carries the full data object. The frontend writes it directly into the TanStack Query cache. **No HTTP refetch occurs.**

```typescript
// Example: messageHandlers.ts
export const handleNewMessage: SocketEventHandler = (payload, queryClient) => {
  queryClient.setQueryData(queryKey, (old) => {
    return { ...old, pages: [[payload.message, ...old.pages[0]], ...old.pages.slice(1)] };
  });
};
```

### Pattern 2: Cache Invalidation (`invalidateQueries`)

The WebSocket event carries a minimal signal (e.g., IDs). The frontend marks the cache as stale, triggering a refetch from the REST API.

```typescript
// Example: communityHandlers.ts
export const handleChannelCreated: SocketEventHandler = (payload, queryClient) => {
  queryClient.invalidateQueries({
    queryKey: channelsControllerFindAllForCommunityQueryKey({
      path: { communityId: payload.communityId },
    }),
  });
};
```

### Pattern 3: Ephemeral UI State (no cache)

The event drives transient component state via `useServerEvent()`. Not registered in `handlerRegistry`. No TanStack Query involvement.

```typescript
// Example: useTypingUsers.ts
useServerEvent(ServerEvents.USER_TYPING, (payload) => {
  setTypingUsers((prev) => { /* local state only */ });
});
```

---

## Decision Framework

Ask these five questions for each new WebSocket event:

| # | Question | Direct Update | Invalidation |
|---|----------|---------------|--------------|
| 1 | **How often does this event fire?** | High: multiple times/second (messages, typing, presence) | Low: minutes/hours apart (roles, settings, channels) |
| 2 | **How many clients receive it simultaneously?** | Many: dozens/hundreds in same channel (thundering herd risk) | Few: only affected users |
| 3 | **Is the cache shape simple?** | Yes: append to list, update single field, toggle boolean | No: nested structures, multiple query keys, computed fields |
| 4 | **Does the user expect instant feedback?** | Yes: chat messages, reactions, presence | No: 100-200ms delay is acceptable (admin changes, settings) |
| 5 | **Does the payload contain everything needed?** | Yes: full object, self-contained | No: server computes extra fields (counts, permissions, aggregations) |

**If most answers point to one column, use that pattern.** When in doubt, default to invalidation -- it's simpler and guarantees consistency.

---

## Current Event Inventory

### Direct Cache Updates (high-frequency, latency-sensitive)

| Event | Handler File | Why Direct |
|-------|-------------|------------|
| `NEW_MESSAGE` / `NEW_DM` | `messageHandlers.ts` | High frequency, full payload, instant UX required |
| `UPDATE_MESSAGE` | `messageHandlers.ts` | Full message in payload, simple find-and-replace |
| `DELETE_MESSAGE` | `messageHandlers.ts` | Just needs ID to filter from list |
| `REACTION_ADDED/REMOVED` | `messageHandlers.ts` | High frequency during active chat |
| `MESSAGE_PINNED/UNPINNED` | `messageHandlers.ts` | Single boolean toggle on cached message |
| `THREAD_REPLY_COUNT_UPDATED` | `messageHandlers.ts` | Updates metadata field on parent message |
| `READ_RECEIPT_UPDATED` | `messageHandlers.ts` | Updates unread count, simple field |
| `NEW_THREAD_REPLY` / `UPDATE` / `DELETE` | `threadHandlers.ts` | Same rationale as messages |
| `USER_ONLINE/OFFLINE` | `presenceHandlers.ts` | Very frequent, simple boolean per user |
| `NEW_NOTIFICATION` / `NOTIFICATION_READ` | `notificationHandlers.ts` | Full payload, append/update in list |
| `VOICE_CHANNEL_USER_JOINED/LEFT/UPDATED` | `voiceHandlers.ts` | Hybrid: `setQueryData` if cached, `invalidateQueries` fallback |
| `DM_VOICE_USER_JOINED/LEFT/UPDATED` | `voiceHandlers.ts` | Same hybrid pattern |

### Cache Invalidation (low-frequency, structural)

| Event | Handler File | Why Invalidation |
|-------|-------------|-----------------|
| `CHANNEL_CREATED/UPDATED/DELETED` | `communityHandlers.ts` | Affects channel list ordering, permissions, visibility |
| `CHANNELS_REORDERED` | `communityHandlers.ts` | Full list structure changes |
| `COMMUNITY_UPDATED/DELETED` | `communityHandlers.ts` | Affects sidebar, permissions, multiple query keys |
| `MEMBER_ADDED_TO_COMMUNITY` | `communityHandlers.ts` | New community structure unknown to client |
| `ROLE_CREATED/UPDATED/DELETED` | `roleHandlers.ts` | Complex permission matrix, multiple dependent caches |
| `ROLE_ASSIGNED/UNASSIGNED` | `roleHandlers.ts` | Affects permissions, member list, own roles |
| `USER_BANNED/KICKED` | `moderationHandlers.ts` | Membership/access changes, multiple caches |
| `USER_TIMED_OUT/TIMEOUT_REMOVED` | `moderationHandlers.ts` | Member state changes |
| `USER_PROFILE_UPDATED` | `presenceHandlers.ts` | Infrequent, profile cached in multiple places |
| `DM_VOICE_CALL_STARTED` | `voiceHandlers.ts` | Conservative: always refetch initial state |

### Ephemeral UI State (no cache)

| Event | Location | Why Ephemeral |
|-------|----------|--------------|
| `USER_TYPING` | `useTypingUsers.ts` | Transient (8s timeout), no persistence needed |
| `EGRESS_SEGMENTS_READY` | `TrimPreview.tsx` | Triggers one-time refetch, not ongoing state |
| `REPLAY_BUFFER_STOPPED/FAILED` | `useReplayBuffer.ts` | Session-scoped flag, resets on disconnect |
| `NEW_NOTIFICATION` (side effects) | `useNotificationSideEffects.ts` | Sound/desktop notification, not data |
| `TOKEN_EXPIRING` / `SESSION_TERMINATED` | `SocketProvider.tsx` | Connection lifecycle: refresh and re-authenticate, or reconnect ([Socket Sessions](backend.md#socket-sessions)) |

---

## The Hybrid Pattern (Voice Handlers)

Voice presence handlers demonstrate a best practice for mid-frequency events:

```typescript
const existing = queryClient.getQueryData(queryKey);
if (existing) {
  // Cache is warm (user is viewing) -- update directly for instant UX
  queryClient.setQueryData(queryKey, (draft) => { /* merge update */ });
} else {
  // Cache is cold -- just invalidate, refetch when needed
  invalidateVoiceQueries(queryClient);
}
```

This gives you the best of both worlds: instant updates when the user is looking, zero wasted work when they're not.

---

## Backend Event Emission

### Domain Events via EventEmitter2

Services that don't have `WebsocketService` injected emit domain events through `EventEmitter2`. The centralized `RoomSubscriptionHandler` translates these into WebSocket room operations.

```typescript
// In the service
this.eventEmitter.emit(RoomEvents.COMMUNITY_UPDATED, {
  communityId, name, description, avatar, banner,
});

// In RoomSubscriptionHandler
@OnEvent(RoomEvents.COMMUNITY_UPDATED)
onCommunityUpdated(event: CommunityUpdatedEvent): void {
  this.websocketService.sendToRoom(
    RoomName.community(event.communityId),
    ServerEvents.COMMUNITY_UPDATED,
    event,
  );
}
```

**Used by**: community, roles, user, membership, channel-membership, direct-messages, alias-groups

### Direct WebsocketService

Gateways and services that already have `WebsocketService` may call `sendToRoom()` directly.

```typescript
// In messages.gateway.ts
this.websocketService.sendToRoom(channelId, ServerEvents.NEW_MESSAGE, { message });
```

**Used by**: messages gateway, channels (hybrid), moderation (hybrid), voice-presence

### When to use which

- **New service needs to emit events?** Use `EventEmitter2` + add a handler in `RoomSubscriptionHandler`.
- **Already in a gateway with `WebsocketService`?** Direct `sendToRoom()` is fine.
- **Event requires room management (join/leave)?** Must use `EventEmitter2` + `RoomSubscriptionHandler`.

---

## Adding a New WebSocket Event

1. **Decide the pattern** using the decision framework above
2. **Shared types**: Add `ServerEvents` enum value + payload interface in `@semaphore-chat/shared`
3. **Backend**: Emit from service (EventEmitter2) or gateway (direct)
4. **Frontend handler**: Create handler function in `socket-hub/handlers/`
5. **Register**: Add to `handlerRegistry` in `handlers/index.ts` (skip for ephemeral events)
6. **For ephemeral events**: Use `useServerEvent()` in the consuming component instead

---

## References

- [TKDodo -- Using WebSockets with React Query](https://tkdodo.eu/blog/using-web-sockets-with-react-query)
- [TanStack Query -- Query Invalidation](https://tanstack.com/query/v5/docs/react/guides/query-invalidation)
