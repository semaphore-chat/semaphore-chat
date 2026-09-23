import { defineScreen } from '../fixtures/screenStory';
import { bigCommunityScenario, primaryCommunity, secondChannel } from '../fixtures/scenarios';
import { withUnread } from '../fixtures/modifiers';

/** A community selected, channel list visible (categories: text + voice channels). */
export const CommunityChannelList = defineScreen(bigCommunityScenario, `/community/${primaryCommunity.id}`);

/** Same list, with an unread channel and a channel with mentions — exercises the
 *  bold/unread-pill and mention-badge rendering in `Channel.tsx`. */
const unreadCommunityScenario = withUnread(
  withUnread(bigCommunityScenario, secondChannel.id, 6),
  primaryCommunity.channels.filter((c) => c.type === 'TEXT')[2]?.id ?? secondChannel.id,
  3,
  2,
);
export const CommunityChannelListUnread = defineScreen(unreadCommunityScenario, `/community/${primaryCommunity.id}`);
