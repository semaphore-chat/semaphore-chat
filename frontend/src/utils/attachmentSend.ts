/**
 * Sending a message with attachments: optimistic row, background uploads
 * with progress, and per-file retry / remove / cancel.
 *
 * Server flow (unchanged): the message is created first over the socket
 * with `pendingAttachments: N` and no attachments. Each file is then
 * uploaded (POST /file-upload, resourceId = the message id) and attached
 * (POST /messages/:id/attachments { fileId }), which releases one pending
 * slot and broadcasts UPDATE_MESSAGE. Attaching without a fileId releases a
 * slot without a file: that's what Remove and Cancel send, and a message
 * left with no text and no files is deleted (DELETE /messages/:id).
 *
 * Client flow:
 * 1. `sendMessageWithAttachments` inserts the optimistic 'pending' row (same
 *    clientId reconciliation as a text message, see utils/optimisticSend.ts)
 *    and registers each file in utils/pendingUploadStore.ts as 'waiting'.
 * 2. When the send is acked, every file uploads in parallel ('uploading'
 *    with progress), then attaches ('attaching'); attaches run one at a time
 *    per message so the server's position counter never races. Each attach
 *    writes the updated message into the cache (the row keeps its clientId,
 *    so it never remounts) and the file turns 'done': the tile disappears
 *    and the real attachment renders in its place.
 * 3. A failed upload or attach turns the file 'failed' (toast + inline
 *    error): Retry re-uploads it (or only re-attaches an uploaded file),
 *    Remove releases its slot. A failed SEND leaves the row 'failed' with
 *    the usual Retry/Delete (OptimisticMessageActions); its files wait.
 *
 * Runs are module-level, not tied to a component: leaving the conversation
 * doesn't stop them, and the row finds its entry again on return. A page
 * reload loses them: the message stays with the files that made it, and the
 * server keeps counting the missing ones as pending.
 */
import type { QueryClient } from "@tanstack/react-query";
import {
  messagesControllerAddAttachment,
  messagesControllerRemove,
} from "../api-client/sdk.gen";
import type { Message } from "../types/message.type";
import type { MessageContext, NewMessagePayload, SendMessageResult } from "../hooks/useSendMessage";
import {
  deleteMessageFromInfinite,
  isDetachedFromLiveEdge,
  OPTIMISTIC_ID_PREFIX,
  prependMessageToInfinite,
  removeOptimisticMessage,
  updateMessageInInfinite,
} from "./messageCacheUpdaters";
import {
  inFlightClientIds,
  messagesQueryKeyFor,
  reconcileAfterSend,
  type MessagesInfiniteData,
} from "./optimisticSend";
import {
  createPreviewUrl,
  deletePendingUpload,
  getPendingUpload,
  removePendingFile,
  setPendingUpload,
  updatePendingFile,
  updatePendingUpload,
  type PendingFile,
} from "./pendingUploadStore";
import { UploadAbortedError, uploadFileWithProgress } from "./uploadFileWithProgress";
import { getHttpStatus } from "./httpError";
import { logger } from "./logger";

/** What a run needs from the app, captured when the message is sent. */
export interface AttachmentSendRuntime {
  queryClient: QueryClient;
  contextType: MessageContext;
  contextId: string;
  /** Shows an error to the user (the app's toast, which screen readers announce). */
  notifyError?: (message: string) => void;
  /**
   * Primes the authenticated-file cache with the local copy of a file that
   * just got attached, so the real attachment renders at once instead of
   * downloading what was just uploaded (see FileCacheProvider).
   */
  seedFileBlob?: (fileId: string, file: File) => void;
}

const runtimes = new Map<string, AttachmentSendRuntime>();
const abortControllers = new Map<string, AbortController>();
const attachQueues = new Map<string, Promise<void>>();

const fileKey = (clientId: string, localId: string) => `${clientId}\u0000${localId}`;

function flattenText(spans: NewMessagePayload["spans"] | undefined): string {
  return (spans ?? []).map((s) => s.text ?? "").join("");
}

/** A short reason from an Error or a thrown API error body (`{ statusCode, message }`). */
function describeError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const { message } = error as { message?: unknown };
    if (typeof message === "string" && message) return message;
    if (Array.isArray(message) && typeof message[0] === "string") return message[0];
  }
  return fallback;
}

function findFile(clientId: string, localId: string): PendingFile | undefined {
  return getPendingUpload(clientId)?.files.find((f) => f.localId === localId);
}

/** Runs `task` after every earlier attach/release of this message. */
function enqueue(clientId: string, task: () => Promise<void>): Promise<void> {
  const previous = attachQueues.get(clientId) ?? Promise.resolve();
  const next = previous.then(task, task);
  attachQueues.set(clientId, next);
  void next.finally(() => {
    if (attachQueues.get(clientId) === next) attachQueues.delete(clientId);
  });
  return next;
}

function forget(clientId: string): void {
  const entry = getPendingUpload(clientId);
  entry?.files.forEach((f) => abortControllers.get(fileKey(clientId, f.localId))?.abort());
  deletePendingUpload(clientId);
  runtimes.delete(clientId);
}

