/**
 * Search in the new shell's chat at compact and wide (PR 10e, B9), on a faked conversation and search: More → Search
 * opens the panel in the members' place (the right Sheet at compact) with focus in the field; a phone keeps the old
 * search screen; pins and search are one at a time; a result jumps (`?highlight=`) and the panel stays; a result in
 * another channel opens that channel's chat with the panel, its text and focus on the result; a thread reply opens its
 * parent's thread, and closing the thread brings the search back; Close hands focus to More.
 */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { KitProvider } from '../../../kit';
import { FileCacheProvider } from '../../../contexts/AvatarCacheContext';
import { ChannelChat } from '../../../shell/lounge/screens/chat/ChannelChat';
import { LoungeLinksContext, type LoungeLinks } from '../../../shell/lounge/links';
import { FIXTURE_LINKS } from '../../../shell/lounge/screens/fixtureLinks';
import { NO_SCREEN_CHROME, ScreenChromeContext, type RightPanel } from '../../../shell/lounge/screen';
import { mockViewport, WIDTH } from '../../kit/layout/matchMedia';
import { forgetRouteMemory } from '../../../shell/routeMemory';
import type { Conversation } from '../../../data/chat/useConversation';
import {
  channelsControllerFindAllForCommunityQueryKey,
  moderationControllerGetPinnedMessagesQueryKey,
  userControllerGetUserByIdQueryKey,
} from '../../../api-client/@tanstack/react-query.gen';
import { createChannel, createMessage, createTestQueryClient, renderWithProviders, resetFactoryCounter } from '../../test-utils';
import { SpanType } from '../../../types/message.type';
import { SearchScope, type SearchResult } from '../../../hooks/useMessageSearch';

vi.mock('virtua', async () => {
  const ReactMod = await import('react');
  return {
    VList: ReactMod.forwardRef((props: Record<string, unknown>, ref: React.Ref<unknown>) => {
      ReactMod.useImperativeHandle(ref, () => ({ scrollToIndex: () => undefined, findItemIndex: () => 0, scrollSize: 0, viewportSize: 0 }), []);
      return <div role={props.role as string}>{props.children as React.ReactNode}</div>;
    }),
  };
});

const conversation = vi.hoisted(() => ({ current: null as unknown as Conversation }));
vi.mock('../../../data/chat/useConversation', () => ({ useConversation: () => conversation.current }));
vi.mock('../../../data/chat/useMessageActions', () => ({ useMessageActions: () => ({ handleReactionClick: vi.fn() }) }));
vi.mock('../../../hooks/useMessagePermissions', () => ({ useMessagePermissions: () => ({ canReact: true, canEdit: false, canDelete: false, canPin: false }) }));
vi.mock('../../../data/chat/useThreadConversation', () => ({
  useThreadConversation: () => ({
    replies: [],
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
    parent: createMessage({ id: 'm-1', channelId: 'ch-1', authorId: 'u-aiko', spans: [{ type: SpanType.PLAINTEXT, text: 'the parent' }] }),
  }),
}));
vi.mock('../../../data/chat/usePinnedList', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  usePinnedList: () => ({ pins: [], isLoading: false, error: null, refetch: vi.fn(), canUnpin: false, unpin: vi.fn() }),
}));
vi.mock('../../../shell/lounge/screens/chat/ChatComposer', () => ({
  ChatComposer: ({ thread }: { thread?: unknown }) => <textarea aria-label={thread ? 'thread composer' : 'channel composer'} />,
}));
// The query runs at once (the debounce is the old search's own hook).
vi.mock('../../../hooks/useDebounce', () => ({ useDebounce: <T,>(value: T) => value }));

// The search: what each query asked for, and what it answers.
const searchState = vi.hoisted(() => ({
  calls: [] as { channelId: string; communityId: string; query: string; scope: string }[],
  results: [] as unknown[],
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
}));
vi.mock('../../../hooks/useMessageSearch', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMessageSearch: (args: { channelId: string; communityId: string; query: string; scope: string }) => {
    searchState.calls.push(args);
    const has = args.query.trim() !== '';
    return {
      results: has ? searchState.results : [],
      isLoading: has && searchState.isLoading,
      isError: has && searchState.isError,
      refetch: searchState.refetch,
    };
  },
}));

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

const CHAT = '/__lounge/community/c-1/channel/ch-1';
const OTHER = '/__lounge/community/c-1/channel/ch-2';

function makeConversation(): Conversation {
  return {
    me: 'me',
    orderedMessages: [createMessage({ id: 'm-1', channelId: 'ch-1', authorId: 'u-aiko', replyCount: 1, spans: [{ type: SpanType.PLAINTEXT, text: 'the parent' }] })],
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
  };
}

