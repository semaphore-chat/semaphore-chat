/**
 * Threads in the new shell's chat (PR 10d-B), on a faked conversation and thread: the replies button and "Reply in
 * thread" open the thread on the chat's own path (`?thread=`), the heading takes focus, Back closes it (a step back
 * when it was opened here, a replace on a cold link, `?highlight=` kept) and focus returns to the opener; Follow; the
 * channel underneath is covered (marks nothing read); a gone parent; the thread's own sheet (no Reply, no thread).
 */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { useLocation } from 'react-router-dom';
import { KitProvider } from '../../../kit';
import { FileCacheProvider } from '../../../contexts/AvatarCacheContext';
import { ChannelChat } from '../../../shell/lounge/screens/chat/ChannelChat';
import { LoungeLinksContext, type LoungeLinks } from '../../../shell/lounge/links';
import { FIXTURE_LINKS } from '../../../shell/lounge/screens/fixtureLinks';
import { ScreenChromeContext } from '../../../shell/lounge/screen';
import { forgetRouteMemory } from '../../../shell/routeMemory';
import type { Conversation } from '../../../data/chat/useConversation';
import {
  customEmojiControllerListCommunityEmojisQueryKey,
  moderationControllerGetPinnedMessagesQueryKey,
  channelsControllerFindAllForCommunityQueryKey,
  userControllerGetUserByIdQueryKey,
} from '../../../api-client/@tanstack/react-query.gen';
import { createChannel, createMessage, createTestQueryClient, renderWithProviders, resetFactoryCounter } from '../../test-utils';
import { SpanType } from '../../../types/message.type';

// The list's measured size: a thread longer than the screen is not at its bottom.
const vsize = vi.hoisted(() => ({ scroll: 0, viewport: 0 }));
vi.mock('virtua', async () => {
  const ReactMod = await import('react');
  return {
    VList: ReactMod.forwardRef((props: Record<string, unknown>, ref: React.Ref<unknown>) => {
      ReactMod.useImperativeHandle(ref, () => ({ scrollToIndex: () => undefined, findItemIndex: () => 0, get scrollSize() { return vsize.scroll; }, get viewportSize() { return vsize.viewport; } }), []);
      return (
        <div role={props.role as string} aria-label={props['aria-label'] as string}>
          {props.children as React.ReactNode}
        </div>
      );
    }),
  };
});

const conversation = vi.hoisted(() => ({ current: null as unknown as Conversation }));

// The reaction toggle and the permission it needs, so a chip's payload can be read.
const reactionClick = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('../../../data/chat/useMessageActions', () => ({ useMessageActions: () => ({ handleReactionClick: reactionClick }) }));
vi.mock('../../../hooks/useMessagePermissions', () => ({ useMessagePermissions: () => ({ canReact: true, canEdit: false, canDelete: false, canPin: false }) }));

// The thread: faked (its model has its own tests); the composer stands in (its thread mode has its own tests).
const threadModel = vi.hoisted(() => ({ current: null as unknown as Record<string, unknown>, calls: [] as { parentMessageId: string; parent?: unknown }[] }));
vi.mock('../../../data/chat/useThreadConversation', () => ({
  useThreadConversation: (options: { parentMessageId: string; parent?: unknown }) => {
    threadModel.calls.push(options);
    const parent = options.parent ?? threadModel.current.fetchedParent ?? null;
    return { ...threadModel.current, parent };
  },
}));
const pinned = vi.hoisted(() => ({ current: null as unknown as Record<string, unknown> }));
vi.mock('../../../data/chat/usePinnedList', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  usePinnedList: () => pinned.current,
}));
vi.mock('../../../shell/lounge/screens/chat/ChatComposer', () => ({
  ChatComposer: ({ thread }: { thread?: { parentMessageId: string } }) => (
    <textarea aria-label={thread ? `composer for thread ${thread.parentMessageId}` : 'channel composer'} />
  ),
}));

// Every navigate call the screen makes, so a test can tell a step back from a replace.
const navCalls = vi.hoisted(() => [] as unknown[][]);
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => {
      const real = actual.useNavigate();
      return (...args: Parameters<typeof real>) => {
        navCalls.push(args);
        return real(...(args as [never]));
      };
    },
  };
});

