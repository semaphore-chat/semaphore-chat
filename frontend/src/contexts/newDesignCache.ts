/**
 * Forgetting this browser's copy of the "new design" account setting (M4).
 *
 * The setting is cached per browser (ThemeContext's localStorage entry, and the appearance settings
 * query in the cache), not per user. Without this the next account signed in here would get the
 * previous one's shell, and its chunk fetched, until its own settings arrive. Called on logout and
 * when the server ends the session. The account keeps its value: nothing is sent to the server.
 *
 * Its own module so callers (AuthGate, useLogout) do not depend on ThemeContext's exports.
 */
import type { QueryClient } from '@tanstack/react-query';
import { STORAGE_KEY } from '../theme/constants';
import { logger } from '../utils/logger';

/** Every variant of the appearance settings query. */
const APPEARANCE_SETTINGS_KEY = [{ _id: 'appearanceSettingsControllerGetSettings' }];

/** The mounted ThemeProvider's handler (there is one, in App). */
const handlers = new Set<() => void>();

/** For ThemeProvider: turn the setting off in its state without syncing. Returns the unregister. */
export function onForgetNewDesignSetting(handler: () => void): () => void {
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
  };
}

export function forgetNewDesignSetting(queryClient: QueryClient): void {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed: unknown = JSON.parse(stored);
      if (parsed && typeof parsed === 'object' && (parsed as Record<string, unknown>).newDesign === true) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...(parsed as Record<string, unknown>), newDesign: false }));
      }
    }
  } catch (e) {
    logger.warn('Failed to forget the new design setting:', e);
  }
  // The server's copy in the query cache would otherwise be applied to the next account's session.
  queryClient.removeQueries({ queryKey: APPEARANCE_SETTINGS_KEY });
  handlers.forEach((handler) => handler());
}
