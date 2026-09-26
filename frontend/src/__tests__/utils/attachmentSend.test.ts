import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { InfiniteData } from '@tanstack/react-query';

// Uploads and the REST calls are faked; everything else (cache updaters,
// store, reconciliation) is the real code.
const uploads: {
  file: File;
  resourceId: string | null | undefined;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
  resolve: (value: { id: string }) => void;
  reject: (error: unknown) => void;
}[] = [];

vi.mock('../../utils/uploadFileWithProgress', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/uploadFileWithProgress')>();
  return {
    ...actual,
    uploadFileWithProgress: vi.fn(
      (file: File, options: { resourceId?: string | null; onProgress?: (f: number) => void; signal?: AbortSignal }) =>
        new Promise((resolve, reject) => {
          uploads.push({ file, resourceId: options.resourceId, onProgress: options.onProgress, signal: options.signal, resolve, reject });
          options.signal?.addEventListener('abort', () => reject(new actual.UploadAbortedError()));
        }),
    ),
  };
});

const addAttachment = vi.fn();
const removeMessage = vi.fn();
vi.mock('../../api-client/sdk.gen', () => ({
  messagesControllerAddAttachment: (...args: unknown[]) => addAttachment(...args),
  messagesControllerRemove: (...args: unknown[]) => removeMessage(...args),
}));

import {
  sendMessageWithAttachments,
  retryAttachment,
  removeAttachment,
  startAttachmentUploads,
  discardAttachmentSend,
  resetAttachmentSendsForTests,
  type AttachmentSendRuntime,
} from '../../utils/attachmentSend';
import { getPendingUpload, resetPendingUploadsForTests } from '../../utils/pendingUploadStore';
import { uploadFileWithProgress } from '../../utils/uploadFileWithProgress';
import { VoiceSessionType } from '../../contexts/VoiceContext';
import { channelMessagesQueryKey, dmMessagesQueryKey } from '../../utils/messageQueryKeys';
import { handleNewMessage } from '../../socket-hub/handlers/messageHandlers';
import type { PaginatedMessagesResponseDto } from '../../api-client';
import { createTestQueryClient, createInfiniteData, createMessage, createFileMetadata } from '../test-utils';
import type { Message } from '../../types/message.type';
import type { NewMessagePayload, SendMessageResult } from '../../hooks/useSendMessage';

let queryClient: ReturnType<typeof createTestQueryClient>;
const notifyError = vi.fn();
const seedFileBlob = vi.fn();

const channelKey = channelMessagesQueryKey('ch-1');

function runtime(contextType = VoiceSessionType.Channel, contextId = 'ch-1'): AttachmentSendRuntime {
  return { queryClient, contextType, contextId, notifyError, seedFileBlob };
}

function payload(text = 'look at these', extra: Partial<NewMessagePayload> = {}): NewMessagePayload {
  return {
    channelId: 'ch-1',
    authorId: 'me',
    spans: [{ type: 'PLAINTEXT' as never, text }],
    attachments: [],
    reactions: [],
    sentAt: '2026-09-22T18:30:00.000Z',
    ...extra,
  };
}

function files(): File[] {
  return [
    new File(['png-bytes'], 'photo.png', { type: 'image/png' }),
    new File(['pdf-bytes-longer'], 'report.pdf', { type: 'application/pdf' }),
  ];
}

function cacheMessages(key: readonly unknown[] = channelKey): Message[] {
  const data = queryClient.getQueryData<InfiniteData<PaginatedMessagesResponseDto>>(key);
  return (data?.pages.flatMap((p) => p.messages) ?? []) as unknown as Message[];
}

const ack = (messageId: string) => vi.fn(async (): Promise<SendMessageResult> => ({ success: true, messageId }));

/** Server copy of msg-1 with the given files attached (what POST /attachments answers). */
function serverMessage(attached: { id: string; filename: string; mimeType: string }[], pendingAttachments = 0): Message {
  return createMessage({
    id: 'msg-1',
    channelId: 'ch-1',
    authorId: 'me',
    spans: [{ type: 'PLAINTEXT' as never, text: 'look at these' }],
    attachments: attached.map((a) => createFileMetadata(a)),
    pendingAttachments,
  });
}

async function flush() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

