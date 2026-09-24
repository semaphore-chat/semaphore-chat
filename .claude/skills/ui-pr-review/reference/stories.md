# Adding stories for a UI change

Stories are how the UI review sees your change: a changed line that no story renders can't be screenshotted, and a state no story sets up can't be reviewed. Add stories in the same PR as the change. They're sandbox-only code (`frontend/src/stories/`), rendered by Ladle against MSW fixtures, with no backend.

## Contents

- Where stories live and how ids are formed
- Screen, component and edge-state stories
- Data: scenarios, modifiers, edge helpers
- Driving the UI into a state (menus, panels, typing)
- Which edge cases to add
- Determinism rules
- Validate

## Where stories live and how ids are formed

| Kind | Directory | Helper |
|------|-----------|--------|
| A whole screen at a route | `frontend/src/stories/screens/` | `defineScreen` (`fixtures/screenStory.tsx`) |
| One component in isolation | `frontend/src/stories/components/` | `defineComponent` (`fixtures/componentStory.tsx`) |
| Edge states (long data, empty, loading, errors, offline, theme, voice) | `frontend/src/stories/edge/{chat,nav,states,voice}/` | `edgeScreen` (`fixtures/edge/states.ts`), `defineNavScreen` (`fixtures/edge/nav.ts`) |

The story id is the file name in kebab case, then `--`, then the export name in kebab case. For example, `EdgeChatWorstCase.stories.tsx` with `export const EverythingAtOnce` gives `edge-chat-worst-case--everything-at-once`. After a run, every id is listed in `.ui-review/work/head-meta.json` (under `stories`). An id containing `keyboard` is captured only at `phone-short` (390×500), which approximates an on-screen keyboard.

The tool starts its own Ladle each run, so new story files are picked up without restarting anything.

## Screen, component and edge-state stories

```tsx
// screens/MyScreen.stories.tsx: the real routes and Layout at a path
import { defineScreen } from '../fixtures/screenStory';
import { bigCommunityScenario, primaryCommunity, generalChannel } from '../fixtures/scenarios';

export const MyScreen = defineScreen(bigCommunityScenario, `/community/${primaryCommunity.id}/channel/${generalChannel.id}`);
```

`defineScreen(scenario, path, { extraHandlers, overlay, voiceState })`: `extraHandlers` are MSW handlers tried before the scenario's handlers, `overlay` renders next to the routes (use it for interaction drivers), and `voiceState` fakes a voice connection.

```tsx
// components/MyWidget.stories.tsx: one component inside the provider stack
import { MyWidget } from '../../components/MyWidget';
import { defineComponent } from '../fixtures/componentStory';
import { bigCommunityScenario } from '../fixtures/scenarios';

export const Default = defineComponent(bigCommunityScenario, () => <MyWidget user={bigCommunityScenario.users[0]} />);
export const Narrow = defineComponent(bigCommunityScenario, () => <MyWidget user={bigCommunityScenario.users[0]} />, { maxWidth: 320 });
```

`defineComponent(scenario, render, { maxWidth = 640 | false, voiceState, isSocketConnected, extraHandlers })`. Test data factories from `src/__tests__/test-utils/factories.ts` (`createReaction`, `createMessage`, ...) work here too.

```tsx
// edge/states/...: app chrome plus edge-state toggles
import { edgeScreen, withHangingEndpoint } from '../../fixtures/edge/states';
import { bigCommunityScenario as s, primaryCommunity } from '../../fixtures/scenarios';

export const LightSettings = edgeScreen(s, '/settings', { theme: { mode: 'light', accentColor: 'teal', intensity: 'minimal' } });
export const ChannelListLoading = edgeScreen(s, `/community/${primaryCommunity.id}`, {
  extraHandlers: [withHangingEndpoint('get', `/api/channels/community/${primaryCommunity.id}`)],
});
```

`edgeScreen` options:

- `theme`: served from `/api/appearance-settings` and applied by the app itself.
- `offline`, `isSocketConnected: false` (shows the connection banner), `updateAvailable`, `installPrompt`.
- `voice`: "me" connected to the first voice channel.
- `extraHandlers`, `overlay`.

## Data: scenarios, modifiers, edge helpers

- **Presets** (`fixtures/scenarios.ts`):
  - `bigCommunityScenario`: "me" as instance owner, about 12 users, 2 communities, a 40-message #general with a thread, a pin, a mention and an attachment, 6 DMs, notifications and friends.
  - Handles into it: `primaryCommunity`, `generalChannel`, `secondChannel`, `primaryVoiceChannel`, `threadParentMessageId`, `firstDmGroup`.
  - `emptyUserScenario`: a brand-new user with nothing.
