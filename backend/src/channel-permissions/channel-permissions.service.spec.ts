import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  ChannelPreset,
  InstanceRole,
  OverwriteTarget,
  RbacActions as A,
} from '@prisma/client';
import { ServerEvents } from '@semaphore-chat/shared';
import { ChannelPermissionsService } from './channel-permissions.service';
import { DatabaseService } from '@/database/database.service';
import { WebsocketService } from '@/websocket/websocket.service';
import { PermissionsService } from '@/roles/permissions.service';
import { ChannelAccessService } from '@/roles/channel-access.service';
import { RoomEvents } from '@/rooms/room-subscription.events';
import { createMockDatabase, UserFactory } from '@/test-utils';
import { DEFAULT_ADMIN_ROLE } from '@/roles/default-roles.config';
import { ReplaceChannelOverwritesDto } from './dto/channel-overwrite.dto';

const CHANNEL = 'channel-1';
const COMMUNITY = 'community-1';
const MOD_ROLE = 'a0000000-0000-4000-8000-000000000001';

const announcement = (): ReplaceChannelOverwritesDto => ({
  preset: ChannelPreset.ANNOUNCEMENT,
  overwrites: [
    {
      targetType: OverwriteTarget.EVERYONE,
      allow: [],
      deny: [A.CREATE_MESSAGE, A.ATTACH_FILES],
    },
    {
      targetType: OverwriteTarget.ROLE,
      roleId: MOD_ROLE,
      allow: [A.CREATE_MESSAGE, A.ATTACH_FILES],
      deny: [],
    },
  ],
});

