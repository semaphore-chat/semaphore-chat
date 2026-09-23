/**
 * Combined worst case for navigation & lists: 1000 communities, a
 * long-named community with a broken avatar and 60 odd/long channels all
 * unread, 253 odd-named members, 120 DMs, 150 notifications, 60 friends,
 * and `me` with a max-length name. The tablet shots of `ChannelMembers`
 * are the "tablet split view with long lists" case.
 */
import { ClickOnMount } from '../../fixtures/interactions';
import { findButtonByIconTestId } from '../../fixtures/domQueries';
import { defineNavScreen, worstCaseScenario, NAV_COMMUNITY, NAV_FIRST_CHANNEL } from '../../fixtures/edge/nav';

const s = worstCaseScenario();

export const ChannelList = defineNavScreen(s, `/community/${NAV_COMMUNITY}`);
export const ChannelMembers = defineNavScreen(s, `/community/${NAV_COMMUNITY}/channel/${NAV_FIRST_CHANNEL}`, {
  overlay: <ClickOnMount find={() => findButtonByIconTestId('PeopleIcon')} />,
});
// From the channel list: on phone the chat screen has a back arrow, not the drawer trigger.
export const SwitcherOpen = defineNavScreen(s, `/community/${NAV_COMMUNITY}`, {
  overlay: <ClickOnMount find={() => findButtonByIconTestId('MenuIcon')} />,
});
export const DmList = defineNavScreen(s, '/direct-messages');
export const Notifications = defineNavScreen(s, '/notifications');
export const Friends = defineNavScreen(s, '/friends');
