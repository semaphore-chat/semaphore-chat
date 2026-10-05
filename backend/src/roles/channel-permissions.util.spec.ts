import { OverwriteTarget, RbacActions as A } from '@prisma/client';
import {
  canViewChannel,
  channelActionsGranted,
  ChannelPermissionInput,
  computeChannelActions,
  isVisibleToWholeCommunity,
  OverwriteInput,
  TIMEOUT_BLOCKED_ACTIONS,
  toCapabilities,
} from './channel-permissions.util';
import {
  DEFAULT_MEMBER_ROLE,
  DEFAULT_MODERATOR_ROLE,
} from './default-roles.config';

const MEMBER = DEFAULT_MEMBER_ROLE.actions;
const MODERATOR = DEFAULT_MODERATOR_ROLE.actions;
const MOD_ROLE = 'role-moderator';
const QUIET_ROLE = 'role-quiet';
const ADMIN_ROLE = 'role-admin';

const everyone = (deny: A[], allow: A[] = []): OverwriteInput => ({
  targetType: OverwriteTarget.EVERYONE,
  roleId: null,
  userId: null,
  allow,
  deny,
});
const role = (roleId: string, allow: A[], deny: A[] = []): OverwriteInput => ({
  targetType: OverwriteTarget.ROLE,
  roleId,
  userId: null,
  allow,
  deny,
});
const member = (
  userId: string,
  allow: A[],
  deny: A[] = [],
): OverwriteInput => ({
  targetType: OverwriteTarget.MEMBER,
  roleId: null,
  userId,
  allow,
  deny,
});

function input(over: Partial<ChannelPermissionInput>): ChannelPermissionInput {
  return {
    userId: 'u1',
    baseActions: MEMBER,
    roleIds: [],
    isCommunityMember: true,
    isPrivate: false,
    hasChannelMembership: false,
    overwrites: [],
    timedOut: false,
    ...over,
  };
}

/** The design doc's announcement example: @everyone deny post, Moderator allow. */
const ANNOUNCEMENT = [
  everyone([A.CREATE_MESSAGE, A.ATTACH_FILES]),
  role(MOD_ROLE, [A.CREATE_MESSAGE, A.ATTACH_FILES]),
];

