/**
 * PERMISSIONS edge cases — what a community Member / Community Admin /
 * instance Owner sees (channel list, per-message actions, community
 * settings), plus a read-only role, a private channel, timed-out and banned
 * users, and the instance admin pages opened by a non-admin.
 *
 * Tiers match the real backend: "Owner" is the instance OWNER (bypasses all
 * RBAC, `useUserPermissions`); "Admin" is an instance USER holding the
 * default "Community Admin" role; "Member" holds the default "Member" role
 * (both copied from backend `default-roles.config.ts`). Channel roles are
 * the community roles (`getUserRolesForChannel`).
 */
import { http, HttpResponse } from 'msw';
import { ClickOnMount } from '../../fixtures/interactions';
import { findButtonByText } from '../../fixtures/domQueries';
import {
  ADMIN_ACTIONS,
  MEMBER_ACTIONS,
  READ_ONLY_ACTIONS,
  asCommunityRole,
  channelVoiceState,
  createMediaRoom,
  defineEdgeScreen,
  edgeCommunity,
  edgeGeneral,
  edgeSecondText,
  edgeVoiceChannel,
  edgeVoiceScenario,
  forbidden,
  makeRole,
  moderationListHandlers,
  OpenMessageActions,
  withAppendedMessage,
  withChannelPresence,
  withPrivateChannel,
} from '../../fixtures/edge/voice';

const cid = edgeCommunity.id;
const author = edgeVoiceScenario.users[2];
const TARGET = 'Can someone pin the release checklist for Friday? 📌';
/** Base: someone else's fresh message at the bottom of #general, to open actions on. */
const base = withAppendedMessage(edgeVoiceScenario, edgeGeneral.id, author.id, TARGET);

const generalPath = `/community/${cid}/channel/${edgeGeneral.id}`;
const listPath = `/community/${cid}`;
const settingsPath = `/community/${cid}/edit`;

const memberRole = makeRole(cid, 'Member', MEMBER_ACTIONS, 100);
const adminRole = makeRole(cid, 'Community Admin', ADMIN_ACTIONS, 10);
const readOnlyRole = makeRole(cid, 'Read-only', READ_ONLY_ACTIONS, 90);

const asMember = asCommunityRole(base, cid, memberRole);
const asAdmin = asCommunityRole(base, cid, adminRole);

// ── Channel list ─────────────────────────────────────────────────────────

/** Member: channel list (phone/tablet: channels screen; desktop: sidebar + community home). */
export const MemberChannelList = defineEdgeScreen(asMember.scenario, { path: listPath, extraHandlers: asMember.handlers });
/** Community Admin: same list — settings gear / edit affordances appear. */
export const AdminChannelList = defineEdgeScreen(asAdmin.scenario, { path: listPath, extraHandlers: asAdmin.handlers });
/** Instance Owner. */
export const OwnerChannelList = defineEdgeScreen(base, { path: listPath });

// ── Message actions (someone else's message) ─────────────────────────────

/** Member long-presses / right-clicks another user's message: no delete, no pin. */
export const MemberMessageActions = defineEdgeScreen(asMember.scenario, {
  path: generalPath,
  extraHandlers: asMember.handlers,
  overlay: <OpenMessageActions text={TARGET} />,
});
/** Community Admin on the same message: delete + pin available. */
export const AdminMessageActions = defineEdgeScreen(asAdmin.scenario, {
  path: generalPath,
  extraHandlers: asAdmin.handlers,
  overlay: <OpenMessageActions text={TARGET} />,
});
/** Instance Owner on the same message. */
export const OwnerMessageActions = defineEdgeScreen(base, {
  path: generalPath,
  overlay: <OpenMessageActions text={TARGET} />,
});

// ── Community settings ───────────────────────────────────────────────────

/** Member opens community settings by URL: which tabs are disabled / what renders. */
export const MemberCommunitySettings = defineEdgeScreen(asMember.scenario, { path: settingsPath, extraHandlers: asMember.handlers });
/** Community Admin: full settings. */
export const AdminCommunitySettings = defineEdgeScreen(asAdmin.scenario, { path: settingsPath, extraHandlers: asAdmin.handlers });
/** Instance Owner: full settings. */
export const OwnerCommunitySettings = defineEdgeScreen(base, { path: settingsPath });

/** Community Admin on the Moderation tab, with 2 bans (one permanent, one expiring) + 1 active timeout. */
export const AdminModerationBansTimeouts = defineEdgeScreen(asAdmin.scenario, {
  path: settingsPath,
  extraHandlers: [...asAdmin.handlers, ...moderationListHandlers(base, cid)],
  overlay: <ClickOnMount find={() => findButtonByText(/^Moderation$/)} />,
});

// ── Read-only / private / timed out / banned ─────────────────────────────

/**
 * A custom "Read-only" role (Member minus CREATE_MESSAGE). The composer
 * checks CREATE_MESSAGE (useComposerAvailability) and shows a
 * "You can't send messages in #general" notice instead of an input.
 */
