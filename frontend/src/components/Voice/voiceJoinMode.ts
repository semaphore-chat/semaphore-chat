export type VoiceJoinMode = 'full' | 'listen-only' | 'none';

/**
 * Pure: which join controls a user gets from their channel capabilities.
 * No CONNECT → no button at all; CONNECT without SPEAK (incl. a community
 * timeout) → a single listen-only join; otherwise "Join voice" + "Join muted".
 */
export function voiceJoinMode(can: { connect: boolean; speak: boolean }): VoiceJoinMode {
  if (!can.connect) return 'none';
  if (!can.speak) return 'listen-only';
  return 'full';
}
