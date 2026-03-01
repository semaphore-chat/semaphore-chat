import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createTestWrapper, createTestQueryClient } from '../test-utils';

// --- Mock Web Audio API ---
let audioLevel = 0;
const mockAudioContextClose = vi.fn();

const mockAnalyser = {
  fftSize: 0,
  smoothingTimeConstant: 0,
  frequencyBinCount: 4,
  getByteFrequencyData(arr: Uint8Array) {
    const byteVal = Math.round((audioLevel / 100) * 255);
    for (let i = 0; i < arr.length; i++) arr[i] = byteVal;
  },
  connect: vi.fn(),
};

class MockAudioContext {
  createAnalyser() { return mockAnalyser; }
  createMediaStreamSource() { return { connect: vi.fn() }; }
  close() { mockAudioContextClose(); }
}

vi.stubGlobal('AudioContext', MockAudioContext);
vi.stubGlobal('MediaStream', class { constructor() { /* noop */ } });

// --- Mock requestAnimationFrame (manually controlled) ---
let rafCallbacks: Array<() => void> = [];

function rafStub(cb: () => void) { rafCallbacks.push(cb); return rafCallbacks.length; }

function tickRAF(times = 1) {
  for (let i = 0; i < times; i++) {
    const cbs = [...rafCallbacks];
    rafCallbacks = [];
    cbs.forEach(cb => cb());
  }
}

// --- Mock room ---
type Handler = (...args: unknown[]) => void;
const participantHandlers = new Map<string, Set<Handler>>();
const roomHandlers = new Map<string, Set<Handler>>();

const mockMediaStreamTrack = { enabled: true };

const mockLocalParticipant = {
  identity: 'user-1',
  getTrackPublication: vi.fn().mockReturnValue({
    track: { mediaStreamTrack: mockMediaStreamTrack },
  }),
  on: vi.fn((event: string, handler: Handler) => {
    if (!participantHandlers.has(event)) participantHandlers.set(event, new Set());
    participantHandlers.get(event)!.add(handler);
  }),
  off: vi.fn((event: string, handler: Handler) => {
    participantHandlers.get(event)?.delete(handler);
  }),
};

const mockRemoteParticipants = new Map();

const makeRoom = () => ({
  localParticipant: mockLocalParticipant,
  remoteParticipants: mockRemoteParticipants,
  on: vi.fn((event: string, handler: Handler) => {
    if (!roomHandlers.has(event)) roomHandlers.set(event, new Set());
    roomHandlers.get(event)!.add(handler);
  }),
  off: vi.fn(),
});

let currentRoom: ReturnType<typeof makeRoom> | null = makeRoom();

vi.mock('../../hooks/useRoom', () => ({
  useRoom: () => ({ room: currentRoom, setRoom: vi.fn(), getRoom: vi.fn() }),
}));

vi.mock('livekit-client', () => ({
  Track: { Source: { Microphone: 'microphone', Camera: 'camera', ScreenShare: 'screen_share' } },
  Participant: class {},
}));

// --- Mock localStorage ---
let storedSettings: Record<string, unknown> = {};

vi.stubGlobal('localStorage', {
  getItem: vi.fn((key: string) => {
    const val = storedSettings[key];
    return val !== undefined ? JSON.stringify(val) : null;
  }),
  setItem: vi.fn(),
  removeItem: vi.fn(),
});

import { useSpeakingDetection } from '../../hooks/useSpeakingDetection';