const result = (id: string, text: string, extra: Partial<SearchResult> = {}): SearchResult =>
  ({
    ...createMessage({ id, channelId: 'ch-1', authorId: 'u-aiko', spans: [{ type: SpanType.PLAINTEXT, text }] }),
    ...extra,
  }) as SearchResult;

/** Another channel chosen elsewhere (the left island's list). */
function GoElsewhere() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(OTHER)}>
      go to random
    </button>
  );
}

function Where() {
  const location = useLocation();
  return <output data-testid="where">{location.pathname + location.search}</output>;
}

/** The frame's right region, as in the thread tests: the screen's panel in a real slot inside an `aside`. */
const lastPanel = vi.hoisted(() => ({ current: null as RightPanel | null }));
function PanelChrome({ children }: { children: React.ReactNode }) {
  const [panel, setPanel] = React.useState<RightPanel | null>(null);
  const [target, setTarget] = React.useState<HTMLElement | null>(null);
  lastPanel.current = panel;
  // As the frame's `showRight`: the screen's `closeAll` when it has one, else `onClose`.
  const panelRef = React.useRef(panel);
  panelRef.current = panel;
  const showRight = React.useCallback(() => {
    const open = panelRef.current;
    (open?.closeAll ?? open?.onClose)?.();
  }, []);
  const chrome = React.useMemo(
    () => ({ ...NO_SCREEN_CHROME, rightOpen: true, showRight, panel, setPanel, panelTarget: panel === null ? null : target }),
    [panel, target, showRight],
  );
  return (
    <ScreenChromeContext value={chrome}>
      {children}
      <aside aria-label={panel?.label ?? 'Members'}>{panel === null ? <span>the members</span> : <div ref={setTarget} />}</aside>
    </ScreenChromeContext>
  );
}

/** The chat for the route's channel, as the frame mounts it (one screen element across channels). */
function RoutedChat() {
  const params = useParams();
  return <ChannelChat params={{ communityId: params.communityId, channelId: params.channelId }} />;
}

function setup(entries: string[] = [CHAT]) {
  const queryClient = createTestQueryClient();
  queryClient.setQueryData(channelsControllerFindAllForCommunityQueryKey({ path: { communityId: 'c-1' } }), [
    createChannel({ id: 'ch-1', name: 'lobby', communityId: 'c-1' }),
    createChannel({ id: 'ch-2', name: 'random', communityId: 'c-1' }),
  ]);
  queryClient.setQueryData(moderationControllerGetPinnedMessagesQueryKey({ path: { channelId: 'ch-1' } }), []);
  queryClient.setQueryData(userControllerGetUserByIdQueryKey({ path: { id: 'u-aiko' } }), { id: 'u-aiko', username: 'aiko', displayName: 'Aiko' });
  return renderWithProviders(
    <FileCacheProvider>
      <KitProvider base="#8E75FF" mode="dark" intensity="minimal">
        <LoungeLinksContext value={FIXTURE_LINKS as LoungeLinks}>
          <PanelChrome>
            <Routes>
              <Route path="/__lounge/community/:communityId/channel/:channelId" element={<RoutedChat />} />
            </Routes>
            <Where />
            <GoElsewhere />
          </PanelChrome>
        </LoungeLinksContext>
      </KitProvider>
    </FileCacheProvider>,
    { queryClient, routerProps: { initialEntries: entries, initialIndex: entries.length - 1 } },
  );
}

const where = () => screen.getByTestId('where').textContent;
const rightRegion = () => screen.getByRole('complementary');

