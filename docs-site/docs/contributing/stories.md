# Writing Sandbox Stories

The frontend has a [Ladle](https://ladle.dev/) sandbox: stories in
`frontend/src/stories/` render the real app screens and components against
fake data served by [MSW](https://mswjs.io/), with no backend, database or
LiveKit. Stories are what the [UI review](ui-review.md) screenshots at phone,
tablet and desktop, what reviewers look at in a pull request, and what the
[README and docs media](regenerating-screenshots.md) are made from.

## The rule: every UI change comes with stories

When you build or change frontend UI (a component, a page, a layout, a style,
or a hook or util that drives what renders), add or update stories **in the
same pull request**, the way you add unit tests. Cover the states the change
introduces or touches, not only the happy path:

- loading, empty and error;
- long, unbroken or overflowing content, and many items;
- the narrowest phone width, when the layout is tight;
- permission and role variants, when controls depend on them;
- Electron-only UI, rendered with `asElectron`.

A state no story renders can't be screenshotted, so it can't be reviewed. The
UI review lists changed files that no story reaches and changes that no
captured story shows; either one is a gap to close in the same PR, not a
follow-up. Diffs that can't change what renders (tests, docs, CI, the
generated API client) don't need stories.

## Where stories go

| Kind | Directory | Helper |
|------|-----------|--------|
| A whole screen at a route, with realistic data | `stories/screens/` | `defineScreen` (`fixtures/screenStory.tsx`) |
| One component on its own | `stories/components/` | `defineComponent` (`fixtures/componentStory.tsx`) |
| Edge states: long data, empty, loading, errors, offline, theme, permissions | `stories/edge/{chat,nav,states,voice}/` | `edgeScreen` (`fixtures/edge/states.ts`), `defineNavScreen` (`fixtures/edge/nav.ts`), `defineEdgeScreen` (`fixtures/edge/voice.ts`) |
| README and docs media | `stories/tour/` | `defineShowcase` (`fixtures/showcaseStory.ts`) |

Put a state in the file of the area it belongs to (a new chat loading state
goes into `edge/states/EdgeStatesLoading.stories.tsx` or next to the other chat
stories), or start a new file when the area has none.

The `tour--*` stories are the marketing screens the README hero, the screenshot
grid and the [Tour](../tour.md) page are generated from, rendered against the
hand-written showcase scenario. Don't add review or edge-case stories there;
change them only as part of regenerating the media (see
[Regenerating Screenshots](regenerating-screenshots.md)).

Two rules about story files:

- **Every named export of a `*.stories.tsx` file is a story.** Ladle doesn't
  check what the export is, so an exported helper or data object shows up as a
  broken story and `export type` breaks the file. Keep helpers unexported, and
  put anything two story files share in `frontend/src/stories/fixtures/`, next
  to similar helpers (for example `fixtures/edge/nav.ts`).
- **Don't change product code only to reach a state from a story.** Drive the
  UI into it from the story instead (see
  [Driving the UI into a state](#driving-the-ui-into-a-state)).

## Story ids

A story id is `<file>--<export>`, both in Ladle's kebab case. `<file>` is the
file name up to its first `.`, and the directory isn't part of it:

- a capital letter starts a new word: `EverythingAtOnce` → `everything-at-once`;
- a run of capitals is one word: `DMComposerLoaded` → `dm-composer-loaded`;
- digits stay on the word before them: `LongNamesNarrow320` → `long-names-narrow320`.

So `edge/nav/EdgeNavNotifications.stories.tsx` with
`export const LongNamesNarrow320` is `edge-nav-notifications--long-names-narrow320`.
The UI review's `--stories` option, the screenshot sweep's `UX_SHOTS_FILTER`
and Ladle's URL (`?story=<id>`) all use these ids. Name exports after the
state they show (`ChannelList500`, `DmHeader`), and give each one a short doc
comment saying what it shows and why it matters.

## Preview a story

In the main checkout, run Ladle from the dev stack and open
<http://localhost:61000>:

```bash
docker compose --profile tools up -d ladle        # first start compiles for ~30 s
docker compose restart ladle                      # if a new *.stories.tsx file doesn't show up
docker compose stop ladle && docker compose rm -f ladle
```

Ladle's toolbar switches light and dark mode and the preview width; its a11y
panel runs axe on the story.

In a git worktree, don't start the dev stack's `ladle` (a compose project
there creates a Docker network, see
[Test Stacks](testing.md#test-stacks-and-the-shared-docker-network)). Render
the stories with the UI review tool instead. It serves the worktree's Ladle in
its own containers on the shared `semaphore-test` network and writes full-page
shots you can open:

```bash
frontend/scripts/ui-review/ui-review.sh --base origin/main --stories edge-states-loading--dm-header,edge-states-errors--dm-list500
# → .ui-review/shots/head/{phone,tablet,desktop}/<id>.png, plus the before/after composites for any change
```

Type-check and lint new story files like any other code:

```bash
scripts/test-stack.sh <ticket> run-frontend pnpm run type-check
scripts/test-stack.sh <ticket> run-frontend pnpm exec eslint src/stories/edge/states/EdgeStatesLoading.stories.tsx
```

## Data: scenarios, modifiers and handlers

Every story gets its data from a **scenario**: a plain object of users,
communities, channels, messages, DMs, notifications and friends that
`makeHandlers(scenario)` (`fixtures/handlers.ts`) serves as the MSW handlers
the app calls.

- **Presets** (`fixtures/scenarios.ts`): `bigCommunityScenario` ("me" as the
  instance owner, about 12 users, 2 communities, a 40-message `#general` with a
  thread, a pin, a mention and an attachment, 6 DMs) with handles into it
  (`primaryCommunity`, `generalChannel`, `secondChannel`, `primaryVoiceChannel`,
  `threadParentMessageId`, `firstDmGroup`), and `emptyUserScenario`, a new
  user with nothing.
- **`buildScenario(options)`** (`fixtures/builder.ts`) generates a seeded
  scenario: `seed`, `userCount`, `communityCount`, `textChannelsPerCommunity`,
  `voiceChannelsPerCommunity`, `messagesInGeneral`, `messagesPerOtherChannel`,
  `dmGroupCount`, `notificationCount`, `meOverrides`, `instanceName`. The same
  seed and options always give the same data.
- **Modifiers** return a changed copy: `withLongNames`, `withUnread`,
  `withVoiceParticipants`, `withThread`, `withAttachments` and `withEmpty`
  (`fixtures/modifiers.ts`); `withNoChannels`, `withNoDms`, `withNoUnread` and
  `withBareUser` (`fixtures/edge/states.ts`); `withMembers`, `withChannels`,
  `withCommunityCount`, `withDmGroups`, `withNotifications`, `withFriends` and
  `withUserPatch`, plus long values such as `MAX_DISPLAY_NAME`,
  `NO_SPACES_NAME`, `LONG_CHANNEL_NAME` and `MAX_BIO` (`fixtures/edge/nav.ts`).
- **Ready-made edge data**: `fixtures/edge/chat.ts` has channels for message
  content (`wallOfTextChannel`, `codeChannel`, `reactionsChannel`,
  `mediaChannel`, `historyChannel`, `worstChannel`, ...) in
  `edgeChatScenario`, served by `chatHandlers()`; `fixtures/edge/voice.ts` has
  voice rooms, personas and permission setups.
- **Handler overrides** go in `extraHandlers`, which MSW tries before the
  scenario's own: `withErrors(method, path, status)` and
  `withSlowEndpoint(method, path, ms)` (`fixtures/handlerHelpers.ts`),
  `withHangingEndpoint(method, path)` and `withStatusForId(id, status, body)`
  with `FORBIDDEN_BODY`, `NOT_FOUND_BODY` or `INTERNAL_ERROR_BODY`
  (`fixtures/edge/states.ts`).

Look for an existing helper before writing data by hand; most shapes exist.
A new, reusable one belongs in the matching fixtures file.

## A screen story

`defineScreen(scenario, path, options)` renders the real routes and `Layout`
at `path`. Options: `extraHandlers`, `overlay` (rendered next to the routes;
use it for drivers, see below) and `voiceState` (a faked voice connection).

```tsx
// frontend/src/stories/screens/ChannelChatBusy.stories.tsx (simplified)
import { defineScreen } from '../fixtures/screenStory';
import { bigCommunityScenario, primaryCommunity, generalChannel } from '../fixtures/scenarios';

/** #general in a busy community: a full page of messages, a thread, a pin and a mention. */
export const ChannelChatBusy = defineScreen(
  bigCommunityScenario,
  `/community/${primaryCommunity.id}/channel/${generalChannel.id}`,
);
```

## A component story

`defineComponent(scenario, render, options)` renders one component inside the
same providers (query client, router, auth, fake socket) without `Layout`.
Options: `maxWidth` (the padded wrapper's width, default 640; `false` for
none), `voiceState`, `isSocketConnected` and `extraHandlers`. The test
factories from `src/__tests__/test-utils/factories.ts` work here too.

```tsx
// frontend/src/stories/components/EmptyState.stories.tsx
import EmptyState from '../../components/Common/EmptyState';
import { defineComponent } from '../fixtures/componentStory';
import { bigCommunityScenario } from '../fixtures/scenarios';

export const Messages = defineComponent(bigCommunityScenario, () => <EmptyState variant="messages" />);
export const SearchResults = defineComponent(bigCommunityScenario, () => <EmptyState variant="search" />);
```

Component stories keep the theme's default accent colour, because nothing
applies the scenario's appearance settings without `Layout`. A component story
and a screen story of the same UI can differ in accent colour; that's
expected.

## Edge-case stories

`edgeScreen(scenario, path, options)` is `defineScreen` plus the app chrome
(connection banner, update toast, offline banner, install prompt) and toggles
for app-level states: `theme` (appearance settings served to the app),
`offline`, `isSocketConnected: false`, `updateAvailable`, `installPrompt`,
`voice` ("me" connected to the first voice channel), `extraHandlers` and
`overlay`.

```tsx
// frontend/src/stories/edge/states/EdgeStates*.stories.tsx (excerpts)
import {
  edgeScreen,
  withHangingEndpoint,
  withNoDms,
  withStatusForId,
  FORBIDDEN_BODY,
} from '../../fixtures/edge/states';
import { withErrors } from '../../fixtures/handlerHelpers';
import { buildScenario } from '../../fixtures/builder';
import { bigCommunityScenario as s, firstDmGroup } from '../../fixtures/scenarios';

/** Loading: the conversation and the DM list never answer, so the header shows its placeholder. */
export const DmHeader = edgeScreen(s, `/direct-messages/${firstDmGroup.id}`, {
  extraHandlers: [
    withHangingEndpoint('get', `/api/direct-messages/${firstDmGroup.id}`),
    withHangingEndpoint('get', '/api/direct-messages'),
  ],
});

/** Error: the DM list request fails. */
export const DmList500 = edgeScreen(s, '/direct-messages', {
  extraHandlers: [withErrors('get', '/api/direct-messages', 500)],
});

/** Empty: no conversations yet. */
export const DmListEmpty = edgeScreen(withNoDms(s), '/direct-messages');

/** Light theme. */
export const SettingsLight = edgeScreen(s, '/settings', {
  theme: { mode: 'light', accentColor: 'teal', intensity: 'minimal' },
});

/** Permissions: a plain member deep-linking into a private channel they aren't in. */
const member = buildScenario({ seed: 'busy-community', meOverrides: { role: 'USER' } });
const PRIVATE_CHANNEL_ID = 'channel-private-leadership';
export const Forbidden403PrivateChannel = edgeScreen(
  member,
  `/community/${member.communities[0].id}/channel/${PRIVATE_CHANNEL_ID}`,
  { extraHandlers: [withStatusForId(PRIVATE_CHANNEL_ID, 403, FORBIDDEN_BODY)] },
);
```

For permissions, the fixture handlers don't enforce any: a story sets both
who "me" is and what the API answers. The "me" of `bigCommunityScenario` is
the instance `OWNER`, who skips RBAC entirely, so a restricted view needs a
plain `USER` (`meOverrides: { role: 'USER' }`) **and** the answers that user
would get: 403s for what they can't read (`withStatusForId`, `withErrors`),
and for a control that depends on a community role, the `/api/roles/my/...`
answers the UI checks. `asCommunityRole(scenario, communityId, role)` in
`fixtures/edge/voice.ts` returns both the scenario and those handlers.

### Driving the UI into a state

A state that lives in component state (an open menu, drawer or panel, a typed
draft, a scroll position) is set up by an `overlay` that acts on the DOM once
the screen has rendered:

- `ClickOnMount` (`fixtures/interactions.tsx`) polls for an element and clicks
  it, e.g. `<ClickOnMount find={() => findButtonByIconTestId('PeopleIcon')} />`,
  with finders from `fixtures/domQueries.ts` (`findButtonByIconTestId`,
  `findButtonByText`, `findMenuItemByText`, `findRoleButtonContaining`).
- `ScrollToBottomOnMount`, `TypeIntoTextareaOnMount` and `AttachFileOnMount`
  scroll a list to its end, type a draft and attach a file.
- `useDriver(steps, { pollMs })` (`fixtures/edge/chat.ts`) runs steps in
  order. A step that returns `false` is retried every `pollMs`, so each step
  can wait for what it needs. Chat helpers: `findMessageRow`,
  `openMessageActions` (long-press on touch, right-click otherwise),
  `clickActionItem`, `composerTextarea`, `typeInto`, `attachFiles`,
  `messageListSteady` (the message list has finished its initial positioning)
  and `scrollMessageListToLoad`.

`hangingPageLoads(direction)` holds the older or newer page of a channel's
messages forever, so the list stays in its "loading more" state. Together with
a driver that scrolls to that edge:

```tsx
// frontend/src/stories/edge/chat/EdgeChatHistory.stories.tsx (excerpt)
import React from 'react';
import { defineScreen } from '../../fixtures/screenStory';
import {
  edgeChatScenario,
  chatHandlers,
  channelPath,
  historyChannel,
  useDriver,
  hangingPageLoads,
  messageListSteady,
  scrollMessageListToLoad,
} from '../../fixtures/edge/chat';

/** Scrolled to the top of the latest page, waiting on the next older page. */
const ScrollToTopAfterLoad: React.FC = () => {
  // Polls instead of wait(): the capture freezes Date.now().
  useDriver([messageListSteady(), scrollMessageListToLoad('top')], { pollMs: 50 });
  return null;
};

/** Loading an older page: a thin bar on the list's top edge, the rows don't move. */
export const LoadingOlderPage = defineScreen(edgeChatScenario, channelPath(historyChannel), {
  extraHandlers: [hangingPageLoads('older'), ...chatHandlers(edgeChatScenario)],
  overlay: <ScrollToTopAfterLoad />,
});
```

### Server pushes: the fake socket

Stories get a fake Socket.IO client (`fixtures/fakeSocket.ts`). Its
`receive(event, payload)` delivers an event to the app's handlers as if the
server had pushed it, which is how a story shows real-time state.
`useSimulateTyping` (`fixtures/typing.ts`) and `useSimulateReactions`
(`fixtures/reactions.ts`) are ready-made hooks for typing indicators and
incoming reactions; see `screens/TypingIndicator.stories.tsx`. A new kind of
push follows the same pattern: a small hook in `fixtures/` that gets the
socket with `useSocket()` and calls `receive()` with a typed payload from
`@semaphore-chat/shared`.

## Viewports

Every story is captured at phone (390×844), tablet (820×1180) and desktop
(1440×900). Stories whose id contains `keyboard` are captured only at
`phone-short` (390×500), which approximates an open on-screen keyboard.

A story that only makes sense at some widths names them in its meta:

```tsx
LongNamesNarrow320.meta = { viewports: ['phone'] };
```

Ladle reads it statically, so it has to be a top-level statement with an
object literal (no variables, no `as const`). The names are `phone`,
`phone-short`, `tablet` and `desktop`. Use it only for widths the app can't
show at the others (a 320 px column is a phone layout; Electron windows are
at least 800 px wide); leave everything else at all three so a regression at
another width stays visible.

## Electron-only UI

`asElectron(Story, overrides)` (`fixtures/electron.tsx`) renders a story as
the Electron desktop app sees it: `isElectron()` is true and the bridge is
`createFakeElectronAPI(overrides)` from
`src/__tests__/test-utils/fakeElectronAPI.ts`, the same fake the unit tests
use. By default the fake has every bridge method with neutral results (no
update events, no desktop sources, secure storage available). Pass overrides
to show Electron-only UI: `emitOnSubscribe(value)` fires an event as soon as
the component subscribes, and `FAKE_DESKTOP_SOURCES`
(`fixtures/desktopSources.ts`) has screens and windows with generated
thumbnails for the screen-share picker. Limit these stories to `tablet` and
`desktop`.

```tsx
// frontend/src/stories/components/AutoUpdater.stories.tsx (excerpt)
import { AutoUpdater } from '../../components/Electron/AutoUpdater';
import { emitOnSubscribe } from '../../__tests__/test-utils/fakeElectronAPI';
import { defineComponent } from '../fixtures/componentStory';
import { asElectron } from '../fixtures/electron';
import { bigCommunityScenario } from '../fixtures/scenarios';

const update = { version: '1.4.0', releaseDate: '2026-09-21T12:00:00Z' };
const updater = () => defineComponent(bigCommunityScenario, () => <AutoUpdater />, { maxWidth: false });

/** Downloaded: "Restart Now" installs it. */
export const UpdateReady = asElectron(updater(), {
  onUpdateAvailable: emitOnSubscribe(update),
  onUpdateDownloaded: emitOnSubscribe(update),
});
UpdateReady.meta = { viewports: ['tablet', 'desktop'] };
```

`screens/ElectronWindow.stories.tsx` shows whole screens in a narrow Electron
window, and `components/ScreenSourcePicker.stories.tsx` the screen-share
picker.

## Determinism rules

The UI review captures the base and your branch and compares them pixel by
pixel, so the same code has to render the same pixels every time. The capture
freezes the clock at `2026-09-22T18:30:00Z` (`Date.now()` and `new Date()`
always return it; timers still run), disables CSS animations, and waits for
the network and the DOM to go quiet before each shot.

- **Fixed data.** Build data from a fixed `seed` and fixed ids, with dates
  from `timeAgo(minutes)` (`fixtures/rng.ts`, relative to a fixed epoch).
  Don't use `Math.random()`, `Date.now()`, `crypto.randomUUID()` or counters
  that depend on render order in story or fixture code.
- **No network.** Every request has to be answered by an MSW handler; an
  unhandled one is a console issue in the review. Images are generated SVGs
  (`initialsAvatar`, `placeholderPhoto`, `sizedImageId` for an image of a
  given size), and URLs outside the app (GIFs, link previews) need a handler
  too, like the ones in `chatHandlers()`.
- **Poll conditions, not time.** With the clock frozen, anything that measures
  elapsed time with `Date.now()` doesn't advance during a capture: a `wait(ms)`
  driver step never completes there, and a `ClickOnMount` never gives up.
  Make each step check its own precondition (the element exists, the list is
  steady) and return `false` until it holds. If you need a delay, use
  `setTimeout`, which still runs.
- **Settle before you open.** Open menus and popovers only after the content
  under them has settled (images sized, list positioned), or the menu anchors
  differently from run to run and the story shows up as unstable.
- **No animations or long timers.** CSS animations are off, so a state that
  only exists mid-animation can't be captured. The capture waits about 0.8 s
  of quiet (at most 10 s) plus 1.5 s; a state that appears on a longer timer
  may or may not be in the shot. A hanging request is the reliable way to hold
  a loading state.

## Checklist

For each new or changed piece of UI, go through the states it can be in and
make sure a story shows each one that could break:

- [ ] The default, loaded state.
- [ ] Loading (`withHangingEndpoint`, `hangingPageLoads`).
- [ ] Empty: no items (`withEmpty`, `withNo*`), and a single item.
- [ ] Errors: 500, 403 and 404 (`withErrors`, `withStatusForId`).
- [ ] Long content: maximum-length and unbroken names, long channel and
      community names, multi-line text, wide code blocks and URLs.
- [ ] Many items: scrolling, overflow, "+N more", counts past 99.
- [ ] Unread and mention badges (`withUnread`).
- [ ] Permission and role variants: owner or admin versus a plain member.
- [ ] Phone, tablet and desktop (automatic), a narrow phone column when the
      layout is tight, and a `*Keyboard` story when the composer or bottom UI
      matters with the keyboard open.
- [ ] Dark (the default) and light, when colours are involved.
- [ ] Offline, disconnected or connected to voice, when the UI reacts to them.
- [ ] Electron-only UI (`asElectron`).
- [ ] States behind an interaction: open menus, drawers, dialogs, typed
      drafts.

Then run the [UI review](ui-review.md) and look at the new stories: they show
up as **new**, with after-only screenshots.
