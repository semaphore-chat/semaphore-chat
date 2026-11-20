import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const cache = vi.hoisted(() => ({ getBlob: vi.fn(() => 'blob:cached'), fetchBlob: vi.fn(async () => 'blob:fetched') }));
vi.mock('../../../contexts/AvatarCacheContext', () => ({ useFileCache: () => cache }));
const download = vi.hoisted(() => vi.fn());
vi.mock('../../../utils/format', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  downloadBlob: download,
}));

import { createElectronWrapper, createFakeElectronAPI } from '../../test-utils';
import { TYPED_URL_LIFETIME_MS, attachmentAction, useAttachmentBusy, useAttachmentOpener } from '../../../data/chat/useAttachmentOpener';

describe('attachmentAction (from the server-reported type)', () => {
  it.each([
    ['image/png', 'open'],
    ['image/jpeg', 'open'],
    ['image/gif', 'open'],
    ['image/webp', 'open'],
    ['image/avif', 'open'],
    ['image/bmp', 'open'],
    ['IMAGE/PNG; charset=binary', 'open'],
    ['image/svg+xml', 'download'],
    ['text/html', 'download'],
    ['application/xhtml+xml', 'download'],
    ['application/pdf', 'download'],
    ['application/octet-stream', 'download'],
    ['', 'download'],
  ])('%s → %s', (type, action) => {
    expect(attachmentAction(type)).toBe(action);
  });
});

describe('useAttachmentOpener', () => {
  let tab: { opener: unknown; location: { href: string }; close: () => void };
  let open: ReturnType<typeof vi.fn>;
  let typedBlobs: Blob[];

  beforeEach(() => {
    vi.clearAllMocks();
    tab = { opener: {}, location: { href: '' }, close: vi.fn() };
    open = vi.fn(() => tab);
    vi.stubGlobal('open', open);
    typedBlobs = [];
    vi.stubGlobal('fetch', vi.fn(async () => ({ blob: async () => new Blob(['<svg/>'], { type: 'image/svg+xml' }) })));
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      typedBlobs.push(blob as Blob);
      return 'blob:typed';
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('a PNG opens in a new tab, as a copy typed exactly image/png, with no opener', async () => {
    const { result } = renderHook(() => useAttachmentOpener());
    act(() => result.current.open({ id: 'f-1', name: 'shot.png', mimeType: 'image/png' }));
    expect(open).toHaveBeenCalledWith('', '_blank');
    await waitFor(() => expect(tab.location.href).toBe('blob:typed'));
    expect(typedBlobs[0].type).toBe('image/png');
    expect(tab.opener).toBeNull();
    expect(download).not.toHaveBeenCalled();
  });

  it.each([
    ['an SVG', 'drawing.svg', 'image/svg+xml'],
    ['an HTML page', 'page.html', 'text/html'],
    ['an unknown type', 'thing.bin', 'application/x-unknown'],
    ['a file named .png that is really SVG', 'innocent.png', 'image/svg+xml'],
  ])('%s is downloaded, never opened or navigated to', async (_, name, mimeType) => {
    const { result } = renderHook(() => useAttachmentOpener());
    act(() => result.current.open({ id: 'f-2', name, mimeType }));
    await waitFor(() => expect(download).toHaveBeenCalledWith('blob:cached', name));
    expect(open).not.toHaveBeenCalled();
    expect(tab.location.href).toBe('');
  });

  it('in the desktop app a picture downloads too (no tab), and a failure is told', async () => {
    const onError = vi.fn();
    const wrapper = createElectronWrapper(createFakeElectronAPI());
    const { result } = renderHook(() => useAttachmentOpener(onError), { wrapper });
    act(() => result.current.open({ id: 'f-1', name: 'shot.png', mimeType: 'image/png' }));
    await waitFor(() => expect(download).toHaveBeenCalledWith('blob:cached', 'shot.png'));
    expect(open).not.toHaveBeenCalled();

    cache.getBlob.mockReturnValueOnce(null as never);
    cache.fetchBlob.mockRejectedValueOnce(new Error('offline'));
    act(() => result.current.open({ id: 'f-2', name: 'notes.txt', mimeType: 'text/plain' }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith("Couldn't download notes.txt"));
    expect(open).not.toHaveBeenCalled();
  });

  it('cuts the tab’s opener before any wait, and nothing later depends on it', async () => {
    let resolve: (url: string) => void = () => undefined;
    cache.getBlob.mockReturnValueOnce(null as never);
    cache.fetchBlob.mockReturnValueOnce(new Promise<string>((r) => (resolve = r)));
    const { result } = renderHook(() => useAttachmentOpener());
    act(() => result.current.open({ id: 'f-1', name: 'shot.png', mimeType: 'image/png' }));
    // Still fetching: the tab already has no opener.
    expect(tab.opener).toBeNull();
    // A page in the tab that set an opener again is not touched by the rest of the open.
    tab.opener = 'not ours';
    await act(async () => resolve('blob:late'));
    await waitFor(() => expect(tab.location.href).toBe('blob:typed'));
    expect(tab.opener).toBe('not ours');
  });

  it('revokes the typed copy after a bounded delay, and on unmount', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const { result, unmount } = renderHook(() => useAttachmentOpener());
      act(() => result.current.open({ id: 'f-1', name: 'a.png', mimeType: 'image/png' }));
      await vi.waitFor(() => expect(tab.location.href).toBe('blob:typed'));
      expect(revoke).not.toHaveBeenCalled();
      vi.advanceTimersByTime(TYPED_URL_LIFETIME_MS);
      expect(revoke).toHaveBeenCalledWith('blob:typed');

      revoke.mockClear();
      tab.location.href = '';
      act(() => result.current.open({ id: 'f-2', name: 'b.png', mimeType: 'image/png' }));
      await vi.waitFor(() => expect(tab.location.href).toBe('blob:typed'));
      unmount();
      expect(revoke).toHaveBeenCalledWith('blob:typed');
    } finally {
      vi.useRealTimers();
    }
  });

  it('fetches a file not in the cache, says when it fails, and closes the opened tab', async () => {
    cache.getBlob.mockReturnValueOnce(null as never);
    cache.fetchBlob.mockRejectedValueOnce(new Error('offline'));
    const onError = vi.fn();
    const { result } = renderHook(() => useAttachmentOpener(onError));
    act(() => result.current.open({ id: 'f-3', name: 'shot.png', mimeType: 'image/png' }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith("Couldn't open shot.png"));
    expect(tab.close).toHaveBeenCalled();
  });

  it('is the same object on every render, and busy is read per file', async () => {
    let resolve: (url: string) => void = () => undefined;
    cache.getBlob.mockReturnValueOnce(null as never);
    cache.fetchBlob.mockReturnValueOnce(new Promise<string>((r) => (resolve = r)));
    const { result, rerender } = renderHook(() => {
      const opener = useAttachmentOpener();
      return { opener, busy1: useAttachmentBusy(opener, 'f-1'), busy2: useAttachmentBusy(opener, 'f-2') };
    });
    const first = result.current.opener;
    rerender();
    expect(result.current.opener).toBe(first);
    act(() => first.open({ id: 'f-1', name: 'a.txt', mimeType: 'text/plain' }));
    expect(result.current).toMatchObject({ busy1: true, busy2: false });
    await act(async () => resolve('blob:late'));
    await waitFor(() => expect(result.current.busy1).toBe(false));
  });
});
