import { useEffect, useMemo } from 'react';
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
      void loadLoungeRoot();
    }
  }, [enabled]);

  return useMemo(() => chooseShell({ pathname, enabled, width }), [pathname, enabled, width]);
}
