# Adding stories for a UI change

Stories are how the UI review sees your change: a changed line that no story renders can't be screenshotted, and a state no story sets up can't be reviewed. Add stories in the same PR as the change. They're sandbox-only code (`frontend/src/stories/`), rendered by Ladle against MSW fixtures, with no backend. The contributor guide with worked examples (fake socket pushes, Electron stories, a checklist of states) is `docs-site/docs/contributing/stories.md`; this file is the agent's quick reference.

## Contents

- Where stories live and how ids are formed
- What a story file may export, and where shared helpers go
- Screen, component and edge-state stories
- Viewports: limiting a story to some widths
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

A story id is `<file>--<export>`, both in Ladle's kebab case. `<file>` is the file name up to its first `.`, and `<export>` is the export name. Ladle's kebab case works like this:

- A capital letter starts a new word, and everything is lower-cased: `EverythingAtOnce` gives `everything-at-once`.
- A run of capitals is one word: `DmComposerLoaded` and `DMComposerLoaded` both give `dm-composer-loaded`.
- **Digits stay attached to the word before them:** `LongNamesNarrow320` gives `long-names-narrow320`, not `...-narrow-320`.

So `EdgeChatWorstCase.stories.tsx` with `export const EverythingAtOnce` gives `edge-chat-worst-case--everything-at-once`. After any run, every id is listed in `.ui-review/work/head-meta.json` (`jq -r '.stories | keys[]' .ui-review/work/head-meta.json`). A `--stories` id that doesn't exist stops the run, and the error suggests the right spelling or lists the ids of that file.

The tool starts its own Ladle each run, so new story files are picked up without restarting anything.

## What a story file may export, and where shared helpers go

**Every named export of a `*.stories.tsx` file becomes a story.** Ladle doesn't check what the export is: an exported helper function or data object shows up as a broken story, and `export type` breaks the file. Keep non-story values unexported, and put anything two story files share in `frontend/src/stories/fixtures/`, next to similar helpers (`fixtures/edge/nav.ts` for navigation data, `fixtures/edge/chat.ts` for chat channels, and so on).

Editing a fixture file is usually an ordinary change. The review's probe keeps only the stories that run the lines you changed: a new function brings in the stories that call it, and a new top-level constant brings in the stories whose files import that fixture. Only the harness that nearly every story loads makes the change **global**, which turns the review into a 40-story sample. Those fixture files are currently:

- `SandboxShell.tsx`, `AuthenticatedShell.tsx`, `StoryRoutes.tsx`, `handlers.ts`, `builder.ts`, `types.ts`, `auth.ts`, `avatars.ts`, `fakeSocket.ts` and `rng.ts`;
- plus `.ladle/**`, `src/theme/**` and the app modules the harness imports directly (`Layout.tsx`, the context providers).

The rule behind the list: a fixture file that at least 90% of story files load is global. Every other fixture file, including `scenarios.ts`, `modifiers.ts`, `handlerHelpers.ts`, `screenStory.tsx`, `componentStory.tsx`, `interactions.tsx` and `edge/*.ts`, is not. The section's "Global change" note names the files that made a run global.

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

**Component stories use a different accent colour.** A `defineComponent` story renders without `Layout`, so nothing applies the scenario's appearance settings, and it keeps the theme defaults: teal accent, minimal intensity. Screen and edge stories go through `Layout`, which applies the scenario's `/api/appearance-settings`: blue accent, balanced intensity. So a component story and a screen story of the same UI differ in accent colour. That is expected, not a regression. In the review, both sides of a story use the same theme, so it never shows up as a change. (In an interactive Ladle tab the theme is kept in `localStorage`, so a component story opened after a screen story shows blue there.)

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

## Viewports: limiting a story to some widths

Every story is captured at phone (390×844), tablet (820×1180) and desktop (1440×900). A story whose id contains `keyboard` is captured only at `phone-short` (390×500), which approximates an on-screen keyboard.

A story that only makes sense at some widths names them in its Ladle meta. For example, a 320 px column is a phone layout: at tablet and desktop the app uses other layouts, so shots there would show something the app never renders.

```tsx
export const LongNamesNarrow320 = defineComponent(scenario, () => (
  <Box sx={{ width: 320 }}><NotificationList /></Box>
), { maxWidth: false });
LongNamesNarrow320.meta = { viewports: ['phone'] };
```

- The names are `phone`, `phone-short`, `tablet` and `desktop`. The type (`StoryMeta` in `fixtures/screenStory.tsx`) catches typos, and the review stops on an invalid list.
- Ladle reads the meta statically, so it must be a top-level `MyStory.meta = { ... };` statement with an object literal: no variables, no `as const`, and not set inside a helper.
- The review probes, captures and compares the story only at those viewports, on both sides. `scripts/ux-shots.mjs` honours it too.
- Use it only for widths the app can't show at the other viewports. Leave everything else at all three, so a regression at another width stays visible.

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
- **Layout:** phone, tablet and desktop are captured automatically. Add a `keyboard` story when the composer or bottom UI matters with a keyboard open, and a narrow story (limited to `phone`, see "Viewports") when the narrowest supported phone matters.

## Determinism rules

The review captures both sides with the clock frozen at `2026-09-22T18:30:00Z` (fixture epoch plus 30 minutes) and CSS animations disabled. A difference between two captures of the same code shows up as **unstable** noise. So:

- Build data from a fixed `seed` and fixed ids. Don't use `Math.random()`, `Date.now()`, `crypto.randomUUID()`, or counters that depend on render order in story or fixture code.
- Open menus and popovers only after the content under them has settled. Give images fixed sizes (`sizedImageId`), and add a condition step before the click (not `wait()`, see the next rule). Opening a menu while media is still sizing is exactly what makes `edge-chat-worst-case--everything-at-once` and `edge-chat-dm--dm-composer-loaded` flaky.
- Make each driver step check its own precondition: return `false` until the element it needs exists. Fixed delays alone race, and **`wait(ms)` never completes in the review**: it measures elapsed time with `Date.now()`, which the capture freezes, so the driver stops at that step (the stories that still use it, such as `edge-chat-dm--dm-composer-loaded`, are captured stuck there). Poll a condition instead (`messageListSteady()`, the element exists), or use `setTimeout`, which still runs.
- Don't rely on long timers. `Date` is frozen, but timers run. The capture waits for network idle, then for the DOM and network to be quiet for 0.8 s (at most 10 s), then 1.5 s more. A state that appears on a longer timer may or may not be in the shot.

## Validate

Run the checks in the review image. `--exec` works in any checkout or worktree and generates the gitignored API client first. (`docker compose run frontend ...` needs `backend/.env`, which only the main checkout has, and a generated `src/api-client/`.)

```bash
frontend/scripts/ui-review/ui-review.sh --exec 'pnpm run type-check'
frontend/scripts/ui-review/ui-review.sh --exec 'pnpm exec eslint src/stories/edge/nav/MyStories.stories.tsx'   # paths relative to frontend/
```

Then run the UI review (`--stories <new ids>` for a quick look, and the normal run at the end). New stories appear under **New stories** with after-only composites. Review them like changed ones. For a bug fix, the SKILL.md step 2 explains how to see a new story before and after the fix. Also check that they show no console issues (a missing MSW handler shows as an unhandled request).
