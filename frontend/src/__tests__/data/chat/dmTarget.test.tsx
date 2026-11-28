/**
 * The Lounge's chat data hooks on a DM target (`{ kind: 'dm', dmGroupId }`), on the real hooks and the MSW API: the
 * conversation loads the group's messages and pages back, shows who is typing in the group, and marks the group
 * read; the composer keeps the old DM composer's draft, types to the group, offers the group's members to mention
 * and sends; edits and deletes land in the DM cache the conversation reads (the one the old shell uses too).
 */
import { createRef, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { ClientEvents, ServerEvents } from '@semaphore-chat/shared';
import { server } from '../../msw/server';
import { createTestQueryClient } from '../../test-utils/queryClient';
import { createMockSocket, type MockSocket } from '../../test-utils/mockSocket';
import { createMessage } from '../../test-utils/factories';
import { SocketContext } from '../../../utils/SocketContext';
import { SocketHubContext } from '../../../socket-hub/SocketHubContext';
import { createEventBus, type EventBus } from '../../../socket-hub/emitter';
import { dmMessagesQueryKey } from '../../../utils/messageQueryKeys';
import { clearComposerDrafts, useComposerDraft } from '../../../hooks/useComposerDraft';
import { SpanType, type Message } from '../../../types/message.type';
import { useConversation } from '../../../data/chat/useConversation';
import { useChannelComposer } from '../../../data/chat/useChannelComposer';
import { useMessageActions } from '../../../data/chat/useMessageActions';
import type { ChatTarget } from '../../../data/chat/chatTarget';
import type { NotificationDto } from '../../../api-client/types.gen';

vi.mock('../../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

const BASE = 'http://localhost:3000';
const DM = 'dm-1';
const TARGET: ChatTarget = { kind: 'dm', dmGroupId: DM };

/** A DM message as the API sends it (the factory's channel id cleared). */
function dmMessage(id: string, minute: number, extra: Partial<Message> = {}): Message {
  return createMessage({
    id,
    channelId: null as never,
    directMessageGroupId: DM,
    authorId: 'other-user-1',
    sentAt: new Date(Date.UTC(2026, 10, 20, 9, minute)).toISOString(),
    spans: [{ type: SpanType.PLAINTEXT, text: `text ${id}` }],
    ...extra,
  });
}

/** The group's message pages: newest first, as the API; `older` behind the continuation token. */
function servePages(newest: Message[], older: Message[] = []) {
  const requests: string[] = [];
  server.use(
    http.get(`${BASE}/api/messages/group/:groupId`, ({ params, request }) => {
      const url = new URL(request.url);
      requests.push(`${String(params.groupId)}?${url.searchParams.toString()}`);
      if (url.searchParams.get('continuationToken') === 'page-2') return HttpResponse.json({ messages: older, continuationToken: undefined });
      return HttpResponse.json({ messages: newest, continuationToken: older.length > 0 ? 'page-2' : undefined });
    }),
  );
  return requests;
}

/**
 * Every request the app sends, by path. A DM has no community, so none may contain `/community/`. Recorded from
 * `server.events` rather than from handlers: a leaked request goes to `/api/channels/community/` (no id), which a
 * `:communityId` handler never matches, so a handler-based watch could never see it.
 */
let requestPaths: string[];
let onRequestStart: ((event: { request: Request }) => void) | undefined;

let queryClient: QueryClient;
let socket: MockSocket;
let bus: EventBus;

/** The providers around a hook, at `entry`, as the app mounts them. */
function providerWrapper(entry: string) {
  return function ProviderWrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <SocketContext.Provider value={{ socket: socket as never, isConnected: true }}>
          <SocketHubContext.Provider value={bus}>
            <MemoryRouter initialEntries={[entry]}>{children}</MemoryRouter>
          </SocketHubContext.Provider>
        </SocketContext.Provider>
      </QueryClientProvider>
    );
  };
}

let wrapper: ({ children }: { children: ReactNode }) => ReactNode;

beforeEach(() => {
  queryClient = createTestQueryClient();
  socket = createMockSocket();
  bus = createEventBus();
  clearComposerDrafts();
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  wrapper = providerWrapper(`/direct-messages/${DM}`);

  requestPaths = [];
  onRequestStart = ({ request }) => {
    requestPaths.push(new URL(request.url).pathname);
  };
  server.events.on('request:start', onRequestStart);

  // The conversation reads notifications (and marks the DM's unread ones read): none by default.
  server.use(http.get(`${BASE}/api/notifications`, () => HttpResponse.json({ notifications: [], total: 0, unreadCount: 0 })));
});

