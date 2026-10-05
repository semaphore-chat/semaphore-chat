import * as request from 'supertest';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import {
  createE2eApp,
  resetDatabase,
  seedInstanceInvite,
  registerUser,
  loginUser,
  E2eApp,
  RegisteredUser,
} from './helpers/e2e-app';
import { LivekitService } from '@/livekit/livekit.service';
import { VoicePresenceService } from '@/voice-presence/voice-presence.service';
import {
  TIMEOUT_EXPIRY_QUEUE,
  timeoutExpiryJobId,
} from '@/jobs/jobs.constants';
import { TimeoutExpiryJobData } from '@/jobs/jobs.types';

/**
 * Voice access follow-ups (channel permissions, phase 4 items 2 and 3):
 *  - users who lose view of a voice channel are disconnected from its
 *    LiveKit room and their voice presence is cleared (privacy flip, removal
 *    from a private channel's member list);
 *  - applying a timeout schedules a delayed job at its expiry, lifting it
 *    cancels that job.
 *
 * LiveKit isn't running in e2e: its room calls are spied on and stubbed.
 * Voice presence is the real Redis-backed index.
 */

process.env.LIVEKIT_API_KEY ??= 'devkey';
process.env.LIVEKIT_API_SECRET ??=
  'e2e-secret-that-is-at-least-32-characters-long';
process.env.LIVEKIT_URL ??= 'ws://localhost:7880';

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

describe('Voice access when view is lost, and timeout expiry (e2e)', () => {
  let app: E2eApp;
  let livekit: LivekitService;
  let presence: VoicePresenceService;
  let removeParticipant: jest.SpyInstance;

  const owner = {
    username: 'e2e-va-owner',
    password: 'Password123!',
    email: 'e2e-va-owner@test.local',
  };
  const member = {
    username: 'e2e-va-member',
    password: 'Password123!',
    email: 'e2e-va-member@test.local',
  };

  let ownerToken: string;
  let ownerUser: RegisteredUser;
  let memberUser: RegisteredUser;
  let communityId: string;

  const http = () => request(app.getHttpServer());

  async function createVoiceChannel(name: string): Promise<string> {
    const res = await http()
      .post('/api/channels')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name, communityId, type: 'VOICE', isPrivate: false })
      .expect(201);
    return (res.body as { id: string }).id;
  }

  const presentIds = async (channelId: string) =>
    (await presence.getChannelPresence(channelId)).map((u) => u.id);

  beforeAll(async () => {
    app = await createE2eApp();
    await resetDatabase(app);
    await seedInstanceInvite(app);

    ownerUser = await registerUser(app, owner); // first -> instance owner
    memberUser = await registerUser(app, member);
    ownerToken = (await loginUser(app, owner.username, owner.password))
      .accessToken;

    const community = await http()
      .post('/api/community')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'E2E Voice Access' })
      .expect(201);
    communityId = (community.body as { id: string }).id;
    await http()
      .post('/api/membership')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ userId: memberUser.id, communityId })
      .expect(201);

    livekit = app.get(LivekitService);
    presence = app.get(VoicePresenceService);
  });

  beforeEach(() => {
    removeParticipant = jest
      .spyOn(livekit, 'removeParticipant')
      .mockResolvedValue(undefined);
    jest.spyOn(livekit, 'listParticipantIdentities').mockResolvedValue([]);
    jest.spyOn(livekit, 'updatePublishPermissions').mockResolvedValue();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  it('a public -> private flip disconnects connected members who lost view, not the viewers', async () => {
    const channelId = await createVoiceChannel('e2e-va-flip');
    await presence.joinVoiceChannelDirect(channelId, ownerUser.id);
    await presence.joinVoiceChannelDirect(channelId, memberUser.id);
    expect((await presentIds(channelId)).sort()).toEqual(
      [ownerUser.id, memberUser.id].sort(),
    );

    await http()
      .patch(`/api/channels/${channelId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ isPrivate: true })
      .expect(200);

    expect(removeParticipant).toHaveBeenCalledWith(channelId, memberUser.id);
    expect(removeParticipant).not.toHaveBeenCalledWith(channelId, ownerUser.id);
    expect(await presentIds(channelId)).toEqual([ownerUser.id]);
  });

  it('removal from a private channel member list disconnects that user', async () => {
    const channelId = await createVoiceChannel('e2e-va-list');
    await http()
      .patch(`/api/channels/${channelId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ isPrivate: true })
      .expect(200);
    await http()
      .post('/api/channel-membership')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ userId: memberUser.id, channelId })
      .expect(201);
    await presence.joinVoiceChannelDirect(channelId, memberUser.id);
    expect(await presentIds(channelId)).toEqual([memberUser.id]);

    await http()
      .delete(
        `/api/channel-membership/channel/${channelId}/user/${memberUser.id}`,
      )
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect((res) => {
        if (res.status >= 300) throw new Error(`status ${res.status}`);
      });

    // CHANNEL_MEMBERSHIP_REMOVED is emitted without being awaited
    await until(() => removeParticipant.mock.calls.length > 0);
    expect(removeParticipant).toHaveBeenCalledWith(channelId, memberUser.id);
    await until(async () => (await presentIds(channelId)).length === 0);
  });

  it('a timeout schedules a delayed expiry job; lifting it cancels the job', async () => {
    const queue = app.get<Queue<TimeoutExpiryJobData>>(
      getQueueToken(TIMEOUT_EXPIRY_QUEUE),
    );
    const before = Date.now();

    await http()
      .post(`/api/moderation/timeout/${communityId}/${memberUser.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ durationSeconds: 600 })
      .expect(200);

    const delayed = await queue.getDelayed();
    const job = delayed.find(
      (j) =>
        j.data.userId === memberUser.id && j.data.communityId === communityId,
    );
    expect(job).toBeDefined();
    const expiresAt = new Date(job!.data.expiresAt);
    expect(job!.id).toBe(
      timeoutExpiryJobId(communityId, memberUser.id, expiresAt),
    );
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + 600_000);
    expect(job!.opts.delay).toBeGreaterThan(590_000);

    await http()
      .delete(`/api/moderation/timeout/${communityId}/${memberUser.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect((res) => {
        if (res.status >= 300) throw new Error(`status ${res.status}`);
      });

    expect(await queue.getJob(job!.id!)).toBeUndefined();
  });
});
