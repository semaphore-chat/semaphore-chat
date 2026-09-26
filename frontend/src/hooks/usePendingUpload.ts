import { useCallback, useSyncExternalStore } from "react";
import {
  getPendingUpload,
  subscribePendingUploads,
  type PendingUpload,
} from "../utils/pendingUploadStore";
import type { Message } from "../types/message.type";

/**
 * The files `message` is still uploading (utils/pendingUploadStore.ts), by
 * its clientId while it's optimistic and by its server id after (a
 * refetched row has no clientId). Re-renders only when this entry changes.
 */
export function usePendingUpload(message: Pick<Message, "id" | "clientId">): PendingUpload | undefined {
  const { id, clientId } = message;
  const getSnapshot = useCallback(
    () => getPendingUpload(clientId) ?? getPendingUpload(id),
    [clientId, id],
  );
  return useSyncExternalStore(subscribePendingUploads, getSnapshot, getSnapshot);
}
