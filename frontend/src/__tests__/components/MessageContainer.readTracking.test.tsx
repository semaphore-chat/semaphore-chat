/**
 * Read tracking end to end, from the list's geometry to the socket:
 * MessageContainer + the real VirtualMessageList + the real
 * useMessageVisibility (optimistic unread clear, 1 s debounced emit,
 * background-tab stash). Only virtua (no layout in jsdom), the row renderer
 * and the unread-divider lookup are mocked.
 *
 * MessageContainer.test.tsx covers the range -> markAsRead mapping with the
 * list mocked, and VirtualMessageList.test.tsx the range reporting itself.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from '@testing-library/react';
import { ClientEvents } from '@semaphore-chat/shared';
import { renderWithProviders } from '../test-utils';
import { createTestQueryClient } from '../test-utils/queryClient';
import { createMockSocket, type MockSocket } from '../test-utils/mockSocket';
import { createMessage, resetFactoryCounter } from '../test-utils/factories';
import MessageContainer from '../../components/Message/MessageContainer';
import { readReceiptsControllerGetUnreadCountsQueryKey } from '../../api-client/@tanstack/react-query.gen';
import type { UnreadCountDto } from '../../api-client';
import type { QueryClient } from '@tanstack/react-query';

// ── Mock virtua's VList (see VirtualMessageList.test.tsx) ──────────────
type FakeHandle = {
  scrollToIndex: ReturnType<typeof vi.fn>;
  findItemIndex: ReturnType<typeof vi.fn>;
  scrollOffset: number;
  scrollSize: number;
  viewportSize: number;
};

let capturedProps: { onScroll?: (offset: number) => void } = {};
let fakeHandle: FakeHandle;

vi.mock('virtua', async () => {
  const ReactMod = await import('react');
  return {
    VList: ReactMod.forwardRef(
      (props: Record<string, unknown>, ref: React.Ref<unknown>) => {
        capturedProps = props as typeof capturedProps;
        ReactMod.useImperativeHandle(ref, () => fakeHandle, []);
        return <div data-testid="vlist">{props.children as React.ReactNode}</div>;
      },
    ),
  };
});

vi.mock('../../components/Message/MessageComponent', () => ({
  default: ({ message }: { message: { id: string } }) => (
    <div data-testid={`msg-${message.id}`}>message-{message.id}</div>
  ),
}));

vi.mock('../../hooks/useReadReceipts', () => ({
  useReadReceipts: () => ({
    lastReadMessageId: () => undefined,
    unreadCount: () => 0,
  }),
}));

// ── Helpers ────────────────────────────────────────────────────────────
const DM_ID = 'dm-1';

/** Newest-first, like useMessages returns them: dm-msg-2 is the newest. */
const shortConversation = () =>
  [2, 1, 0].map((i) => createMessage({ id: `dm-msg-${i}`, directMessageGroupId: DM_ID, channelId: null }));

const unreadKey = readReceiptsControllerGetUnreadCountsQueryKey();

function setTabState(focused: boolean, visibility: DocumentVisibilityState) {
  vi.spyOn(document, 'hasFocus').mockReturnValue(focused);
  Object.defineProperty(document, 'visibilityState', { value: visibility, configurable: true });
}

let socket: MockSocket;
let queryClient: QueryClient;

function renderConversation(messages = shortConversation()) {
  return renderWithProviders(
    <MessageContainer
      messages={messages}
      isLoading={false}
      error={null}
      authorId="me"
      isLoadingMore={false}
      messageInput={<div />}
      directMessageGroupId={DM_ID}
    />,
    { socket, queryClient },
  );
}

const markAsReadEmits = () =>
  socket.emit.mock.calls.filter(([event]) => event === ClientEvents.MARK_AS_READ);

const dmUnread = () =>
  queryClient.getQueryData<UnreadCountDto[]>(unreadKey)?.find((c) => c.directMessageGroupId === DM_ID);

beforeEach(() => {
  vi.useFakeTimers();
  resetFactoryCounter();
  capturedProps = {};
  fakeHandle = {
    scrollToIndex: vi.fn(),
    findItemIndex: vi.fn(() => 0),
    scrollOffset: 0,
    // Three short messages fit the viewport: virtua's scrollSize is
    // max(content, viewport), so equal sizes mean there's nothing to scroll.
    scrollSize: 600,
    viewportSize: 600,
  };
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
  socket = createMockSocket();
  queryClient = createTestQueryClient();
  queryClient.setQueryData<UnreadCountDto[]>(unreadKey, [
    { directMessageGroupId: DM_ID, unreadCount: 3, mentionCount: 0 } as UnreadCountDto,
  ]);
  setTabState(true, 'visible');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('MessageContainer read tracking (real list + visibility hook)', () => {
  it('marks a short conversation read on open, without any scrolling', () => {
    renderConversation();

    // Optimistic: the badge clears right away.
    expect(dmUnread()).toMatchObject({ unreadCount: 0, lastReadMessageId: 'dm-msg-2' });

    // Debounced emit with the newest message.
    expect(markAsReadEmits()).toHaveLength(0);
    act(() => vi.advanceTimersByTime(1000));
    expect(markAsReadEmits()).toEqual([
      [ClientEvents.MARK_AS_READ, { lastReadMessageId: 'dm-msg-2', directMessageGroupId: DM_ID }],
    ]);
  });

  it('does not mark read while the tab is in the background, and catches up on focus', () => {
    setTabState(false, 'hidden');
    renderConversation();
    act(() => vi.advanceTimersByTime(1000));

    expect(markAsReadEmits()).toHaveLength(0);
    expect(dmUnread()).toMatchObject({ unreadCount: 3 });

    setTabState(true, 'visible');
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    act(() => vi.advanceTimersByTime(1000));

    expect(dmUnread()).toMatchObject({ unreadCount: 0 });
    expect(markAsReadEmits()).toEqual([
      [ClientEvents.MARK_AS_READ, { lastReadMessageId: 'dm-msg-2', directMessageGroupId: DM_ID }],
    ]);
  });

  it('leaves a conversation that overflows the viewport to the scroll path', () => {
    fakeHandle.scrollSize = 2000;
    const long = Array.from({ length: 40 }, (_, i) =>
      createMessage({ id: `dm-msg-${39 - i}`, directMessageGroupId: DM_ID, channelId: null }),
    );
    renderConversation(long);
    act(() => vi.advanceTimersByTime(1000));
    expect(markAsReadEmits()).toHaveLength(0);
    expect(dmUnread()).toMatchObject({ unreadCount: 3 });

    // The initial scroll to the bottom reports the range (last index 39).
    fakeHandle.findItemIndex = vi.fn().mockReturnValueOnce(30).mockReturnValueOnce(39);
    act(() => capturedProps.onScroll?.(1400));
    act(() => vi.advanceTimersByTime(1000));
    expect(markAsReadEmits()).toEqual([
      [ClientEvents.MARK_AS_READ, { lastReadMessageId: 'dm-msg-39', directMessageGroupId: DM_ID }],
    ]);
  });
});
