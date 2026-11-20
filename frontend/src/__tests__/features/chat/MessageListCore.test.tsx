import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import MessageListCore, {
  type MessageListCoreHandle,
  type MessageRowContext,
} from '../../../features/chat/MessageListCore';
import { createMessage, resetFactoryCounter } from '../../test-utils/factories';
import type { Message } from '../../../types/message.type';

// jsdom has no layout: VList renders its children into a plain div and
// exposes a controllable handle.
const fakeHandle = {
  scrollToIndex: vi.fn(),
  findItemIndex: vi.fn(() => 0),
  scrollSize: 1000,
  viewportSize: 400,
};
vi.mock('virtua', async () => {
  const ReactMod = await import('react');
  return {
    VList: ReactMod.forwardRef((props: Record<string, unknown>, ref: React.Ref<unknown>) => {
      ReactMod.useImperativeHandle(ref, () => fakeHandle, []);
      return (
        <div data-testid="vlist" role={props.role as string} aria-label={props['aria-label'] as string}>
          {props.children as React.ReactNode}
        </div>
      );
    }),
  };
});

/** A plain-div row: no MUI, no classic components. */
function renderRow(message: Message, ctx: MessageRowContext) {
  return (
    <>
      {ctx.showDaySeparator && <div data-testid={`day-${message.id}`} />}
      {ctx.showUnreadDivider && <div data-testid="unread">{ctx.unreadCount} new</div>}
      <div
        role="button"
        data-testid={`row-${message.id}`}
        data-row-focus-target
        data-grouped={ctx.grouped}
        data-highlighted={ctx.isHighlighted}
        tabIndex={ctx.isRovingFocused ? 0 : -1}
        onKeyDown={(event) => ctx.onRovingKeyDown(event, ctx.index)}
        onFocus={() => ctx.onRovingFocus(ctx.index)}
      >
        {message.id}
      </div>
    </>
  );
}

const sentAt = (minute: number) => new Date(2026, 10, 16, 9, minute).toISOString();

