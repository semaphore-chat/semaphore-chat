import { defineScreen } from '../fixtures/screenStory';
import { bigCommunityScenario, firstDmGroup } from '../fixtures/scenarios';
import { withUnread } from '../fixtures/modifiers';

/** An open 1:1 DM conversation. */
export const DmChat = defineScreen(bigCommunityScenario, `/direct-messages/${firstDmGroup.id}`);

// dm-5: six messages, short enough to fit every viewport without scrolling.
const shortDm = bigCommunityScenario.dmGroups.find((g) => g.id === 'dm-5') ?? firstDmGroup;

/** A short 1:1 DM (fits without scrolling) opened with 4 unread messages, 1
 * of them a mention. Opening it marks it read, so its badge in the DM list,
 * the rail and the bottom navigation clears; nothing has to scroll for that. */
export const DmChatShortUnread = defineScreen(
  withUnread(bigCommunityScenario, shortDm.id, 4, 1),
  `/direct-messages/${shortDm.id}`,
);
