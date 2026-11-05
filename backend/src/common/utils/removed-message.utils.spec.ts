import {
  blankRemovedMessage,
  blankRemovedMessagesForReader,
} from './removed-message.utils';

describe('removed-message utils', () => {
  const live = { id: 'live', channelId: 'c1', deletedAt: null, spans: ['x'] };
  const removed = {
    id: 'removed',
    authorId: 'author',
    channelId: 'c1',
    sentAt: 'sent',
    deletedAt: new Date('2026-01-01'),
    deletedBy: 'moderator',
    deletedByReason: 'reason',
    searchText: 'text',
    spans: ['text'],
    attachments: ['file'],
    reactions: ['reaction'],
    linkPreviews: ['preview'],
    pendingAttachments: 2,
    replyToId: 'quoted',
    replyTo: { id: 'quoted' },
  };

  describe('blankRemovedMessage', () => {
    it('returns a live message untouched', () => {
      expect(blankRemovedMessage(live)).toBe(live);
    });

    it('keeps identity and timestamps, and drops everything it said', () => {
      expect(blankRemovedMessage(removed)).toEqual({
        id: 'removed',
        authorId: 'author',
        channelId: 'c1',
        sentAt: 'sent',
        deletedAt: removed.deletedAt,
        deletedBy: null,
        deletedByReason: null,
        searchText: null,
        spans: [],
        attachments: [],
        reactions: [],
        linkPreviews: null,
        pendingAttachments: 0,
        replyToId: null,
        replyTo: null,
      });
    });
  });

  describe('blankRemovedMessagesForReader', () => {
    it('does not check permissions when nothing was removed', async () => {
      const canSee = jest.fn();
      const rows = [live];
      await expect(blankRemovedMessagesForReader(rows, canSee)).resolves.toBe(
        rows,
      );
      expect(canSee).not.toHaveBeenCalled();
    });

    it('blanks removed rows for a reader without the permission', async () => {
      const canSee = jest.fn().mockResolvedValue(false);
      const rows: Array<Record<string, unknown> & { deletedAt: Date | null }> =
        [live, removed];
      const [first, second] = await blankRemovedMessagesForReader(rows, canSee);
      expect(first).toBe(live);
      expect(second.spans).toEqual([]);
      expect(second.deletedBy).toBeNull();
    });

    it('keeps removed rows for a reader with the permission', async () => {
      const canSee = jest.fn().mockResolvedValue(true);
      const [row] = await blankRemovedMessagesForReader([removed], canSee);
      expect(row).toBe(removed);
    });

    it('asks once per channel', async () => {
      const canSee = jest.fn().mockResolvedValue(false);
      await blankRemovedMessagesForReader(
        [removed, { ...removed, id: 'other' }],
        canSee,
      );
      expect(canSee).toHaveBeenCalledTimes(1);
      expect(canSee).toHaveBeenCalledWith('c1');
    });

    it('blanks a removed row with no channel without asking', async () => {
      const canSee = jest.fn().mockResolvedValue(true);
      const [row] = await blankRemovedMessagesForReader(
        [{ ...removed, channelId: null }],
        canSee,
      );
      expect(row.spans).toEqual([]);
      expect(canSee).not.toHaveBeenCalled();
    });

    it('rejects rather than delivering content when the check fails', async () => {
      const canSee = jest.fn().mockRejectedValue(new Error('down'));
      await expect(
        blankRemovedMessagesForReader([removed], canSee),
      ).rejects.toThrow('down');
    });
  });
});
