import { describe, it, expect } from 'vitest';
import {
  prependMessageToInfinite,
  updateMessageInInfinite,
  deleteMessageFromInfinite,
  findMessageInInfinite,
  isDetachedFromLiveEdge,
  prependOrReconcileOptimistic,
  replaceOptimisticMessage,
  removeOptimisticMessage,
  markOptimisticFailed,
  markOptimisticPending,
} from '../../utils/messageCacheUpdaters';
import {
  createMessage,
  createInfiniteData,
  createMultiPageInfiniteData,
} from '../test-utils';

// --- Infinite (Channel) updaters ---

describe('prependMessageToInfinite', () => {
  it('returns undefined when given undefined', () => {
    const result = prependMessageToInfinite(undefined, createMessage());
    expect(result).toBeUndefined();
  });

  it('prepends a message to the first page', () => {
    const existing = createMessage({ id: 'existing-1' });
    const data = createInfiniteData([existing]);
    const newMsg = createMessage({ id: 'new-1' });

    const result = prependMessageToInfinite(data, newMsg);

    expect(result!.pages[0].messages).toHaveLength(2);
    expect(result!.pages[0].messages[0]).toMatchObject({ id: 'new-1' });
    expect(result!.pages[0].messages[1]).toMatchObject({ id: 'existing-1' });
  });

  it('deduplicates — returns unchanged data when message already exists', () => {
    const msg = createMessage({ id: 'dup-1' });
    const data = createInfiniteData([msg]);

    const result = prependMessageToInfinite(data, createMessage({ id: 'dup-1' }));

    expect(result!.pages[0].messages).toHaveLength(1);
  });

  it('does not mutate the original data', () => {
    const existing = createMessage({ id: 'existing-1' });
    const data = createInfiniteData([existing]);
    const originalRef = data.pages[0].messages;

    prependMessageToInfinite(data, createMessage({ id: 'new-1' }));

    expect(data.pages[0].messages).toBe(originalRef);
    expect(data.pages[0].messages).toHaveLength(1);
  });

  it('handles empty first page', () => {
    const data = createInfiniteData([]);
    const result = prependMessageToInfinite(data, createMessage({ id: 'first' }));

    expect(result!.pages[0].messages).toHaveLength(1);
  });

  it('returns unchanged when pages array has no pages', () => {
    const data = { pages: [], pageParams: [] };
    const result = prependMessageToInfinite(data as never, createMessage());
    // No first page → returns data unchanged
    expect(result).toEqual(data);
  });

  it('does not insert when the window is detached from the live edge', () => {
    const existing = createMessage({ id: 'old-1' });
    const data = { ...createInfiniteData([existing]), pageParams: ['cursor-uuid'] };
    const result = prependMessageToInfinite(data, createMessage({ id: 'new-1' }));
    expect(result).toBe(data); // unchanged, same reference
  });
});

describe('isDetachedFromLiveEdge', () => {
  it('is false for undefined data', () => {
    expect(isDetachedFromLiveEdge(undefined)).toBe(false);
  });

  it('is false when the first page param is undefined (factory default)', () => {
    expect(isDetachedFromLiveEdge(createInfiniteData([createMessage()]))).toBe(false);
  });

  it('is false when the first page param is the empty string (live initialPageParam)', () => {
    const data = { ...createInfiniteData([createMessage()]), pageParams: [''] };
    expect(isDetachedFromLiveEdge(data)).toBe(false);
  });

  it('is true when the first page param is a cursor (newest page was evicted)', () => {
    const data = { ...createInfiniteData([createMessage()]), pageParams: ['cursor-uuid'] };
    expect(isDetachedFromLiveEdge(data)).toBe(true);
  });
});

