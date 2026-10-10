import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { markConversationRead } from '../../utils/markConversationRead';
import { channelMessagesQueryKey, dmMessagesQueryKey } from '../../utils/messageQueryKeys';
import { readReceiptsControllerGetUnreadCountsQueryKey } from '../../api-client/@tanstack/react-query.gen';

const sdk = vi.hoisted(() => ({
  markAsRead: vi.fn(),
  findForChannel: vi.fn(),
  findForGroup: vi.fn(),
}));
vi.mock('../../api-client/sdk.gen', () => ({
  readReceiptsControllerMarkAsRead: sdk.markAsRead,
  messagesControllerFindAllForChannel: sdk.findForChannel,
  messagesControllerFindAllForGroup: sdk.findForGroup,
}));

const unreadKey = readReceiptsControllerGetUnreadCountsQueryKey();

function client(unread: number) {
  const qc = new QueryClient();
  qc.setQueryData(unreadKey, [
    { channelId: 'ch-1', unreadCount: unread, mentionCount: 1 },
    { directMessageGroupId: 'dm-1', unreadCount: 2, mentionCount: 0 },
  ]);
  return qc;
}

describe('markConversationRead', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sdk.markAsRead.mockResolvedValue({ data: {} });
  });

  it('does nothing when the conversation has no unread messages', async () => {
    const qc = client(0);
    await expect(markConversationRead(qc, 'channel', 'ch-1')).resolves.toBe(false);
    expect(sdk.markAsRead).not.toHaveBeenCalled();
  });

  it('marks the newest confirmed cached message read and clears the counts', async () => {
    const qc = client(3);
    qc.setQueryData(channelMessagesQueryKey('ch-1'), {
      pages: [{ messages: [{ id: 'pending-123' }, { id: 'm-new' }, { id: 'm-old' }] }],
      pageParams: [''],
    });
    await expect(markConversationRead(qc, 'channel', 'ch-1')).resolves.toBe(true);
    expect(sdk.findForChannel).not.toHaveBeenCalled();
    expect(sdk.markAsRead).toHaveBeenCalledWith(
      expect.objectContaining({ body: { lastReadMessageId: 'm-new', channelId: 'ch-1' } }),
    );
    const counts = qc.getQueryData<{ channelId?: string; unreadCount: number; mentionCount: number }[]>(unreadKey)!;
    expect(counts[0]).toMatchObject({ unreadCount: 0, mentionCount: 0, lastReadMessageId: 'm-new' });
    expect(counts[1]).toMatchObject({ unreadCount: 2 });
  });

  it('fetches the newest message when the cache is scrolled back into history', async () => {
    const qc = client(2);
    qc.setQueryData(dmMessagesQueryKey('dm-1'), {
      pages: [{ messages: [{ id: 'm-history' }] }],
      pageParams: ['cursor-older'],
    });
    sdk.findForGroup.mockResolvedValue({ data: { messages: [{ id: 'm-latest' }] } });
    await expect(markConversationRead(qc, 'dm', 'dm-1')).resolves.toBe(true);
    expect(sdk.findForGroup).toHaveBeenCalledWith(expect.objectContaining({ path: { groupId: 'dm-1' }, query: { limit: 1 } }));
    expect(sdk.markAsRead).toHaveBeenCalledWith(
      expect.objectContaining({ body: { lastReadMessageId: 'm-latest', directMessageGroupId: 'dm-1' } }),
    );
  });
});
