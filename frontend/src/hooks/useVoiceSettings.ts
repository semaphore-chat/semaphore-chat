import { useState, useEffect, useCallback } from 'react';
import { getCachedItem, setCachedItem } from '../utils/storage';
import { DEFAULT_MIC_QUALITY, isMicQuality, type MicQuality } from '../utils/voiceQuality';

export type VoiceInputMode = 'voice_activity' | 'push_to_talk';

export interface VoiceSettings {
  inputMode: VoiceInputMode;
  pushToTalkKey: string;        // KeyboardEvent.code, e.g., 'Space', 'KeyV'
  pushToTalkKeyDisplay: string; // Human-readable display, e.g., 'Space', 'V'
  voiceActivityThreshold: number; // 0-100, default 0 (lower = more sensitive)
  echoCancellation: boolean;     // default: true
  noiseSuppression: boolean;     // default: true
  autoGainControl: boolean;      // default: true
  voiceIsolation: boolean;       // default: false (experimental)
  micQuality: MicQuality;        // default: 'high'
}

const VOICE_SETTINGS_KEY = 'semaphore_voice_settings';

// Same-tab sync event: each useVoiceSettings() call holds its own useState,
// and localStorage 'storage' events only fire in OTHER tabs. Without this
// event, a mode change made in the settings dialog would never reach other
// mounted instances (e.g. usePushToTalk inside VoiceBottomBar) until remount.
const VOICE_SETTINGS_EVENT = 'semaphore:voice-settings-changed';

const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  inputMode: 'voice_activity',
  pushToTalkKey: 'Backquote',
  pushToTalkKeyDisplay: '`',
  voiceActivityThreshold: 0,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  voiceIsolation: false,
  micQuality: DEFAULT_MIC_QUALITY,
};

/**
 * Helper to get a human-readable key name from a keyboard event
 */
export function getKeyDisplayName(event: KeyboardEvent): string {
  // Handle special keys
  const specialKeys: Record<string, string> = {
    ' ': 'Space',
    'Space': 'Space',
    'ArrowUp': 'Arrow Up',
    'ArrowDown': 'Arrow Down',
    'ArrowLeft': 'Arrow Left',
    'ArrowRight': 'Arrow Right',
    'Backquote': '`',
    'Minus': '-',
    'Equal': '=',
    'BracketLeft': '[',
    'BracketRight': ']',
    'Backslash': '\\',
    'Semicolon': ';',
    'Quote': "'",
    'Comma': ',',
    'Period': '.',
    'Slash': '/',
  };

  // Check for special keys first
  if (specialKeys[event.code]) {
    return specialKeys[event.code];
  }

  // For letter keys (KeyA, KeyB, etc.), extract the letter
  if (event.code.startsWith('Key')) {
    return event.code.slice(3);
  }

  // For digit keys (Digit1, Digit2, etc.), extract the number
  if (event.code.startsWith('Digit')) {
    return event.code.slice(5);
  }

  // For numpad keys
  if (event.code.startsWith('Numpad')) {
    return `Numpad ${event.code.slice(6)}`;
  }

  // For function keys
  if (event.code.startsWith('F') && !isNaN(parseInt(event.code.slice(1)))) {
    return event.code;
  }

  // Default to the key value or code
  return event.key.length === 1 ? event.key.toUpperCase() : event.code;
}

