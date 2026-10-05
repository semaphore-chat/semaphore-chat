import * as request from 'supertest';
import {
  buildPresetOverwrites,
  detectPreset,
  type PresetId,
} from '@semaphore-chat/shared';
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
 * Channel permissions phase 2 against real Postgres + Redis:
 * - the preset builder the settings UI uses (@semaphore-chat/shared) and the
 *   server's overwrite rules agree: a Moderator and the owner can apply every
 *   preset the UI builds;
 * - #channel mentions store no channel name and never reference a channel
 *   the author can't see (create, edit, thread reply, search);
 * - permissions/me carries the posting role names.
 *
 * owner  InstanceRole.OWNER, created the community (and #hush-zebra, private)
 * admin  Member + Community Admin
 * mod    Member + Moderator
 * member Member only
 */
describe('Channel permissions phase 2 (e2e)', () => {
  let app: E2eApp;
  let db: DatabaseService;

  const users = {
    owner: { username: 'p2-owner', password: 'Password123!' },
    admin: { username: 'p2-admin', password: 'Password123!' },
    mod: { username: 'p2-mod', password: 'Password123!' },
    member: { username: 'p2-member', password: 'Password123!' },
  };
  type Who = keyof typeof users;
  const token = {} as Record<Who, string>;
  const id = {} as Record<Who, string>;

  let communityId: string;
  let generalId: string;
  let presetChannelId: string;
  let secretId: string;
  let moderatorRoleId: string;

  const http = () => request(app.getHttpServer());
  const as = (who: Who) => ({
    get: (url: string) =>
      http().get(url).set('Authorization', `Bearer ${token[who]}`),
    post: (url: string, body: object = {}) =>
      http().post(url).set('Authorization', `Bearer ${token[who]}`).send(body),
    put: (url: string, body: object) =>
      http().put(url).set('Authorization', `Bearer ${token[who]}`).send(body),
    patch: (url: string, body: object) =>
      http().patch(url).set('Authorization', `Bearer ${token[who]}`).send(body),
  });

  const span = (extra: object) => ({
    type: 'PLAINTEXT',
    text: null,
    userId: null,
    specialKind: null,
    communityId: null,
    aliasId: null,
    ...extra,
  });
  const text = (t: string) => span({ text: t });
  const mention = (channelId: string, t = '#hush-zebra') =>
    span({ type: 'CHANNEL_MENTION', channelId, text: t });

  async function createChannel(name: string, isPrivate: boolean) {
    const res = await as('owner')
      .post('/api/channels', { name, communityId, type: 'TEXT', isPrivate })
      .expect(201);
    return (res.body as { id: string }).id;
  }

  beforeAll(async () => {
    app = await createE2eApp();
    db = app.get(DatabaseService);
    await resetDatabase(app);
    await seedInstanceInvite(app);
    for (const who of Object.keys(users) as Who[]) {
      id[who] = (await registerUser(app, users[who])).id; // owner first → OWNER
      token[who] = (
        await loginUser(app, users[who].username, users[who].password)
      ).accessToken;
    }

    const community = await as('owner')
      .post('/api/community', { name: 'Phase2', description: 'e2e' })
      .expect(201);
    communityId = (community.body as { id: string }).id;
    for (const who of ['admin', 'mod', 'member'] as const) {
      await as('owner')
        .post('/api/membership', { userId: id[who], communityId })
        .expect(201);
    }
    const roles = await db.role.findMany({ where: { communityId } });
    const roleId = (name: string) => roles.find((r) => r.name === name)!.id;
    moderatorRoleId = roleId('Moderator');
    for (const [who, name] of [
      ['mod', 'Moderator'],
      ['admin', 'Community Admin'],
    ] as const) {
      await as('owner')
        .post(`/api/roles/community/${communityId}/assign`, {
          userId: id[who],
          roleId: roleId(name),
        })
        .expect(204);
    }

    generalId = await createChannel('p2-general', false);
    presetChannelId = await createChannel('p2-presets', false);
    secretId = await createChannel('hush-zebra', true); // only the owner
  });

  afterAll(async () => {
    await app.close();
  });

  describe('the UI preset builder agrees with the server', () => {
    async function apply(
      who: 'mod' | 'owner',
      preset: PresetId,
      membersCanAttach: boolean,
    ) {
      const roles = await db.role.findMany({ where: { communityId } });
      const mine = await db.userRoles.findMany({
        where: { userId: id[who], communityId },
        include: { role: true },
      });
      const built = buildPresetOverwrites({
        preset,
        postRoleIds: preset === 'NORMAL' ? [] : [moderatorRoleId],
        membersCanAttach,
        roles: roles.map((r) => ({
          id: r.id,
          name: r.name,
          position: r.position,
          actions: r.actions,
        })),
        // the instance owner bypasses the server's hierarchy rules
        actorBestPosition:
          who === 'owner'
            ? null
            : Math.min(...mine.map((ur) => ur.role.position)),
      });
      await as(who)
        .put(`/api/channels/${presetChannelId}/overwrites`, built)
        .expect(200);
      const stored = await as(who)
        .get(`/api/channels/${presetChannelId}/overwrites`)
        .expect(200);
      return {
        built,
        detected: detectPreset(
          (stored.body as { overwrites: Parameters<typeof detectPreset>[0] })
            .overwrites,
        ),
      };
    }

    it.each<[PresetId, boolean]>([
      ['NORMAL', false],
      ['READ_ONLY', false],
      ['ANNOUNCEMENT', false],
      ['NORMAL', true],
    ])(
      'a Moderator applies %s (members can attach: %s) and reads it back',
      async (preset, attach) => {
        const { built, detected } = await apply('mod', preset, attach);
        expect(detected.preset).toBe(preset);
        if (preset !== 'NORMAL') {
          expect(detected.postRoleIds).toContain(moderatorRoleId);
          // the builder kept the action for Community Admin, above the mod
          expect(built.autoAllowedRoleIds.length).toBeGreaterThan(0);
        }
      },
    );

    it('after a Moderator applies READ_ONLY, admins and mods post, members do not', async () => {
      await apply('mod', 'READ_ONLY', false);
      const send = (who: Who) =>
        as(who).post('/api/messages', {
          channelId: presetChannelId,
          spans: [text(`hi from ${who}`)],
          attachments: [],
        });
      await send('admin').expect(201);
      await send('mod').expect(201);
      await send('member').expect(403);

      const caps = await as('member')
        .get(`/api/channels/${presetChannelId}/permissions/me`)
        .expect(200);
      expect(caps.body).toMatchObject({ post: false, react: false });
      expect(
        (caps.body as { postingRoleNames: string[] }).postingRoleNames,
      ).toEqual(['Community Admin', 'Moderator']);
    });

    it.each<PresetId>(['READ_ONLY', 'ANNOUNCEMENT', 'NORMAL'])(
      'the owner applies %s',
      async (preset) => {
        const { detected } = await apply('owner', preset, true);
        expect(detected.preset).toBe(preset);
      },
    );

    it('posting role names list every poster in a normal channel', async () => {
      const res = await as('member')
        .get(`/api/channels/community/${communityId}/permissions/me`)
        .expect(200);
      const general = (
        res.body as {
          channels: { channelId: string; postingRoleNames: string[] }[];
        }
      ).channels.find((c) => c.channelId === generalId)!;
      expect(general.postingRoleNames).toEqual([
        'Community Admin',
        'Moderator',
        'Member',
      ]);
    });
  });

  describe('#channel mentions store no name and respect visibility', () => {
    const spansOf = (messageId: string) =>
      db.messageSpan.findMany({
        where: { messageId },
        orderBy: { position: 'asc' },
      });

    it('create: a visible channel is kept by id with no text', async () => {
      const res = await as('member')
        .post('/api/messages', {
          channelId: generalId,
          spans: [text('see'), mention(presetChannelId, '#p2-presets')],
          attachments: [],
        })
        .expect(201);
      const spans = await spansOf((res.body as { id: string }).id);
      expect(spans[1]).toMatchObject({
        type: 'CHANNEL_MENTION',
        channelId: presetChannelId,
        text: null,
      });
    });

    it('create: a channel the author cannot see is downgraded', async () => {
      const res = await as('member')
        .post('/api/messages', {
          channelId: generalId,
          spans: [text('peek'), mention(secretId)],
          attachments: [],
        })
        .expect(201);
      const messageId = (res.body as { id: string }).id;
      const spans = await spansOf(messageId);
      expect(spans[1]).toMatchObject({
        type: 'PLAINTEXT',
        channelId: null,
        text: '#unknown-channel',
      });
    });

    it('create: the owner (who can see it) mentions it, still without a name', async () => {
      const res = await as('owner')
        .post('/api/messages', {
          channelId: generalId,
          spans: [text('meet in'), mention(secretId)],
          attachments: [],
        })
        .expect(201);
      const messageId = (res.body as { id: string }).id;
      const spans = await spansOf(messageId);
      expect(spans[1]).toMatchObject({
        type: 'CHANNEL_MENTION',
        channelId: secretId,
        text: null,
      });
      const message = await db.message.findUniqueOrThrow({
        where: { id: messageId },
      });
      expect(message.searchText ?? '').not.toContain('hush');
    });

    it('edit: the same rule applies', async () => {
      const res = await as('member')
        .post('/api/messages', {
          channelId: generalId,
          spans: [text('draft')],
          attachments: [],
        })
        .expect(201);
      const messageId = (res.body as { id: string }).id;
      await as('member')
        .patch(`/api/messages/${messageId}`, {
          spans: [mention(secretId), mention(presetChannelId, '#p2-presets')],
        })
        .expect(200);
      const spans = await spansOf(messageId);
      expect(spans[0]).toMatchObject({ type: 'PLAINTEXT', channelId: null });
      expect(spans[1]).toMatchObject({
        type: 'CHANNEL_MENTION',
        channelId: presetChannelId,
        text: null,
      });
    });

    it('thread replies: the same rule applies', async () => {
      const root = await as('owner')
        .post('/api/messages', {
          channelId: generalId,
          spans: [text('thread root')],
          attachments: [],
        })
        .expect(201);
      const rootId = (root.body as { id: string }).id;
      const reply = await as('member')
        .post(`/api/threads/${rootId}/replies`, {
          parentMessageId: rootId,
          spans: [mention(secretId)],
        })
        .expect(201);
      const spans = await spansOf((reply.body as { id: string }).id);
      expect(spans[0]).toMatchObject({
        type: 'PLAINTEXT',
        channelId: null,
        text: '#unknown-channel',
      });
    });

    it('a mention in a DM is always downgraded', async () => {
      const dm = await db.directMessageGroup.create({
        data: {
          isGroup: false,
          members: { create: [{ userId: id.owner }, { userId: id.member }] },
        },
      });
      const res = await as('owner')
        .post('/api/messages', {
          directMessageGroupId: dm.id,
          spans: [mention(generalId, '#p2-general')],
          attachments: [],
        })
        .expect(201);
      const spans = await spansOf((res.body as { id: string }).id);
      expect(spans[0]).toMatchObject({ type: 'PLAINTEXT', channelId: null });
    });

    it('search never finds the hidden channel name, and no stored text has it', async () => {
      for (const who of ['owner', 'member'] as const) {
        const res = await as(who)
          .get(`/api/messages/search/community/${communityId}?q=hush`)
          .expect(200);
        expect(res.body).toEqual([]);
      }
      expect(
        await db.message.count({ where: { searchText: { contains: 'hush' } } }),
      ).toBe(0);
      expect(
        await db.messageSpan.count({ where: { text: { contains: 'hush' } } }),
      ).toBe(0);
    });
  });

  describe('security re-check regressions', () => {
    const post = (
      who: Who,
      channelId: string,
      spans: object[],
      extra: object = {},
    ) =>
      as(who).post('/api/messages', {
        channelId,
        spans,
        attachments: [],
        ...extra,
      });

    async function addUser(username: string, roleIds: string[]) {
      const creds = { username, password: 'Password123!' };
      const user = await registerUser(app, creds);
      const accessToken = (await loginUser(app, username, creds.password))
        .accessToken;
      await as('owner')
        .post('/api/membership', { userId: user.id, communityId })
        .expect(201);
      for (const roleId of roleIds) {
        await as('owner')
          .post(`/api/roles/community/${communityId}/assign`, {
            userId: user.id,
            roleId,
          })
          .expect(204);
      }
      return { id: user.id, token: accessToken };
    }

    it('a Moderator cannot make a public channel private over the admins (probe: was 200)', async () => {
      const channelId = await createChannel('p2-privatize', false);
      const res = await as('mod')
        .patch(`/api/channels/${channelId}`, { isPrivate: true })
        .expect(403);
      expect((res.body as { message: string }).message).toContain(
        'members ranked at or above you',
      );
      expect(
        (await db.channel.findUniqueOrThrow({ where: { id: channelId } }))
          .isPrivate,
      ).toBe(false);
      await as('admin').get(`/api/channels/${channelId}`).expect(200);
    });

    it('the top role may make a channel private', async () => {
      const channelId = await createChannel('p2-privatize-top', false);
      await as('admin')
        .patch(`/api/channels/${channelId}`, { isPrivate: true })
        .expect(200);
      // ...and the owner can always undo it
      await as('owner')
        .patch(`/api/channels/${channelId}`, { isPrivate: false })
        .expect(200);
    });

    it('a deny on a lower role may not hit higher users who also hold it (probe: was 200)', async () => {
      const channelId = await createChannel('p2-lower-role', false);
      const memberRole = await db.role.findFirstOrThrow({
        where: { communityId, name: 'Member' },
      });
      const res = await as('mod')
        .put(`/api/channels/${channelId}/overwrites`, {
          preset: 'CUSTOM',
          overwrites: [
            {
              targetType: 'ROLE',
              roleId: memberRole.id,
              allow: [],
              deny: ['CREATE_MESSAGE'],
            },
            {
              targetType: 'ROLE',
              roleId: moderatorRoleId,
              allow: ['CREATE_MESSAGE'],
              deny: [],
            },
          ],
        })
        .expect(403);
      expect((res.body as { message: string }).message).toContain(
        'CREATE_MESSAGE',
      );
      await post('admin', channelId, [text('admins still post')]).expect(201);
    });

    it('same-rank peers are protected too (Peer probe)', async () => {
      const channelId = await createChannel('p2-peer', false);
      const peerRole = await db.role.create({
        data: {
          name: 'Peer',
          communityId,
          position: 20, // same rank as Moderator
          actions: ['READ_CHANNEL', 'READ_MESSAGE', 'CREATE_MESSAGE'],
        },
      });
      const peer = await addUser('p2-peer', [peerRole.id]);
      const adminRole = await db.role.findFirstOrThrow({
        where: { communityId, name: 'Community Admin' },
      });
      // Keeps the admins and the Moderator role posting, but not Peer
      const res = await as('mod')
        .put(`/api/channels/${channelId}/overwrites`, {
          preset: 'CUSTOM',
          overwrites: [
            {
              targetType: 'EVERYONE',
              roleId: null,
              allow: [],
              deny: ['CREATE_MESSAGE'],
            },
            {
              targetType: 'ROLE',
              roleId: adminRole.id,
              allow: ['CREATE_MESSAGE'],
              deny: [],
            },
            {
              targetType: 'ROLE',
              roleId: moderatorRoleId,
              allow: ['CREATE_MESSAGE'],
              deny: [],
            },
          ],
        })
        .expect(403);
      expect((res.body as { message: string }).message).toContain(
        'CREATE_MESSAGE',
      );
      await http()
        .post('/api/messages')
        .set('Authorization', `Bearer ${peer.token}`)
        .send({ channelId, spans: [text('peer still posts')], attachments: [] })
        .expect(201);
    });

    it("a member never receives the id of a channel they can't see", async () => {
      const sent = await post('owner', generalId, [
        text('see '),
        mention(secretId),
      ]).expect(201);
      const messageId = (sent.body as { id: string }).id;
      // A reply quoting it (reply previews carry the quoted spans)
      await post('admin', generalId, [text('ok')], {
        replyToId: messageId,
      }).expect(201);

      const asMember = await as('member')
        .get(`/api/messages/channel/${generalId}`)
        .expect(200);
      expect(JSON.stringify(asMember.body)).not.toContain(secretId);
      const mentionSpans =
        JSON.stringify(asMember.body).match(/"CHANNEL_MENTION"/g) ?? [];
      expect(mentionSpans.length).toBeGreaterThanOrEqual(2); // the message and the preview

      const single = await as('member')
        .get(`/api/messages/${messageId}`)
        .expect(200);
      expect(JSON.stringify(single.body)).not.toContain(secretId);

      // The owner, who can see it, gets the id
      const asOwner = await as('owner')
        .get(`/api/messages/channel/${generalId}`)
        .expect(200);
      expect(JSON.stringify(asOwner.body)).toContain(secretId);
    });
  });
});
