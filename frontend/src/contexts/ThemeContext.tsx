/**
 * Theme Context
 *
 * Provides theme state management for the application.
 * Types and constants are in ../theme/constants.ts to comply with React Fast Refresh.
 */

import { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef, ReactNode } from 'react';
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
} from '../theme/constants';

// Re-export types and constants for backward compatibility
export type { ThemeMode, AccentColor, ThemeIntensity, ThemeSettings };
export { accentColors } from '../theme/constants';

// Callback type for server sync
type OnSettingsChangeCallback = (settings: ThemeSettings) => void;

interface ThemeContextType {
  settings: ThemeSettings;
  setMode: (mode: ThemeMode) => void;
  setAccentColor: (color: AccentColor) => void;
  setIntensity: (intensity: ThemeIntensity) => void;
  toggleMode: () => void;
  // Server sync methods
  applyServerSettings: (settings: ThemeSettings) => void;
  registerOnChange: (callback: OnSettingsChangeCallback) => () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

function loadSettings(): ThemeSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        mode: parsed.mode || defaultSettings.mode,
        accentColor: parsed.accentColor || defaultSettings.accentColor,
        intensity: parsed.intensity || defaultSettings.intensity,
      };
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
    setSettings((prev) => ({ ...prev, accentColor }));
  }, []);

  const setIntensity = useCallback((intensity: ThemeIntensity) => {
    setSettings((prev) => ({ ...prev, intensity }));
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

  // Generate MUI theme based on current settings
  const theme = useMemo(
    () => generateTheme(settings.mode, settings.accentColor, settings.intensity),
    [settings.mode, settings.accentColor, settings.intensity]
  );

  // Browser/OS chrome colour follows the app bar surface (always a solid colour).
  useThemeColorMeta(theme.palette.background.paper);

  const contextValue = useMemo(
    () => ({
      settings,
      setMode,
      setAccentColor,
      setIntensity,
      toggleMode,
      applyServerSettings,
      registerOnChange,
    }),
    [settings, setMode, setAccentColor, setIntensity, toggleMode, applyServerSettings, registerOnChange]
  );

  return (
    <ThemeContext.Provider value={contextValue}>
      <MuiThemeProvider theme={theme}>{children}</MuiThemeProvider>
    </ThemeContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTheme(): ThemeContextType {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
