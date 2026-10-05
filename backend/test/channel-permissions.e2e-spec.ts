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
// LiveKit tokens are plain JWT signing: no LiveKit server needed (as in
// livekit-authz.e2e-spec.ts)
process.env.LIVEKIT_API_KEY ??= 'devkey';
process.env.LIVEKIT_API_SECRET ??=
  'e2e-secret-that-is-at-least-32-characters-long';
process.env.LIVEKIT_URL ??= 'ws://localhost:7880';

/** The `video` grant of a LiveKit access token (JWT payload, unverified). */
function videoGrant(token: string): Record<string, unknown> {
  const payload = JSON.parse(
    Buffer.from(token.split('.')[1], 'base64url').toString('utf8'),
  ) as { video: Record<string, unknown> };
  return payload.video;
}

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
  let voiceId: string;
  let secretMessageId: string;
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

  async function createChannel(
    name: string,
    isPrivate: boolean,
    type: 'TEXT' | 'VOICE' = 'TEXT',
  ) {
    const res = await as('owner')
      .post('/api/channels', { name, communityId, type, isPrivate })
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
    voiceId = await createChannel('cp-voice', false, 'VOICE');
    secretMessageId = (
      (await post('owner', secretId, 'classified zebra plans').expect(201))
        .body as { id: string }
    ).id;
    // The owner has read it (so it has a readers list worth stealing)
    await as('owner')
      .post('/api/read-receipts/mark-read', {
        channelId: secretId,
        lastReadMessageId: secretMessageId,
      })
      .expect(200);
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

    it('their LiveKit token is subscribe-only (review: voice was not enforced)', async () => {
      const res = await as('member')
        .post('/api/livekit/token', { identity: 'x', roomId: voiceId })
        .expect(201);
      const grant = videoGrant((res.body as { token: string }).token);
      expect(grant).toMatchObject({
        roomJoin: true,
        canSubscribe: true,
        canPublish: false,
      });
      expect(grant.canPublishSources).toBeUndefined();
    });

    it('others in the community still publish everything', async () => {
      const res = await as('mod')
        .post('/api/livekit/token', { identity: 'x', roomId: voiceId })
        .expect(201);
      const grant = videoGrant((res.body as { token: string }).token);
      expect(grant).toMatchObject({ canPublish: true });
      expect(grant.canPublishSources).toBeUndefined();
    });
  });

  describe('voice permissions in LiveKit tokens', () => {
    afterAll(async () => {
      await as('manager')
        .put(`/api/channels/${voiceId}/overwrites`, {
          preset: 'NORMAL',
          overwrites: [],
        })
        .expect(200);
    });

    it('a VIDEO + SCREEN_SHARE deny leaves only the microphone', async () => {
      await as('manager')
        .put(`/api/channels/${voiceId}/overwrites`, {
          preset: 'CUSTOM',
          overwrites: [
            {
              targetType: 'EVERYONE',
              allow: [],
              deny: ['VIDEO', 'SCREEN_SHARE'],
            },
          ],
        })
        .expect(200);
      const res = await as('member')
        .post('/api/livekit/token', { identity: 'x', roomId: voiceId })
        .expect(201);
      expect(videoGrant((res.body as { token: string }).token)).toMatchObject({
        canPublish: true,
        canPublishSources: ['microphone'],
      });
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
      // Review fix: only overwrites are exempt; editing the channel itself
      // needs view, as on main
      await as('manager')
        .patch(`/api/channels/${secretId}`, { name: 'cp-secret-2' })
        .expect(403);
      // ...and no access to its content
      await as('manager').get(`/api/messages/channel/${secretId}`).expect(403);
    });

    it('denying every overwritable action never locks the manager out', async () => {
      const everything = [
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

  describe('security review regressions', () => {
    it('read receipts: a non-viewer gets nothing about a hidden channel (was 200)', async () => {
      for (const who of ['member', 'outsider'] as const) {
        await as(who)
          .get(`/api/read-receipts/unread-count?channelId=${secretId}`)
          .expect(404);
        await as(who)
          .get(`/api/read-receipts/last-read?channelId=${secretId}`)
          .expect(404);
        await as(who)
          .get(
            `/api/read-receipts/message/${secretMessageId}/readers?channelId=${secretId}`,
          )
          .expect(404);
        await as(who)
          .post('/api/read-receipts/mark-read', {
            channelId: secretId,
            lastReadMessageId: secretMessageId,
          })
          .expect(404);
      }
      // The owner, who can see it, still can
      await as('owner')
        .get(`/api/read-receipts/unread-count?channelId=${secretId}`)
        .expect(200);
    });

    it('read receipts: hidden and missing channels answer identically', async () => {
      const missing = '00000000-0000-4000-8000-000000000000';
      const hidden = await as('member')
        .get(`/api/read-receipts/unread-count?channelId=${secretId}`)
        .expect(404);
      const gone = await as('member')
        .get(`/api/read-receipts/unread-count?channelId=${missing}`)
        .expect(404);
      expect(hidden.body).toEqual(gone.body);
    });

    it('read receipts: DM readers need DM membership', async () => {
      const dm = await db.directMessageGroup.create({
        data: {
          isGroup: false,
          members: { create: [{ userId: id.owner }, { userId: id.mod }] },
        },
      });
      const msg = await db.message.create({
        data: {
          directMessageGroupId: dm.id,
          authorId: id.owner,
          sentAt: new Date(),
        },
      });
      await as('member')
        .get(
          `/api/read-receipts/message/${msg.id}/readers?directMessageGroupId=${dm.id}`,
        )
        .expect(403);
      await as('member')
        .get(`/api/read-receipts/unread-count?directMessageGroupId=${dm.id}`)
        .expect(403);
    });

    it('unread counts drop receipts of channels the user can no longer see', async () => {
      await db.readReceipt.create({
        data: {
          userId: id.member,
          channelId: secretId,
          lastReadMessageId: secretMessageId,
          lastReadAt: new Date(),
        },
      });
      const res = await as('member')
        .get('/api/read-receipts/unread-counts')
        .expect(200);
      expect(JSON.stringify(res.body)).not.toContain(secretId);
    });

    it('READ_MESSAGE overwrites are rejected until phase 3', async () => {
      await as('manager')
        .put(`/api/channels/${generalId}/overwrites`, {
          preset: 'CUSTOM',
          overwrites: [
            { targetType: 'EVERYONE', allow: [], deny: ['READ_MESSAGE'] },
          ],
        })
        .expect(400);
    });

    it("a Moderator can't un-private a private channel they aren't in (was 200)", async () => {
      await as('mod')
        .patch(`/api/channels/${secretId}`, { isPrivate: false })
        .expect(403);
      const channel = await db.channel.findUniqueOrThrow({
        where: { id: secretId },
      });
      expect(channel.isPrivate).toBe(true);
    });

    it('flipping privacy needs MANAGE_CHANNEL_PERMISSIONS even with UPDATE_CHANNEL and view', async () => {
      const editor = await db.role.create({
        data: {
          name: 'Channel Editor',
          communityId,
          position: 50,
          actions: [RbacActions.READ_CHANNEL, RbacActions.UPDATE_CHANNEL],
        },
      });
      // Through the API, so the permission cache is invalidated
      await as('owner')
        .post(`/api/roles/community/${communityId}/assign`, {
          userId: id.member,
          roleId: editor.id,
        })
        .expect(204);
      const denied = await as('member')
        .patch(`/api/channels/${generalId}`, { isPrivate: true })
        .expect(403);
      expect((denied.body as { message: string }).message).toContain(
        'manage channel permissions',
      );
      await as('member')
        .patch(`/api/channels/${generalId}`, { name: 'cp-general' })
        .expect(200);
      await http()
        .delete(
          `/api/roles/community/${communityId}/users/${id.member}/roles/${editor.id}`,
        )
        .set('Authorization', `Bearer ${token.owner}`)
        .expect(204);
      await http()
        .delete(`/api/roles/community/${communityId}/${editor.id}`)
        .set('Authorization', `Bearer ${token.owner}`)
        .expect(204);
    });

    it("hierarchy: a Moderator can't write an overwrite against Community Admin (was 200)", async () => {
      const adminRole = await db.role.findFirstOrThrow({
        where: { communityId, name: 'Community Admin' },
      });
      const res = await as('mod')
        .put(`/api/channels/${generalId}/overwrites`, {
          preset: 'CUSTOM',
          overwrites: [
            {
              targetType: 'ROLE',
              roleId: adminRole.id,
              allow: [],
              deny: ['CREATE_MESSAGE'],
            },
          ],
        })
        .expect(403);
      expect((res.body as { message: string }).message).toContain(
        'roles below your highest role',
      );
      await post('manager', generalId, 'admins can still post').expect(201);
    });

    it("anti-escalation on the diff: can't delete a rule for actions you don't hold", async () => {
      // Owner stores EVERYONE deny MUTE_PARTICIPANT; a role without that
      // action submits an empty set to delete it.
      await as('owner')
        .put(`/api/channels/${generalId}/overwrites`, {
          preset: 'CUSTOM',
          overwrites: [
            { targetType: 'EVERYONE', allow: [], deny: ['MUTE_PARTICIPANT'] },
          ],
        })
        .expect(200);
      const limited = await db.role.create({
        data: {
          name: 'Limited Manager',
          communityId,
          position: 40,
          actions: [
            RbacActions.READ_CHANNEL,
            RbacActions.MANAGE_CHANNEL_PERMISSIONS,
          ],
        },
      });
      // Through the API, so the permission cache is invalidated
      await as('owner')
        .post(`/api/roles/community/${communityId}/assign`, {
          userId: id.member,
          roleId: limited.id,
        })
        .expect(204);
      const denied = await as('member')
        .put(`/api/channels/${generalId}/overwrites`, {
          preset: 'NORMAL',
          overwrites: [],
        })
        .expect(403);
      expect((denied.body as { message: string }).message).toBe(
        "You can't change permissions you don't have: MUTE_PARTICIPANT",
      );
      await http()
        .delete(
          `/api/roles/community/${communityId}/users/${id.member}/roles/${limited.id}`,
        )
        .set('Authorization', `Bearer ${token.owner}`)
        .expect(204);
      await http()
        .delete(`/api/roles/community/${communityId}/${limited.id}`)
        .set('Authorization', `Bearer ${token.owner}`)
        .expect(204);
      await as('owner')
        .put(`/api/channels/${generalId}/overwrites`, {
          preset: 'NORMAL',
          overwrites: [],
        })
        .expect(200);
    });

    it('GET /roles/my/channel/:id answers a hidden channel exactly like a missing one', async () => {
      const missing = '00000000-0000-4000-8000-000000000000';
      const hidden = await as('member')
        .get(`/api/roles/my/channel/${secretId}`)
        .expect(200);
      const gone = await as('member')
        .get(`/api/roles/my/channel/${missing}`)
        .expect(200);
      expect((hidden.body as { roles: unknown[] }).roles).toEqual([]);
      expect({ ...hidden.body, resourceId: null }).toEqual({
        ...gone.body,
        resourceId: null,
      });
    });

    it('thread subscriptions are dropped when a channel goes private', async () => {
      const root = await post('owner', generalId, 'thread root').expect(201);
      const rootId = (root.body as { id: string }).id;
      await as('member').post(`/api/threads/${rootId}/subscribe`).expect(204);
      expect(
        await db.threadSubscriber.count({
          where: { userId: id.member, parentMessageId: rootId },
        }),
      ).toBe(1);

      await as('owner')
        .patch(`/api/channels/${generalId}`, { isPrivate: true })
        .expect(200);
      expect(
        await db.threadSubscriber.count({
          where: { userId: id.member, parentMessageId: rootId },
        }),
      ).toBe(0);
      await as('owner')
        .patch(`/api/channels/${generalId}`, { isPrivate: false })
        .expect(200);
    });
  });

  describe('an @everyone deny cannot lock out higher roles (review probe)', () => {
    afterAll(async () => {
      await as('owner')
        .put(`/api/channels/${generalId}/overwrites`, {
          preset: 'NORMAL',
          overwrites: [],
        })
        .expect(200);
    });

    it('a Moderator denying posting for everyone is rejected (was 200, and the admin got 403)', async () => {
      const res = await as('mod')
        .put(`/api/channels/${generalId}/overwrites`, {
          preset: 'READ_ONLY',
          overwrites: [
            { targetType: 'EVERYONE', allow: [], deny: ['CREATE_MESSAGE'] },
          ],
        })
        .expect(403);
      expect((res.body as { message: string }).message).toBe(
        'This would remove CREATE_MESSAGE from roles above yours; add allows for them or ask an admin',
      );
      await post('manager', generalId, 'admin still posts').expect(201);
    });

    it('works when the Moderator keeps an allow for Community Admin', async () => {
      const adminRole = await db.role.findFirstOrThrow({
        where: { communityId, name: 'Community Admin' },
      });
      await as('mod')
        .put(`/api/channels/${generalId}/overwrites`, {
          preset: 'READ_ONLY',
          overwrites: [
            { targetType: 'EVERYONE', allow: [], deny: ['CREATE_MESSAGE'] },
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
        .expect(200);
      await post('manager', generalId, 'admin still posts').expect(201);
      await post('mod', generalId, 'mod still posts').expect(201);
      await post('member', generalId, 'member cannot').expect(403);
    });
  });
});
