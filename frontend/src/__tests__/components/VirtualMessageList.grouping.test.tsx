import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import VirtualMessageList from '../../components/Message/VirtualMessageList';
import { createMessage, resetFactoryCounter } from '../test-utils/factories';
import type { Message } from '../../types/message.type';

vi.mock('virtua', async () => {
  const ReactMod = await import('react');
  return {
    VList: ReactMod.forwardRef((props: Record<string, unknown>, ref: React.Ref<unknown>) => {
      ReactMod.useImperativeHandle(
        ref,
        () => ({
          scrollToIndex: vi.fn(),
          findItemIndex: vi.fn(() => 0),
          scrollSize: 1000,
          viewportSize: 400,
        }),
        [],
      );
      return <div data-testid="vlist">{props.children as React.ReactNode}</div>;
    }),
  };
});

vi.mock('../../components/Message/MessageComponent', () => ({
  default: ({ message, grouped }: { message: { id: string }; grouped?: boolean }) => (
    <div data-testid={`msg-${message.id}`} data-grouped={grouped ? 'true' : 'false'} />
  ),
}));
vi.mock('../../components/Message/MessageSkeleton', () => ({
  default: () => <div data-testid="message-skeleton" />,
}));
vi.mock('../../components/Message/UnreadMessageDivider', () => ({
  UnreadMessageDivider: () => <div data-testid="unread-divider" />,
}));

const baseProps = {
  authorId: 'me',
  isLoadingMore: false,
  unreadCount: 0,
  lastReadIndex: -1,
};

const at = (day: number, h: number, m: number) => new Date(2026, 8, day, h, m).toISOString();

function groupedOf(id: string) {
  return screen.getByTestId(`msg-${id}`).getAttribute('data-grouped');
}

beforeEach(() => {
  resetFactoryCounter();
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('VirtualMessageList grouping and day separators', () => {
  const run: Message[] = [
    createMessage({ id: 'a1', authorId: 'u1', sentAt: at(21, 23, 50) }),
    createMessage({ id: 'a2', authorId: 'u1', sentAt: at(21, 23, 52) }),
    // Day change within 5 minutes of a2 — not grouped.
    createMessage({ id: 'a3', authorId: 'u1', sentAt: at(22, 0, 1) }),
    createMessage({ id: 'a4', authorId: 'u1', sentAt: at(22, 0, 3) }),
    // Different author.
    createMessage({ id: 'b1', authorId: 'u2', sentAt: at(22, 0, 4) }),
    // Same author as b1 but 20 minutes later.
    createMessage({ id: 'b2', authorId: 'u2', sentAt: at(22, 0, 24) }),
    // Quote reply.
    createMessage({
      id: 'b3',
      authorId: 'u2',
      sentAt: at(22, 0, 25),
      replyToId: 'a1',
      replyTo: { id: 'a1', authorId: 'u1', spans: [], sentAt: at(21, 23, 50) },
    }),
  ];

  it('passes grouped for same-author runs and breaks on day, author, gap and reply', () => {
    render(<VirtualMessageList {...baseProps} orderedMessages={run} />);

    expect(groupedOf('a1')).toBe('false');
    expect(groupedOf('a2')).toBe('true');
    expect(groupedOf('a3')).toBe('false');
    expect(groupedOf('a4')).toBe('true');
    expect(groupedOf('b1')).toBe('false');
    expect(groupedOf('b2')).toBe('false');
    expect(groupedOf('b3')).toBe('false');
  });

  it('inserts a day separator before the first message and at each day change', () => {
    render(<VirtualMessageList {...baseProps} orderedMessages={run} />);

    const separators = screen.getAllByRole('separator');
    expect(separators).toHaveLength(2);

    const a1Row = document.querySelector('[data-message-id="a1"]') as HTMLElement;
    const a3Row = document.querySelector('[data-message-id="a3"]') as HTMLElement;
    expect(within(a1Row).getByRole('separator')).toBeInTheDocument();
    expect(within(a3Row).getByRole('separator')).toBeInTheDocument();
    expect(within(document.querySelector('[data-message-id="a2"]') as HTMLElement).queryByRole('separator')).toBeNull();
  });

  it('does not group the first unread message with the one before the divider', () => {
    const msgs = [
      createMessage({ id: 'r1', authorId: 'u1', sentAt: at(22, 10, 0) }),
      createMessage({ id: 'r2', authorId: 'u1', sentAt: at(22, 10, 1) }),
    ];
    render(<VirtualMessageList {...baseProps} orderedMessages={msgs} unreadCount={1} lastReadIndex={0} />);

    expect(screen.getByTestId('unread-divider')).toBeInTheDocument();
    expect(groupedOf('r2')).toBe('false');
  });
});
