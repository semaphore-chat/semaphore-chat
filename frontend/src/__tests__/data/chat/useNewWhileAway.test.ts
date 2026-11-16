import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useNewWhileAway, type UseNewWhileAwayOptions } from '../../../data/chat/useNewWhileAway';
import { createMessage } from '../../test-utils/factories';
import type { Message } from '../../../types/message.type';

const msg = (id: string, authorId = 'other') => createMessage({ id, authorId });

function setup(initial: Partial<UseNewWhileAwayOptions> = {}) {
  const props: UseNewWhileAwayOptions = {
    orderedMessages: [msg('m-1'), msg('m-2')],
    atBottom: false,
    authorId: 'me',
    contextKey: 'ch-1',
    live: true,
    ...initial,
  };
  const hook = renderHook((p: UseNewWhileAwayOptions) => useNewWhileAway(p), { initialProps: props });
  return { ...hook, props };
}

describe('useNewWhileAway', () => {
  it('the first page is not new', () => {
    const { result } = setup();
    expect(result.current).toBe(0);
  });

  it('counts others’ messages appended while away, a burst as several', () => {
    const { result, rerender, props } = setup();
    const next: Message[] = [...props.orderedMessages, msg('m-3'), msg('m-4')];
    rerender({ ...props, orderedMessages: next });
    expect(result.current).toBe(2);
    rerender({ ...props, orderedMessages: [...next, msg('m-5')] });
    expect(result.current).toBe(3);
  });

  it('never counts the reader’s own messages, nor messages that arrive at the bottom', () => {
    const { result, rerender, props } = setup();
    rerender({ ...props, orderedMessages: [...props.orderedMessages, msg('m-3', 'me')] });
    expect(result.current).toBe(0);
    rerender({ ...props, atBottom: true, orderedMessages: [...props.orderedMessages, msg('m-3', 'me'), msg('m-4')] });
    expect(result.current).toBe(0);
  });

  it('back at the bottom the count is 0 again', () => {
    const { result, rerender, props } = setup();
    rerender({ ...props, orderedMessages: [...props.orderedMessages, msg('m-3')] });
    expect(result.current).toBe(1);
    rerender({ ...props, orderedMessages: [...props.orderedMessages, msg('m-3')], atBottom: true });
    expect(result.current).toBe(0);
  });

  it('a switch starts again: the new channel’s page is not new', () => {
    const { result, rerender, props } = setup();
    rerender({ ...props, orderedMessages: [...props.orderedMessages, msg('m-3')] });
    expect(result.current).toBe(1);
    rerender({ ...props, contextKey: 'ch-2', orderedMessages: [msg('x-1'), msg('x-2')] });
    expect(result.current).toBe(0);
  });

  it('a previous newest that left the window counts only the new newest', () => {
    const { result, rerender, props } = setup();
    rerender({ ...props, orderedMessages: [msg('m-9'), msg('m-10')] });
    expect(result.current).toBe(1);
  });

  it('after a ?highlight= jump, pages loaded toward the present are history, not new; live arrivals then count', () => {
    // Anchored on an old message: not live.
    const { result, rerender, props } = setup({ live: false, orderedMessages: [msg('h-10'), msg('h-11')] });
    // Scrolling down loads newer pages of history (appended, newest changes) while still away from the bottom.
    const paged = [msg('h-10'), msg('h-11'), ...Array.from({ length: 25 }, (_, i) => msg(`h-${12 + i}`))];
    rerender({ ...props, live: false, orderedMessages: paged });
    expect(result.current).toBe(0);
    // The window reaches the present and the list follows the live edge again: still nothing new.
    const present = [...paged, msg('p-1')];
    rerender({ ...props, live: true, orderedMessages: present });
    expect(result.current).toBe(0);
    // From now on a message that arrives while away counts.
    rerender({ ...props, live: true, orderedMessages: [...present, msg('p-2')] });
    expect(result.current).toBe(1);
  });

  it('a detached window brought back to the present counts nothing', () => {
    const { result, rerender, props } = setup();
    rerender({ ...props, live: false, orderedMessages: [msg('old-1'), msg('old-2')] });
    rerender({ ...props, live: true, orderedMessages: [msg('n-1'), msg('n-2'), msg('n-3')] });
    expect(result.current).toBe(0);
  });
});
