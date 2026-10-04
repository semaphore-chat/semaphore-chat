import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Mock storage
const mockStorage: Record<string, unknown> = {};

vi.mock('../../utils/storage', () => ({
  getCachedItem: vi.fn((key: string) => mockStorage[key] ?? null),
  setCachedItem: vi.fn((key: string, value: unknown) => {
    mockStorage[key] = value;
  }),
}));

import { useVoiceSettings } from '../../hooks/useVoiceSettings';
import { setCachedItem } from '../../utils/storage';

describe('useVoiceSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear mock storage
    for (const key of Object.keys(mockStorage)) {
      delete mockStorage[key];
    }
  });

  describe('audio processing defaults', () => {
    it('returns correct defaults when no saved settings', () => {
      const { result } = renderHook(() => useVoiceSettings());

      expect(result.current.echoCancellation).toBe(true);
      expect(result.current.noiseSuppression).toBe(true);
      expect(result.current.autoGainControl).toBe(true);
      expect(result.current.voiceIsolation).toBe(false);
    });

    it('includes audio processing fields in settings object', () => {
      const { result } = renderHook(() => useVoiceSettings());

      expect(result.current.settings).toMatchObject({
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        voiceIsolation: false,
      });
    });
  });

  describe('backward compatibility', () => {
    it('merges defaults for missing audio processing fields from old saved settings', () => {
      // Simulate old saved settings that lack audio processing fields
      mockStorage['semaphore_voice_settings'] = {
        inputMode: 'push_to_talk',
        pushToTalkKey: 'KeyV',
        pushToTalkKeyDisplay: 'V',
        voiceActivityThreshold: 50,
      };

      const { result } = renderHook(() => useVoiceSettings());

      // Old fields preserved
      expect(result.current.inputMode).toBe('push_to_talk');
      expect(result.current.voiceActivityThreshold).toBe(50);

      // New fields get defaults
      expect(result.current.echoCancellation).toBe(true);
      expect(result.current.noiseSuppression).toBe(true);
      expect(result.current.autoGainControl).toBe(true);
      expect(result.current.voiceIsolation).toBe(false);
    });
  });

  describe('setAudioProcessing', () => {
    it('updates echoCancellation', () => {
      const { result } = renderHook(() => useVoiceSettings());

      act(() => {
        result.current.setAudioProcessing('echoCancellation', false);
      });

      expect(result.current.echoCancellation).toBe(false);
    });

    it('updates noiseSuppression', () => {
      const { result } = renderHook(() => useVoiceSettings());

      act(() => {
        result.current.setAudioProcessing('noiseSuppression', false);
      });

      expect(result.current.noiseSuppression).toBe(false);
    });

    it('updates autoGainControl', () => {
      const { result } = renderHook(() => useVoiceSettings());

      act(() => {
        result.current.setAudioProcessing('autoGainControl', false);
      });

      expect(result.current.autoGainControl).toBe(false);
    });

    it('updates voiceIsolation', () => {
      const { result } = renderHook(() => useVoiceSettings());

      act(() => {
        result.current.setAudioProcessing('voiceIsolation', true);
      });

      expect(result.current.voiceIsolation).toBe(true);
    });

    it('persists changes to localStorage', () => {
      const { result } = renderHook(() => useVoiceSettings());

      act(() => {
        result.current.setAudioProcessing('voiceIsolation', true);
      });

      expect(setCachedItem).toHaveBeenCalledWith(
        'semaphore_voice_settings',
        expect.objectContaining({ voiceIsolation: true }),
      );
    });

    it('preserves other settings when updating one audio processing field', () => {
      const { result } = renderHook(() => useVoiceSettings());

      act(() => {
        result.current.setAudioProcessing('echoCancellation', false);
      });

      // Other audio processing fields unchanged
      expect(result.current.noiseSuppression).toBe(true);
      expect(result.current.autoGainControl).toBe(true);
      expect(result.current.voiceIsolation).toBe(false);
      // Non-audio-processing fields unchanged
      expect(result.current.inputMode).toBe('voice_activity');
    });
  });

  describe('cross-instance sync (same tab)', () => {
    it('propagates setInputMode to other mounted instances', () => {
      // e.g. settings dialog instance vs. usePushToTalk's instance in VoiceBottomBar
      const panel = renderHook(() => useVoiceSettings());
      const bottomBar = renderHook(() => useVoiceSettings());

      expect(bottomBar.result.current.inputMode).toBe('voice_activity');

      act(() => {
        panel.result.current.setInputMode('push_to_talk');
      });

      expect(bottomBar.result.current.inputMode).toBe('push_to_talk');
      expect(bottomBar.result.current.isPushToTalk).toBe(true);
    });

    it('propagates saveVoiceSettings changes to other instances', () => {
      const a = renderHook(() => useVoiceSettings());
      const b = renderHook(() => useVoiceSettings());

      act(() => {
        a.result.current.setVoiceActivityThreshold(42);
      });

      expect(b.result.current.voiceActivityThreshold).toBe(42);
    });

    it('stops syncing after unmount', () => {
      const a = renderHook(() => useVoiceSettings());
      const b = renderHook(() => useVoiceSettings());
      b.unmount();

      expect(() => {
        act(() => {
          a.result.current.setInputMode('push_to_talk');
        });
      }).not.toThrow();
    });
  });

  describe('loads persisted audio processing settings', () => {
    it('restores saved audio processing values', () => {
      mockStorage['semaphore_voice_settings'] = {
        inputMode: 'voice_activity',
        pushToTalkKey: 'Backquote',
        pushToTalkKeyDisplay: '`',
        voiceActivityThreshold: 25,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: true,
        voiceIsolation: true,
      };

      const { result } = renderHook(() => useVoiceSettings());

      expect(result.current.echoCancellation).toBe(false);
      expect(result.current.noiseSuppression).toBe(false);
      expect(result.current.autoGainControl).toBe(true);
      expect(result.current.voiceIsolation).toBe(true);
    });
  });

  describe('micQuality', () => {
    it("defaults to 'high' with no saved settings", () => {
      const { result } = renderHook(() => useVoiceSettings());
      expect(result.current.micQuality).toBe('high');
    });

    it("falls back to 'high' for old stored settings without micQuality", () => {
      mockStorage['semaphore_voice_settings'] = {
        inputMode: 'push_to_talk',
        echoCancellation: false,
      };
      const { result } = renderHook(() => useVoiceSettings());
      expect(result.current.micQuality).toBe('high');
      expect(result.current.inputMode).toBe('push_to_talk');
    });

    it("falls back to 'high' for an unknown stored value", () => {
      mockStorage['semaphore_voice_settings'] = { micQuality: 'ultra' };
      const { result } = renderHook(() => useVoiceSettings());
      expect(result.current.micQuality).toBe('high');
    });

    it('persists setMicQuality', () => {
      const { result } = renderHook(() => useVoiceSettings());
      act(() => {
        result.current.setMicQuality('music');
      });
      expect(result.current.micQuality).toBe('music');
      expect(setCachedItem).toHaveBeenCalledWith(
        'semaphore_voice_settings',
        expect.objectContaining({ micQuality: 'music' }),
      );
    });
  });
});
