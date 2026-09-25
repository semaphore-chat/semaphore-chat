import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useDeepLinks } from '../../hooks/useDeepLinks';
import type { DeepLinkRoute, ElectronAPI } from '../../types/electron-api';
import { createElectronWrapper, createFakeElectronAPI } from '../test-utils';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

let mockIsAuthenticatedValue = true;
vi.mock('../../utils/tokenService', () => ({
  isAuthenticated: () => mockIsAuthenticatedValue,
}));

const mockStashDeepLinkRoute = vi.fn();
vi.mock('../../utils/deepLinkStash', () => ({
  stashDeepLinkRoute: (...args: unknown[]) => mockStashDeepLinkRoute(...args),
}));

vi.mock('../../utils/logger', () => ({
  logger: { dev: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const COMMUNITY_ID = 'a1b2c3d4-1111-4222-8333-444455556666';
const CHANNEL_ID = 'b2c3d4e5-2222-4333-8444-555566667777';
const DM_GROUP_ID = 'c3d4e5f6-3333-4444-8555-666677778888';

describe('useDeepLinks', () => {
  let deepLinkCallback: ((route: DeepLinkRoute) => void) | undefined;
  const mockUnsubscribe = vi.fn();
  const mockOnDeepLink = vi.fn((cb: (route: DeepLinkRoute) => void) => {
    deepLinkCallback = cb;
    return mockUnsubscribe;
  });
  const mockNotifyDeepLinkReady = vi.fn();
  let electronAPI: ElectronAPI | null;
  const renderUseDeepLinks = () =>
    renderHook(() => useDeepLinks(), { wrapper: createElectronWrapper(electronAPI) });

  beforeEach(() => {
    mockNavigate.mockReset();
    mockStashDeepLinkRoute.mockReset();
    mockUnsubscribe.mockReset();
    mockNotifyDeepLinkReady.mockReset();
    mockOnDeepLink.mockClear();
    deepLinkCallback = undefined;
    mockIsAuthenticatedValue = true;

    electronAPI = createFakeElectronAPI({
      onDeepLink: mockOnDeepLink,
      notifyDeepLinkReady: mockNotifyDeepLinkReady,
    });
  });

  it('does nothing when not running in Electron', () => {
    electronAPI = null;
    renderUseDeepLinks();
    expect(mockOnDeepLink).not.toHaveBeenCalled();
    expect(mockNotifyDeepLinkReady).not.toHaveBeenCalled();
  });

  it('does nothing when electronAPI.onDeepLink is unavailable (older desktop build)', () => {
    electronAPI = { ...createFakeElectronAPI({ notifyDeepLinkReady: mockNotifyDeepLinkReady }), onDeepLink: undefined };
    expect(() => renderUseDeepLinks()).not.toThrow();
    expect(mockNotifyDeepLinkReady).not.toHaveBeenCalled();
  });

  it('sends the deep-link:ready signal on mount', () => {
    renderUseDeepLinks();
    expect(mockNotifyDeepLinkReady).toHaveBeenCalledTimes(1);
  });

  it('navigates to the community route when authenticated', () => {
    renderUseDeepLinks();
    deepLinkCallback?.({ type: 'community', communityId: COMMUNITY_ID });
    expect(mockNavigate).toHaveBeenCalledWith(`/community/${COMMUNITY_ID}`);
  });

  it('navigates to the channel route when authenticated', () => {
    renderUseDeepLinks();
    deepLinkCallback?.({ type: 'channel', communityId: COMMUNITY_ID, channelId: CHANNEL_ID });
    expect(mockNavigate).toHaveBeenCalledWith(`/community/${COMMUNITY_ID}/channel/${CHANNEL_ID}`);
  });

  it('navigates to the DM inbox route when authenticated', () => {
    renderUseDeepLinks();
    deepLinkCallback?.({ type: 'dm-inbox' });
    expect(mockNavigate).toHaveBeenCalledWith('/direct-messages');
  });

  it('navigates to a specific DM route when authenticated', () => {
    renderUseDeepLinks();
    deepLinkCallback?.({ type: 'dm', dmGroupId: DM_GROUP_ID });
    expect(mockNavigate).toHaveBeenCalledWith(`/direct-messages/${DM_GROUP_ID}`);
  });

  it('navigates to the invite route immediately, even when unauthenticated', () => {
    mockIsAuthenticatedValue = false;
    renderUseDeepLinks();
    deepLinkCallback?.({ type: 'invite', inviteCode: 'AbCd12_-xyZ9' });
    expect(mockNavigate).toHaveBeenCalledWith('/join/AbCd12_-xyZ9');
    expect(mockStashDeepLinkRoute).not.toHaveBeenCalled();
  });

  it('stashes (does not navigate) an auth-required route when unauthenticated', () => {
    mockIsAuthenticatedValue = false;
    renderUseDeepLinks();
    const route: DeepLinkRoute = { type: 'community', communityId: COMMUNITY_ID };
    deepLinkCallback?.(route);
    expect(mockStashDeepLinkRoute).toHaveBeenCalledWith(route);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('ignores an unrecognized route shape without navigating or stashing', () => {
    renderUseDeepLinks();
    // @ts-expect-error deliberately malformed for the ignore-path test
    deepLinkCallback?.({ type: 'not-a-real-route' });
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockStashDeepLinkRoute).not.toHaveBeenCalled();
  });

  it('unsubscribes on unmount', () => {
    const { unmount } = renderUseDeepLinks();
    expect(mockUnsubscribe).not.toHaveBeenCalled();
    unmount();
    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
  });
});
