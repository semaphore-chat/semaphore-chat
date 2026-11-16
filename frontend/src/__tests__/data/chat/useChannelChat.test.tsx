import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { useChannelChat } from '../../../data/chat/useChannelChat';
import { useJumpToMessage } from '../../../hooks/useJumpToMessage';
import { createMessage, resetFactoryCounter } from '../../test-utils/factories';

vi.mock('../../../hooks/useJumpToMessage', () => ({ useJumpToMessage: vi.fn() }));

const pinned = [
  { id: 'pin-1', parentMessageId: null },
  { id: 'pin-reply', parentMessageId: 'parent-1' },
];
const members = [
  { user: { id: 'u-1', username: 'aiko', displayName: 'Aiko' } },
  { user: { id: 'u-2', username: 'bo', displayName: null } },
];
const mentionable = [{ id: 'ch-9', name: 'general' }];

vi.mock('../../../hooks/useAllCommunityMembers', () => ({
  useAllCommunityMembers: (communityId: string, options: { enabled?: boolean }) => ({
    data: options.enabled && communityId ? members : undefined,
  }),
}));
vi.mock('../../../api-client/@tanstack/react-query.gen', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api-client/@tanstack/react-query.gen')>();
  return {
    ...actual,
    moderationControllerGetPinnedMessagesOptions: ({ path }: { path: { channelId: string } }) => ({
      queryKey: ['pinned', path.channelId],
      queryFn: () => Promise.resolve(pinned),
      staleTime: Infinity,
    }),
    channelsControllerGetMentionableChannelsOptions: ({ path }: { path: { communityId: string } }) => ({
      queryKey: ['mentionable', path.communityId],
      queryFn: () => Promise.resolve(mentionable),
      staleTime: Infinity,
    }),
  };
});

const jumpResult = (isJumpPending: boolean) => ({
  messages: [createMessage({ id: 'm-1' })],
  isJumpPending,
  highlightMessageId: undefined,
});

describe('useChannelChat', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    resetFactoryCounter();
    vi.mocked(useJumpToMessage).mockReset();
    vi.mocked(useJumpToMessage).mockReturnValue(jumpResult(false) as never);
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(['pinned', 'ch-1'], pinned);
    queryClient.setQueryData(['mentionable', 'c-1'], mentionable);
  });

  function setup(url: string, onPinnedThreadReply?: (id: string) => void) {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>
      </QueryClientProvider>
    );
    return renderHook(
      () => {
        const location = useLocation();
        return { chat: useChannelChat('ch-1', 'c-1', { onPinnedThreadReply }), url: location.pathname + location.search };
      },
      { wrapper },
    );
  }

  it('reads ?highlight= into the jump hook', () => {
    setup('/community/c-1/channel/ch-1?highlight=m-7');
    expect(useJumpToMessage).toHaveBeenCalledWith('channel', 'ch-1', 'm-7');
  });

  it('keeps ?highlight= while the jump is pending (a cold deep link)', () => {
    vi.mocked(useJumpToMessage).mockReturnValue(jumpResult(true) as never);
    const { result } = setup('/community/c-1/channel/ch-1?highlight=m-7');
    expect(result.current.url).toBe('/community/c-1/channel/ch-1?highlight=m-7');
  });

  it('clears ?highlight= once the jump has settled', () => {
    vi.mocked(useJumpToMessage).mockReturnValue(jumpResult(true) as never);
    const { result, rerender } = setup('/community/c-1/channel/ch-1?highlight=m-7');
    expect(result.current.url).toContain('highlight=m-7');

    vi.mocked(useJumpToMessage).mockReturnValue(jumpResult(false) as never);
    rerender();
    expect(result.current.url).toBe('/community/c-1/channel/ch-1');
    // The jump hook saw the param go away.
    expect(vi.mocked(useJumpToMessage).mock.lastCall).toEqual(['channel', 'ch-1', undefined]);
  });

  it('builds the mention lists from the members and mentionable channels', () => {
    const { result } = setup('/community/c-1/channel/ch-1');
    expect(result.current.chat.userMentions).toEqual([
      { id: 'u-1', username: 'aiko', displayName: 'Aiko' },
      { id: 'u-2', username: 'bo', displayName: undefined },
    ]);
    expect(result.current.chat.channelMentions).toEqual([{ id: 'ch-9', name: 'general' }]);
  });

  it('returns the pinned messages (their count drives the header badge)', () => {
    const { result } = setup('/community/c-1/channel/ch-1');
    expect(result.current.chat.pinnedMessages).toHaveLength(2);
  });

  it('jumps to a pinned message', () => {
    // A real jump stays pending until the target loads, so the param stays.
    vi.mocked(useJumpToMessage).mockImplementation(((_type: string, _id: string, highlight?: string) => jumpResult(!!highlight)) as never);
    const onPinnedThreadReply = vi.fn();
    const { result } = setup('/community/c-1/channel/ch-1', onPinnedThreadReply);

    act(() => result.current.chat.jumpToPinnedMessage('pin-1', { replace: false }));
    expect(result.current.url).toBe('/community/c-1/channel/ch-1?highlight=pin-1');
    expect(onPinnedThreadReply).not.toHaveBeenCalled();
  });

  it('jumps to a pinned thread reply’s parent and reports the parent first', () => {
    // A real jump stays pending until the target loads, so the param stays.
    vi.mocked(useJumpToMessage).mockImplementation(((_type: string, _id: string, highlight?: string) => jumpResult(!!highlight)) as never);
    const onPinnedThreadReply = vi.fn();
    const { result } = setup('/community/c-1/channel/ch-1', onPinnedThreadReply);

    act(() => result.current.chat.jumpToPinnedMessage('pin-reply', { replace: true }));
    expect(onPinnedThreadReply).toHaveBeenCalledWith('parent-1');
    expect(result.current.url).toBe('/community/c-1/channel/ch-1?highlight=parent-1');
  });
});
