/**
 * endLocalSession clears the new design's session state (review I5, joined with #807's teardown):
 * one clearShellSessionState call, after the per-tab drafts and before the cache clear.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from '@testing-library/react';
import { createTestQueryClient } from '../test-utils';
import { STORAGE_KEY } from '../../theme/constants';
import { readDesignPreview, setDesignPreview } from '../../shell/designPreview';
import { takeFirstAnnouncement } from '../../shell/bannerMemory';
import { readDesktopSignInNotice, showDesktopSignInNotice } from '../../data/signInNotice';
import { onForgetNewDesignSetting } from '../../contexts/newDesignCache';

const calls = vi.hoisted(() => [] as string[]);

vi.mock('../../utils/socketSingleton', () => ({ disconnectSocket: vi.fn() }));
vi.mock('../../shell/sessionState', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../shell/sessionState')>();
  return {
    ...actual,
    clearShellSessionState: (...args: Parameters<typeof actual.clearShellSessionState>) => {
      calls.push('clearShellSessionState');
      actual.clearShellSessionState(...args);
    },
  };
});
vi.mock('../../hooks/useComposerDraft', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/useComposerDraft')>();
  return {
    ...actual,
    clearComposerDrafts: () => {
      calls.push('clearComposerDrafts');
      actual.clearComposerDrafts();
    },
  };
});
vi.mock('../../utils/clearSessionCaches', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/clearSessionCaches')>();
  return {
    ...actual,
    clearSessionCaches: (...args: Parameters<typeof actual.clearSessionCaches>) => {
      calls.push('clearSessionCaches');
      actual.clearSessionCaches(...args);
    },
  };
});

import { endLocalSession } from '../../utils/endLocalSession';

const APPEARANCE_KEY = [{ _id: 'appearanceSettingsControllerGetSettings' }];

describe('endLocalSession: the new design session state', () => {
  beforeEach(() => {
    calls.length = 0;
    localStorage.clear();
    sessionStorage.clear();
  });

  it('forgets the setting (storage, cached query, provider value), the preview, the sign-in notice and the banners heard', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode: 'dark', newDesign: true }));
    setDesignPreview('lounge');
    act(() => showDesktopSignInNotice());
    takeFirstAnnouncement('banner:heard');
    const providerForgot = vi.fn();
    const unregister = onForgetNewDesignSetting(providerForgot);
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(APPEARANCE_KEY, { newDesign: true });

    act(() => endLocalSession(queryClient));
    unregister();

    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')).toEqual({ mode: 'dark', newDesign: false });
    expect(queryClient.getQueryData(APPEARANCE_KEY)).toBeUndefined();
    expect(providerForgot).toHaveBeenCalledTimes(1);
    expect(readDesignPreview()).toBeNull();
    expect(readDesktopSignInNotice()).toBe(false);
    expect(takeFirstAnnouncement('banner:heard')).toBe(true);
  });

  it('clears it once, with the per-tab state, before the cache clear', () => {
    endLocalSession(createTestQueryClient());
    expect(calls).toEqual(['clearComposerDrafts', 'clearShellSessionState', 'clearSessionCaches']);
  });
});
