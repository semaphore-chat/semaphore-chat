import { describe, expect, it } from 'vitest';
import { findLastEditableMessage } from '../../../data/chat/lastEditable';
import { createMessage } from '../../test-utils/factories';

const ME = 'me';

describe('findLastEditableMessage', () => {
  it('unknown me: null', () => {
    expect(findLastEditableMessage([createMessage({ authorId: '' })], '')).toBeNull();
  });

  it('no messages, or none of mine: null', () => {
    expect(findLastEditableMessage([], ME)).toBeNull();
    expect(findLastEditableMessage([createMessage({ authorId: 'other' })], ME)).toBeNull();
  });

  it('the newest (first) of mine that is sent, not deleted and not optimistic', () => {
    const target = createMessage({ id: 'ok', authorId: ME });
    const messages = [
      createMessage({ id: 'theirs', authorId: 'other' }),
      createMessage({ id: 'pending', authorId: ME, sendStatus: 'pending' }),
      createMessage({ id: 'failed', authorId: ME, sendStatus: 'failed' }),
      createMessage({ id: 'deleted', authorId: ME, deletedAt: new Date().toISOString() } as never),
      createMessage({ id: 'pending-123', authorId: ME }),
      target,
      createMessage({ id: 'older', authorId: ME }),
    ];
    expect(findLastEditableMessage(messages, ME)).toBe(target);
  });
});
