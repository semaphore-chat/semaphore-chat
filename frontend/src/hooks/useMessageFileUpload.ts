import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { VoiceSessionType } from "../contexts/VoiceContext";
import { useSendMessage } from "./useSendMessage";
import { useOptimisticSendMessage } from "./useOptimisticSendMessage";
import { useFileCache } from "../contexts/AvatarCacheContext";
import { sendMessageWithAttachments } from "../utils/attachmentSend";
import type { Span } from "../types/message.type";

interface UseMessageFileUploadOptions {
  contextType: VoiceSessionType;
  contextId: string;
  authorId: string;
  /**
   * Shows an error to the user (a failed upload or send). Injected so the hook
   * stays free of a notification UI; classic passes
   * `(message) => showNotification(message, "error")`, the new shell a kit
   * toast. Required: a failed upload must always be told to the user.
   */
  onError: (message: string) => void;
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
export const useMessageFileUpload = ({ contextType, contextId, authorId, onError }: UseMessageFileUploadOptions) => {
  const queryClient = useQueryClient();
  const fileCache = useFileCache();
  const { sendMessage: rawSendMessage } = useSendMessage(contextType);
  const { sendMessage: sendOptimisticMessage } = useOptimisticSendMessage(contextType, contextId);

  const seedFileBlob = useCallback(
    (fileId: string, file: File) => {
      if (fileCache.hasBlob(fileId)) return;
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
          notifyError: (message) => onError(message),
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
