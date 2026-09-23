/**
 * Error states: 500 on each main screen's primary endpoint, 403 (a plain
 * member deep-linking into a private channel / a community they're not in —
 * the body `RbacGuard` actually produces), and 404 deep links to deleted
 * channels / communities / DMs / users / unknown routes.
 */
import {
  edgeScreen,
  withStatusForId,
  FORBIDDEN_BODY,
  NOT_FOUND_BODY,
  INTERNAL_ERROR_BODY,
} from '../../fixtures/edge/states';
import { withErrors } from '../../fixtures/handlerHelpers';
import { buildScenario } from '../../fixtures/builder';
import { ClickOnMount } from '../../fixtures/interactions';
import { findButtonByIconTestId, findButtonByText } from '../../fixtures/domQueries';
import {
  bigCommunityScenario,
  primaryCommunity,
  generalChannel,
  firstDmGroup,
  threadParentMessageId,
} from '../../fixtures/scenarios';

const s = bigCommunityScenario;
const chatPath = `/community/${primaryCommunity.id}/channel/${generalChannel.id}`;
const e500 = (path: string) => withErrors('get', path, 500, INTERNAL_ERROR_BODY);

// ── 500s ────────────────────────────────────────────────────────────────

export const ChannelList500 = edgeScreen(s, `/community/${primaryCommunity.id}`, {
  extraHandlers: [e500(`/api/channels/community/${primaryCommunity.id}`)],
});

export const ChannelChat500 = edgeScreen(s, chatPath, {
  extraHandlers: [e500(`/api/messages/channel/${generalChannel.id}`)],
});

export const DmList500 = edgeScreen(s, '/direct-messages', { extraHandlers: [e500('/api/direct-messages')] });

export const DmChat500 = edgeScreen(s, `/direct-messages/${firstDmGroup.id}`, {
  extraHandlers: [e500(`/api/messages/group/${firstDmGroup.id}`)],
});

export const Notifications500 = edgeScreen(s, '/notifications', { extraHandlers: [e500('/api/notifications')] });

export const Profile500 = edgeScreen(s, `/profile/${s.users[0].id}`, {
  extraHandlers: [e500(`/api/users/${s.users[0].id}`)],
});

/** Settings with its two server-backed sections (notification settings, sessions) failing. */
export const Settings500 = edgeScreen(s, '/settings', {
  extraHandlers: [e500('/api/notifications/settings'), e500('/api/auth/sessions')],
});

export const MemberList500 = edgeScreen(s, chatPath, {
  extraHandlers: [e500(`/api/membership/community/${primaryCommunity.id}`)],
  overlay: <ClickOnMount find={() => findButtonByIconTestId('PeopleIcon')} />,
});

export const Thread500 = edgeScreen(s, chatPath, {
  extraHandlers: [e500(`/api/threads/${threadParentMessageId}/replies`)],
  overlay: <ClickOnMount find={() => findButtonByText(/repl(y|ies)/i)} />,
});

// ── 403s (plain member — instance OWNERs skip RBAC entirely) ─────────────

const memberScenario = buildScenario({ seed: 'busy-community', meOverrides: { role: 'USER' } });
const memberCommunity = memberScenario.communities[0];
const PRIVATE_CHANNEL_ID = 'channel-private-leadership';
const FOREIGN_COMMUNITY_ID = 'community-not-a-member';

/** Deep link to a private channel the member isn't in: every channel-scoped endpoint 403s. */
export const Forbidden403PrivateChannel = edgeScreen(
  memberScenario,
  `/community/${memberCommunity.id}/channel/${PRIVATE_CHANNEL_ID}`,
  { extraHandlers: [withStatusForId(PRIVATE_CHANNEL_ID, 403, FORBIDDEN_BODY)] },
);

/** Deep link (e.g. an old invite/share link) to a community the member doesn't belong to. */
export const Forbidden403Community = edgeScreen(memberScenario, `/community/${FOREIGN_COMMUNITY_ID}`, {
  extraHandlers: [withStatusForId(FOREIGN_COMMUNITY_ID, 403, FORBIDDEN_BODY)],
});

// ── 404s ─────────────────────────────────────────────────────────────────

const DELETED_CHANNEL_ID = 'channel-deleted-0000';
const DELETED_COMMUNITY_ID = 'community-deleted-0000';

export const NotFound404Channel = edgeScreen(s, `/community/${primaryCommunity.id}/channel/${DELETED_CHANNEL_ID}`, {
  extraHandlers: [withStatusForId(DELETED_CHANNEL_ID, 404, NOT_FOUND_BODY)],
});

export const NotFound404Community = edgeScreen(s, `/community/${DELETED_COMMUNITY_ID}/channel/${DELETED_CHANNEL_ID}`, {
  extraHandlers: [
    withStatusForId(DELETED_COMMUNITY_ID, 404, NOT_FOUND_BODY),
    withStatusForId(DELETED_CHANNEL_ID, 404, NOT_FOUND_BODY),
  ],
});

export const NotFound404Dm = edgeScreen(s, '/direct-messages/dm-deleted-0000', {
  extraHandlers: [withStatusForId('dm-deleted-0000', 404, NOT_FOUND_BODY)],
});

export const NotFound404Profile = edgeScreen(s, '/profile/user-deleted-0000', {
  extraHandlers: [withStatusForId('user-deleted-0000', 404, NOT_FOUND_BODY)],
});

/** An unknown in-app route — the catch-all `NotFoundPage`. */
export const NotFound404Route = edgeScreen(s, '/this/route/does-not-exist');
