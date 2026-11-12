import { expectNoSensitiveUserFields } from '@/test-utils';
import { toWireMessage } from '@/common/utils/message-wire.utils';
import { toMessageDto, toMessageReactionsDto } from './message.mapper';

const SENT = new Date('2026-01-02T03:04:05.000Z');

function span(overrides: Record<string, unknown> = {}) {
  return {
    id: 'span-1',
    messageId: 'm1',
    position: 0,
    type: 'PLAINTEXT',
    text: 'hello',
    userId: null,
    specialKind: null,
    communityId: null,
    channelId: null,
    aliasId: null,
    emojiId: null,
    bold: null,
    italic: null,
    strikethrough: null,
    code: null,
    ...overrides,
  };
}

function row(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'm1',
    channelId: 'c1',
    directMessageGroupId: null,
    authorId: 'u1',
    sentAt: SENT,
    editedAt: null,
    deletedAt: null,
    pendingAttachments: 0,
    searchText: 'hello',
    pinned: false,
    pinnedAt: null,
    pinnedBy: null,
    deletedBy: null,
    deletedByReason: null,
    parentMessageId: null,
    replyCount: 0,
    lastReplyAt: null,
    replyToId: null,
    linkPreviews: null,
    webhookId: null,
    webhook: null,
    spans: [span()],
    reactions: [],
    attachments: [],
    ...overrides,
  };
}

describe('toMessageDto', () => {
  it('sends every field, with timestamps as ISO strings and no value as null', () => {
    expect(toMessageDto(row())).toEqual({
      id: 'm1',
      channelId: 'c1',
      directMessageGroupId: null,
      authorId: 'u1',
      spans: [
        {
          type: 'PLAINTEXT',
          text: 'hello',
          userId: null,
          specialKind: null,
          communityId: null,
          channelId: null,
          aliasId: null,
          emojiId: null,
          bold: null,
          italic: null,
          strikethrough: null,
          code: null,
        },
      ],
      attachments: [],
      pendingAttachments: 0,
      reactions: [],
      linkPreviews: null,
      replyCount: 0,
      lastReplyAt: null,
      pinned: false,
      pinnedAt: null,
      pinnedBy: null,
      sentAt: '2026-01-02T03:04:05.000Z',
      editedAt: null,
      deletedAt: null,
      parentMessageId: null,
      replyToId: null,
      replyTo: null,
      webhook: null,
      deletedBy: null,
      deletedByReason: null,
    });
  });

  it('never passes on a column or relation it does not list', () => {
    const dto = toMessageDto(
      row({
        searchText: 'secret',
        webhookId: 'w1',
        author: { id: 'u1', hashedPassword: 'x', email: 'a@b.c' },
        pinnedByUser: { hashedPassword: 'x' },
        secretNewColumn: 'x',
      }),
    );

    expect(dto).not.toHaveProperty('searchText');
    expect(dto).not.toHaveProperty('webhookId');
    expect(dto).not.toHaveProperty('author');
    expect(dto).not.toHaveProperty('secretNewColumn');
    expect(dto.spans[0]).not.toHaveProperty('id');
    expect(dto.spans[0]).not.toHaveProperty('messageId');
    expect(dto.spans[0]).not.toHaveProperty('position');
    expectNoSensitiveUserFields(dto);
  });

  it('turns attachments into their metadata, without the storage path', () => {
    const dto = toMessageDto(
      row({
        attachments: [
          {
            file: {
              id: 'f1',
              filename: 'a.png',
              mimeType: 'image/png',
              fileType: 'IMAGE',
              size: 3,
              width: 1920,
              height: 1080,
              thumbnailPath: '/private/thumb.png',
            },
          },
        ],
      }),
    );

    expect(dto.attachments).toEqual([
      {
        id: 'f1',
        filename: 'a.png',
        mimeType: 'image/png',
        fileType: 'IMAGE',
        size: 3,
        hasThumbnail: true,
        width: 1920,
        height: 1080,
      },
    ]);
  });

  it('reports null dimensions for an attachment whose size is unknown', () => {
    const dto = toMessageDto(
      row({
        attachments: [
          {
            file: {
              id: 'f1',
              filename: 'a.pdf',
              mimeType: 'application/pdf',
              fileType: 'DOCUMENT',
              size: 3,
              width: null,
              height: null,
              thumbnailPath: null,
            },
          },
        ],
      }),
    );

    expect(dto.attachments[0]).toMatchObject({ width: null, height: null });
  });

  it('groups reactions', () => {
    const dto = toMessageDto(
      row({
        reactions: [
          { emoji: '👍', userId: 'u1' },
          { emoji: '👍', userId: 'u2' },
        ],
      }),
    );

    expect(dto.reactions).toEqual([{ emoji: '👍', userIds: ['u1', 'u2'] }]);
  });

  describe('a quote preview', () => {
    const quoted = {
      id: 'q1',
      authorId: 'u2',
      sentAt: SENT,
      deletedAt: null,
      searchText: 'quoted',
      spans: [
        span({ type: 'CHANNEL_MENTION', channelId: 'private', text: null }),
      ],
    };

    it('does not carry the channel a quoted mention points at', () => {
      const { replyTo } = toMessageDto(row({ replyToMessage: quoted }));

      expect(replyTo?.spans[0]).not.toHaveProperty('channelId');
      expect(replyTo?.spans[0].type).toBe('CHANNEL_MENTION');
    });

    it('keeps only the preview fields', () => {
      const { replyTo } = toMessageDto(row({ replyToMessage: quoted }));

      expect(Object.keys(replyTo ?? {}).sort()).toEqual([
        'authorId',
        'deletedAt',
        'id',
        'sentAt',
        'spans',
      ]);
    });

    it('is blank for a deleted message', () => {
      const deletedAt = new Date('2026-02-01T00:00:00.000Z');
      const { replyTo } = toMessageDto(
        row({ replyToMessage: { ...quoted, deletedAt } }),
      );

      expect(replyTo?.spans).toEqual([]);
      expect(replyTo?.deletedAt).toBe('2026-02-01T00:00:00.000Z');
    });

    it('is null when the message quotes nothing, or its target is gone', () => {
      expect(toMessageDto(row()).replyTo).toBeNull();
      expect(toMessageDto(row({ replyToMessage: null })).replyTo).toBeNull();
    });
  });
});

describe('toMessageReactionsDto', () => {
  it('answers with the location and the reactions only', () => {
    expect(
      toMessageReactionsDto(
        row({
          searchText: 'secret',
          deletedBy: 'moderator',
          reactions: [{ emoji: '👍', userId: 'u1' }],
        }),
      ),
    ).toEqual({
      id: 'm1',
      channelId: 'c1',
      directMessageGroupId: null,
      parentMessageId: null,
      deletedAt: null,
      reactions: [{ emoji: '👍', userIds: ['u1'] }],
    });
  });
});

describe('toWireMessage', () => {
  it('passes a live message through', () => {
    const dto = toMessageDto(row());
    expect(toWireMessage(dto)).toBe(dto);
  });

  it('always blanks a removed message, for the whole room', () => {
    const wire = toWireMessage(
      toMessageDto(
        row({
          deletedAt: SENT,
          deletedBy: 'moderator',
          deletedByReason: 'reason',
          linkPreviews: [{ url: 'https://x.test' }],
        }),
      ),
    );

    expect(wire).toMatchObject({
      spans: [],
      attachments: [],
      reactions: [],
      linkPreviews: null,
      deletedBy: null,
      deletedByReason: null,
    });
  });
});
