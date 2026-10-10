import { defineScreen } from '../fixtures/screenStory';
import { bigCommunityScenario, firstDmGroup } from '../fixtures/scenarios';
import { withOpenedContextRead } from '../fixtures/modifiers';

/** An open 1:1 DM conversation. */
export const DmChat = defineScreen(
  withOpenedContextRead(bigCommunityScenario, firstDmGroup.id),
  `/direct-messages/${firstDmGroup.id}`,
);

// dm-5: six messages, short enough to fit every viewport without scrolling.
const shortDm = bigCommunityScenario.dmGroups.find((g) => g.id === 'dm-5') ?? firstDmGroup;

/** A short 1:1 DM (fits without scrolling). Named for the case it documents — opening a short
 * unread conversation marks it read without anything having to scroll (see
 * `MessageContainer.readTracking.test.tsx`) — so the fixture seeds it read: that is the state
 * every capture shows, and seeding it unread would race the app's own clear. */
export const DmChatShortUnread = defineScreen(
  withOpenedContextRead(bigCommunityScenario, shortDm.id),
  `/direct-messages/${shortDm.id}`,
);
