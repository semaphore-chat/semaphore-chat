/**
 * `useConversation`'s "N new" on the real `live` expression (mode and detachment from the messages hook): pages
 * loaded after a `?highlight=` jump never count; back at the live edge, a live arrival does.
 */
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { createMessage } from '../../test-utils/factories';
import type { Message } from '../../../types/message.type';

const hook = vi.hoisted(() => ({ result: {} as Record<string, unknown> }));
vi.mock('../../../data/chat/useChannelChat', () => ({ useChannelChat: () => ({ messagesHookResult: hook.result }) }));
vi.mock('../../../data/chat/useReadMarks', () => ({
  useReadMarks: () => ({ handleDetachedJumpToPresent: () => undefined, handleVisibleRangeChange: () => undefined, unreadCount: 0, lastReadIndex: -1 }),
}));
vi.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ user: { id: 'me' } }) }));
vi.mock('../../../hooks/useAutoMarkNotificationsRead', () => ({ useAutoMarkNotificationsRead: () => undefined }));
vi.mock('../../../hooks/useMessageListAnnouncer', () => ({ useMessageListAnnouncer: () => '' }));
vi.mock('../../../hooks/useTypingUsers', () => ({ useTypingUsers: () => [] }));
vi.mock('../../../hooks/useAnchoredModeTransition', () => ({ useAnchoredModeTransition: () => undefined }));

import { useConversation } from '../../../data/chat/useConversation';

let minute = 0;
const msg = (id: string) => createMessage({ id, authorId: 'other', sentAt: new Date(Date.UTC(2026, 10, 16, 9, minute++)).toISOString() });
/** The messages hook hands them newest first. */
const newestFirst = (messages: Message[]) => [...messages].reverse();

function result(mode: 'normal' | 'anchored', messages: Message[], extra: Record<string, unknown> = {}) {
  return {
    messages: newestFirst(messages),
    isLoading: false,
    error: null,
    isLoadingMore: false,
    mode,
    jumpToPresent: mode === 'anchored' ? () => undefined : undefined,
    hasNewer: mode === 'anchored',
    isLoadingNewer: false,
    ...(mode === 'normal' ? { isDetachedFromPresent: false, resetToPresent: async () => undefined } : {}),
    ...extra,
  };
}

describe('useConversation: "N new" follows the live edge only', () => {
  it('after a ?highlight= jump newer pages are not new; back at the present a live arrival is', () => {
    const history = Array.from({ length: 5 }, (_, i) => msg(`h-${i}`));
    hook.result = result('anchored', history);
    const { result: conv, rerender } = renderHook(() => useConversation({ communityId: 'c-1', channelId: 'ch-1' }));
    act(() => conv.current.list.onAtBottomChange(false));

    // Scrolling toward the present loads a newer page into the anchored window.
    const newer = Array.from({ length: 25 }, (_, i) => msg(`n-${i}`));
    hook.result = result('anchored', [...history, ...newer]);
    rerender();
    expect(conv.current.jump.newCount).toBe(0);

    // The window becomes the live one at the present (normal mode, not detached): still nothing new.
    const present = [...newer.slice(-10), msg('p-1')];
    hook.result = result('normal', present);
    rerender();
    expect(conv.current.jump.newCount).toBe(0);

    // A message arrives live while the reader is still scrolled up.
    hook.result = result('normal', [...present, msg('p-2')]);
    rerender();
    expect(conv.current.jump.newCount).toBe(1);
  });

  it('a detached window (deep history in normal mode) counts nothing', () => {
    const page = Array.from({ length: 3 }, (_, i) => msg(`d-${i}`));
    hook.result = result('normal', page, { isDetachedFromPresent: true });
    const { result: conv, rerender } = renderHook(() => useConversation({ communityId: 'c-1', channelId: 'ch-1' }));
    act(() => conv.current.list.onAtBottomChange(false));
    hook.result = result('normal', [...page, msg('d-3')], { isDetachedFromPresent: true });
    rerender();
    expect(conv.current.jump.newCount).toBe(0);
  });
});
