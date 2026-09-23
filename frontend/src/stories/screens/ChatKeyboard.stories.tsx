import { defineScreen } from '../fixtures/screenStory';
import { bigCommunityScenario, primaryCommunity, generalChannel } from '../fixtures/scenarios';

/**
 * Same screen as `ChannelChatBusy`, but the sweep captures this story ID at
 * a SHORT viewport (390x500 — see `UX_SHOTS` "phone-short" logic keyed off
 * story ids containing "keyboard") to approximate an on-screen keyboard
 * covering the lower half of a phone. True iOS keyboard overlay behavior
 * can't be reproduced in Chromium — this is a known limitation (see design doc).
 */
export const ChatKeyboard = defineScreen(
  bigCommunityScenario,
  `/community/${primaryCommunity.id}/channel/${generalChannel.id}`,
);
