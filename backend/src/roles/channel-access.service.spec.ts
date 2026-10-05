import { TestBed } from '@suites/unit';
import {
  InstanceRole,
  OverwriteTarget,
  RbacActions as A,
} from '@prisma/client';
import { ChannelAccessService } from './channel-access.service';
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

  beforeEach(async () => {
    db = createMockDatabase();
    const { unit } = await TestBed.solitary(ChannelAccessService)
      .mock(DatabaseService)
      .final(db)
      .compile();
    service = unit;

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
          timedOutUntil: null,
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
  });
});
