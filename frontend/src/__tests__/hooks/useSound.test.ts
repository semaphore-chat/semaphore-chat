import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Mock Audio globally before importing the module
const mockPlay = vi.fn().mockResolvedValue(undefined);
const mockAudioInstances: Array<{ src: string; preload: string; currentTime: number; play: typeof mockPlay }> = [];

class MockAudio {
  src: string;
  preload = '';
  currentTime = 0;
  play = mockPlay;

  constructor(src?: string) {
    this.src = src || '';
    mockAudioInstances.push(this);
  }
}

vi.stubGlobal('Audio', MockAudio);

// Must import AFTER mocking Audio so the module picks up the mock
// Use dynamic import to reset module state between tests
let useSoundModule: typeof import('../../hooks/useSound');

describe('useSound', () => {
  beforeEach(async () => {
    vi.resetModules();
    mockAudioInstances.length = 0;
    mockPlay.mockReset().mockResolvedValue(undefined);

    // Fresh import each test to reset the lazy singleton audioCache
    useSoundModule = await import('../../hooks/useSound');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('SoundMap', () => {
    it('maps all sound names to .wav files', () => {
      for (const [, file] of Object.entries(useSoundModule.SoundMap)) {
        expect(file).toMatch(/\.wav$/);
      }
    });

    it('has entries for all expected sound categories', () => {
      const { SoundMap } = useSoundModule;
      expect(SoundMap.channelMessage).toBeDefined();
      expect(SoundMap.directMessage).toBeDefined();
      expect(SoundMap.mention).toBeDefined();
      expect(SoundMap.voiceUserJoined).toBeDefined();
      expect(SoundMap.voiceUserLeft).toBeDefined();
      expect(SoundMap.screenShareStarted).toBeDefined();
      expect(SoundMap.screenShareStopped).toBeDefined();
      expect(SoundMap.incomingCall).toBeDefined();
      expect(SoundMap.callEnded).toBeDefined();
      expect(SoundMap.toggleOn).toBeDefined();
      expect(SoundMap.toggleOff).toBeDefined();
      expect(SoundMap.connected).toBeDefined();
      expect(SoundMap.disconnected).toBeDefined();
      expect(SoundMap.error).toBeDefined();
      expect(SoundMap.dismissed).toBeDefined();
    });
  });

  describe('Sounds constants', () => {
    it('maps each key to itself for type-safe access', () => {
      const { Sounds, SoundMap } = useSoundModule;
      for (const key of Object.keys(SoundMap)) {
        expect(Sounds[key as keyof typeof Sounds]).toBe(key);
      }
    });
  });

  describe('playSound (standalone)', () => {
    it('creates Audio objects lazily on first call', () => {
      expect(mockAudioInstances).toHaveLength(0);

      useSoundModule.playSound('channelMessage');

      // Should have created Audio instances for ALL sounds (lazy init)
      const soundCount = Object.keys(useSoundModule.SoundMap).length;
      expect(mockAudioInstances).toHaveLength(soundCount);
    });

    it('plays the correct sound file', () => {
      useSoundModule.playSound('channelMessage');

      const pluckAudio = mockAudioInstances.find((a) => a.src === './sounds/pluck.wav');
      expect(pluckAudio).toBeDefined();
      expect(pluckAudio!.play).toHaveBeenCalled();
    });

    it('resets currentTime before playing to allow rapid re-triggers', () => {
      useSoundModule.playSound('channelMessage');
      const audio = mockAudioInstances.find((a) => a.src === './sounds/pluck.wav')!;
      audio.currentTime = 0.5; // Simulate partially played

      useSoundModule.playSound('channelMessage');
      expect(audio.currentTime).toBe(0);
    });

    it('swallows autoplay restriction errors', () => {
      mockPlay.mockRejectedValueOnce(new DOMException('NotAllowedError'));

      // Should not throw
      expect(() => useSoundModule.playSound('error')).not.toThrow();
    });

    it('sets preload to auto for instant playback', () => {
      useSoundModule.playSound('connected');

      for (const audio of mockAudioInstances) {
        expect(audio.preload).toBe('auto');
      }
    });
  });

  describe('useSound hook', () => {
    it('returns a stable playSound function', () => {
      const { result, rerender } = renderHook(() => useSoundModule.useSound());

      const firstPlaySound = result.current.playSound;
      rerender();
      expect(result.current.playSound).toBe(firstPlaySound);
    });

    it('playSound from hook calls the standalone playSound', () => {
      const { result } = renderHook(() => useSoundModule.useSound());

      act(() => {
        result.current.playSound('mention');
      });

      const mentionAudio = mockAudioInstances.find((a) => a.src === './sounds/asc-triad.wav');
      expect(mentionAudio).toBeDefined();
      expect(mentionAudio!.play).toHaveBeenCalled();
    });
  });
});
