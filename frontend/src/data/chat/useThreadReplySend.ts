/**
 * Sending a reply in a thread, words and files: the shared thread send (`hooks/useSendThreadReply`, the nonce and the
 * ack) and, with files, the shared background uploads (`utils/attachmentSend`'s `sendUnlistedWithAttachments`): the
 * reply is created with that many pending files, then each uploads to it with progress, Retry and Remove on the
 * reply's own row. A thread has no optimistic rows (the reply arrives over the socket), so the composer keeps its
 * words and files until the server has the reply: the returned send resolves true then (clear the composer), false
 * when it was not sent (the reason went to `onError`).
 *
 * Headless: no UI imports (see the `src/data` lint block in eslint.config.js).
 */
import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { VoiceSessionType } from '../../contexts/VoiceContext';
import { useFileCache } from '../../contexts/AvatarCacheContext';
import { useSendThreadReply } from '../../hooks/useSendThreadReply';
import type { Span } from '../../types/message.type';
import { sendUnlistedWithAttachments } from '../../utils/attachmentSend';

export interface UseThreadReplySendOptions {
  parentMessageId: string;
  /** The parent's channel: whose message list a file attach would touch (none: a reply is in no list). */
  channelId: string;
  onError: (message: string) => void;
}

export function useThreadReplySend({ parentMessageId, channelId, onError }: UseThreadReplySendOptions) {
  const queryClient = useQueryClient();
  const fileCache = useFileCache();
  const { sendReply } = useSendThreadReply(parentMessageId);

  return useCallback(
    async (content: string, spans: Span[], files: File[]): Promise<boolean> => {
      let cleared = false;
      const once = async (pendingAttachments: number): Promise<string | null> => {
        const outcome = await sendReply({ content, spans, pendingAttachments });
        if (outcome === null) return null;
        if (outcome.error) onError(outcome.error);
        cleared = outcome.clear;
        return outcome.messageId ?? null;
      };
      if (files.length === 0) {
        await once(0);
        return cleared;
      }
      await sendUnlistedWithAttachments({
        runtime: {
          queryClient,
          contextType: VoiceSessionType.Channel,
          contextId: channelId,
          notifyError: onError,
          seedFileBlob: (fileId, file) => {
            if (!fileCache.hasBlob(fileId)) fileCache.setBlob(fileId, URL.createObjectURL(file));
          },
        },
        files,
        hasText: content.trim() !== '',
        send: once,
      });
      return cleared;
    },
    [sendReply, onError, queryClient, channelId, fileCache],
  );
}
