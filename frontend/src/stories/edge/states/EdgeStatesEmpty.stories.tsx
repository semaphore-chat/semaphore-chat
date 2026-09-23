/**
 * Empty states for every main screen — real empty data (not errors), so
 * each shot shows what a genuinely empty section looks like.
 */
import {
  edgeScreen,
  withNoChannels,
  withSoloCommunity,
  withBareUser,
  withNoDms,
  withNoUnread,
} from '../../fixtures/edge/states';
import { withEmpty } from '../../fixtures/modifiers';
import { ClickOnMount } from '../../fixtures/interactions';
import { findButtonByIconTestId } from '../../fixtures/domQueries';
import {
  bigCommunityScenario,
  emptyUserScenario,
  primaryCommunity,
  secondChannel,
  firstDmGroup,
} from '../../fixtures/scenarios';

const s = bigCommunityScenario;
/** `emptyUserScenario` still reports unread counts for its (removed) DMs — strip them. */
const newUser = withNoUnread(emptyUserScenario);

/** A community with zero channels. */
export const ChannelList = edgeScreen(withNoChannels(s, primaryCommunity.id), `/community/${primaryCommunity.id}`);

/** A text channel with no messages yet. */
export const ChannelChat = edgeScreen(
  withEmpty(s, { channelMessages: secondChannel.id }),
  `/community/${primaryCommunity.id}/channel/${secondChannel.id}`,
);

export const DmList = edgeScreen(withNoDms(s), '/direct-messages');

/** A DM conversation that exists but has no messages (just created). */
export const DmChat = edgeScreen(withEmpty(s, { dmMessages: firstDmGroup.id }), `/direct-messages/${firstDmGroup.id}`);

export const Notifications = edgeScreen(withEmpty(s, 'notifications'), '/notifications');

/** No friends, no pending requests. */
export const Friends = edgeScreen(withEmpty(s, 'friends'), '/friends');

/** Another user's profile with no display name, avatar, banner, bio or status. */
export const ProfileBare = edgeScreen(withBareUser(s, s.users[0].id), `/profile/${s.users[0].id}`);

/** Member list of a community where you're the only member (opened on phone/tablet). */
export const MemberListSolo = edgeScreen(
  withSoloCommunity(withEmpty(s, { channelMessages: secondChannel.id }), primaryCommunity.id),
  `/community/${primaryCommunity.id}/channel/${secondChannel.id}`,
  { overlay: <ClickOnMount find={() => findButtonByIconTestId('PeopleIcon')} /> },
);

/** Brand-new user, nothing anywhere: Messages tab. (Home is `screens/EmptyUserOnboarding`.) */
export const NewUserDmList = edgeScreen(newUser, '/direct-messages');

/** Brand-new user: Notifications tab. */
export const NewUserNotifications = edgeScreen(newUser, '/notifications');