describe('updateMessageInInfinite', () => {
  it('returns undefined when given undefined', () => {
    expect(updateMessageInInfinite(undefined, createMessage())).toBeUndefined();
  });

  it('replaces the matching message in a single page', () => {
    const msg = createMessage({ id: 'msg-1', authorId: 'old-author' });
    const data = createInfiniteData([msg]);

    const updated = createMessage({ id: 'msg-1', authorId: 'new-author' });
    const result = updateMessageInInfinite(data, updated);

    expect(result!.pages[0].messages[0]).toMatchObject({ authorId: 'new-author' });
  });

  it('updates a message in the second page of multi-page data', () => {
    const page1Msg = createMessage({ id: 'p1-msg' });
    const page2Msg = createMessage({ id: 'p2-msg', authorId: 'old' });
    const data = createMultiPageInfiniteData([
      { messages: [page1Msg] },
      { messages: [page2Msg] },
    ]);

    const updated = createMessage({ id: 'p2-msg', authorId: 'new' });
    const result = updateMessageInInfinite(data, updated);

    expect(result!.pages[1].messages[0]).toMatchObject({ authorId: 'new' });
    // First page unchanged
    expect(result!.pages[0].messages[0]).toMatchObject({ id: 'p1-msg' });
  });

  it('keeps the clientId of a row that was sent optimistically (stable React key)', () => {
    const promoted = createMessage({ id: 'msg-1', clientId: 'pending-1', attachments: [] });
    const data = createInfiniteData([promoted]);

    // A server payload (e.g. an attachment landing) never carries a clientId.
    const withFile = createMessage({ id: 'msg-1', attachments: [{ id: 'file-1', filename: 'a.png', mimeType: 'image/png', fileType: 'IMAGE', size: 1 }] });
    const result = updateMessageInInfinite(data, withFile);

    expect(result!.pages[0].messages[0]).toMatchObject({ id: 'msg-1', clientId: 'pending-1' });
    expect(result!.pages[0].messages[0].attachments).toHaveLength(1);
  });

  it('leaves data unchanged when message ID not found', () => {
    const msg = createMessage({ id: 'msg-1' });
    const data = createInfiniteData([msg]);

    const result = updateMessageInInfinite(data, createMessage({ id: 'nonexistent' }));

    expect(result!.pages[0].messages).toHaveLength(1);
    expect(result!.pages[0].messages[0]).toMatchObject({ id: 'msg-1' });
  });
});

describe('deleteMessageFromInfinite', () => {
  it('returns undefined when given undefined', () => {
    expect(deleteMessageFromInfinite(undefined, 'any')).toBeUndefined();
  });

  it('removes the matching message', () => {
    const msg1 = createMessage({ id: 'keep' });
    const msg2 = createMessage({ id: 'remove' });
    const data = createInfiniteData([msg1, msg2]);

    const result = deleteMessageFromInfinite(data, 'remove');

    expect(result!.pages[0].messages).toHaveLength(1);
    expect(result!.pages[0].messages[0]).toMatchObject({ id: 'keep' });
  });

  it('removes from the correct page in multi-page data', () => {
    const data = createMultiPageInfiniteData([
      { messages: [createMessage({ id: 'p1' })] },
      { messages: [createMessage({ id: 'p2-keep' }), createMessage({ id: 'p2-remove' })] },
    ]);

    const result = deleteMessageFromInfinite(data, 'p2-remove');

    expect(result!.pages[0].messages).toHaveLength(1);
    expect(result!.pages[1].messages).toHaveLength(1);
    expect(result!.pages[1].messages[0]).toMatchObject({ id: 'p2-keep' });
  });

  it('leaves data unchanged when message ID not found', () => {
    const data = createInfiniteData([createMessage({ id: 'msg-1' })]);
    const result = deleteMessageFromInfinite(data, 'nonexistent');
    expect(result!.pages[0].messages).toHaveLength(1);
  });
});

describe('findMessageInInfinite', () => {
  it('returns undefined when given undefined', () => {
    expect(findMessageInInfinite(undefined, 'any')).toBeUndefined();
  });

  it('finds a message in the first page', () => {
    const msg = createMessage({ id: 'target' });
    const data = createInfiniteData([msg, createMessage({ id: 'other' })]);

    const result = findMessageInInfinite(data, 'target');
    expect(result).toMatchObject({ id: 'target' });
  });

  it('finds a message across pages', () => {
    const data = createMultiPageInfiniteData([
      { messages: [createMessage({ id: 'p1' })] },
      { messages: [createMessage({ id: 'target' })] },
    ]);

    const result = findMessageInInfinite(data, 'target');
    expect(result).toMatchObject({ id: 'target' });
  });

  it('returns undefined when message not found', () => {
    const data = createInfiniteData([createMessage({ id: 'msg-1' })]);
    expect(findMessageInInfinite(data, 'nonexistent')).toBeUndefined();
  });
});

