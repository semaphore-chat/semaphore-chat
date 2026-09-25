/**
 * Phone (full-screen) thread layout: the original message scrolls with the
 * replies instead of being pinned above them, and the thread opens at the
 * top, so the first reply sits fully below the original message. The
 * tablet/desktop drawer keeps the pinned original message and still opens
 * scrolled to the newest loaded reply.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import { createMessage } from '../test-utils/factories';
import { ThreadPanel } from '../../components/Thread/ThreadPanel';
import type { Message } from '../../types/message.type';

const repliesState = vi.hoisted(() => ({
  replies: [] as Message[],
  isLoading: false,
  error: null as Error | null,
}));

vi.mock('../../hooks/useResponsive', () => ({
  useResponsive: () => ({ shouldUseTouchUI: true }),
}));
vi.mock('../../contexts/ThreadPanelContext', () => ({
  useThreadPanel: () => ({ openThreadId: 'p1', openThread: vi.fn(), closeThread: vi.fn() }),
}));
vi.mock('../../hooks/useThreadReplies', () => ({
  useThreadReplies: () => ({
    replies: repliesState.replies,
    continuationToken: null,
    isLoading: repliesState.isLoading,
    error: repliesState.error,
    refetch: vi.fn(),
  }),
}));
vi.mock('../../hooks/useThreadSubscription', () => ({
  useThreadSubscription: () => ({ isSubscribed: false, toggleSubscription: vi.fn() }),
}));
vi.mock('../../components/Message/MessageComponent', () => ({
  default: ({ message }: { message: { id: string } }) => <div data-testid={`message-${message.id}`}>{message.id}</div>,
}));
vi.mock('../../components/Thread/ThreadMessageInput', () => ({
  default: () => <div data-testid="thread-input" />,
}));

const parent = createMessage({ id: 'p1' });
const replies = [createMessage({ id: 'r1' }), createMessage({ id: 'r2' }), createMessage({ id: 'r3' })];
const scrollIntoView = vi.fn();

function precedes(a: Element, b: Element): boolean {
  return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

describe('ThreadPanel phone layout (first reply below the original message)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repliesState.replies = replies;
    repliesState.isLoading = false;
    repliesState.error = null;
    Element.prototype.scrollIntoView = scrollIntoView;
  });

  it('puts the original message inside the reply scroller, ahead of the first reply', () => {
    renderWithProviders(<ThreadPanel parentMessage={parent} channelId="ch1" fullScreen />);

    const scroller = screen.getByTestId('thread-scroll');
    const original = within(scroller).getByTestId('thread-original-message');
    expect(within(original).getByText('Original message')).toBeInTheDocument();
    expect(within(original).getByTestId('message-p1')).toBeInTheDocument();

    const firstReply = within(scroller).getByTestId('message-r1');
    // In the same scroll flow and before it: it can't sit on top of the reply.
    expect(original.contains(firstReply)).toBe(false);
    expect(precedes(original, firstReply)).toBe(true);
  });

  it('keeps the original message pinned above the scroller in the tablet/desktop drawer', () => {
    renderWithProviders(<ThreadPanel parentMessage={parent} channelId="ch1" />);

    const scroller = screen.getByTestId('thread-scroll');
    const original = screen.getByTestId('thread-original-message');
    expect(scroller.contains(original)).toBe(false);
    expect(precedes(original, scroller)).toBe(true);
    expect(within(scroller).getByTestId('message-r1')).toBeInTheDocument();
  });

  it('opens at the top on phones instead of scrolling to the last reply', () => {
    renderWithProviders(<ThreadPanel parentMessage={parent} channelId="ch1" fullScreen />);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('opens at the top on phones when the replies arrive after loading', () => {
    repliesState.replies = [];
    repliesState.isLoading = true;
    const { rerender } = renderWithProviders(<ThreadPanel parentMessage={parent} channelId="ch1" fullScreen />);

    repliesState.replies = replies;
    repliesState.isLoading = false;
    rerender(<ThreadPanel parentMessage={parent} channelId="ch1" fullScreen />);

    expect(screen.getByTestId('message-r1')).toBeInTheDocument();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('still scrolls down on phones when a new reply arrives after the thread opened', () => {
    const { rerender } = renderWithProviders(<ThreadPanel parentMessage={parent} channelId="ch1" fullScreen />);
    expect(scrollIntoView).not.toHaveBeenCalled();

    repliesState.replies = [...replies, createMessage({ id: 'r4' })];
    rerender(<ThreadPanel parentMessage={parent} channelId="ch1" fullScreen />);

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('opens a different thread at the top again on phones', () => {
    const { rerender } = renderWithProviders(<ThreadPanel parentMessage={parent} channelId="ch1" fullScreen />);

    repliesState.replies = [createMessage({ id: 'q1' })];
    rerender(<ThreadPanel parentMessage={createMessage({ id: 'p2' })} channelId="ch1" fullScreen />);

    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('opens at the top on phones when the replies arrive after a failed load and Retry', () => {
    repliesState.replies = [];
    repliesState.isLoading = true;
    const { rerender } = renderWithProviders(<ThreadPanel parentMessage={parent} channelId="ch1" fullScreen />);

    // First load fails: no data, not loading, error set.
    repliesState.isLoading = false;
    repliesState.error = new Error('500');
    rerender(<ThreadPanel parentMessage={parent} channelId="ch1" fullScreen />);

    // Retry: pending again (no data), then the replies arrive.
    repliesState.isLoading = true;
    repliesState.error = null;
    rerender(<ThreadPanel parentMessage={parent} channelId="ch1" fullScreen />);
    repliesState.replies = replies;
    repliesState.isLoading = false;
    rerender(<ThreadPanel parentMessage={parent} channelId="ch1" fullScreen />);

    expect(screen.getByTestId('message-r1')).toBeInTheDocument();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('does not scroll an open thread when the layout crosses the phone breakpoint', () => {
    const { rerender } = renderWithProviders(<ThreadPanel parentMessage={parent} channelId="ch1" fullScreen />);

    rerender(<ThreadPanel parentMessage={parent} channelId="ch1" />);
    rerender(<ThreadPanel parentMessage={parent} channelId="ch1" fullScreen />);

    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('keeps opening the drawer scrolled to the newest loaded reply', () => {
    renderWithProviders(<ThreadPanel parentMessage={parent} channelId="ch1" />);
    expect(scrollIntoView).toHaveBeenCalled();
  });
});
