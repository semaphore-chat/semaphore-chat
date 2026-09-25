# Frontend Architecture

The frontend is a **React 19 + TypeScript + Vite** application in `frontend/src/` using Material UI for components and TanStack Query v5 for server state.

## State Management

### TanStack Query v5

**All server state** is managed through TanStack Query. There is no Redux store or other client-side state manager.

```typescript
// Fetching data
const { data: channels } = useQuery({
  queryKey: channelsControllerFindAllForCommunityQueryKey({ path: { communityId } }),
  queryFn: () => channelsControllerFindAllForCommunity({ path: { communityId } }),
});

// Mutations
const { mutate } = useMutation({
  mutationFn: (dto) => messagesControllerCreate({ body: dto }),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ['messages'] }),
});
```

### Generated API Client

The frontend uses a **generated TypeScript client** from the backend's OpenAPI spec, located in `api-client/`. Functions are fully typed and follow the pattern `controllerNameMethodName()`.

```typescript
import { messagesControllerCreate } from '../api-client';
```

Never use raw `fetch` or `client.post()` -- always use generated SDK functions.

### Real-Time Cache Sync

WebSocket events keep the TanStack Query cache in sync:

- **Direct updates**: High-frequency events (messages, reactions, presence) write directly to the cache via `queryClient.setQueryData()`
- **Invalidation**: Low-frequency events (channels, roles, settings) mark the cache stale via `queryClient.invalidateQueries()`
- **Ephemeral**: Transient events (typing indicators) use local component state via `useServerEvent()`

See [WebSocket Patterns](websocket-patterns.md) for the full decision framework.

---

## Socket Hub

The `socket-hub/` directory manages all WebSocket communication:

```
socket-hub/
  SocketHubProvider.tsx   -- Context provider, connects on mount
  useServerEvent.ts       -- Hook for ephemeral events in components
  useSocketHub.ts         -- Access the socket hub context
  emitter.ts              -- Client-side event emitter
  handlers/
    index.ts              -- Handler registry (maps events to handlers)
    messageHandlers.ts    -- NEW_MESSAGE, UPDATE_MESSAGE, DELETE_MESSAGE, reactions
    threadHandlers.ts     -- Thread reply events
    communityHandlers.ts  -- Channel/community CRUD events
    roleHandlers.ts       -- Role CRUD and assignment events
    presenceHandlers.ts   -- Online/offline, profile updates
    voiceHandlers.ts      -- Voice presence join/leave/update
    moderationHandlers.ts -- Ban, kick, timeout events
    notificationHandlers.ts -- Notification events
    reconnectHandlers.ts  -- Reconnection state sync
```

The `SocketHubProvider` connects to Socket.IO on mount, registers all handlers from the registry, and passes the `queryClient` to each handler for cache manipulation.

---

## Component Organization

Components are organized by feature under `components/`:

| Directory | Purpose |
|-----------|---------|
| `Channel/` | Channel views, message list, composer |
| `Community/` | Community sidebar, settings, member list |
| `CommunityList/` | Left sidebar community icons |
| `Common/` | Shared components (UserAvatar, modals, etc.) |
| `DirectMessage/` | DM conversation view |
| `DirectMessages/` | DM list and group management |
| `Friends/` | Friend list, requests |
| `Message/` | Message rendering, reactions, attachments |
| `Mobile/` | Mobile-specific layout and navigation |
| `Moderation/` | Ban, kick, timeout dialogs and panels |
| `NavBar/` | Top navigation bar |
| `Notifications/` | Notification center and badges |
| `Onboarding/` | Instance setup wizard |
| `Profile/` | User profile cards and settings |
| `Settings/` | User settings pages |
| `Thread/` | Thread panel and reply list |
| `Voice/` | Voice/video UI, controls, participant tiles |
| `admin/` | Instance admin panel |
| `Electron/` | Desktop app specific components |
| `PWA/` | Progressive Web App install prompts |

---

## Contexts

React contexts provide cross-cutting state:

| Context | Purpose |
|---------|---------|
| `VoiceContext` | Active voice connection state, join/leave/mute |
| `AvatarCacheContext` | Authenticated avatar URL caching |
| `ThreadPanelContext` | Thread panel open/close state |
| `ReplayBufferContext` | Replay buffer session state |
| `RoomContext` | LiveKit room instance |
| `VideoOverlayContext` | Video overlay visibility |
| `ThemeContext` | Theme preferences (accent color, intensity) |
| `NotificationContext` | Notification state and display |
| `UserProfileContext` | Profile card popover state |

---

## Custom Hooks

~47 hooks in `hooks/` encapsulate reusable logic:

**Messaging**: `useMessages`, `useSendMessage`, `useMentionAutocomplete`, `useMessagePermissions`, `useMessageVisibility`, `useMessageFileUpload`

**Voice**: `useVoiceConnection`, `useRoom`, `useScreenShare`, `useLocalMediaState`, `useDeviceSettings`, `useDeviceTest`, `usePushToTalk`, `useSpeakingDetection`, `useVoiceParticipantCount`, `useVoicePresenceHeartbeat`, `useVoiceRecovery`, `useVoiceSettings`, `useParticipantTracks`, `useDeafenEffect`

**Real-time**: `useSocket`, `useTypingUsers`, `useTypingEmitter`, `useNotifications`, `useNotificationSideEffects`, `useAutoMarkNotificationsRead`, `useReadReceipts`

**Threads**: `useThreadReplies`, `useThreadSubscription`

**Media**: `useAuthenticatedFile`, `useAuthenticatedImage`, `useFileUpload`, `useReplayBuffer`

**UI**: `useResponsive`, `useSwipeGesture`, `useHapticFeedback`, `useDebounce`, `useThemeSync`, `usePWA`, `usePWAInstall`

**Profile**: `useCurrentUser`, `useProfileForm`, `useCommunityForm`

---

## Platform Separation (Web vs Electron)

Use the centralized platform utility for detection:

```typescript
import { isElectron, isWeb, hasElectronFeature } from './utils/platform';
```

Platform differences are encapsulated in hooks (e.g., `useScreenShare()` handles Electron source picker vs browser native). Keep platform checks out of components. The Electron preload API (`window.electronAPI`) is read only by `utils/electronBridge.ts`: non-React code calls `getElectronAPI()`, components and hooks call `useElectronAPI()` (overridable with `<ElectronProvider>`), and tests fake it with `createFakeElectronAPI()`. See [Code Patterns](../contributing/code-patterns.md#the-electron-bridge).
