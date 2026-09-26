import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const tokenState = { token: 'token-1' as string | null };
const refreshSessionWithRetry = vi.fn();
vi.mock('../../utils/tokenService', () => ({
  getAccessToken: () => tokenState.token,
  refreshSessionWithRetry: () => refreshSessionWithRetry(),
}));

import {
  uploadFileWithProgress,
  UploadAbortedError,
  UploadHttpError,
} from '../../utils/uploadFileWithProgress';

/** Minimal XMLHttpRequest stand-in: records requests, the test drives their events. */
class FakeXhr {
  static instances: FakeXhr[] = [];
  method = '';
  url = '';
  headers: Record<string, string> = {};
  body: FormData | null = null;
  status = 0;
  responseText = '';
  responseType = '';
  upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  aborted = false;

  constructor() {
    FakeXhr.instances.push(this);
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send(body: FormData) {
    this.body = body;
  }
  abort() {
    this.aborted = true;
    this.onabort?.();
  }
  progress(loaded: number, total: number) {
    this.upload.onprogress?.({ lengthComputable: true, loaded, total });
  }
  respond(status: number, body: unknown) {
    this.status = status;
    this.responseText = JSON.stringify(body);
    this.onload?.();
  }
}

const file = () => new File(['hello world'], 'hello.txt', { type: 'text/plain' });
const last = () => FakeXhr.instances[FakeXhr.instances.length - 1];

beforeEach(() => {
  FakeXhr.instances = [];
  tokenState.token = 'token-1';
  refreshSessionWithRetry.mockReset();
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('uploadFileWithProgress', () => {
  it('posts the file with its resource and the bearer token, and reports progress', async () => {
    const onProgress = vi.fn();
    const promise = uploadFileWithProgress(file(), { resourceType: 'MESSAGE_ATTACHMENT', resourceId: 'msg-1', onProgress });
    const xhr = last();
    expect(xhr.method).toBe('POST');
    expect(xhr.url).toMatch(/\/file-upload$/);
    expect(xhr.headers.Authorization).toBe('Bearer token-1');
    expect(xhr.body?.get('resourceType')).toBe('MESSAGE_ATTACHMENT');
    expect(xhr.body?.get('resourceId')).toBe('msg-1');
    expect((xhr.body?.get('file') as File).name).toBe('hello.txt');

    xhr.progress(25, 100);
    xhr.progress(100, 100);
    xhr.respond(201, { id: 'file-1', filename: 'hello.txt', mimeType: 'text/plain', fileType: 'OTHER', size: 11 });

    await expect(promise).resolves.toMatchObject({ id: 'file-1' });
    expect(onProgress.mock.calls.map((c) => c[0])).toEqual([0.25, 1, 1]);
  });

  it('rejects with the server message on an error status', async () => {
    const promise = uploadFileWithProgress(file(), { resourceType: 'MESSAGE_ATTACHMENT' });
    last().respond(413, { statusCode: 413, message: 'File too large' });
    const error = await promise.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UploadHttpError);
    expect(error).toMatchObject({ message: 'File too large', status: 413 });
  });

  it('rejects with a network error', async () => {
    const promise = uploadFileWithProgress(file(), { resourceType: 'MESSAGE_ATTACHMENT' });
    last().onerror?.();
    await expect(promise).rejects.toThrow('Network error while uploading');
  });

  it('aborts through the signal', async () => {
    const controller = new AbortController();
    const promise = uploadFileWithProgress(file(), { resourceType: 'MESSAGE_ATTACHMENT', signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toBeInstanceOf(UploadAbortedError);
    expect(last().aborted).toBe(true);
  });

  it('refreshes an expired token once and uploads again', async () => {
    refreshSessionWithRetry.mockResolvedValue({ status: 'refreshed', token: 'token-2' });
    const onProgress = vi.fn();
    const promise = uploadFileWithProgress(file(), { resourceType: 'MESSAGE_ATTACHMENT', onProgress });
    FakeXhr.instances[0].respond(401, { statusCode: 401, message: 'Unauthorized' });
    await vi.waitFor(() => expect(FakeXhr.instances).toHaveLength(2));
    expect(FakeXhr.instances[1].headers.Authorization).toBe('Bearer token-2');
    FakeXhr.instances[1].respond(201, { id: 'file-2' });
    await expect(promise).resolves.toMatchObject({ id: 'file-2' });
    // Progress starts over for the second attempt.
    expect(onProgress).toHaveBeenCalledWith(0);
  });

  it('gives up when the session can\'t be refreshed', async () => {
    refreshSessionWithRetry.mockResolvedValue({ status: 'rejected' });
    const promise = uploadFileWithProgress(file(), { resourceType: 'MESSAGE_ATTACHMENT' });
    last().respond(401, { statusCode: 401, message: 'Unauthorized' });
    await expect(promise).rejects.toMatchObject({ status: 401 });
    expect(FakeXhr.instances).toHaveLength(1);
  });

  it('fails without a token', async () => {
    tokenState.token = null;
    await expect(uploadFileWithProgress(file(), { resourceType: 'MESSAGE_ATTACHMENT' })).rejects.toThrow('No authentication token found');
  });
});
