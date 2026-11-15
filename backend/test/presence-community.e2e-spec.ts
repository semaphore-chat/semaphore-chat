import { randomUUID } from 'crypto';
import { PresenceService } from '@/presence/presence.service';
import { authzFixture, AuthzFixture } from './helpers/authz-fixture';

/**
 * GET /api/presence/community/:communityId: who of ONE community is online,
 * behind the same permission the member list needs (READ_MEMBER). A
 * non-member learns nothing (no count either); an unknown community answers
 * exactly as the member list does.
 *
 * Presence is the real Redis-backed index: `addConnection` is the path a
 * socket takes, so marking someone online here is the same "online" the bulk
 * presence endpoint reports.
 */
describe('Community presence (e2e)', () => {
  const names = ['owner', 'member', 'outsider'] as const;
  type Who = (typeof names)[number];
  let f: AuthzFixture<Who>;
  let presence: PresenceService;

  beforeAll(async () => {
    f = await authzFixture('pc', names);
    presence = f.app.get(PresenceService);
  });

  afterAll(async () => {
    await f.app.close();
  });

  /** A fresh community with `member` in it; `outsider` stays out. */
  async function scene() {
    const c = await f.community();
    await f.join(c.id, 'member');
    return c;
  }

  const getPresence = (communityId: string, who: Who) =>
    f
      .http()
      .get(`/api/presence/community/${communityId}`)
      .set('Authorization', f.bearer(who));

  it('reports the online members and the community size to a member', async () => {
    const c = await scene();
    await presence.addConnection(f.id.member, 'e2e-conn-member', 120);
    await presence.addConnection(f.id.outsider, 'e2e-conn-outsider', 120);

    const res = await getPresence(c.id, 'member').expect(200);
    const body = res.body as {
      onlineUserIds: string[];
      onlineCount: number;
      memberCount: number;
    };

    expect(body.onlineUserIds).toContain(f.id.member);
    // An instance-online user who is not a member of this community stays out.
    expect(body.onlineUserIds).not.toContain(f.id.outsider);
    expect(body.onlineCount).toBe(body.onlineUserIds.length);
    expect(await f.db.membership.count({ where: { communityId: c.id } })).toBe(
      body.memberCount,
    );

    // Going offline drops out of the list and the count.
    await presence.removeConnection(f.id.member, 'e2e-conn-member');
    await presence.removeConnection(f.id.outsider, 'e2e-conn-outsider');
    const after = await getPresence(c.id, 'member').expect(200);
    const afterBody = after.body as {
      onlineUserIds: string[];
      onlineCount: number;
    };
    expect(afterBody.onlineUserIds).not.toContain(f.id.member);
    expect(afterBody.onlineCount).toBe(afterBody.onlineUserIds.length);
  });

  it('lists every online member of the community', async () => {
    const c = await scene();
    await presence.addConnection(f.id.member, 'e2e-conn-m2', 120);
    await presence.addConnection(f.id.owner, 'e2e-conn-owner', 120);

    const res = await getPresence(c.id, 'member').expect(200);
    const { onlineUserIds } = res.body as { onlineUserIds: string[] };
    expect([...onlineUserIds].sort()).toEqual([f.id.member, f.id.owner].sort());

    await presence.removeConnection(f.id.member, 'e2e-conn-m2');
    await presence.removeConnection(f.id.owner, 'e2e-conn-owner');
  });

  it('denies a non-member and tells them nothing', async () => {
    const c = await scene();
    await presence.addConnection(f.id.member, 'e2e-conn-m3', 120);

    const res = await getPresence(c.id, 'outsider').expect(403);
    expect(res.body).not.toHaveProperty('onlineCount');
    expect(res.body).not.toHaveProperty('memberCount');
    expect(res.body).not.toHaveProperty('onlineUserIds');

    await presence.removeConnection(f.id.member, 'e2e-conn-m3');
  });

  it('rejects an unauthenticated caller', async () => {
    const c = await scene();
    await f.http().get(`/api/presence/community/${c.id}`).expect(401);
  });

  it('answers an unknown community exactly as the member list does', async () => {
    const unknown = randomUUID();

    const presenceRes = await getPresence(unknown, 'member');
    const membersRes = await f
      .http()
      .get(`/api/membership/community/${unknown}`)
      .set('Authorization', f.bearer('member'));

    expect(presenceRes.status).toBe(membersRes.status);
    expect(presenceRes.body).toEqual(membersRes.body);
  });
});
