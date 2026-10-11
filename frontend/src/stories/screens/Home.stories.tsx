import { defineScreen } from '../fixtures/screenStory';
import { ClickOnMount } from '../fixtures/interactions';
import { asElectron } from '../fixtures/electron';
import { buildScenario } from '../fixtures/builder';
import { bigCommunityScenario } from '../fixtures/scenarios';
import { withEmpty, withLongNames, withUnread, withVoiceParticipants } from '../fixtures/modifiers';
import { withErrors } from '../fixtures/handlerHelpers';
import { withHangingEndpoint } from '../fixtures/edge/states';
import type { Scenario } from '../fixtures/types';

/*
 * Home ("/"): on desktop and in Electron, a summary of what's new: unread
 * mentions, DMs with unread messages and who is in voice across your
 * communities. Phone and tablet don't route "/" here (they show the channels
 * screen; see EmptyUserOnboarding for the zero-community pane there), so these
 * are desktop-only shots apart from the brand-new user.
 */

const [communityA, communityB] = bigCommunityScenario.communities;
const textChannels = (c: typeof communityA) => c.channels.filter((ch) => ch.type === 'TEXT');
const voiceChannel = (c: typeof communityA) => c.channels.find((ch) => ch.type === 'VOICE')!;

/** Mentions in both communities, the scenario's unread DMs, and voice in both communities. */
const busyScenario: Scenario = withVoiceParticipants(
  withUnread(
    withUnread(withUnread(bigCommunityScenario, textChannels(communityA)[0].id, 12, 3), textChannels(communityA)[2].id, 4, 1),
    textChannels(communityB)[1].id,
    7,
    2,
  ),
  voiceChannel(communityB).id,
  6,
);

/** No unread anything and nobody in voice. */
const quietScenario: Scenario = {
  ...bigCommunityScenario,
  unreadByContextId: {},
  voicePresenceByChannel: {},
};

/** A returning user (instance owner, so the invite card shows) with mentions, unread DMs and voice. */
export const Busy = defineScreen(busyScenario, '/');
Busy.meta = { viewports: ['desktop-1280', 'desktop', 'desktop-1920', 'desktop-2560'] };

/** Long community, channel and user names: rows truncate instead of wrapping. */
export const BusyLongNames = defineScreen(withLongNames(busyScenario), '/');
BusyLongNames.meta = { viewports: ['desktop-1280'] };

/** Nothing new: the "all caught up" card. A plain member, so no invite card either. */
export const CaughtUp = defineScreen(
  { ...quietScenario, me: { ...quietScenario.me, role: 'USER' } },
  '/',
);
CaughtUp.meta = { viewports: ['desktop-1280', 'desktop', 'desktop-1920', 'desktop-2560'] };

/** In Electron, nothing new: the desktop-app download card is gone from under the caught-up card. */
export const CaughtUpElectron = asElectron(defineScreen(quietScenario, '/'));
CaughtUpElectron.meta = { viewports: ['desktop'] };

/** Electron's narrow (820px) window. */
export const BusyElectronNarrow = asElectron(defineScreen(busyScenario, '/'));
BusyElectronNarrow.meta = { viewports: ['tablet'] };

/** Loading: unread counts hang, so the section skeletons show. */
export const Loading = defineScreen(busyScenario, '/', {
  extraHandlers: [withHangingEndpoint('get', '/api/read-receipts/unread-counts')],
});
Loading.meta = { viewports: ['desktop'] };

/** Unread counts fail: one retryable error instead of the summary. */
export const UnreadError = defineScreen(busyScenario, '/', {
  extraHandlers: [withErrors('get', '/api/read-receipts/unread-counts')],
});
UnreadError.meta = { viewports: ['desktop'] };

/** Brand-new user who may create communities: one "Create a community" step. */
export const NewUserCanCreate = defineScreen(
  withEmpty(
    withEmpty(buildScenario({ seed: 'empty-user', notificationCount: 0, meOverrides: { role: 'OWNER' } }), 'communities'),
    'dmGroups',
  ),
  '/',
);

/*
 * Wide layouts (by the page's own width): Mentions | Unread messages side by
 * side from 1200px, a side column for the invite and download cards from 1560px.
 */
const byLabel = (label: string) => () => document.querySelector<HTMLElement>(`[aria-label="${label}"]`);

/** Only mentions (no unread DMs, nobody in voice): Mentions spans the main area. */
export const MentionsOnly = defineScreen(withUnread(quietScenario, textChannels(communityA)[0].id, 12, 3), '/');
MentionsOnly.meta = { viewports: ['desktop', 'desktop-1920'] };

/** Electron (no download card): the side column holds the invite card alone. */
export const BusyElectronWide = asElectron(defineScreen(busyScenario, '/'));
BusyElectronWide.meta = { viewports: ['desktop-1920'] };

/** Electron with the invite card dismissed: nothing for the side column, so there is none. */
export const BusyElectronInviteDismissed = asElectron(
  defineScreen(busyScenario, '/', { overlay: <ClickOnMount find={byLabel('Dismiss invite card')} /> }),
);
BusyElectronInviteDismissed.meta = { viewports: ['desktop-1920'] };

/** The rail expanded at 1440: still two columns. */
export const BusyRailExpanded = defineScreen(busyScenario, '/', {
  overlay: <ClickOnMount find={byLabel('Expand sidebar')} />,
});
BusyRailExpanded.meta = { viewports: ['desktop'] };