async function openSearch(user: ReturnType<typeof setup>['user']) {
  await user.click(screen.getByRole('button', { name: 'More' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Search messages' }));
  return screen.findByRole('searchbox', { name: 'Search messages' });
}

describe('ChannelChat search (compact and wide)', () => {
  beforeEach(() => {
    mockViewport(WIDTH.wide);
    resetFactoryCounter();
    forgetRouteMemory();
    navCalls.length = 0;
    lastPanel.current = null;
    conversation.current = makeConversation();
    searchState.calls.length = 0;
    searchState.results = [result('m-5', 'the deploy is green'), result('m-6', 'deploy again')];
    searchState.isLoading = false;
    searchState.isError = false;
  });

  it('at wide More → Search opens the panel in the members’ place with focus in the field; Close hands focus to More', async () => {
    const { user } = setup();
    const field = await openSearch(user);
    expect(rightRegion()).toHaveAccessibleName('Search messages');
    expect(rightRegion()).toContainElement(field);
    expect(lastPanel.current).toMatchObject({ label: 'Search messages', fill: true });
    await waitFor(() => expect(document.activeElement).toBe(field));
    // The address does not change: the old search screen is a phone's.
    expect(where()).toBe(CHAT);
    await user.click(screen.getByRole('button', { name: 'Close search' }));
    await waitFor(() => expect(lastPanel.current).toBeNull());
    expect(rightRegion()).toHaveAccessibleName('Members');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'More' })));
  });

  it("the frame's close request (Escape at wide, the Sheet's close below) closes it", async () => {
    const { user } = setup();
    await openSearch(user);
    act(() => lastPanel.current!.onClose());
    await waitFor(() => expect(lastPanel.current).toBeNull());
  });

  it('at compact it is the panel too (the right Sheet)', async () => {
    mockViewport(WIDTH.compact);
    const { user } = setup();
    await openSearch(user);
    expect(lastPanel.current).toMatchObject({ label: 'Search messages', fill: true });
  });

  it('on a phone Search is the old search screen', async () => {
    mockViewport(WIDTH.phone);
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'More' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Search messages' }));
    await waitFor(() => expect(where()).toBe('/community/c-1/channel/ch-1/search'));
    expect(lastPanel.current).toBeNull();
  });

  it('searches this channel, then all channels; the results name their channel in the community scope', async () => {
    searchState.results = [result('m-7', 'deploy notes', { channelId: 'ch-2', channelName: 'random' })];
    const { user } = setup();
    const field = await openSearch(user);
    expect(screen.getByText('Search the messages in this channel.')).toBeInTheDocument();
    await user.type(field, 'deploy');
    expect(searchState.calls[searchState.calls.length - 1]).toMatchObject({ channelId: 'ch-1', communityId: 'c-1', query: 'deploy', scope: SearchScope.Channel });
    await user.click(screen.getByRole('tab', { name: 'All channels' }));
    expect(searchState.calls[searchState.calls.length - 1]).toMatchObject({ query: 'deploy', scope: SearchScope.Community });
    expect(screen.getByRole('button', { name: /Show the message from Aiko in #random: deploy notes/ })).toBeInTheDocument();
  });

  it('a result in this channel jumps (replacing the entry) and the panel stays, focus on the result', async () => {
    const { user } = setup();
    const field = await openSearch(user);
    await user.type(field, 'deploy');
    const row = screen.getByRole('button', { name: /Show the message from Aiko: the deploy is green/ });
    await user.click(row);
    await waitFor(() => expect(where()).toBe(`${CHAT}?highlight=m-5`));
    expect(navCalls[navCalls.length - 1]).toEqual([`${CHAT}?highlight=m-5`, { replace: true }]);
    expect(lastPanel.current).toMatchObject({ label: 'Search messages' });
    expect(document.activeElement).toBe(row);
  });

  it('↓ from the field reaches the results, ↑/↓ move, Enter opens one; Enter in the field opens the first', async () => {
    const { user } = setup();
    const field = await openSearch(user);
    await user.type(field, 'deploy');
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toHaveAccessibleName(/the deploy is green/);
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toHaveAccessibleName(/deploy again/);
    await user.keyboard('{Enter}');
    await waitFor(() => expect(where()).toBe(`${CHAT}?highlight=m-6`));
    field.focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(where()).toBe(`${CHAT}?highlight=m-5`));
  });

  it('a result in another channel opens that chat (a new entry) with the panel still open, its text kept, focus on the result', async () => {
    searchState.results = [result('m-7', 'deploy notes', { channelId: 'ch-2', channelName: 'random' })];
    const { user } = setup();
    const field = await openSearch(user);
    await user.type(field, 'deploy');
    await user.click(screen.getByRole('tab', { name: 'All channels' }));
    await user.click(screen.getByRole('button', { name: /deploy notes/ }));
    await waitFor(() => expect(where()).toBe(`${OTHER}?highlight=m-7`));
    expect(navCalls[navCalls.length - 1]).toEqual([`${OTHER}?highlight=m-7`, undefined]);
    expect(await screen.findByRole('heading', { level: 1, name: '# random' })).toBeInTheDocument();
    expect(lastPanel.current).toMatchObject({ label: 'Search messages' });
    expect(screen.getByRole('searchbox', { name: 'Search messages' })).toHaveValue('deploy');
    expect(screen.getByRole('tab', { name: 'All channels' })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(document.activeElement).toHaveAccessibleName(/deploy notes/));
    // Close: focus goes to this chat's own More.
    await user.click(screen.getByRole('button', { name: 'Close search' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'More' })));
  });

  it('closed and opened again: a new search', async () => {
    const { user } = setup();
    let field = await openSearch(user);
    await user.type(field, 'deploy');
    await user.click(screen.getByRole('button', { name: 'Close search' }));
    await waitFor(() => expect(lastPanel.current).toBeNull());
    field = await openSearch(user);
    expect(field).toHaveValue('');
  });

  it('a thread reply opens its parent’s thread over the search; closing the thread brings the search back, focus on the result', async () => {
    searchState.results = [result('r-1', 'a reply about deploys', { parentMessageId: 'm-1' })];
    const { user } = setup();
    const field = await openSearch(user);
    await user.type(field, 'deploy');
    await user.click(screen.getByRole('button', { name: /a reply about deploys/ }));
    await waitFor(() => expect(where()).toBe(`${CHAT}?highlight=m-1&thread=m-1`));
    expect(navCalls[navCalls.length - 1]).toEqual([`${CHAT}?highlight=m-1&thread=m-1`, { state: { threadFrom: CHAT } }]);
    expect(await screen.findByRole('heading', { level: 2, name: 'Thread' })).toBeInTheDocument();
    expect(lastPanel.current).toMatchObject({ label: 'Thread' });
    await user.click(screen.getByRole('button', { name: 'Close thread' }));
    await waitFor(() => expect(where()).toBe(CHAT));
    await waitFor(() => expect(lastPanel.current).toMatchObject({ label: 'Search messages' }));
    expect(screen.getByRole('searchbox', { name: 'Search messages' })).toHaveValue('deploy');
    await waitFor(() => expect(document.activeElement).toHaveAccessibleName(/a reply about deploys/));
  });

  it('pins and search are one at a time', async () => {
    const { user } = setup();
    await openSearch(user);
    await user.click(screen.getByRole('button', { name: 'More' }));
    await user.click(await screen.findByRole('menuitem', { name: /Pinned messages/ }));
    await waitFor(() => expect(lastPanel.current).toMatchObject({ label: 'Pinned messages' }));
    expect(screen.queryByRole('searchbox')).toBeNull();
    await openSearch(user);
    expect(lastPanel.current).toMatchObject({ label: 'Search messages' });
    expect(screen.queryByRole('heading', { name: /Pinned messages/ })).toBeNull();
  });

  it('no results offers all channels; an error has Try again; a slow search says so', async () => {
    searchState.results = [];
    const { user } = setup();
    const field = await openSearch(user);
    await user.type(field, 'nothing');
    expect(screen.getByText('No messages found')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Search all channels' }));
    expect(screen.getByRole('tab', { name: 'All channels' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('button', { name: 'Search all channels' })).toBeNull();

    searchState.isError = true;
    fireEvent.change(field, { target: { value: 'nothing!' } });
    expect(await screen.findByText("Couldn't search messages")).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(searchState.refetch).toHaveBeenCalled();

    searchState.isError = false;
    searchState.isLoading = true;
    fireEvent.change(field, { target: { value: 'slow' } });
    expect(await screen.findByText('Searching')).toBeInTheDocument();
  });

  it('a thread reply in another channel opens that chat with its thread; closing it replaces the address', async () => {
    searchState.results = [result('r-9', 'a reply in random', { channelId: 'ch-2', channelName: 'random', parentMessageId: 'm-8' })];
    const { user } = setup();
    const field = await openSearch(user);
    await user.type(field, 'reply');
    await user.click(screen.getByRole('tab', { name: 'All channels' }));
    await user.click(screen.getByRole('button', { name: /a reply in random/ }));
    await waitFor(() => expect(where()).toBe(`${OTHER}?highlight=m-8&thread=m-8`));
    expect(navCalls[navCalls.length - 1]).toEqual([`${OTHER}?highlight=m-8&thread=m-8`, undefined]);
    await user.click(await screen.findByRole('button', { name: 'Close thread' }));
    expect(navCalls[navCalls.length - 1]).toEqual([`${OTHER}?highlight=m-8`, { replace: true }]);
    await waitFor(() => expect(lastPanel.current).toMatchObject({ label: 'Search messages' }));
  });

  const settleFrames = () =>
    act(async () => {
      for (let i = 0; i < 3; i++) await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    });

  it('a thread reply result, then a channel picked from the list, leaves focus in the list', async () => {
    searchState.results = [result('r-1', 'a reply about deploys', { parentMessageId: 'm-1' })];
    const { user } = setup();
    const field = await openSearch(user);
    await user.type(field, 'deploy');
    await user.click(screen.getByRole('button', { name: /a reply about deploys/ }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Thread' })).toBeInTheDocument();
    const go = screen.getByRole('button', { name: 'go to random' });
    await user.click(go);
    expect(await screen.findByRole('heading', { level: 1, name: '# random' })).toBeInTheDocument();
    await waitFor(() => expect(lastPanel.current).toMatchObject({ label: 'Search messages' }));
    await settleFrames();
    expect(document.activeElement).toBe(go);
  });

  it('Search chosen again while open focuses the field (nothing is armed); a channel change after that does not, and a thread from the list returns focus to its opener', async () => {
    const { user } = setup();
    const field = await openSearch(user);
    await user.type(field, 'deploy');
    const tab = screen.getByRole('tab', { name: 'All channels' });
    await user.click(tab);
    expect(document.activeElement).toBe(tab);
    await user.click(screen.getByRole('button', { name: 'More' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Search messages' }));
    await waitFor(() => expect(document.activeElement).toBe(field));
    // Nothing is armed: a channel picked from the list leaves focus there.
    const go = screen.getByRole('button', { name: 'go to random' });
    await user.click(go);
    expect(await screen.findByRole('heading', { level: 1, name: '# random' })).toBeInTheDocument();
    await settleFrames();
    expect(document.activeElement).toBe(go);
    // A thread opened from the message list, then closed: focus goes back to its opener, not the search.
    const replies = screen.getByRole('button', { name: /1 reply, open the thread/ });
    replies.focus();
    await user.click(replies);
    expect(await screen.findByRole('heading', { level: 2, name: 'Thread' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close thread' }));
    await waitFor(() => expect(lastPanel.current).toMatchObject({ label: 'Search messages' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: /1 reply, open the thread/ })));
  });

  it('More → Search with a thread in the panel closes the thread so the search shows at once, focus in its field', async () => {
    const { user } = setup([CHAT, `${CHAT}?thread=m-1`]);
    expect(await screen.findByRole('heading', { level: 2, name: 'Thread' })).toBeInTheDocument();
    const field = await openSearch(user);
    expect(where()).toBe(CHAT);
    expect(lastPanel.current).toMatchObject({ label: 'Search messages' });
    await waitFor(() => expect(document.activeElement).toBe(field));
  });

  it('More → Pinned messages with a thread in the panel closes the thread so the pins show', async () => {
    const { user } = setup([CHAT, `${CHAT}?thread=m-1`]);
    expect(await screen.findByRole('heading', { level: 2, name: 'Thread' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'More' }));
    await user.click(await screen.findByRole('menuitem', { name: /Pinned messages/ }));
    await waitFor(() => expect(lastPanel.current).toMatchObject({ label: 'Pinned messages' }));
    expect(where()).toBe(CHAT);
  });

  it('Members over a thread opened from a search result closes search and thread: the members show, focus on the toggle', async () => {
    searchState.results = [result('r-1', 'a reply about deploys', { parentMessageId: 'm-1' })];
    const { user } = setup();
    const field = await openSearch(user);
    await user.type(field, 'deploy');
    await user.click(screen.getByRole('button', { name: /a reply about deploys/ }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Thread' })).toBeInTheDocument();
    const members = screen.getByRole('button', { name: 'Members' });
    await user.click(members);
    await waitFor(() => expect(lastPanel.current).toBeNull());
    expect(where()).toBe(CHAT);
    expect(rightRegion()).toHaveAccessibleName('Members');
    expect(screen.queryByRole('searchbox')).toBeNull();
    await settleFrames();
    expect(document.activeElement).toBe(members);
  });

  it('an IME’s Enter (composing, or keyCode 229) in the field does not open a result', async () => {
    const { user } = setup();
    const field = await openSearch(user);
    await user.type(field, 'deploy');
    fireEvent.keyDown(field, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(field, { key: 'Enter', keyCode: 229 });
    expect(navCalls.filter((call) => String(call[0]).includes('highlight'))).toHaveLength(0);
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(where()).toBe(`${CHAT}?highlight=m-5`));
  });

  it('another channel chosen from the list keeps the search open without taking focus', async () => {
    const { user } = setup();
    const field = await openSearch(user);
    await user.type(field, 'deploy');
    const go = screen.getByRole('button', { name: 'go to random' });
    await user.click(go);
    expect(await screen.findByRole('heading', { level: 1, name: '# random' })).toBeInTheDocument();
    expect(lastPanel.current).toMatchObject({ label: 'Search messages' });
    expect(searchState.calls[searchState.calls.length - 1]).toMatchObject({ channelId: 'ch-2', query: 'deploy' });
    await act(async () => {
      for (let i = 0; i < 3; i++) await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    });
    expect(document.activeElement).toBe(go);
  });
});
