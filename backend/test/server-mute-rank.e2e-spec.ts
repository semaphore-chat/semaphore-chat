import { randomUUID } from 'crypto';
import { LivekitService } from '@/livekit/livekit.service';
import { VoicePresenceService } from '@/voice-presence/voice-presence.service';
import { authzFixture, AuthzFixture } from './helpers/authz-fixture';

/**
 * Server mute follows moderation's rank rule. MUTE_PARTICIPANT on the channel
 * alone would let a muted moderator lift their own mute, and a moderator mute
 * an admin or the instance owner for 30 days.
 *
 * LiveKit isn't running in e2e: its room calls are stubbed.
 */
process.env.LIVEKIT_API_KEY ??= 'devkey';
process.env.LIVEKIT_API_SECRET ??=
  'e2e-secret-that-is-at-least-32-characters-long';
process.env.LIVEKIT_URL ??= 'ws://localhost:7880';

describe('Server mute rank (e2e)', () => {
  const names = ['owner', 'admin', 'mod', 'mod2', 'member'] as const;
  type Who = (typeof names)[number];
  let f: AuthzFixture<Who>;
  let presence: VoicePresenceService;

  const mute = (actor: Who, channelId: string, target: Who, value: boolean) =>
    f
      .http()
      .post(`/api/livekit/channels/${channelId}/mute-participant`)
      .set('Authorization', f.bearer(actor))
      .send({ participantIdentity: f.id[target], mute: value });

  async function scene() {
    const c = await f.community();
    await f.join(c.id, 'admin', 'mod', 'mod2', 'member');
    await f.give(c.id, 'admin', c.adminRole);
    await f.give(c.id, 'mod', c.modRole);
    await f.give(c.id, 'mod2', c.modRole);
    return c;
  }

  beforeAll(async () => {
    f = await authzFixture('smr', names);
    presence = f.app.get(VoicePresenceService);
  });

  beforeEach(() => {
    const livekit = f.app.get(LivekitService);
    jest.spyOn(livekit, 'muteParticipant').mockResolvedValue(undefined);
    jest.spyOn(livekit, 'updatePublishPermissions').mockResolvedValue();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await f.app.close();
  });

  it('a moderator cannot mute a higher rank or a peer', async () => {
    const c = await scene();
    await mute('mod', c.generalChannel, 'admin', true).expect(403);
    await mute('mod', c.generalChannel, 'mod2', true).expect(403);
    expect(await presence.isServerMuted(c.generalChannel, f.id.admin)).toBe(
      false,
    );
    expect(await presence.isServerMuted(c.generalChannel, f.id.mod2)).toBe(
      false,
    );
  });

  it('a moderator cannot mute the instance owner, even one with no role there', async () => {
    const c = await scene();
    await f.db.userRoles.deleteMany({
      where: { userId: f.id.owner, communityId: c.id },
    });
    await mute('mod', c.generalChannel, 'owner', true).expect(403);
    expect(await presence.isServerMuted(c.generalChannel, f.id.owner)).toBe(
      false,
    );
  });

  it('nobody but an owner mutes or lifts for themselves', async () => {
    const c = await scene();
    await mute('admin', c.generalChannel, 'mod', true).expect(200);

    await mute('mod', c.generalChannel, 'mod', false).expect(403);
    expect(await presence.isServerMuted(c.generalChannel, f.id.mod)).toBe(true);

    await mute('admin', c.generalChannel, 'admin', true).expect(403);
  });

  it('a moderator can mute and lift for a lower rank', async () => {
    const c = await scene();
    await mute('mod', c.generalChannel, 'member', true).expect(200);
    expect(await presence.isServerMuted(c.generalChannel, f.id.member)).toBe(
      true,
    );
    await mute('mod', c.generalChannel, 'member', false).expect(200);
    expect(await presence.isServerMuted(c.generalChannel, f.id.member)).toBe(
      false,
    );
  });

  it('cannot lift a mute on a higher rank either', async () => {
    const c = await scene();
    await mute('owner', c.generalChannel, 'admin', true).expect(200);
    await mute('mod', c.generalChannel, 'admin', false).expect(403);
    expect(await presence.isServerMuted(c.generalChannel, f.id.admin)).toBe(
      true,
    );
  });

  it('an instance owner may mute and lift anyone, themselves included', async () => {
    const c = await scene();
    await mute('owner', c.generalChannel, 'admin', true).expect(200);
    await mute('owner', c.generalChannel, 'admin', false).expect(200);
    await mute('owner', c.generalChannel, 'owner', true).expect(200);
    await mute('owner', c.generalChannel, 'owner', false).expect(200);
  });

  it('a member without the action stays refused', async () => {
    const c = await scene();
    await mute('member', c.generalChannel, 'mod', true).expect(403);
  });

  it('a room that is not a channel, such as a DM, has no server mute', async () => {
    const dm = await f
      .http()
      .post('/api/direct-messages')
      .set('Authorization', f.bearer('mod'))
      .send({ userIds: [f.id.member] })
      .expect(201);
    const dmId = (dm.body as { id: string }).id;

    await mute('mod', dmId, 'member', true).expect(403);
    await mute('owner', dmId, 'member', true).expect(404);
    await mute('owner', randomUUID(), 'member', true).expect(404);
    expect(await presence.isServerMuted(dmId, f.id.member)).toBe(false);
  });
});