// --- Optimistic send (PR-13) ---

describe('prependOrReconcileOptimistic', () => {
  const plaintextSpans = (text: string) => [{ type: 'PLAINTEXT' as never, text }];

  it('reconciles in place when a content-matching pending row from the same author exists (echo-first)', () => {
    const optimistic = createMessage({
      id: 'pending-abc',
      authorId: 'user-1',
      clientId: 'pending-abc',
      sendStatus: 'pending',
      spans: plaintextSpans('hello'),
    });
    const other = createMessage({ id: 'other-1', authorId: 'user-2' });
    const data = createInfiniteData([optimistic, other]);

    const real = createMessage({ id: 'real-1', authorId: 'user-1', spans: plaintextSpans('hello') });
    const result = prependOrReconcileOptimistic(data, real);

    expect(result!.pages[0].messages).toHaveLength(2);
    // Real message swapped in at the SAME position the optimistic row held
    // (preserves chronological order relative to `other`).
    expect(result!.pages[0].messages[0]).toMatchObject({ id: 'real-1', clientId: 'pending-abc' });
    expect(result!.pages[0].messages[1]).toMatchObject({ id: 'other-1' });
    // No lingering optimistic row anywhere.
    expect(result!.pages[0].messages.some(m => m.id === 'pending-abc')).toBe(false);
  });

  it('reconciles a failed row too when content matches (late echo after a timed-out ack)', () => {
    const optimistic = createMessage({
      id: 'pending-abc',
      authorId: 'user-1',
      clientId: 'pending-abc',
      sendStatus: 'failed',
      spans: plaintextSpans('hello'),
    });
    const data = createInfiniteData([optimistic]);

    const real = createMessage({ id: 'real-1', authorId: 'user-1', spans: plaintextSpans('hello') });
    const result = prependOrReconcileOptimistic(data, real);

    expect(result!.pages[0].messages).toHaveLength(1);
    expect(result!.pages[0].messages[0]).toMatchObject({ id: 'real-1' });
  });

  it('falls back to a plain prepend when no matching optimistic row exists', () => {
    const existing = createMessage({ id: 'existing-1', authorId: 'user-2' });
    const data = createInfiniteData([existing]);

    const real = createMessage({ id: 'real-1', authorId: 'user-1' });
    const result = prependOrReconcileOptimistic(data, real);

    expect(result!.pages[0].messages).toHaveLength(2);
    expect(result!.pages[0].messages[0]).toMatchObject({ id: 'real-1' });
    expect(result!.pages[0].messages[1]).toMatchObject({ id: 'existing-1' });
  });

  it('does not reconcile against a pending row from a DIFFERENT author', () => {
    const optimistic = createMessage({
      id: 'pending-abc',
      authorId: 'user-2',
      clientId: 'pending-abc',
      sendStatus: 'pending',
    });
    const data = createInfiniteData([optimistic]);

    const real = createMessage({ id: 'real-1', authorId: 'user-1' });
    const result = prependOrReconcileOptimistic(data, real);

    expect(result!.pages[0].messages).toHaveLength(2);
    expect(result!.pages[0].messages[0]).toMatchObject({ id: 'real-1' });
    expect(result!.pages[0].messages[1]).toMatchObject({ id: 'pending-abc' });
  });

  it('deduplicates when the real message id is already present', () => {
    const real = createMessage({ id: 'real-1', authorId: 'user-1' });
    const data = createInfiniteData([real]);

    const result = prependOrReconcileOptimistic(data, createMessage({ id: 'real-1', authorId: 'user-1' }));
    expect(result!.pages[0].messages).toHaveLength(1);
  });

  it('MERGES the echo into an existing id-matched row instead of dropping it (ack-first enrichment)', () => {
    // Simulates ack-first promotion: the optimistic row was already swapped
    // to the real id (with locally-known content only) before the WS echo
    // arrives carrying server-resolved enrichment (e.g. a resolved replyTo).
    const promoted = createMessage({
      id: 'real-1',
      clientId: 'pending-abc',
      authorId: 'user-1',
      spans: plaintextSpans('hello'),
      replyToId: 'parent-1',
    });
    const data = createInfiniteData([promoted]);

    const echo = createMessage({
      id: 'real-1',
      authorId: 'user-1',
      spans: plaintextSpans('hello'),
      replyToId: 'parent-1',
      replyTo: { id: 'parent-1', authorId: 'user-2', spans: [], deletedAt: null } as never,
    });
    const result = prependOrReconcileOptimistic(data, echo);

    expect(result!.pages[0].messages).toHaveLength(1);
    // Enrichment from the echo landed on the row...
    expect(result!.pages[0].messages[0]).toMatchObject({ id: 'real-1', replyTo: { id: 'parent-1' } });
    // ...and clientId (needed for stable row keying) survived the merge.
    expect(result!.pages[0].messages[0]).toMatchObject({ clientId: 'pending-abc' });
  });

  it('does not insert into a detached window', () => {
    const data = { ...createInfiniteData([createMessage({ id: 'old-1' })]), pageParams: ['cursor-uuid'] };
    const result = prependOrReconcileOptimistic(data, createMessage({ id: 'new-1' }));
    expect(result).toBe(data);
  });

  describe('multi-pending disambiguation (fix round 1, Critical 1)', () => {
    it('two captionless sends with files: the echo reconciles the row with the same number of files', () => {
      const twoFiles = createMessage({
        id: 'pending-a', authorId: 'user-1', clientId: 'pending-a', sendStatus: 'failed',
        spans: plaintextSpans(''), pendingAttachments: 2,
      });
      const oneFile = createMessage({
        id: 'pending-b', authorId: 'user-1', clientId: 'pending-b', sendStatus: 'pending',
        spans: plaintextSpans(''), pendingAttachments: 1,
      });
      const data = createInfiniteData([oneFile, twoFiles]);

      const echo = createMessage({ id: 'real-b', authorId: 'user-1', spans: plaintextSpans(''), pendingAttachments: 1 });
      const messages = prependOrReconcileOptimistic(data, echo)!.pages[0].messages;

      expect(messages).toHaveLength(2);
      expect(messages.find(m => m.id === 'real-b')).toMatchObject({ clientId: 'pending-b' });
      expect(messages.find(m => m.id === 'pending-a')).toMatchObject({ sendStatus: 'failed' });
    });

    it('failed-A + pending-B: an echo matching B\'s content reconciles B, leaves A (failed) UNTOUCHED', () => {
      const failedA = createMessage({
        id: 'pending-a',
        authorId: 'user-1',
        clientId: 'pending-a',
        sendStatus: 'failed',
        spans: plaintextSpans('message A'),
      });
      const pendingB = createMessage({
        id: 'pending-b',
        authorId: 'user-1',
        clientId: 'pending-b',
        sendStatus: 'pending',
        spans: plaintextSpans('message B'),
      });
      const data = createInfiniteData([pendingB, failedA]);

      const echoForB = createMessage({ id: 'real-b', authorId: 'user-1', spans: plaintextSpans('message B') });
      const result = prependOrReconcileOptimistic(data, echoForB);

      const messages = result!.pages[0].messages;
      expect(messages).toHaveLength(2);
      // B reconciled to the real message...
      expect(messages.find(m => m.id === 'real-b')).toMatchObject({ clientId: 'pending-b' });
      // ...A's failed bubble is completely untouched (still 'failed', still its own row, retry UI intact).
      const stillFailedA = messages.find(m => (m as unknown as { clientId?: string }).clientId === 'pending-a');
      expect(stillFailedA).toMatchObject({ id: 'pending-a', sendStatus: 'failed' });
    });

    it('failed-A + pending-B: a LATE echo matching A\'s content replaces the failed row (prevents double-post via retry) and does not touch B', () => {
      const failedA = createMessage({
        id: 'pending-a',
        authorId: 'user-1',
        clientId: 'pending-a',
        sendStatus: 'failed',
        spans: plaintextSpans('message A'),
      });
      const pendingB = createMessage({
        id: 'pending-b',
        authorId: 'user-1',
        clientId: 'pending-b',
        sendStatus: 'pending',
        spans: plaintextSpans('message B'),
      });
      const data = createInfiniteData([pendingB, failedA]);

      // The server actually received A before the client gave up and marked
      // it 'failed' — its echo arrives late, after the timeout.
      const echoForA = createMessage({ id: 'real-a', authorId: 'user-1', spans: plaintextSpans('message A') });
      const result = prependOrReconcileOptimistic(data, echoForA);

      const messages = result!.pages[0].messages;
      expect(messages).toHaveLength(2);
      // A's failed row is REPLACED by the real message — a subsequent Retry
      // on A can no longer fire (the failed row, and its Retry affordance,
      // are gone), so the user can't accidentally double-post it.
      expect(messages.some(m => m.id === 'pending-a')).toBe(false);
      expect(messages.find(m => m.id === 'real-a')).toMatchObject({ clientId: 'pending-a' });
      // B (a different pending row, different content) is completely untouched.
      const untouchedB = messages.find(m => (m as unknown as { clientId?: string }).clientId === 'pending-b');
      expect(untouchedB).toMatchObject({ id: 'pending-b', sendStatus: 'pending' });
    });

    it('two PENDING rows, same author, different content: echo only reconciles the content match', () => {
      const pendingA = createMessage({
        id: 'pending-a',
        authorId: 'user-1',
        clientId: 'pending-a',
        sendStatus: 'pending',
        spans: plaintextSpans('first'),
      });
      const pendingB = createMessage({
        id: 'pending-b',
        authorId: 'user-1',
        clientId: 'pending-b',
        sendStatus: 'pending',
        spans: plaintextSpans('second'),
      });
      const data = createInfiniteData([pendingA, pendingB]);

      const echoForSecond = createMessage({ id: 'real-b', authorId: 'user-1', spans: plaintextSpans('second') });
      const result = prependOrReconcileOptimistic(data, echoForSecond);

      const messages = result!.pages[0].messages;
      expect(messages).toHaveLength(2);
      expect(messages.find(m => m.id === 'real-b')).toMatchObject({ clientId: 'pending-b' });
      expect(messages.find(m => m.id === 'pending-a')).toMatchObject({ sendStatus: 'pending' });
    });

    it('same author, no content match at all: falls through to plain insert, both optimistic rows untouched', () => {
      const pendingA = createMessage({
        id: 'pending-a',
        authorId: 'user-1',
        clientId: 'pending-a',
        sendStatus: 'pending',
        spans: plaintextSpans('first'),
      });
      const data = createInfiniteData([pendingA]);

      const unrelatedEcho = createMessage({ id: 'real-x', authorId: 'user-1', spans: plaintextSpans('totally different') });
      const result = prependOrReconcileOptimistic(data, unrelatedEcho);

      const messages = result!.pages[0].messages;
      expect(messages).toHaveLength(2);
      expect(messages[0]).toMatchObject({ id: 'real-x' });
      expect(messages[1]).toMatchObject({ id: 'pending-a', sendStatus: 'pending' });
    });
  });
});

