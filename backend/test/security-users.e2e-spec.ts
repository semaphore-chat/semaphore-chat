import * as request from 'supertest';
import { createHash, randomUUID } from 'crypto';
import { ErrorCode } from '@semaphore-chat/shared';
import { promises as dnsPromises } from 'dns';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import {
  AccessToken,
  EgressClient,
  RoomServiceClient,
  TrackSource,
  TrackType,
} from 'livekit-server-sdk';
import {
  createE2eApp,
  resetDatabase,
  seedInstanceInvite,
  registerUser,
  loginUser,
  E2eApp,
  E2E_INVITE_CODE,
} from './helpers/e2e-app';
import { DatabaseService } from '@/database/database.service';
import { LivekitService } from '@/livekit/livekit.service';
import { LivekitException } from '@/livekit/exceptions/livekit.exception';
import { FfmpegService } from '@/livekit/ffmpeg.service';
import { ReplaySegmentsService } from '@/livekit/replay-segments.service';
import { EGRESS_CLIENT } from '@/livekit/providers/egress-client.provider';
import { ROOM_SERVICE_CLIENT } from '@/livekit/providers/room-service.provider';
import { ThumbnailService } from '@/file/thumbnail.service';
import { MessagesService } from '@/messages/messages.service';
import { NotificationsService } from '@/notifications/notifications.service';
import { VoicePresenceService } from '@/voice-presence/voice-presence.service';

/**
 * Authorization fixes for the voice, DM, user, notification and push modules:
 * each block sends the request a finding describes through the real guards and
 * services (Postgres, Redis). LiveKit isn't running in e2e, so its client calls
 * are stubbed; webhooks are signed for real.
 */

process.env.LIVEKIT_API_KEY ??= 'devkey';
process.env.LIVEKIT_API_SECRET ??=
  'e2e-secret-that-is-at-least-32-characters-long';
process.env.LIVEKIT_URL ??= 'ws://localhost:7880';
process.env.REPLAY_CLIPS_PATH = path.join(tmpdir(), 'sec-users-clips');

const PASSWORD = 'Password123!';

interface TestUser {
  id: string;
  username: string;
  token: string;
  refreshCookie: string;
}