afterEach(() => {
  if (onRequestStart) server.events.removeListener('request:start', onRequestStart);
  onRequestStart = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useConversation on a DM target', () => {
  it("loads the group's messages, oldest first, keyed by the group", async () => {
    const requests = servePages([dmMessage('m-2', 2), dmMessage('m-1', 1)]);
    const { result } = renderHook(() => useConversation({ target: TARGET }), { wrapper });

    await waitFor(() => expect(result.current.orderedMessages.map((m) => m.id)).toEqual(['m-1', 'm-2']));
    expect(requests[0]).toMatch(/^dm-1\?/);
    expect(result.current.list.resetKey).toBe(DM);
    expect(result.current.isLoading).toBe(false);
    // The classic shell's DM cache: one cache for both shells.
    expect(queryClient.getQueryData(dmMessagesQueryKey(DM))).toBeDefined();
  });

  it('pages back through the continuation token', async () => {
    const requests = servePages([dmMessage('m-4', 4), dmMessage('m-3', 3)], [dmMessage('m-2', 2), dmMessage('m-1', 1)]);
    const { result } = renderHook(() => useConversation({ target: TARGET }), { wrapper });
    await waitFor(() => expect(result.current.list.continuationToken).toBe('page-2'));

    await act(async () => {
      await result.current.list.onLoadMore?.();
    });

    await waitFor(() => expect(result.current.orderedMessages.map((m) => m.id)).toEqual(['m-1', 'm-2', 'm-3', 'm-4']));
    expect(requests.some((r) => r.includes('continuationToken=page-2'))).toBe(true);
    expect(result.current.list.continuationToken).toBeUndefined();
  });

  it("shows who is typing in this group only, not in a channel or another group", async () => {
    servePages([dmMessage('m-1', 1)]);
    const { result } = renderHook(() => useConversation({ target: TARGET }), { wrapper });
    await waitFor(() => expect(result.current.orderedMessages).toHaveLength(1));

    act(() => {
      bus.emit(ServerEvents.USER_TYPING, { userId: 'u-chan', channelId: DM, isTyping: true } as never);
      bus.emit(ServerEvents.USER_TYPING, { userId: 'u-other', directMessageGroupId: 'dm-2', isTyping: true } as never);
      bus.emit(ServerEvents.USER_TYPING, { userId: 'other-user-1', directMessageGroupId: DM, isTyping: true } as never);
    });
    expect(result.current.typingUserIds).toEqual(['other-user-1']);

    act(() => bus.emit(ServerEvents.USER_TYPING, { userId: 'other-user-1', directMessageGroupId: DM, isTyping: false } as never));
    expect(result.current.typingUserIds).toEqual([]);
  });

  it('marks the group read up to the newest message in view', async () => {
    servePages([dmMessage('m-2', 2), dmMessage('m-1', 1)]);
    const { result } = renderHook(() => useConversation({ target: TARGET }), { wrapper });
    await waitFor(() => expect(result.current.orderedMessages).toHaveLength(2));

    vi.useFakeTimers();
    act(() => result.current.list.onVisibleRangeChange(0, 1));
    act(() => vi.advanceTimersByTime(1100));

    expect(socket.emit).toHaveBeenCalledWith(ClientEvents.MARK_AS_READ, expect.objectContaining({ directMessageGroupId: DM, lastReadMessageId: 'm-2' }));
    expect(socket.emit).not.toHaveBeenCalledWith(ClientEvents.MARK_AS_READ, expect.objectContaining({ channelId: expect.anything() }));
  });

  it("reflects an edit and a delete made through the message actions (the same DM cache)", async () => {
    servePages([dmMessage('m-2', 2, { authorId: 'current-user-1' }), dmMessage('m-1', 1)]);
    server.use(
      http.patch(`${BASE}/api/messages/:id`, async ({ params, request }) => {
        const body = (await request.json()) as { spans: Message['spans'] };
        return HttpResponse.json(dmMessage(String(params.id), 2, { authorId: 'current-user-1', spans: body.spans, editedAt: new Date().toISOString() }));
      }),
      http.delete(`${BASE}/api/messages/:id`, () => HttpResponse.json({})),
    );
    const { result: conv } = renderHook(() => useConversation({ target: TARGET }), { wrapper });
    await waitFor(() => expect(conv.current.orderedMessages).toHaveLength(2));
    const mine = conv.current.orderedMessages[1];
    const { result: actions } = renderHook(() => useMessageActions(mine, 'current-user-1'), { wrapper });

    act(() => actions.current.handleEditClick());
    act(() => actions.current.setEditText('edited words'));
    await act(async () => {
      await actions.current.handleEditSave();
    });
    await waitFor(() => expect(conv.current.orderedMessages[1].spans[0].text).toBe('edited words'));

    await act(async () => {
      await actions.current.deleteMessage();
    });
    await waitFor(() => expect(conv.current.orderedMessages.map((m) => m.id)).toEqual(['m-1']));
  });

  it("marks the group's unread notifications read while the conversation is shown", async () => {
    servePages([dmMessage('m-1', 1)]);
    const marked: string[] = [];
    const notification: NotificationDto = {
      id: 'notif-1',
      userId: 'current-user-1',
      type: 'DIRECT_MESSAGE',
      messageId: 'm-1',
      channelId: null,
      directMessageGroupId: DM,
      communityId: null,
      authorId: 'other-user-1',
      parentMessageId: null,
      read: false,
      dismissed: false,
      createdAt: new Date(Date.UTC(2026, 10, 20, 9, 1)).toISOString(),
    };
    server.use(
      http.get(`${BASE}/api/notifications`, () => HttpResponse.json({ notifications: [notification], total: 1, unreadCount: 1 })),
      http.post(`${BASE}/api/notifications/:id/read`, ({ params }) => {
        marked.push(String(params.id));
        return HttpResponse.json({ ...notification, read: true });
      }),
    );
    const { result } = renderHook(() => useConversation({ target: TARGET }), { wrapper });
    await waitFor(() => expect(result.current.orderedMessages).toHaveLength(1));
    // The notification names this group, so the DM context marks it read (a channel context would not).
    await waitFor(() => expect(marked).toEqual(['notif-1']));
  });

  it('clears ?highlight= back to the DM screen path once the jump has settled', async () => {
    servePages([dmMessage('m-1', 1)]);
    const { result } = renderHook(
      () => {
        const location = useLocation();
        return {
          conversation: useConversation({ target: TARGET }),
          url: `${location.pathname}${location.search}`,
        };
      },
      { wrapper: providerWrapper(`/direct-messages/${DM}?highlight=m-1`) },
    );

    await waitFor(() => expect(result.current.conversation.orderedMessages).toHaveLength(1));
    await waitFor(() => expect(result.current.url).toBe(`/direct-messages/${DM}`));
  });

  it('sends no community query', async () => {
    servePages([dmMessage('m-1', 1)]);
    const { result } = renderHook(() => useConversation({ target: TARGET }), { wrapper });
    await waitFor(() => expect(result.current.orderedMessages).toHaveLength(1));
    expect(requestPaths.filter((path) => path.includes('/community/'))).toEqual([]);
  });
});