// Renders of kit rows (by author) and runs of toSegments: the row memo must hold.
const counts = vi.hoisted(() => ({ rows: new Map<string, number>(), colours: new Map<string, string | undefined>(), segments: 0 }));
vi.mock('../../../kit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../kit')>();
  const MessageRow = (props: Parameters<typeof actual.MessageRow>[0]) => {
    counts.rows.set(props.author, (counts.rows.get(props.author) ?? 0) + 1);
    counts.colours.set(props.author, props.avatarColour);
    return actual.MessageRow(props);
  };
  return { ...actual, MessageRow };
});
vi.mock('../../../data/chat/toSegments', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../data/chat/toSegments')>();
  return {
    ...actual,
    toSegments: (...args: Parameters<typeof actual.toSegments>) => {
      counts.segments += 1;
      return actual.toSegments(...args);
    },
  };
});
const conversationCalls: Array<{ chatPath?: string; covered?: boolean }> = [];
vi.mock('../../../data/chat/useConversation', () => ({
  useConversation: (options: { chatPath?: string; covered?: boolean }) => {
    conversationCalls.push(options);
    return conversation.current;
  },
}));

const FIXTURE_CHAT = '/__lounge/community/c-1/channel/ch-1';

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    me: 'me',
    orderedMessages: [],
    isLoading: false,
    error: null,
    listRef: { current: null },
    list: {
      mode: 'normal',
      isLoadingMore: false,
      unreadCount: 0,
      lastReadIndex: -1,
      resetKey: 'ch-1',
      onAtBottomChange: () => undefined,
      onVisibleRangeChange: () => undefined,
    },
    jump: { shown: false, newCount: 0, onJump: () => undefined },
    typingUserIds: [],
    announcement: '',
    ...overrides,
  };
}

function Where() {
  const location = useLocation();
  return <output data-testid="where">{location.pathname + location.search}</output>;
}

function setup({
  isPrivate = false,
  entries = [FIXTURE_CHAT],
  rightOpen = false,
  links = FIXTURE_LINKS as LoungeLinks,
  type = 'TEXT' as 'TEXT' | 'VOICE',
} = {}) {
  const queryClient = createTestQueryClient();
  queryClient.setQueryData(channelsControllerFindAllForCommunityQueryKey({ path: { communityId: 'c-1' } }), [
    createChannel({ id: 'ch-1', name: 'lobby', communityId: 'c-1', isPrivate, type }),
  ]);
  queryClient.setQueryData(userControllerGetUserByIdQueryKey({ path: { id: 'u-aiko' } }), {
    id: 'u-aiko',
    username: 'aiko',
    displayName: 'Aiko',
  });
  queryClient.setQueryData(customEmojiControllerListCommunityEmojisQueryKey({ path: { communityId: 'c-1' } }), [
    { id: 'e-1', name: 'partyparrot', fileId: 'f-9', communityId: 'c-1' },
  ]);
  const setRightOpen = vi.fn();
  const ui = () => (
    <FileCacheProvider>
    <KitProvider base="#8E75FF" mode="dark" intensity="minimal">
      <LoungeLinksContext value={links}>
        <ScreenChromeContext value={{ rightOpen, setRightOpen }}>
          <ChannelChat params={{ communityId: 'c-1', channelId: 'ch-1' }} />
          <Where />
        </ScreenChromeContext>
      </LoungeLinksContext>
    </KitProvider>
    </FileCacheProvider>
  );
  const view = renderWithProviders(ui(), {
    queryClient,
    routerProps: { initialEntries: entries, initialIndex: entries.length - 1 },
  });
  return { ...view, setRightOpen, rerenderSame: () => view.rerender(ui()) };
}

const where = () => screen.getByTestId('where').textContent;