describe('replaceOptimisticMessage', () => {
  it('replaces the optimistic row matched by clientId with the real message', () => {
    const optimistic = createMessage({
      id: 'pending-abc',
      clientId: 'pending-abc',
      sendStatus: 'pending',
    });
    const data = createInfiniteData([optimistic]);

    const real = createMessage({ id: 'real-1' });
    const result = replaceOptimisticMessage(data, 'pending-abc', real);

    expect(result!.pages[0].messages).toHaveLength(1);
    expect(result!.pages[0].messages[0]).toMatchObject({ id: 'real-1' });
  });

  it('is a no-op when no row with that clientId is found (already reconciled by the echo)', () => {
    const real = createMessage({ id: 'real-1' });
    const data = createInfiniteData([real]);

    const result = replaceOptimisticMessage(data, 'pending-abc', createMessage({ id: 'real-1' }));
    expect(result).toBe(data);
  });

  it('returns undefined when given undefined', () => {
    expect(replaceOptimisticMessage(undefined, 'pending-abc', createMessage())).toBeUndefined();
  });

  it('is a no-op against an already-reconciled row (id changed, clientId retained) — does not overwrite it again', () => {
    const reconciled = createMessage({ id: 'real-1', clientId: 'pending-abc' });
    const data = createInfiniteData([reconciled]);

    const result = replaceOptimisticMessage(data, 'pending-abc', createMessage({ id: 'real-1-different' }));
    expect(result).toBe(data);
    expect(result!.pages[0].messages[0]).toMatchObject({ id: 'real-1' });
  });
});

