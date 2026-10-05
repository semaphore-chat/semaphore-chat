import * as request from 'supertest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { RbacActions } from '@prisma/client';
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
 * Channel permissions phase 1 against real Postgres + Redis through the real
 * guard chain: overwrite API, read-only/announcement enforcement, attach
 * files, timeouts, the lockout safeguard, webhooks, the migration backfill,
 * and that a hidden (private) channel never reaches a user who can't view it.
 *
 * owner   InstanceRole.OWNER, created the community (and #secret)
 * manager Member + Community Admin (holds MANAGE_CHANNEL_PERMISSIONS), not in #secret
 * mod     Member + Moderator
 * member  Member only
 * outsider no membership
 */
describe('Channel permissions (e2e)', () => {
  let app: E2eApp;
  let db: DatabaseService;

  const users = {
    owner: { username: 'cp-owner', password: 'Password123!' },
    manager: { username: 'cp-manager', password: 'Password123!' },
    mod: { username: 'cp-mod', password: 'Password123!' },
    member: { username: 'cp-member', password: 'Password123!' },
    outsider: { username: 'cp-outsider', password: 'Password123!' },
  };
  const token: Record<keyof typeof users, string> = {} as never;
  const id: Record<keyof typeof users, string> = {} as never;

  let communityId: string;
  let generalId: string;
  let announcementsId: string;
  let secretId: string;
  let moderatorRoleId: string;

  const http = () => request(app.getHttpServer());
  const as = (who: keyof typeof users) => ({
    get: (url: string) =>
      http().get(url).set('Authorization', `Bearer ${token[who]}`),
    post: (url: string, body: object = {}) =>
      http().post(url).set('Authorization', `Bearer ${token[who]}`).send(body),
    put: (url: string, body: object) =>
      http().put(url).set('Authorization', `Bearer ${token[who]}`).send(body),
    patch: (url: string, body: object) =>
      http().patch(url).set('Authorization', `Bearer ${token[who]}`).send(body),
  });

  const text = (t: string) => [
    {
      type: 'PLAINTEXT',
      text: t,
      userId: null,
      specialKind: null,
      communityId: null,
      aliasId: null,
    },
  ];
  const post = (
    who: keyof typeof users,
    channelId: string,
    t: string,
    extra: object = {},
  ) =>
    as(who).post('/api/messages', {
      channelId,
      spans: text(t),
      attachments: [],
      ...extra,
    });

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
    for (const who of Object.keys(users) as (keyof typeof users)[]) {
      id[who] = (await registerUser(app, users[who])).id; // owner first → OWNER
      token[who] = (
        await loginUser(app, users[who].username, users[who].password)
      ).accessToken;
    }

    const community = await as('owner')
      .post('/api/community', { name: 'Perms', description: 'e2e' })
      .expect(201);
    communityId = (community.body as { id: string }).id;

    for (const who of ['manager', 'mod', 'member'] as const) {
      await as('owner')
        .post('/api/membership', { userId: id[who], communityId })
        .expect(201);
    }
    const roles = await db.role.findMany({ where: { communityId } });
    const roleId = (name: string) => roles.find((r) => r.name === name)!.id;
    moderatorRoleId = roleId('Moderator');
    await as('owner')
      .post(`/api/roles/community/${communityId}/assign`, {
        userId: id.mod,
        roleId: moderatorRoleId,
      })
      .expect(204);
    await as('owner')
      .post(`/api/roles/community/${communityId}/assign`, {
        userId: id.manager,
        roleId: roleId('Community Admin'),
      })
      .expect(204);

    generalId = await createChannel('cp-general', false);
    announcementsId = await createChannel('cp-announcements', false);
    secretId = await createChannel('cp-secret', true); // only owner is in it
    await post('owner', secretId, 'classified zebra plans').expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('migration backfill', () => {
    it('grants the new actions to roles that had the equivalent before', async () => {
      const sql = readFileSync(
        join(
          __dirname,
          '../prisma/migrations/20261005010540_channel_permission_overwrites/migration.sql',
        ),
        'utf8',
      );
      const updates = sql
        .split(';')
        .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
        .filter((s) => s.startsWith('UPDATE "Role"'));
      expect(updates).toHaveLength(6);

      const legacy = await db.role.create({
        data: {
          name: 'Legacy',
          communityId,
          actions: [
            RbacActions.CREATE_MESSAGE,
            RbacActions.JOIN_CHANNEL,
            RbacActions.UPDATE_CHANNEL,
          ],
        },
      });
      const readOnly = await db.role.create({
        data: {
          name: 'Lurker',
          communityId,
          actions: [RbacActions.READ_MESSAGE],
        },
      });
      for (const statement of updates) await db.$executeRawUnsafe(statement);
      // Idempotent: a second run adds nothing twice
      for (const statement of updates) await db.$executeRawUnsafe(statement);

      const after = await db.role.findUniqueOrThrow({
        where: { id: legacy.id },
      });
      expect([...after.actions].sort()).toEqual(
        [
          RbacActions.CREATE_MESSAGE,
          RbacActions.JOIN_CHANNEL,
          RbacActions.UPDATE_CHANNEL,
          RbacActions.ATTACH_FILES,
          RbacActions.SPEAK,
          RbacActions.VIDEO,
          RbacActions.SCREEN_SHARE,
          RbacActions.MANAGE_CHANNEL_PERMISSIONS,
          RbacActions.MANAGE_WEBHOOKS,
        ].sort(),
      );
      const untouched = await db.role.findUniqueOrThrow({
        where: { id: readOnly.id },
      });
      expect(untouched.actions).toEqual([RbacActions.READ_MESSAGE]);
      await db.role.deleteMany({
        where: { id: { in: [legacy.id, readOnly.id] } },
      });
    });

    it('new communities get the same defaults', async () => {
      const member = await db.role.findFirstOrThrow({
        where: { communityId, name: 'Member' },
      });
      expect(member.actions).toEqual(
        expect.arrayContaining([RbacActions.ATTACH_FILES, RbacActions.SPEAK]),
      );
      expect(member.actions).not.toContain(
        RbacActions.MANAGE_CHANNEL_PERMISSIONS,
      );
    });
  });

  describe('a hidden channel never reaches a user who cannot view it', () => {
    const ids = (body: unknown) => (body as { id: string }[]).map((c) => c.id);

    it('channel list', async () => {
      const res = await as('member')
        .get(`/api/channels/community/${communityId}`)
        .expect(200);
      expect(ids(res.body)).toEqual(
        expect.arrayContaining([generalId, announcementsId]),
      );
      expect(ids(res.body)).not.toContain(secretId);
      expect(JSON.stringify(res.body)).not.toContain('cp-secret');
      // ...while a member of it sees it
      const owner = await as('owner')
        .get(`/api/channels/community/${communityId}`)
        .expect(200);
      expect(ids(owner.body)).toContain(secretId);
    });

    it('#channel mention list', async () => {
      const res = await as('member')
        .get(`/api/channels/community/${communityId}/mentionable`)
        .expect(200);
      expect(ids(res.body)).not.toContain(secretId);
    });

    it('community search', async () => {
      const res = await as('member')
        .get(`/api/messages/search/community/${communityId}?q=zebra`)
        .expect(200);
      expect(res.body).toEqual([]);
      const owner = await as('owner')
        .get(`/api/messages/search/community/${communityId}?q=zebra`)
        .expect(200);
      expect((owner.body as unknown[]).length).toBe(1);
    });

    it('unread counts', async () => {
      const res = await as('member')
        .get('/api/read-receipts/unread-counts')
        .expect(200);
      expect(JSON.stringify(res.body)).not.toContain(secretId);
    });

    it('effective-permissions listing', async () => {
      const res = await as('member')
        .get(`/api/channels/community/${communityId}/permissions/me`)
        .expect(200);
      const channels = (res.body as { channels: { channelId: string }[] })
        .channels;
      expect(channels.map((c) => c.channelId)).not.toContain(secretId);
      expect(channels.map((c) => c.channelId)).toContain(generalId);
    });

    it('direct reads are refused', async () => {
      await as('member').get(`/api/channels/${secretId}`).expect(403);
      await as('member').get(`/api/messages/channel/${secretId}`).expect(403);
      await as('member')
        .get(`/api/channels/${secretId}/permissions/me`)
        .expect(403);
    });

    it('outsiders get nothing at all', async () => {
      await as('outsider')
        .get(`/api/channels/community/${communityId}`)
        .expect(403);
    });

    it('managers see it in the management listing only', async () => {
      const res = await as('manager')
        .get(`/api/channels/community/${communityId}/permissions`)
        .expect(200);
      expect(
        (res.body as { channelId: string }[]).map((c) => c.channelId),
      ).toContain(secretId);
      await as('member')
        .get(`/api/channels/community/${communityId}/permissions`)
        .expect(403);
      const list = await as('manager')
        .get(`/api/channels/community/${communityId}`)
        .expect(200);
      expect(ids(list.body)).not.toContain(secretId);
    });
  });

  describe('announcement channel (@everyone deny post + Moderator allow)', () => {
    beforeAll(async () => {
      await as('manager')
        .put(`/api/channels/${announcementsId}/overwrites`, {
          preset: 'ANNOUNCEMENT',
          overwrites: [
            {
              targetType: 'EVERYONE',
              allow: [],
              deny: ['CREATE_MESSAGE', 'ATTACH_FILES'],
            },
            {
              targetType: 'ROLE',
              roleId: moderatorRoleId,
              allow: ['CREATE_MESSAGE', 'ATTACH_FILES'],
              deny: [],
            },
          ],
        })
        .expect(200);
    });

    it('stores and returns the overwrites and preset', async () => {
      const res = await as('manager')
        .get(`/api/channels/${announcementsId}/overwrites`)
        .expect(200);
      expect(res.body).toMatchObject({
        channelId: announcementsId,
        preset: 'ANNOUNCEMENT',
        overwrites: [
          {
            targetType: 'EVERYONE',
            roleId: null,
            deny: ['CREATE_MESSAGE', 'ATTACH_FILES'],
          },
          {
            targetType: 'ROLE',
            roleId: moderatorRoleId,
            allow: ['CREATE_MESSAGE', 'ATTACH_FILES'],
          },
        ],
      });
    });

    it('members cannot post; moderators and the owner can', async () => {
      await post('member', announcementsId, 'hi').expect(403);
      await post('mod', announcementsId, 'news').expect(201);
      await post('owner', announcementsId, 'more news').expect(201);
    });

    it('members can still read and react', async () => {
      await as('member')
        .get(`/api/messages/channel/${announcementsId}`)
        .expect(200);
      const msg = await db.message.findFirstOrThrow({
        where: { channelId: announcementsId },
      });
      await as('member')
        .post('/api/messages/reactions', { messageId: msg.id, emoji: '👍' })
        .expect(201);
    });

    it('reports the capabilities the composer needs', async () => {
      const member = await as('member')
        .get(`/api/channels/${announcementsId}/permissions/me`)
        .expect(200);
      expect(member.body).toMatchObject({
        channelId: announcementsId,
        view: true,
        post: false,
        attach: false,
        react: true,
        threadReply: false,
        managePermissions: false,
        timedOutUntil: null,
      });
      const mod = await as('mod')
        .get(`/api/channels/${announcementsId}/permissions/me`)
        .expect(200);
      expect(mod.body).toMatchObject({ post: true, attach: true });
    });

    it("a member can't edit overwrites", async () => {
      await as('member')
        .get(`/api/channels/${announcementsId}/overwrites`)
        .expect(403);
      await as('member')
        .put(`/api/channels/${announcementsId}/overwrites`, {
          preset: 'NORMAL',
          overwrites: [],
        })
        .expect(403);
    });

    it('rejects invalid overwrites', async () => {
      const bad = (overwrites: object[]) =>
        as('manager')
          .put(`/api/channels/${announcementsId}/overwrites`, {
            preset: 'CUSTOM',
            overwrites,
          })
          .expect(400);
      await bad([
        { targetType: 'MEMBER', allow: ['CREATE_MESSAGE'], deny: [] },
      ]);
      await bad([
        { targetType: 'EVERYONE', allow: [], deny: ['READ_CHANNEL'] },
      ]);
      await bad([
        {
          targetType: 'EVERYONE',
          allow: [],
          deny: ['MANAGE_CHANNEL_PERMISSIONS'],
        },
      ]);
      await bad([
        { targetType: 'EVERYONE', allow: [], deny: ['NOT_AN_ACTION'] },
      ]);
    });
  });

  describe('attach files', () => {
    beforeAll(async () => {
      await as('manager')
        .put(`/api/channels/${generalId}/overwrites`, {
          preset: 'NORMAL',
          overwrites: [
            { targetType: 'EVERYONE', allow: [], deny: ['ATTACH_FILES'] },
          ],
        })
        .expect(200);
    });

    it('blocks sending with attachments but not plain messages', async () => {
      await post('member', generalId, 'text only').expect(201);
      await post('member', generalId, 'with file', {
        pendingAttachments: 1,
      }).expect(403);
    });

    it('blocks attaching a file to an existing message', async () => {
      const res = await post('member', generalId, 'later file').expect(201);
      const messageId = (res.body as { id: string }).id;
      const file = await db.file.create({
        data: {
          filename: 'x.png',
          mimeType: 'image/png',
          fileType: 'IMAGE',
          size: 1,
          checksum: 'cp',
          uploadedById: id.member,
          resourceType: 'MESSAGE_ATTACHMENT',
          fileMessageId: messageId,
          storagePath: 'e2e/x.png',
        },
      });
      await as('member')
        .post(`/api/messages/${messageId}/attachments`, { fileId: file.id })
        .expect(403);
    });

    it('blocks attaching in thread replies', async () => {
      const parent = await post('owner', generalId, 'thread root').expect(201);
      const parentId = (parent.body as { id: string }).id;
      await as('member')
        .post(`/api/threads/${parentId}/replies`, {
          parentMessageId: parentId,
          spans: text('reply'),
          pendingAttachments: 1,
        })
        .expect(403);
    });

    it('the owner bypasses it', async () => {
      await post('owner', generalId, 'owner file', {
        pendingAttachments: 1,
      }).expect(201);
    });
  });

  describe('timeouts block posting, reacting, threads and voice publishing', () => {
    let messageId: string;

    beforeAll(async () => {
      messageId = (
        (await post('owner', generalId, 'react to me').expect(201)).body as {
          id: string;
        }
      ).id;
      await as('owner')
        .post(`/api/moderation/timeout/${communityId}/${id.member}`, {
          durationSeconds: 600,
        })
        .expect((res) => expect([200, 201]).toContain(res.status));
    });

    afterAll(async () => {
      await db.communityTimeout.deleteMany({ where: { userId: id.member } });
    });

    it('rejects posts, reactions and thread replies', async () => {
      await post('member', generalId, 'spam').expect(403);
      await as('member')
        .post('/api/messages/reactions', { messageId, emoji: '😀' })
        .expect(403);
      await as('member')
        .post(`/api/threads/${messageId}/replies`, {
          parentMessageId: messageId,
          spans: text('spam reply'),
        })
        .expect(403);
    });

    it('still lets them read, connect and listen', async () => {
      await as('member').get(`/api/messages/channel/${generalId}`).expect(200);
      const res = await as('member')
        .get(`/api/channels/${generalId}/permissions/me`)
        .expect(200);
      expect(res.body).toMatchObject({
        view: true,
        post: false,
        react: false,
        threadReply: false,
        connect: true,
        speak: false,
        video: false,
        share: false,
      });
      expect(
        (res.body as { timedOutUntil: string | null }).timedOutUntil,
      ).not.toBeNull();
    });
  });

  describe('lockout safeguard', () => {
    it('a manager can read and fix overwrites of a private channel they are not in', async () => {
      await as('manager')
        .get(`/api/channels/${secretId}/overwrites`)
        .expect(200);
      await as('manager')
        .put(`/api/channels/${secretId}/overwrites`, {
          preset: 'READ_ONLY',
          overwrites: [
            { targetType: 'EVERYONE', allow: [], deny: ['CREATE_MESSAGE'] },
          ],
        })
        .expect(200);
      await as('manager')
        .patch(`/api/channels/${secretId}`, { name: 'cp-secret-2' })
        .expect(200);
      // ...without gaining access to its content
      await as('manager').get(`/api/messages/channel/${secretId}`).expect(403);
    });

    it('denying every overwritable action never locks the manager out', async () => {
      const everything = [
        'READ_MESSAGE',
        'CREATE_MESSAGE',
        'ATTACH_FILES',
        'CREATE_REACTION',
        'PIN_MESSAGE',
        'UNPIN_MESSAGE',
        'DELETE_ANY_MESSAGE',
        'JOIN_CHANNEL',
        'SPEAK',
        'VIDEO',
        'SCREEN_SHARE',
        'MUTE_PARTICIPANT',
        'CAPTURE_REPLAY',
        'READ_SOUNDBOARD_SOUND',
      ];
      await as('manager')
        .put(`/api/channels/${generalId}/overwrites`, {
          preset: 'CUSTOM',
          overwrites: [{ targetType: 'EVERYONE', allow: [], deny: everything }],
        })
        .expect(200);
      await as('manager')
        .get(`/api/channels/${generalId}/overwrites`)
        .expect(200);
      const caps = await as('manager')
        .get(`/api/channels/community/${communityId}/permissions/me`)
        .expect(200);
      const general = (
        caps.body as {
          channels: {
            channelId: string;
            managePermissions: boolean;
            post: boolean;
          }[];
        }
      ).channels.find((c) => c.channelId === generalId);
      expect(general).toMatchObject({ managePermissions: true, post: false });
      await as('manager')
        .put(`/api/channels/${generalId}/overwrites`, {
          preset: 'NORMAL',
          overwrites: [],
        })
        .expect(200);
      await post('member', generalId, 'back to normal').expect(201);
    });
  });

  describe('webhooks', () => {
    it('MANAGE_WEBHOOKS gates webhook management; webhooks post in read-only channels', async () => {
      await as('member')
        .post(`/api/channels/${announcementsId}/webhooks`, { name: 'nope' })
        .expect(403);
      const created = await as('manager')
        .post(`/api/channels/${announcementsId}/webhooks`, { name: 'feed' })
        .expect(201);
      const url = (created.body as { url: string }).url;
      const [, hookId, hookToken] = /webhooks\/([^/]+)\/([^/?]+)/.exec(url)!;
      await http()
        .post(`/api/webhooks/${hookId}/${hookToken}`)
        .send({ content: 'release notes' })
        .expect((res) => expect(res.status).toBeLessThan(300));
    });
  });
});
