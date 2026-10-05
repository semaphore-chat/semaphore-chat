/**
 * Fixtures for the channel settings → Permissions stories
 * (`stories/components/ChannelPermissions.stories.tsx`): community roles with
 * the default ranks, an actor (owner / Community Admin / Moderator / a
 * limited manager), the stored overwrites, and the handlers the
 * Permissions tab reads (GET roles, my roles, overwrites).
 *
 * Plain `.ts` (no JSX): it exports both data and functions.
 */
import { http, HttpResponse, delay, type HttpHandler } from 'msw';
import type {
  ChannelOverwriteDto,
  ChannelOverwritesDto,
  RoleDto,
} from '../../api-client/types.gen';
import type { Channel } from '../../types/channel.type';
import { ADMIN_ACTIONS, MEMBER_ACTIONS, makeRole } from './edge/voice';
import { ALL_CAPS, channelPermissionsHandler } from './channelPermissions';
import { bigCommunityScenario, generalChannel, primaryCommunity } from './scenarios';
import type { Scenario } from './types';

type Action = RoleDto['actions'][number];

const cid = primaryCommunity.id;

/** `DEFAULT_MODERATOR_ROLE` (backend/src/roles/default-roles.config.ts). */
export const MODERATOR_ACTIONS: Action[] = [
  'READ_COMMUNITY', 'READ_CHANNEL', 'READ_MEMBER', 'READ_MESSAGE', 'READ_ROLE', 'CREATE_MESSAGE',
  'ATTACH_FILES', 'DELETE_MESSAGE', 'CREATE_CHANNEL', 'UPDATE_CHANNEL', 'MANAGE_CHANNEL_PERMISSIONS',
  'MANAGE_WEBHOOKS', 'JOIN_CHANNEL', 'SPEAK', 'VIDEO', 'SCREEN_SHARE', 'CREATE_MEMBER', 'UPDATE_MEMBER',
  'CREATE_REACTION', 'DELETE_REACTION', 'READ_ALIAS_GROUP', 'READ_ALIAS_GROUP_MEMBER', 'CAPTURE_REPLAY',
  'KICK_USER', 'TIMEOUT_USER', 'PIN_MESSAGE', 'UNPIN_MESSAGE', 'DELETE_ANY_MESSAGE', 'VIEW_BAN_LIST',
  'MUTE_PARTICIPANT', 'READ_SOUNDBOARD_SOUND',
];

export const adminRole = makeRole(cid, 'Community Admin', ADMIN_ACTIONS, 10);
export const moderatorRole = makeRole(cid, 'Moderator', MODERATOR_ACTIONS, 20);
export const memberRole = makeRole(cid, 'Member', MEMBER_ACTIONS, 100);
/** Manages permissions but can't post or attach: presets needing those are disabled. */
export const limitedManagerRole = makeRole(
  cid,
  'Channel Curator',
  ['READ_CHANNEL', 'READ_MESSAGE', 'MANAGE_CHANNEL_PERMISSIONS', 'CREATE_REACTION'],
  50,
);

export const DEFAULT_ROLES: RoleDto[] = [adminRole, moderatorRole, memberRole];

/** Many roles with long names, to stress the "Roles that can post" chips. */
export const MANY_ROLES: RoleDto[] = [
  ...DEFAULT_ROLES,
  makeRole(cid, 'Senior Release Coordination and Announcements Team', MODERATOR_ACTIONS, 30),
  makeRole(cid, 'Community Events Organisers', MODERATOR_ACTIONS, 40),
  makeRole(cid, 'Verified Contributors', MEMBER_ACTIONS, 60),
  makeRole(cid, 'Documentation Wranglers', MEMBER_ACTIONS, 70),
  makeRole(cid, 'Beta Testers (Desktop & Mobile)', MEMBER_ACTIONS, 80),
  makeRole(cid, 'Supercalifragilisticexpialidociousrolenamewithoutspaces', MEMBER_ACTIONS, 90),
];

export const settingsChannel: Channel = { ...generalChannel, name: 'announcements', preset: 'NORMAL' };

type Overwrite = ChannelOverwriteDto;

