import { RbacActions } from '@prisma/client';
import { LivekitService } from '@/livekit/livekit.service';
import { VoicePresenceService } from '@/voice-presence/voice-presence.service';
import { authzFixture, AuthzFixture, unique } from './helpers/authz-fixture';

/**
 * Removing people: DELETE_MEMBER follows kick's rank rule and is logged,
 * timeouts can't be lifted by the person serving them or over a higher rank,
 * and leaving a community by any route ends voice and alias group membership.
 *
 * LiveKit isn't running in e2e: its room calls are spied on and stubbed.
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

describe('Removing members and lifting timeouts (e2e)', () => {
  const names = [
    'owner',
    'admin',
    'peer',
    'mod',
    'mod2',
    'low',
    'member',
  ] as const;
  type Who = (typeof names)[number];
  let f: AuthzFixture<Who>;
  let removeParticipant: jest.SpyInstance;

  async function scene() {
    const c = await f.community();
    await f.join(c.id, 'admin', 'peer', 'mod', 'mod2', 'low', 'member');
    await f.give(c.id, 'admin', c.adminRole);
    await f.give(c.id, 'peer', c.adminRole);
    await f.give(c.id, 'mod', c.modRole);
    await f.give(c.id, 'mod2', c.modRole);
    return c;
  }

  const isMember = (userId: string, communityId: string) =>
    f.db.membership.count({ where: { userId, communityId } });
  const logsFor = (communityId: string, targetUserId: string) =>
    f.db.moderationLog.findMany({ where: { communityId, targetUserId } });

  beforeAll(async () => {
    f = await authzFixture('mr', names);
  });

  beforeEach(() => {
    const livekit = f.app.get(LivekitService);
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
    await f.app.close();
  });

  describe('DELETE_MEMBER', () => {
    it('a low role with DELETE_MEMBER cannot remove an admin', async () => {
      const c = await scene();
      const role = await f.customRole(c.id, 50, [RbacActions.DELETE_MEMBER]);
      await f.give(c.id, 'low', role);

      await f
        .http()
        .delete(`/api/membership/community/${c.id}/user/${f.id.admin}`)
        .set('Authorization', f.bearer('low'))
        .expect(403);
      expect(await isMember(f.id.admin, c.id)).toBe(1);
    });

    it('an admin cannot remove a peer admin, as with kick', async () => {
      const c = await scene();
      await f
        .http()
        .delete(`/api/membership/community/${c.id}/user/${f.id.peer}`)
        .set('Authorization', f.bearer('admin'))
        .expect(403);
      expect(await isMember(f.id.peer, c.id)).toBe(1);
    });

    it('an admin removes a member, and it is logged', async () => {
      const c = await scene();
      await f
        .http()
        .delete(`/api/membership/community/${c.id}/user/${f.id.member}`)
        .set('Authorization', f.bearer('admin'))
        .expect(204);
      expect(await isMember(f.id.member, c.id)).toBe(0);

      const logs = await logsFor(c.id, f.id.member);
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        moderatorId: f.id.admin,
        action: 'KICK_USER',
      });
    });

    it('the instance owner can still remove anyone', async () => {
      const c = await scene();
      await f
        .http()
        .delete(`/api/membership/community/${c.id}/user/${f.id.admin}`)
        .set('Authorization', f.bearer('owner'))
        .expect(204);
    });

    it('applies to the private channel member list too', async () => {
      const c = await scene();
      const channel = await f.db.channel.create({
        data: {
          name: unique('private'),
          communityId: c.id,
          type: 'TEXT',
          isPrivate: true,
        },
      });
      const role = await f.customRole(c.id, 50, [
        RbacActions.DELETE_MEMBER,
        RbacActions.READ_CHANNEL,
      ]);
      await f.give(c.id, 'low', role);
      for (const who of ['low', 'admin', 'member'] as const) {
        await f.db.channelMembership.create({
          data: { userId: f.id[who], channelId: channel.id },
        });
      }

      await f
        .http()
        .delete(
          `/api/channel-membership/channel/${channel.id}/user/${f.id.admin}`,
        )
        .set('Authorization', f.bearer('low'))
        .expect(403);
      expect(
        await f.db.channelMembership.count({
          where: { userId: f.id.admin, channelId: channel.id },
        }),
      ).toBe(1);

      await f
        .http()
        .delete(
          `/api/channel-membership/channel/${channel.id}/user/${f.id.member}`,
        )
        .set('Authorization', f.bearer('low'))
        .expect(204);
      const logs = await logsFor(c.id, f.id.member);
      expect(logs).toHaveLength(1);
      expect(logs[0].moderatorId).toBe(f.id.low);
    });
  });

  describe('lifting a timeout', () => {
    const timeoutRows = (communityId: string, userId: string) =>
      f.db.communityTimeout.count({ where: { communityId, userId } });

    async function timeOut(communityId: string, by: Who, target: Who) {
      await f
        .http()
        .post(`/api/moderation/timeout/${communityId}/${f.id[target]}`)
        .set('Authorization', f.bearer(by))
        .send({ durationSeconds: 600 })
        .expect(200);
    }

    it('a moderator cannot lift their own timeout', async () => {
      const c = await scene();
      await timeOut(c.id, 'admin', 'mod');
      await f
        .http()
        .delete(`/api/moderation/timeout/${c.id}/${f.id.mod}`)
        .set('Authorization', f.bearer('mod'))
        .send({})
        .expect(403);
      expect(await timeoutRows(c.id, f.id.mod)).toBe(1);
    });

    it('a moderator cannot lift a timeout set by a higher rank', async () => {
      const c = await scene();
      await timeOut(c.id, 'admin', 'member');
      await f
        .http()
        .delete(`/api/moderation/timeout/${c.id}/${f.id.member}`)
        .set('Authorization', f.bearer('mod'))
        .send({})
        .expect(403);
      expect(await timeoutRows(c.id, f.id.member)).toBe(1);
    });

    describe('lifting a community ban', () => {
      const banBy = async (communityId: string, moderator: Who) => {
        await f
          .http()
          .post(`/api/moderation/ban/${communityId}/${f.id.member}`)
          .set('Authorization', f.bearer(moderator))
          .send({})
          .expect(200);
      };
      const unbanBy = (communityId: string, moderator: Who) =>
        f
          .http()
          .delete(`/api/moderation/ban/${communityId}/${f.id.member}`)
          .set('Authorization', f.bearer(moderator))
          .send({});
      const banActive = async (communityId: string) =>
        (
          await f.db.communityBan.findUniqueOrThrow({
            where: {
              communityId_userId: { communityId, userId: f.id.member },
            },
          })
        ).active;
      /** A custom role below the moderators, that may only lift bans. */
      const lowUnbanner = async (communityId: string) => {
        const role = await f.customRole(communityId, 200, [
          RbacActions.UNBAN_USER,
        ]);
        await f.give(communityId, 'low', role);
      };

      it('the default Community Admin can ban and unban (#692)', async () => {
        const c = await scene();
        await banBy(c.id, 'admin');
        expect(await banActive(c.id)).toBe(true);
        await unbanBy(c.id, 'admin').expect(200);
        expect(await banActive(c.id)).toBe(false);
      });

      it('cannot lift a ban set by a higher rank', async () => {
        const c = await scene();
        await lowUnbanner(c.id);
        await banBy(c.id, 'admin');
        await unbanBy(c.id, 'low').expect(403);
        expect(await banActive(c.id)).toBe(true);
      });

      it('a peer or a higher rank can lift it', async () => {
        const c = await scene();
        await banBy(c.id, 'admin');
        await unbanBy(c.id, 'peer').expect(200);
        expect(await banActive(c.id)).toBe(false);
      });

      it('a ban whose moderator is gone can be lifted', async () => {
        const c = await scene();
        await lowUnbanner(c.id);
        await banBy(c.id, 'admin');
        await f.db.communityBan.update({
          where: {
            communityId_userId: { communityId: c.id, userId: f.id.member },
          },
          data: { moderatorId: null },
        });
        await unbanBy(c.id, 'low').expect(200);
      });

      it('an instance owner can lift any of them', async () => {
        const c = await scene();
        await banBy(c.id, 'admin');
        await unbanBy(c.id, 'owner').expect(200);
      });
    });

    describe('viewing the timeout list (#688)', () => {
      const list = (communityId: string, who: Who) =>
        f
          .http()
          .get(`/api/moderation/timeouts/${communityId}`)
          .set('Authorization', f.bearer(who));

      it('a role that can only set timeouts sees it', async () => {
        const c = await scene();
        await timeOut(c.id, 'admin', 'member');
        await f.give(
          c.id,
          'low',
          await f.customRole(c.id, 50, [RbacActions.TIMEOUT_USER]),
        );

        const res = await list(c.id, 'low').expect(200);
        expect((res.body as { userId: string }[]).map((t) => t.userId)).toEqual(
          [f.id.member],
        );
      });

      it('a ban-list viewer sees it, as before', async () => {
        const c = await scene();
        await timeOut(c.id, 'admin', 'member');
        await f.give(
          c.id,
          'low',
          await f.customRole(c.id, 50, [RbacActions.VIEW_BAN_LIST]),
        );

        await list(c.id, 'low').expect(200);
      });

      it('holds neither permission: refused', async () => {
        const c = await scene();
        await f.give(
          c.id,
          'low',
          await f.customRole(c.id, 50, [RbacActions.KICK_USER]),
        );

        await list(c.id, 'low').expect(403);
      });
    });

    it('still allows a peer or a higher rank to lift it', async () => {
      const c = await scene();
      await timeOut(c.id, 'mod', 'member');
      await f
        .http()
        .delete(`/api/moderation/timeout/${c.id}/${f.id.member}`)
        .set('Authorization', f.bearer('mod2'))
        .send({})
        .expect(200);

      await timeOut(c.id, 'mod', 'member');
      await f
        .http()
        .delete(`/api/moderation/timeout/${c.id}/${f.id.member}`)
        .set('Authorization', f.bearer('admin'))
        .send({})
        .expect(200);
    });
  });

  describe('instance owner moderation (#679)', () => {
    /** A community the owner moderates without any community role. */
    async function ownerScene() {
      const c = await f.community();
      await f.join(c.id, 'admin', 'member');
      await f.give(c.id, 'admin', c.adminRole);
      // Creating a community makes you its Community Admin; drop that so the
      // owner holds no role there.
      await f.db.userRoles.deleteMany({
        where: { communityId: c.id, userId: f.id.owner },
      });
      return c;
    }

    it('bans an admin, although the owner has no community role', async () => {
      const c = await ownerScene();
      await f
        .http()
        .post(`/api/moderation/ban/${c.id}/${f.id.admin}`)
        .set('Authorization', f.bearer('owner'))
        .send({ reason: 'owner decision' })
        .expect(200);
      expect(await isMember(f.id.admin, c.id)).toBe(0);
      expect(
        (
          await f.db.communityBan.findUniqueOrThrow({
            where: {
              communityId_userId: { communityId: c.id, userId: f.id.admin },
            },
          })
        ).active,
      ).toBe(true);
    });

    it('kicks an admin, although the owner has no community role', async () => {
      const c = await ownerScene();
      await f
        .http()
        .post(`/api/moderation/kick/${c.id}/${f.id.admin}`)
        .set('Authorization', f.bearer('owner'))
        .send({ reason: 'owner decision' })
        .expect(200);
      expect(await isMember(f.id.admin, c.id)).toBe(0);
    });

    it('times an admin out, although the owner has no community role', async () => {
      const c = await ownerScene();
      await f
        .http()
        .post(`/api/moderation/timeout/${c.id}/${f.id.admin}`)
        .set('Authorization', f.bearer('owner'))
        .send({ durationSeconds: 600, reason: 'owner decision' })
        .expect(200);
      expect(
        await f.db.communityTimeout.count({
          where: { communityId: c.id, userId: f.id.admin },
        }),
      ).toBe(1);
    });

    it.each(['ban', 'kick', 'timeout'])(
      'still cannot %s themselves',
      async (action) => {
        const c = await ownerScene();
        await f
          .http()
          .post(`/api/moderation/${action}/${c.id}/${f.id.owner}`)
          .set('Authorization', f.bearer('owner'))
          .send(action === 'timeout' ? { durationSeconds: 600 } : {})
          .expect(403);
        expect(await isMember(f.id.owner, c.id)).toBe(1);
      },
    );
  });

  describe('leaving a community by any route', () => {
    async function inVoice(communityId: string, who: Who) {
      const channel = await f.db.channel.create({
        data: { name: unique('voice'), communityId, type: 'VOICE' },
      });
      await f.app
        .get(VoicePresenceService)
        .joinVoiceChannelDirect(channel.id, f.id[who]);
      return channel.id;
    }

    it('removal by an admin disconnects the member from voice', async () => {
      const c = await scene();
      const channelId = await inVoice(c.id, 'member');
      await f
        .http()
        .delete(`/api/membership/community/${c.id}/user/${f.id.member}`)
        .set('Authorization', f.bearer('admin'))
        .expect(204);
      await until(() => removeParticipant.mock.calls.length > 0);
      expect(removeParticipant).toHaveBeenCalledWith(channelId, f.id.member);
    });

    it('leaving disconnects you from voice', async () => {
      const c = await scene();
      const channelId = await inVoice(c.id, 'member');
      await f
        .http()
        .delete(`/api/membership/leave/${c.id}`)
        .set('Authorization', f.bearer('member'))
        .expect(204);
      await until(() => removeParticipant.mock.calls.length > 0);
      expect(removeParticipant).toHaveBeenCalledWith(channelId, f.id.member);
    });

    it.each<[string, Who]>([
      ['leave', 'member'],
      ['remove', 'admin'],
      ['kick', 'admin'],
    ])('%s drops alias group membership', async (how, actor) => {
      const c = await scene();
      const group = await f.db.aliasGroup.create({
        data: {
          name: unique('alias'),
          communityId: c.id,
          members: { create: { userId: f.id.member } },
        },
      });

      const req = f.http();
      const call =
        how === 'leave'
          ? req.delete(`/api/membership/leave/${c.id}`)
          : how === 'remove'
            ? req.delete(
                `/api/membership/community/${c.id}/user/${f.id.member}`,
              )
            : req.post(`/api/moderation/kick/${c.id}/${f.id.member}`).send({});
      const res = await call.set('Authorization', f.bearer(actor));
      expect(res.status).toBeLessThan(300);

      expect(
        await f.db.aliasGroupMember.count({
          where: { aliasGroupId: group.id, userId: f.id.member },
        }),
      ).toBe(0);
    });
  });
});
