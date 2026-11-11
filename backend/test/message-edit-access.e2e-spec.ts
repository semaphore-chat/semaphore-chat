import * as request from 'supertest';
import { RbacActions } from '@prisma/client';
import { authzFixture, AuthzFixture } from './helpers/authz-fixture';

/**
 * Editing is a new post as far as everyone else can tell: the new text is
 * broadcast. So being the author isn't enough: it takes what sending takes now.
 * Deleting your own message stays open to its author.
 */
describe('Editing a message after losing access (e2e)', () => {
  const names = ['owner', 'admin', 'mod', 'author', 'friend', 'third'] as const;
  type Who = (typeof names)[number];
  let f: AuthzFixture<Who>;

  const span = (text: string) => ({
    type: 'PLAINTEXT',
    text,
    userId: null,
    specialKind: null,
    communityId: null,
    aliasId: null,
  });
  const edit = (who: Who, messageId: string): request.Test =>
    f
      .http()
      .patch(`/api/messages/${messageId}`)
      .set('Authorization', f.bearer(who))
      .send({ spans: [span('rewritten')] });
  const attach = (who: Who, messageId: string): request.Test =>
    f
      .http()
      .post(`/api/messages/${messageId}/attachments`)
      .set('Authorization', f.bearer(who))
      .send({});
  const del = (who: Who, messageId: string): request.Test =>
    f
      .http()
      .delete(`/api/messages/${messageId}`)
      .set('Authorization', f.bearer(who));
  const textOf = async (messageId: string) =>
    (
      await f.db.message.findUniqueOrThrow({
        where: { id: messageId },
        select: { spans: { select: { text: true } } },
      })
    ).spans[0]?.text;

  async function scene() {
    const c = await f.community();
    await f.join(c.id, 'admin', 'mod', 'author');
    await f.give(c.id, 'admin', c.adminRole);
    await f.give(c.id, 'mod', c.modRole);
    return c;
  }
  async function post(who: Who, target: { channelId: string }) {
    const res = await f
      .http()
      .post('/api/messages')
      .set('Authorization', f.bearer(who))
      .send({ ...target, spans: [span('original')], attachments: [] })
      .expect(201);
    return (res.body as { id: string }).id;
  }
  /** DM messages are sent over the socket: seeded here. */
  const dmMessage = async (groupId: string) =>
    (
      await f.db.message.create({
        data: {
          authorId: f.id.author,
          directMessageGroupId: groupId,
          spans: {
            create: [{ position: 0, type: 'PLAINTEXT', text: 'original' }],
          },
        },
      })
    ).id;
  async function dm(creator: Who, others: Who[], isGroup?: boolean) {
    const res = await f
      .http()
      .post('/api/direct-messages')
      .set('Authorization', f.bearer(creator))
      .send({ userIds: others.map((o) => f.id[o]), isGroup })
      .expect(201);
    return (res.body as { id: string }).id;
  }
  const expectRefused = async (messageId: string) => {
    await edit('author', messageId).expect(403);
    await attach('author', messageId).expect(403);
    expect(await textOf(messageId)).toBe('original');
  };

  beforeAll(async () => {
    f = await authzFixture('mea', names);
    // People need a community in common to open a DM
    const c = await f.community();
    await f.join(c.id, 'author', 'friend', 'third');
  });

  afterAll(async () => {
    await f.app.close();
  });

  describe('channel messages', () => {
    it('an ordinary member still edits and attaches to their own message', async () => {
      const c = await scene();
      const messageId = await post('author', { channelId: c.generalChannel });
      await f.db.message.update({
        where: { id: messageId },
        data: { pendingAttachments: 1 },
      });
      await attach('author', messageId).expect(201);
      await edit('author', messageId).expect(200);
      expect(await textOf(messageId)).toBe('rewritten');
    });

    it('an instance owner edits their own message', async () => {
      const c = await scene();
      const messageId = await post('owner', { channelId: c.generalChannel });
      await edit('owner', messageId).expect(200);
    });

    it('refuses someone kicked from the community', async () => {
      const c = await scene();
      const messageId = await post('author', { channelId: c.generalChannel });
      await f
        .http()
        .post(`/api/moderation/kick/${c.id}/${f.id.author}`)
        .set('Authorization', f.bearer('admin'))
        .send({})
        .expect(200);
      await expectRefused(messageId);
    });

    it('refuses someone banned from the community', async () => {
      const c = await scene();
      const messageId = await post('author', { channelId: c.generalChannel });
      await f
        .http()
        .post(`/api/moderation/ban/${c.id}/${f.id.author}`)
        .set('Authorization', f.bearer('owner'))
        .send({})
        .expect(200);
      await expectRefused(messageId);
    });

    it('refuses someone timed out, until it is lifted', async () => {
      const c = await scene();
      const messageId = await post('author', { channelId: c.generalChannel });
      await f
        .http()
        .post(`/api/moderation/timeout/${c.id}/${f.id.author}`)
        .set('Authorization', f.bearer('admin'))
        .send({ durationSeconds: 600 })
        .expect(200);
      await expectRefused(messageId);

      await f
        .http()
        .delete(`/api/moderation/timeout/${c.id}/${f.id.author}`)
        .set('Authorization', f.bearer('admin'))
        .send({})
        .expect(200);
      await edit('author', messageId).expect(200);
    });

    it('refuses someone taken out of a private channel', async () => {
      const c = await scene();
      const channel = await f.db.channel.create({
        data: {
          name: `private-${c.id.slice(0, 8)}`,
          communityId: c.id,
          isPrivate: true,
        },
      });
      await f.db.channelMembership.create({
        data: { channelId: channel.id, userId: f.id.author },
      });
      const messageId = await post('author', { channelId: channel.id });

      await f.db.channelMembership.delete({
        where: {
          userId_channelId: { userId: f.id.author, channelId: channel.id },
        },
      });
      await expectRefused(messageId);
    });

    it('refuses where CREATE_MESSAGE was denied since', async () => {
      const c = await scene();
      const messageId = await post('author', { channelId: c.generalChannel });
      await f
        .http()
        .put(`/api/channels/${c.generalChannel}/overwrites`)
        .set('Authorization', f.bearer('owner'))
        .send({
          preset: 'CUSTOM',
          overwrites: [
            {
              targetType: 'EVERYONE',
              allow: [],
              deny: [RbacActions.CREATE_MESSAGE],
            },
          ],
        })
        .expect(200);
      await expectRefused(messageId);
    });

    it('refuses a message a moderator removed, whose author can still delete it', async () => {
      const c = await scene();
      const messageId = await post('author', { channelId: c.generalChannel });
      await f
        .http()
        .delete(`/api/moderation/message/${messageId}`)
        .set('Authorization', f.bearer('mod'))
        .send({})
        .expect(200);
      await expectRefused(messageId);
      await del('author', messageId).expect(204);
    });

    it('a kicked author can still delete their message', async () => {
      const c = await scene();
      const messageId = await post('author', { channelId: c.generalChannel });
      await f
        .http()
        .post(`/api/moderation/kick/${c.id}/${f.id.author}`)
        .set('Authorization', f.bearer('admin'))
        .send({})
        .expect(200);
      await del('author', messageId).expect(204);
    });
  });

  describe('DM messages', () => {
    afterEach(async () => {
      await f.db.userBlock.deleteMany({});
    });

    it('a member still edits and attaches to their own message', async () => {
      const groupId = await dm('author', ['friend']);
      const messageId = await dmMessage(groupId);
      await f.db.message.update({
        where: { id: messageId },
        data: { pendingAttachments: 1 },
      });
      await attach('author', messageId).expect(201);
      await edit('author', messageId).expect(200);
    });

    it('someone blocked stops editing old messages in their 1:1 DM', async () => {
      const groupId = await dm('author', ['friend']);
      const messageId = await dmMessage(groupId);
      await f
        .http()
        .post(`/api/users/block/${f.id.author}`)
        .set('Authorization', f.bearer('friend'))
        .expect(201);
      await expectRefused(messageId);
      await del('author', messageId).expect(204);
    });

    it('a block does not stop edits in a group DM', async () => {
      const groupId = await dm('author', ['friend', 'third'], true);
      const messageId = await dmMessage(groupId);
      await f
        .http()
        .post(`/api/users/block/${f.id.author}`)
        .set('Authorization', f.bearer('friend'))
        .expect(201);
      await edit('author', messageId).expect(200);
    });

    it('someone who left stops editing and attaching', async () => {
      const groupId = await dm('author', ['friend', 'third'], true);
      const messageId = await dmMessage(groupId);
      await f
        .http()
        .delete(`/api/direct-messages/${groupId}/members/me`)
        .set('Authorization', f.bearer('author'))
        .expect(204);
      await expectRefused(messageId);
    });
  });
});