beforeEach(() => {
  uploads.length = 0;
  vi.clearAllMocks();
  queryClient = createTestQueryClient();
  queryClient.setQueryData(channelKey, createInfiniteData([]));
  addAttachment.mockImplementation(async ({ body }: { body: { fileId?: string } }) => ({
    data: serverMessage(body.fileId ? [{ id: body.fileId, filename: 'x', mimeType: 'image/png' }] : []),
  }));
  removeMessage.mockResolvedValue({ data: undefined });
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  resetAttachmentSendsForTests();
  resetPendingUploadsForTests();
});

describe('sendMessageWithAttachments', () => {
  it('shows a pending row with the files waiting before the server acks', async () => {
    const send = vi.fn(() => new Promise<SendMessageResult>(() => {}));
    void sendMessageWithAttachments({ runtime: runtime(), payload: payload(), files: files(), send });

    const [row] = cacheMessages();
    expect(row.sendStatus).toBe('pending');
    expect(row.clientId).toBe(row.id);
    expect(row.pendingAttachments).toBe(2);
    expect(row.attachments).toEqual([]);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ pendingAttachments: 2, attachments: [] }));

    const entry = getPendingUpload(row.clientId);
    expect(entry?.messageId).toBeNull();
    expect(entry?.files.map((f) => [f.name, f.status])).toEqual([
      ['photo.png', 'waiting'],
      ['report.pdf', 'waiting'],
    ]);
    // Thumbnail URL for the image only.
    expect(entry?.files[0].previewUrl).toBe('blob:preview');
    expect(entry?.files[1].previewUrl).toBeNull();
    expect(uploadFileWithProgress).not.toHaveBeenCalled();
  });

  it('works the same in a DM', async () => {
    const dmKey = dmMessagesQueryKey('dm-1');
    queryClient.setQueryData(dmKey, createInfiniteData([]));
    const send = ack('msg-1');
    await sendMessageWithAttachments({
      runtime: runtime(VoiceSessionType.Dm, 'dm-1'),
      payload: payload('hi', { channelId: undefined, directMessageGroupId: 'dm-1' }),
      files: files(),
      send,
    });
    const [row] = cacheMessages(dmKey);
    expect(row.id).toBe('msg-1');
    expect(row.directMessageGroupId).toBe('dm-1');
    expect(uploads.map((u) => u.resourceId)).toEqual(['msg-1', 'msg-1']);
  });

  it('uploads every file once acked, tracks progress, attaches and reconciles without losing the clientId', async () => {
    const result = await sendMessageWithAttachments({ runtime: runtime(), payload: payload(), files: files(), send: ack('msg-1') });
    expect(result).toEqual({ success: true, messageId: 'msg-1' });

    const [row] = cacheMessages();
    const clientId = row.clientId!;
    expect(row.id).toBe('msg-1');
    expect(row.sendStatus).toBeUndefined();
    expect(getPendingUpload('msg-1')?.clientId).toBe(clientId);

    expect(uploads).toHaveLength(2);
    expect(uploads[0].resourceId).toBe('msg-1');
    uploads[0].onProgress?.(0.426);
    expect(getPendingUpload(clientId)?.files[0]).toMatchObject({ status: 'uploading', progress: 0.42 });

    uploads[0].resolve({ id: 'file-a' });
    await flush();
    expect(addAttachment).toHaveBeenCalledWith(expect.objectContaining({ path: { id: 'msg-1' }, body: { fileId: 'file-a' } }));
    expect(seedFileBlob).toHaveBeenCalledWith('file-a', expect.any(File));
    const afterFirst = cacheMessages()[0];
    expect(afterFirst.attachments.map((a) => a.id)).toEqual(['file-a']);
    expect(afterFirst.clientId).toBe(clientId);
    expect(getPendingUpload(clientId)?.files.map((f) => f.status)).toEqual(['done', 'uploading']);

    uploads[1].resolve({ id: 'file-b' });
    await flush();
    // Every file attached: the entry is gone and its thumbnail URLs revoked.
    expect(getPendingUpload(clientId)).toBeUndefined();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
  });

  it('attaches one file at a time per message', async () => {
    let releaseFirst: () => void = () => {};
    addAttachment.mockImplementationOnce(
      ({ body }: { body: { fileId: string } }) =>
        new Promise((resolve) => {
          releaseFirst = () => resolve({ data: serverMessage([{ id: body.fileId, filename: 'a', mimeType: 'image/png' }]) });
        }),
    );
    await sendMessageWithAttachments({ runtime: runtime(), payload: payload(), files: files(), send: ack('msg-1') });
    uploads[0].resolve({ id: 'file-a' });
    uploads[1].resolve({ id: 'file-b' });
    await flush();
    expect(addAttachment).toHaveBeenCalledTimes(1);
    releaseFirst();
    await flush();
    expect(addAttachment).toHaveBeenCalledTimes(2);
  });

  it('a failed send marks the row failed and keeps its files waiting', async () => {
    const send = vi.fn(async (): Promise<SendMessageResult> => ({ success: false, error: new Error('timed out') }));
    await sendMessageWithAttachments({ runtime: runtime(), payload: payload(), files: files(), send });
    const [row] = cacheMessages();
    expect(row.sendStatus).toBe('failed');
    expect(getPendingUpload(row.clientId)?.files.every((f) => f.status === 'waiting')).toBe(true);
    expect(uploadFileWithProgress).not.toHaveBeenCalled();
    expect(notifyError).not.toHaveBeenCalled();

    // A resend that succeeds starts the uploads (see useOptimisticMessageRetry).
    startAttachmentUploads(row.clientId!, 'msg-1');
    expect(uploads).toHaveLength(2);
  });

  it('in a window detached from the live edge: no row; a failure is a toast and the files are dropped', async () => {
    queryClient.setQueryData(channelKey, { pages: [{ messages: [] }], pageParams: ['older-cursor'] });
    const send = vi.fn(async (): Promise<SendMessageResult> => ({ success: false, error: new Error('Socket not connected') }));
    await sendMessageWithAttachments({ runtime: runtime(), payload: payload(), files: files(), send });
    expect(cacheMessages()).toHaveLength(0);
    expect(notifyError).toHaveBeenCalledWith('Socket not connected');
  });

  it('reconciles with an echo that beats the ack, and a late echo can start the uploads', async () => {
    let resolveSend: (r: SendMessageResult) => void = () => {};
    const send = vi.fn(() => new Promise<SendMessageResult>((r) => { resolveSend = r; }));
    void sendMessageWithAttachments({ runtime: runtime(), payload: payload(), files: files(), send });
    const clientId = cacheMessages()[0].clientId!;

    await handleNewMessage({ message: serverMessage([], 2) as never }, queryClient);
    const [row] = cacheMessages();
    expect(row.id).toBe('msg-1');
    expect(row.clientId).toBe(clientId);

    resolveSend({ success: true, messageId: 'msg-1' });
    await flush();
    expect(cacheMessages()).toHaveLength(1);
    expect(uploads).toHaveLength(2);
  });
});

