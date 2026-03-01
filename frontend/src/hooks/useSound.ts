/**
 * useSound — Notification & UI sound playback utility
 *
 * Lazily preloads all WAV files from /sounds/ into Audio objects.
 * Provides a `playSound()` function that:
 *   - Resets currentTime to allow rapid re-triggers
 *   - Catches and swallows autoplay errors (browser restriction)
 *   - Works on both web and Electron
 */

import { useCallback } from 'react';
import { logger } from '../utils/logger';

// ---------------------------------------------------------------------------
// Sound name → file mapping
// ---------------------------------------------------------------------------

export const SoundMap = {
  // Messages
  channelMessage: 'pluck.wav',
  directMessage: 'asc-minor-third.wav',
  mention: 'asc-triad.wav',

  // Voice presence (other users)
  voiceUserJoined: 'asc-fourth.wav',
  voiceUserLeft: 'desc-fourth.wav',

  // Screen share
  screenShareStarted: 'asc-major-third.wav',
  screenShareStopped: 'desc-major-third.wav',

  // Calls
  incomingCall: 'asc-arpeggio.wav',
  callEnded: 'desc-arpeggio.wav',

  // Toggles (local user)
  toggleOn: 'asc-step.wav',
  toggleOff: 'desc-step.wav',

  // Connection (local user)
  connected: 'asc-fifth.wav',
  disconnected: 'desc-fifth.wav',

  // Alerts
  error: 'pluck-high.wav',
  dismissed: 'pluck-low.wav',
} as const;

export type SoundName = keyof typeof SoundMap;

/** Type-safe constants for sound names — use instead of string literals. */
export const Sounds: { readonly [K in SoundName]: K } = Object.keys(SoundMap).reduce(
  (acc, key) => ({ ...acc, [key]: key }),
  {} as { readonly [K in SoundName]: K },
);

// ---------------------------------------------------------------------------
// Audio cache (lazy singleton — shared across all hook instances)
// ---------------------------------------------------------------------------

let audioCache: Map<string, HTMLAudioElement> | null = null;

function getAudioCache(): Map<string, HTMLAudioElement> {
  if (audioCache) return audioCache;

  audioCache = new Map();

  if (typeof Audio === 'undefined') return audioCache;

  for (const [name, file] of Object.entries(SoundMap)) {
    try {
      const audio = new Audio(`./sounds/${file}`);
      // Preload so playback is instant
      audio.preload = 'auto';
      audioCache.set(name, audio);
    } catch {
      logger.warn(`[Sound] Failed to create Audio for ${name} (${file})`);
    }
  }

  return audioCache;
}

// ---------------------------------------------------------------------------
// Standalone playSound (for use outside React components / in action files)
// ---------------------------------------------------------------------------

export function playSound(name: SoundName): void {
  const cache = getAudioCache();
  const audio = cache.get(name);
  if (!audio) return;

  // Reset so rapid re-triggers work (e.g. multiple messages in quick succession)
  audio.currentTime = 0;
  audio.play().catch(() => {
    // Swallow autoplay restriction errors — user hasn't interacted yet
  });
}

// ---------------------------------------------------------------------------
// React hook (returns a stable playSound callback)
// ---------------------------------------------------------------------------

export function useSound() {
  const play = useCallback((name: SoundName) => {
    playSound(name);
  }, []);

  return { playSound: play };
}
