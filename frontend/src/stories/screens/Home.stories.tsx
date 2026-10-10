import { defineScreen } from '../fixtures/screenStory';
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
Busy.meta = { viewports: ['desktop-1280', 'desktop', 'desktop-1920'] };

/** Long community, channel and user names: rows truncate instead of wrapping. */
export const BusyLongNames = defineScreen(withLongNames(busyScenario), '/');
BusyLongNames.meta = { viewports: ['desktop-1280'] };

/** Nothing new: the "all caught up" card. A plain member, so no invite card either. */
export const CaughtUp = defineScreen(
  { ...quietScenario, me: { ...quietScenario.me, role: 'USER' } },
  '/',
);
CaughtUp.meta = { viewports: ['desktop-1280', 'desktop', 'desktop-1920'] };

/** In Electron: the desktop-app download card is gone. */
export const BusyElectron = asElectron(defineScreen(busyScenario, '/'));
BusyElectron.meta = { viewports: ['desktop'] };

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