/** Drops the entry once every file is attached (their tiles have been replaced by the real attachments). */
function finishIfComplete(clientId: string): void {
  const entry = getPendingUpload(clientId);
  if (entry && entry.files.every((f) => f.status === "done")) forget(clientId);
}

function fail(clientId: string, localId: string, error: unknown): void {
  const file = findFile(clientId, localId);
  if (!file) return;
  const message = describeError(error, "Upload failed");
  updatePendingFile(clientId, localId, { status: "failed", error: message });
  runtimes.get(clientId)?.notifyError?.(`Couldn't upload ${file.name}: ${message}`);
}

function writeMessage(clientId: string, message: Message): void {
  const runtime = runtimes.get(clientId);
  if (!runtime) return;
  const queryKey = messagesQueryKeyFor(runtime.contextType, runtime.contextId);
  runtime.queryClient.setQueryData(queryKey, (old: unknown) =>
    updateMessageInInfinite(old as MessagesInfiniteData | undefined, message),
  );
}

async function attach(clientId: string, localId: string): Promise<void> {
  await enqueue(clientId, async () => {
    const entry = getPendingUpload(clientId);
    const file = findFile(clientId, localId);
    if (!entry?.messageId || !file?.fileId || file.status !== "attaching") return;
    try {
      const { data } = await messagesControllerAddAttachment({
        path: { id: entry.messageId },
        body: { fileId: file.fileId },
        throwOnError: true,
      });
      runtimes.get(clientId)?.seedFileBlob?.(file.fileId, file.file);
      writeMessage(clientId, data as unknown as Message);
      updatePendingFile(clientId, localId, { status: "done", progress: 1, error: null });
      finishIfComplete(clientId);
    } catch (error) {
      // The message is gone (deleted meanwhile): nothing left to attach to.
      if (getHttpStatus(error) === 404) {
        forget(clientId);
        return;
      }
      fail(clientId, localId, error);
    }
  });
}

async function upload(clientId: string, localId: string): Promise<void> {
  const entry = getPendingUpload(clientId);
  const file = findFile(clientId, localId);
  if (!entry?.messageId || !file) return;
  const controller = new AbortController();
  const key = fileKey(clientId, localId);
  abortControllers.set(key, controller);
  updatePendingFile(clientId, localId, { status: "uploading", progress: 0, error: null });
  let fileId: string;
  try {
    const uploaded = await uploadFileWithProgress(file.file, {
      resourceType: "MESSAGE_ATTACHMENT",
      resourceId: entry.messageId,
      signal: controller.signal,
      // Whole percents: no re-render per progress event of a fast upload.
      onProgress: (fraction) =>
        updatePendingFile(clientId, localId, { progress: Math.floor(fraction * 100) / 100 }),
    });
    fileId = uploaded.id;
  } catch (error) {
    // Cancelled: removeAttachment() already dropped the file.
    if (!(error instanceof UploadAbortedError)) fail(clientId, localId, error);
    return;
  } finally {
    if (abortControllers.get(key) === controller) abortControllers.delete(key);
  }
  updatePendingFile(clientId, localId, { status: "attaching", progress: 1, fileId });
  await attach(clientId, localId);
}

/** Registers the files of a message about to be sent (all 'waiting'). */
function register(runtime: AttachmentSendRuntime, clientId: string, files: File[], hasText: boolean): void {
  runtimes.set(clientId, runtime);
  setPendingUpload({
    clientId,
    messageId: null,
    hasText,
    files: files.map((file, i) => ({
      localId: `f${i}`,
      file,
      name: file.name,
      size: file.size,
      mimeType: file.type || "application/octet-stream",
      previewUrl: createPreviewUrl(file),
      status: "waiting",
      progress: 0,
      fileId: null,
      error: null,
    })),
  });
}

export interface SendMessageWithAttachmentsOptions {
  runtime: AttachmentSendRuntime;
  payload: NewMessagePayload;
  files: File[];
  /** The raw socket send (useSendMessage). */
  send: (payload: NewMessagePayload) => Promise<SendMessageResult>;
}

/**
 * Sends a message with files: optimistic row first, then (once acked) the
 * uploads, in the background. Resolves with the send's result as soon as
 * the server acked (or refused) the message, not when the uploads finish.
 */