describe('channel permission resolution', () => {
  describe('worked example: @everyone deny CREATE_MESSAGE + Moderator allow', () => {
    it.each<[string, Partial<ChannelPermissionInput>, boolean]>([
      ['Member only: cannot post', { baseActions: MEMBER }, false],
      [
        'Member + Moderator: allow re-adds',
        { baseActions: [...MEMBER, ...MODERATOR], roleIds: [MOD_ROLE] },
        true,
      ],
      [
        'Moderator + a role denying here: any role allow beats any role deny',
        {
          baseActions: [...MEMBER, ...MODERATOR],
          roleIds: [MOD_ROLE, QUIET_ROLE],
          overwrites: [
            ...ANNOUNCEMENT,
            role(QUIET_ROLE, [], [A.CREATE_MESSAGE]),
          ],
        },
        true,
      ],
      [
        'Admin without an allow on their role: the everyone deny applies',
        { baseActions: [...MEMBER, A.UPDATE_COMMUNITY], roleIds: [ADMIN_ROLE] },
        false,
      ],
      [
        'Moderator, timed out: the timeout wins',
        {
          baseActions: [...MEMBER, ...MODERATOR],
          roleIds: [MOD_ROLE],
          timedOut: true,
        },
        false,
      ],
      [
        'Moderator with a member deny: member overwrite is applied last',
        {
          baseActions: [...MEMBER, ...MODERATOR],
          roleIds: [MOD_ROLE],
          overwrites: [...ANNOUNCEMENT, member('u1', [], [A.CREATE_MESSAGE])],
        },
        false,
      ],
      [
        'Member with a member allow beats the everyone deny',
        { overwrites: [...ANNOUNCEMENT, member('u1', [A.CREATE_MESSAGE])] },
        true,
      ],
      [
        "Another user's member overwrite doesn't apply",
        { overwrites: [...ANNOUNCEMENT, member('u2', [A.CREATE_MESSAGE])] },
        false,
      ],
      [
        "A role overwrite for a role the user lacks doesn't apply",
        { roleIds: ['some-other-role'] },
        false,
      ],
    ])('%s', (_name, over, canPost) => {
      const result = input({ overwrites: ANNOUNCEMENT, ...over });
      expect(channelActionsGranted(result, [A.CREATE_MESSAGE])).toBe(canPost);
    });

    it('members can still read and react in the announcement channel', () => {
      const effective = computeChannelActions(
        input({ overwrites: ANNOUNCEMENT }),
      );
      expect(effective.has(A.READ_MESSAGE)).toBe(true);
      expect(effective.has(A.CREATE_REACTION)).toBe(true);
      expect(effective.has(A.ATTACH_FILES)).toBe(false);
    });
  });

  describe('no-attachments channel', () => {
    it('removes ATTACH_FILES but keeps posting', () => {
      const effective = computeChannelActions(
        input({ overwrites: [everyone([A.ATTACH_FILES])] }),
      );
      expect(effective.has(A.ATTACH_FILES)).toBe(false);
      expect(effective.has(A.CREATE_MESSAGE)).toBe(true);
    });
  });

  describe('private channels', () => {
    it.each<[string, Partial<ChannelPermissionInput>, boolean]>([
      ['member of the channel: can post', { hasChannelMembership: true }, true],
      ['not a member: nothing', { hasChannelMembership: false }, false],
      [
        'not a member but a role allow: still nothing in phase 1 (ChannelMembership gates view)',
        {
          hasChannelMembership: false,
          roleIds: [MOD_ROLE],
          overwrites: [role(MOD_ROLE, [A.CREATE_MESSAGE])],
        },
        false,
      ],
      [
        'member + role allow + everyone deny: role allow re-adds',
        {
          hasChannelMembership: true,
          roleIds: [MOD_ROLE],
          overwrites: ANNOUNCEMENT,
        },
        true,
      ],
      [
        'member + everyone deny: denied',
        { hasChannelMembership: true, overwrites: ANNOUNCEMENT },
        false,
      ],
    ])('%s', (_name, over, canPost) => {
      expect(
        channelActionsGranted(input({ isPrivate: true, ...over }), [
          A.CREATE_MESSAGE,
        ]),
      ).toBe(canPost);
    });

    it('denies community-scoped actions to non-members too (as before)', () => {
      expect(
        channelActionsGranted(
          input({ isPrivate: true, baseActions: [...MEMBER, A.READ_MEMBER] }),
          [A.READ_MEMBER],
        ),
      ).toBe(false);
    });
  });

  describe('lockout safeguard', () => {
    const manager = [...MEMBER, A.MANAGE_CHANNEL_PERMISSIONS, A.UPDATE_CHANNEL];

    it('a manager can manage a private channel they are not a member of', () => {
      const i = input({ isPrivate: true, baseActions: manager });
      expect(channelActionsGranted(i, [A.MANAGE_CHANNEL_PERMISSIONS])).toBe(
        true,
      );
      expect(channelActionsGranted(i, [A.UPDATE_CHANNEL])).toBe(true);
      // ...but can't read or post there
      expect(channelActionsGranted(i, [A.READ_MESSAGE])).toBe(false);
      expect(channelActionsGranted(i, [A.CREATE_MESSAGE])).toBe(false);
    });

    it('overwrites denying everything never touch the manage permission', () => {
      const denyAll = everyone([
        A.READ_CHANNEL,
        A.READ_MESSAGE,
        A.CREATE_MESSAGE,
        A.MANAGE_CHANNEL_PERMISSIONS,
        A.UPDATE_CHANNEL,
      ]);
      const i = input({ baseActions: manager, overwrites: [denyAll] });
      expect(channelActionsGranted(i, [A.MANAGE_CHANNEL_PERMISSIONS])).toBe(
        true,
      );
      expect(channelActionsGranted(i, [A.UPDATE_CHANNEL])).toBe(true);
      expect(toCapabilities(i).managePermissions).toBe(true);
    });

    it('UPDATE_CHANNEL on a private channel still needs the manage permission', () => {
      const i = input({
        isPrivate: true,
        baseActions: [...MEMBER, A.UPDATE_CHANNEL],
      });
      expect(channelActionsGranted(i, [A.UPDATE_CHANNEL])).toBe(false);
    });
  });

  describe('timeouts (community-scoped, anti-spam)', () => {
    const allChannel = [
      ...MEMBER,
      ...MODERATOR,
      A.ATTACH_FILES,
      A.SPEAK,
      A.VIDEO,
      A.SCREEN_SHARE,
    ];

    it.each([...TIMEOUT_BLOCKED_ACTIONS])('blocks %s', (action) => {
      const i = input({ baseActions: allChannel, timedOut: true });
      expect(channelActionsGranted(i, [action])).toBe(false);
      expect(channelActionsGranted({ ...i, timedOut: false }, [action])).toBe(
        true,
      );
    });

    it.each([A.READ_CHANNEL, A.READ_MESSAGE, A.JOIN_CHANNEL])(
      'keeps %s (read, connect and listen)',
      (action) => {
        const i = input({ baseActions: allChannel, timedOut: true });
        expect(channelActionsGranted(i, [action])).toBe(true);
      },
    );

    it('a role allow cannot lift a timeout', () => {
      const i = input({
        baseActions: allChannel,
        roleIds: [MOD_ROLE],
        overwrites: ANNOUNCEMENT,
        timedOut: true,
      });
      expect(channelActionsGranted(i, [A.CREATE_MESSAGE])).toBe(false);
    });

    it('capabilities show listen-only voice', () => {
      const caps = toCapabilities(
        input({ baseActions: allChannel, timedOut: true }),
      );
      expect(caps).toMatchObject({
        view: true,
        post: false,
        attach: false,
        react: false,
        threadReply: false,
        connect: true,
        speak: false,
        video: false,
        share: false,
      });
    });
  });

  describe('overwrites only touch channel-scoped actions', () => {
    it('ignores community-scoped actions in allow and deny', () => {
      const effective = computeChannelActions(
        input({
          overwrites: [
            everyone([A.BAN_USER, A.READ_MEMBER], [A.DELETE_COMMUNITY]),
          ],
        }),
      );
      expect(effective.has(A.READ_MEMBER)).toBe(true);
      expect(effective.has(A.DELETE_COMMUNITY)).toBe(false);
    });
  });

  describe('visibility', () => {
    it.each<[string, Partial<ChannelPermissionInput>, boolean]>([
      ['public channel, community member', {}, true],
      ['not a community member', { isCommunityMember: false }, false],
      ['private, not in it', { isPrivate: true }, false],
      ['private, in it', { isPrivate: true, hasChannelMembership: true }, true],
      [
        'everyone deny READ_CHANNEL',
        { overwrites: [everyone([A.READ_CHANNEL])] },
        false,
      ],
      [
        'everyone deny READ_CHANNEL + role allow',
        {
          roleIds: [MOD_ROLE],
          overwrites: [
            everyone([A.READ_CHANNEL]),
            role(MOD_ROLE, [A.READ_CHANNEL]),
          ],
        },
        true,
      ],
      [
        'roles never had READ_CHANNEL: still sees public channels (as before)',
        { baseActions: [A.CREATE_MESSAGE] },
        true,
      ],
    ])('%s', (_name, over, visible) => {
      expect(canViewChannel(input(over))).toBe(visible);
    });

    it('a hidden channel grants no channel-scoped action at all', () => {
      const effective = computeChannelActions(
        input({ overwrites: [everyone([A.READ_CHANNEL])] }),
      );
      expect(effective.has(A.CREATE_MESSAGE)).toBe(false);
      expect(effective.has(A.READ_MESSAGE)).toBe(false);
      expect(effective.has(A.READ_MEMBER)).toBe(true); // community-scoped
    });

    it.each<[string, boolean, OverwriteInput[], boolean]>([
      ['public, no overwrites', false, [], true],
      ['private', true, [], false],
      [
        'public with everyone deny READ_CHANNEL',
        false,
        [everyone([A.READ_CHANNEL])],
        false,
      ],
      ['public with everyone deny CREATE_MESSAGE', false, ANNOUNCEMENT, true],
    ])(
      'isVisibleToWholeCommunity: %s',
      (_name, isPrivate, overwrites, expected) => {
        expect(isVisibleToWholeCommunity({ isPrivate, overwrites })).toBe(
          expected,
        );
      },
    );

    it('capabilities of a hidden channel are all false except manage', () => {
      const caps = toCapabilities(
        input({
          isPrivate: true,
          baseActions: [...MEMBER, A.MANAGE_CHANNEL_PERMISSIONS],
        }),
      );
      expect(caps).toEqual({
        view: false,
        post: false,
        attach: false,
        react: false,
        threadReply: false,
        connect: false,
        speak: false,
        video: false,
        share: false,
        managePermissions: true,
      });
    });
  });
});
