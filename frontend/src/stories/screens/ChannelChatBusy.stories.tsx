import { defineScreen } from '../fixtures/screenStory';
import { bigCommunityScenario, primaryCommunity, generalChannel } from '../fixtures/scenarios';

/** #general: ~40 messages, consecutive runs, a reply, reactions, an image attachment, a mention, a pinned message, an edited message. */
export const ChannelChatBusy = defineScreen(
  bigCommunityScenario,
  `/community/${primaryCommunity.id}/channel/${generalChannel.id}`,
);
