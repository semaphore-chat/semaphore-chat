/**
 * The new shell's chat screen (PR 10c-1), on a faked conversation: what it shows for each state, its header, Back,
 * Jump to latest, the typing line and the rows. The conversation's behaviour is the shared layer's own (its hooks
 * have their own tests); here only the screen's wiring is checked.
 */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { useLocation } from 'react-router-dom';
import { KitProvider } from '../../../kit';
import { FileCacheProvider } from '../../../contexts/AvatarCacheContext';
import { ChannelChat } from '../../../shell/lounge/screens/chat/ChannelChat';
import { LoungeLinksContext } from '../../../shell/lounge/links';
import { FIXTURE_LINKS } from '../../../shell/lounge/screens/fixtureLinks';
import { ScreenChromeContext } from '../../../shell/lounge/screen';
import { forgetRouteMemory, notePathname } from '../../../shell/routeMemory';
import type { Conversation } from '../../../data/chat/useConversation';
import {
  channelsControllerFindAllForCommunityQueryKey,
  userControllerGetUserByIdQueryKey,
} from '../../../api-client/@tanstack/react-query.gen';
import { createChannel, createMessage, createTestQueryClient, renderWithProviders, resetFactoryCounter } from '../../test-utils';
import { SpanType } from '../../../types/message.type';

vi.mock('virtua', async () => {
  const ReactMod = await import('react');
  return {
    VList: ReactMod.forwardRef((props: Record<string, unknown>, ref: React.Ref<unknown>) => {
      ReactMod.useImperativeHandle(ref, () => ({ scrollToIndex: () => undefined, findItemIndex: () => 0, scrollSize: 0, viewportSize: 0 }), []);
      return (
        <div role={props.role as string} aria-label={props['aria-label'] as string}>
          {props.children as React.ReactNode}
        </div>
      );
    }),
  };
});

const conversation = vi.hoisted(() => ({ current: null as unknown as Conversation }));
vi.mock('../../../data/chat/useConversation', () => ({ useConversation: () => conversation.current }));

const FIXTURE_CHAT = '/__lounge/community/c-1/channel/ch-1';
const FIXTURE_HOME = '/__lounge/community/c-1';

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

function setup({ isPrivate = false, entries = [FIXTURE_CHAT], rightOpen = false } = {}) {
  const queryClient = createTestQueryClient();
  queryClient.setQueryData(channelsControllerFindAllForCommunityQueryKey({ path: { communityId: 'c-1' } }), [
    createChannel({ id: 'ch-1', name: 'lobby', communityId: 'c-1', isPrivate }),
  ]);
  queryClient.setQueryData(userControllerGetUserByIdQueryKey({ path: { id: 'u-aiko' } }), {
    id: 'u-aiko',
    username: 'aiko',
    displayName: 'Aiko',
  });
  const setRightOpen = vi.fn();
  const view = renderWithProviders(
    <FileCacheProvider>
    <KitProvider base="#8E75FF" mode="dark" intensity="minimal">
      <LoungeLinksContext value={FIXTURE_LINKS}>
        <ScreenChromeContext value={{ rightOpen, setRightOpen }}>
          <ChannelChat params={{ communityId: 'c-1', channelId: 'ch-1' }} />
          <Where />
        </ScreenChromeContext>
      </LoungeLinksContext>
    </KitProvider>
    </FileCacheProvider>,
    { queryClient, routerProps: { initialEntries: entries, initialIndex: entries.length - 1 } },
  );
  return { ...view, setRightOpen };
}

const where = () => screen.getByTestId('where').textContent;