const asReadOnly = asCommunityRole(base, cid, readOnlyRole);
export const ReadOnlyChannel = defineEdgeScreen(asReadOnly.scenario, {
  path: generalPath,
  extraHandlers: asReadOnly.handlers,
});

/** A private channel (lock icon), member view: member list comes from the channel's explicit membership. */
const privateMembers = [edgeVoiceScenario.me.id, ...edgeVoiceScenario.users.slice(0, 4).map((u) => u.id)];
const priv = withPrivateChannel(asMember.scenario, edgeSecondText.id, privateMembers);
export const PrivateChannel = defineEdgeScreen(priv.scenario, {
  path: `/community/${cid}/channel/${edgeSecondText.id}`,
  extraHandlers: [...asMember.handlers, ...priv.handlers],
});

/** The same private channel in the channel list (phone/tablet: the channels screen). */
export const PrivateChannelList = defineEdgeScreen(priv.scenario, {
  path: listPath,
  extraHandlers: [...asMember.handlers, ...priv.handlers],
});

/**
 * Timed-out member (timeout active server-side, 12 minutes left). The
 * composer reads `GET /moderation/timeout-status/:communityId/:userId` and
 * shows "Timed out, 12 min left" with a live countdown instead of an input.
 */
const timeoutExpiresAt = new Date(Date.now() + 12 * 60_000).toISOString();
export const TimedOutMember = defineEdgeScreen(asMember.scenario, {
  path: generalPath,
  extraHandlers: [
    ...asMember.handlers,
    http.get(`/api/moderation/timeout-status/${cid}/:userId`, () =>
      HttpResponse.json({ isTimedOut: true, expiresAt: timeoutExpiresAt })),
  ],
});

/**
 * Banned user following a stale link into the community. The ban removed
 * their membership + roles, so the community is gone from /community/mine
 * and every guarded community/channel endpoint answers 403 (Nest's default
 * RbacGuard rejection).
 */
const bannedCommunityChannels = edgeCommunity.channels.map((c) => c.id);
export const BannedStaleLink = defineEdgeScreen(asMember.scenario, {
  path: generalPath,
  extraHandlers: [
    http.get('/api/community/mine', () =>
      HttpResponse.json(
        base.communities
          .filter((c) => c.id !== cid)
          .map(({ channels: _c, memberIds: _m, ownerId: _o, ...rest }) => rest),
      )),
    http.get(`/api/roles/my/community/${cid}`, () =>
      HttpResponse.json({ resourceType: 'COMMUNITY', userId: base.me.id, resourceId: cid, roles: [] })),
    http.get('/api/roles/my/channel/:channelId', ({ params }) =>
      HttpResponse.json({ resourceType: 'CHANNEL', userId: base.me.id, resourceId: String(params.channelId), roles: [] })),
    forbidden('get', `/api/community/${cid}`),
    forbidden('get', `/api/channels/community/${cid}`),
    forbidden('get', `/api/channels/community/${cid}/mentionable`),
    forbidden('get', `/api/membership/community/${cid}`),
    forbidden('get', `/api/custom-emoji/community/${cid}`),
    forbidden('get', `/api/soundboard/community/${cid}`),
    forbidden('get', `/api/alias-groups/community/${cid}`),
    ...bannedCommunityChannels.flatMap((id) => [
      forbidden('get', `/api/channels/${id}`),
      forbidden('get', `/api/messages/channel/${id}`),
      forbidden('get', `/api/moderation/pins/${id}`),
      forbidden('get', `/api/channels/${id}/voice-presence`),
    ]),
  ],
});

/** Instance admin dashboard opened by an ordinary USER (no route guard; the API answers 403). */
const plainUser = { ...base, me: { ...base.me, role: 'USER' as const } };
export const AdminPagesAsMember = defineEdgeScreen(plainUser, {
  path: '/admin',
  extraHandlers: [
    forbidden('get', '/api/instance/stats'),
    forbidden('get', '/api/storage/instance'),
    forbidden('get', '/api/instance/settings'),
  ],
});

/**
 * WORST CASE (permissions): read-only member, inside a private channel,
 * connected to voice, trying to act on someone else's message.
 */
const worstPriv = withPrivateChannel(
  withChannelPresence(asReadOnly.scenario, edgeVoiceChannel.id, [{ user: base.me }, { user: author, speaking: true }]),
  edgeGeneral.id,
  privateMembers,
);
export const PermissionsWorstCase = defineEdgeScreen(worstPriv.scenario, {
  path: generalPath,
  extraHandlers: [...asReadOnly.handlers, ...worstPriv.handlers],
  voiceState: channelVoiceState(edgeVoiceChannel),
  room: createMediaRoom({ user: base.me }, [{ user: author, speaking: true }]),
  overlay: <OpenMessageActions text={TARGET} />,
});
