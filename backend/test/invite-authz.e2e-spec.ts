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
  const names = ['owner', 'inviter', 'admin', 'member'] as const;
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
