import { randomUUID } from 'crypto';
import { ClientEvents } from '@semaphore-chat/shared';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { io, Socket } from 'socket.io-client';
import * as request from 'supertest';
import { DatabaseService } from '@/database/database.service';
import {
  createE2eApp,
  E2eApp,
  loginUser,
  registerUser,
  resetDatabase,
  seedInstanceInvite,
} from './helpers/e2e-app';

/**
 * A message belongs to exactly one place: one channel or one DM group. Every
 * path that writes a message has to keep it that way, or the permission check
 * for one target ends up authorizing a write into the other.
 *
 * owner    InstanceRole.OWNER, creates the communities
 * sender   Plain member of `community`, the user under test
 * friend   Shares `ownGroup` with sender
 * insider  Member of `community` and of the private channel
 * dmA, dmB Share `otherGroup`, which sender is not in
 *
 * Channels: `open` (sender may post), `hidden` (private, sender isn't a
 * member), `elsewhere` (a community sender isn't in).
 */
describe('Message target (e2e)', () => {
  let app: E2eApp;
  let db: DatabaseService;
  let url: string;
  let socket: Socket | undefined;

  const names = ['owner', 'sender', 'friend', 'insider', 'dmA', 'dmB'] as const;
  type Who = (typeof names)[number];
  const token = {} as Record<Who, string>;
  const id = {} as Record<Who, string>;

  let open: string;
  let hidden: string;
  let elsewhere: string;
  let ownGroup: string;
  let otherGroup: string;

  const http = () => request(app.getHttpServer());
  const auth = (who: Who) => `Bearer ${token[who]}`;
  const spans = (text: string) => [
    {
      type: 'PLAINTEXT',
      text,
      userId: null,
      specialKind: null,
      communityId: null,
      aliasId: null,
    },
  ];
  const marker = () => `target-${randomUUID()}`;

  /** Where a message with this text ended up, and who can read it. */
  async function placement(text: string) {
    const rows = await db.message.findMany({
      where: { searchText: text },
      select: { channelId: true, directMessageGroupId: true },
    });
    const has = async (who: Who, path: string) => {
      const res = await http().get(path).set('Authorization', auth(who));
      const body = res.body as { messages?: { searchText?: string }[] };
      return JSON.stringify(body.messages ?? []).includes(text);
    };
    return {
      rows,
      inOtherGroup: await has('dmA', `/api/messages/group/${otherGroup}`),
      inHidden: await has('insider', `/api/messages/channel/${hidden}`),
      inElsewhere: await has('owner', `/api/messages/channel/${elsewhere}`),
    };
  }
  const nowhere = {
    rows: [],
    inOtherGroup: false,
    inHidden: false,
    inElsewhere: false,
  };

  async function connect(who: Who): Promise<Socket> {
    const client = io(url, {
      transports: ['websocket'],
      reconnection: false,
      auth: { token: token[who] },
    });
    socket = client;
    await new Promise<void>((resolve, reject) => {
      client.once('connect', () => resolve());
      client.once('connect_error', reject);
    });
    return client;
  }

  /** Socket sends fail with an `exception` event; success acks the message id. */
  function send(
    client: Socket,
    event: ClientEvents,
    payload: Record<string, unknown>,
  ): Promise<{ ack?: unknown; exception?: unknown }> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`no answer to ${event}`)),
        5000,
      );
      const onException = (exception: unknown) => {
        clearTimeout(timer);
        resolve({ exception });
      };
      client.once('exception', onException);
      client.emit(event, payload, (ack: unknown) => {
        clearTimeout(timer);
        client.off('exception', onException);
        resolve({ ack });
      });
    });
  }

  async function channel(
    who: Who,
    communityId: string,
    name: string,
    isPrivate: boolean,
  ) {
    const res = await http()
      .post('/api/channels')
      .set('Authorization', auth(who))
      .send({ name, communityId, type: 'TEXT', isPrivate })
      .expect(201);
    return (res.body as { id: string }).id;
  }

  async function dmGroup(who: Who, other: Who) {
    const res = await http()
      .post('/api/direct-messages')
      .set('Authorization', auth(who))
      .send({ userIds: [id[other]] })
      .expect(201);
    return (res.body as { id: string }).id;
  }

  beforeAll(async () => {
    app = await createE2eApp();
    await app.listen(0);
    const address = (app.getHttpServer() as Server).address() as AddressInfo;
    url = `http://127.0.0.1:${address.port}`;
    db = app.get(DatabaseService);
    await resetDatabase(app);
    await seedInstanceInvite(app);

    for (const who of names) {
      const creds = {
        username: `mt-${who}`.toLowerCase(),
        password: 'Password123!',
      };
      id[who] = (await registerUser(app, creds)).id;
      token[who] = (
        await loginUser(app, creds.username, creds.password)
      ).accessToken;
    }

    const community = await http()
      .post('/api/community')
      .set('Authorization', auth('owner'))
      .send({ name: 'Target', description: 'e2e' })
      .expect(201);
    const communityId = (community.body as { id: string }).id;
    for (const who of ['sender', 'friend', 'insider', 'dmA', 'dmB'] as const) {
      await http()
        .post('/api/membership')
        .set('Authorization', auth('owner'))
        .send({ userId: id[who], communityId })
        .expect(201);
    }
    const other = await http()
      .post('/api/community')
      .set('Authorization', auth('owner'))
      .send({ name: 'Elsewhere', description: 'e2e' })
      .expect(201);

    open = await channel('owner', communityId, 'open', false);
    hidden = await channel('owner', communityId, 'hidden', true);
    elsewhere = await channel(
      'owner',
      (other.body as { id: string }).id,
      'elsewhere',
      false,
    );
    await db.channelMembership.create({
      data: { userId: id.insider, channelId: hidden },
    });

    ownGroup = await dmGroup('sender', 'friend');
    otherGroup = await dmGroup('dmA', 'dmB');
  });

  afterEach(() => {
    socket?.close();
    socket = undefined;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('sending', () => {
    it('REST: a DM group the sender is not in, with no channel', async () => {
      const text = marker();
      const res = await http()
        .post('/api/messages')
        .set('Authorization', auth('sender'))
        .send({
          directMessageGroupId: otherGroup,
          spans: spans(text),
          attachments: [],
        });
      expect(await placement(text)).toEqual(nowhere);
      expect(res.status).toBe(403);
    });

    it('REST: an allowed channel plus another DM group', async () => {
      const text = marker();
      const res = await http()
        .post('/api/messages')
        .set('Authorization', auth('sender'))
        .send({
          channelId: open,
          directMessageGroupId: otherGroup,
          spans: spans(text),
          attachments: [],
        });
      expect(await placement(text)).toEqual(nowhere);
      expect(res.status).toBe(400);
    });

    it('REST: an instance owner still needs a channel', async () => {
      const text = marker();
      const res = await http()
        .post('/api/messages')
        .set('Authorization', auth('owner'))
        .send({
          directMessageGroupId: otherGroup,
          spans: spans(text),
          attachments: [],
        });
      expect(await placement(text)).toEqual(nowhere);
      expect(res.status).toBe(400);
    });

    it('REST: no target at all', async () => {
      const text = marker();
      const res = await http()
        .post('/api/messages')
        .set('Authorization', auth('owner'))
        .send({ spans: spans(text), attachments: [] });
      expect(await placement(text)).toEqual(nowhere);
      expect(res.status).toBe(400);
    });

    it('SEND_MESSAGE: an allowed channel plus another DM group', async () => {
      const client = await connect('sender');
      const text = marker();
      const result = await send(client, ClientEvents.SEND_MESSAGE, {
        channelId: open,
        directMessageGroupId: otherGroup,
        spans: spans(text),
        attachments: [],
      });
      expect(await placement(text)).toEqual(nowhere);
      expect(result.ack).toBeUndefined();
    });

    it('SEND_DM: an own group plus a private channel', async () => {
      const client = await connect('sender');
      const text = marker();
      const result = await send(client, ClientEvents.SEND_DM, {
        directMessageGroupId: ownGroup,
        channelId: hidden,
        spans: spans(text),
        attachments: [],
      });
      expect(await placement(text)).toEqual(nowhere);
      expect(result.ack).toBeUndefined();
    });

    it('SEND_DM: an own group plus a channel in another community', async () => {
      const client = await connect('sender');
      const text = marker();
      const result = await send(client, ClientEvents.SEND_DM, {
        directMessageGroupId: ownGroup,
        channelId: elsewhere,
        spans: spans(text),
        attachments: [],
      });
      expect(await placement(text)).toEqual(nowhere);
      expect(result.ack).toBeUndefined();
    });

    it('a quote cannot reach a message through a second target', async () => {
      const secretText = marker();
      const secret = await db.message.create({
        data: {
          authorId: id.dmA,
          directMessageGroupId: otherGroup,
          searchText: secretText,
          spans: {
            create: [{ position: 0, type: 'PLAINTEXT', text: secretText }],
          },
        },
      });
      const text = marker();
      const res = await http()
        .post('/api/messages')
        .set('Authorization', auth('sender'))
        .send({
          channelId: open,
          directMessageGroupId: otherGroup,
          replyToId: secret.id,
          spans: spans(text),
          attachments: [],
        });
      expect(JSON.stringify(res.body)).not.toContain(secretText);
      expect(res.status).toBe(400);
    });

    it('still accepts one target on each path', async () => {
      const client = await connect('sender');
      const inChannel = marker();
      const inGroup = marker();
      const viaRest = marker();

      const channelSend = await send(client, ClientEvents.SEND_MESSAGE, {
        channelId: open,
        spans: spans(inChannel),
        attachments: [],
      });
      const dmSend = await send(client, ClientEvents.SEND_DM, {
        directMessageGroupId: ownGroup,
        spans: spans(inGroup),
        attachments: [],
      });
      await http()
        .post('/api/messages')
        .set('Authorization', auth('sender'))
        .send({ channelId: open, spans: spans(viaRest), attachments: [] })
        .expect(201);

      expect(typeof channelSend.ack).toBe('string');
      expect(typeof dmSend.ack).toBe('string');
      expect((await placement(inChannel)).rows).toEqual([
        { channelId: open, directMessageGroupId: null },
      ]);
      expect((await placement(inGroup)).rows).toEqual([
        { channelId: null, directMessageGroupId: ownGroup },
      ]);
    });
  });

  describe('thread replies', () => {
    it('take their target from the parent, on both transports', async () => {
      const parent = await http()
        .post('/api/messages')
        .set('Authorization', auth('sender'))
        .send({ channelId: open, spans: spans(marker()), attachments: [] })
        .expect(201);
      const parentMessageId = (parent.body as { id: string }).id;

      const viaRest = marker();
      await http()
        .post(`/api/threads/${parentMessageId}/replies`)
        .set('Authorization', auth('sender'))
        .send({
          channelId: hidden,
          directMessageGroupId: otherGroup,
          spans: spans(viaRest),
          attachments: [],
        })
        .expect(201);

      const client = await connect('sender');
      const viaSocket = marker();
      await send(client, ClientEvents.SEND_THREAD_REPLY, {
        parentMessageId,
        channelId: hidden,
        directMessageGroupId: otherGroup,
        spans: spans(viaSocket),
        attachments: [],
      });

      const expected = [{ channelId: open, directMessageGroupId: null }];
      expect((await placement(viaRest)).rows).toEqual(expected);
      expect((await placement(viaSocket)).rows).toEqual(expected);
    });
  });

  describe('editing', () => {
    async function ownMessage(text: string) {
      const res = await http()
        .post('/api/messages')
        .set('Authorization', auth('sender'))
        .send({ channelId: open, spans: spans(text), attachments: [] })
        .expect(201);
      return (res.body as { id: string }).id;
    }

    it.each([
      ['a private channel', () => ({ channelId: hidden })],
      ['another community', () => ({ channelId: elsewhere })],
      ['another DM group', () => ({ directMessageGroupId: otherGroup })],
    ])('an edit cannot move a message to %s', async (_label, target) => {
      const text = marker();
      const messageId = await ownMessage(text);
      await http()
        .patch(`/api/messages/${messageId}`)
        .set('Authorization', auth('sender'))
        .send({ ...target(), spans: spans(text) });
      const row = await db.message.findUniqueOrThrow({
        where: { id: messageId },
        select: { channelId: true, directMessageGroupId: true },
      });
      expect(row).toEqual({ channelId: open, directMessageGroupId: null });
      const seen = await placement(text);
      expect([seen.inOtherGroup, seen.inHidden, seen.inElsewhere]).toEqual([
        false,
        false,
        false,
      ]);
    });

    it('an edit cannot quote a message the author cannot read', async () => {
      const secretText = marker();
      const secret = await db.message.create({
        data: {
          authorId: id.dmA,
          directMessageGroupId: otherGroup,
          searchText: secretText,
          spans: {
            create: [{ position: 0, type: 'PLAINTEXT', text: secretText }],
          },
        },
      });
      const text = marker();
      const messageId = await ownMessage(text);
      const res = await http()
        .patch(`/api/messages/${messageId}`)
        .set('Authorization', auth('sender'))
        .send({ replyToId: secret.id, spans: spans(text) });
      expect(JSON.stringify(res.body)).not.toContain(secretText);
    });

    it('a plain edit still works when the body repeats the target', async () => {
      const text = marker();
      const messageId = await ownMessage(text);
      const edited = marker();
      await http()
        .patch(`/api/messages/${messageId}`)
        .set('Authorization', auth('sender'))
        .send({ channelId: open, spans: spans(edited) })
        .expect(200);
      const row = await db.message.findUniqueOrThrow({
        where: { id: messageId },
        select: { channelId: true, searchText: true },
      });
      expect(row).toEqual({ channelId: open, searchText: edited });
    });
  });
});
