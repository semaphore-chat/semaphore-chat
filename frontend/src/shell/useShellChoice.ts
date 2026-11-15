import { useDeferredValue, useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { useNewDesignSetting } from '../contexts/ThemeContext';
import { chooseShell, type ShellChoice } from './chooseShell';
import { parseDesignParam, useDesignPreview } from './designPreview';
import { loadLoungeRoot } from './loungeRootChunk';
import { useShellWidthRange } from './widthRange';

/**
 * Whether the new design is on for this tab: a `?design=` parameter still in
 * the URL (App removes it right after the first render), then this tab's
 * preview override, then the account setting.
 */
export function useNewDesignEnabled(search: string): boolean {
  const setting = useNewDesignSetting();
  const preview = useDesignPreview();
  const param = parseDesignParam(search);
  if (param === 'lounge' || param === 'classic') {
    return param === 'lounge';
  }
  if (param === 'reset' || preview === null) {
    return setting;
  }
  return preview === 'lounge';
}

/** The shell for the current location and width. Preloads the new shell's chunk once the new design is on. */
export function useShellChoice(): ShellChoice {
  const { pathname, search } = useLocation();
  const enabled = useNewDesignEnabled(search);
  const width = useShellWidthRange();

  useEffect(() => {
    if (enabled) {
      // A failure here is retried by the shell's own load, which shows it.
      loadLoungeRoot().catch(() => undefined);
    }
  }, [enabled]);

  // Deferred: the setting (a plain setState), the preview and the width (useSyncExternalStore) change
  // in synchronous renders. Switching shells mounts the other one, whose page may still be a lazy
  // chunk; in a synchronous render it would suspend up to App's top-level Suspense, which hides and
  // cleans up the whole signed-in tree, the call included. A deferred render that suspends shows no
  // fallback: the current screen stays until the new one is ready, as with a router navigation
  // (pathname changes are transitions already).
  const shellEnabled = useDeferredValue(enabled);
  const shellWidth = useDeferredValue(width);
  return useMemo(
    () => chooseShell({ pathname, enabled: shellEnabled, width: shellWidth }),
    [pathname, shellEnabled, shellWidth],
  );
}
