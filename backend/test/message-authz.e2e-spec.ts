import * as request from 'supertest';
import { DatabaseService } from '@/database/database.service';
import {
  createE2eApp,
  resetDatabase,
  seedInstanceInvite,
  registerUser,
  loginUser,
  E2eApp,
} from './helpers/e2e-app';

/**
 * Regression: any authenticated user could edit, delete or add attachments to
 * anyone's message (MessageOwnershipGuard fell back to an RbacGuard with no
 * required actions, which allows everyone).
 *
 * owner   InstanceRole.OWNER, creates the community
 * author  Member, writes the message under test
 * mod     Member + Moderator (DELETE_ANY_MESSAGE)
 * member  Member only
 */
describe('Message edit/delete authorization (e2e)', () => {
  let app: E2eApp;
  let db: DatabaseService;

  const users = {
    owner: { username: 'ma-owner', password: 'Password123!' },
    author: { username: 'ma-author', password: 'Password123!' },
    mod: { username: 'ma-mod', password: 'Password123!' },
    member: { username: 'ma-member', password: 'Password123!' },
  };
  const token: Record<keyof typeof users, string> = {} as never;
  const id: Record<keyof typeof users, string> = {} as never;
  let communityId: string;
  let channelId: string;

  const http = () => request(app.getHttpServer());
  const auth = (who: keyof typeof users) => `Bearer ${token[who]}`;
  const spans = (t: string) => [
    {
      type: 'PLAINTEXT',
      text: t,
      userId: null,
      specialKind: null,
      communityId: null,
      aliasId: null,
    },
  ];

  async function newMessage(text = 'original') {
    const res = await http()
      .post('/api/messages')
      .set('Authorization', auth('author'))
      .send({ channelId, spans: spans(text), attachments: [] })
      .expect(201);
    return (res.body as { id: string }).id;
  }
  const spanText = async (messageId: string) => {
    const res = await http()
      .get(`/api/messages/${messageId}`)
      .set('Authorization', auth('author'))
      .expect(200);
    return (res.body as { spans: { text: string }[] }).spans[0]?.text;
  };
  const edit = (who: keyof typeof users, messageId: string) =>
    http()
      .patch(`/api/messages/${messageId}`)
      .set('Authorization', auth(who))
      .send({ spans: spans('hacked') });
  const del = (who: keyof typeof users, messageId: string) =>
    http().delete(`/api/messages/${messageId}`).set('Authorization', auth(who));
  const attach = (who: keyof typeof users, messageId: string) =>
    http()
      .post(`/api/messages/${messageId}/attachments`)
      .set('Authorization', auth(who))
      .send({});

  beforeAll(async () => {
    app = await createE2eApp();
    db = app.get(DatabaseService);
    await resetDatabase(app);
    await seedInstanceInvite(app);
    for (const who of Object.keys(users) as (keyof typeof users)[]) {
      id[who] = (await registerUser(app, users[who])).id;
      token[who] = (
        await loginUser(app, users[who].username, users[who].password)
      ).accessToken;
    }

    const community = await http()
      .post('/api/community')
      .set('Authorization', auth('owner'))
      .send({ name: 'Authz', description: 'e2e' })
      .expect(201);
    communityId = (community.body as { id: string }).id;

    for (const who of ['author', 'mod', 'member'] as const) {
      await http()
        .post('/api/membership')
        .set('Authorization', auth('owner'))
        .send({ userId: id[who], communityId })
        .expect(201);
    }
    const moderator = await db.role.findFirstOrThrow({
      where: { communityId, name: 'Moderator' },
    });
    await http()
      .post(`/api/roles/community/${communityId}/assign`)
      .set('Authorization', auth('owner'))
      .send({ userId: id.mod, roleId: moderator.id })
      .expect(204);

    const channel = await http()
      .post('/api/channels')
      .set('Authorization', auth('owner'))
      .send({ name: 'authz', communityId, type: 'TEXT', isPrivate: false })
      .expect(201);
    channelId = (channel.body as { id: string }).id;
  });

  afterAll(async () => {
    await app.close();
  });

  it("a plain member cannot edit, delete or attach to another user's message", async () => {
    const messageId = await newMessage();
    await edit('member', messageId).expect(403);
    await attach('member', messageId).expect(403);
    await del('member', messageId).expect(403);
    expect(await spanText(messageId)).toBe('original');
  });

  it('a moderator can delete but not edit or attach', async () => {
    const messageId = await newMessage();
    await edit('mod', messageId).expect(403);
    await attach('mod', messageId).expect(403);
    expect(await spanText(messageId)).toBe('original');
    await del('mod', messageId).expect(204);
    expect(
      await db.message.findUnique({ where: { id: messageId } }),
    ).toBeNull();
  });

  it('the author can edit and delete their own message', async () => {
    const messageId = await newMessage();
    await edit('author', messageId).expect(200);
    expect(await spanText(messageId)).toBe('hacked');
    await del('author', messageId).expect(204);
  });

  it('a missing message is a 404, not allowed', async () => {
    const missing = '00000000-0000-4000-8000-000000000000';
    await edit('member', missing).expect(404);
    await del('member', missing).expect(404);
  });
});