describe('useChannelComposer on a DM target', () => {
  function renderComposer(send = vi.fn(async () => undefined)) {
    const inputRef = createRef<HTMLTextAreaElement>();
    const field = document.createElement('textarea');
    document.body.appendChild(field);
    (inputRef as { current: HTMLTextAreaElement | null }).current = field;
    const onError = vi.fn();
    const view = renderHook(
      () => {
        const composer = useChannelComposer({ target: TARGET, inputRef, send, onError, touch: false });
        // The field shows the composer's text (a controlled field), before the composer places the caret.
        field.value = composer.text;
        return composer;
      },
      { wrapper },
    );
    /** Types `value` with the caret at its end. */
    const type = (value: string) =>
      act(() => {
        field.value = value;
        field.setSelectionRange(value.length, value.length);
        view.result.current.onChange(value);
      });
    return { ...view, send, onError, type, field };
  }

  it("is the old DM composer's draft (dm:<id>), shared across shells", () => {
    const { type, unmount } = renderComposer();
    type('half a thought');
    unmount();
    const { result } = renderHook(() => useComposerDraft(`dm:${DM}`), { wrapper });
    expect(result.current[0]).toBe('half a thought');
  });

  it('is always available, with files allowed and no notice', () => {
    const { result } = renderComposer();
    expect(result.current.canCompose).toBe(true);
    expect(result.current.notice).toBeNull();
    expect(result.current.attach.allowed).toBe(true);
  });

  it('types to the group', () => {
    const { type } = renderComposer();
    type('h');
    expect(socket.emit).toHaveBeenCalledWith(ClientEvents.TYPING_START, { directMessageGroupId: DM });
  });

  it("offers the group's members to mention and sends the mention as a span", async () => {
    const { result, type, send } = renderComposer();
    // The group (MSW: Test User and Other User) arrives with the first query.
    type('hi @oth');
    await waitFor(() => expect(result.current.mentions?.suggestions.map((s) => s.displayName)).toEqual(['Other User']));

    act(() => result.current.mentions!.pick(0));
    expect(result.current.text).toBe('hi @otheruser ');
    expect(result.current.mentions).toBeNull();

    await act(async () => {
      await result.current.send();
    });
    expect(send).toHaveBeenCalledTimes(1);
    const [content, spans, files] = send.mock.calls[0] as unknown as [string, Message['spans'], File[]];
    expect(content).toBe('hi @otheruser');
    expect(spans).toContainEqual(expect.objectContaining({ type: SpanType.USER_MENTION, userId: 'other-user-1' }));
    expect(files).toEqual([]);
    // Sent: the draft is gone and "typing" ended.
    expect(result.current.text).toBe('');
    expect(socket.emit).toHaveBeenCalledWith(ClientEvents.TYPING_STOP, { directMessageGroupId: DM });
    expect(requestPaths.filter((path) => path.includes('/community/'))).toEqual([]);
  });

  it('picks a mention with Enter from the keyboard', async () => {
    const { result, type } = renderComposer();
    type('@oth');
    await waitFor(() => expect(result.current.mentions).not.toBeNull());
    act(() => {
      const event = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
      result.current.onKeyDown({
        key: 'Enter',
        keyCode: 13,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        nativeEvent: event,
        defaultPrevented: false,
        preventDefault: () => undefined,
      } as never);
    });
    expect(result.current.text).toBe('@otheruser ');
  });
});