export const useVoiceSettings = () => {
  // Load saved voice settings
  const [voiceSettings, setVoiceSettings] = useState<VoiceSettings>(() => {
    const saved = getCachedItem<VoiceSettings>(VOICE_SETTINGS_KEY);
    if (!saved) return DEFAULT_VOICE_SETTINGS;
    const merged = { ...DEFAULT_VOICE_SETTINGS, ...saved };
    // A hand-edited or future value must not reach LiveKit.
    if (!isMicQuality(merged.micQuality)) merged.micQuality = DEFAULT_MIC_QUALITY;
    return merged;
  });

  // Keep all hook instances in sync when any of them saves settings
  useEffect(() => {
    const handleSettingsChanged = (event: Event) => {
      const detail = (event as CustomEvent<VoiceSettings>).detail;
      if (detail) {
        // Identity guard so the dispatching instance's own event (delivered
        // synchronously, possibly before its setState commits) is a no-op.
        setVoiceSettings((prev) => (Object.is(prev, detail) ? prev : detail));
      }
    };
    window.addEventListener(VOICE_SETTINGS_EVENT, handleSettingsChanged);
    return () => window.removeEventListener(VOICE_SETTINGS_EVENT, handleSettingsChanged);
  }, []);

  // Save voice settings
  const saveVoiceSettings = useCallback((settings: Partial<VoiceSettings>) => {
    const newSettings = { ...voiceSettings, ...settings };
    setVoiceSettings(newSettings);
    setCachedItem(VOICE_SETTINGS_KEY, newSettings);
    // Notify other useVoiceSettings instances in this tab (self-dispatch is a
    // no-op via the listener's Object.is guard on the same object reference)
    window.dispatchEvent(new CustomEvent(VOICE_SETTINGS_EVENT, { detail: newSettings }));
  }, [voiceSettings]);

  // Set input mode
  const setInputMode = useCallback((mode: VoiceInputMode) => {
    saveVoiceSettings({ inputMode: mode });
  }, [saveVoiceSettings]);

  // Set PTT key from a keyboard event
  const setPushToTalkKey = useCallback((event: KeyboardEvent) => {
    saveVoiceSettings({
      pushToTalkKey: event.code,
      pushToTalkKeyDisplay: getKeyDisplayName(event),
    });
  }, [saveVoiceSettings]);

  // Set PTT key directly (for programmatic use)
  const setPushToTalkKeyDirect = useCallback((key: string, displayName: string) => {
    saveVoiceSettings({
      pushToTalkKey: key,
      pushToTalkKeyDisplay: displayName,
    });
  }, [saveVoiceSettings]);

  // Set voice activity threshold
  const setVoiceActivityThreshold = useCallback((threshold: number) => {
    saveVoiceSettings({ voiceActivityThreshold: threshold });
  }, [saveVoiceSettings]);

  // Set audio processing toggle
  type AudioProcessingKey = 'echoCancellation' | 'noiseSuppression' | 'autoGainControl' | 'voiceIsolation';
  const setAudioProcessing = useCallback((key: AudioProcessingKey, value: boolean) => {
    saveVoiceSettings({ [key]: value });
  }, [saveVoiceSettings]);

  // Set microphone publish quality (applies the next time voice is joined)
  const setMicQuality = useCallback((quality: MicQuality) => {
    saveVoiceSettings({ micQuality: quality });
  }, [saveVoiceSettings]);

  return {
    // Current settings
    settings: voiceSettings,

    // Convenience accessors
    inputMode: voiceSettings.inputMode,
    pushToTalkKey: voiceSettings.pushToTalkKey,
    pushToTalkKeyDisplay: voiceSettings.pushToTalkKeyDisplay,
    voiceActivityThreshold: voiceSettings.voiceActivityThreshold,
    isPushToTalk: voiceSettings.inputMode === 'push_to_talk',
    echoCancellation: voiceSettings.echoCancellation,
    noiseSuppression: voiceSettings.noiseSuppression,
    autoGainControl: voiceSettings.autoGainControl,
    voiceIsolation: voiceSettings.voiceIsolation,
    micQuality: voiceSettings.micQuality,

    // Setters
    setInputMode,
    setPushToTalkKey,
    setPushToTalkKeyDirect,
    setVoiceActivityThreshold,
    setAudioProcessing,
    setMicQuality,
    saveVoiceSettings,
  };
};

// Export the storage key for use in voiceActions
export { VOICE_SETTINGS_KEY };
