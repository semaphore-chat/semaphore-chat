/**
 * Loading states: one endpoint per screen is held pending forever
 * (`withHangingEndpoint`), everything else answers normally, so each shot
 * shows that screen's own skeleton/spinner inside otherwise-loaded chrome.
 */
import { edgeScreen, withHangingEndpoint } from '../../fixtures/edge/states';
import { ClickOnMount } from '../../fixtures/interactions';
import { withOpenedContextRead } from '../../fixtures/modifiers';
import { findButtonByIconTestId, findButtonByText, findRoleButtonContaining } from '../../fixtures/domQueries';
import { getDmDisplayName } from '../../../utils/dmHelpers';
import {
  bigCommunityScenario,
  primaryCommunity,
  generalChannel,
  firstDmGroup,
  threadParentMessageId,
} from '../../fixtures/scenarios';

const s = bigCommunityScenario;
const chatPath = `/community/${primaryCommunity.id}/channel/${generalChannel.id}`;
// The conversation these stories open is read (`withOpenedContextRead`): the app clears what it
// shows, so seeding dm-1 unread would leave the rail's Direct Messages badge racing that clear.
const dmScenario = withOpenedContextRead(s, firstDmGroup.id);

// Module-level (stable) so ClickOnMount's effect runs once: one click on the row.
const firstDmName = getDmDisplayName(firstDmGroup, s.me.id);
const findFirstDmRow = () => findRoleButtonContaining(firstDmName);

/** Community channel list while `/api/channels/community/:id` is pending. */
export const ChannelList = edgeScreen(s, `/community/${primaryCommunity.id}`, {
  extraHandlers: [withHangingEndpoint('get', `/api/channels/community/${primaryCommunity.id}`)],
});

/** #general while its message page is pending. */
export const ChannelChat = edgeScreen(s, chatPath, {
  extraHandlers: [withHangingEndpoint('get', `/api/messages/channel/${generalChannel.id}`)],
});

/** DM list while `/api/direct-messages` is pending. */
export const DmList = edgeScreen(s, '/direct-messages', {
  extraHandlers: [withHangingEndpoint('get', '/api/direct-messages')],
});

/** An open DM while its messages are pending. Unlike `DmHeader` (whose messages load, so the app
 * reads it), this DM keeps its seeded unread: the pending page never marks it read. */
export const DmChat = edgeScreen(s, `/direct-messages/${firstDmGroup.id}`, {
  extraHandlers: [withHangingEndpoint('get', `/api/messages/group/${firstDmGroup.id}`)],
});

/**
 * A DM deep link while the conversation (`/api/direct-messages/:id`) and the
 * DM list are both pending, so nothing knows its name yet: the header holds a
 * neutral placeholder (it used to read "Unknown" on desktop, blank on phone).
 */
export const DmHeader = edgeScreen(dmScenario, `/direct-messages/${firstDmGroup.id}`, {
  extraHandlers: [
    withHangingEndpoint('get', `/api/direct-messages/${firstDmGroup.id}`),
    withHangingEndpoint('get', '/api/direct-messages'),
  ],
});

/**
 * A DM picked from the DM list while the conversation itself is still pending:
 * the header already shows the name the list row had.
 */
export const DmHeaderFromList = edgeScreen(dmScenario, '/direct-messages', {
  extraHandlers: [withHangingEndpoint('get', `/api/direct-messages/${firstDmGroup.id}`)],
  overlay: <ClickOnMount find={findFirstDmRow} />,
});

export const Notifications = edgeScreen(s, '/notifications', {
  extraHandlers: [withHangingEndpoint('get', '/api/notifications')],
});

/** Another user's profile while `/api/users/:id` is pending (your own profile renders from the cached current user). */
export const Profile = edgeScreen(s, `/profile/${s.users[0].id}`, {
  extraHandlers: [withHangingEndpoint('get', `/api/users/${s.users[0].id}`)],
});

/** Settings while the notification-settings and sessions sections are pending. */
export const Settings = edgeScreen(s, '/settings', {
  extraHandlers: [
    withHangingEndpoint('get', '/api/notifications/settings'),
    withHangingEndpoint('get', '/api/auth/sessions'),
  ],
});

/** Member list (opened on phone/tablet) while the membership list is pending. */
export const MemberList = edgeScreen(s, chatPath, {
  extraHandlers: [withHangingEndpoint('get', `/api/membership/community/${primaryCommunity.id}`)],
  overlay: <ClickOnMount find={() => findButtonByIconTestId('PeopleIcon')} />,
});

/** Thread panel opened while its replies are pending. */
export const Thread = edgeScreen(s, chatPath, {
  extraHandlers: [withHangingEndpoint('get', `/api/threads/${threadParentMessageId}/replies`)],
  overlay: <ClickOnMount find={() => findButtonByText(/repl(y|ies)/i)} />,
});
