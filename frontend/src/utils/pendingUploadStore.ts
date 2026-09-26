/**
 * Client-side state of the files a sent message is still uploading.
 *
 * Kept out of the TanStack Query cache on purpose: upload progress changes
 * many times a second, and writing it into the message list's cache would
 * re-render every row on each progress event. Instead each message row
 * subscribes to its own entry here (see hooks/usePendingUpload.ts), keyed by
 * the optimistic row's `clientId` and, once the server acked the message,
 * also by its real id (a refetched page carries no clientId).
 *
 * Module-level, like the upload runs in utils/attachmentSend.ts: an upload
 * keeps going when the user leaves the conversation, and the row picks its
 * entry up again when they come back. Nothing here survives a page reload.
 */

/**
 * - `waiting`: the message itself isn't on the server yet (its send is in
 *   flight or failed), so the file can't upload yet.
 * - `uploading`: bytes are going up; `progress` is 0..1. At 1 the server is
 *   still storing it (thumbnails, checksums).
 * - `attaching`: uploaded (`fileId` set); being attached to the message.
 * - `failed`: upload or attach failed (`error`); Retry or Remove it.
 * - `done`: attached; the real attachment renders from the message itself.
 */
export type PendingFileStatus = "waiting" | "uploading" | "attaching" | "failed" | "done";

export interface PendingFile {
  /** Stable id for this file within its message (React key, actions). */
  localId: string;
  file: File;
  name: string;
  size: number;
  mimeType: string;
  /** Object URL of the local file for image/video thumbnails; revoked when the file leaves the store. */
  previewUrl: string | null;
  status: PendingFileStatus;
  /** Upload progress, 0..1. */
  progress: number;
  /** The uploaded file's id, once the upload succeeded. */
  fileId: string | null;
  error: string | null;
}

export interface PendingUpload {
  /** The optimistic row's clientId (`pending-<uuid>`). */
  clientId: string;
  /** The server's id for the message, once the send was acked. */
  messageId: string | null;
  /** The message has text besides its files (so removing every file doesn't leave it empty). */
  hasText: boolean;
  files: PendingFile[];
}

type Listener = () => void;

const byClientId = new Map<string, PendingUpload>();
const clientIdByMessageId = new Map<string, string>();
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of [...listeners]) listener();
}

export function subscribePendingUploads(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The entry for a clientId or a server message id. Returns the same object until it changes. */
export function getPendingUpload(key: string | null | undefined): PendingUpload | undefined {
  if (!key) return undefined;
  const direct = byClientId.get(key);
  if (direct) return direct;
  const clientId = clientIdByMessageId.get(key);
  return clientId ? byClientId.get(clientId) : undefined;
}

/** Every entry, e.g. to tell whether anything is still uploading. */
export function listPendingUploads(): PendingUpload[] {
  return [...byClientId.values()];
}

/** Adds or replaces an entry. */
export function setPendingUpload(entry: PendingUpload): void {
  const previous = byClientId.get(entry.clientId);
  if (previous?.messageId && previous.messageId !== entry.messageId) {
    clientIdByMessageId.delete(previous.messageId);
  }
  byClientId.set(entry.clientId, entry);
  if (entry.messageId) clientIdByMessageId.set(entry.messageId, entry.clientId);
  emit();
}

/** Applies `update` to an entry (no-op for an unknown clientId). */
export function updatePendingUpload(
  clientId: string,
  update: (entry: PendingUpload) => PendingUpload,
): PendingUpload | undefined {
  const current = byClientId.get(clientId);
  if (!current) return undefined;
  const next = update(current);
  if (next !== current) setPendingUpload(next);
  return next;
}

/** Applies `patch` to one file of an entry. */
export function updatePendingFile(
  clientId: string,
  localId: string,
  patch: Partial<PendingFile>,
): PendingUpload | undefined {
  return updatePendingUpload(clientId, (entry) => {
    const index = entry.files.findIndex((f) => f.localId === localId);
    if (index < 0) return entry;
    const current = entry.files[index];
    const changed = (Object.keys(patch) as (keyof PendingFile)[]).some((k) => current[k] !== patch[k]);
    if (!changed) return entry;
    const files = entry.files.slice();
    files[index] = { ...current, ...patch };
    return { ...entry, files };
  });
}

function revokePreview(file: PendingFile): void {
  if (file.previewUrl) URL.revokeObjectURL(file.previewUrl);
}

/** Drops one file from an entry and revokes its thumbnail URL. */
export function removePendingFile(clientId: string, localId: string): PendingUpload | undefined {
  return updatePendingUpload(clientId, (entry) => {
    const file = entry.files.find((f) => f.localId === localId);
    if (!file) return entry;
    revokePreview(file);
    return { ...entry, files: entry.files.filter((f) => f.localId !== localId) };
  });
}

/** Drops an entry and revokes its thumbnail URLs. */
export function deletePendingUpload(clientId: string): void {
  const entry = byClientId.get(clientId);
  if (!entry) return;
  entry.files.forEach(revokePreview);
  byClientId.delete(clientId);
  if (entry.messageId) clientIdByMessageId.delete(entry.messageId);
  emit();
}

/** Object URL for a thumbnail of `file` (images and videos only). */
export function createPreviewUrl(file: File): string | null {
  const type = file.type.toLowerCase();
  if (!type.startsWith("image/") && !type.startsWith("video/")) return null;
  try {
    return URL.createObjectURL(file);
  } catch {
    return null;
  }
}

/** Test helper: forget every entry. */
export function resetPendingUploadsForTests(): void {
  for (const entry of byClientId.values()) entry.files.forEach(revokePreview);
  byClientId.clear();
  clientIdByMessageId.clear();
  emit();
}
