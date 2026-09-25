import { defineScreen } from '../fixtures/screenStory';
import { asElectron } from '../fixtures/electron';
import { ClickOnMount, ScrollToBottomOnMount } from '../fixtures/interactions';
import { findScrollablesIn } from '../fixtures/domQueries';
import { bigCommunityScenario, primaryCommunity, generalChannel, firstDmGroup } from '../fixtures/scenarios';
import { edgeScreen } from '../fixtures/edge/states';
import {
  defineNavScreen,
  navBase,
  navHandlers,
  withChannels,
  withDmGroups,
  withMembers,
  makeUsers,
  DM_POOL,
  NAV_COMMUNITY,
  NAV_FIRST_CHANNEL,
} from '../fixtures/edge/nav';
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

/** 30 members plus me in a community, connected to its voice channel. */
const voiceMembersScenario = withMembers(
  withChannels(navBase(), NAV_COMMUNITY, ['general', 'random', 'help'], ['Lounge']),
  NAV_COMMUNITY,
  makeUsers(30, { seed: 'electron-voice-members' }),
);
const membersDrawerScrollables = () =>
  findScrollablesIn(document.querySelector('button[aria-label="Close members"]')?.closest('.MuiDrawer-paper'));

/** Connected to voice with the members drawer open and scrolled to the end:
 * the last (offline) members sit above the fixed voice bar, not behind it. */
export const VoiceMembersOpenScrolled = asElectron(
  edgeScreen(voiceMembersScenario, `/community/${NAV_COMMUNITY}/channel/${NAV_FIRST_CHANNEL}`, {
    voice: true,
    extraHandlers: navHandlers(voiceMembersScenario),
    overlay: (
      <>
        <ClickOnMount find={showMembersButton} />
        <ScrollToBottomOnMount find={membersDrawerScrollables} />
      </>
    ),
  }),
);
VoiceMembersOpenScrolled.meta = { viewports: ['tablet'] };

/** 12 DMs; the sixth is an unnamed 15-person group whose name is every member's. */
const longNameDms = withDmGroups(navBase(), DM_POOL, 12);
const unnamedBigGroup = longNameDms.dmGroups.find((g) => g.members.length >= 10 && !g.name)!;

/** An unnamed 15-person group DM: the long name truncates, and the call and
 * members buttons stay in the header. */
export const DmChatLongName = asElectron(defineNavScreen(longNameDms, `/direct-messages/${unnamedBigGroup.id}`));
DmChatLongName.meta = { viewports: ['tablet'] };
