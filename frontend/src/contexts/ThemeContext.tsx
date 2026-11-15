/**
 * Theme Context
 *
 * Provides theme state management for the application.
 * Types and constants are in ../theme/constants.ts to comply with React Fast Refresh.
 */

import { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef, ReactNode } from 'react';
import { ACCENT_PRIMARY, nearestAccent } from '@semaphore-chat/shared';
import { logger } from '../utils/logger';
import { ThemeProvider as MuiThemeProvider } from '@mui/material/styles';
import { generateTheme } from '../theme/themeConfig';
import { useThemeColorMeta } from '../hooks/useThemeColorMeta';
import {
  type ThemeMode,
  type AccentColor,
  type ThemeIntensity,
  type ThemeSettings,
  STORAGE_KEY,
  defaultSettings,
  isAccentColor,
  isThemeIntensity,
  isThemeMode,
  normalizeBaseColor,
} from '../theme/constants';

// Re-export types for backward compatibility (constants such as
// accentColors are imported from ../theme/constants directly).
export type { ThemeMode, AccentColor, ThemeIntensity, ThemeSettings };

// Callback type for server sync
type OnSettingsChangeCallback = (settings: ThemeSettings) => void;

export interface ThemeContextValue {
  settings: ThemeSettings;
  /** The base colour the new design derives its palette from. */
  baseColor: string;
  /** Whether the mode follows the operating system. */
  matchSystem: boolean;
  /** Whether the new design is on. */
  newDesign: boolean;
  /** `mode`, unless `matchSystem` is on, in which case the OS preference wins. */
  effectiveMode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  setAccentColor: (color: AccentColor) => void;
  setIntensity: (intensity: ThemeIntensity) => void;
  setBaseColor: (hex: string) => void;
  setMatchSystem: (matchSystem: boolean) => void;
  setNewDesign: (newDesign: boolean) => void;
  toggleMode: () => void;
  // Server sync methods
  applyServerSettings: (settings: ThemeSettings) => void;
  registerOnChange: (callback: OnSettingsChangeCallback) => () => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

/**
 * Stored JSON into current settings. An object written before `baseColor`
 * existed gets the primary of its stored accent, so the first paint matches.
 * Unknown or malformed values fall back to the defaults one field at a time
 * (a bad colour to the stored accent's primary). Never throws.
 */
function migrateSettings(stored: Record<string, unknown>): ThemeSettings {
  const accentColor = isAccentColor(stored.accentColor) ? stored.accentColor : defaultSettings.accentColor;
  return {
    mode: isThemeMode(stored.mode) ? stored.mode : defaultSettings.mode,
    accentColor,
    intensity: isThemeIntensity(stored.intensity) ? stored.intensity : defaultSettings.intensity,
    baseColor: normalizeBaseColor(stored.baseColor) ?? ACCENT_PRIMARY[accentColor],
    matchSystem: typeof stored.matchSystem === 'boolean' ? stored.matchSystem : defaultSettings.matchSystem,
    newDesign: typeof stored.newDesign === 'boolean' ? stored.newDesign : defaultSettings.newDesign,
  };
}

function loadSettings(): ThemeSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed: unknown = JSON.parse(stored);
      if (parsed && typeof parsed === 'object') return migrateSettings(parsed as Record<string, unknown>);
    }
  } catch (e) {
    logger.warn('Failed to load theme settings:', e);
  }
  return defaultSettings;
}

function saveSettings(settings: ThemeSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    logger.warn('Failed to save theme settings:', e);
  }
}

const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)';

/** The OS preference right now; `false` (light) where `matchMedia` is missing. */
function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(DARK_SCHEME_QUERY).matches;
}

/**
 * The OS light/dark preference, followed only while `enabled`: the listener
 * exists exactly as long as "match system" is on, and updates live.
 */
function useSystemPrefersDark(enabled: boolean): boolean {
  const [prefersDark, setPrefersDark] = useState(systemPrefersDark);
  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia(DARK_SCHEME_QUERY);
    const update = () => setPrefersDark(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, [enabled]);
  return prefersDark;
}

interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [settings, setSettings] = useState<ThemeSettings>(loadSettings);
  const onChangeCallbacksRef = useRef<Set<OnSettingsChangeCallback>>(new Set());
  const isApplyingServerSettingsRef = useRef(false);

  // Save to localStorage whenever settings change
  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  // Notify callbacks when settings change (but not when applying server settings)
  useEffect(() => {
    if (!isApplyingServerSettingsRef.current) {
      onChangeCallbacksRef.current.forEach((callback) => callback(settings));
    }
  }, [settings]);

  const setMode = useCallback((mode: ThemeMode) => {
    setSettings((prev) => ({ ...prev, mode }));
  }, []);

  const setAccentColor = useCallback((accentColor: AccentColor) => {
    // The base colour follows the picker, so the two never disagree locally.
    setSettings((prev) => ({ ...prev, accentColor, baseColor: ACCENT_PRIMARY[accentColor] }));
  }, []);

  const setIntensity = useCallback((intensity: ThemeIntensity) => {
    setSettings((prev) => ({ ...prev, intensity }));
  }, []);

  const setBaseColor = useCallback((hex: string) => {
    const baseColor = normalizeBaseColor(hex);
    if (!baseColor) return;
    setSettings((prev) => ({ ...prev, baseColor, accentColor: nearestAccent(baseColor) }));
  }, []);

  const setMatchSystem = useCallback((matchSystem: boolean) => {
    setSettings((prev) => ({ ...prev, matchSystem }));
  }, []);

  const setNewDesign = useCallback((newDesign: boolean) => {
    setSettings((prev) => ({ ...prev, newDesign }));
  }, []);

  const toggleMode = useCallback(() => {
    setSettings((prev) => ({
      ...prev,
      mode: prev.mode === 'dark' ? 'light' : 'dark',
    }));
  }, []);

  // Apply settings from server (doesn't trigger onChange callbacks)
  const applyServerSettings = useCallback((serverSettings: ThemeSettings) => {
    isApplyingServerSettingsRef.current = true;
    setSettings(serverSettings);
    // Reset flag after state update
    setTimeout(() => {
      isApplyingServerSettingsRef.current = false;
    }, 0);
  }, []);

  // Register a callback to be called when settings change
  const registerOnChange = useCallback((callback: OnSettingsChangeCallback) => {
    onChangeCallbacksRef.current.add(callback);
    return () => {
      onChangeCallbacksRef.current.delete(callback);
    };
  }, []);

  const prefersDark = useSystemPrefersDark(settings.matchSystem);
  const effectiveMode: ThemeMode = settings.matchSystem ? (prefersDark ? 'dark' : 'light') : settings.mode;

  // Generate MUI theme based on current settings. The old shell shows the
  // named accent nearest the base colour; for each accent's own primary that
  // is the accent itself, so every existing theme is unchanged.
  const theme = useMemo(
    () => generateTheme(effectiveMode, nearestAccent(settings.baseColor), settings.intensity),
    [effectiveMode, settings.baseColor, settings.intensity]
  );

  // Browser/OS chrome colour follows the app bar surface (always a solid colour).
  useThemeColorMeta(theme.palette.background.paper);

  const contextValue = useMemo(
    () => ({
      settings,
      baseColor: settings.baseColor,
      matchSystem: settings.matchSystem,
      newDesign: settings.newDesign,
      effectiveMode,
      setMode,
      setAccentColor,
      setIntensity,
      setBaseColor,
      setMatchSystem,
      setNewDesign,
      toggleMode,
      applyServerSettings,
      registerOnChange,
    }),
    [
      settings,
      effectiveMode,
      setMode,
      setAccentColor,
      setIntensity,
      setBaseColor,
      setMatchSystem,
      setNewDesign,
      toggleMode,
      applyServerSettings,
      registerOnChange,
    ]
  );

  return (
    <ThemeContext.Provider value={contextValue}>
      <MuiThemeProvider theme={theme}>{children}</MuiThemeProvider>
    </ThemeContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