describe('useSpeakingDetection', () => {
  // Fake Date and setTimeout but NOT requestAnimationFrame (we control rAF manually)
  const FAKE_TIMER_APIS = [
    'Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  ] as const;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: [...FAKE_TIMER_APIS] });
    vi.clearAllMocks();
    // Ensure our rAF stub is in place (fake timers may override globals)
    globalThis.requestAnimationFrame = rafStub as unknown as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = vi.fn();

    participantHandlers.clear();
    roomHandlers.clear();
    mockRemoteParticipants.clear();
    rafCallbacks = [];
    audioLevel = 0;
    mockMediaStreamTrack.enabled = true;
    currentRoom = makeRoom();
    storedSettings = {
      kraken_voice_settings: {
        inputMode: 'voice_activity',
        voiceActivityThreshold: 25,
      },
    };
    mockLocalParticipant.getTrackPublication.mockReturnValue({
      track: { mediaStreamTrack: mockMediaStreamTrack },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function renderSpeaking() {
    const queryClient = createTestQueryClient();
    return renderHook(() => useSpeakingDetection(), {
      wrapper: createTestWrapper({ queryClient }),
    });
  }

  // ------------------------------------------------------------------
  // Basic speaking indicator
  // ------------------------------------------------------------------

  it('returns empty map when no room', () => {
    currentRoom = null;
    const { result } = renderSpeaking();
    expect(result.current.speakingMap.size).toBe(0);
    expect(result.current.isSpeaking('user-1')).toBe(false);
  });

  it('sets speaking to true immediately when above threshold', () => {
    const { result } = renderSpeaking();
    audioLevel = 50; // Above threshold 25
    act(() => tickRAF(1));
    expect(result.current.isSpeaking('user-1')).toBe(true);
  });

  // ------------------------------------------------------------------
  // Hold-open delay (300ms) — indicator AND gate stay in sync
  // ------------------------------------------------------------------

  it('does NOT immediately set speaking to false when level drops', () => {
    const { result } = renderSpeaking();

    audioLevel = 50;
    act(() => tickRAF(1));
    expect(result.current.isSpeaking('user-1')).toBe(true);

    audioLevel = 0;
    act(() => tickRAF(1));
    // Hold-open keeps it true
    expect(result.current.isSpeaking('user-1')).toBe(true);
  });

  it('sets speaking to false after 300ms hold-open delay', () => {
    const { result } = renderSpeaking();

    audioLevel = 50;
    act(() => tickRAF(1));
    expect(result.current.isSpeaking('user-1')).toBe(true);

    audioLevel = 0;
    act(() => tickRAF(1));

    // Advance past 300ms and tick again so the loop re-evaluates
    act(() => {
      vi.advanceTimersByTime(350);
      tickRAF(1);
    });

    expect(result.current.isSpeaking('user-1')).toBe(false);
  });

  it('cancels hold-open if audio rises above threshold again', () => {
    const { result } = renderSpeaking();

    audioLevel = 50;
    act(() => tickRAF(1));
    expect(result.current.isSpeaking('user-1')).toBe(true);

    // Brief dip
    audioLevel = 0;
    act(() => tickRAF(1));

    // Come back above threshold within 300ms
    act(() => vi.advanceTimersByTime(100));
    audioLevel = 50;
    act(() => tickRAF(1));

    // Advance well past where hold-open would have fired
    act(() => {
      vi.advanceTimersByTime(400);
      tickRAF(1);
    });

    expect(result.current.isSpeaking('user-1')).toBe(true);
  });

  // ------------------------------------------------------------------
  // Audio gating — mediaStreamTrack.enabled
  // ------------------------------------------------------------------

  it('gates audio (track.enabled = false) when below threshold after hold-open', () => {
    renderSpeaking();

    audioLevel = 0;
    act(() => tickRAF(1));
    expect(mockMediaStreamTrack.enabled).toBe(true); // Still within hold-open

    act(() => {
      vi.advanceTimersByTime(350);
      tickRAF(1);
    });

    expect(mockMediaStreamTrack.enabled).toBe(false);
  });

  it('opens gate (track.enabled = true) when audio rises above threshold', () => {
    renderSpeaking();

    // Close the gate
    audioLevel = 0;
    act(() => tickRAF(1));
    act(() => {
      vi.advanceTimersByTime(350);
      tickRAF(1);
    });
    expect(mockMediaStreamTrack.enabled).toBe(false);

    // Raise audio above threshold and wait past min close time
    audioLevel = 50;
    act(() => {
      vi.advanceTimersByTime(150);
      tickRAF(1);
    });

    expect(mockMediaStreamTrack.enabled).toBe(true);
  });

  it('keeps gate open when audio hovers between hysteresis thresholds', () => {
    storedSettings = {
      kraken_voice_settings: {
        inputMode: 'voice_activity',
        voiceActivityThreshold: 30,
      },
    };

    renderSpeaking();

    // Level 28: above close threshold (30-5=25) but below open threshold (30)
    audioLevel = 28;
    act(() => tickRAF(1));

    act(() => {
      vi.advanceTimersByTime(500);
      tickRAF(1);
    });

    expect(mockMediaStreamTrack.enabled).toBe(true);
  });

  // ------------------------------------------------------------------
  // PTT / non-gated mode
  // ------------------------------------------------------------------

  it('does NOT gate audio in push_to_talk mode', () => {
    storedSettings = {
      kraken_voice_settings: {
        inputMode: 'push_to_talk',
        voiceActivityThreshold: 25,
      },
    };

    renderSpeaking();

    audioLevel = 0;
    act(() => tickRAF(1));
    act(() => {
      vi.advanceTimersByTime(500);
      tickRAF(1);
    });

    expect(mockMediaStreamTrack.enabled).toBe(true);
  });

  it('re-enables track if user switches from VA to PTT mid-session', () => {
    renderSpeaking();

    // Close the gate in VA mode
    audioLevel = 0;
    act(() => tickRAF(1));
    act(() => {
      vi.advanceTimersByTime(350);
      tickRAF(1);
    });
    expect(mockMediaStreamTrack.enabled).toBe(false);

    // Switch to PTT — next tick should re-enable (once settings cache refreshes)
    storedSettings = {
      kraken_voice_settings: {
        inputMode: 'push_to_talk',
        voiceActivityThreshold: 25,
      },
    };

    // Tick enough frames to trigger settings cache refresh (every 60 frames)
    act(() => tickRAF(60));
    expect(mockMediaStreamTrack.enabled).toBe(true);
  });

  it('does NOT re-enable track on cleanup when user manually muted (gate did not disable)', () => {
    renderSpeaking();

    // Audio is above threshold, gate stays open, track stays enabled
    audioLevel = 50;
    act(() => tickRAF(1));
    expect(mockMediaStreamTrack.enabled).toBe(true);

    // Simulate external code disabling the track (not our gate)
    mockMediaStreamTrack.enabled = false;

    const { unmount } = renderSpeaking();
    unmount();

    // Should NOT re-enable — we didn't disable it, so we shouldn't touch it
    expect(mockMediaStreamTrack.enabled).toBe(false);
  });

  // ------------------------------------------------------------------
  // Lifecycle: cleanup, track changes
  // ------------------------------------------------------------------

  it('re-enables track on cleanup (unmount)', () => {
    const { unmount } = renderSpeaking();

    // Close the gate
    audioLevel = 0;
    act(() => tickRAF(1));
    act(() => {
      vi.advanceTimersByTime(350);
      tickRAF(1);
    });
    expect(mockMediaStreamTrack.enabled).toBe(false);

    unmount();
    expect(mockMediaStreamTrack.enabled).toBe(true);
  });

  it('re-initializes on localTrackPublished', () => {
    renderSpeaking();

    act(() => {
      participantHandlers.get('localTrackPublished')?.forEach(h => h());
    });

    act(() => vi.advanceTimersByTime(250));

    expect(mockMediaStreamTrack.enabled).toBe(true);
  });

  it('stops analysis on localTrackUnpublished', () => {
    renderSpeaking();

    act(() => {
      participantHandlers.get('localTrackUnpublished')?.forEach(h => h());
    });

    expect(mockAudioContextClose).toHaveBeenCalled();
  });

  it('cleans up event listeners on unmount', () => {
    const { unmount } = renderSpeaking();
    unmount();

    expect(mockLocalParticipant.off).toHaveBeenCalledWith('localTrackPublished', expect.any(Function));
    expect(mockLocalParticipant.off).toHaveBeenCalledWith('localTrackUnpublished', expect.any(Function));
  });
});
