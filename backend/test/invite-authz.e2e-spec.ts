import * as request from 'supertest';
import { randomUUID } from 'crypto';
import { RbacActions } from '@prisma/client';
import { ErrorCode } from '@semaphore-chat/shared';
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
      ['disabled', { disabled: true }, ErrorCode.INVITE_DISABLED],
      [
        'expired',
        { validUntil: new Date(Date.now() - 60_000) },
        ErrorCode.INVITE_EXPIRED,
      ],
      ['used up', { maxUses: 1 }, ErrorCode.INVITE_EXHAUSTED],
    ])('does not answer for a %s invite', async (_label, extra, errorCode) => {
      const invite = await seeded(extra);
      const res = await lookup(invite.code).expect(404);
      expect(res.body).toMatchObject({ errorCode });
    });

    it('an unknown code answers the same way', async () => {
      const res = await lookup('no-such-code').expect(404);
      expect(res.body).toMatchObject({
        errorCode: ErrorCode.INVITE_NOT_FOUND,
      });
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

  describe('accepting with an existing account', () => {
    type AcceptBody = {
      joined: { id: string; name: string }[];
      skipped: { id: string; name: string; reason: string }[];
    };

    const accept = (who: Who, code: string) =>
      f
        .http()
        .post(`/api/invite/${code}/accept`)
        .set('Authorization', f.bearer(who));

    it('joins the invite communities and counts one use', async () => {
      const c = await f.community();
      const res = await create('owner', [c.id]).expect(201);
      const { code } = res.body as { code: string };

      const accepted = await accept('member', code).expect(200);
      const body = accepted.body as AcceptBody;
      expect(body.joined).toHaveLength(1);
      expect(body.joined[0].id).toBe(c.id);
      expect(typeof body.joined[0].name).toBe('string');
      expect(body.skipped).toEqual([]);

      expect(
        await f.db.membership.count({
          where: { userId: f.id.member, communityId: c.id },
        }),
      ).toBe(1);
      expect(
        await f.db.userRoles.count({
          where: {
            userId: f.id.member,
            communityId: c.id,
            role: { name: 'Member' },
          },
        }),
      ).toBe(1);

      const invite = await f.db.instanceInvite.findUniqueOrThrow({
        where: { code },
        include: { usages: true },
      });
      expect(invite.uses).toBe(1);
      expect(invite.usages).toHaveLength(1);
    });

    it('does not spend a use when the user is already in every community', async () => {
      const c = await f.community();
      const { code } = (await create('owner', [c.id]).expect(201)).body as {
        code: string;
      };
      await accept('member', code).expect(200);

      const again = await accept('member', code).expect(200);
      const body = again.body as AcceptBody;
      expect(body.joined).toEqual([]);
      expect(body.skipped).toHaveLength(1);
      expect(body.skipped[0].id).toBe(c.id);
      expect(body.skipped[0].reason).toBe('already_member');
      expect(
        (await f.db.instanceInvite.findUniqueOrThrow({ where: { code } })).uses,
      ).toBe(1);
    });

    it('skips a community that banned the user and still joins the others', async () => {
      const bannedFrom = await f.community();
      const joined = await f.community();
      await f.db.communityBan.create({
        data: {
          communityId: bannedFrom.id,
          userId: f.id.member,
          moderatorId: f.id.owner,
        },
      });
      const { code } = (
        await create('owner', [bannedFrom.id, joined.id]).expect(201)
      ).body as { code: string };

      const res = await accept('member', code).expect(200);
      const body = res.body as AcceptBody;

      expect(body.joined.map((community) => community.id)).toEqual([joined.id]);
      expect(body.skipped).toHaveLength(1);
      expect(body.skipped[0]).toMatchObject({
        id: bannedFrom.id,
        reason: 'banned',
      });
      expect(
        await f.db.membership.count({
          where: { userId: f.id.member, communityId: joined.id },
        }),
      ).toBe(1);
      expect(
        await f.db.membership.count({
          where: { userId: f.id.member, communityId: bannedFrom.id },
        }),
      ).toBe(0);
    });

    it('refuses a second user once the use limit is spent and does not add them', async () => {
      const c = await f.community();
      const { code } = (
        await f
          .http()
          .post('/api/invite')
          .set('Authorization', f.bearer('owner'))
          .send({ communityIds: [c.id], maxUses: 1 })
          .expect(201)
      ).body as { code: string };

      await accept('member', code).expect(200);
      const res = await accept('admin', code).expect(404);
      expect(res.body).toMatchObject({
        message: 'No invite found for the provided code.',
      });

      expect(
        await f.db.membership.count({
          where: { userId: f.id.admin, communityId: c.id },
        }),
      ).toBe(0);
      expect(
        await f.db.membership.count({
          where: { communityId: c.id, userId: f.id.member },
        }),
      ).toBe(1);
      expect(
        (await f.db.instanceInvite.findUniqueOrThrow({ where: { code } })).uses,
      ).toBe(1);
    });

    it('lets only one of two simultaneous users through a one-use invite', async () => {
      const c = await f.community();
      const { code } = (
        await f
          .http()
          .post('/api/invite')
          .set('Authorization', f.bearer('owner'))
          .send({ communityIds: [c.id], maxUses: 1 })
          .expect(201)
      ).body as { code: string };

      const statuses = (
        await Promise.all([accept('member', code), accept('admin', code)])
      )
        .map((res) => res.status)
        .sort();

      expect(statuses).toEqual([200, 404]);
      expect(
        await f.db.membership.count({
          where: {
            communityId: c.id,
            userId: { in: [f.id.member, f.id.admin] },
          },
        }),
      ).toBe(1);
    });

    it('refuses an unknown code exactly like registration', async () => {
      const res = await accept('member', 'no-such-code').expect(404);
      expect(res.body).toMatchObject({
        message: 'No invite found for the provided code.',
      });
    });

    it('requires a signed-in user', async () => {
      await f.http().post('/api/invite/code/accept').expect(401);
    });
  });
});
