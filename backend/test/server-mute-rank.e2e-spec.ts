import { randomUUID } from 'crypto';
import { TrackSource } from 'livekit-server-sdk';
import { LivekitService } from '@/livekit/livekit.service';
import { LivekitException } from '@/livekit/exceptions/livekit.exception';
import { FULL_PUBLISH_GRANT } from '@/livekit/publish-grant.util';
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
  let livekit: LivekitService;
  let muteTrack: jest.SpyInstance;
  let publishGrant: jest.SpyInstance;
  let disconnect: jest.SpyInstance;

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
    livekit = f.app.get(LivekitService);
    muteTrack = jest
      .spyOn(livekit, 'muteParticipant')
      .mockResolvedValue(undefined);
    publishGrant = jest
      .spyOn(livekit, 'updatePublishPermissions')
      .mockResolvedValue();
    disconnect = jest
      .spyOn(livekit, 'disconnectParticipant')
      .mockResolvedValue(undefined);
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

  it('lifting a mute restores the grant without asking LiveKit to unmute the track', async () => {
    const c = await scene();
    await mute('mod', c.generalChannel, 'member', true).expect(200);

    // Muting still mutes the live microphone...
    expect(muteTrack).toHaveBeenCalledWith(c.generalChannel, f.id.member);
    // ...and takes it out of what the member may publish
    const mutedGrant = (publishGrant.mock.calls as unknown[][]).at(-1)?.[2] as {
      canPublishSources?: TrackSource[];
    };
    expect(mutedGrant.canPublishSources).not.toContain(TrackSource.MICROPHONE);

    muteTrack.mockClear();
    publishGrant.mockClear();
    await mute('mod', c.generalChannel, 'member', false).expect(200);

    // LiveKit would refuse a remote unmute (412 on a stock server): the
    // endpoint never tries, it gives the microphone back through the grant.
    expect(muteTrack).not.toHaveBeenCalled();
    expect(publishGrant).toHaveBeenCalledWith(
      c.generalChannel,
      f.id.member,
      FULL_PUBLISH_GRANT,
    );
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

  const remove = (actor: Who, channelId: string, target: Who) =>
    f
      .http()
      .post(`/api/livekit/channels/${channelId}/remove-participant`)
      .set('Authorization', f.bearer(actor))
      .send({ participantIdentity: f.id[target] });

  it('a moderator removes a lower rank from the call only, and they may rejoin', async () => {
    const c = await scene();

    await remove('mod', c.generalChannel, 'member').expect(200);
    expect(disconnect).toHaveBeenCalledWith(c.generalChannel, f.id.member);
    // Not a ban or a kick: the community membership is untouched
    expect(
      await f.db.membership.findFirst({
        where: { communityId: c.id, userId: f.id.member },
      }),
    ).not.toBeNull();
    expect(
      await f.db.communityBan.findFirst({
        where: { communityId: c.id, userId: f.id.member },
      }),
    ).toBeNull();
  });

  it('removing follows the same rank rule as muting', async () => {
    const c = await scene();

    await remove('mod', c.generalChannel, 'admin').expect(403);
    await remove('mod', c.generalChannel, 'mod2').expect(403);
    await remove('mod', c.generalChannel, 'mod').expect(403);
    await remove('member', c.generalChannel, 'mod').expect(403);
    expect(disconnect).not.toHaveBeenCalled();

    await remove('owner', c.generalChannel, 'admin').expect(200);
    await remove('owner', c.generalChannel, 'owner').expect(200);
  });

  it('removing someone who is not in the call is a 404', async () => {
    const c = await scene();
    disconnect.mockRejectedValueOnce(
      new LivekitException('Participant is not in this voice channel', 404),
    );

    await remove('mod', c.generalChannel, 'member').expect(404);
  });

  describe('canModerate in the presence GET', () => {
    const presenceOf = async (channelId: string, viewer: Who) => {
      const res = await f
        .http()
        .get(`/api/channels/${channelId}/voice-presence`)
        .set('Authorization', f.bearer(viewer))
        .expect(200);
      // Supertest body: the endpoint's documented response shape
      const body = res.body as {
        users: { id: string; canModerate?: boolean }[];
      };
      return new Map(body.users.map((user) => [user.id, user.canModerate]));
    };

    it('reports whom the caller outranks, never the caller', async () => {
      const c = await scene();
      await presence.joinVoiceChannelDirect(c.generalChannel, f.id.mod);
      await presence.joinVoiceChannelDirect(c.generalChannel, f.id.member);
      await presence.joinVoiceChannelDirect(c.generalChannel, f.id.mod2);
      await presence.joinVoiceChannelDirect(c.generalChannel, f.id.admin);
      await presence.joinVoiceChannelDirect(c.generalChannel, f.id.owner);

      const asMod = await presenceOf(c.generalChannel, 'mod');
      expect(asMod.get(f.id.member)).toBe(true);
      expect(asMod.get(f.id.mod2)).toBe(false);
      expect(asMod.get(f.id.admin)).toBe(false);
      expect(asMod.get(f.id.mod)).toBe(false);
      expect(asMod.get(f.id.owner)).toBe(false);

      // An owner is above the rule towards everyone else; their own entry
      // stays false
      const asOwner = await presenceOf(c.generalChannel, 'owner');
      expect(asOwner.get(f.id.admin)).toBe(true);
      expect(asOwner.get(f.id.owner)).toBe(false);

      await presence.leaveVoiceChannel(c.generalChannel, f.id.mod);
      await presence.leaveVoiceChannel(c.generalChannel, f.id.member);
      await presence.leaveVoiceChannel(c.generalChannel, f.id.mod2);
      await presence.leaveVoiceChannel(c.generalChannel, f.id.admin);
      await presence.leaveVoiceChannel(c.generalChannel, f.id.owner);
    });

    it('offers nothing to a member without the mute action', async () => {
      const c = await scene();
      await presence.joinVoiceChannelDirect(c.generalChannel, f.id.mod);
      await presence.joinVoiceChannelDirect(c.generalChannel, f.id.member);

      const asMember = await presenceOf(c.generalChannel, 'member');
      expect([...asMember.values()].some(Boolean)).toBe(false);

      await presence.leaveVoiceChannel(c.generalChannel, f.id.mod);
      await presence.leaveVoiceChannel(c.generalChannel, f.id.member);
    });
  });
});
