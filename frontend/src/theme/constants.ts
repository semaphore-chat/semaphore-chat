/**
 * Theme Constants
 *
 * Shared theme-related constants extracted from ThemeContext
 * to comply with React Fast Refresh requirements.
 */

import { ACCENT_NAMES, ACCENT_PRIMARY } from '@semaphore-chat/shared';

export type ThemeMode = 'dark' | 'light';
export type AccentColor =
  | 'teal'
  | 'purple'
  | 'orange'
  | 'blue'
  | 'rose'
  | 'emerald'
  | 'red'
  | 'amber'
  | 'indigo'
  | 'cyan'
  | 'lime'
  | 'slate';
export type ThemeIntensity = 'minimal' | 'balanced' | 'vibrant';

export interface ThemeSettings {
  mode: ThemeMode;
  accentColor: AccentColor;
  intensity: ThemeIntensity;
  /** Any `#rrggbb`; the old shell shows the nearest named accent. */
  baseColor: string;
  /** Follow the operating system's light/dark preference. */
  matchSystem: boolean;
  /** Use the new design. */
  newDesign: boolean;
}

const BASE_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

/** `value` as a lower-case `#rrggbb`, or `null` when it isn't a six-digit hex colour. */
export function normalizeBaseColor(value: unknown): string | null {
  return typeof value === 'string' && BASE_COLOR_PATTERN.test(value) ? value.toLowerCase() : null;
}

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'dark' || value === 'light';
}

export function isAccentColor(value: unknown): value is AccentColor {
  return typeof value === 'string' && (ACCENT_NAMES as readonly string[]).includes(value);
}

export function isThemeIntensity(value: unknown): value is ThemeIntensity {
  return value === 'minimal' || value === 'balanced' || value === 'vibrant';
}

export interface AccentColorInfo {
  id: AccentColor;
  name: string;
  primary: string;
}

// Export accent color info for the settings UI
export const accentColors: AccentColorInfo[] = [
  { id: 'teal', name: 'Ocean Teal', primary: ACCENT_PRIMARY.teal },
  { id: 'blue', name: 'Sky Blue', primary: ACCENT_PRIMARY.blue },
  { id: 'indigo', name: 'Deep Indigo', primary: ACCENT_PRIMARY.indigo },
  { id: 'purple', name: 'Soft Purple', primary: ACCENT_PRIMARY.purple },
  { id: 'rose', name: 'Rose Pink', primary: ACCENT_PRIMARY.rose },
  { id: 'red', name: 'Crimson Red', primary: ACCENT_PRIMARY.red },
  { id: 'orange', name: 'Coral Orange', primary: ACCENT_PRIMARY.orange },
  { id: 'amber', name: 'Golden Amber', primary: ACCENT_PRIMARY.amber },
  { id: 'lime', name: 'Lime Green', primary: ACCENT_PRIMARY.lime },
  { id: 'emerald', name: 'Emerald Green', primary: ACCENT_PRIMARY.emerald },
  { id: 'cyan', name: 'Electric Cyan', primary: ACCENT_PRIMARY.cyan },
  { id: 'slate', name: 'Slate Gray', primary: ACCENT_PRIMARY.slate },
];

export const STORAGE_KEY = 'semaphore-theme';

export const defaultSettings: ThemeSettings = {
  mode: 'dark',
  accentColor: 'teal',
  intensity: 'minimal',
  baseColor: ACCENT_PRIMARY.teal,
  matchSystem: false,
  newDesign: false,
};
