import { defineScreen } from '../fixtures/screenStory';
import { asElectron } from '../fixtures/electron';
import { ClickOnMount } from '../fixtures/interactions';
import { bigCommunityScenario, primaryCommunity, generalChannel, firstDmGroup } from '../fixtures/scenarios';
import { VoiceConnected } from './VoiceConnected.stories';

/*
 * The Electron desktop app in a narrow window. Electron's minimum window width
 * is 800px, inside the browser's tablet range (768-1199px), but it's a desktop
 * app: it gets the desktop layout (app bar, community rail, channel sidebar)
 * and pointer UI at every width, never the touch tablet layout. Below 1024px
 * the inline member column doesn't fit next to the sidebars, so the chat
 * headers get a members button that opens it as a drawer. Captured at tablet
 * width (820px) only: Electron can't be phone-sized, and at desktop width
 * these are the ordinary desktop stories.
 */

/** #general at 820px: the channel sidebar and chat, with the members button in the header. */
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

const showMembersButton = () => document.querySelector<HTMLElement>('button[aria-label="Show members"]');

/** #general with the member list opened from the header's members button: no
 * room for the inline column below 1024px, so it's a drawer there. */
export const ChannelChatMembersOpen = asElectron(
  defineScreen(bigCommunityScenario, `/community/${primaryCommunity.id}/channel/${generalChannel.id}`, {
    overlay: <ClickOnMount find={showMembersButton} />,
  }),
);
ChannelChatMembersOpen.meta = { viewports: ['tablet'] };

/** The DM's participants, opened from the DM header's members button. */
export const DmChatMembersOpen = asElectron(
  defineScreen(bigCommunityScenario, `/direct-messages/${firstDmGroup.id}`, {
    overlay: <ClickOnMount find={showMembersButton} />,
  }),
);
DmChatMembersOpen.meta = { viewports: ['tablet'] };
