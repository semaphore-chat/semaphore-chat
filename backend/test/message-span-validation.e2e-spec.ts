import { randomUUID } from 'crypto';
import { authzFixture, AuthzFixture, unique } from './helpers/authz-fixture';

/**
 * Message spans are validated and whitelisted like the rest of the body: a
 * client can't set a span's columns beyond what the frontend sends, and each of
 * the shapes the frontend does send (utils/mentionParser.ts) still works.
 */
describe('Message span validation (e2e)', () => {
  const names = ['owner', 'member'] as const;
  type Who = (typeof names)[number];
  let f: AuthzFixture<Who>;
  let communityId: string;
  let channelId: string;

  const send = (spans: unknown[]) =>
    f
      .http()
      .post('/api/messages')
      .set('Authorization', f.bearer('member'))
      .send({ channelId, spans, attachments: [] });

  beforeAll(async () => {
    f = await authzFixture('span', names);
    const c = await f.community();
    communityId = c.id;
    channelId = c.generalChannel;
    await f.join(c.id, 'member');
  });

  afterAll(async () => {
    await f.app.close();
  });

  it('ignores span columns a client should not set', async () => {
    const forgedId = randomUUID();
    const res = await send([
      { type: 'PLAINTEXT', text: 'hi', id: forgedId, position: 99 },
    ]).expect(201);

    const spans = await f.db.messageSpan.findMany({
      where: { messageId: (res.body as { id: string }).id },
    });
    expect(spans).toHaveLength(1);
    expect(spans[0].id).not.toBe(forgedId);
    expect(spans[0].position).toBe(0);
  });

  it.each([
    ['an unknown type', { type: 'NOPE', text: 'x' }],
    ['a missing type', { text: 'x' }],
    ['text that is not a string', { type: 'PLAINTEXT', text: { a: 1 } }],
    ['a userId that is not a uuid', { type: 'USER_MENTION', userId: 'nope' }],
    ['an aliasId that is not a uuid', { type: 'ALIAS_MENTION', aliasId: 'x' }],
    ['an emojiId that is not a uuid', { type: 'EMOJI', emojiId: 'x' }],
    ['a flag that is not a boolean', { type: 'PLAINTEXT', bold: 'yes' }],
  ])('rejects %s', async (_label, span) => {
    await send([span]).expect(400);
  });

  it('rejects a bad span on edit and on a thread reply', async () => {
    const res = await send([{ type: 'PLAINTEXT', text: 'parent' }]).expect(201);
    const messageId = (res.body as { id: string }).id;
    await f
      .http()
      .patch(`/api/messages/${messageId}`)
      .set('Authorization', f.bearer('member'))
      .send({ spans: [{ type: 'NOPE' }] })
      .expect(400);
    await f
      .http()
      .post(`/api/threads/${messageId}/replies`)
      .set('Authorization', f.bearer('member'))
      .send({ parentMessageId: messageId, spans: [{ type: 'NOPE' }] })
      .expect(400);
  });

  it('accepts every shape the frontend sends', async () => {
    const alias = await f.db.aliasGroup.create({
      data: { name: unique('team'), communityId },
    });
    const emoji = await f.db.file.create({
      data: {
        filename: 'e.png',
        mimeType: 'image/png',
        fileType: 'IMAGE',
        size: 1,
        checksum: 'e2e',
        uploadedById: f.id.owner,
        resourceType: 'CUSTOM_EMOJI',
        storagePath: `e2e/${randomUUID()}.png`,
      },
    });
    const custom = await f.db.customEmoji.create({
      data: { communityId, name: 'party', fileId: emoji.id },
    });

    const res = await send([
      { type: 'PLAINTEXT', text: '' },
      { type: 'PLAINTEXT', text: 'plain' },
      { type: 'PLAINTEXT', text: 'styled', bold: true, italic: null },
      { type: 'CODE_BLOCK', text: 'code' },
      { type: 'USER_MENTION', text: '@member', userId: f.id.member },
      { type: 'SPECIAL_MENTION', text: '@here', specialKind: 'here' },
      { type: 'SPECIAL_MENTION', text: '@channel', specialKind: 'channel' },
      { type: 'ALIAS_MENTION', text: `@${alias.name}`, aliasId: alias.id },
      { type: 'CHANNEL_MENTION', channelId },
      { type: 'EMOJI', text: ':party:', emojiId: custom.id },
    ]).expect(201);

    const spans = await f.db.messageSpan.findMany({
      where: { messageId: (res.body as { id: string }).id },
      orderBy: { position: 'asc' },
    });
    expect(spans.map((s) => s.type)).toEqual([
      'PLAINTEXT',
      'PLAINTEXT',
      'PLAINTEXT',
      'CODE_BLOCK',
      'USER_MENTION',
      'SPECIAL_MENTION',
      'SPECIAL_MENTION',
      'ALIAS_MENTION',
      'CHANNEL_MENTION',
      'EMOJI',
    ]);
    expect(spans[4].userId).toBe(f.id.member);
    expect(spans[7].aliasId).toBe(alias.id);
    expect(spans[9].emojiId).toBe(custom.id);
    expect(spans[2].bold).toBe(true);
  });
});
