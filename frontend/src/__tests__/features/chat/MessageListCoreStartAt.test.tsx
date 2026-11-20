/**
 * MessageListCore opened at its first row (`startAt="start"`, the thread view: parent first): where it opens, the
 * Tab stop, newer pages near the end in normal mode, and no following the bottom while a newer page exists.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import MessageListCore, { type MessageRowContext } from '../../../features/chat/MessageListCore';
import { createMessage, resetFactoryCounter } from '../../test-utils/factories';
import type { Message } from '../../../types/message.type';

const fake = vi.hoisted(() => ({
  handle: {
    scrollToIndex: vi.fn(),
    findItemIndex: vi.fn((offset: number) => (offset >= 600 ? 9 : 0)),
    scrollSize: 1000,
    viewportSize: 400,
  },
  onScroll: null as null | ((offset: number) => void),
}));
vi.mock('virtua', async () => {
  const ReactMod = await import('react');
  return {
    VList: ReactMod.forwardRef((props: Record<string, unknown>, ref: React.Ref<unknown>) => {
      ReactMod.useImperativeHandle(ref, () => fake.handle, []);
      fake.onScroll = props.onScroll as (offset: number) => void;
      return <div role={props.role as string}>{props.children as React.ReactNode}</div>;
    }),
  };
});

function renderRow(message: Message, ctx: MessageRowContext) {
  return (
    <div role="button" data-testid={`row-${message.id}`} data-row-focus-target tabIndex={ctx.isRovingFocused ? 0 : -1}>
      {message.id}
    </div>
  );
}

const messages = (n: number) => Array.from({ length: n }, (_, i) => createMessage({ id: `m${i}` }));
const frames = async () => {
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))));
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
  });
};

describe('MessageListCore startAt="start"', () => {
  const base = { isLoadingMore: false, unreadCount: 0, lastReadIndex: -1, renderRow };

  beforeEach(() => {
    resetFactoryCounter();
    fake.handle.scrollToIndex.mockClear();
    fake.handle.scrollSize = 1000;
  });

  it('opens at the first row, with the Tab stop on it', async () => {
    render(<MessageListCore {...base} orderedMessages={messages(10)} startAt="start" />);
    await frames();
    expect(fake.handle.scrollToIndex).toHaveBeenCalledWith(0, { align: 'start' });
    expect(fake.handle.scrollToIndex).not.toHaveBeenCalledWith(9, { align: 'end' });
    expect(screen.getByTestId('row-m0')).toHaveAttribute('tabindex', '0');
    expect(screen.getByTestId('row-m9')).toHaveAttribute('tabindex', '-1');
  });

  it('loads a newer page near the end in normal mode; the default list never does', async () => {
    const onLoadNewer = vi.fn(async () => undefined);
    const { rerender } = render(
      <MessageListCore {...base} orderedMessages={messages(10)} startAt="start" hasNewer onLoadNewer={onLoadNewer} />,
    );
    await frames();
    act(() => fake.onScroll?.(600));
    expect(onLoadNewer).toHaveBeenCalledTimes(1);

    onLoadNewer.mockClear();
    rerender(<MessageListCore {...base} orderedMessages={messages(10)} resetKey="other" hasNewer onLoadNewer={onLoadNewer} />);
    await frames();
    act(() => fake.onScroll?.(600));
    expect(onLoadNewer).not.toHaveBeenCalled();
  });

  it('a short thread follows a new reply to the bottom; with a newer page to load it does not', async () => {
    fake.handle.scrollSize = 400; // everything fits: pinned
    const { rerender } = render(<MessageListCore {...base} orderedMessages={messages(3)} startAt="start" />);
    await frames();
    fake.handle.scrollToIndex.mockClear();
    rerender(<MessageListCore {...base} orderedMessages={messages(4)} startAt="start" />);
    await frames();
    expect(fake.handle.scrollToIndex).toHaveBeenCalledWith(3, { align: 'end' });

    fake.handle.scrollToIndex.mockClear();
    rerender(<MessageListCore {...base} orderedMessages={messages(5)} startAt="start" hasNewer />);
    await frames();
    expect(fake.handle.scrollToIndex).not.toHaveBeenCalledWith(4, { align: 'end' });
  });
});
