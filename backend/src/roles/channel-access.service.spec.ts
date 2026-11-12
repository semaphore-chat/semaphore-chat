import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  InstanceRole,
  OverwriteTarget,
  RbacActions as A,
} from '@prisma/client';
import { ChannelAccessService } from './channel-access.service';
import { PermissionsService } from './permissions.service';
import { RbacResourceType } from '@/auth/rbac-resource.decorator';
import { DatabaseService } from '@/database/database.service';
import { createMockDatabase } from '@/test-utils';
import { DEFAULT_MEMBER_ROLE } from './default-roles.config';

const COMMUNITY = 'community-1';
const USER = 'user-1';

const channel = (
  id: string,
  isPrivate = false,
  overwrites: {
    targetType: OverwriteTarget;
    roleId: string | null;
    userId: string | null;
    allow: A[];
    deny: A[];
  }[] = [],
) => ({ id, communityId: COMMUNITY, isPrivate, overwrites });

describe('ChannelAccessService', () => {
  let service: ChannelAccessService;
  let db: ReturnType<typeof createMockDatabase>;
  let permissions: Mocked<PermissionsService>;

  beforeEach(async () => {
    db = createMockDatabase();
    const { unit, unitRef } = await TestBed.solitary(ChannelAccessService)
      .mock(DatabaseService)
      .final(db)
      .compile();
    service = unit;
    permissions = unitRef.get(PermissionsService);

    // A regular member with the default Member role, in no private channel
    db.user.findUnique.mockResolvedValue({ role: InstanceRole.USER });
    db.membership.findMany.mockResolvedValue([{ communityId: COMMUNITY }]);
    db.userRoles.findMany.mockResolvedValue([
      {
        communityId: COMMUNITY,
        roleId: 'member-role',
        role: { actions: DEFAULT_MEMBER_ROLE.actions },
      },
    ]);
    db.channelMembership.findMany.mockResolvedValue([]);
    db.communityTimeout.findMany.mockResolvedValue([]);
  });

  describe('visibleChannelIds', () => {
    it('hides private channels the user is not in, shows the ones they are', async () => {
      db.channel.findMany.mockResolvedValue([
        channel('public'),
        channel('private-in', true),
        channel('private-out', true),
      ]);
      db.channelMembership.findMany.mockResolvedValue([
        { channelId: 'private-in' },
      ]);

      await expect(service.visibleChannelIds(USER, COMMUNITY)).resolves.toEqual(
        ['public', 'private-in'],
      );
    });

    it('hides a channel whose overwrites deny READ_CHANNEL', async () => {
      db.channel.findMany.mockResolvedValue([
        channel('public'),
        channel('mods-only', false, [
          {
            targetType: OverwriteTarget.EVERYONE,
            roleId: null,
            userId: null,
            allow: [],
            deny: [A.READ_CHANNEL],
          },
        ]),
      ]);
      await expect(service.visibleChannelIds(USER, COMMUNITY)).resolves.toEqual(
        ['public'],
      );
    });

    it('shows nothing to a non-member of the community', async () => {
      db.membership.findMany.mockResolvedValue([]);
      db.userRoles.findMany.mockResolvedValue([]);
      db.channel.findMany.mockResolvedValue([channel('public')]);
      await expect(service.visibleChannelIds(USER, COMMUNITY)).resolves.toEqual(
        [],
      );
    });

    it('shows everything to the instance owner (same bypass as RbacGuard)', async () => {
      db.user.findUnique.mockResolvedValue({ role: InstanceRole.OWNER });
      db.membership.findMany.mockResolvedValue([]);
      db.channel.findMany.mockResolvedValue([
        channel('public'),
        channel('private', true),
      ]);
      await expect(service.visibleChannelIds(USER, COMMUNITY)).resolves.toEqual(
        ['public', 'private'],
      );
    });

    it('returns [] without querying for no communities', async () => {
      await expect(service.visibleChannelIds(USER, [])).resolves.toEqual([]);
      expect(db.channel.findMany).not.toHaveBeenCalled();
    });
  });

  describe('viewerUserIds', () => {
    it('plain private channel (fast path): one query for its members and owners', async () => {
      db.channel.findUnique.mockResolvedValue(channel('private', true));
      db.membership.findMany.mockResolvedValue([
        { userId: 'in' },
        { userId: 'owner' },
      ]);

      await expect(service.viewerUserIds('private')).resolves.toEqual([
        'in',
        'owner',
      ]);
      expect(db.membership.findMany).toHaveBeenCalledTimes(1);
      expect(db.membership.findMany).toHaveBeenCalledWith({
        where: {
          communityId: COMMUNITY,
          OR: [
            { user: { ChannelMembership: { some: { channelId: 'private' } } } },
            { user: { role: InstanceRole.OWNER } },
          ],
        },
        select: { userId: true },
      });
      // No full member scan, no separate ChannelMembership/role loads
      expect(db.channelMembership.findMany).not.toHaveBeenCalled();
      expect(db.userRoles.findMany).not.toHaveBeenCalled();
    });

    it('private channel with overwrites: full evaluation (members, plus owners)', async () => {
      db.channel.findUnique.mockResolvedValue(
        channel('private', true, [
          {
            targetType: OverwriteTarget.EVERYONE,
            roleId: null,
            userId: null,
            allow: [],
            deny: [A.CREATE_MESSAGE],
          },
        ]),
      );
      db.membership.findMany.mockResolvedValue([
        { userId: 'in', user: { role: InstanceRole.USER } },
        { userId: 'out', user: { role: InstanceRole.USER } },
        { userId: 'owner', user: { role: InstanceRole.OWNER } },
      ]);
      db.channelMembership.findMany.mockResolvedValue([{ userId: 'in' }]);
      db.userRoles.findMany.mockResolvedValue([]);

      await expect(service.viewerUserIds('private')).resolves.toEqual([
        'in',
        'owner',
      ]);
    });

    it('public channel: every community member', async () => {
      db.channel.findUnique.mockResolvedValue(channel('public'));
      db.membership.findMany.mockResolvedValue([
        { userId: 'a', user: { role: InstanceRole.USER } },
        { userId: 'b', user: { role: InstanceRole.USER } },
      ]);
      await expect(service.viewerUserIds('public')).resolves.toEqual([
        'a',
        'b',
      ]);
      expect(db.channelMembership.findMany).not.toHaveBeenCalled();
    });
  });

  describe('roomPlan / audienceRoom', () => {
    it('public channel: the whole community room', async () => {
      db.channel.findUnique.mockResolvedValue(channel('public'));
      await expect(service.roomPlan('public')).resolves.toEqual({
        everyone: true,
        communityId: COMMUNITY,
      });
      await expect(service.audienceRoomFor('public')).resolves.toBe(
        `community:${COMMUNITY}`,
      );
    });

    it('private channel: viewers join, everyone else is removed', async () => {
      db.channel.findUnique.mockResolvedValue(channel('private', true));
      // roomPlan's member list, then viewerUserIds' fast path
      db.membership.findMany.mockImplementation(
        (args: { where: { OR?: unknown } }) =>
          Promise.resolve(
            args.where.OR
              ? [{ userId: 'in' }]
              : [{ userId: 'in' }, { userId: 'out' }],
          ),
      );

      await expect(service.roomPlan('private')).resolves.toEqual({
        everyone: false,
        communityId: COMMUNITY,
        viewers: ['in'],
        nonViewers: ['out'],
      });
      // Events about it go to the channel room, never the community room
      await expect(service.audienceRoomFor('private')).resolves.toBe('private');
    });
  });

  describe('communityCapabilities', () => {
    it('lists only visible channels, with the compact capability shape', async () => {
      db.channel.findMany.mockResolvedValue([
        channel('public'),
        channel('private', true),
      ]);
      db.role.findMany.mockResolvedValue([
        {
          id: 'member-role',
          name: 'Member',
          position: 100,
          actions: DEFAULT_MEMBER_ROLE.actions,
        },
      ]);

      const caps = await service.communityCapabilities(USER, COMMUNITY);

      expect(caps).toEqual([
        {
          channelId: 'public',
          view: true,
          post: true,
          attach: true,
          react: true,
          threadReply: true,
          connect: true,
          speak: true,
          video: true,
          share: true,
          managePermissions: false,
          pin: false,
          deleteAny: false,
          seeRemoved: false,
          timedOutUntil: null,
          postingRoleNames: ['Member'],
        },
      ]);
    });

    it('reports the timeout end and listen-only voice for a timed-out member', async () => {
      const until = new Date(Date.now() + 60_000);
      db.channel.findMany.mockResolvedValue([channel('public')]);
      db.communityTimeout.findMany.mockResolvedValue([
        { communityId: COMMUNITY, expiresAt: until },
      ]);

      const [caps] = await service.communityCapabilities(USER, COMMUNITY);

      expect(caps).toMatchObject({
        view: true,
        post: false,
        react: false,
        threadReply: false,
        connect: true,
        speak: false,
        video: false,
        share: false,
        timedOutUntil: until,
      });
    });

    it('applies a channel overwrite that denies a capability', async () => {
      db.channel.findMany.mockResolvedValue([
        channel('public', false, [
          {
            targetType: OverwriteTarget.EVERYONE,
            roleId: null,
            userId: null,
            allow: [],
            deny: [A.CREATE_MESSAGE],
          },
        ]),
      ]);

      const [caps] = await service.communityCapabilities(USER, COMMUNITY);

      // The channel is still visible: only posting was overwritten
      expect(caps).toMatchObject({
        view: true,
        post: false,
        threadReply: false,
        attach: true,
        react: true,
      });
    });

    it('applies a role overwrite that allows a capability back', async () => {
      db.channel.findMany.mockResolvedValue([
        channel('public', false, [
          {
            targetType: OverwriteTarget.EVERYONE,
            roleId: null,
            userId: null,
            allow: [],
            deny: [A.CREATE_MESSAGE],
          },
          {
            targetType: OverwriteTarget.ROLE,
            roleId: 'member-role',
            userId: null,
            allow: [A.CREATE_MESSAGE],
            deny: [],
          },
        ]),
      ]);

      const [caps] = await service.communityCapabilities(USER, COMMUNITY);

      expect(caps).toMatchObject({ view: true, post: true, threadReply: true });
    });
  });

  describe('filterViewers', () => {
    it('public channel: looks up only the candidates, never every member', async () => {
      db.channel.findUnique.mockResolvedValue(channel('public'));
      db.membership.findMany.mockResolvedValue([{ userId: 'a' }]);

      await expect(
        service.filterViewers('public', ['a', 'b']),
      ).resolves.toEqual(['a']);
      expect(db.membership.findMany).toHaveBeenCalledWith({
        where: { communityId: COMMUNITY, userId: { in: ['a', 'b'] } },
        select: { userId: true },
      });
      expect(db.membership.findMany).toHaveBeenCalledTimes(1);
    });

    it('private channel: intersects with the viewers', async () => {
      db.channel.findUnique.mockResolvedValue(channel('private', true));
      db.membership.findMany.mockResolvedValue([{ userId: 'in' }]);

      await expect(
        service.filterViewers('private', ['in', 'out']),
      ).resolves.toEqual(['in']);
    });

    it('no candidates: no queries', async () => {
      await expect(service.filterViewers('public', [])).resolves.toEqual([]);
      expect(db.channel.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('assertMayModerateParticipant', () => {
    const actor = { id: 'actor', role: InstanceRole.USER };

    beforeEach(() => {
      db.channel.findUnique.mockResolvedValue({
        communityId: COMMUNITY,
      });
      permissions.outranks.mockResolvedValue(false);
    });

    it('404s a channel that does not exist', async () => {
      db.channel.findUnique.mockResolvedValue(null);

      await expect(
        service.assertMayModerateParticipant(actor, 'gone', 'target'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('lets an instance owner act on anyone', async () => {
      await expect(
        service.assertMayModerateParticipant(
          { id: 'owner', role: InstanceRole.OWNER },
          'channel-1',
          'target',
        ),
      ).resolves.toBeUndefined();
      expect(db.user.findUnique).not.toHaveBeenCalled();
      expect(permissions.outranks).not.toHaveBeenCalled();
    });

    it('never lets anyone act on the instance owner', async () => {
      db.user.findUnique.mockResolvedValue({ role: InstanceRole.OWNER });
      permissions.outranks.mockResolvedValue(true);

      await expect(
        service.assertMayModerateParticipant(actor, 'channel-1', 'owner'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(permissions.outranks).not.toHaveBeenCalled();
    });

    it('requires strictly outranking the target', async () => {
      db.user.findUnique.mockResolvedValue({ role: InstanceRole.USER });

      await expect(
        service.assertMayModerateParticipant(actor, 'channel-1', 'peer'),
      ).rejects.toThrow('You can only server mute someone you outrank');

      permissions.outranks.mockResolvedValue(true);
      await expect(
        service.assertMayModerateParticipant(
          actor,
          'channel-1',
          'lower',
          'remove',
        ),
      ).resolves.toBeUndefined();
    });
  });

  describe('moderatableParticipantIds', () => {
    const actor = { id: 'actor', role: InstanceRole.USER };

    beforeEach(() => {
      db.channel.findUnique.mockResolvedValue({
        communityId: COMMUNITY,
      });
      permissions.verifyActionsForUserAndResource.mockResolvedValue(true);
      permissions.outranksMany.mockResolvedValue(new Map());
    });

    it('never includes the caller, and needs the mute action here', async () => {
      permissions.verifyActionsForUserAndResource.mockResolvedValue(false);

      await expect(
        service.moderatableParticipantIds(actor, 'channel-1', [
          'actor',
          'member',
        ]),
      ).resolves.toEqual(new Set());
      expect(permissions.verifyActionsForUserAndResource).toHaveBeenCalledWith(
        actor.id,
        'channel-1',
        RbacResourceType.CHANNEL,
        [A.MUTE_PARTICIPANT],
      );
    });

    it('includes only users the caller strictly outranks', async () => {
      db.user.findMany.mockResolvedValue([
        { id: 'lower', role: InstanceRole.USER },
        { id: 'peer', role: InstanceRole.USER },
        { id: 'owner', role: InstanceRole.OWNER },
      ]);
      permissions.outranksMany.mockResolvedValue(
        new Map([
          ['lower', true],
          ['peer', false],
        ]),
      );

      await expect(
        service.moderatableParticipantIds(actor, 'channel-1', [
          'actor',
          'lower',
          'peer',
          'owner',
        ]),
      ).resolves.toEqual(new Set(['lower']));
      // One batched call; the instance owner is never a target, so never ranked
      expect(permissions.outranksMany).toHaveBeenCalledTimes(1);
      expect(permissions.outranksMany).toHaveBeenCalledWith(
        'actor',
        ['lower', 'peer'],
        COMMUNITY,
      );
    });

    it('lets an instance owner moderate everyone else', async () => {
      await expect(
        service.moderatableParticipantIds(
          { id: 'owner', role: InstanceRole.OWNER },
          'channel-1',
          ['owner', 'anyone'],
        ),
      ).resolves.toEqual(new Set(['anyone']));
      expect(
        permissions.verifyActionsForUserAndResource,
      ).not.toHaveBeenCalled();
      expect(db.user.findMany).not.toHaveBeenCalled();
    });
  });
});