describe('ChannelChat (the new shell’s chat, read side)', () => {
  beforeEach(() => {
    resetFactoryCounter();
    forgetRouteMemory();
    conversation.current = makeConversation();
  });

  it('the header is the channel’s heading, with a lock for a private channel', () => {
    setup({ isPrivate: true });
    expect(screen.getByRole('heading', { level: 1, name: '# lobby' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Private channel' })).toBeInTheDocument();
  });

  it('loading shows skeleton rows and says so', () => {
    conversation.current = makeConversation({ isLoading: true });
    setup();
    expect(screen.getByText('Loading messages')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Messages' })).toBeNull();
  });

  it('an empty channel invites the first message', () => {
    setup();
    expect(screen.getByRole('heading', { name: 'No messages yet.' })).toBeInTheDocument();
  });

  it.each([
    [404, 'Channel not found'],
    [403, "You don't have access to this channel"],
  ])('a %s says why and leads back to the community', (status, title) => {
    conversation.current = makeConversation({ error: { status } });
    setup();
    expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Go to the community' }));
    expect(where()).toBe(FIXTURE_HOME);
  });

  it('another error offers Try again', () => {
    conversation.current = makeConversation({ error: new Error('network') });
    setup();
    expect(screen.getByRole('heading', { name: "Couldn't load messages" })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('draws the messages as kit rows with day and unread separators', () => {
    conversation.current = makeConversation({
      orderedMessages: [
        createMessage({ id: 'm-1', authorId: 'u-aiko', spans: [{ type: SpanType.PLAINTEXT, text: 'first' }] }),
        createMessage({ id: 'm-2', authorId: 'u-aiko', spans: [{ type: SpanType.PLAINTEXT, text: 'second' }] }),
      ],
      list: { ...makeConversation().list, unreadCount: 1, lastReadIndex: 0 },
    });
    setup();
    expect(screen.getByRole('list', { name: 'Messages' })).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(screen.getByText('first')).toBeInTheDocument();
    expect(screen.getByRole('separator', { name: 'New' })).toBeInTheDocument();
    expect(screen.getByRole('separator', { name: 'Today' })).toBeInTheDocument();
    // The list's one Tab stop is a row, and it is the roving focus target.
    expect(screen.getAllByRole('article').filter((row) => row.getAttribute('tabindex') === '0')).toHaveLength(1);
    expect(screen.getAllByRole('article')[0]).toHaveAttribute('data-row-focus-target', 'true');
  });

  it('a replies count is plain text, not a control (threads are not built yet)', () => {
    conversation.current = makeConversation({ orderedMessages: [createMessage({ id: 'm-1', replyCount: 3 })] });
    setup();
    expect(screen.getByText('3 replies')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /replies/ })).toBeNull();
  });

  it('a reply’s quote shows its original in this chat (on the fixture)', () => {
    conversation.current = makeConversation({
      orderedMessages: [
        createMessage({
          id: 'm-2',
          replyTo: { id: 'm-1', authorId: 'u-aiko', sentAt: '2026-11-16T10:00:00Z', deletedAt: null, spans: [{ type: SpanType.PLAINTEXT, text: 'hi' }] },
        }),
      ],
    });
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Reply to Aiko: hi' }));
    expect(where()).toBe(`${FIXTURE_CHAT}?highlight=m-1`);
  });

  it('Jump to latest shows with its count and jumps', () => {
    const onJump = vi.fn();
    conversation.current = makeConversation({
      orderedMessages: [createMessage({ id: 'm-1' })],
      jump: { shown: true, newCount: 3, onJump },
    });
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Jump to latest, 3 new messages' }));
    expect(onJump).toHaveBeenCalledTimes(1);
  });

  it('the typing line names who is typing', () => {
    conversation.current = makeConversation({ orderedMessages: [createMessage({ id: 'm-1' })], typingUserIds: ['u-aiko'] });
    setup();
    expect(screen.getByTestId('typing-line')).toHaveTextContent('Aiko is typing…');
  });

  it('says new messages politely', () => {
    conversation.current = makeConversation({ orderedMessages: [createMessage({ id: 'm-1' })], announcement: '2 new messages' });
    setup();
    expect(screen.getByText('2 new messages')).toBeInTheDocument();
  });

  it('Back after coming from the community’s home steps back in the history', () => {
    notePathname(FIXTURE_HOME);
    notePathname(FIXTURE_CHAT);
    setup({ entries: [FIXTURE_HOME, FIXTURE_CHAT] });
    fireEvent.click(screen.getByRole('button', { name: 'Back to the community' }));
    expect(where()).toBe(FIXTURE_HOME);
  });

  it('Back from a cold deep link replaces the entry with the community’s home', () => {
    setup({ entries: [`${FIXTURE_CHAT}`] });
    fireEvent.click(screen.getByRole('button', { name: 'Back to the community' }));
    expect(where()).toBe(FIXTURE_HOME);
  });

  it('Members opens the right content; Search is the old shell’s search screen', () => {
    const { setRightOpen } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Members' }));
    expect(setRightOpen).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Search messages' }));
    expect(where()).toBe('/community/c-1/channel/ch-1/search');
  });
});