- **`buildScenario(options)`** (`fixtures/builder.ts`) generates deterministic, seeded data. Options: `seed`, `userCount`, `communityCount`, `textChannelsPerCommunity`, `voiceChannelsPerCommunity`, `messagesInGeneral`, `messagesPerOtherChannel`, `dmGroupCount`, `notificationCount`, `meOverrides`, `instanceName`. Same seed plus same options gives identical data.
- **Modifiers** (`fixtures/modifiers.ts`): `withLongNames`, `withUnread(s, contextId, unread, mentions)`, `withVoiceParticipants`, `withThread(s, channelId, parentId, replies)`, `withAttachments(s, channelId, 'image'|'video'|'audio'|'document')`, `withEmpty(s, section)`.
- **Handler helpers** (`fixtures/handlerHelpers.ts`, `fixtures/edge/states.ts`):
  - `withErrors(method, path, status)`: an error state.
  - `withSlowEndpoint(method, path, ms)`.
  - `withHangingEndpoint(method, path)`: a loading state that stays put.
  - `withStatusForId(id, status, body)` with `FORBIDDEN_BODY`, `NOT_FOUND_BODY` or `INTERNAL_ERROR_BODY`.
- **Edge data:**
  - `fixtures/edge/nav.ts`:
    - builders: `makeUsers`, `withMembers`, `withChannels`, `withCommunityCount`, `withDmGroups`, `withNotifications`, `withFriends`, `withUserPatch`, `worstCaseScenario`;
    - long values: `MAX_DISPLAY_NAME`, `NO_SPACES_NAME`, `LONG_CHANNEL_NAME`, `LONG_COMMUNITY_NAME`, `MAX_BIO`.
  - `fixtures/edge/states.ts`: `withNoChannels`, `withNoDms`, `withNoUnread`, `withBareUser`.
  - `fixtures/edge/chat.ts`: ready channels (`wallOfTextChannel`, `codeChannel`, `reactionsChannel`, `mediaChannel`, `filesChannel`, `threadsChannel`, `historyChannel`, `worstChannel`, ...) served by `chatHandlers(scenario)`.
  - `fixtures/edge/voice.ts`: voice personas and scenarios.

Before inventing data, look for a helper in these files. Most shapes already exist.

## Driving the UI into a state

A state that is local component state (an open panel, a menu, a typed draft) is set up from the story with an overlay:

- `ClickOnMount` (`fixtures/interactions.tsx`) polls for an element and clicks it once found, for example `<ClickOnMount find={() => findButtonByIconTestId('PeopleIcon')} />`. Finders are in `fixtures/domQueries.ts`: `findButtonByIconTestId`, `findButtonByText`, `findMenuItemByText`.
- `TypeIntoTextareaOnMount`, `AttachFileOnMount`: a composer with text or files.
- `useDriver(steps)` (`fixtures/edge/chat.ts`) runs a sequence of steps. A step returning `false` is retried until it succeeds. The helpers are `wait(ms)`, `findMessageRow`, `openMessageActions`, `clickActionItem`, `composerTextarea`, `typeInto` and `attachFiles`. See `edge/chat/EdgeChatWorstCase.stories.tsx`.

Don't change product code just to make a state reachable from a story, unless the lack of a seam is itself the problem and the user agrees.

## Which edge cases to add

For each new or changed piece of UI, ask which of these could break it, and add a story (or an export in an existing edge file) for the ones that could:

- **Long content:** a maximum-length name, an unbroken string (`NO_SPACES_NAME`), a long channel or community name, multi-line text, a wide code block or URL.
- **Quantity:** zero items (the empty state), one item, many items (scrolling, overflow, "+N more").
- **Async:** loading (`withHangingEndpoint`), error (`withErrors`, `withStatusForId`), slow, offline or disconnected.
- **Counts and badges:** unread, mentions, large numbers (99+).
- **Permissions:** owner or admin versus a plain member (`meOverrides`, roles), when controls depend on them.
- **Theme:** dark (the default) and light, when colours are involved (`edgeScreen(..., { theme })`).
- **Layout:** phone, tablet and desktop are captured automatically. Add a `keyboard` story when the composer or bottom UI matters with a keyboard open.

## Determinism rules

The review captures both sides with the clock frozen at `2026-09-22T18:30:00Z` (fixture epoch plus 30 minutes) and CSS animations disabled. A difference between two captures of the same code shows up as **unstable** noise. So:

- Build data from a fixed `seed` and fixed ids. Don't use `Math.random()`, `Date.now()`, `crypto.randomUUID()`, or counters that depend on render order in story or fixture code.
- Open menus and popovers only after the content under them has settled. Give images fixed sizes (`sizedImageId`), and add a condition or a `wait()` step before the click. Opening a menu while media is still sizing is exactly what makes `edge-chat-worst-case--everything-at-once` and `edge-chat-dm--dm-composer-loaded` flaky.
- Make each driver step check its own precondition: return `false` until the element it needs exists. Fixed delays alone race.
- Don't rely on long timers. `Date` is frozen, but timers run. The capture waits for network idle, then for the DOM and network to be quiet for 0.8 s (at most 10 s), then 1.5 s more. A state that appears on a longer timer may or may not be in the shot.

## Validate

```bash
docker compose run --rm --no-deps frontend pnpm run type-check
docker compose run --rm --no-deps frontend pnpm exec eslint <your story files>
```

Then run the UI review (`--stories <new ids>` for a quick look, and the normal run at the end). New stories appear under **New stories** with after-only composites. Review them like changed ones. Also check that they show no console issues (a missing MSW handler shows as an unhandled request).
