/**
 * A channel's pinned messages, shared by both shells: the list (newest pin first, as the server sends it), whether
 * the reader may unpin (the community's UNPIN_MESSAGE), Unpin (the list refreshes once the server has it; a pin or
 * unpin anywhere else refreshes it through the socket's MESSAGE_PINNED / MESSAGE_UNPINNED), and where a pin leads
 * (`pinnedJumpTarget`).
 *
 * Headless: no UI imports (see the `src/data` lint block in eslint.config.js).
 */
import { stripBidiOverrides } from '../../kit';
import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  moderationControllerGetPinnedMessagesOptions,
  moderationControllerUnpinMessageMutation,
} from '../../api-client/@tanstack/react-query.gen';
import type { PinnedMessageDto } from '../../api-client/types.gen';
import { RBAC_ACTIONS } from '../../constants/rbacActions';
import { useCanPerformAction } from '../../features/roles/useUserPermissions';
import { logger } from '../../utils/logger';

/**
 * Where jumping to a pin goes: the message itself, or for a thread reply its parent (`highlight`) with the thread
 * to open on it (`thread`).
 */
export function pinnedJumpTarget(pin: Pick<PinnedMessageDto, 'id' | 'parentMessageId'>): { highlight: string; thread?: string } {
  return pin.parentMessageId ? { highlight: pin.parentMessageId, thread: pin.parentMessageId } : { highlight: pin.id };
}

/** The pin's words on one line, as the old panel shows them (each span's text, joined by spaces). */
export function pinnedText(pin: Pick<PinnedMessageDto, 'spans'>): string {
  return pin.spans
    .filter((span) => span.text)
    .map((span) => stripBidiOverrides(span.text ?? ''))
    .join(' ');
}

export function usePinnedList(channelId: string, communityId: string) {
  const queryClient = useQueryClient();
  const { data: pins, isLoading, error, refetch } = useQuery(moderationControllerGetPinnedMessagesOptions({ path: { channelId } }));
  const { mutateAsync: unpinMessage } = useMutation({
    ...moderationControllerUnpinMessageMutation(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [{ _id: 'moderationControllerGetPinnedMessages' }] }),
  });
  const canUnpin = useCanPerformAction('COMMUNITY', communityId, RBAC_ACTIONS.UNPIN_MESSAGE);

  /** Unpins it; resolves false (and logs) when the server refused. */
  const unpin = useCallback(
    async (messageId: string): Promise<boolean> => {
      try {
        await unpinMessage({ path: { messageId }, body: {} });
        return true;
      } catch (err) {
        logger.error('Failed to unpin message:', err);
        return false;
      }
    },
    [unpinMessage],
  );

  return { pins, isLoading, error, refetch, canUnpin, unpin };
}
