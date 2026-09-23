import { describe, it, expect } from 'vitest';
import {
  shouldGroupWithPrevious,
  startsNewDay,
  dayMarkers,
  GROUP_WINDOW_MS,
} from '../../utils/messageGrouping';
import { createMessage } from '../test-utils/factories';

const at = (h: number, m: number, s = 0, day = 22) => new Date(2026, 8, day, h, m, s).toISOString();

describe('shouldGroupWithPrevious', () => {
  it('groups the same author within 5 minutes', () => {
    const prev = createMessage({ authorId: 'u1', sentAt: at(16, 0) });
    const curr = createMessage({ authorId: 'u1', sentAt: at(16, 4, 59) });
    expect(shouldGroupWithPrevious(prev, curr)).toBe(true);
  });

  it('does not group the first message', () => {
    expect(shouldGroupWithPrevious(undefined, createMessage({ authorId: 'u1' }))).toBe(false);
  });

  it('does not group a different author', () => {
    const prev = createMessage({ authorId: 'u1', sentAt: at(16, 0) });
    const curr = createMessage({ authorId: 'u2', sentAt: at(16, 1) });
    expect(shouldGroupWithPrevious(prev, curr)).toBe(false);
  });

  it('is broken by a gap of 5 minutes or more', () => {
    const prev = createMessage({ authorId: 'u1', sentAt: at(16, 0) });
    expect(GROUP_WINDOW_MS).toBe(5 * 60 * 1000);
    expect(shouldGroupWithPrevious(prev, createMessage({ authorId: 'u1', sentAt: at(16, 5) }))).toBe(false);
    expect(shouldGroupWithPrevious(prev, createMessage({ authorId: 'u1', sentAt: at(16, 20) }))).toBe(false);
  });

  it('is broken by a quote reply', () => {
    const prev = createMessage({ authorId: 'u1', sentAt: at(16, 0) });
    const curr = createMessage({
      authorId: 'u1',
      sentAt: at(16, 1),
      replyToId: 'm-0',
      replyTo: { id: 'm-0', authorId: 'u2', spans: [], sentAt: at(15, 0) },
    });
    expect(shouldGroupWithPrevious(prev, curr)).toBe(false);
    // A reply whose target was hard-deleted (replyTo: null) is still a reply.
    expect(
      shouldGroupWithPrevious(prev, createMessage({ authorId: 'u1', sentAt: at(16, 1), replyToId: 'gone', replyTo: null })),
    ).toBe(false);
  });

  it('is broken after a message that has a thread', () => {
    const prev = createMessage({ authorId: 'u1', sentAt: at(16, 0), replyCount: 3 });
    const curr = createMessage({ authorId: 'u1', sentAt: at(16, 1) });
    expect(shouldGroupWithPrevious(prev, curr)).toBe(false);
  });

  it('is broken by a day change even within 5 minutes', () => {
    const prev = createMessage({ authorId: 'u1', sentAt: at(23, 58, 0, 21) });
    const curr = createMessage({ authorId: 'u1', sentAt: at(0, 1, 0, 22) });
    expect(shouldGroupWithPrevious(prev, curr)).toBe(false);
  });

  it('never groups deleted-user messages (no author)', () => {
    const prev = createMessage({ authorId: null, sentAt: at(16, 0) });
    const curr = createMessage({ authorId: null, sentAt: at(16, 1) });
    expect(shouldGroupWithPrevious(prev, curr)).toBe(false);
  });

  it('groups consecutive messages from the same webhook, not across webhooks', () => {
    const hook = (id: string) => ({ id, name: id, avatarUrl: null });
    const prev = createMessage({ authorId: null, webhook: hook('w1'), sentAt: at(16, 0) });
    expect(
      shouldGroupWithPrevious(prev, createMessage({ authorId: null, webhook: hook('w1'), sentAt: at(16, 1) })),
    ).toBe(true);
    expect(
      shouldGroupWithPrevious(prev, createMessage({ authorId: null, webhook: hook('w2'), sentAt: at(16, 1) })),
    ).toBe(false);
  });

  it('does not group a message sent before the previous one (out of order)', () => {
    const prev = createMessage({ authorId: 'u1', sentAt: at(16, 5) });
    const curr = createMessage({ authorId: 'u1', sentAt: at(16, 0) });
    expect(shouldGroupWithPrevious(prev, curr)).toBe(false);
  });
});

describe('startsNewDay', () => {
  it('is true for the first message', () => {
    expect(startsNewDay(undefined, createMessage({ sentAt: at(16, 0) }))).toBe(true);
  });

  it('is true when the calendar day changes', () => {
    const prev = createMessage({ sentAt: at(23, 59, 0, 21) });
    expect(startsNewDay(prev, createMessage({ sentAt: at(0, 0, 0, 22) }))).toBe(true);
  });

  it('is false on the same day', () => {
    const prev = createMessage({ sentAt: at(1, 0) });
    expect(startsNewDay(prev, createMessage({ sentAt: at(23, 0) }))).toBe(false);
  });
});

describe('dayMarkers', () => {
  it('returns nothing for an empty list', () => {
    expect(dayMarkers([])).toEqual([]);
  });

  it('puts a separator on the first row even mid-day (window starts after older pages)', () => {
    // The loaded window begins at 3 PM — earlier same-day messages are not
    // loaded yet — so the first row still gets the day label above it.
    const rows = dayMarkers([
      createMessage({ sentAt: at(15, 0, 0, 21) }),
      createMessage({ sentAt: at(15, 1, 0, 21) }),
    ]);
    expect(rows).toEqual([
      { separator: true, dayShownAbove: true },
      { separator: false, dayShownAbove: true },
    ]);
  });

  it('marks each day change and keeps every row labelled by its own day', () => {
    const msgs = [
      createMessage({ sentAt: at(23, 50, 0, 20) }),
      createMessage({ sentAt: at(9, 0, 0, 21) }),
      createMessage({ sentAt: at(18, 0, 0, 21) }),
      createMessage({ sentAt: at(0, 1, 0, 22) }),
    ];
    const rows = dayMarkers(msgs);
    expect(rows.map((r) => r.separator)).toEqual([true, true, false, true]);
    expect(rows.every((r) => r.dayShownAbove)).toBe(true);
  });

  it('holds when a row is out of order (e.g. an optimistic row with a skewed clock)', () => {
    const rows = dayMarkers([
      createMessage({ sentAt: at(10, 0, 0, 22) }),
      createMessage({ sentAt: at(23, 0, 0, 21) }),
      createMessage({ sentAt: at(10, 5, 0, 22) }),
    ]);
    expect(rows.map((r) => r.separator)).toEqual([true, true, true]);
    expect(rows.every((r) => r.dayShownAbove)).toBe(true);
  });
});
