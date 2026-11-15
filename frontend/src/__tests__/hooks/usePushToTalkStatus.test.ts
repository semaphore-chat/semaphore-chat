/**
 * One push-to-talk engine (usePushToTalk, mounted by VoiceSessionEffects) and
 * any number of readers (usePushToTalkStatus: the voice bar, the float card).
 * The key works with no reader mounted, a reader never adds a key listener,
 * and touch hold-to-talk goes through the engine and its guards.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePushToTalk, usePushToTalkStatus } from '../../hooks/usePushToTalk';
import { pushToTalkStore } from '../../features/voice/pushToTalkStore';

const mockSetMicrophoneEnabled = vi.fn();
let mockRoom: { localParticipant: { setMicrophoneEnabled: typeof mockSetMicrophoneEnabled } } | null = null;

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

const mockGetRoom = () => mockRoom;
vi.mock('../../hooks/useRoom', () => ({
  useRoom: vi.fn(() => ({ getRoom: mockGetRoom })),
}));

const settings = vi.hoisted(() => ({ isPushToTalk: true }));
vi.mock('../../hooks/useVoiceSettings', () => ({
  useVoiceSettings: vi.fn(() => ({
    inputMode: settings.isPushToTalk ? 'push_to_talk' : 'voice_activity',
    pushToTalkKey: 'Backquote',
    pushToTalkKeyDisplay: '`',
    isPushToTalk: settings.isPushToTalk,
  })),
}));

vi.mock('../../utils/logger', () => ({
  logger: { dev: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const pressKey = () => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Backquote' }));
const releaseKey = () => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Backquote' }));

describe('usePushToTalkStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pushToTalkStore.reset();
    settings.isPushToTalk = true;
    mockSetMicrophoneEnabled.mockResolvedValue(undefined);
    mockRoom = { localParticipant: { setMicrophoneEnabled: mockSetMicrophoneEnabled } };
    mockVoiceState = { isConnected: true, isServerMuted: false };
  });

  it('shows the key held while the engine (mounted elsewhere) transmits', async () => {
    renderHook(() => usePushToTalk());
    const { result } = renderHook(() => usePushToTalkStatus());
    expect(result.current.isKeyHeld).toBe(false);

    await act(async () => {
      pressKey();
    });
    expect(result.current.isKeyHeld).toBe(true);
    expect(mockSetMicrophoneEnabled).toHaveBeenCalledWith(true);

    await act(async () => {
      releaseKey();
    });
    expect(result.current.isKeyHeld).toBe(false);
  });

  it('the key works with no reader mounted (no voice bar on screen)', async () => {
    renderHook(() => usePushToTalk());
    await act(async () => {
      pressKey();
    });
    expect(mockSetMicrophoneEnabled).toHaveBeenCalledWith(true);
    expect(pushToTalkStore.getSnapshot().isKeyHeld).toBe(true);
  });

  it('a reader adds no key listener of its own (no second engine)', async () => {
    renderHook(() => usePushToTalkStatus());
    await act(async () => {
      pressKey();
      releaseKey();
    });
    expect(mockSetMicrophoneEnabled).not.toHaveBeenCalled();
  });

  it('hold-to-talk from a reader goes through the engine, guards included', async () => {
    renderHook(() => usePushToTalk({ canSpeak: true }));
    const { result } = renderHook(() => usePushToTalkStatus());

    await act(async () => {
      await result.current.pttPress();
    });
    expect(mockSetMicrophoneEnabled).toHaveBeenLastCalledWith(true);
    expect(result.current.isKeyHeld).toBe(true);

    await act(async () => {
      await result.current.pttRelease();
    });
    expect(mockSetMicrophoneEnabled).toHaveBeenLastCalledWith(false);
    expect(result.current.isKeyHeld).toBe(false);

    mockSetMicrophoneEnabled.mockClear();
    mockVoiceState = { isConnected: true, isServerMuted: true };
    await act(async () => {
      await result.current.pttPress();
    });
    expect(mockSetMicrophoneEnabled).not.toHaveBeenCalled();
  });

  it('hold-to-talk honours a missing SPEAK permission', async () => {
    renderHook(() => usePushToTalk({ canSpeak: false }));
    const { result } = renderHook(() => usePushToTalkStatus());
    await act(async () => {
      await result.current.pttPress();
    });
    expect(mockSetMicrophoneEnabled).not.toHaveBeenCalled();
  });

  it('with no engine mounted, press does nothing and nothing is held', async () => {
    const { result } = renderHook(() => usePushToTalkStatus());
    await act(async () => {
      await result.current.pttPress();
    });
    expect(mockSetMicrophoneEnabled).not.toHaveBeenCalled();
    expect(result.current.isKeyHeld).toBe(false);
  });

  it('unmounting the engine while held mutes and clears the held state', async () => {
    const engine = renderHook(() => usePushToTalk());
    const { result } = renderHook(() => usePushToTalkStatus());
    await act(async () => {
      pressKey();
    });
    expect(result.current.isKeyHeld).toBe(true);

    act(() => engine.unmount());
    expect(mockSetMicrophoneEnabled).toHaveBeenLastCalledWith(false);
    expect(result.current.isKeyHeld).toBe(false);

    mockSetMicrophoneEnabled.mockClear();
    await act(async () => {
      await result.current.pttPress();
    });
    expect(mockSetMicrophoneEnabled).not.toHaveBeenCalled();
  });

  it('reports PTT as active only while connected in push-to-talk mode, with the key name', () => {
    const { result, rerender } = renderHook(() => usePushToTalkStatus());
    expect(result.current.isActive).toBe(true);
    expect(result.current.currentKeyDisplay).toBe('`');
    expect(result.current.inputMode).toBe('push_to_talk');

    mockVoiceState = { isConnected: false, isServerMuted: false };
    rerender();
    expect(result.current.isActive).toBe(false);

    mockVoiceState = { isConnected: true, isServerMuted: false };
    settings.isPushToTalk = false;
    rerender();
    expect(result.current.isActive).toBe(false);
  });
});

describe('pushToTalkStore', () => {
  beforeEach(() => pushToTalkStore.reset());

  it('notifies only on a real change of the held state', () => {
    const listener = vi.fn();
    const unsubscribe = pushToTalkStore.subscribe(listener);
    pushToTalkStore.setKeyHeld(false);
    expect(listener).not.toHaveBeenCalled();
    pushToTalkStore.setKeyHeld(true);
    pushToTalkStore.setKeyHeld(true);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    pushToTalkStore.setKeyHeld(false);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('an older engine unregistering does not remove a newer one', async () => {
    const first = { press: vi.fn(async () => {}), release: vi.fn(async () => {}) };
    const second = { press: vi.fn(async () => {}), release: vi.fn(async () => {}) };
    const unregisterFirst = pushToTalkStore.setControls(first);
    pushToTalkStore.setControls(second);
    unregisterFirst();
    await pushToTalkStore.press();
    expect(second.press).toHaveBeenCalledTimes(1);
    expect(first.press).not.toHaveBeenCalled();
  });
});