describe('failures, retry, remove and cancel', () => {
  async function sendAndFailFirstUpload() {
    await sendMessageWithAttachments({ runtime: runtime(), payload: payload(), files: files(), send: ack('msg-1') });
    const clientId = cacheMessages()[0].clientId!;
    uploads[0].reject(new Error('Network error while uploading'));
    await flush();
    return clientId;
  }

  it('a failed upload marks that file failed and says so', async () => {
    const clientId = await sendAndFailFirstUpload();
    expect(getPendingUpload(clientId)?.files[0]).toMatchObject({ status: 'failed', error: 'Network error while uploading' });
    expect(notifyError).toHaveBeenCalledWith("Couldn't upload photo.png: Network error while uploading");
  });

  it('Retry re-uploads just that file and completes the message', async () => {
    const clientId = await sendAndFailFirstUpload();
    uploads[1].resolve({ id: 'file-b' });
    await flush();

    void retryAttachment(clientId, 'f0');
    expect(uploads).toHaveLength(3);
    expect(uploads[2].file.name).toBe('photo.png');
    expect(getPendingUpload(clientId)?.files[0].status).toBe('uploading');
    uploads[2].resolve({ id: 'file-a' });
    await flush();
    expect(addAttachment).toHaveBeenLastCalledWith(expect.objectContaining({ body: { fileId: 'file-a' } }));
    expect(getPendingUpload(clientId)).toBeUndefined();
  });

  it('Retry after a failed attach only re-attaches (no second upload)', async () => {
    addAttachment.mockRejectedValueOnce({ statusCode: 500, message: 'Internal server error' });
    await sendMessageWithAttachments({ runtime: runtime(), payload: payload(), files: files().slice(0, 1), send: ack('msg-1') });
    const clientId = cacheMessages()[0].clientId!;
    uploads[0].resolve({ id: 'file-a' });
    await flush();
    expect(getPendingUpload(clientId)?.files[0]).toMatchObject({ status: 'failed', fileId: 'file-a', error: 'Internal server error' });

    await retryAttachment(clientId, 'f0');
    expect(uploads).toHaveLength(1);
    expect(addAttachment).toHaveBeenCalledTimes(2);
    expect(getPendingUpload(clientId)).toBeUndefined();
  });

  it('Remove drops the failed file and releases its slot; the message keeps its text', async () => {
    const clientId = await sendAndFailFirstUpload();
    await removeAttachment(clientId, 'f0');
    expect(addAttachment).toHaveBeenCalledWith(expect.objectContaining({ path: { id: 'msg-1' }, body: {} }));
    expect(getPendingUpload(clientId)?.files.map((f) => f.name)).toEqual(['report.pdf']);
    expect(removeMessage).not.toHaveBeenCalled();
    expect(cacheMessages()).toHaveLength(1);
  });

  it('removing the only file of a message without text deletes the message', async () => {
    await sendMessageWithAttachments({ runtime: runtime(), payload: payload(''), files: files().slice(0, 1), send: ack('msg-1') });
    const clientId = cacheMessages()[0].clientId!;
    uploads[0].reject(new Error('File too large'));
    await flush();

    await removeAttachment(clientId, 'f0');
    expect(removeMessage).toHaveBeenCalledWith(expect.objectContaining({ path: { id: 'msg-1' } }));
    expect(cacheMessages()).toHaveLength(0);
    expect(getPendingUpload(clientId)).toBeUndefined();
  });

  it('Cancel aborts an upload in progress and drops the file', async () => {
    await sendMessageWithAttachments({ runtime: runtime(), payload: payload(), files: files(), send: ack('msg-1') });
    const clientId = cacheMessages()[0].clientId!;
    uploads[1].onProgress?.(0.3);

    await removeAttachment(clientId, 'f1');
    expect(uploads[1].signal?.aborted).toBe(true);
    expect(addAttachment).toHaveBeenCalledWith(expect.objectContaining({ body: {} }));
    await flush();
    // Aborting isn't reported as a failure.
    expect(notifyError).not.toHaveBeenCalled();
    expect(getPendingUpload(clientId)?.files.map((f) => f.name)).toEqual(['photo.png']);

    uploads[0].resolve({ id: 'file-a' });
    await flush();
    expect(getPendingUpload(clientId)).toBeUndefined();
  });

  it('forgets the uploads when the message was deleted meanwhile (attach answers 404)', async () => {
    addAttachment.mockRejectedValueOnce({ statusCode: 404, message: 'Not Found' });
    await sendMessageWithAttachments({ runtime: runtime(), payload: payload(), files: files().slice(0, 1), send: ack('msg-1') });
    const clientId = cacheMessages()[0].clientId!;
    uploads[0].resolve({ id: 'file-a' });
    await flush();
    expect(getPendingUpload(clientId)).toBeUndefined();
    expect(notifyError).not.toHaveBeenCalled();
  });

  it('discardAttachmentSend aborts and forgets everything', async () => {
    await sendMessageWithAttachments({ runtime: runtime(), payload: payload(), files: files(), send: ack('msg-1') });
    const clientId = cacheMessages()[0].clientId!;
    discardAttachmentSend(clientId);
    expect(uploads.every((u) => u.signal?.aborted)).toBe(true);
    expect(getPendingUpload(clientId)).toBeUndefined();
  });

  it('keeps uploading after the conversation is left (nothing depends on a mounted component)', async () => {
    await sendMessageWithAttachments({ runtime: runtime(), payload: payload(), files: files().slice(0, 1), send: ack('msg-1') });
    const clientId = cacheMessages()[0].clientId!;
    // The query is gone (left the channel and it was garbage-collected).
    queryClient.removeQueries({ queryKey: channelKey });
    uploads[0].resolve({ id: 'file-a' });
    await flush();
    expect(addAttachment).toHaveBeenCalledWith(expect.objectContaining({ body: { fileId: 'file-a' } }));
    expect(getPendingUpload(clientId)).toBeUndefined();
  });
});
