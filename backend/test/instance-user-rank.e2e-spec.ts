import { RbacActions } from '@prisma/client';
import { authzFixture, AuthzFixture, unique } from './helpers/authz-fixture';

/**
 * Instance user management can't reach past the actor's own standing: below
 * full instance authority, you can't act on someone who holds an instance
 * action you lack. A User Manager resetting an admin's password would otherwise
 * sign in as that admin, and so past the rule that stops them granting it.
 */
describe('Instance user management rank (e2e)', () => {
  const names = [
    'owner',
    'admin',
    'admin2',
    'manager',
    'manager2',
    'deleter',
    'inviter',
    'plain',
    'target',
  ] as const;
  type Who = (typeof names)[number];
  let f: AuthzFixture<Who>;

  const password = (actor: Who, target: Who) =>
    f
      .http()
      .patch(`/api/users/admin/${f.id[target]}/password`)
      .set('Authorization', f.bearer(actor))
      .send({ password: 'A-new-Password123!' });
  const ban = (actor: Who, target: Who, banned: boolean) =>
    f
      .http()
      .patch(`/api/users/admin/${f.id[target]}/ban`)
      .set('Authorization', f.bearer(actor))
      .send({ banned });
  const del = (actor: Who, targetId: string) =>
    f
      .http()
      .delete(`/api/users/admin/${targetId}`)
      .set('Authorization', f.bearer(actor));

  const hashOf = async (who: Who) =>
    (await f.db.user.findUniqueOrThrow({ where: { id: f.id[who] } }))
      .hashedPassword;
  const isBanned = async (who: Who) =>
    (await f.db.user.findUniqueOrThrow({ where: { id: f.id[who] } })).banned;

  const newPlainUser = async () =>
    (
      await f.db.user.create({
        data: {
          username: unique('u').toLowerCase(),
          hashedPassword: 'x',
          role: 'USER',
        },
      })
    ).id;

  beforeAll(async () => {
    f = await authzFixture('iur', names);
    const adminRole = await f.instanceRole('Instance Admin');
    const managerRole = await f.instanceRole('User Manager');
    await f.giveInstance('admin', adminRole);
    await f.giveInstance('admin2', adminRole);
    await f.giveInstance('manager', managerRole);
    await f.giveInstance('manager2', managerRole);
    await f.giveInstance('inviter', await f.instanceRole('Invite Manager'));
    // A custom role that can delete people but is short of Instance Admin
    const deleter = await f.db.role.create({
      data: {
        name: unique('deleter'),
        communityId: null,
        actions: [RbacActions.DELETE_USER],
      },
    });
    await f.giveInstance('deleter', deleter.id);
  });

  afterAll(async () => {
    await f.app.close();
  });

  describe('someone short of full authority', () => {
    it("cannot reset the password of someone who holds what they don't", async () => {
      const before = await hashOf('admin');
      await password('manager', 'admin').expect(403);
      expect(await hashOf('admin')).toBe(before);
    });

    it('cannot reset the password of a holder of a different action', async () => {
      await password('manager', 'inviter').expect(403);
    });

    it("cannot ban or unban someone who holds what they don't", async () => {
      await ban('manager', 'admin', true).expect(403);
      expect(await isBanned('admin')).toBe(false);

      await f.db.user.update({
        where: { id: f.id.admin2 },
        data: { banned: true },
      });
      await ban('manager', 'admin2', false).expect(403);
      expect(await isBanned('admin2')).toBe(true);
      await f.db.user.update({
        where: { id: f.id.admin2 },
        data: { banned: false },
      });
    });

    it("cannot delete someone who holds what they don't", async () => {
      await del('deleter', f.id.manager2).expect(403);
      expect(await f.db.user.count({ where: { id: f.id.manager2 } })).toBe(1);
    });

    it('can still manage users with no instance roles', async () => {
      await ban('manager', 'target', true).expect(200);
      await ban('manager', 'target', false).expect(200);
      await password('manager', 'plain').expect(200);
      await del('deleter', await newPlainUser()).expect(200);
    });

    it('can still manage a peer holding the same actions', async () => {
      await ban('manager', 'manager2', true).expect(200);
      await ban('manager', 'manager2', false).expect(200);
    });
  });

  describe('full authority', () => {
    it('two Instance Admins may act on each other', async () => {
      await ban('admin', 'admin2', true).expect(200);
      await ban('admin', 'admin2', false).expect(200);
      await password('admin', 'admin2').expect(200);
    });

    it('an Instance Admin may act on a lesser role', async () => {
      await ban('admin', 'manager', true).expect(200);
      await ban('admin', 'manager', false).expect(200);
    });

    it('an Instance Admin still cannot touch an owner', async () => {
      await password('admin', 'owner').expect(403);
      await ban('admin', 'owner', true).expect(403);
      await del('admin', f.id.owner).expect(403);
    });

    it('an owner may act on anyone below', async () => {
      await ban('owner', 'admin', true).expect(200);
      await ban('owner', 'admin', false).expect(200);
    });
  });
});
