import { RbacActions } from '@prisma/client';
import { PermissionsCacheService } from '@/roles/permissions-cache.service';
import { authzFixture, AuthzFixture, unique } from './helpers/authz-fixture';

/**
 * Who may assign, remove, edit, reorder and delete roles, community and
 * instance. A non-owner works only strictly below their own highest rank and
 * grants only what they hold. Holders of the community's top-ranked role act
 * as its owners for rank; the instance owner bypasses everything.
 *
 * owner    InstanceRole.OWNER, the first user registered
 * admin    Community Admin (the top default role)
 * mod      Moderator (default: UPDATE_MEMBER, no role editing)
 * helper   A custom role under test, given per test
 * member   Plain member
 * outsider Not in the community
 */
describe('Role hierarchy (e2e)', () => {
  const names = [
    'owner',
    'admin',
    'mod',
    'helper',
    'member',
    'outsider',
  ] as const;
  type Who = (typeof names)[number];
  let f: AuthzFixture<Who>;

  /** Community with admin/mod/member/helper joined and default roles given. */
  async function scene() {
    const c = await f.community();
    await f.join(c.id, 'admin', 'mod', 'helper', 'member');
    await f.give(c.id, 'admin', c.adminRole);
    await f.give(c.id, 'mod', c.modRole);
    return c;
  }

  const roleRows = (userId: string, roleId: string) =>
    f.db.userRoles.count({ where: { userId, roleId } });
  const roleRow = (roleId: string) =>
    f.db.role.findUniqueOrThrow({ where: { id: roleId } });

  beforeAll(async () => {
    f = await authzFixture('rh', names);
  });

  afterAll(async () => {
    await f.app.close();
  });

  describe('assigning community roles', () => {
    it('a moderator cannot give themselves Community Admin', async () => {
      const c = await scene();
      await f
        .http()
        .post(`/api/roles/community/${c.id}/assign`)
        .set('Authorization', f.bearer('mod'))
        .send({ userId: f.id.mod, roleId: c.adminRole })
        .expect(403);
      expect(await roleRows(f.id.mod, c.adminRole)).toBe(0);
    });

    it('a moderator cannot remove Community Admin from an admin', async () => {
      const c = await scene();
      await f
        .http()
        .delete(
          `/api/roles/community/${c.id}/users/${f.id.admin}/roles/${c.adminRole}`,
        )
        .set('Authorization', f.bearer('mod'))
        .expect(403);
      expect(await roleRows(f.id.admin, c.adminRole)).toBe(1);
    });

    it('a moderator cannot give a role to someone ranked above them', async () => {
      const c = await scene();
      const low = await f.customRole(c.id, 50, [RbacActions.READ_COMMUNITY]);
      await f
        .http()
        .post(`/api/roles/community/${c.id}/assign`)
        .set('Authorization', f.bearer('mod'))
        .send({ userId: f.id.admin, roleId: low })
        .expect(403);
    });

    it('a low role carrying an action the actor lacks cannot be given', async () => {
      const c = await scene();
      const low = await f.customRole(c.id, 50, [RbacActions.DELETE_COMMUNITY]);
      await f
        .http()
        .post(`/api/roles/community/${c.id}/assign`)
        .set('Authorization', f.bearer('mod'))
        .send({ userId: f.id.member, roleId: low })
        .expect(403);
    });

    it('a role cannot be given to a non-member, even by the owner', async () => {
      const c = await scene();
      await f
        .http()
        .post(`/api/roles/community/${c.id}/assign`)
        .set('Authorization', f.bearer('owner'))
        .send({ userId: f.id.outsider, roleId: c.memberRole })
        .expect(400);
      expect(await roleRows(f.id.outsider, c.memberRole)).toBe(0);
    });

    it('a role cannot be given to a banned user', async () => {
      const c = await scene();
      await f.db.communityBan.create({
        data: { communityId: c.id, userId: f.id.member, active: true },
      });
      await f
        .http()
        .post(`/api/roles/community/${c.id}/assign`)
        .set('Authorization', f.bearer('owner'))
        .send({ userId: f.id.member, roleId: c.modRole })
        .expect(400);
    });

    it('still allows the legitimate flows', async () => {
      const c = await scene();
      const low = await f.customRole(c.id, 50, [RbacActions.READ_COMMUNITY]);
      // A moderator hands out a role below them, to someone below them
      await f
        .http()
        .post(`/api/roles/community/${c.id}/assign`)
        .set('Authorization', f.bearer('mod'))
        .send({ userId: f.id.member, roleId: low })
        .expect(204);
      await f
        .http()
        .delete(
          `/api/roles/community/${c.id}/users/${f.id.member}/roles/${low}`,
        )
        .set('Authorization', f.bearer('mod'))
        .expect(204);
      // A top-role holder promotes a member to moderator and to co-admin
      await f
        .http()
        .post(`/api/roles/community/${c.id}/assign`)
        .set('Authorization', f.bearer('admin'))
        .send({ userId: f.id.member, roleId: c.modRole })
        .expect(204);
      await f
        .http()
        .post(`/api/roles/community/${c.id}/assign`)
        .set('Authorization', f.bearer('admin'))
        .send({ userId: f.id.helper, roleId: c.adminRole })
        .expect(204);
    });
  });

  describe('editing community roles', () => {
    /** helper holds a role at 15: below admin (10), above moderator (20). */
    async function withHelper(extra: RbacActions[] = []) {
      const c = await scene();
      const helperRole = await f.customRole(c.id, 15, [
        RbacActions.READ_COMMUNITY,
        RbacActions.READ_ROLE,
        RbacActions.UPDATE_ROLE,
        RbacActions.CREATE_ROLE,
        RbacActions.DELETE_ROLE,
        RbacActions.UPDATE_MEMBER,
        RbacActions.KICK_USER,
        ...extra,
      ]);
      await f.give(c.id, 'helper', helperRole);
      return { c, helperRole };
    }

    it('cannot raise your own role, so an admin stays out of reach', async () => {
      const { c, helperRole } = await withHelper();
      await f
        .http()
        .put(`/api/roles/community/${c.id}/${helperRole}`)
        .set('Authorization', f.bearer('helper'))
        .send({ position: 1 })
        .expect(403);
      expect((await roleRow(helperRole)).position).toBe(15);

      await f
        .http()
        .post(`/api/moderation/kick/${c.id}/${f.id.admin}`)
        .set('Authorization', f.bearer('helper'))
        .send({})
        .expect(403);
    });

    it('cannot edit a role above you', async () => {
      const { c } = await withHelper();
      await f
        .http()
        .put(`/api/roles/community/${c.id}/${c.adminRole}`)
        .set('Authorization', f.bearer('helper'))
        .send({ actions: [RbacActions.READ_COMMUNITY] })
        .expect(403);
      expect((await roleRow(c.adminRole)).actions.length).toBeGreaterThan(1);
    });

    it('cannot edit your own highest role', async () => {
      const { c, helperRole } = await withHelper();
      await f
        .http()
        .put(`/api/roles/community/${c.id}/${helperRole}`)
        .set('Authorization', f.bearer('helper'))
        .send({ name: 'renamed', actions: [RbacActions.READ_COMMUNITY] })
        .expect(403);
    });

    it('cannot move a lower role to or above your rank', async () => {
      const { c } = await withHelper();
      const low = await f.customRole(c.id, 60, [RbacActions.READ_COMMUNITY]);
      await f
        .http()
        .put(`/api/roles/community/${c.id}/${low}`)
        .set('Authorization', f.bearer('helper'))
        .send({ position: 15 })
        .expect(403);
    });

    it('cannot create a role at or above your rank', async () => {
      const { c } = await withHelper();
      await f
        .http()
        .post(`/api/roles/community/${c.id}`)
        .set('Authorization', f.bearer('helper'))
        .send({
          name: unique('high'),
          actions: [RbacActions.READ_COMMUNITY],
          position: 15,
        })
        .expect(403);
    });

    it('rejects a position below the minimum, for anyone', async () => {
      const c = await scene();
      for (const position of [0, -1, 1.5]) {
        await f
          .http()
          .post(`/api/roles/community/${c.id}`)
          .set('Authorization', f.bearer('owner'))
          .send({
            name: unique('bad'),
            actions: [RbacActions.READ_COMMUNITY],
            position,
          })
          .expect(400);
      }
    });

    it('a top-role holder cannot create a role above their own rank', async () => {
      const c = await scene();
      await f
        .http()
        .post(`/api/roles/community/${c.id}`)
        .set('Authorization', f.bearer('admin'))
        .send({
          name: unique('above'),
          actions: [RbacActions.READ_COMMUNITY],
          position: 5,
        })
        .expect(403);
    });

    it('cannot delete a role above you', async () => {
      const { c } = await withHelper();
      const above = await f.customRole(c.id, 12, [RbacActions.READ_COMMUNITY]);
      await f
        .http()
        .delete(`/api/roles/community/${c.id}/${above}`)
        .set('Authorization', f.bearer('helper'))
        .expect(403);
    });

    it('cannot reorder your role upward or disturb roles above you', async () => {
      const { c, helperRole } = await withHelper();
      await f
        .http()
        .patch(`/api/roles/community/${c.id}/reorder`)
        .set('Authorization', f.bearer('helper'))
        .send({ roleIds: [helperRole, c.adminRole, c.modRole] })
        .expect(403);
      expect((await roleRow(helperRole)).position).toBe(15);
    });

    it('a top-role holder cannot reorder a role above their own', async () => {
      const c = await scene();
      const custom = await f.customRole(c.id, 30, [RbacActions.READ_COMMUNITY]);
      await f
        .http()
        .patch(`/api/roles/community/${c.id}/reorder`)
        .set('Authorization', f.bearer('admin'))
        .send({ roleIds: [custom, c.adminRole, c.modRole] })
        .expect(403);
    });

    it('reset-defaults cannot grant actions the actor lacks', async () => {
      const { c } = await withHelper();
      // An admin reduced Moderator; helper lacks what a reset would restore
      await f.db.role.update({
        where: { id: c.modRole },
        data: { actions: [RbacActions.READ_COMMUNITY] },
      });
      await f
        .http()
        .post(`/api/roles/community/${c.id}/reset-defaults`)
        .set('Authorization', f.bearer('helper'))
        .expect(403);
      expect((await roleRow(c.modRole)).actions).toEqual([
        RbacActions.READ_COMMUNITY,
      ]);
    });

    it('reset-defaults in an existing community that predates BAN_USER: refused for its Community Admin, works for the owner (#692)', async () => {
      const c = await scene();
      // An existing community: the Community Admin role has no BAN_USER
      const legacy = (await roleRow(c.adminRole)).actions.filter(
        (a) => a !== RbacActions.BAN_USER,
      );
      await f.db.role.update({
        where: { id: c.adminRole },
        data: { actions: legacy },
      });

      await f
        .http()
        .post(`/api/roles/community/${c.id}/reset-defaults`)
        .set('Authorization', f.bearer('admin'))
        .expect(403);
      expect((await roleRow(c.adminRole)).actions).not.toContain(
        RbacActions.BAN_USER,
      );

      await f
        .http()
        .post(`/api/roles/community/${c.id}/reset-defaults`)
        .set('Authorization', f.bearer('owner'))
        .expect(200);
      expect((await roleRow(c.adminRole)).actions).toContain(
        RbacActions.BAN_USER,
      );
    });

    /** helper (15) manages a custom role (60) that holds DELETE_COMMUNITY, which it lacks. */
    async function withRoleHoldingMore() {
      const { c } = await withHelper();
      const low = await f.customRole(c.id, 60, [
        RbacActions.READ_COMMUNITY,
        RbacActions.DELETE_COMMUNITY,
      ]);
      return { c, low };
    }

    it('can rename a role that holds an action the actor lacks (#690)', async () => {
      const { c, low } = await withRoleHoldingMore();
      const name = unique('renamed');

      const res = await f
        .http()
        .put(`/api/roles/community/${c.id}/${low}`)
        .set('Authorization', f.bearer('helper'))
        .send({
          name,
          actions: [RbacActions.READ_COMMUNITY, RbacActions.DELETE_COMMUNITY],
        })
        .expect(200);

      expect((res.body as { name: string }).name).toBe(name);
      expect((await roleRow(low)).actions).toContain(
        RbacActions.DELETE_COMMUNITY,
      );
    });

    it('can remove another action from a role that holds one the actor lacks (#690)', async () => {
      const { c } = await withHelper();
      const low = await f.customRole(c.id, 60, [
        RbacActions.READ_COMMUNITY,
        RbacActions.KICK_USER,
        RbacActions.DELETE_COMMUNITY,
      ]);

      // KICK_USER goes; DELETE_COMMUNITY stays although the helper lacks it
      await f
        .http()
        .put(`/api/roles/community/${c.id}/${low}`)
        .set('Authorization', f.bearer('helper'))
        .send({
          actions: [RbacActions.READ_COMMUNITY, RbacActions.DELETE_COMMUNITY],
        })
        .expect(200);

      expect((await roleRow(low)).actions).toEqual([
        RbacActions.READ_COMMUNITY,
        RbacActions.DELETE_COMMUNITY,
      ]);
    });

    it('cannot add an action the actor lacks (#690)', async () => {
      const { c } = await withHelper();
      const low = await f.customRole(c.id, 60, [RbacActions.READ_COMMUNITY]);

      await f
        .http()
        .put(`/api/roles/community/${c.id}/${low}`)
        .set('Authorization', f.bearer('helper'))
        .send({
          actions: [RbacActions.READ_COMMUNITY, RbacActions.DELETE_COMMUNITY],
        })
        .expect(403);

      expect((await roleRow(low)).actions).toEqual([
        RbacActions.READ_COMMUNITY,
      ]);
    });

    it('still allows the legitimate flows', async () => {
      const { c, helperRole } = await withHelper();
      const low = await f.customRole(c.id, 60, [RbacActions.READ_COMMUNITY]);

      // Below your rank: edit, move lower, delete, reorder what's below
      await f
        .http()
        .put(`/api/roles/community/${c.id}/${low}`)
        .set('Authorization', f.bearer('helper'))
        .send({ actions: [RbacActions.READ_ROLE], position: 70 })
        .expect(200);
      await f
        .http()
        .patch(`/api/roles/community/${c.id}/reorder`)
        .set('Authorization', f.bearer('helper'))
        .send({ roleIds: [c.adminRole, helperRole, low, c.modRole] })
        .expect(200);
      await f
        .http()
        .delete(`/api/roles/community/${c.id}/${low}`)
        .set('Authorization', f.bearer('helper'))
        .expect(204);

      // The RoleManagement screen creates without a position
      const created = await f
        .http()
        .post(`/api/roles/community/${c.id}`)
        .set('Authorization', f.bearer('helper'))
        .send({ name: unique('made'), actions: [RbacActions.READ_COMMUNITY] })
        .expect(201);
      expect((created.body as { position: number }).position).toBeGreaterThan(
        (await roleRow(helperRole)).position,
      );

      // A top-role holder edits the defaults, reorders, resets
      await f
        .http()
        .put(`/api/roles/community/${c.id}/${c.modRole}`)
        .set('Authorization', f.bearer('admin'))
        .send({ actions: [RbacActions.READ_COMMUNITY] })
        .expect(200);
      await f
        .http()
        .patch(`/api/roles/community/${c.id}/reorder`)
        .set('Authorization', f.bearer('admin'))
        .send({
          roleIds: [
            c.adminRole,
            c.modRole,
            helperRole,
            (created.body as { id: string }).id,
          ],
        })
        .expect(200);
      await f
        .http()
        .post(`/api/roles/community/${c.id}/reset-defaults`)
        .set('Authorization', f.bearer('admin'))
        .expect(200);
      expect((await roleRow(c.modRole)).actions).toContain(
        RbacActions.KICK_USER,
      );
    });
  });

  describe('instance roles', () => {
    afterEach(async () => {
      // Instance rows outlive the per-test community
      await f.db.userRoles.deleteMany({
        where: { isInstanceRole: true, userId: { not: f.id.owner } },
      });
      for (const who of names) {
        await f.app.get(PermissionsCacheService).bumpUserEpoch(f.id[who]);
      }
    });

    it('a User Manager cannot give themselves Instance Admin', async () => {
      const manager = await f.instanceRole('User Manager');
      const instanceAdmin = await f.instanceRole('Instance Admin');
      await f.giveInstance('helper', manager);

      await f
        .http()
        .post(`/api/roles/instance/${instanceAdmin}/assign`)
        .set('Authorization', f.bearer('helper'))
        .send({ userId: f.id.helper })
        .expect(403);
      expect(await roleRows(f.id.helper, instanceAdmin)).toBe(0);
    });

    it('a User Manager cannot remove Instance Admin from someone', async () => {
      const manager = await f.instanceRole('User Manager');
      const instanceAdmin = await f.instanceRole('Instance Admin');
      await f.giveInstance('helper', manager);
      await f.giveInstance('admin', instanceAdmin);

      await f
        .http()
        .delete(`/api/roles/instance/${instanceAdmin}/users/${f.id.admin}`)
        .set('Authorization', f.bearer('helper'))
        .expect(403);
      expect(await roleRows(f.id.admin, instanceAdmin)).toBe(1);
    });

    it('a community role cannot be assigned as an instance role, even by the owner', async () => {
      const c = await f.community();
      await f
        .http()
        .post(`/api/roles/instance/${c.adminRole}/assign`)
        .set('Authorization', f.bearer('owner'))
        .send({ userId: f.id.member })
        .expect(404);
      expect(await roleRows(f.id.member, c.adminRole)).toBe(0);
    });

    it('cannot add actions you lack to your own instance role', async () => {
      const own = await f.db.role.create({
        data: {
          name: unique('settings-only'),
          communityId: null,
          actions: [RbacActions.UPDATE_INSTANCE_SETTINGS],
        },
      });
      await f.giveInstance('helper', own.id);

      await f
        .http()
        .put(`/api/roles/instance/${own.id}`)
        .set('Authorization', f.bearer('helper'))
        .send({
          actions: [
            RbacActions.UPDATE_INSTANCE_SETTINGS,
            RbacActions.UPDATE_USER,
          ],
        })
        .expect(403);
      await f
        .http()
        .post('/api/roles/instance')
        .set('Authorization', f.bearer('helper'))
        .send({ name: unique('new'), actions: [RbacActions.DELETE_USER] })
        .expect(403);
    });

    it('still allows the legitimate flows', async () => {
      const instanceAdmin = await f.instanceRole('Instance Admin');
      const inviteManager = await f.instanceRole('Invite Manager');
      const creator = await f.instanceRole('Community Creator');
      const manager = await f.instanceRole('User Manager');
      await f.giveInstance('admin', instanceAdmin);

      // The admin users page: an Instance Admin hands out every default role
      for (const roleId of [inviteManager, creator, manager]) {
        await f
          .http()
          .post(`/api/roles/instance/${roleId}/assign`)
          .set('Authorization', f.bearer('admin'))
          .send({ userId: f.id.member })
          .expect(204);
      }
      await f
        .http()
        .delete(`/api/roles/instance/${inviteManager}/users/${f.id.member}`)
        .set('Authorization', f.bearer('admin'))
        .expect(204);

      // The admin roles page: create and edit a custom instance role
      const created = await f
        .http()
        .post('/api/roles/instance')
        .set('Authorization', f.bearer('admin'))
        .send({ name: unique('custom'), actions: [RbacActions.READ_USER] })
        .expect(201);
      await f
        .http()
        .put(`/api/roles/instance/${(created.body as { id: string }).id}`)
        .set('Authorization', f.bearer('admin'))
        .send({ actions: [RbacActions.READ_USER, RbacActions.UPDATE_USER] })
        .expect(200);

      // A User Manager can pass on a role within what they hold
      const small = await f.db.role.create({
        data: {
          name: unique('small'),
          communityId: null,
          actions: [RbacActions.READ_USER],
        },
      });
      await f.giveInstance('helper', manager);
      await f
        .http()
        .post(`/api/roles/instance/${small.id}/assign`)
        .set('Authorization', f.bearer('helper'))
        .send({ userId: f.id.outsider })
        .expect(204);
    });
  });
});