describe('ChannelPermissionsService', () => {
  let service: ChannelPermissionsService;
  let db: ReturnType<typeof createMockDatabase>;
  let permissions: Mocked<PermissionsService>;
  let websocket: Mocked<WebsocketService>;
  let events: Mocked<EventEmitter2>;
  let channelAccess: Mocked<ChannelAccessService>;
  const admin = UserFactory.build({ role: InstanceRole.USER });

  beforeEach(async () => {
    db = createMockDatabase();
    const { unit, unitRef } = await TestBed.solitary(ChannelPermissionsService)
      .mock(DatabaseService)
      .final(db)
      .compile();
    service = unit;
    permissions = unitRef.get(PermissionsService);
    websocket = unitRef.get(WebsocketService);
    events = unitRef.get(EventEmitter2);
    channelAccess = unitRef.get(ChannelAccessService);

    db.channel.findUnique.mockImplementation((args: { select: object }) =>
      Promise.resolve(
        'preset' in args.select
          ? { id: CHANNEL, preset: ChannelPreset.ANNOUNCEMENT, overwrites: [] }
          : { id: CHANNEL, communityId: COMMUNITY },
      ),
    );
    db.role.count.mockResolvedValue(1);
    // Nothing stored yet; the actor is a Community Admin (position 10)
    // writing for the Moderator role (position 20)
    db.channelPermissionOverwrite.findMany.mockResolvedValue([]);
    db.userRoles.findMany.mockResolvedValue([{ role: { position: 10 } }]);
    db.role.findMany.mockResolvedValue([
      { id: MOD_ROLE, name: 'Moderator', position: 20, actions: [] },
    ]);
    channelAccess.audienceRoomFor.mockResolvedValue(`community:${COMMUNITY}`);
    // The actor holds the community's top-ranked role (Community Admin)
    permissions.getRank.mockResolvedValue({ best: 10, isTop: true });
    permissions.usersRankedAtOrAbove.mockResolvedValue(new Map());
    permissions.getCommunityActions.mockResolvedValue(
      DEFAULT_ADMIN_ROLE.actions,
    );
  });

  describe('replaceOverwrites', () => {
    it('replaces the EVERYONE/ROLE overwrites and preset in one transaction', async () => {
      await service.replaceOverwrites(CHANNEL, announcement(), admin);

      expect(db.$transaction).toHaveBeenCalledTimes(1);
      expect(db.channelPermissionOverwrite.deleteMany).toHaveBeenCalledWith({
        where: {
          channelId: CHANNEL,
          targetType: { in: [OverwriteTarget.EVERYONE, OverwriteTarget.ROLE] },
        },
      });
      expect(db.channelPermissionOverwrite.createMany).toHaveBeenCalledWith({
        data: [
          {
            channelId: CHANNEL,
            targetType: OverwriteTarget.EVERYONE,
            roleId: null,
            allow: [],
            deny: [A.CREATE_MESSAGE, A.ATTACH_FILES],
          },
          {
            channelId: CHANNEL,
            targetType: OverwriteTarget.ROLE,
            roleId: MOD_ROLE,
            allow: [A.CREATE_MESSAGE, A.ATTACH_FILES],
            deny: [],
          },
        ],
      });
      expect(db.channel.update).toHaveBeenCalledWith({
        where: { id: CHANNEL },
        data: { preset: ChannelPreset.ANNOUNCEMENT },
      });
    });

    it("resyncs the socket room, then tells the channel's audience", async () => {
      await service.replaceOverwrites(CHANNEL, announcement(), admin);

      expect(channelAccess.audienceRoomFor).toHaveBeenCalledWith(CHANNEL);
      expect(events.emitAsync).toHaveBeenCalledWith(
        RoomEvents.CHANNEL_VISIBILITY_CHANGED,
        { channelId: CHANNEL, communityId: COMMUNITY },
      );
      expect(websocket.sendToRoom).toHaveBeenCalledWith(
        `community:${COMMUNITY}`,
        ServerEvents.CHANNEL_PERMISSIONS_UPDATED,
        { communityId: COMMUNITY, channelId: CHANNEL },
      );
    });

    it('drops empty overwrites instead of storing them', async () => {
      await service.replaceOverwrites(
        CHANNEL,
        {
          preset: ChannelPreset.NORMAL,
          overwrites: [
            { targetType: OverwriteTarget.EVERYONE, allow: [], deny: [] },
          ],
        },
        admin,
      );
      expect(db.channelPermissionOverwrite.createMany).not.toHaveBeenCalled();
    });

    it('404s for an unknown channel', async () => {
      db.channel.findUnique.mockResolvedValue(null);
      await expect(
        service.replaceOverwrites(CHANNEL, announcement(), admin),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it.each<[string, ReplaceChannelOverwritesDto['overwrites']]>([
      [
        'MEMBER overwrites (data model only)',
        [
          {
            targetType: OverwriteTarget.MEMBER,
            allow: [A.CREATE_MESSAGE],
            deny: [],
          },
        ],
      ],
      [
        'READ_CHANNEL (visibility overwrites wait for phase 3)',
        [
          {
            targetType: OverwriteTarget.EVERYONE,
            allow: [],
            deny: [A.READ_CHANNEL],
          },
        ],
      ],
      [
        'community-scoped actions (lockout safeguard: never per channel)',
        [
          {
            targetType: OverwriteTarget.EVERYONE,
            allow: [],
            deny: [A.MANAGE_CHANNEL_PERMISSIONS],
          },
        ],
      ],
      [
        'an action both allowed and denied',
        [
          {
            targetType: OverwriteTarget.EVERYONE,
            allow: [A.CREATE_MESSAGE],
            deny: [A.CREATE_MESSAGE],
          },
        ],
      ],
      [
        'two EVERYONE overwrites',
        [
          {
            targetType: OverwriteTarget.EVERYONE,
            allow: [],
            deny: [A.CREATE_MESSAGE],
          },
          {
            targetType: OverwriteTarget.EVERYONE,
            allow: [],
            deny: [A.ATTACH_FILES],
          },
        ],
      ],
      [
        'a ROLE overwrite without a roleId',
        [
          {
            targetType: OverwriteTarget.ROLE,
            allow: [A.CREATE_MESSAGE],
            deny: [],
          },
        ],
      ],
      [
        'two overwrites for one role',
        [
          {
            targetType: OverwriteTarget.ROLE,
            roleId: MOD_ROLE,
            allow: [A.CREATE_MESSAGE],
            deny: [],
          },
          {
            targetType: OverwriteTarget.ROLE,
            roleId: MOD_ROLE,
            allow: [A.ATTACH_FILES],
            deny: [],
          },
        ],
      ],
    ])('rejects %s', async (_name, overwrites) => {
      await expect(
        service.replaceOverwrites(
          CHANNEL,
          { preset: ChannelPreset.CUSTOM, overwrites },
          admin,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(db.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a role from another community', async () => {
      db.role.count.mockResolvedValue(0);
      await expect(
        service.replaceOverwrites(CHANNEL, announcement(), admin),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("anti-escalation: can't allow or deny an action the actor doesn't hold", async () => {
      permissions.getCommunityActions.mockResolvedValue([
        A.MANAGE_CHANNEL_PERMISSIONS,
        A.CREATE_MESSAGE,
      ]);
      await expect(
        service.replaceOverwrites(CHANNEL, announcement(), admin),
      ).rejects.toThrow(
        new ForbiddenException(
          "You can't change permissions you don't have: ATTACH_FILES",
        ),
      );
    });

    it('anti-escalation is checked on the DIFF: removing an entry needs its actions too', async () => {
      // Stored: EVERYONE deny ATTACH_FILES. The actor (no ATTACH_FILES)
      // submits an empty set, i.e. deletes it.
      db.channelPermissionOverwrite.findMany.mockResolvedValue([
        {
          targetType: OverwriteTarget.EVERYONE,
          roleId: null,
          allow: [],
          deny: [A.ATTACH_FILES],
        },
      ]);
      permissions.getCommunityActions.mockResolvedValue([
        A.MANAGE_CHANNEL_PERMISSIONS,
        A.CREATE_MESSAGE,
      ]);
      await expect(
        service.replaceOverwrites(
          CHANNEL,
          { preset: ChannelPreset.NORMAL, overwrites: [] },
          admin,
        ),
      ).rejects.toThrow(
        "You can't change permissions you don't have: ATTACH_FILES",
      );
    });

    it('unchanged entries are not re-checked (an admin can keep a higher-ranked rule while editing others)', async () => {
      const ADMIN_ROLE = 'a0000000-0000-4000-8000-000000000002';
      const keep = {
        targetType: OverwriteTarget.ROLE,
        roleId: ADMIN_ROLE,
        allow: [A.ATTACH_FILES],
        deny: [],
      };
      db.channelPermissionOverwrite.findMany.mockResolvedValue([keep]);
      permissions.getCommunityActions.mockResolvedValue([
        A.MANAGE_CHANNEL_PERMISSIONS,
        A.CREATE_MESSAGE,
      ]);
      db.role.count.mockResolvedValue(1);
      await service.replaceOverwrites(
        CHANNEL,
        {
          preset: ChannelPreset.CUSTOM,
          overwrites: [
            keep,
            {
              targetType: OverwriteTarget.EVERYONE,
              allow: [],
              deny: [A.CREATE_MESSAGE],
            },
          ],
        },
        admin,
      );
      // The kept higher-ranked ADMIN_ROLE entry didn't trip the hierarchy
      expect(db.$transaction).toHaveBeenCalled();
    });

    it.each<[string, number]>([
      ['a role above the actor', 5],
      ['a role at the same position', 10],
    ])(
      "hierarchy: can't write an overwrite for %s",
      async (_name, position) => {
        db.role.findMany.mockResolvedValue([
          { id: MOD_ROLE, name: 'Community Admin', position, actions: [] },
        ]);
        // A deny for a higher/equal role (an allow-only entry is exempt)
        await expect(
          service.replaceOverwrites(
            CHANNEL,
            {
              preset: ChannelPreset.CUSTOM,
              overwrites: [
                {
                  targetType: OverwriteTarget.ROLE,
                  roleId: MOD_ROLE,
                  allow: [],
                  deny: [A.CREATE_MESSAGE],
                },
              ],
            },
            admin,
          ),
        ).rejects.toThrow(
          'You can only change overwrites for roles below your highest role: Community Admin',
        );
        expect(db.$transaction).not.toHaveBeenCalled();
      },
    );

    it("hierarchy: can't remove an overwrite for a higher role", async () => {
      db.channelPermissionOverwrite.findMany.mockResolvedValue([
        {
          targetType: OverwriteTarget.ROLE,
          roleId: MOD_ROLE,
          allow: [],
          deny: [A.CREATE_MESSAGE],
        },
      ]);
      db.role.findMany.mockResolvedValue([
        { id: MOD_ROLE, name: 'Community Admin', position: 5, actions: [] },
      ]);
      await expect(
        service.replaceOverwrites(
          CHANNEL,
          { preset: ChannelPreset.NORMAL, overwrites: [] },
          admin,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('hierarchy: EVERYONE overwrites need no rank', async () => {
      db.userRoles.findMany.mockResolvedValue([{ role: { position: 100 } }]);
      permissions.getRank.mockResolvedValue({ best: 100, isTop: false });
      await service.replaceOverwrites(
        CHANNEL,
        {
          preset: ChannelPreset.READ_ONLY,
          overwrites: [
            {
              targetType: OverwriteTarget.EVERYONE,
              allow: [],
              deny: [A.CREATE_MESSAGE],
            },
          ],
        },
        admin,
      );
      expect(db.$transaction).toHaveBeenCalled();
    });

    describe('an EVERYONE deny must not strip roles above the actor', () => {
      const ADMIN_ROLE = 'a0000000-0000-4000-8000-000000000002';
      const MEMBER_ROLE = 'a0000000-0000-4000-8000-000000000003';
      const moderator = UserFactory.build({ role: InstanceRole.USER });
      const denyPosting = {
        targetType: OverwriteTarget.EVERYONE,
        allow: [],
        deny: [A.CREATE_MESSAGE],
      };

      const adminRole = { id: ADMIN_ROLE, actions: [A.CREATE_MESSAGE] };
      const modRole = { id: MOD_ROLE, actions: [A.CREATE_MESSAGE] };
      const memberRole = { id: MEMBER_ROLE, actions: [A.CREATE_MESSAGE] };

      beforeEach(() => {
        db.userRoles.findMany.mockResolvedValue([{ role: { position: 20 } }]);
        // The actor is a Moderator; the Community Admin above them also
        // holds Member (their real role set)
        permissions.getRank.mockResolvedValue({ best: 20, isTop: false });
        permissions.usersRankedAtOrAbove.mockResolvedValue(
          new Map([['admin-user', [adminRole, memberRole]]]),
        );
        db.role.findMany.mockResolvedValue([
          {
            id: ADMIN_ROLE,
            name: 'Community Admin',
            position: 10,
            actions: [A.CREATE_MESSAGE],
          },
          {
            id: MOD_ROLE,
            name: 'Moderator',
            position: 20,
            actions: [A.CREATE_MESSAGE],
          },
          {
            id: MEMBER_ROLE,
            name: 'Member',
            position: 100,
            actions: [A.CREATE_MESSAGE],
          },
        ]);
      });

      it('rejects a Moderator denying posting for everyone (the review probe)', async () => {
        await expect(
          service.replaceOverwrites(
            CHANNEL,
            { preset: ChannelPreset.READ_ONLY, overwrites: [denyPosting] },
            moderator,
          ),
        ).rejects.toThrow(
          'This would remove CREATE_MESSAGE from roles above yours; add allows for them or ask an admin',
        );
        expect(db.$transaction).not.toHaveBeenCalled();
      });

      it('accepts it with an explicit allow for every higher role holding the action', async () => {
        await service.replaceOverwrites(
          CHANNEL,
          {
            preset: ChannelPreset.READ_ONLY,
            overwrites: [
              denyPosting,
              {
                targetType: OverwriteTarget.ROLE,
                roleId: ADMIN_ROLE,
                allow: [A.CREATE_MESSAGE],
                deny: [],
              },
            ],
          },
          moderator,
        );
        expect(db.$transaction).toHaveBeenCalled();
      });

      it('a deny on a higher role is still rejected (only growing allows are exempt)', async () => {
        await expect(
          service.replaceOverwrites(
            CHANNEL,
            {
              preset: ChannelPreset.CUSTOM,
              overwrites: [
                {
                  targetType: OverwriteTarget.ROLE,
                  roleId: ADMIN_ROLE,
                  allow: [],
                  deny: [A.CREATE_MESSAGE],
                },
              ],
            },
            moderator,
          ),
        ).rejects.toThrow('roles below your highest role: Community Admin');
      });

      it("can't drop the higher role's allow afterwards (judged by its effect on the admin)", async () => {
        db.channelPermissionOverwrite.findMany.mockResolvedValue([
          { ...denyPosting, roleId: null },
          {
            targetType: OverwriteTarget.ROLE,
            roleId: ADMIN_ROLE,
            allow: [A.CREATE_MESSAGE],
            deny: [],
          },
        ]);
        await expect(
          service.replaceOverwrites(
            CHANNEL,
            { preset: ChannelPreset.READ_ONLY, overwrites: [denyPosting] },
            moderator,
          ),
        ).rejects.toThrow(
          'This would remove CREATE_MESSAGE from roles above yours; add allows for them or ask an admin',
        );
      });

      it('can relax a preset: drop the @everyone deny together with the automatic allow', async () => {
        // Moderator applied a read-only preset earlier (deny + Admin allow);
        // going back to Normal takes nothing away from Community Admin.
        db.channelPermissionOverwrite.findMany.mockResolvedValue([
          { ...denyPosting, roleId: null },
          {
            targetType: OverwriteTarget.ROLE,
            roleId: ADMIN_ROLE,
            allow: [A.CREATE_MESSAGE],
            deny: [],
          },
        ]);
        await service.replaceOverwrites(
          CHANNEL,
          { preset: ChannelPreset.NORMAL, overwrites: [] },
          moderator,
        );
        expect(db.$transaction).toHaveBeenCalled();
      });

      it('can narrow a preset (read-only to announcement) with its automatic allows', async () => {
        const readOnly = [A.CREATE_MESSAGE, A.ATTACH_FILES, A.CREATE_REACTION];
        const announcement = [A.CREATE_MESSAGE, A.ATTACH_FILES];
        db.role.findMany.mockResolvedValue([
          {
            id: ADMIN_ROLE,
            name: 'Community Admin',
            position: 10,
            actions: readOnly,
          },
          { id: MOD_ROLE, name: 'Moderator', position: 20, actions: readOnly },
        ]);
        permissions.usersRankedAtOrAbove.mockResolvedValue(
          new Map([['admin-user', [{ id: ADMIN_ROLE, actions: readOnly }]]]),
        );
        db.channelPermissionOverwrite.findMany.mockResolvedValue([
          {
            targetType: OverwriteTarget.EVERYONE,
            roleId: null,
            allow: [],
            deny: readOnly,
          },
          {
            targetType: OverwriteTarget.ROLE,
            roleId: ADMIN_ROLE,
            allow: readOnly,
            deny: [],
          },
        ]);
        await service.replaceOverwrites(
          CHANNEL,
          {
            preset: ChannelPreset.ANNOUNCEMENT,
            overwrites: [
              {
                targetType: OverwriteTarget.EVERYONE,
                allow: [],
                deny: announcement,
              },
              {
                targetType: OverwriteTarget.ROLE,
                roleId: ADMIN_ROLE,
                allow: announcement,
                deny: [],
              },
            ],
          },
          moderator,
        );
        expect(db.$transaction).toHaveBeenCalled();
      });

      it('extending a stored EVERYONE deny only checks what higher users still had', async () => {
        db.channelPermissionOverwrite.findMany.mockResolvedValue([
          { ...denyPosting, roleId: null },
        ]);
        await service.replaceOverwrites(
          CHANNEL,
          {
            preset: ChannelPreset.READ_ONLY,
            overwrites: [
              { ...denyPosting, deny: [A.CREATE_MESSAGE, A.CREATE_REACTION] },
            ],
          },
          moderator,
        );
        expect(db.$transaction).toHaveBeenCalled();
      });

      it('holders of the top-ranked role are exempt', async () => {
        db.userRoles.findMany.mockResolvedValue([{ role: { position: 10 } }]);
        permissions.getRank.mockResolvedValue({ best: 10, isTop: true });
        await service.replaceOverwrites(
          CHANNEL,
          { preset: ChannelPreset.READ_ONLY, overwrites: [denyPosting] },
          admin,
        );
        expect(db.$transaction).toHaveBeenCalled();
        expect(permissions.usersRankedAtOrAbove).not.toHaveBeenCalled();
      });

      const memberDeny = {
        targetType: OverwriteTarget.ROLE,
        roleId: MEMBER_ROLE,
        allow: [],
        deny: [A.CREATE_MESSAGE],
      };
      const modAllow = {
        targetType: OverwriteTarget.ROLE,
        roleId: MOD_ROLE,
        allow: [A.CREATE_MESSAGE],
        deny: [],
      };

      it('review probe: a Member deny + Moderator allow is refused when an admin also holds Member', async () => {
        db.role.count.mockResolvedValue(2); // both roles are the community's
        await expect(
          service.replaceOverwrites(
            CHANNEL,
            {
              preset: ChannelPreset.CUSTOM,
              overwrites: [memberDeny, modAllow],
            },
            moderator,
          ),
        ).rejects.toThrow(
          'This would remove CREATE_MESSAGE from roles above yours; add allows for them or ask an admin',
        );
        expect(permissions.usersRankedAtOrAbove).toHaveBeenCalledWith(
          COMMUNITY,
          20,
          moderator.id,
        );
        expect(db.$transaction).not.toHaveBeenCalled();
      });

      it('a peer (same rank, not the actor) losing an action is refused', async () => {
        permissions.usersRankedAtOrAbove.mockResolvedValue(
          new Map([['peer-mod', [modRole, memberRole]]]),
        );
        await expect(
          service.replaceOverwrites(
            CHANNEL,
            { preset: ChannelPreset.CUSTOM, overwrites: [memberDeny] },
            moderator,
          ),
        ).rejects.toBeInstanceOf(ForbiddenException);
      });

      it("the actor's own loss is allowed (the actor is excluded)", async () => {
        // Nobody else at or above the actor holds Member
        permissions.usersRankedAtOrAbove.mockResolvedValue(
          new Map([['admin-user', [adminRole]]]),
        );
        await service.replaceOverwrites(
          CHANNEL,
          { preset: ChannelPreset.CUSTOM, overwrites: [memberDeny] },
          moderator,
        );
        expect(db.$transaction).toHaveBeenCalled();
        expect(permissions.usersRankedAtOrAbove).toHaveBeenCalledWith(
          COMMUNITY,
          20,
          moderator.id,
        );
      });

      it('a top-role actor may do what a Moderator may not', async () => {
        permissions.getRank.mockResolvedValue({ best: 10, isTop: true });
        await service.replaceOverwrites(
          CHANNEL,
          { preset: ChannelPreset.CUSTOM, overwrites: [memberDeny] },
          admin,
        );
        expect(db.$transaction).toHaveBeenCalled();
      });
    });

    it('the instance owner may set any channel-scoped action', async () => {
      permissions.getCommunityActions.mockResolvedValue([]);
      const owner = UserFactory.build({ role: InstanceRole.OWNER });
      await expect(
        service.replaceOverwrites(CHANNEL, announcement(), owner),
      ).resolves.toBeDefined();
      expect(permissions.getCommunityActions).not.toHaveBeenCalled();
    });
  });

  describe('getOverwrites', () => {
    it('returns the preset and the API-managed overwrites only', async () => {
      await expect(service.getOverwrites(CHANNEL)).resolves.toEqual({
        channelId: CHANNEL,
        preset: ChannelPreset.ANNOUNCEMENT,
        overwrites: [],
      });
      expect(db.channel.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({
            overwrites: expect.objectContaining({
              where: {
                targetType: {
                  in: [OverwriteTarget.EVERYONE, OverwriteTarget.ROLE],
                },
              },
            }),
          }),
        }),
      );
    });
  });
});
