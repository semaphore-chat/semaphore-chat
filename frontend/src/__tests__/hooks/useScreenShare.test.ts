import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createTestWrapper, createTestQueryClient } from '../test-utils';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

const mockToggleScreenShare = vi.fn().mockResolvedValue(undefined);
const mockRevealVideoTiles = vi.fn();
vi.mock('../../hooks/useVoiceConnection', () => ({
  useVoiceConnection: vi.fn(() => ({
    state: { isConnected: true },
    actions: {
      toggleScreenShare: mockToggleScreenShare,
      revealVideoTiles: mockRevealVideoTiles,
    },
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

const mockHasElectronFeature = vi.fn().mockReturnValue(false);
const mockIsWayland = vi.fn().mockReturnValue(false);
vi.mock('../../utils/platform', () => ({
  hasElectronFeature: (...args: unknown[]) => mockHasElectronFeature(...args),
  isWayland: () => mockIsWayland(),
  isElectron: vi.fn().mockReturnValue(false),
}));

const mockSetScreenShareConfig = vi.fn();
const mockClearScreenShareConfig = vi.fn();
vi.mock('../../utils/screenShareState', () => ({
  setScreenShareConfig: (...args: unknown[]) => mockSetScreenShareConfig(...args),
  clearScreenShareConfig: () => mockClearScreenShareConfig(),
}));

const mockShowNotification = vi.fn();
vi.mock('../../contexts/NotificationContext', () => ({
  useNotification: () => ({ showNotification: mockShowNotification }),
}));

let mockScreenShareAudioFailed = false;
vi.mock('../../contexts/VoiceContext', () => ({
  useVoice: () => ({ screenShareAudioFailed: mockScreenShareAudioFailed }),
}));

vi.mock('../../utils/logger', () => ({
  logger: { dev: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { useScreenShare } from '../../hooks/useScreenShare';

describe('useScreenShare', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsScreenShareEnabled = false;
    mockScreenShareAudioFailed = false;
    mockHasElectronFeature.mockReturnValue(false);
    mockIsWayland.mockReturnValue(false);
  });

  function renderUseScreenShare() {
    const queryClient = createTestQueryClient();
    return renderHook(() => useScreenShare(), {
      wrapper: createTestWrapper({ queryClient }),
    });
  }

  it('web: toggleScreenShare calls actions.toggleScreenShare directly', async () => {
    const { result } = renderUseScreenShare();

    await act(async () => {
      await result.current.toggleScreenShare();
    });

    expect(mockToggleScreenShare).toHaveBeenCalled();
    expect(result.current.showSourcePicker).toBe(false);
  });

  it('electron: toggleScreenShare shows source picker', async () => {
    mockHasElectronFeature.mockReturnValue(true);

    const { result } = renderUseScreenShare();

    await act(async () => {
      await result.current.toggleScreenShare();
    });

    expect(result.current.showSourcePicker).toBe(true);
    expect(mockToggleScreenShare).not.toHaveBeenCalled();
  });

  it('handleSourceSelect closes picker and triggers share', async () => {
    const { result } = renderUseScreenShare();

    await act(async () => {
      await result.current.handleSourceSelect('source-1', { resolution: '1080p', fps: 30, enableAudio: true } as never);
    });

    expect(result.current.showSourcePicker).toBe(false);
    expect(mockSetScreenShareConfig).toHaveBeenCalledWith('source-1', expect.any(Object));
    expect(mockToggleScreenShare).toHaveBeenCalled();
  });

  it('handleSourcePickerClose closes picker', async () => {
    mockHasElectronFeature.mockReturnValue(true);
    const { result } = renderUseScreenShare();

    // Open picker first
    await act(async () => {
      await result.current.toggleScreenShare();
    });
    expect(result.current.showSourcePicker).toBe(true);

    act(() => {
      result.current.handleSourcePickerClose();
    });

    expect(result.current.showSourcePicker).toBe(false);
  });

  it('stopScreenShare calls actions.toggleScreenShare', async () => {
    mockIsScreenShareEnabled = true;

    const { result } = renderUseScreenShare();

    await act(async () => {
      await result.current.stopScreenShare();
    });

    expect(mockToggleScreenShare).toHaveBeenCalled();
  });

  it('clears config when sharing stops', async () => {
    mockIsScreenShareEnabled = true;
    const { rerender } = renderUseScreenShare();

    // Simulate sharing stopping
    mockIsScreenShareEnabled = false;
    rerender();

    expect(mockClearScreenShareConfig).toHaveBeenCalled();
  });

  it('reveals the video panel (show + un-collapse) when own screen share starts', () => {
    const { rerender } = renderUseScreenShare();
    expect(mockRevealVideoTiles).not.toHaveBeenCalled();

    // Simulate sharing starting
    mockIsScreenShareEnabled = true;
    rerender();

    expect(mockRevealVideoTiles).toHaveBeenCalled();
  });

  it('does not reveal the video panel when sharing stops', () => {
    mockIsScreenShareEnabled = true;
    const { rerender } = renderUseScreenShare();

    mockIsScreenShareEnabled = false;
    rerender();

    expect(mockRevealVideoTiles).not.toHaveBeenCalled();
  });
});
