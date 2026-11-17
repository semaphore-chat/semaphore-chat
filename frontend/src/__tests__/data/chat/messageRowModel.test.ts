import { describe, expect, it } from 'vitest';
import {
  DELETED_USER,
  sendFailureReason,
  toAttachmentViews,
  toQuoteView,
  toReactionViews,
  toRowView,
} from '../../../data/chat/messageRowModel';
import { SpanType } from '../../../types/message.type';
import { formatClockTime, formatMessageTime } from '../../../utils/messageTime';
import { createMessage } from '../../test-utils/factories';

const now = new Date('2026-11-16T20:00:00');

describe('toRowView', () => {
  it('names the author by display name, else username, else id; a deleted account as the old row does', () => {
    const message = createMessage({ authorId: 'u-1' });
    expect(toRowView(message, { author: { name: 'Aiko' }, dayShownAbove: false }).author).toBe('Aiko');
    expect(toRowView(message, { dayShownAbove: false }).author).toBe('u-1');
    const gone = toRowView(createMessage({ authorId: null }), { dayShownAbove: false });
    expect(gone.author).toBe(DELETED_USER);
    expect(gone.hasProfile).toBe(false);
  });

  it('a webhook message is named by the webhook, with its picture and no profile', () => {
    const view = toRowView(createMessage({ webhook: { id: 'w', name: 'CI bot', avatarUrl: 'https://x/a.png' } }), {
      dayShownAbove: false,
    });
    expect(view).toMatchObject({ author: 'CI bot', hasProfile: false, webhookAvatar: 'https://x/a.png' });
  });

  it('the time is the clock alone under a day separator, else the compact time', () => {
    const sentAt = '2026-11-15T19:30:00';
    const message = createMessage({ sentAt });
    expect(toRowView(message, { dayShownAbove: true, now }).time).toBe(formatClockTime(sentAt));
    expect(toRowView(message, { dayShownAbove: false, now }).time).toBe(formatMessageTime(sentAt, now));
  });

  it('carries the marks and the send state, with a failed send’s reason', () => {
    const view = toRowView(
      createMessage({ editedAt: '2026-11-16T19:00:00Z', pinned: true, sendStatus: 'failed', sendError: 'Timed out', id: 'pending-1' }),
      { dayShownAbove: false },
    );
    expect(view).toMatchObject({ edited: true, pinned: true, state: 'failed', failedReason: 'Timed out', optimistic: true });
    expect(toRowView(createMessage({ id: 'm-1' }), { dayShownAbove: false })).toMatchObject({ state: 'sent', optimistic: false });
  });

  it('a mention of the reader marks the row', () => {
    const message = createMessage({ spans: [{ type: SpanType.USER_MENTION, userId: 'me', text: '@me' }] });
    expect(toRowView(message, { me: 'me', dayShownAbove: false }).mentioned).toBe(true);
    expect(toRowView(message, { me: 'other', dayShownAbove: false }).mentioned).toBe(false);
  });
});

describe('toReactionViews', () => {
  it('counts each emoji, marks the reader’s own, and leaves out empty ones', () => {
    expect(
      toReactionViews(
        [
          { emoji: '😂', userIds: ['a', 'me'] },
          { emoji: '🔥', userIds: [] },
          { emoji: '👍', userIds: ['b'] },
        ],
        'me',
      ),
    ).toEqual([
      { key: '😂', emoji: '😂', label: '😂', count: 2, mine: true },
      { key: '👍', emoji: '👍', label: '👍', count: 1, mine: false },
    ]);
  });

  it('a custom emoji reaction draws the community’s emoji and is named by it; an unknown one never shows its id', () => {
    const emojiById = new Map([['e-1', { name: 'partyparrot', fileId: 'f-9' }]]);
    const views = toReactionViews(
      [
        { emoji: 'custom:e-1', userIds: ['me'] },
        { emoji: 'custom:gone-3f2a', userIds: ['a', 'b'] },
      ],
      'me',
      { emojiById, fileUrl: (id) => `/api/file/${id}` },
    );
    expect(views).toEqual([
      { key: 'custom:e-1', emoji: ':partyparrot:', src: '/api/file/f-9', label: 'partyparrot', count: 1, mine: true },
      { key: 'custom:gone-3f2a', emoji: '❓', label: 'Custom emoji', count: 2, mine: false },
    ]);
    expect(JSON.stringify(views[1])).not.toMatch(/gone-3f2a"[^,]*label|emoji":"custom/);
  });
});

describe('toQuoteView', () => {
  it('is the first plain text of the original, else "Message"; a deleted original says so', () => {
    const base = { id: 'r-1', authorId: 'u-2', sentAt: '2026-11-16T19:00:00Z', deletedAt: null };
    expect(toQuoteView(null)).toBeNull();
    expect(
      toQuoteView({
        ...base,
        spans: [
          { type: SpanType.USER_MENTION, text: '@x', userId: 'x' },
          { type: SpanType.PLAINTEXT, text: 'hello' },
        ],
      }),
    ).toEqual({ id: 'r-1', authorId: 'u-2', line: 'hello', deleted: false });
    expect(toQuoteView({ ...base, spans: [] })?.line).toBe('Message');
    expect(toQuoteView({ ...base, deletedAt: '2026-11-16T19:05:00Z', spans: [] })?.deleted).toBe(true);
  });
});

describe('toAttachmentViews', () => {
  it('images are drawn with their size; video, audio and documents are file rows', () => {
    const views = toAttachmentViews([
      { id: 'f-1', filename: 'a.png', fileType: 'IMAGE', mimeType: 'image/png', size: 2048, width: 1600, height: 900 },
      { id: 'f-2', filename: 'b.mp4', fileType: 'VIDEO', mimeType: 'video/mp4', size: 1024 * 1024, width: 1920, height: 1080 },
      { id: 'f-3', filename: 'c.txt', fileType: 'DOCUMENT', mimeType: 'text/plain', size: 12 },
    ] as never);
    expect(views).toEqual([
      { id: 'f-1', kind: 'image', name: 'a.png', mimeType: 'image/png', detail: '2 KB', width: 1600, height: 900 },
      { id: 'f-2', kind: 'file', name: 'b.mp4', mimeType: 'video/mp4', detail: '1 MB', width: 1920, height: 1080 },
      { id: 'f-3', kind: 'file', name: 'c.txt', mimeType: 'text/plain', detail: '12 Bytes', width: null, height: null },
    ]);
  });
});

describe('sendFailureReason', () => {
  it('a time-out the reader is under wins over the server refusal; else the server text; else nothing', () => {
    const until = new Date('2026-11-16T14:05:00');
    expect(sendFailureReason('Forbidden', until)).toBe(`Timed out until ${formatClockTime(until)}`);
    expect(sendFailureReason('Message too long', undefined)).toBe('Message too long');
    expect(sendFailureReason(undefined, undefined)).toBeUndefined();
    expect(sendFailureReason(null, undefined)).toBeUndefined();
  });
});
