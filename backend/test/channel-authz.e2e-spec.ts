import { authzFixture, AuthzFixture, unique } from './helpers/authz-fixture';

/**
 * Channel reorder stays inside the authorized community, and making a private
 * channel public respects the people already in it. Also: list endpoints cap
 * the page size a client can ask for.
 */
describe('Channel authorization and list limits (e2e)', () => {
  const names = ['owner', 'admin', 'mod', 'mod2', 'member'] as const;
  type Who = (typeof names)[number];
  let f: AuthzFixture<Who>;

  async function scene() {
    const c = await f.community();
    await f.join(c.id, 'admin', 'mod', 'mod2', 'member');
    await f.give(c.id, 'admin', c.adminRole);
    await f.give(c.id, 'mod', c.modRole);
    await f.give(c.id, 'mod2', c.modRole);
    return c;
  }

  beforeAll(async () => {
    f = await authzFixture('ca', names);
  });

  afterAll(async () => {
    await f.app.close();
  });

  describe('moving channels', () => {
    /** A channel in another community, far enough down to find something above. */
    async function foreignChannel() {
      const other = await f.community();
      return f.db.channel.create({
        data: {
          name: unique('foreign'),
          communityId: other.id,
          type: 'TEXT',
          position: 5,
        },
      });
    }

    const positionOf = async (id: string) =>
      (await f.db.channel.findUniqueOrThrow({ where: { id } })).position;

    it.each(['move-up', 'move-down'])(
      '%s cannot touch a channel of another community',
      async (route) => {
        const c = await scene();
        const foreign = await foreignChannel();
        // Something to swap with on either side
        const near = await f.db.channel.create({
          data: {
            name: unique('near'),
            communityId: c.id,
            type: 'TEXT',
            position: route === 'move-up' ? 1 : 9,
          },
        });

        await f
          .http()
          .post(`/api/channels/${foreign.id}/${route}`)
          .set('Authorization', f.bearer('mod'))
          .send({ communityId: c.id })
          .expect(404);
        expect(await positionOf(foreign.id)).toBe(5);
        expect(await positionOf(near.id)).toBe(route === 'move-up' ? 1 : 9);
      },
    );

    it('still moves channels within the community', async () => {
      const c = await scene();
      const lower = await f.db.channel.create({
        data: {
          name: unique('lower'),
          communityId: c.id,
          type: 'TEXT',
          position: 1,
        },
      });
      await f
        .http()
        .post(`/api/channels/${lower.id}/move-up`)
        .set('Authorization', f.bearer('mod'))
        .send({ communityId: c.id })
        .expect(200);
      expect(await positionOf(lower.id)).toBe(0);
    });
  });

  describe('making a private channel public', () => {
    async function privateChannel(communityId: string, ...members: Who[]) {
      const channel = await f.db.channel.create({
        data: {
          name: unique('secret'),
          communityId,
          type: 'TEXT',
          isPrivate: true,
        },
      });
      for (const who of members) {
        await f.db.channelMembership.create({
          data: { userId: f.id[who], channelId: channel.id },
        });
      }
      return channel.id;
    }

    const publish = (channelId: string, who: Who) =>
      f
        .http()
        .patch(`/api/channels/${channelId}`)
        .set('Authorization', f.bearer(who))
        .send({ isPrivate: false });

    const isPrivate = async (id: string) =>
      (await f.db.channel.findUniqueOrThrow({ where: { id } })).isPrivate;

    it('a moderator cannot expose a channel an admin is in', async () => {
      const c = await scene();
      const channelId = await privateChannel(c.id, 'mod', 'admin');
      await publish(channelId, 'mod').expect(403);
      expect(await isPrivate(channelId)).toBe(true);
    });

    it('a moderator cannot expose a channel a peer is in', async () => {
      const c = await scene();
      const channelId = await privateChannel(c.id, 'mod', 'mod2');
      await publish(channelId, 'mod').expect(403);
    });

    it('a moderator can publish a channel only people below them are in', async () => {
      const c = await scene();
      const channelId = await privateChannel(c.id, 'mod', 'member');
      await publish(channelId, 'mod').expect(200);
      expect(await isPrivate(channelId)).toBe(false);
    });

    it('a top-role holder and the instance owner can publish any', async () => {
      const c = await scene();
      const first = await privateChannel(c.id, 'admin', 'mod');
      await publish(first, 'admin').expect(200);
      const second = await privateChannel(c.id, 'mod');
      await publish(second, 'owner').expect(200);
    });
  });

  describe('list limits', () => {
    it('caps moderation logs at 100', async () => {
      const c = await scene();
      await f.db.moderationLog.createMany({
        data: Array.from({ length: 120 }, () => ({
          communityId: c.id,
          moderatorId: f.id.admin,
          action: 'KICK_USER' as const,
        })),
      });
      const res = await f
        .http()
        .get(`/api/moderation/logs/${c.id}?limit=100000`)
        .set('Authorization', f.bearer('admin'))
        .expect(200);
      const body = res.body as { logs: unknown[]; total: number };
      expect(body.logs).toHaveLength(100);
      expect(body.total).toBe(120);
    });

    it('caps member search at 50', async () => {
      const c = await scene();
      const prefix = unique('bulk');
      await f.db.user.createMany({
        data: Array.from({ length: 60 }, (_, i) => ({
          username: `${prefix}-${i}`,
          hashedPassword: 'x',
        })),
      });
      const users = await f.db.user.findMany({
        where: { username: { startsWith: prefix } },
        select: { id: true },
      });
      await f.db.membership.createMany({
        data: users.map((u) => ({ userId: u.id, communityId: c.id })),
      });

      const res = await f
        .http()
        .get(
          `/api/membership/community/${c.id}/search?query=${prefix}&limit=100000`,
        )
        .set('Authorization', f.bearer('member'))
        .expect(200);
      expect(res.body as unknown[]).toHaveLength(50);
    });

    it('caps the admin community list at 100', async () => {
      await f.db.community.createMany({
        data: Array.from({ length: 110 }, () => ({ name: unique('many') })),
      });
      const res = await f
        .http()
        .get('/api/community/admin/list?limit=100000')
        .set('Authorization', f.bearer('owner'))
        .expect(200);
      expect((res.body as { communities: unknown[] }).communities).toHaveLength(
        100,
      );
    });
  });
});
