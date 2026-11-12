import { authzFixture, AuthzFixture } from './helpers/authz-fixture';

/**
 * Message search pages with a keyset cursor: the `X-Continuation-Token`
 * response header names the last row of a full page, and passing it back as
 * `continuationToken` continues after that row. Two rows can share `sentAt`,
 * so the cursor is the (sentAt, id) pair: pages must not overlap or skip.
 */
describe('Message search paging (e2e)', () => {
  let f: AuthzFixture<'owner' | 'member'>;

  let communityId: string;
  let channelId: string;
  let groupId: string;

  interface Seeded {
    id: string;
    sentAt: Date;
  }

  const seed = async (
    place: { channelId?: string; directMessageGroupId?: string },
    text: string,
    sentAt: Date,
  ): Promise<Seeded> => ({
    sentAt,
    id: (
      await f.db.message.create({
        data: {
          authorId: f.id.member,
          searchText: text,
          sentAt,
          ...place,
          spans: { create: [{ position: 0, type: 'PLAINTEXT', text }] },
        },
      })
    ).id,
  });

  /** Follows the header until it is absent, returning every page's ids. */
  const walk = async (
    path: string,
    query: string,
  ): Promise<{ ids: string[]; cursor?: string }[]> => {
    const pages: { ids: string[]; cursor?: string }[] = [];
    let cursor: string | undefined;
    for (;;) {
      const url = `${path}?q=${query}&limit=2${cursor ? `&continuationToken=${cursor}` : ''}`;
      const res = await f
        .http()
        .get(url)
        .set('Authorization', f.bearer('member'))
        .expect(200);
      const ids = (res.body as { id: string }[]).map((row) => row.id);
      const next = res.headers['x-continuation-token'] as string | undefined;
      pages.push({ ids, cursor: next });
      if (!next || ids.length === 0) return pages;
      cursor = next;
    }
  };

  /** Pages over `seeded`, asserting 2+2+…+remainder and no repeats. */
  const expectPages = async (path: string, query: string, seeded: Seeded[]) => {
    const pages = await walk(path, query);
    const flattened = pages.flatMap((p) => p.ids);

    // No overlap and no gap: every seeded row exactly once.
    expect(new Set(flattened).size).toBe(flattened.length);
    expect(new Set(flattened)).toEqual(new Set(seeded.map((s) => s.id)));

    const expectedSizes = [2, 2, 1];
    expect(pages.map((p) => p.ids.length)).toEqual(expectedSizes);
    expect(pages[pages.length - 1].cursor).toBeUndefined();

    // Newest first across the whole walk.
    const sentAtById: Record<string, number> = {};
    for (const row of seeded) sentAtById[row.id] = row.sentAt.getTime();
    const times = flattened.map((id) => sentAtById[id]);
    expect(times).toEqual([...times].sort((a, b) => b - a));
  };

  beforeAll(async () => {
    f = await authzFixture('msp', ['owner', 'member']);
    const community = await f.community();
    communityId = community.id;
    channelId = community.generalChannel;
    await f.join(communityId, 'member');

    const dm = await f
      .http()
      .post('/api/direct-messages')
      .set('Authorization', f.bearer('member'))
      .send({ userIds: [f.id.owner] })
      .expect(201);
    groupId = (dm.body as { id: string }).id;
  });

  afterAll(async () => {
    await f.app.close();
  });

  it('pages channel search without overlap or gap', async () => {
    const base = Date.now() - 60_000;
    const seeded = [
      await seed({ channelId }, 'channelpage', new Date(base)),
      await seed({ channelId }, 'channelpage', new Date(base + 1_000)),
      // Same sentAt: the id tiebreaker still pages it exactly once.
      await seed({ channelId }, 'channelpage', new Date(base + 2_000)),
      await seed({ channelId }, 'channelpage', new Date(base + 2_000)),
      await seed({ channelId }, 'channelpage', new Date(base + 3_000)),
    ];

    await expectPages(
      `/api/messages/search/channel/${channelId}`,
      'channelpage',
      seeded,
    );
  });

  it('pages group search without overlap or gap', async () => {
    const base = Date.now() - 30_000;
    const seeded = [
      await seed(
        { directMessageGroupId: groupId },
        'grouppage',
        new Date(base),
      ),
      await seed(
        { directMessageGroupId: groupId },
        'grouppage',
        new Date(base + 1_000),
      ),
      await seed(
        { directMessageGroupId: groupId },
        'grouppage',
        new Date(base + 1_000),
      ),
      await seed(
        { directMessageGroupId: groupId },
        'grouppage',
        new Date(base + 2_000),
      ),
      await seed(
        { directMessageGroupId: groupId },
        'grouppage',
        new Date(base + 3_000),
      ),
    ];

    await expectPages(
      `/api/messages/search/group/${groupId}`,
      'grouppage',
      seeded,
    );
  });

  it('pages community search without overlap or gap', async () => {
    const base = Date.now() - 10_000;
    const seeded = [
      await seed({ channelId }, 'communitypage', new Date(base)),
      await seed({ channelId }, 'communitypage', new Date(base + 1_000)),
      await seed({ channelId }, 'communitypage', new Date(base + 2_000)),
      await seed({ channelId }, 'communitypage', new Date(base + 2_000)),
      await seed({ channelId }, 'communitypage', new Date(base + 3_000)),
    ];

    await expectPages(
      `/api/messages/search/community/${communityId}`,
      'communitypage',
      seeded,
    );
  });

  it('answers a cursor whose row is gone with the last, empty page', async () => {
    const older = await seed({ channelId }, 'deletedcursor', new Date());
    const cursor = await seed(
      { channelId },
      'deletedcursor',
      new Date(older.sentAt.getTime() + 1_000),
    );

    // Without it, the older row is found.
    const page = await f
      .http()
      .get(`/api/messages/search/channel/${channelId}?q=deletedcursor`)
      .set('Authorization', f.bearer('member'))
      .expect(200);
    expect((page.body as { id: string }[]).map((row) => row.id)).toEqual([
      cursor.id,
      older.id,
    ]);

    await f.db.message.delete({ where: { id: cursor.id } });

    const rest = await f
      .http()
      .get(
        `/api/messages/search/channel/${channelId}?q=deletedcursor&continuationToken=${cursor.id}`,
      )
      .set('Authorization', f.bearer('member'))
      .expect(200);

    expect(rest.body).toEqual([]);
    expect(rest.headers['x-continuation-token']).toBeUndefined();
  });
});
