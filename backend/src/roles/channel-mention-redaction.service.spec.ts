import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { ChannelMentionRedactionService } from './channel-mention-redaction.service';
import { ChannelAccessService } from './channel-access.service';

const mention = (channelId: string | null) => ({
  type: 'CHANNEL_MENTION',
  channelId,
  text: null,
});

/** A message as the API returns it: spans, a reply preview, a notification. */
const payload = () => ({
  id: 'm1',
  spans: [
    { type: 'PLAINTEXT', text: 'see ', channelId: null },
    mention('visible'),
    mention('hidden'),
  ],
  replyTo: { id: 'm0', spans: [mention('hidden')] },
  notification: { message: { spans: [mention('hidden'), mention('visible')] } },
});

describe('ChannelMentionRedactionService', () => {
  let service: ChannelMentionRedactionService;
  let access: Mocked<ChannelAccessService>;

  beforeEach(async () => {
    const { unit, unitRef } = await TestBed.solitary(
      ChannelMentionRedactionService,
    ).compile();
    service = unit;
    access = unitRef.get(ChannelAccessService);
    access.canViewChannel.mockImplementation((_user, id) =>
      Promise.resolve(id === 'visible'),
    );
  });

  describe('hasChannelMentions', () => {
    it('finds mentions with an id anywhere, ignores redacted ones and other spans', () => {
      expect(ChannelMentionRedactionService.hasChannelMentions(payload())).toBe(
        true,
      );
      expect(
        ChannelMentionRedactionService.hasChannelMentions({
          spans: [mention(null), { type: 'PLAINTEXT', text: 'x' }],
        }),
      ).toBe(false);
      expect(ChannelMentionRedactionService.hasChannelMentions(null)).toBe(
        false,
      );
      expect(ChannelMentionRedactionService.hasChannelMentions('x')).toBe(
        false,
      );
    });

    it('survives cycles and skips buffers', () => {
      const a: Record<string, unknown> = {
        buf: Buffer.from('CHANNEL_MENTION'),
      };
      a.self = a;
      expect(ChannelMentionRedactionService.hasChannelMentions(a)).toBe(false);
    });
  });

  describe('forUser', () => {
    it('nulls the ids the reader cannot view, everywhere (spans, reply preview, notification)', async () => {
      const result = await service.forUser('member', payload());

      expect(result.spans[1]).toEqual(mention('visible'));
      expect(result.spans[2]).toEqual(mention(null));
      expect(result.replyTo.spans[0]).toEqual(mention(null));
      expect(result.notification.message.spans).toEqual([
        mention(null),
        mention('visible'),
      ]);
      // One visibility check per distinct channel
      expect(access.canViewChannel).toHaveBeenCalledTimes(2);
      expect(access.canViewChannel).toHaveBeenCalledWith('member', 'hidden');
    });

    it('nulls every id for an unauthenticated reader without lookups', async () => {
      const result = await service.forUser(null, payload());

      expect(JSON.stringify(result)).not.toContain('hidden');
      expect(JSON.stringify(result)).not.toContain('"visible"');
      expect(access.canViewChannel).not.toHaveBeenCalled();
    });

    it('returns a value without mentions untouched', async () => {
      const value = { spans: [{ type: 'PLAINTEXT', text: 'hi' }] };
      await expect(service.forUser('member', value)).resolves.toBe(value);
      expect(access.canViewChannel).not.toHaveBeenCalled();
    });
  });

  describe('forRoom', () => {
    it('user room: redacts for that user', async () => {
      const result = await service.forRoom('user:u1', payload());
      expect(access.canViewChannel).toHaveBeenCalledWith('u1', 'hidden');
      expect(result.spans[2]).toEqual(mention(null));
    });

    it('community room: keeps only channels the whole community sees', async () => {
      access.isVisibleToWholeCommunity.mockImplementation((id) =>
        Promise.resolve(id === 'visible'),
      );
      const result = await service.forRoom('community:c1', payload());
      expect(result.spans[1]).toEqual(mention('visible'));
      expect(result.spans[2]).toEqual(mention(null));
    });

    it('DM (and other prefixed) rooms: nulls everything', async () => {
      const result = await service.forRoom('dm:g1', payload());
      expect(JSON.stringify(result)).not.toMatch(
        /"channelId":"(hidden|visible)"/,
      );
    });

    it('channel room: keeps a mention iff every viewer of the room can view it', async () => {
      access.isVisibleToWholeCommunity.mockResolvedValue(false);
      access.viewerUserIds.mockImplementation((id) =>
        Promise.resolve(
          id === 'room-channel'
            ? ['a', 'b']
            : id === 'visible'
              ? ['a', 'b', 'c'] // superset of the room's viewers
              : ['a'], // 'hidden': b can't see it
        ),
      );
      const result = await service.forRoom('room-channel', payload());
      expect(result.spans[1]).toEqual(mention('visible'));
      expect(result.spans[2]).toEqual(mention(null));
    });

    it('channel room: a mention of the room itself, or of a public channel, is kept', async () => {
      access.isVisibleToWholeCommunity.mockImplementation((id) =>
        Promise.resolve(id === 'public'),
      );
      const result = await service.forRoom('room-channel', {
        spans: [mention('room-channel'), mention('public')],
      });
      expect(result.spans).toEqual([
        mention('room-channel'),
        mention('public'),
      ]);
      expect(access.viewerUserIds).not.toHaveBeenCalled();
    });

    it('does not mutate the payload it was given (socket payloads are copied)', async () => {
      const original = payload();
      await service.forRoom('user:u1', original);
      expect(original.spans[2]).toEqual(mention('hidden'));
    });
  });
});
