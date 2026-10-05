import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePushToTalk } from '../../hooks/usePushToTalk';

const mockSetMicrophoneEnabled = vi.fn();
let mockRoom: { localParticipant: { setMicrophoneEnabled: typeof mockSetMicrophoneEnabled } } | null =
  null;

// Mutable voice state read by both useVoice (render-time) and stateRef (event-time)
let mockVoiceState: { isConnected: boolean; isServerMuted: boolean };
const mockStateRef = {
  get current() {
    return mockVoiceState;
  },
};

vi.mock('../../contexts/VoiceContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../contexts/VoiceContext')>();
  return {
    ...actual,
    useVoice: vi.fn(() => mockVoiceState),
    useVoiceDispatch: vi.fn(() => ({ dispatch: vi.fn(), stateRef: mockStateRef })),
  };
});

// getRoom must be referentially stable across renders (as the real RoomContext
// provides) — an unstable identity would churn the hook's effect on each render.
const mockGetRoom = () => mockRoom;
vi.mock('../../hooks/useRoom', () => ({
  useRoom: vi.fn(() => ({ getRoom: mockGetRoom })),
}));

vi.mock('../../hooks/useVoiceSettings', () => ({
  useVoiceSettings: vi.fn(() => ({
    inputMode: 'push_to_talk',
    pushToTalkKey: 'Backquote',
    pushToTalkKeyDisplay: '`',
    isPushToTalk: true,
  })),
}));