export async function sendMessageWithAttachments({
  runtime,
  payload,
  files,
  send,
}: SendMessageWithAttachmentsOptions): Promise<SendMessageResult> {
  const { queryClient } = runtime;
  const queryKey = messagesQueryKeyFor(runtime.contextType, runtime.contextId);
  const clientId = `${OPTIMISTIC_ID_PREFIX}${crypto.randomUUID()}`;
  const wirePayload: NewMessagePayload = { ...payload, attachments: [], pendingAttachments: files.length };
  register(runtime, clientId, files, flattenText(payload.spans).trim() !== "");

  // Same scope guard as useOptimisticSendMessage: no optimistic row in a
  // window detached from the live edge (the own-send reset brings the
  // message in once its echo lands).
  const detached = isDetachedFromLiveEdge(queryClient.getQueryData<MessagesInfiniteData>(queryKey));
  const optimisticMessage = { ...wirePayload, id: clientId, clientId, sendStatus: "pending" } as Message;
  if (!detached) {
    queryClient.setQueryData(queryKey, (old: unknown) =>
      prependMessageToInfinite(old as MessagesInfiniteData | undefined, optimisticMessage),
    );
  }

  inFlightClientIds.add(clientId);
  let result: SendMessageResult;
  try {
    result = await send(wirePayload);
  } finally {
    inFlightClientIds.delete(clientId);
  }

  if (!detached) reconcileAfterSend(queryClient, queryKey, clientId, optimisticMessage, result);
  if (result.success && result.messageId) {
    startAttachmentUploads(clientId, result.messageId);
  } else if (detached) {
    // No row to show the failure on: say so, and drop the files.
    runtime.notifyError?.(describeError(result.error, "Failed to send message"));
    forget(clientId);
  }
  return result;
}

/**
 * Binds the entry to the server's message id and starts uploading its
 * waiting files. Idempotent: called on the send's ack, on a successful
 * resend, and by the row when its message turned real some other way (a
 * late echo reconciled a row whose ack had timed out).
 */
export function startAttachmentUploads(clientId: string, messageId: string): void {
  const entry = getPendingUpload(clientId);
  if (!entry || entry.clientId !== clientId || !runtimes.has(clientId)) return;
  if (entry.messageId && entry.messageId !== messageId) return;
  if (!entry.messageId) updatePendingUpload(clientId, (e) => ({ ...e, messageId }));
  for (const file of entry.files) {
    if (file.status === "waiting") void upload(clientId, file.localId);
  }
}

/** Whether this clientId has files this session is (or was) uploading. */
export function hasAttachmentSend(clientId: string): boolean {
  return runtimes.has(clientId);
}

/** How many files of the message still have to be attached (a resend's `pendingAttachments`). */
export function pendingAttachmentCount(clientId: string): number {
  return getPendingUpload(clientId)?.files.filter((f) => f.status !== "done").length ?? 0;
}

/** Retry a failed file: re-upload it, or only re-attach it when the upload itself had succeeded. */
export async function retryAttachment(clientId: string, localId: string): Promise<void> {
  const file = findFile(clientId, localId);
  if (!file || file.status !== "failed" || !runtimes.has(clientId)) return;
  if (file.fileId) {
    updatePendingFile(clientId, localId, { status: "attaching", error: null });
    await attach(clientId, localId);
  } else {
    await upload(clientId, localId);
  }
}

/**
 * Remove a failed file, or cancel one still uploading: it's dropped, and
 * its slot on the server released. A message left with no text and no files
 * is deleted.
 */
export async function removeAttachment(clientId: string, localId: string): Promise<void> {
  const entry = getPendingUpload(clientId);
  const file = findFile(clientId, localId);
  const runtime = runtimes.get(clientId);
  if (!entry || !file || !runtime) return;
  if (file.status !== "failed" && file.status !== "uploading") return;
  abortControllers.get(fileKey(clientId, localId))?.abort();
  removePendingFile(clientId, localId);

  const messageId = entry.messageId;
  if (messageId) {
    await enqueue(clientId, async () => {
      try {
        await messagesControllerAddAttachment({ path: { id: messageId }, body: {}, throwOnError: true });
      } catch (error) {
        // Only the server's pending count is off; the message is fine.
        logger.warn("[attachmentSend] Failed to release an attachment slot:", error);
      }
    });
  }

  const after = getPendingUpload(clientId);
  if (!after) return;
  if (after.files.length === 0 && !after.hasText) {
    await discardEmptyMessage(clientId, runtime, messageId);
    return;
  }
  finishIfComplete(clientId);
}

async function discardEmptyMessage(
  clientId: string,
  runtime: AttachmentSendRuntime,
  messageId: string | null,
): Promise<void> {
  forget(clientId);
  const queryKey = messagesQueryKeyFor(runtime.contextType, runtime.contextId);
  if (!messageId) {
    runtime.queryClient.setQueryData(queryKey, (old: unknown) =>
      removeOptimisticMessage(old as MessagesInfiniteData | undefined, clientId),
    );
    return;
  }
  try {
    await messagesControllerRemove({ path: { id: messageId }, throwOnError: true });
  } catch (error) {
    if (getHttpStatus(error) !== 404) {
      logger.warn("[attachmentSend] Failed to delete the emptied message:", error);
      runtime.notifyError?.("Couldn't delete the empty message");
      return;
    }
  }
  runtime.queryClient.setQueryData(queryKey, (old: unknown) =>
    deleteMessageFromInfinite(old as MessagesInfiniteData | undefined, messageId),
  );
}

/** Forget a message's uploads (its failed optimistic row was deleted). */
export function discardAttachmentSend(clientId: string): void {
  forget(clientId);
}

/** Test helper: forget every run. */
export function resetAttachmentSendsForTests(): void {
  abortControllers.forEach((c) => c.abort());
  abortControllers.clear();
  attachQueues.clear();
  runtimes.clear();
}
