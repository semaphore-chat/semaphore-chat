import { randomUUID } from 'crypto';
import { RoomsService } from '@/rooms/rooms.service';
import { RoomName } from '@/common/utils/room-name.util';
import type { AuthenticatedSocket } from '@/common/utils/socket.utils';
import { authzFixture, AuthzFixture } from './helpers/authz-fixture';

/**
 * A DM belongs to its members. RbacGuard lets an instance owner skip every
 * check, which used to include DM groups and DM messages: an owner could read
 * any DM, or add themselves to it. Now an owner who isn't a member is refused
 * there like anyone else, while community and channel reads keep the bypass.
 */
describe('Reading a DM takes membership, instance owners included (e2e)', () => {
  const names = ['owner', 'alice', 'bob'] as const;
  type Who = (typeof names)[number];
  let f: AuthzFixture<Who>;

  let groupId: string;
  let dmMessageId: string;
  let dmParentId: string;
  let dmFileId: string;

  const get = (who: Who, path: string) =>
    f.http().get(path).set('Authorization', f.bearer(who));

  const seedMessage = async (
    authorId: string,
    place: { channelId?: string; directMessageGroupId?: string },
    extra: { parentMessageId?: string } = {},
  ) =>
    (
      await f.db.message.create({
        data: {
          authorId,
          searchText: 'secret plans',
          ...place,
          ...extra,
          spans: {
            create: [{ position: 0, type: 'PLAINTEXT', text: 'secret plans' }],
          },
        },
      })
    ).id;

  beforeAll(async () => {
    f = await authzFixture('dmr', names);
    // People need a community in common to open a DM
    const c = await f.community();
    await f.join(c.id, 'alice', 'bob');

    const dm = await f
      .http()
      .post('/api/direct-messages')
      .set('Authorization', f.bearer('alice'))
      .send({ userIds: [f.id.bob] })
      .expect(201);
    groupId = (dm.body as { id: string }).id;

    const place = { directMessageGroupId: groupId };
    dmMessageId = await seedMessage(f.id.alice, place);
    dmParentId = await seedMessage(f.id.alice, place);
    await seedMessage(f.id.bob, place, { parentMessageId: dmParentId });
    await f.db.message.update({
      where: { id: dmParentId },
      data: { replyCount: 1 },
    });

    const filename = `dm-${randomUUID()}.png`;
    const file = await f.db.file.create({
      data: {
        filename,
        mimeType: 'image/png',
        fileType: 'IMAGE',
        size: 1,
        checksum: 'e2e',
        uploadedById: f.id.alice,
        resourceType: 'MESSAGE_ATTACHMENT',
        fileMessageId: dmMessageId,
        storagePath: `e2e/${filename}`,
      },
    });
    await f.db.messageAttachment.create({
      data: { messageId: dmMessageId, fileId: file.id, position: 0 },
    });
    dmFileId = file.id;
  });

  afterAll(async () => {
    await f.app.close();
  });

  const dmReads: [string, () => string][] = [
    ['GET /messages/group/:groupId', () => `/api/messages/group/${groupId}`],
    [
      'GET /messages/group/:groupId/around/:messageId',
      () => `/api/messages/group/${groupId}/around/${dmMessageId}`,
    ],
    [
      'GET /messages/search/group/:groupId',
      () => `/api/messages/search/group/${groupId}?q=secret`,
    ],
    ['GET /messages/:id (a DM message)', () => `/api/messages/${dmMessageId}`],
    [
      'GET /threads/:id/replies (a DM parent)',
      () => `/api/threads/${dmParentId}/replies`,
    ],
    [
      'GET /threads/:id/metadata (a DM parent)',
      () => `/api/threads/${dmParentId}/metadata`,
    ],
    ['GET /direct-messages/:id', () => `/api/direct-messages/${groupId}`],
    [
      'GET /direct-messages/:id/messages',
      () => `/api/direct-messages/${groupId}/messages`,
    ],
    [
      'GET /file/:id/metadata (a DM attachment)',
      () => `/api/file/${dmFileId}/metadata`,
    ],
    [
      'GET /read-receipts/dm-peer-reads/:id',
      () => `/api/read-receipts/dm-peer-reads/${groupId}`,
    ],
  ];

  describe.each(dmReads)('%s', (_name, path) => {
    it('refuses an instance owner who is not in the DM', async () => {
      const res = await get('owner', path()).expect(403);
      expect(JSON.stringify(res.body)).not.toContain('secret plans');
    });

    it('still answers a member', async () => {
      await get('bob', path()).expect(200);
    });
  });

  it('an owner cannot add themselves to a DM group', async () => {
    await f
      .http()
      .post(`/api/direct-messages/${groupId}/members`)
      .set('Authorization', f.bearer('owner'))
      .send({ userIds: [f.id.owner] })
      .expect(403);
    expect(
      await f.db.directMessageGroupMember.count({
        where: { groupId, userId: f.id.owner },
      }),
    ).toBe(0);
  });

  describe('socket rooms', () => {
    async function roomsOf(who: Who): Promise<Set<string>> {
      const rooms = new Set<string>();
      const client = {
        handshake: { user: { id: f.id[who] } },
        rooms,
        join: (room: string) => {
          rooms.add(room);
          return Promise.resolve();
        },
      } as unknown as AuthenticatedSocket;
      await f.app.get(RoomsService).joinAllUserRooms(client);
      return rooms;
    }

    it("an owner's socket doesn't join the DM's room, so hears none of its events", async () => {
      expect(await roomsOf('owner')).not.toContain(RoomName.dmGroup(groupId));
    });

    it("a member's socket does", async () => {
      expect(await roomsOf('bob')).toContain(RoomName.dmGroup(groupId));
    });
  });

  describe('community channels keep the owner bypass', () => {
    let channelId: string;
    let channelMessageId: string;

    beforeAll(async () => {
      const c = await f.community();
      channelId = c.generalChannel;
      channelMessageId = await seedMessage(f.id.alice, { channelId });
      await seedMessage(
        f.id.alice,
        { channelId },
        { parentMessageId: channelMessageId },
      );
      // The owner created the community: take them out of it, so only the
      // bypass can let them read.
      await f.db.userRoles.deleteMany({
        where: { userId: f.id.owner, communityId: c.id },
      });
      await f.db.membership.deleteMany({
        where: { userId: f.id.owner, communityId: c.id },
      });
    });

    it.each([
      [
        'GET /messages/channel/:channelId',
        () => `/api/messages/channel/${channelId}`,
      ],
      ['GET /messages/:id', () => `/api/messages/${channelMessageId}`],
      [
        'GET /threads/:id/replies',
        () => `/api/threads/${channelMessageId}/replies`,
      ],
    ])('%s still answers an owner who is not a member', async (_name, path) => {
      await get('owner', path()).expect(200);
    });
  });
});