describe('removeOptimisticMessage', () => {
  it('removes the row matched by clientId', () => {
    const optimistic = createMessage({ id: 'pending-abc', clientId: 'pending-abc', sendStatus: 'failed' });
    const keep = createMessage({ id: 'keep-1' });
    const data = createInfiniteData([optimistic, keep]);

    const result = removeOptimisticMessage(data, 'pending-abc');
    expect(result!.pages[0].messages).toHaveLength(1);
    expect(result!.pages[0].messages[0]).toMatchObject({ id: 'keep-1' });
  });

  it('leaves data unchanged when clientId not found', () => {
    const data = createInfiniteData([createMessage({ id: 'keep-1' })]);
    const result = removeOptimisticMessage(data, 'nonexistent');
    expect(result!.pages[0].messages).toHaveLength(1);
  });

  it('returns undefined when given undefined', () => {
    expect(removeOptimisticMessage(undefined, 'pending-abc')).toBeUndefined();
  });

  it('does NOT remove a row whose clientId is retained but whose id has already been reconciled (fix round 1 guard)', () => {
    // Simulates an echo-first-reconciled row: id swapped to the real
    // message id, but clientId intentionally kept for stable React keying.
    // The ack-side cleanup call must treat this as already-handled, not as
    // a redundant leftover placeholder to delete.
    const reconciled = createMessage({ id: 'real-1', clientId: 'pending-abc' });
    const data = createInfiniteData([reconciled]);

    const result = removeOptimisticMessage(data, 'pending-abc');
    expect(result!.pages[0].messages).toHaveLength(1);
    expect(result!.pages[0].messages[0]).toMatchObject({ id: 'real-1', clientId: 'pending-abc' });
  });
});