vi.mock('../../utils/logger', () => ({
  logger: { dev: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

function pressPttKey(options: { repeat?: boolean } = {}) {
  const event = new KeyboardEvent('keydown', { code: 'Backquote' });
  if (options.repeat) {
    // jsdom does not honor `repeat` from KeyboardEventInit
    Object.defineProperty(event, 'repeat', { value: true });
  }
  window.dispatchEvent(event);
}

function releasePttKey() {
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Backquote' }));
}

describe('usePushToTalk', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSetMicrophoneEnabled.mockResolvedValue(undefined);
    mockRoom = { localParticipant: { setMicrophoneEnabled: mockSetMicrophoneEnabled } };
    mockVoiceState = { isConnected: true, isServerMuted: false };
  });

  it('enables the microphone on PTT keydown when not server-muted', async () => {
    const { result } = renderHook(() => usePushToTalk());

    await act(async () => {
      pressPttKey();
    });

    expect(mockSetMicrophoneEnabled).toHaveBeenCalledWith(true);
    expect(result.current.isKeyHeld).toBe(true);
  });

  it('disables the microphone on PTT keyup', async () => {
    const { result } = renderHook(() => usePushToTalk());

    await act(async () => {
      pressPttKey();
      releasePttKey();
    });

    expect(mockSetMicrophoneEnabled).toHaveBeenLastCalledWith(false);
    expect(result.current.isKeyHeld).toBe(false);
  });

  it('does NOT enable the microphone on keydown while server-muted', async () => {
    mockVoiceState = { isConnected: true, isServerMuted: true };
    const { result } = renderHook(() => usePushToTalk());

    await act(async () => {
      pressPttKey();
    });

    expect(mockSetMicrophoneEnabled).not.toHaveBeenCalled();
    // Speaking indicator input stays off
    expect(result.current.isKeyHeld).toBe(false);
  });

  it('reads the CURRENT server-mute state at keydown time (not a stale closure)', async () => {
    const { result } = renderHook(() => usePushToTalk());

    // Server mute arrives after the hook rendered its handlers.
    // Mutate state without re-rendering — the ref must still see it.
    mockVoiceState.isServerMuted = true;

    await act(async () => {
      pressPttKey();
    });

    expect(mockSetMicrophoneEnabled).not.toHaveBeenCalled();
    expect(result.current.isKeyHeld).toBe(false);
  });

  it('allows PTT again after the server mute is lifted', async () => {
    mockVoiceState = { isConnected: true, isServerMuted: true };
    const { result } = renderHook(() => usePushToTalk());

    await act(async () => {
      pressPttKey();
    });
    expect(mockSetMicrophoneEnabled).not.toHaveBeenCalled();

    mockVoiceState.isServerMuted = false;

    await act(async () => {
      pressPttKey();
    });

    expect(mockSetMicrophoneEnabled).toHaveBeenCalledWith(true);
    expect(result.current.isKeyHeld).toBe(true);
  });

  it('still allows muting on keyup while server-muted', async () => {
    mockVoiceState = { isConnected: true, isServerMuted: true };
    renderHook(() => usePushToTalk());

    await act(async () => {
      releasePttKey();
    });

    expect(mockSetMicrophoneEnabled).toHaveBeenCalledWith(false);
  });

  it('ignores non-PTT keys', async () => {
    renderHook(() => usePushToTalk());

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA' }));
    });

    expect(mockSetMicrophoneEnabled).not.toHaveBeenCalled();
  });

  it('ignores repeat keydown events', async () => {
    renderHook(() => usePushToTalk());

    await act(async () => {
      pressPttKey();
      pressPttKey({ repeat: true });
    });

    expect(mockSetMicrophoneEnabled).toHaveBeenCalledTimes(1);
  });

  describe('programmatic pttPress / pttRelease (touch hold-to-talk)', () => {
    it('pttPress enables the microphone when not server-muted', async () => {
      const { result } = renderHook(() => usePushToTalk());

      await act(async () => {
        await result.current.pttPress();
      });

      expect(mockSetMicrophoneEnabled).toHaveBeenCalledWith(true);
      expect(result.current.isKeyHeld).toBe(true);
    });

    it('pttPress is a no-op while server-muted (same guard as keyboard)', async () => {
      mockVoiceState = { isConnected: true, isServerMuted: true };
      const { result } = renderHook(() => usePushToTalk());

      await act(async () => {
        await result.current.pttPress();
      });

      expect(mockSetMicrophoneEnabled).not.toHaveBeenCalled();
      expect(result.current.isKeyHeld).toBe(false);
    });

    it('pttPress reads the CURRENT server-mute state (not a stale closure)', async () => {
      const { result } = renderHook(() => usePushToTalk());

      // Server mute arrives after render — the stateRef must still see it.
      mockVoiceState.isServerMuted = true;

      await act(async () => {
        await result.current.pttPress();
      });

      expect(mockSetMicrophoneEnabled).not.toHaveBeenCalled();
    });

    it('pttRelease disables the microphone', async () => {
      const { result } = renderHook(() => usePushToTalk());

      await act(async () => {
        await result.current.pttPress();
      });
      mockSetMicrophoneEnabled.mockClear();

      await act(async () => {
        await result.current.pttRelease();
      });

      expect(mockSetMicrophoneEnabled).toHaveBeenCalledWith(false);
      expect(result.current.isKeyHeld).toBe(false);
    });
  });

  it('ignores PTT presses without SPEAK in the channel (timed out / denied)', async () => {
    const { result } = renderHook(() => usePushToTalk({ canSpeak: false }));

    await act(async () => {
      pressPttKey();
    });

    expect(mockSetMicrophoneEnabled).not.toHaveBeenCalled();
    expect(result.current.isKeyHeld).toBe(false);
  });

  it('picks up a regained SPEAK permission without remounting', async () => {
    const { result, rerender } = renderHook(
      ({ canSpeak }: { canSpeak: boolean }) => usePushToTalk({ canSpeak }),
      { initialProps: { canSpeak: false } },
    );
    rerender({ canSpeak: true });

    await act(async () => {
      pressPttKey();
    });

    expect(mockSetMicrophoneEnabled).toHaveBeenCalledWith(true);
    expect(result.current.isKeyHeld).toBe(true);
  });
});