export const announcementOverwrites: Overwrite[] = [
  { targetType: 'EVERYONE', roleId: null, allow: [], deny: ['CREATE_MESSAGE', 'ATTACH_FILES'] },
  { targetType: 'ROLE', roleId: adminRole.id, allow: ['CREATE_MESSAGE', 'ATTACH_FILES'], deny: [] },
  { targetType: 'ROLE', roleId: moderatorRole.id, allow: ['CREATE_MESSAGE', 'ATTACH_FILES'], deny: [] },
];

export const readOnlyOverwrites: Overwrite[] = [
  {
    targetType: 'EVERYONE',
    roleId: null,
    allow: [],
    deny: ['CREATE_MESSAGE', 'ATTACH_FILES', 'CREATE_REACTION'],
  },
  {
    targetType: 'ROLE',
    roleId: adminRole.id,
    allow: ['CREATE_MESSAGE', 'ATTACH_FILES', 'CREATE_REACTION'],
    deny: [],
  },
];

/** No preset produces this: shown as "Custom". */
export const customOverwrites: Overwrite[] = [
  { targetType: 'EVERYONE', roleId: null, allow: [], deny: ['CREATE_REACTION', 'VIDEO'] },
  { targetType: 'ROLE', roleId: memberRole.id, allow: [], deny: ['SCREEN_SHARE'] },
];

export type SettingsActor = 'owner' | 'admin' | 'moderator' | 'limited';

export interface ChannelSettingsFixture {
  actor?: SettingsActor;
  overwrites?: Overwrite[];
  preset?: ChannelOverwritesDto['preset'];
  roles?: RoleDto[];
  /** Overwrites never load (spinner). */
  loading?: boolean;
  /** Overwrites request fails. */
  error?: boolean;
  /** The actor can't manage permissions (no Permissions tab). */
  canManage?: boolean;
}

const actorRole: Record<Exclude<SettingsActor, 'owner'>, RoleDto> = {
  admin: adminRole,
  moderator: moderatorRole,
  limited: limitedManagerRole,
};

/** The scenario (`me` as owner or an ordinary user) and its extra handlers. */
export function channelSettingsFixture(options: ChannelSettingsFixture = {}): {
  scenario: Scenario;
  handlers: HttpHandler[];
} {
  const {
    actor = 'admin',
    overwrites = [],
    preset = 'NORMAL',
    roles = DEFAULT_ROLES,
    loading = false,
    error = false,
    canManage = true,
  } = options;
  const myRoles = actor === 'owner' ? [] : [actorRole[actor]];
  const allRoles =
    actor === 'limited' ? [...roles, limitedManagerRole].sort((a, b) => a.position - b.position) : roles;
  const scenario: Scenario = {
    ...bigCommunityScenario,
    me: { ...bigCommunityScenario.me, role: actor === 'owner' ? 'OWNER' : 'USER' },
    rolesByCommunity: { ...bigCommunityScenario.rolesByCommunity, [cid]: allRoles },
  };
  const overwritesPath = `/api/channels/${settingsChannel.id}/overwrites`;
  const handlers: HttpHandler[] = [
    http.get(`/api/roles/community/${cid}`, () => HttpResponse.json({ communityId: cid, roles: allRoles })),
    http.get(`/api/roles/my/community/${cid}`, () =>
      HttpResponse.json({ resourceType: 'COMMUNITY', userId: scenario.me.id, resourceId: cid, roles: myRoles })),
    loading
      ? http.get(overwritesPath, async () => {
          await delay(10 * 60_000);
          return HttpResponse.json({});
        })
      : error
        ? http.get(overwritesPath, () =>
            HttpResponse.json({ statusCode: 500, message: 'Internal server error' }, { status: 500 }))
        : http.get(overwritesPath, () =>
            HttpResponse.json({ channelId: settingsChannel.id, preset, overwrites } satisfies ChannelOverwritesDto)),
    channelPermissionsHandler(scenario, cid, () => ({ ...ALL_CAPS, managePermissions: canManage })),
  ];
  return { scenario, handlers };
}

/** Finds the dialog's "Permissions" tab (for `ClickOnMount`). */
export function findPermissionsTab(): HTMLElement | null {
  return (
    Array.from(document.querySelectorAll<HTMLElement>('[role="tab"]')).find(
      (tab) => tab.textContent === 'Permissions',
    ) ?? null
  );
}
