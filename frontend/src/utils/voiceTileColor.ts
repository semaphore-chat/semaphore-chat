import { stringToColor } from './communityHelpers';

/**
 * Deterministic per-user colour for VOICE TILES ONLY: the tile's background
 * tint and the initial-avatar fallback inside voice tiles. Avatars elsewhere
 * in the app keep MUI's default; don't reuse this outside components/Voice.
 */
export function voiceTileColor(userId: string): string {
  return stringToColor(userId).bg;
}
