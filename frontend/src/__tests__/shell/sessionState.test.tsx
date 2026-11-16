/**
 * clearShellSessionState (review I5): one teardown for the new design's per-session state, called on
 * every session-ending path. The paths are tested in AuthGate.test, useLogout.test and here (Settings'
 * server switch is covered by its own call; see the report).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { clearShellSessionState } from '../../shell/sessionState';
import { setDesignPreview, readDesignPreview, clearDesignPreview } from '../../shell/designPreview';
import { showDesktopSignInNotice, useDesktopSignInBanner } from '../../data/signInNotice';
import { takeFirstAnnouncement } from '../../shell/bannerMemory';
import { rememberActivatedRow, rememberedRow, rowMarker } from '../../shell/routeMemory';
import { LAST_COMMUNITY_KEY, rememberLastCommunity, readLastCommunity } from '../../utils/lastCommunity';
import { STORAGE_KEY } from '../../theme/constants';
import { createTestQueryClient } from '../test-utils';

beforeEach(() => {
  localStorage.clear();
  clearDesignPreview();
});

describe('clearShellSessionState', () => {
  it('forgets the setting, its cached query, the preview, the sign-in notice and which banners were heard', () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData([{ _id: 'appearanceSettingsControllerGetSettings' }], { newDesign: true });
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode: 'dark', newDesign: true }));
    setDesignPreview('lounge');
    const notice = renderHook(() => useDesktopSignInBanner());
    act(() => showDesktopSignInNotice());
    takeFirstAnnouncement('signIn');

    act(() => clearShellSessionState(queryClient));
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')).toEqual({ mode: 'dark', newDesign: false });
    expect(queryClient.getQueryData([{ _id: 'appearanceSettingsControllerGetSettings' }])).toBeUndefined();
    expect(readDesignPreview()).toBeNull();
    expect(notice.result.current).toBeNull();
    expect(takeFirstAnnouncement('signIn')).toBe(true);
  });

  it("forgets the new shell's route memory: the previous user's remembered rows and row markers", () => {
    rememberActivatedRow('/__lounge/community/c-1', 'dock:c-2');
    const marker = rowMarker('dock:c-2');
    expect(rowMarker('dock:c-2')).toBe(marker);

    clearShellSessionState(createTestQueryClient());
    expect(rememberedRow('/__lounge/community/c-1')).toBeNull();
    // A new marker: nothing keyed by the previous user's ids is kept.
    expect(rowMarker('dock:c-2')).not.toBe(marker);
  });

  it("forgets the previous user's last-opened community", () => {
    rememberLastCommunity('c-1');
    expect(readLastCommunity()).toBe('c-1');
    clearShellSessionState(createTestQueryClient());
    expect(localStorage.getItem(LAST_COMMUNITY_KEY)).toBeNull();
  });

  it('keeps the preview on a page load that finds no session (a link opened before signing in)', () => {
    setDesignPreview('lounge');
    clearShellSessionState(createTestQueryClient(), { keepDesignPreview: true });
    expect(readDesignPreview()).toBe('lounge');
  });
});