const parent = () => createMessage({ id: 'm-1', channelId: 'ch-1', authorId: 'u-aiko', replyCount: 2, spans: [{ type: SpanType.PLAINTEXT, text: 'the parent' }] });
const reply = (id: string, text: string) => createMessage({ id, channelId: 'ch-1', parentMessageId: 'm-1', authorId: 'u-aiko', spans: [{ type: SpanType.PLAINTEXT, text }] });

function thread(overrides: Record<string, unknown> = {}) {
  threadModel.current = {
    replies: [reply('r-1', 'first reply'), reply('r-2', 'second reply')],
    continuationToken: undefined,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    loadMore: vi.fn(async () => undefined),
    isLoadingMore: false,
    isSubscribed: false,
    toggleSubscription: vi.fn(async () => undefined),
    parentLoading: false,
    parentError: null,
    ...overrides,
  };
}

const frames = () =>
  act(async () => {
    for (let i = 0; i < 4; i++) await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
  });

describe('ChannelChat threads', () => {
  beforeEach(() => {
    resetFactoryCounter();
    forgetRouteMemory();
    navCalls.length = 0;
    conversation.current = makeConversation({ orderedMessages: [parent()] });
    conversationCalls.length = 0;
    threadModel.calls.length = 0;
    vsize.scroll = 0;
    vsize.viewport = 0;
    thread();
  });

  /** The thread pane's live region (the channel's is under the cover). */
  const threadLive = () =>
    screen.getAllByRole('status', { hidden: true }).filter((el) => el.closest('[inert]') === null && el.getAttribute('aria-live') === 'polite');
  const BATCH_WINDOW_MS = 2000;

  it('a live reply while away from the bottom is announced; a loaded page of replies is not', async () => {
    vsize.scroll = 4000;
    vsize.viewport = 400;
    thread({ continuationToken: 'r-2', pagesLoaded: 0 });
    const { rerenderSame: rerender } = setup({ entries: [`${FIXTURE_CHAT}?thread=m-1`] });
    await screen.findByRole('heading', { level: 1, name: 'Thread' });
    // The list has measured itself: longer than the screen, so not at its bottom.
    await frames();
    // A page lands at the end (the reader scrolled near it).
    const page = Array.from({ length: 50 }, (_, i) => reply(`p-${i}`, `paged reply ${i}`));
    thread({ replies: [reply('r-1', 'first reply'), reply('r-2', 'second reply'), ...page], continuationToken: undefined, pagesLoaded: 1 });
    rerender();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, BATCH_WINDOW_MS + 300));
    });
    expect(threadLive().map((el) => el.textContent).join('')).toBe('');
    // A live reply (no page) is: the setup does announce.
    thread({ replies: [reply('r-1', 'first reply'), reply('r-2', 'second reply'), ...page, reply('r-live', 'just now')], continuationToken: undefined, pagesLoaded: 1 });
    rerender();
    await waitFor(() => expect(threadLive().map((el) => el.textContent).join('')).toContain('just now'), { timeout: BATCH_WINDOW_MS + 2000 });
  }, 15_000);

  it('the count under the parent is the thread’s real total, not the loaded replies', async () => {
    conversation.current = makeConversation({ orderedMessages: [{ ...parent(), replyCount: 120 }] });
    thread({ continuationToken: 'r-2' });
    setup({ entries: [`${FIXTURE_CHAT}?thread=m-1`] });
    expect(await screen.findByRole('separator', { name: '120 replies' })).toBeInTheDocument();
  });

  it('while the thread is open the channel underneath says nothing', async () => {
    conversation.current = makeConversation({ orderedMessages: [parent()], announcement: '2 new messages from aiko' });
    setup({ entries: [`${FIXTURE_CHAT}?thread=m-1`] });
    await screen.findByRole('heading', { level: 1, name: 'Thread' });
    expect(screen.queryByText('2 new messages from aiko')).toBeNull();
  });

  it('Escape closes the thread; an Escape the composer used (a mention list) does not', async () => {
    const { user } = setup();
    const button = screen.getByRole('button', { name: '2 replies, open the thread' });
    button.focus();
    fireEvent.click(button);
    const field = await screen.findByRole('textbox', { name: 'composer for thread m-1' });
    const owns = (event: KeyboardEvent) => {
      if (event.key === 'Escape') event.preventDefault();
    };
    field.addEventListener('keydown', owns);
    field.focus();
    await user.keyboard('{Escape}');
    expect(where()).toBe(`${FIXTURE_CHAT}?thread=m-1`);
    field.removeEventListener('keydown', owns);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(where()).toBe(FIXTURE_CHAT));
    await frames();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '2 replies, open the thread' }));
  });

  it('opening a thread while a jump has not settled leaves ?highlight= behind', () => {
    setup({ entries: [`${FIXTURE_CHAT}?highlight=m-1`] });
    fireEvent.click(screen.getByRole('button', { name: '2 replies, open the thread' }));
    expect(where()).toBe(`${FIXTURE_CHAT}?thread=m-1`);
  });

  it('a message from a DM (no channel) is not this channel’s thread', async () => {
    conversation.current = makeConversation({ orderedMessages: [] });
    thread({ fetchedParent: createMessage({ id: 'm-9', channelId: null, directMessageGroupId: 'dm-1' }) });
    setup({ entries: [`${FIXTURE_CHAT}?thread=m-9`] });
    expect(await screen.findByRole('heading', { name: 'This thread is gone' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /composer for thread/ })).toBeNull();
  });

  it('"2 replies" opens the thread on the chat’s path; its heading takes focus; the channel is covered', async () => {
    setup();
    const button = screen.getByRole('button', { name: '2 replies, open the thread' });
    button.focus();
    fireEvent.click(button);
    expect(where()).toBe(`${FIXTURE_CHAT}?thread=m-1`);
    const heading = await screen.findByRole('heading', { level: 1, name: 'Thread' });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    // The parent from the channel's window, live (not fetched); then the count and the replies.
    expect(threadModel.calls[threadModel.calls.length - 1]).toEqual(expect.objectContaining({ parentMessageId: 'm-1', parent: expect.objectContaining({ id: 'm-1' }) }));
    expect(screen.getByRole('separator', { name: '2 replies' })).toBeInTheDocument();
    expect(screen.getByText('first reply')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'composer for thread m-1' })).toBeInTheDocument();
    // Underneath: inert, and told it is covered (nothing marked read).
    expect(document.querySelector('textarea[aria-label="channel composer"]')?.closest('[inert]')).not.toBeNull();
    expect(conversationCalls[conversationCalls.length - 1]?.covered).toBe(true);
  });

  it('Back steps back when the thread was opened here, and focus returns to the replies button', async () => {
    setup();
    const button = screen.getByRole('button', { name: '2 replies, open the thread' });
    button.focus();
    fireEvent.click(button);
    navCalls.length = 0;
    fireEvent.click(await screen.findByRole('button', { name: 'Back to # lobby' }));
    expect(navCalls).toEqual([[-1]]);
    await waitFor(() => expect(where()).toBe(FIXTURE_CHAT));
    await frames();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '2 replies, open the thread' }));
    expect(conversationCalls[conversationCalls.length - 1]?.covered).toBe(false);
  });

  it('a cold link with ?highlight= and ?thread=: the thread shows, Back replaces and keeps the channel’s highlight', async () => {
    setup({ entries: [`${FIXTURE_CHAT}?highlight=m-1&thread=m-1`] });
    expect(await screen.findByRole('heading', { level: 1, name: 'Thread' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to # lobby' }));
    expect(navCalls).toEqual([[`${FIXTURE_CHAT}?highlight=m-1`, { replace: true }]]);
    await frames();
    // No opener on a cold link: the parent's row takes focus, never the page.
    expect(document.activeElement?.closest('[data-message-id="m-1"]')).not.toBeNull();
  });

  it('a parent not in the channel’s window is fetched by id; a gone one says so with Back', async () => {
    conversation.current = makeConversation({ orderedMessages: [] });
    thread({ parentError: { status: 404 } });
    setup({ entries: [`${FIXTURE_CHAT}?thread=m-9`] });
    expect(threadModel.calls[threadModel.calls.length - 1]).toEqual({ parentMessageId: 'm-9', parent: null });
    expect(await screen.findByRole('heading', { name: 'This thread is gone' })).toBeInTheDocument();
    // The header's Back and the state's own.
    fireEvent.click(screen.getAllByRole('button', { name: 'Back to # lobby' })[1]);
    expect(navCalls[navCalls.length - 1]).toEqual([FIXTURE_CHAT, { replace: true }]);
  });

  it('a parent from another channel is not this channel’s thread', async () => {
    conversation.current = makeConversation({ orderedMessages: [] });
    thread({ fetchedParent: createMessage({ id: 'm-9', channelId: 'elsewhere' }) });
    setup({ entries: [`${FIXTURE_CHAT}?thread=m-9`] });
    expect(await screen.findByRole('heading', { name: 'This thread is gone' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /composer for thread/ })).toBeNull();
  });

  it('Follow toggles the subscription and says whether it is on', async () => {
    thread({ isSubscribed: true });
    setup({ entries: [`${FIXTURE_CHAT}?thread=m-1`] });
    const follow = await screen.findByRole('button', { name: 'Follow thread' });
    expect(follow).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(follow);
    expect(threadModel.current.toggleSubscription).toHaveBeenCalledTimes(1);
  });

  it('a channel not known to be a text channel: no composer and no Follow in the thread', async () => {
    setup({ entries: [`${FIXTURE_CHAT}?thread=m-1`], type: 'VOICE' });
    // A voice channel has no chat at all (and so no thread).
    expect(screen.queryByRole('heading', { level: 1, name: 'Thread' })).toBeNull();
  });

  it('loading and error states', async () => {
    thread({ isLoading: true, replies: [] });
    const { unmount } = setup({ entries: [`${FIXTURE_CHAT}?thread=m-1`] });
    expect(await screen.findByText('Loading the thread')).toBeInTheDocument();
    unmount();
    thread({ error: new Error('down'), replies: [] });
    setup({ entries: [`${FIXTURE_CHAT}?thread=m-1`] });
    expect(await screen.findByRole('heading', { name: "Couldn't load replies" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(threadModel.current.refetch).toHaveBeenCalled();
  });

  it('an empty thread says so under its parent', async () => {
    conversation.current = makeConversation({ orderedMessages: [{ ...parent(), replyCount: 0 }] });
    thread({ replies: [] });
    setup({ entries: [`${FIXTURE_CHAT}?thread=m-1`] });
    expect(await screen.findByRole('separator', { name: 'No replies yet' })).toBeInTheDocument();
  });

  it('"Reply in thread" in a row’s actions opens its thread; inside the thread there is no Reply and no thread', async () => {
    conversation.current = makeConversation({ orderedMessages: [createMessage({ id: 'm-1', channelId: 'ch-1', authorId: 'u-aiko', replyCount: 0, spans: [{ type: SpanType.PLAINTEXT, text: 'start one' }] })] });
    thread({ replies: [] });
    setup();
    const row = screen.getByText('start one').closest('[data-row-focus-target]') as HTMLElement;
    row.focus();
    fireEvent.keyDown(row, { key: 'Enter' });
    fireEvent.click(await screen.findByRole('button', { name: 'Reply in thread' }));
    await waitFor(() => expect(where()).toBe(`${FIXTURE_CHAT}?thread=m-1`));
    const heading = await screen.findByRole('heading', { level: 1, name: 'Thread' });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    // The parent's actions inside the thread.
    const inThread = screen.getAllByText('start one').map((node) => node.closest('[data-row-focus-target]') as HTMLElement).find((el) => el.closest('[inert]') === null)!;
    inThread.focus();
    fireEvent.keyDown(inThread, { key: 'Enter' });
    const sheet = await screen.findByRole('dialog');
    expect(sheet).not.toHaveTextContent('Reply in thread');
    expect(screen.queryByRole('button', { name: 'Reply' })).toBeNull();
  });
});

const pin = (id: string, text: string, parentMessageId: string | null = null) => ({
  ...createMessage({ id, channelId: 'ch-1', authorId: 'u-aiko', spans: [{ type: SpanType.PLAINTEXT, text }] }),
  parentMessageId,
  author: { id: 'u-aiko', username: 'aiko', displayName: 'Aiko', avatarUrl: null },
});

describe('ChannelChat pinned messages', () => {
  beforeEach(() => {
    resetFactoryCounter();
    forgetRouteMemory();
    navCalls.length = 0;
    conversation.current = makeConversation({ orderedMessages: [parent()] });
    thread();
    vsize.scroll = 0;
    vsize.viewport = 0;
    pinned.current = {
      pins: [pin('m-5', 'pinned words'), pin('r-7', 'a pinned reply', 'm-1')],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
      canUnpin: false,
      unpin: vi.fn(async () => true),
    };
  });

  async function openPinned(user: ReturnType<typeof setup>['user'], queryClient: ReturnType<typeof setup>['queryClient']) {
    queryClient.setQueryData(moderationControllerGetPinnedMessagesQueryKey({ path: { channelId: 'ch-1' } }), pinned.current.pins);
    await user.click(screen.getByRole('button', { name: 'More' }));
    await user.click(await screen.findByRole('menuitem', { name: /Pinned messages/ }));
    return screen.findByRole('dialog', { name: /Pinned messages/ });
  }

  it('More lists the pins; a pin jumps to its message, replacing the entry; focus is never on the page', async () => {
    const { user, queryClient } = setup();
    const sheet = await openPinned(user, queryClient);
    expect(sheet).toHaveAccessibleName('Pinned messages (2)');
    expect(screen.queryByRole('button', { name: /Unpin/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: /Show the message from Aiko: pinned words/ }));
    await waitFor(() => expect(where()).toBe(`${FIXTURE_CHAT}?highlight=m-5`));
    expect(navCalls[navCalls.length - 1]).toEqual([`${FIXTURE_CHAT}?highlight=m-5`, { replace: true }]);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await frames();
    expect(document.activeElement).not.toBe(document.body);
  });

  it('a pinned thread reply jumps to its parent and opens its thread, in a new entry', async () => {
    const { user, queryClient } = setup();
    await openPinned(user, queryClient);
    await user.click(screen.getByRole('button', { name: /a pinned reply/ }));
    await waitFor(() => expect(where()).toBe(`${FIXTURE_CHAT}?highlight=m-1&thread=m-1`));
    expect(await screen.findByRole('heading', { level: 1, name: 'Thread' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to # lobby' }));
    expect(navCalls[navCalls.length - 1]).toEqual([-1]);
  });

  it('a moderator may unpin; a failed unpin says so', async () => {
    pinned.current = { ...pinned.current, canUnpin: true, unpin: vi.fn(async () => false) };
    const { user, queryClient } = setup();
    await openPinned(user, queryClient);
    await user.click(screen.getAllByRole('button', { name: 'Unpin the message from Aiko' })[0]);
    expect(pinned.current.unpin).toHaveBeenCalledWith('m-5');
    expect(await screen.findByText("Couldn't unpin the message")).toBeInTheDocument();
  });

  it('a moderator gets Unpin on every pin of a text channel', async () => {
    pinned.current = { ...pinned.current, canUnpin: true };
    const { user, queryClient } = setup();
    await openPinned(user, queryClient);
    expect(screen.getAllByRole('button', { name: /Unpin/ })).toHaveLength(2);
  });

  it('empty, loading and error', async () => {
    pinned.current = { ...pinned.current, pins: [] };
    const first = setup();
    await openPinned(first.user, first.queryClient);
    expect(screen.getByText('No pinned messages yet.')).toBeInTheDocument();
    first.unmount();
    pinned.current = { ...pinned.current, pins: undefined, isLoading: true };
    const second = setup();
    await openPinned(second.user, second.queryClient);
    expect(screen.getByText('Loading pinned messages')).toBeInTheDocument();
    second.unmount();
    pinned.current = { ...pinned.current, pins: undefined, isLoading: false, error: new Error('down') };
    const third = setup();
    await openPinned(third.user, third.queryClient);
    await third.user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(pinned.current.refetch).toHaveBeenCalled();
  });
});