describe('markOptimisticFailed', () => {
  it("sets sendStatus to 'failed' on the row matched by clientId", () => {
    const optimistic = createMessage({ id: 'pending-abc', clientId: 'pending-abc', sendStatus: 'pending' });
    const data = createInfiniteData([optimistic]);

    const result = markOptimisticFailed(data, 'pending-abc');
    expect(result!.pages[0].messages[0]).toMatchObject({ sendStatus: 'failed', id: 'pending-abc' });
  });

  it('leaves other rows untouched', () => {
    const optimistic = createMessage({ id: 'pending-abc', clientId: 'pending-abc', sendStatus: 'pending' });
    const other = createMessage({ id: 'other-1' });
    const data = createInfiniteData([optimistic, other]);

    const result = markOptimisticFailed(data, 'pending-abc');
    expect(result!.pages[0].messages[1]).toMatchObject({ id: 'other-1' });
    expect((result!.pages[0].messages[1] as { sendStatus?: string }).sendStatus).toBeUndefined();
  });

  it('returns undefined when given undefined', () => {
    expect(markOptimisticFailed(undefined, 'pending-abc')).toBeUndefined();
  });

  it('does NOT flip an already-reconciled real message back to failed (lost-ack-after-echo guard, fix round 1)', () => {
    // The echo already reconciled this row (id swapped to the real id,
    // clientId retained for React key stability). If the ack itself is then
    // lost/times out, reconcileAfterSend's failure branch must not touch it.
    const reconciled = createMessage({ id: 'real-1', clientId: 'pending-abc' });
    const data = createInfiniteData([reconciled]);

    const result = markOptimisticFailed(data, 'pending-abc');
    expect(result!.pages[0].messages[0]).toMatchObject({ id: 'real-1', clientId: 'pending-abc' });
    expect((result!.pages[0].messages[0] as unknown as { sendStatus?: string }).sendStatus).toBeUndefined();
  });
});

describe('markOptimisticPending', () => {
  it("resets a 'failed' row back to 'pending', keeping the same id", () => {
    const optimistic = createMessage({ id: 'pending-abc', clientId: 'pending-abc', sendStatus: 'failed' });
    const data = createInfiniteData([optimistic]);

    const result = markOptimisticPending(data, 'pending-abc');
    expect(result!.pages[0].messages[0]).toMatchObject({ sendStatus: 'pending', id: 'pending-abc' });
  });

  it('returns undefined when given undefined', () => {
    expect(markOptimisticPending(undefined, 'pending-abc')).toBeUndefined();
  });
});

