import { defineScreen } from '../fixtures/screenStory';
import { asElectron } from '../fixtures/electron';
import { bigCommunityScenario, primaryCommunity, generalChannel, firstDmGroup } from '../fixtures/scenarios';
import { VoiceConnected } from './VoiceConnected.stories';

/*
 * The Electron desktop app in a narrow window. Electron's minimum window width
 * is 800px, inside the browser's tablet range (768-1199px), but it's a desktop
 * app: it gets the desktop layout (app bar, community rail, channel sidebar,
 * inline member list) and pointer UI at every width, never the touch tablet
 * layout. Captured at tablet width (820px) only: Electron can't be phone-sized,
 * and at desktop width these are the ordinary desktop stories.
 */

/** #general with the channel sidebar and the inline member list at 820px. */
export const ChannelChat = asElectron(
  defineScreen(bigCommunityScenario, `/community/${primaryCommunity.id}/channel/${generalChannel.id}`),
);
ChannelChat.meta = { viewports: ['tablet'] };

/** An open DM: the DM list and the conversation side by side at 820px. */
export const DmChat = asElectron(defineScreen(bigCommunityScenario, `/direct-messages/${firstDmGroup.id}`));
DmChat.meta = { viewports: ['tablet'] };

/** Friends: the desktop card, not the tablet's full-bleed page. */
export const Friends = asElectron(defineScreen(bigCommunityScenario, '/friends'));
Friends.meta = { viewports: ['tablet'] };

/** Connected to voice: the desktop voice bar and stage at 820px. */
export const VoiceConnectedNarrow = asElectron(VoiceConnected);
VoiceConnectedNarrow.meta = { viewports: ['tablet'] };
