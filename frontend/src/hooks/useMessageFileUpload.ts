import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { VoiceSessionType } from "../contexts/VoiceContext";
import { useSendMessage } from "./useSendMessage";
import { useOptimisticSendMessage } from "./useOptimisticSendMessage";
import { useNotification } from "../contexts/NotificationContext";
import { useOptionalFileCache } from "../contexts/AvatarCacheContext";
import { sendMessageWithAttachments } from "../utils/attachmentSend";
import type { Span } from "../types/message.type";

interface UseMessageFileUploadOptions {
  contextType: VoiceSessionType;
  contextId: string;
  authorId: string;
}

/**
 * The composer's send for a channel or DM. Every send shows up at once as an
 * optimistic 'pending' row: text-only through useOptimisticSendMessage, and
 * with files through utils/attachmentSend.ts, which then uploads them in the
 * background with per-file progress, retry and remove (see there).
 *
 * Resolves once the server acked (or refused) the message — the composer
 * serializes sends on that — not when the uploads finish. Failures surface
 * inline: a failed send as the row's 'failed' state (Retry/Delete in
 * MessageComponent), a failed upload on that file's tile (plus a toast).
 */
export const useMessageFileUpload = ({ contextType, contextId, authorId }: UseMessageFileUploadOptions) => {
  const queryClient = useQueryClient();
  const { showNotification } = useNotification();
  const fileCache = useOptionalFileCache();
  const { sendMessage: rawSendMessage } = useSendMessage(contextType);
  const { sendMessage: sendOptimisticMessage } = useOptimisticSendMessage(contextType, contextId);

  const seedFileBlob = useCallback(
    (fileId: string, file: File) => {
      if (!fileCache || fileCache.hasBlob(fileId)) return;
      fileCache.setBlob(fileId, URL.createObjectURL(file));
    },
    [fileCache],
  );

  const handleSendMessage = async (_messageContent: string, spans: Span[], files?: File[], replyToId?: string) => {
    const msg = {
      ...(contextType === VoiceSessionType.Channel
        ? { channelId: contextId }
        : { directMessageGroupId: contextId }),
      authorId,
      spans,
      attachments: [],
      pendingAttachments: files?.length || 0,
      reactions: [],
      sentAt: new Date().toISOString(),
      ...(replyToId ? { replyToId } : {}),
    };

    if (files && files.length > 0) {
      await sendMessageWithAttachments({
        runtime: {
          queryClient,
          contextType,
          contextId,
          notifyError: (message) => showNotification(message, "error"),
          seedFileBlob,
        },
        payload: msg,
        files,
        send: rawSendMessage,
      });
      return;
    }

    // Failures surface inline via the message's 'failed' sendStatus
    // (retry/delete UI in MessageComponent) instead of a toast — the
    // optimistic bubble IS the error affordance here.
    await sendOptimisticMessage(msg);
  };

  return { handleSendMessage };
};