describe('MessageListCore', () => {
  beforeEach(() => {
    resetFactoryCounter();
    fakeHandle.scrollToIndex.mockClear();
  });

  const baseProps = { isLoadingMore: false, unreadCount: 0, lastReadIndex: -1, renderRow };

  it('renders each message through renderRow inside a listitem of the "Messages" list', () => {
    const messages = [createMessage({ id: 'a' }), createMessage({ id: 'b' })];
    render(<MessageListCore {...baseProps} orderedMessages={messages} />);

    expect(screen.getByRole('list', { name: 'Messages' })).toBeInTheDocument();
    const items = screen.getAllByRole('listitem');
    expect(items.map((item) => item.getAttribute('data-message-id'))).toEqual(['a', 'b']);
    expect(screen.getByTestId('row-a').closest('[role="listitem"]')).toBe(items[0]);
    // The typing-indicator spacer sits in the newest row only.
    expect(items[1].querySelector('[data-testid="typing-indicator-spacer"]')).not.toBeNull();
    expect(items[0].querySelector('[data-testid="typing-indicator-spacer"]')).toBeNull();
  });

  it('passes grouping, the day separator, the unread divider and the highlight in ctx', () => {
    const messages = [
      createMessage({ id: 'a', authorId: 'u-1', sentAt: sentAt(0) }),
      createMessage({ id: 'b', authorId: 'u-1', sentAt: sentAt(1) }),
      createMessage({ id: 'c', authorId: 'u-1', sentAt: sentAt(2) }),
      createMessage({ id: 'd', authorId: 'u-1', sentAt: sentAt(3) }),
    ];
    render(
      <MessageListCore
        {...baseProps}
        orderedMessages={messages}
        unreadCount={2}
        lastReadIndex={1}
        highlightMessageId="d"
        highlightSeq={1}
      />,
    );

    expect(screen.getByTestId('day-a')).toBeInTheDocument();
    expect(screen.queryByTestId('day-b')).toBeNull();
    expect(screen.getByTestId('row-a').dataset.grouped).toBe('false');
    expect(screen.getByTestId('row-b').dataset.grouped).toBe('true');
    // The divider goes above the first unread and breaks the run.
    expect(screen.getByTestId('unread')).toHaveTextContent('2 new');
    expect(screen.getByTestId('unread').closest('[role="listitem"]')?.getAttribute('data-message-id')).toBe('c');
    expect(screen.getByTestId('row-c').dataset.grouped).toBe('false');
    expect(screen.getByTestId('row-d').dataset.grouped).toBe('true');
    expect(screen.getByTestId('row-d').dataset.highlighted).toBe('true');
    expect(screen.getByTestId('row-a').dataset.highlighted).toBe('false');
  });

  it('shows the page-load indicators from the render props only while loading', () => {
    const messages = [createMessage({ id: 'a' })];
    const props = {
      ...baseProps,
      orderedMessages: messages,
      renderLoadingOlder: () => <div data-testid="older" />,
      renderLoadingNewer: () => <div data-testid="newer" />,
    };
    const { rerender } = render(<MessageListCore {...props} />);
    expect(screen.queryByTestId('older')).toBeNull();
    expect(screen.queryByTestId('newer')).toBeNull();

    rerender(<MessageListCore {...props} isLoadingMore isLoadingNewer />);
    expect(screen.getByTestId('older')).toBeInTheDocument();
    expect(screen.getByTestId('newer')).toBeInTheDocument();
  });

  it('keeps one Tab stop on the newest row and moves it with the arrow keys', async () => {
    const messages = [createMessage({ id: 'a' }), createMessage({ id: 'b' }), createMessage({ id: 'c' })];
    render(<MessageListCore {...baseProps} orderedMessages={messages} />);

    expect(screen.getByTestId('row-c')).toHaveAttribute('tabindex', '0');
    expect(screen.getByTestId('row-a')).toHaveAttribute('tabindex', '-1');

    const row = screen.getByTestId('row-c');
    act(() => row.focus());
    fireEvent.keyDown(row, { key: 'ArrowUp' });
    await vi.waitFor(() => expect(screen.getByTestId('row-b')).toHaveFocus());
    expect(screen.getByTestId('row-b')).toHaveAttribute('tabindex', '0');
    expect(fakeHandle.scrollToIndex).toHaveBeenCalledWith(1, { align: 'nearest' });
  });

  it('calls onEscapeToInput on Escape in a row', () => {
    const onEscapeToInput = vi.fn();
    render(<MessageListCore {...baseProps} orderedMessages={[createMessage({ id: 'a' })]} onEscapeToInput={onEscapeToInput} />);

    fireEvent.keyDown(screen.getByTestId('row-a'), { key: 'Escape' });
    expect(onEscapeToInput).toHaveBeenCalledTimes(1);
  });

  it('keeps the imperative handle: scrollToBottom and scrollToMessage', () => {
    const ref = React.createRef<MessageListCoreHandle>();
    const messages = [createMessage({ id: 'a' }), createMessage({ id: 'b' }), createMessage({ id: 'c' })];
    render(<MessageListCore {...baseProps} ref={ref} orderedMessages={messages} />);
    fakeHandle.scrollToIndex.mockClear();

    act(() => ref.current!.scrollToBottom());
    expect(fakeHandle.scrollToIndex).toHaveBeenLastCalledWith(2, { align: 'end' });

    act(() => ref.current!.scrollToMessage('b'));
    expect(fakeHandle.scrollToIndex).toHaveBeenLastCalledWith(1, { align: 'nearest' });

    fakeHandle.scrollToIndex.mockClear();
    act(() => ref.current!.scrollToMessage('missing'));
    expect(fakeHandle.scrollToIndex).not.toHaveBeenCalled();
  });
});
