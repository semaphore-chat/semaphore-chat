import { defineScreen } from '../fixtures/screenStory';
import { ClickOnMount } from '../fixtures/interactions';
import { findButtonByText } from '../fixtures/domQueries';
import { bigCommunityScenario, primaryCommunity, generalChannel } from '../fixtures/scenarios';

/**
 * The thread drawer is local component state inside `ChannelMessageContainer`
 * with no route/prop seam — driven open here by clicking the real
 * "N replies" badge that our scenario's #general channel already has.
 */
export const ThreadOpen = defineScreen(
  bigCommunityScenario,
  `/community/${primaryCommunity.id}/channel/${generalChannel.id}`,
  { overlay: <ClickOnMount find={() => findButtonByText(/repl(y|ies)/i)} /> },
);
