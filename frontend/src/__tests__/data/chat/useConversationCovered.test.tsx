/**
 * The two-list rule (PR 10d-B): while a thread covers the channel, the channel's list marks nothing read and
 * announces nothing; when the cover goes, the last range its list reported is read then.
 */
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { createMessage } from '../../test-utils/factories';

const spies = vi.hoisted(() => ({ range: vi.fn(), announcement: 'aiko: hello' }));
const hook = vi.hoisted(() => ({ result: {} as Record<string, unknown> }));
vi.mock('../../../data/chat/useChannelChat', () => ({ useChannelChat: () => ({ messagesHookResult: hook.result }) }));
vi.mock('../../../data/chat/useReadMarks', () => ({
  useReadMarks: () => ({ handleDetachedJumpToPresent: () => undefined, handleVisibleRangeChange: spies.range, unreadCount: 0, lastReadIndex: -1 }),
}));
vi.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ user: { id: 'me' } }) }));
vi.mock('../../../hooks/useAutoMarkNotificationsRead', () => ({ useAutoMarkNotificationsRead: () => undefined }));
vi.mock('../../../hooks/useMessageListAnnouncer', () => ({ useMessageListAnnouncer: () => spies.announcement }));
vi.mock('../../../hooks/useTypingUsers', () => ({ useTypingUsers: () => [] }));
vi.mock('../../../hooks/useAnchoredModeTransition', () => ({ useAnchoredModeTransition: () => undefined }));

import { useConversation } from '../../../data/chat/useConversation';

describe('useConversation under a cover (a thread over the channel)', () => {
  it('marks nothing read and announces nothing while covered; on uncover the last range is read', () => {
    hook.result = { messages: [createMessage({ id: 'b' }), createMessage({ id: 'a' })], isLoading: false, error: null, isLoadingMore: false, mode: 'normal', isDetachedFromPresent: false };
    const { result, rerender } = renderHook(({ covered }) => useConversation({ communityId: 'c-1', channelId: 'ch-1', covered }), {
      initialProps: { covered: true },
    });
    expect(result.current.announcement).toBe('');
    // A message arrives in view under the thread: the list reports its range.
    act(() => result.current.list.onVisibleRangeChange(0, 1));
    act(() => result.current.list.onVisibleRangeChange(0, 2));
    expect(spies.range).not.toHaveBeenCalled();
    rerender({ covered: false });
    expect(spies.range).toHaveBeenCalledTimes(1);
    expect(spies.range).toHaveBeenLastCalledWith(0, 2);
    expect(result.current.announcement).toBe('aiko: hello');
    // Uncovered, ranges are read as they come.
    act(() => result.current.list.onVisibleRangeChange(1, 2));
    expect(spies.range).toHaveBeenLastCalledWith(1, 2);
  });
});
