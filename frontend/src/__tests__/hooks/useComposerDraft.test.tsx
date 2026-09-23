/**
 * Composer drafts (mobile UX overhaul, task 13): the unsent text of each
 * channel / DM lives in sessionStorage so it survives the composer unmounting
 * (switching screens on mobile), and is cleared once the message is sent.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  useComposerDraft,
  composerDraftStorageKey,
} from '../../hooks/useComposerDraft';

describe('useComposerDraft', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it('starts empty when there is no saved draft', () => {
    const { result } = renderHook(() => useComposerDraft('channel:c1'));
    expect(result.current[0]).toBe('');
  });

  it('saves the text and restores it after an unmount and remount', () => {
    const first = renderHook(() => useComposerDraft('channel:c1'));
    act(() => first.result.current[1]('half-written'));
    expect(first.result.current[0]).toBe('half-written');
    first.unmount();

    const second = renderHook(() => useComposerDraft('channel:c1'));
    expect(second.result.current[0]).toBe('half-written');
  });

  it('keeps drafts separate per context and swaps them when the key changes', () => {
    const { result, rerender } = renderHook(({ k }) => useComposerDraft(k), {
      initialProps: { k: 'channel:c1' },
    });
    act(() => result.current[1]('for c1'));

    rerender({ k: 'dm:d1' });
    expect(result.current[0]).toBe('');
    act(() => result.current[1]('for d1'));

    rerender({ k: 'channel:c1' });
    expect(result.current[0]).toBe('for c1');
    rerender({ k: 'dm:d1' });
    expect(result.current[0]).toBe('for d1');
  });

  it('clearDraft empties the text and removes the stored draft', () => {
    const { result } = renderHook(() => useComposerDraft('channel:c1'));
    act(() => result.current[1]('hello'));
    expect(sessionStorage.getItem(composerDraftStorageKey('channel:c1'))).toBe('hello');

    act(() => result.current[2]());
    expect(result.current[0]).toBe('');
    expect(sessionStorage.getItem(composerDraftStorageKey('channel:c1'))).toBeNull();
  });

  it('removes the stored draft when the text becomes empty', () => {
    const { result } = renderHook(() => useComposerDraft('channel:c1'));
    act(() => result.current[1]('x'));
    act(() => result.current[1](''));
    expect(sessionStorage.getItem(composerDraftStorageKey('channel:c1'))).toBeNull();
  });

  it('still works as plain state when sessionStorage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });

    const { result } = renderHook(() => useComposerDraft('channel:c1'));
    expect(result.current[0]).toBe('');
    act(() => result.current[1]('typed anyway'));
    expect(result.current[0]).toBe('typed anyway');
    act(() => result.current[2]());
    expect(result.current[0]).toBe('');
  });
});

describe('clearComposerDrafts', () => {
  it('removes saved drafts but leaves other session data alone', async () => {
    const { clearComposerDrafts } = await import('../../hooks/useComposerDraft');
    sessionStorage.setItem(composerDraftStorageKey('channel:c1'), 'a');
    sessionStorage.setItem(composerDraftStorageKey('dm:d1'), 'b');
    sessionStorage.setItem('unrelated', 'keep');

    clearComposerDrafts();

    expect(sessionStorage.getItem(composerDraftStorageKey('channel:c1'))).toBeNull();
    expect(sessionStorage.getItem(composerDraftStorageKey('dm:d1'))).toBeNull();
    expect(sessionStorage.getItem('unrelated')).toBe('keep');
  });
});
