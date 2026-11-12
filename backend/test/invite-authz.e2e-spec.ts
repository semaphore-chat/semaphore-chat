import * as request from 'supertest';
import { randomUUID } from 'crypto';
import { RbacActions } from '@prisma/client';
import { authzFixture, AuthzFixture, unique } from './helpers/authz-fixture';

/**
 * Invites: a creator can only target communities they may invite to, and the
 * public lookup answers with what the join screen shows and nothing else.
 *
 * inviter  Invite Manager: instance invites only, no community rights
 * admin    Instance Admin
 * member   Used as the redeemer in usage rows
 */
describe('Instance invites (e2e)', () => {
  const names = ['owner', 'inviter', 'admin', 'member', 'local'] as const;
  type Who = (typeof names)[number];
  let f: AuthzFixture<Who>;

  const create = (who: Who, communityIds: string[]) =>
    f
      .http()
      .post('/api/invite')
      .set('Authorization', f.bearer(who))
      .send({ communityIds });

  beforeAll(async () => {
    f = await authzFixture('inv', names);
    await f.giveInstance('inviter', await f.instanceRole('Invite Manager'));
    await f.giveInstance('admin', await f.instanceRole('Instance Admin'));
  });

  afterAll(async () => {
    await f.app.close();
  });

  describe('target communities', () => {
    it('an Invite Manager cannot target a community they have no rights in', async () => {
      const c = await f.community();
      const before = await f.db.instanceInvite.count();
      await create('inviter', [c.id]).expect(403);
      expect(await f.db.instanceInvite.count()).toBe(before);
    });

    it('being a plain member of the community is not enough', async () => {
      const c = await f.community();
      await f.join(c.id, 'inviter');
      await create('inviter', [c.id]).expect(403);
    });

    it('one forbidden community rejects the whole invite', async () => {
      const allowed = await f.community();
      const other = await f.community();
      await f.join(allowed.id, 'inviter');
      await f.give(allowed.id, 'inviter', allowed.adminRole);
      await create('inviter', [allowed.id, other.id]).expect(403);
    });

    it('a community that does not exist gets the same answer', async () => {
      await create('inviter', [randomUUID()]).expect(403);
    });

    it('still allows the legitimate flows', async () => {
      const c = await f.community();
      // Community Admin holds CREATE_INVITE there
      await f.join(c.id, 'inviter');
      await f.give(c.id, 'inviter', c.adminRole);
      await create('inviter', [c.id]).expect(201);
      // An invite with no community is instance-only
      await create('inviter', []).expect(201);
      // Instance-level authority
      const other = await f.community();
      await create('admin', [other.id]).expect(201);
      await create('owner', [other.id]).expect(201);
    });
  });

  describe('community invite management (#685)', () => {
    /** A plain member made Community Admin: no instance role at all. */
    async function communityAdmin() {
      const c = await f.community();
      await f.join(c.id, 'local');
      await f.give(c.id, 'local', c.adminRole);
      return c;
    }

    const list = (who: Who, query = '') =>
      f.http().get(`/api/invite${query}`).set('Authorization', f.bearer(who));

    const del = (who: Who, code: string) =>
      f
        .http()
        .delete(`/api/invite/${code}`)
        .set('Authorization', f.bearer(who));

    it('creates an invite to the community it administers, with no instance permission', async () => {
      const c = await communityAdmin();
      const res = await create('local', [c.id]).expect(201);
      expect(
        await f.db.instanceInviteDefaultCommunity.count({
          where: {
            inviteId: (res.body as { id: string }).id,
            communityId: c.id,
          },
        }),
      ).toBe(1);
    });

    it('cannot create an invite naming a community it does not administer', async () => {
      const c = await communityAdmin();
      const other = await f.community();
      await create('local', [c.id, other.id]).expect(403);
    });

    it('cannot create an invite naming no community', async () => {
      await communityAdmin();
      await create('local', []).expect(403);
    });

    it('cannot create an invite for a community it merely belongs to', async () => {
      const c = await f.community();
      await f.join(c.id, 'local');
      await create('local', [c.id]).expect(403);
    });

    it('lists the invites that include its community', async () => {
      const c = await communityAdmin();
      // Created by an instance admin, so not the community admin's own
      const res = await create('admin', [c.id]).expect(201);
      const { code } = res.body as { code: string };

      const mine = await list('local', `?communityId=${c.id}`).expect(200);
      expect((mine.body as { code: string }[]).map((i) => i.code)).toContain(
        code,
      );
    });

    it("does not list an invite that also names a community the caller can't invite to (the code would join its redeemer there)", async () => {
      const x = await communityAdmin();
      const y = await f.community();
      const crossing = await create('owner', [x.id, y.id]).expect(201);
      const alone = await create('admin', [x.id]).expect(201);
      const crossingCode = (crossing.body as { code: string }).code;
      const aloneCode = (alone.body as { code: string }).code;

      const res = await list('local', `?communityId=${x.id}`).expect(200);
      const codes = (res.body as { code: string }[]).map((i) => i.code);
      expect(codes).toContain(aloneCode);
      expect(codes).not.toContain(crossingCode);
      expect(JSON.stringify(res.body)).not.toContain(crossingCode);

      // The owner can create it, so the owner sees it
      const own = await list('owner', `?communityId=${x.id}`).expect(200);
      expect((own.body as { code: string }[]).map((i) => i.code)).toContain(
        crossingCode,
      );
    });

    it('instance invite read alone does not unlock the filtered list for a community', async () => {
      const c = await f.community();
      await create('owner', [c.id]).expect(201);
      // Invite Manager reads instance invites but holds no right in c
      await list('inviter').expect(200);
      await list('inviter', `?communityId=${c.id}`).expect(403);
    });

    it("refuses another community's invites", async () => {
      await communityAdmin();
      const other = await f.community();
      await list('local', `?communityId=${other.id}`).expect(403);
    });

    it('the unscoped list stays instance-only', async () => {
      await communityAdmin();
      await list('inviter').expect(200);
      await list('local').expect(403);
    });

    it('the creator deletes an invite it created without instance permission', async () => {
      const c = await communityAdmin();
      const res = await create('local', [c.id]).expect(201);
      await del('local', (res.body as { code: string }).code).expect(204);
    });

    it('a community admin deletes an invite naming its community', async () => {
      const c = await communityAdmin();
      const res = await create('admin', [c.id]).expect(201);
      await del('local', (res.body as { code: string }).code).expect(204);
    });

    it('refuses to delete an invite naming a community it does not manage', async () => {
      const c = await communityAdmin();
      const other = await f.community();
      const res = await create('owner', [c.id, other.id]).expect(201);
      const { code } = res.body as { code: string };

      await del('local', code).expect(403);
      expect(await f.db.instanceInvite.count({ where: { code } })).toBe(1);
    });

    it("an instance delete holder deletes anyone's invite", async () => {
      const c = await communityAdmin();
      // Invite Manager holds DELETE_INSTANCE_INVITE, no community rights
      const res = await create('local', [c.id]).expect(201);
      await del('inviter', (res.body as { code: string }).code).expect(204);
    });
  });

  describe('public lookup', () => {
    /** An invite with a creator, a redeemer and a target community. */
    async function seeded(extra: Record<string, unknown> = {}) {
      const c = await f.community();
      const invite = await f.db.instanceInvite.create({
        data: {
          code: unique('code'),
          createdById: f.id.owner,
          uses: 1,
          defaultCommunities: { create: { communityId: c.id } },
          usages: { create: { userId: f.id.member } },
          ...extra,
        },
      });
      return invite;
    }

    const lookup = (code: string) =>
      request(f.app.getHttpServer()).get(`/api/invite/public/${code}`);

    it('answers without a login with what the join screen shows, and nothing else', async () => {
      const invite = await seeded({ maxUses: 5 });
      const res = await lookup(invite.code).expect(200);
      expect(res.body).toEqual({
        code: invite.code,
        uses: 1,
        maxUses: 5,
        validUntil: null,
        disabled: false,
        createdBy: { username: 'inv-owner' },
      });
    });

    it.each([
      ['disabled', { disabled: true }],
      ['expired', { validUntil: new Date(Date.now() - 60_000) }],
      ['used up', { maxUses: 1 }],
    ])('does not answer for a %s invite', async (_label, extra) => {
      const invite = await seeded(extra);
      const res = await lookup(invite.code).expect(200);
      expect(res.body).toEqual({});
    });

    it('an unknown code answers the same way', async () => {
      const res = await lookup('no-such-code').expect(200);
      expect(res.body).toEqual({});
    });

    it('the authenticated lookup keeps the full record for invite managers', async () => {
      const invite = await seeded();
      const res = await f
        .http()
        .get(`/api/invite/${invite.code}`)
        .set('Authorization', f.bearer('inviter'))
        .expect(200);
      expect((res.body as { usages: unknown[] }).usages).toHaveLength(1);
    });

    it('registration through an invite with no communities joins the instance alone', async () => {
      const res = await create('inviter', []).expect(201);
      const { code } = res.body as { code: string };
      const joined = await request(f.app.getHttpServer())
        .post('/api/users')
        .send({ code, username: unique('joiner'), password: 'Password123!' })
        .expect(201);
      expect(
        await f.db.membership.count({
          where: { userId: (joined.body as { id: string }).id },
        }),
      ).toBe(0);
    });

    it('registration through an invite still works and joins its communities', async () => {
      const c = await f.community();
      const code = unique('join');
      await f.db.instanceInvite.create({
        data: {
          code,
          defaultCommunities: { create: { communityId: c.id } },
        },
      });
      const res = await request(f.app.getHttpServer())
        .post('/api/users')
        .send({ code, username: unique('joiner'), password: 'Password123!' })
        .expect(201);
      const userId = (res.body as { id: string }).id;
      expect(
        await f.db.membership.count({ where: { userId, communityId: c.id } }),
      ).toBe(1);
      expect(
        await f.db.userRoles.count({
          where: {
            userId,
            communityId: c.id,
            role: { actions: { has: RbacActions.READ_MESSAGE } },
          },
        }),
      ).toBe(1);
    });
  });
});
