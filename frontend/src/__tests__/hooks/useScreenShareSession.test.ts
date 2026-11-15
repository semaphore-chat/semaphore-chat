/**
 * What a screen share does to the call, whatever is on screen (design F6).
 * The first three tests moved here unchanged from useScreenShare.test.ts when
 * the effects moved out of useScreenShare into VoiceSessionEffects.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderHook } from '@testing-library/react';

const mockRevealVideoTiles = vi.fn();
let mockAudioFailed = false;
vi.mock('../../hooks/useVoiceConnection', () => ({
  useVoiceConnection: vi.fn(() => ({
    state: { isConnected: true, screenShareAudioFailed: mockAudioFailed },
    actions: { revealVideoTiles: mockRevealVideoTiles },
  })),
}));

let mockIsScreenShareEnabled = false;
vi.mock('../../hooks/useLocalMediaState', () => ({
  useLocalMediaState: vi.fn(() => ({
    isCameraEnabled: false,
    isMicrophoneEnabled: true,
    isScreenShareEnabled: mockIsScreenShareEnabled,
  })),
}));

const mockClearScreenShareConfig = vi.fn();
vi.mock('../../utils/screenShareState', () => ({
  clearScreenShareConfig: () => mockClearScreenShareConfig(),
}));

const mockPlaySound = vi.fn();
vi.mock('../../hooks/useSound', () => ({
  playSound: (...args: unknown[]) => mockPlaySound(...args),
  Sounds: { error: 'error' },
}));

import { useScreenShareSession, SCREEN_SHARE_AUDIO_FAILED_MESSAGE } from '../../hooks/useScreenShareSession';
import { useScreenShare } from '../../hooks/useScreenShare';
import { NotificationContext } from '../../contexts/NotificationContext';

const showNotification = vi.fn();
const withNotifications = ({ children }: { children: React.ReactNode }) =>
  React.createElement(NotificationContext.Provider, { value: { showNotification } }, children);

describe('useScreenShareSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsScreenShareEnabled = false;
    mockAudioFailed = false;
  });

  it('clears config when sharing stops', () => {
    mockIsScreenShareEnabled = true;
    const { rerender } = renderHook(() => useScreenShareSession());
    mockClearScreenShareConfig.mockClear();

    mockIsScreenShareEnabled = false;
    rerender();

    expect(mockClearScreenShareConfig).toHaveBeenCalled();
  });

  it('reveals the video panel (show + un-collapse) when own screen share starts', () => {
    const { rerender } = renderHook(() => useScreenShareSession());
    expect(mockRevealVideoTiles).not.toHaveBeenCalled();

    mockIsScreenShareEnabled = true;
    rerender();

    expect(mockRevealVideoTiles).toHaveBeenCalledTimes(1);
  });

  it('does not reveal the video panel when sharing stops', () => {
    mockIsScreenShareEnabled = true;
    const { rerender } = renderHook(() => useScreenShareSession());

    mockIsScreenShareEnabled = false;
    rerender();

    expect(mockRevealVideoTiles).not.toHaveBeenCalled();
  });

  it('says once, with the error sound, that the share has no audio', () => {
    const { rerender } = renderHook(() => useScreenShareSession(), { wrapper: withNotifications });
    expect(showNotification).not.toHaveBeenCalled();

    mockAudioFailed = true;
    rerender();
    rerender();

    expect(showNotification).toHaveBeenCalledTimes(1);
    expect(showNotification).toHaveBeenCalledWith(SCREEN_SHARE_AUDIO_FAILED_MESSAGE, 'warning');
    expect(mockPlaySound).toHaveBeenCalledWith('error');
  });

  it('says it again for the next failed share', () => {
    mockAudioFailed = true;
    const { rerender } = renderHook(() => useScreenShareSession(), { wrapper: withNotifications });
    mockAudioFailed = false;
    rerender();
    mockAudioFailed = true;
    rerender();

    expect(showNotification).toHaveBeenCalledTimes(2);
  });

  it('runs outside a NotificationProvider (the sound still plays)', () => {
    const { rerender } = renderHook(() => useScreenShareSession());
    mockAudioFailed = true;
    expect(() => rerender()).not.toThrow();
    expect(mockPlaySound).toHaveBeenCalledWith('error');
  });

  it('useScreenShare (the bar\'s picker hook) runs none of these effects: no double toast, reveal or clean-up', () => {
    const { rerender } = renderHook(() => useScreenShare(), { wrapper: withNotifications });
    mockClearScreenShareConfig.mockClear();
    mockAudioFailed = true;
    mockIsScreenShareEnabled = true;
    rerender();
    mockIsScreenShareEnabled = false;
    rerender();

    expect(showNotification).not.toHaveBeenCalled();
    expect(mockPlaySound).not.toHaveBeenCalled();
    expect(mockRevealVideoTiles).not.toHaveBeenCalled();
    expect(mockClearScreenShareConfig).not.toHaveBeenCalled();
  });
});
