/**
 * Ladle global Provider (wraps every story, screen or component). See the
 * design doc for the full architecture; per-story concerns (QueryClient,
 * MemoryRouter, SocketContext, auth) deliberately live in
 * `src/stories/fixtures/SandboxShell.tsx` instead of here — see that file's
 * header comment for why.
 *
 * This uses the REAL app `ThemeProvider` (contexts/ThemeContext.tsx), not a
 * bare MUI `ThemeProvider` — the app's own `useTheme()` hook (which several
 * hooks Layout depends on call, e.g. `useThemeSync`) throws outside of it,
 * and it already wraps MUI's ThemeProvider + generates the real theme
 * internally. `ThemeBridge` just wires Ladle's built-in light/dark control
 * to the app's own `setMode`.
 */
import * as React from 'react';
import type { GlobalProvider } from '@ladle/react';
import { ThemeState } from '@ladle/react';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider, useTheme, type ThemeMode } from '../src/contexts/ThemeContext';
// The app's global stylesheet (main.tsx imports it too): defines `--full-dvh`,
// which the desktop community rail and other full-height panes size from —
// without it they collapse to their content height.
import '../src/index.css';

const ThemeBridge: React.FC<{ ladleMode: ThemeMode; children: React.ReactNode }> = ({ ladleMode, children }) => {
  const { settings, setMode } = useTheme();
  React.useEffect(() => {
    if (settings.mode !== ladleMode) setMode(ladleMode);
  }, [ladleMode, settings.mode, setMode]);
  return <>{children}</>;
};

export const Provider: GlobalProvider = ({ children, globalState }) => {
  const ladleMode: ThemeMode = globalState.theme === ThemeState.Light ? 'light' : 'dark';
  return (
    <ThemeProvider>
      <CssBaseline />
      <ThemeBridge ladleMode={ladleMode}>{children}</ThemeBridge>
    </ThemeProvider>
  );
};
