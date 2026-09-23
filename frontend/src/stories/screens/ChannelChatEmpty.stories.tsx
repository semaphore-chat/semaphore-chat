import { defineScreen } from '../fixtures/screenStory';
import { withEmpty } from '../fixtures/modifiers';
import { bigCommunityScenario, primaryCommunity, secondChannel } from '../fixtures/scenarios';

const scenario = withEmpty(bigCommunityScenario, { channelMessages: secondChannel.id });

/** A text channel with no messages yet — the "start the conversation" empty state. */
export const ChannelChatEmpty = defineScreen(scenario, `/community/${primaryCommunity.id}/channel/${secondChannel.id}`);