/** Bounded poll for a condition reached by a fire-and-forget event handler. */
async function until(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function decodeJwt(token: string): {
  name?: string;
  video?: { canPublish?: boolean; canPublishSources?: unknown[] };
} {
  return JSON.parse(
    Buffer.from(token.split('.')[1], 'base64url').toString('utf8'),
  ) as ReturnType<typeof decodeJwt>;
}

describe('Authorization of voice, DMs, users and push (e2e)', () => {
  let app: E2eApp;
  let db: DatabaseService;
  let livekit: LivekitService;
  let presence: VoicePresenceService;
  let owner: TestUser;
  let member: TestUser;
  let communityId: string;
  let voiceChannelId: string;
  let textChannelId: string;
  let removeParticipant: jest.SpyInstance;
  let updatePublishPermissions: jest.SpyInstance;
  let userSeq = 0;

  const http = () => request(app.getHttpServer());
  const bearer = (user: TestUser) => `Bearer ${user.token}`;

  async function newUser(name = 'user'): Promise<TestUser> {
    userSeq += 1;
    const username = `sec-${name}-${userSeq}`;
    const registered = await registerUser(app, {
      username,
      password: PASSWORD,
      email: `${username}@test.local`,
    });
    const login = await loginUser(app, username, PASSWORD);
    return {
      id: registered.id,
      username,
      token: login.accessToken,
      refreshCookie: login.refreshCookie,
    };
  }

  async function grantInstanceActions(user: TestUser, actions: string[]) {
    const role = await db.role.create({
      data: { name: `sec-role-${randomUUID()}`, actions: actions as never },
    });
    await db.userRoles.create({
      data: { userId: user.id, roleId: role.id, isInstanceRole: true },
    });
  }

  async function addToCommunity(user: TestUser, id = communityId) {
    await http()
      .post('/api/membership')
      .set('Authorization', bearer(owner))
      .send({ userId: user.id, communityId: id })
      .expect(201);
  }

  async function createDm(
    creator: TestUser,
    others: TestUser[],
    isGroup?: boolean,
  ) {
    const res = await http()
      .post('/api/direct-messages')
      .set('Authorization', bearer(creator))
      .send({ userIds: others.map((u) => u.id), isGroup })
      .expect(201);
    return (res.body as { id: string }).id;
  }

  async function seedMessage(
    authorId: string,
    target: { channelId?: string; directMessageGroupId?: string },
    text = 'hello',
    spanExtras: Record<string, unknown> = {},
  ) {
    return db.message.create({
      data: {
        authorId,
        ...target,
        spans: {
          create: [{ position: 0, type: 'PLAINTEXT', text, ...spanExtras }],
        },
      },
      include: { spans: true },
    });
  }

  /** A LiveKit webhook, signed like LiveKit signs them. */
  async function signedWebhook(
    event: string,
    roomName: string,
    identity: string,
  ) {
    const body = JSON.stringify({
      event,
      room: { name: roomName, sid: 'RM_e2e' },
      participant: { identity, sid: `PA_${randomUUID()}`, name: 'whoever' },
      id: `EV_${randomUUID()}`,
    });
    const token = new AccessToken(
      process.env.LIVEKIT_API_KEY,
      process.env.LIVEKIT_API_SECRET,
    );
    token.sha256 = createHash('sha256').update(body).digest('base64');
    await http()
      .post('/api/livekit/webhook')
      .set('Content-Type', 'application/webhook+json')
      .set('Authorization', await token.toJwt())
      .send(body)
      .expect(201);
  }

  beforeAll(async () => {
    app = await createE2eApp();
    await resetDatabase(app);
    await seedInstanceInvite(app);
    db = app.get(DatabaseService);
    livekit = app.get(LivekitService);
    presence = app.get(VoicePresenceService);

    owner = await newUser('owner'); // first -> instance owner
    member = await newUser('member');

    const community = await http()
      .post('/api/community')
      .set('Authorization', bearer(owner))
      .send({ name: 'Security Users' })
      .expect(201);
    communityId = (community.body as { id: string }).id;
    await addToCommunity(member);

    const voice = await http()
      .post('/api/channels')
      .set('Authorization', bearer(owner))
      .send({ name: 'voice', communityId, type: 'VOICE', isPrivate: false })
      .expect(201);
    voiceChannelId = (voice.body as { id: string }).id;
    const text = await http()
      .post('/api/channels')
      .set('Authorization', bearer(owner))
      .send({ name: 'text', communityId, type: 'TEXT', isPrivate: false })
      .expect(201);
    textChannelId = (text.body as { id: string }).id;
  });

  beforeEach(() => {
    removeParticipant = jest
      .spyOn(livekit, 'removeParticipant')
      .mockResolvedValue(undefined);
    updatePublishPermissions = jest
      .spyOn(livekit, 'updatePublishPermissions')
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // Finding 1: the owner role
  // ---------------------------------------------------------------------------
  describe('instance owner role', () => {
    const setRole = (actor: TestUser, target: { id: string }, role: string) =>
      http()
        .patch(`/api/users/admin/${target.id}/role`)
        .set('Authorization', bearer(actor))
        .send({ role });

    it('a holder of UPDATE_USER cannot promote themselves to owner', async () => {
      const manager = await newUser('manager');
      await grantInstanceActions(manager, ['READ_USER', 'UPDATE_USER']);

      await setRole(manager, manager, 'OWNER').expect(403);

      const row = await db.user.findUniqueOrThrow({
        where: { id: manager.id },
      });
      expect(row.role).toBe('USER');
    });

    it('a holder of UPDATE_USER cannot demote an owner', async () => {
      const manager = await newUser('manager');
      await grantInstanceActions(manager, ['READ_USER', 'UPDATE_USER']);

      await setRole(manager, owner, 'USER').expect(403);

      const row = await db.user.findUniqueOrThrow({ where: { id: owner.id } });
      expect(row.role).toBe('OWNER');
    });

    it('an owner can grant and take the owner role', async () => {
      const second = await newUser('second');

      await setRole(owner, second, 'OWNER').expect(200);
      await setRole(owner, second, 'USER').expect(200);
    });

    it('the last owner cannot be demoted', async () => {
      await setRole(owner, owner, 'USER').expect(403);
    });

    it('two owners demoting each other leave one owner', async () => {
      const second = await newUser('second');
      await setRole(owner, second, 'OWNER').expect(200);

      await Promise.all([
        setRole(owner, second, 'USER').ok(() => true),
        setRole(second, owner, 'USER').ok(() => true),
      ]);

      const owners = await db.user.count({ where: { role: 'OWNER' } });
      expect(owners).toBeGreaterThanOrEqual(1);

      // Back to the one owner the rest of this suite expects
      await db.user.update({
        where: { id: owner.id },
        data: { role: 'OWNER' },
      });
      await db.user.update({
        where: { id: second.id },
        data: { role: 'USER' },
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Finding 2: replay recording
  // ---------------------------------------------------------------------------
  describe('replay recording', () => {
    const OWN_VIDEO = 'TR_own_video';
    const OWN_AUDIO = 'TR_own_audio';
    let startEgress: jest.Mock;

    const start = (user: TestUser, body: Record<string, unknown>) =>
      http()
        .post('/api/livekit/replay/start')
        .set('Authorization', bearer(user))
        .send(body);

    beforeEach(() => {
      const egressClient = app.get<EgressClient>(EGRESS_CLIENT);
      startEgress = jest.fn(() =>
        Promise.resolve({ egressId: `EG_${randomUUID()}` }),
      );
      jest
        .spyOn(egressClient, 'startTrackCompositeEgress')
        .mockImplementation(startEgress as never);
      jest.spyOn(egressClient, 'stopEgress').mockResolvedValue({} as never);
      jest
        .spyOn(
          app.get<RoomServiceClient>(ROOM_SERVICE_CLIENT),
          'getParticipant',
        )
        .mockResolvedValue({
          tracks: [
            { sid: OWN_VIDEO, type: TrackType.VIDEO, width: 0, height: 0 },
            { sid: OWN_AUDIO, type: TrackType.AUDIO },
          ],
        } as never);
    });

    it('records the authorized channel, whatever roomName says', async () => {
      const user = await newUser('rec');
      await addToCommunity(user);
      const otherRoom = randomUUID();

      await start(user, {
        channelId: voiceChannelId,
        roomName: otherRoom,
        videoTrackId: OWN_VIDEO,
        audioTrackId: OWN_AUDIO,
        participantIdentity: user.id,
      }).expect(201);

      expect(startEgress).toHaveBeenCalledTimes(1);
      expect((startEgress.mock.calls as unknown[][])[0][0]).toBe(
        voiceChannelId,
      );
    });

    it('keeps working for a client that still sends every field', async () => {
      const user = await newUser('rec');
      await addToCommunity(user);

      await start(user, {
        channelId: voiceChannelId,
        roomName: voiceChannelId,
        videoTrackId: OWN_VIDEO,
        participantIdentity: user.id,
      }).expect(201);
    });

    it("refuses someone else's track", async () => {
      const user = await newUser('rec');
      await addToCommunity(user);

      await start(user, {
        channelId: voiceChannelId,
        roomName: voiceChannelId,
        videoTrackId: 'TR_someone_elses',
      }).expect(403);

      expect(startEgress).not.toHaveBeenCalled();
    });

    it("refuses someone else's audio next to one's own video", async () => {
      const user = await newUser('rec');
      await addToCommunity(user);

      await start(user, {
        channelId: voiceChannelId,
        roomName: voiceChannelId,
        videoTrackId: OWN_VIDEO,
        audioTrackId: 'TR_someone_elses',
      }).expect(403);

      expect(startEgress).not.toHaveBeenCalled();
    });

    it('enforces a CAPTURE_REPLAY deny on the channel', async () => {
      const user = await newUser('rec');
      await addToCommunity(user);
      const denied = await http()
        .post('/api/channels')
        .set('Authorization', bearer(owner))
        .send({
          name: 'no-replay',
          communityId,
          type: 'VOICE',
          isPrivate: false,
        })
        .expect(201);
      const channelId = (denied.body as { id: string }).id;
      await db.channelPermissionOverwrite.create({
        data: {
          channelId,
          targetType: 'EVERYONE',
          deny: ['CAPTURE_REPLAY'],
        },
      });

      await start(user, {
        channelId,
        roomName: channelId,
        videoTrackId: OWN_VIDEO,
      }).expect(403);

      expect(startEgress).not.toHaveBeenCalled();
    });

    it('stops serving a recording once CAPTURE_REPLAY is denied', async () => {
      const user = await newUser('rec');
      await addToCommunity(user);
      const denied = await http()
        .post('/api/channels')
        .set('Authorization', bearer(owner))
        .send({
          name: 'deny-later',
          communityId,
          type: 'VOICE',
          isPrivate: false,
        })
        .expect(201);
      const channelId = (denied.body as { id: string }).id;
      await start(user, {
        channelId,
        roomName: channelId,
        videoTrackId: OWN_VIDEO,
      }).expect(201);
      await db.channelPermissionOverwrite.create({
        data: { channelId, targetType: 'EVERYONE', deny: ['CAPTURE_REPLAY'] },
      });

      await http()
        .get('/api/livekit/replay/stream?durationMinutes=1')
        .set('Authorization', bearer(user))
        .expect(403);
      await http()
        .post('/api/livekit/replay/capture')
        .set('Authorization', bearer(user))
        .send({ durationMinutes: 1, destination: 'library' })
        .expect(403);
    });
  });

  // ---------------------------------------------------------------------------
  // Finding 3 and voice eject: tokens outliving access
  // ---------------------------------------------------------------------------
  describe('LiveKit join check', () => {
    it('removes someone whose token outlived their access to a private channel', async () => {
      const user = await newUser('heldtoken');
      await addToCommunity(user);
      const res = await http()
        .post('/api/channels')
        .set('Authorization', bearer(owner))
        .send({ name: 'private', communityId, type: 'VOICE', isPrivate: true })
        .expect(201);
      const privateId = (res.body as { id: string }).id;

      await signedWebhook('participant_joined', privateId, user.id);

      expect(removeParticipant).toHaveBeenCalledWith(privateId, user.id);
      const present = await presence.getChannelPresence(privateId);
      expect(present.map((u) => u.id)).not.toContain(user.id);
    });

    it('removes a community outsider joining one of its voice channels', async () => {
      const outsider = await newUser('outsider');

      await signedWebhook('participant_joined', voiceChannelId, outsider.id);

      expect(removeParticipant).toHaveBeenCalledWith(
        voiceChannelId,
        outsider.id,
      );
    });

    it('removes a non-member joining a DM room, an instance owner too', async () => {
      const a = await newUser('dm');
      const b = await newUser('dm');
      const outsider = await newUser('outsider');
      const dmId = await createDm(a, [b]);

      await signedWebhook('participant_joined', dmId, outsider.id);
      await signedWebhook('participant_joined', dmId, owner.id);

      expect(removeParticipant).toHaveBeenCalledWith(dmId, outsider.id);
      expect(removeParticipant).toHaveBeenCalledWith(dmId, owner.id);
    });

    it('leaves people who belong there alone', async () => {
      const user = await newUser('legit');
      await addToCommunity(user);
      const b = await newUser('dm');
      const dmId = await createDm(user, [b]);

      await signedWebhook('participant_joined', voiceChannelId, user.id);
      await signedWebhook('participant_joined', dmId, b.id);
      // Minted with the API secret (scripts/livekit-test-participant.sh)
      await signedWebhook('participant_joined', voiceChannelId, 'test-bot');

      expect(removeParticipant).not.toHaveBeenCalled();
      const present = await presence.getChannelPresence(voiceChannelId);
      expect(present.map((u) => u.id)).toContain(user.id);
      await presence.leaveVoiceChannel(voiceChannelId, user.id);
    });

    it('takes someone who leaves a DM group out of its call', async () => {
      const a = await newUser('dm');
      const b = await newUser('dm');
      const c = await newUser('dm');
      const groupId = await createDm(a, [b, c], true);

      await http()
        .delete(`/api/direct-messages/${groupId}/members/me`)
        .set('Authorization', bearer(c))
        .expect(204);

      await until(() => removeParticipant.mock.calls.length > 0);
      expect(removeParticipant).toHaveBeenCalledWith(groupId, c.id);
    });

    it("does not show an instance owner who's in a DM call they aren't in", async () => {
      const a = await newUser('dm');
      const b = await newUser('dm');
      const dmId = await createDm(a, [b]);

      await http()
        .get(`/api/dm-groups/${dmId}/voice-presence`)
        .set('Authorization', bearer(owner))
        .expect(403);
      await http()
        .get(`/api/dm-groups/${dmId}/voice-presence`)
        .set('Authorization', bearer(a))
        .expect(200);
    });

    it('does not mint a DM call token for an instance owner outside the DM', async () => {
      const a = await newUser('dm');
      const b = await newUser('dm');
      const dmId = await createDm(a, [b]);

      await http()
        .post('/api/livekit/dm-token')
        .set('Authorization', bearer(owner))
        .send({ roomId: dmId, identity: owner.id })
        .expect(403);
      await http()
        .post('/api/livekit/dm-token')
        .set('Authorization', bearer(a))
        .send({ roomId: dmId, identity: a.id })
        .expect(201);
    });

    it('does not mint a channel token for an owner from a DM id or an unknown room', async () => {
      const a = await newUser('dm');
      const b = await newUser('dm');
      const dmId = await createDm(a, [b]);

      await http()
        .post('/api/livekit/token')
        .set('Authorization', bearer(owner))
        .send({ roomId: dmId, identity: owner.id })
        .expect(404);
      await http()
        .post('/api/livekit/token')
        .set('Authorization', bearer(owner))
        .send({ roomId: randomUUID(), identity: owner.id })
        .expect(404);
    });
  });

  // ---------------------------------------------------------------------------
  // Finding 4: 1:1 lookup
  // ---------------------------------------------------------------------------
  describe('1:1 DM lookup', () => {
    it("never hands over a group the caller isn't in", async () => {
      const alice = await newUser('alice');
      const bob = await newUser('bob');
      const carol = await newUser('carol');
      const dmId = await createDm(alice, [bob]);
      await seedMessage(
        alice.id,
        { directMessageGroupId: dmId },
        'for bob only',
      );
      await http()
        .delete(`/api/direct-messages/${dmId}/members/me`)
        .set('Authorization', bearer(bob))
        .expect(204);

      const res = await http()
        .post('/api/direct-messages')
        .set('Authorization', bearer(carol))
        .send({ userIds: [alice.id] })
        .expect(201);

      const body = res.body as {
        id: string;
        lastMessage?: unknown;
        members: { userId: string }[];
      };
      expect(body.id).not.toBe(dmId);
      expect(body.lastMessage ?? null).toBeNull();
      expect(body.members.map((m) => m.userId)).toContain(carol.id);
    });

    it('does not match a DM everyone left', async () => {
      const alice = await newUser('alice');
      const bob = await newUser('bob');
      const carol = await newUser('carol');
      const dave = await newUser('dave');
      const dmId = await createDm(alice, [bob]);
      await seedMessage(alice.id, { directMessageGroupId: dmId }, 'orphaned');
      for (const user of [alice, bob]) {
        await http()
          .delete(`/api/direct-messages/${dmId}/members/me`)
          .set('Authorization', bearer(user))
          .expect(204);
      }

      const res = await http()
        .post('/api/direct-messages')
        .set('Authorization', bearer(carol))
        .send({ userIds: [dave.id] })
        .expect(201);

      expect((res.body as { id: string }).id).not.toBe(dmId);
    });

    it('still finds the existing DM of exactly those two', async () => {
      const alice = await newUser('alice');
      const bob = await newUser('bob');
      const dmId = await createDm(alice, [bob]);

      expect(await createDm(bob, [alice])).toBe(dmId);
    });
  });

  // ---------------------------------------------------------------------------
  // Finding 5 and lead 1: push
  // ---------------------------------------------------------------------------
  describe('push subscriptions', () => {
    const keys = { p256dh: 'p256dh-key', auth: 'auth-key' };
    const endpoint = () =>
      `https://fcm.googleapis.com/fcm/send/${randomUUID()}`;

    const subscribe = (user: TestUser, url: string) =>
      http()
        .post('/api/push/subscribe')
        .set('Authorization', bearer(user))
        .send({ endpoint: url, keys });

    const count = (user: TestUser) =>
      db.pushSubscription.count({ where: { userId: user.id } });

    beforeEach(() => {
      jest
        .spyOn(dnsPromises, 'lookup')
        .mockImplementation(((host: string) =>
          Promise.resolve(
            host === 'fcm.googleapis.com'
              ? [{ address: '142.250.0.1', family: 4 }]
              : [{ address: '10.0.0.5', family: 4 }],
          )) as never);
    });

    it.each([
      ['plain http', 'http://fcm.googleapis.com/x'],
      ['loopback', 'https://127.0.0.1/x'],
      ['metadata service', 'https://169.254.169.254/latest'],
      ['IPv6 unique local', 'https://[fd00::1]/x'],
      ['another port', 'https://fcm.googleapis.com:8443/x'],
      ['credentials', 'https://user:pw@fcm.googleapis.com/x'],
      ['a name resolving inside', 'https://internal.example.com/x'],
      ['not a URL', 'not a url'],
    ])('refuses %s as an endpoint', async (_what, url) => {
      const user = await newUser('push');

      await subscribe(user, url).expect(400);

      expect(await count(user)).toBe(0);
    });

    it('accepts a push service endpoint', async () => {
      const user = await newUser('push');

      await subscribe(user, endpoint()).expect(201);

      expect(await count(user)).toBe(1);
    });

    it('a password reset ends subscriptions', async () => {
      const user = await newUser('push');
      await subscribe(user, endpoint()).expect(201);

      await http()
        .patch(`/api/users/admin/${user.id}/password`)
        .set('Authorization', bearer(owner))
        .send({ password: 'AnotherPassword123!' })
        .expect(200);

      expect(await count(user)).toBe(0);
    });

    it('a ban ends subscriptions', async () => {
      const user = await newUser('push');
      await subscribe(user, endpoint()).expect(201);

      await http()
        .patch(`/api/users/admin/${user.id}/ban`)
        .set('Authorization', bearer(owner))
        .send({ banned: true })
        .expect(200);

      expect(await count(user)).toBe(0);
    });

    it('signing out everywhere else ends subscriptions', async () => {
      const user = await newUser('push');
      await subscribe(user, endpoint()).expect(201);

      await http()
        .delete('/api/auth/sessions')
        .set('Authorization', bearer(user))
        .set('Cookie', user.refreshCookie)
        .expect(200);

      expect(await count(user)).toBe(0);
    });

    it('lists and revokes your own subscriptions, and only yours', async () => {
      const user = await newUser('push');
      const other = await newUser('push');
      const url = endpoint();
      await subscribe(user, url).expect(201);

      const list = await http()
        .get('/api/push/subscriptions')
        .set('Authorization', bearer(user))
        .expect(200);
      const rows = list.body as { id: string; endpointHost: string }[];
      expect(rows).toHaveLength(1);
      expect(rows[0].endpointHost).toBe('fcm.googleapis.com');
      expect(JSON.stringify(rows)).not.toContain(url);

      await http()
        .delete(`/api/push/subscriptions/${rows[0].id}`)
        .set('Authorization', bearer(other))
        .expect(404);
      expect(await count(user)).toBe(1);

      await http()
        .delete(`/api/push/subscriptions/${rows[0].id}`)
        .set('Authorization', bearer(user))
        .expect(200);
      expect(await count(user)).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Findings 7 and 8: who a DM notifies, and leaving
  // ---------------------------------------------------------------------------
  describe('DM notifications', () => {
    const notifiedFor = (user: TestUser, messageId: string) =>
      db.notification.count({ where: { userId: user.id, messageId } });

    it('a DM mention of an outsider notifies nobody outside the group', async () => {
      const a = await newUser('dm');
      const b = await newUser('dm');
      const outsider = await newUser('outsider');
      const dmId = await createDm(a, [b]);
      const message = await seedMessage(
        a.id,
        { directMessageGroupId: dmId },
        '@you',
        { type: 'USER_MENTION', userId: outsider.id },
      );

      await app
        .get(NotificationsService)
        .processMessageForNotifications(message);

      expect(await notifiedFor(outsider, message.id)).toBe(0);
      expect(await notifiedFor(b, message.id)).toBe(1);
    });

    it('an alias mention in a DM reaches only group members', async () => {
      const a = await newUser('dm');
      const b = await newUser('dm');
      const aliasMember = await newUser('alias');
      await addToCommunity(aliasMember);
      const alias = await db.aliasGroup.create({
        data: {
          name: `alias-${randomUUID().slice(0, 8)}`,
          communityId,
          members: { create: [{ userId: aliasMember.id }] },
        },
      });
      const dmId = await createDm(a, [b]);
      const message = await seedMessage(
        a.id,
        { directMessageGroupId: dmId },
        '@alias',
        { type: 'ALIAS_MENTION', aliasId: alias.id },
      );

      await app
        .get(NotificationsService)
        .processMessageForNotifications(message);

      expect(await notifiedFor(aliasMember, message.id)).toBe(0);
    });

    it('leaving a DM group ends thread notifications and unread counts', async () => {
      const a = await newUser('dm');
      const b = await newUser('dm');
      const leaver = await newUser('leaver');
      const groupId = await createDm(a, [b, leaver], true);
      const parent = await seedMessage(a.id, { directMessageGroupId: groupId });
      await http()
        .post(`/api/threads/${parent.id}/subscribe`)
        .set('Authorization', bearer(leaver))
        .expect(204);
      await http()
        .post('/api/read-receipts/mark-read')
        .set('Authorization', bearer(leaver))
        .send({ lastReadMessageId: parent.id, directMessageGroupId: groupId })
        .expect(200);

      await http()
        .delete(`/api/direct-messages/${groupId}/members/me`)
        .set('Authorization', bearer(leaver))
        .expect(204);

      expect(
        await db.threadSubscriber.count({ where: { userId: leaver.id } }),
      ).toBe(0);

      // A subscription from before this fix survives in old data
      await db.threadSubscriber.create({
        data: { userId: leaver.id, parentMessageId: parent.id },
      });
      const reply = await db.message.create({
        data: {
          authorId: a.id,
          directMessageGroupId: groupId,
          parentMessageId: parent.id,
          spans: {
            create: [{ position: 0, type: 'PLAINTEXT', text: 'after leaving' }],
          },
        },
      });
      await app
        .get(NotificationsService)
        .processThreadReplyNotifications(reply, parent.id, a.id);
      expect(await notifiedFor(leaver, reply.id)).toBe(0);

      await seedMessage(a.id, { directMessageGroupId: groupId }, 'newer');
      const counts = await http()
        .get('/api/read-receipts/unread-counts')
        .set('Authorization', bearer(leaver))
        .expect(200);
      expect(
        (counts.body as { directMessageGroupId?: string }[]).map(
          (c) => c.directMessageGroupId,
        ),
      ).not.toContain(groupId);
    });
  });

  // ---------------------------------------------------------------------------
  // Finding 9: blocks
  // ---------------------------------------------------------------------------
  describe('blocks', () => {
    async function blockedPair() {
      const blocker = await newUser('blocker');
      const blocked = await newUser('blocked');
      return { blocker, blocked };
    }

    const block = (blocker: TestUser, blocked: TestUser) =>
      http()
        .post(`/api/users/block/${blocked.id}`)
        .set('Authorization', bearer(blocker))
        .expect(201);

    const directMessage = (authorId: string, groupId: string) =>
      app.get(MessagesService).create({
        id: '',
        channelId: null,
        directMessageGroupId: groupId,
        authorId,
        sentAt: new Date(),
        editedAt: null,
        deletedAt: null,
        spans: [
          {
            type: 'PLAINTEXT',
            text: 'hi',
            userId: null,
            specialKind: null,
            communityId: null,
            aliasId: null,
            emojiId: null,
          },
        ],
        attachments: [],
        pendingAttachments: 0,
        searchText: null,
        pinned: false,
        pinnedAt: null,
        pinnedBy: null,
        deletedBy: null,
        deletedByReason: null,
        parentMessageId: null,
        replyCount: 0,
        lastReplyAt: null,
      } as never);

    it('stops opening a DM, in both directions', async () => {
      const { blocker, blocked } = await blockedPair();
      await block(blocker, blocked);

      for (const [from, to] of [
        [blocked, blocker],
        [blocker, blocked],
      ]) {
        await http()
          .post('/api/direct-messages')
          .set('Authorization', bearer(from))
          .send({ userIds: [to.id] })
          .expect(403);
      }
    });

    it('stops putting the blocker in a group', async () => {
      const { blocker, blocked } = await blockedPair();
      const third = await newUser('third');
      await block(blocker, blocked);
      const groupId = await createDm(blocked, [third], true);

      await http()
        .post('/api/direct-messages')
        .set('Authorization', bearer(blocked))
        .send({ userIds: [third.id, blocker.id], isGroup: true })
        .expect(403);
      await http()
        .post(`/api/direct-messages/${groupId}/members`)
        .set('Authorization', bearer(blocked))
        .send({ userIds: [blocker.id] })
        .expect(403);
    });

    it('stops new messages in their 1:1 DM, and leaves the history readable', async () => {
      const { blocker, blocked } = await blockedPair();
      const dmId = await createDm(blocked, [blocker]);
      const parent = await seedMessage(blocked.id, {
        directMessageGroupId: dmId,
      });
      await block(blocker, blocked);

      await expect(directMessage(blocked.id, dmId)).rejects.toMatchObject({
        status: 403,
      });
      await expect(directMessage(blocker.id, dmId)).rejects.toMatchObject({
        status: 403,
      });
      const reply = await http()
        .post(`/api/threads/${parent.id}/replies`)
        .set('Authorization', bearer(blocked))
        .send({ spans: [{ type: 'PLAINTEXT', text: 'still here' }] })
        .expect(403);
      // A specific code lets a client lock its composer (#641).
      expect(reply.body).toMatchObject({
        errorCode: ErrorCode.DM_BLOCKED,
        message: 'You cannot message this user',
      });
      await http()
        .post('/api/livekit/dm-token')
        .set('Authorization', bearer(blocked))
        .send({ roomId: dmId, identity: blocked.id })
        .expect(403);

      const history = await http()
        .get(`/api/direct-messages/${dmId}/messages`)
        .set('Authorization', bearer(blocker))
        .expect(200);
      expect(
        (history.body as { messages: { id: string }[] }).messages.map(
          (m) => m.id,
        ),
      ).toContain(parent.id);
    });

    it('a group DM goes on, without notifying the blocker', async () => {
      const { blocker, blocked } = await blockedPair();
      const third = await newUser('third');
      const groupId = await createDm(third, [blocker, blocked], true);
      await block(blocker, blocked);

      const sent = await directMessage(blocked.id, groupId);
      await app.get(NotificationsService).processMessageForNotifications({
        ...(await db.message.findUniqueOrThrow({ where: { id: sent.id } })),
        spans: [],
      });

      expect(
        await db.notification.count({
          where: { userId: blocker.id, messageId: sent.id },
        }),
      ).toBe(0);
      expect(
        await db.notification.count({
          where: { userId: third.id, messageId: sent.id },
        }),
      ).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Finding 10: user search
  // ---------------------------------------------------------------------------
  describe('user search', () => {
    const search = (user: TestUser, query: string) =>
      http()
        .get(`/api/users/search?${query}`)
        .set('Authorization', bearer(user))
        .expect(200);

    const names = (res: request.Response) =>
      (res.body as { username: string }[]).map((u) => u.username);

    it('shows a member the people they share a community with, not the directory', async () => {
      const searcher = await newUser('finder');
      await addToCommunity(searcher);
      const peer = await newUser('findable-peer');
      await addToCommunity(peer);
      const stranger = await newUser('findable-stranger');

      const res = await search(searcher, 'q=findable&limit=25');

      expect(names(res)).toContain(peer.username);
      expect(names(res)).not.toContain(stranger.username);
    });

    it('finds a stranger only by their exact username', async () => {
      const searcher = await newUser('finder');
      const stranger = await newUser('exactname');

      expect(
        names(await search(searcher, `q=${stranger.username}&limit=25`)),
      ).toEqual([stranger.username]);
      expect(names(await search(searcher, 'q=exactname&limit=25'))).toEqual([]);
    });

    it('returns nothing to a member for an empty query', async () => {
      const searcher = await newUser('finder');
      await addToCommunity(searcher);

      expect(names(await search(searcher, 'q=&limit=100000'))).toEqual([]);
    });

    it('works without a limit, as the OpenAPI spec says', async () => {
      const searcher = await newUser('finder');
      await addToCommunity(searcher);

      await search(searcher, `q=${member.username}`);
    });

    it('refuses the community filter outside your own communities', async () => {
      const searcher = await newUser('finder');

      await http()
        .get(`/api/users/search?q=sec&limit=25&communityId=${communityId}`)
        .set('Authorization', bearer(searcher))
        .expect(403);
    });

    it('a READ_USER holder searches the directory', async () => {
      const admin = await newUser('directory');
      await grantInstanceActions(admin, ['READ_USER']);
      const stranger = await newUser('dirstranger');

      expect(names(await search(admin, 'q=dirstranger&limit=25'))).toContain(
        stranger.username,
      );
    });

    it('caps the limit', async () => {
      await db.user.createMany({
        data: Array.from({ length: 55 }, (_, i) => ({
          username: `sec-bulk-${i}`,
          hashedPassword: 'x',
        })),
      });

      const res = await search(owner, 'q=sec-bulk&limit=100000');

      expect(names(res)).toHaveLength(50);
    });
  });

  // ---------------------------------------------------------------------------
  // Finding 11: signup enumeration
  // ---------------------------------------------------------------------------
  describe('signup', () => {
    it('says nothing about taken names or emails without a valid invite', async () => {
      const existing = await newUser('taken');

      await http()
        .post('/api/users')
        .send({
          code: 'not-an-invite',
          username: existing.username,
          password: PASSWORD,
          email: `${existing.username}@test.local`,
        })
        .expect(404);
    });

    it('a valid invite still reports a conflict', async () => {
      const existing = await newUser('taken');

      await http()
        .post('/api/users')
        .send({
          code: E2E_INVITE_CODE,
          username: existing.username,
          password: PASSWORD,
        })
        .expect(409);
    });
  });

  // ---------------------------------------------------------------------------
  // Finding 12 and lead 2: tokens' names and server mute
  // ---------------------------------------------------------------------------
  describe('voice tokens', () => {
    const channelToken = async (user: TestUser, extra = {}) => {
      const res = await http()
        .post('/api/livekit/token')
        .set('Authorization', bearer(user))
        .send({ roomId: voiceChannelId, identity: user.id, ...extra })
        .expect(201);
      return decodeJwt((res.body as { token: string }).token);
    };

    const mute = (target: TestUser, value: boolean) =>
      http()
        .post(`/api/livekit/channels/${voiceChannelId}/mute-participant`)
        .set('Authorization', bearer(owner))
        .send({ participantIdentity: target.id, mute: value })
        .expect(200);

    it('names the participant after the account, not the request', async () => {
      const user = await newUser('named');
      await addToCommunity(user);

      const claims = await channelToken(user, { name: 'Instance Owner' });

      expect(claims.name).toBe(user.username);
    });

    it('names a DM call participant after the account too', async () => {
      const a = await newUser('named');
      const b = await newUser('named');
      const dmId = await createDm(a, [b]);

      const res = await http()
        .post('/api/livekit/dm-token')
        .set('Authorization', bearer(a))
        .send({ roomId: dmId, identity: a.id, name: 'Somebody Else' })
        .expect(201);

      expect(decodeJwt((res.body as { token: string }).token).name).toBe(
        a.username,
      );
    });

    it('a server mute holds across leaving and rejoining until lifted', async () => {
      const user = await newUser('muted');
      await addToCommunity(user);
      jest.spyOn(livekit, 'muteParticipant').mockResolvedValue(undefined);

      await signedWebhook('participant_joined', voiceChannelId, user.id);
      await mute(user, true);

      // Takes the microphone now...
      const grant = (updatePublishPermissions.mock.calls as unknown[][]).at(
        -1,
      )?.[2] as {
        canPublish: boolean;
        canPublishSources: TrackSource[];
      };
      expect(grant.canPublish).toBe(true);
      expect(grant.canPublishSources).not.toContain(TrackSource.MICROPHONE);
      expect(grant.canPublishSources).toContain(TrackSource.CAMERA);

      // ...and on a new token...
      const claims = await channelToken(user);
      expect(claims.video?.canPublishSources?.length).toBeGreaterThan(0);
      expect(claims.video?.canPublishSources).not.toContain(
        TrackSource.MICROPHONE,
      );
      expect(JSON.stringify(claims.video)).not.toMatch(/microphone/i);

      // ...and on a token from before the mute, when it joins again
      await signedWebhook('participant_left', voiceChannelId, user.id);
      updatePublishPermissions.mockClear();
      await signedWebhook('participant_joined', voiceChannelId, user.id);
      expect(updatePublishPermissions).toHaveBeenCalledTimes(1);

      // The presence entry says so, after leaving and rejoining over REST too
      await http()
        .post(`/api/channels/${voiceChannelId}/voice-presence/leave`)
        .set('Authorization', bearer(user))
        .expect(201);
      await http()
        .post(`/api/channels/${voiceChannelId}/voice-presence/join`)
        .set('Authorization', bearer(user))
        .expect(201);
      const present = await presence.getChannelPresence(voiceChannelId);
      expect(present.find((u) => u.id === user.id)?.isServerMuted).toBe(true);

      // Lifted without asking LiveKit to unmute: it refuses that, and the user
      // may be out of the room by now
      const muteTracks = jest
        .spyOn(livekit, 'muteParticipant')
        .mockRejectedValue(new LivekitException('refused', 500));
      muteTracks.mockClear();
      await mute(user, false);
      expect(muteTracks).not.toHaveBeenCalled();
      const after = await channelToken(user);
      expect(after.video?.canPublishSources ?? []).toEqual([]);
      await presence.leaveVoiceChannel(voiceChannelId, user.id);
    });

    it('muting someone who is not there stays a 404', async () => {
      const user = await newUser('absent');
      jest
        .spyOn(livekit, 'muteParticipant')
        .mockRejectedValueOnce(new LivekitException('gone', 404));

      await http()
        .post(`/api/livekit/channels/${voiceChannelId}/mute-participant`)
        .set('Authorization', bearer(owner))
        .send({ participantIdentity: user.id, mute: true })
        .expect(404);
    });
  });

  // ---------------------------------------------------------------------------
  // Replay quota
  // ---------------------------------------------------------------------------
  describe('clip storage quota', () => {
    const CLIP_BYTES = 2048;

    async function userWithRecording(quotaBytes: number) {
      const user = await newUser('clips');
      await addToCommunity(user);
      await db.user.update({
        where: { id: user.id },
        data: { storageQuotaBytes: BigInt(quotaBytes) },
      });
      await db.egressSession.create({
        data: {
          egressId: `EG_${randomUUID()}`,
          userId: user.id,
          roomName: voiceChannelId,
          channelId: voiceChannelId,
          segmentPath: randomUUID(),
          status: 'active',
          startedAt: new Date(),
        },
      });
      return user;
    }

    const capture = (user: TestUser) =>
      http()
        .post('/api/livekit/replay/capture')
        .set('Authorization', bearer(user))
        .send({ durationMinutes: 1, destination: 'library' });

    beforeEach(() => {
      jest
        .spyOn(app.get(ReplaySegmentsService), 'listCompleteSegments')
        .mockResolvedValue([
          { filename: 'x_00001.ts', sequence: 1, path: '/tmp/x_00001.ts' },
        ]);
      jest
        .spyOn(FfmpegService.prototype, 'concatenateSegments')
        .mockImplementation(async (_segments: string[], out: string) => {
          await fs.writeFile(out, Buffer.alloc(CLIP_BYTES));
        });
      jest
        .spyOn(FfmpegService.prototype, 'getVideoDuration')
        .mockResolvedValue(10);
      jest
        .spyOn(ThumbnailService.prototype, 'generateVideoThumbnail')
        .mockResolvedValue(null);
    });

    it('refuses a clip over the quota and keeps nothing', async () => {
      const user = await userWithRecording(CLIP_BYTES - 1);

      await capture(user).expect(413);

      expect(await db.replayClip.count({ where: { userId: user.id } })).toBe(0);
      expect(await db.file.count({ where: { uploadedById: user.id } })).toBe(0);
    });

    it('counts a clip against the quota, and gives it back on delete', async () => {
      const user = await userWithRecording(CLIP_BYTES * 2);
      const used = async () =>
        Number(
          (await db.user.findUniqueOrThrow({ where: { id: user.id } }))
            .storageUsedBytes,
        );

      const res = await capture(user).expect(201);
      expect(await used()).toBe(CLIP_BYTES);

      await http()
        .delete(`/api/livekit/clips/${(res.body as { clipId: string }).clipId}`)
        .set('Authorization', bearer(user))
        .expect(200);
      expect(await used()).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Leads 3 and 5: threads
  // ---------------------------------------------------------------------------
  describe('thread replies', () => {
    const reply = (user: TestUser, parentId: string, body: object) =>
      http()
        .post(`/api/threads/${parentId}/replies`)
        .set('Authorization', bearer(user))
        .send(body);

    it.each([
      ['spans that are no array', { spans: 'nope' }],
      ['a span of an unknown type', { spans: [{ type: 'NOPE', text: 'x' }] }],
      ['a span that is no object', { spans: ['nope'] }],
      [
        'negative pending attachments',
        { spans: [{ type: 'PLAINTEXT', text: 'x' }], pendingAttachments: -1 },
      ],
      [
        'attachments that are no strings',
        { spans: [{ type: 'PLAINTEXT', text: 'x' }], attachments: [{}] },
      ],
    ])('validates the REST body: %s', async (_what, body) => {
      const parent = await seedMessage(member.id, {
        channelId: textChannelId,
      });

      await reply(member, parent.id, body).expect(400);
    });

    it('accepts a normal reply, with the span fields clients send', async () => {
      const parent = await seedMessage(member.id, {
        channelId: textChannelId,
      });

      await reply(member, parent.id, {
        spans: [
          {
            type: 'PLAINTEXT',
            text: 'a reply',
            userId: null,
            specialKind: null,
            communityId: null,
            aliasId: null,
          },
        ],
        attachments: [],
      }).expect(201);
    });

    it('a removed parent takes no replies or subscribers, and its thread goes with it', async () => {
      const parent = await seedMessage(member.id, {
        channelId: textChannelId,
      });
      await reply(member, parent.id, {
        spans: [{ type: 'PLAINTEXT', text: 'said before removal' }],
      }).expect(201);
      await db.message.update({
        where: { id: parent.id },
        data: { deletedAt: new Date() },
      });

      await reply(member, parent.id, {
        spans: [{ type: 'PLAINTEXT', text: 'said after removal' }],
      }).expect(404);
      await http()
        .post(`/api/threads/${parent.id}/subscribe`)
        .set('Authorization', bearer(member))
        .expect(404);

      const asMember = await http()
        .get(`/api/threads/${parent.id}/replies`)
        .set('Authorization', bearer(member))
        .expect(200);
      expect((asMember.body as { replies: unknown[] }).replies).toEqual([]);

      const asOwner = await http()
        .get(`/api/threads/${parent.id}/replies`)
        .set('Authorization', bearer(owner))
        .expect(200);
      expect((asOwner.body as { replies: unknown[] }).replies).toHaveLength(1);
    });
  });
});
