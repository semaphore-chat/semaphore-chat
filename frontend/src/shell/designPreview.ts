/**
 * The design preview: a per-tab override of the "new design" account setting.
 *
 * `#/<any path>?design=lounge` turns the new design on for this tab,
 * `?design=classic` turns it off, `?design=reset` drops the override so the
 * account setting applies again. The override lives in sessionStorage only: it
 * never reaches the server or the user's other devices, and it is cleared on
 * logout so the next person to sign in on the tab does not inherit it.
 *
 * Every storage access is in try/catch: in a private window or with site data
 * blocked the storage can throw, and then the override lives in memory for the
 * page's lifetime.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

export type DesignPreview = 'lounge' | 'classic';
export type DesignParam = DesignPreview | 'reset';

export const DESIGN_PREVIEW_KEY = 'semaphore-design-preview';
export const DESIGN_PARAM = 'design';

const listeners = new Set<() => void>();
/** Used only while sessionStorage throws. */
let memory: DesignPreview | null = null;

function parsePreview(value: string | null): DesignPreview | null {
  return value === 'lounge' || value === 'classic' ? value : null;
}

/** The `?design=` value in a location's search string, or null when it is absent or unknown. */
export function parseDesignParam(search: string): DesignParam | null {
  const value = new URLSearchParams(search).get(DESIGN_PARAM);
  return value === 'lounge' || value === 'classic' || value === 'reset' ? value : null;
}

export function readDesignPreview(): DesignPreview | null {
  try {
    return parsePreview(window.sessionStorage.getItem(DESIGN_PREVIEW_KEY));
  } catch {
    return memory;
  }
}

function write(value: DesignPreview | null): void {
  const before = readDesignPreview();
  memory = value;
  try {
    if (value === null) {
      window.sessionStorage.removeItem(DESIGN_PREVIEW_KEY);
    } else {
      window.sessionStorage.setItem(DESIGN_PREVIEW_KEY, value);
    }
  } catch {
    // Storage unavailable: `memory` holds it for this page.
  }
  if (readDesignPreview() !== before) {
    listeners.forEach((listener) => listener());
  }
}

export function setDesignPreview(value: DesignPreview): void {
  write(value);
}

export function clearDesignPreview(): void {
  write(null);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** This tab's override, or null when the account setting applies. */
export function useDesignPreview(): DesignPreview | null {
  return useSyncExternalStore(subscribe, readDesignPreview, () => null);
}

/**
 * Applies a `?design=` parameter in the current location and removes it from
 * the URL, so a copied link does not carry it. Mounted in App, above the sign-in
 * gate, so a preview link survives the redirect to the login page.
 */
export function useDesignPreviewParam(): void {
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (!params.has(DESIGN_PARAM)) {
      return;
    }
    const value = parseDesignParam(location.search);
    if (value === 'reset') {
      clearDesignPreview();
    } else if (value !== null) {
      setDesignPreview(value);
    }
    params.delete(DESIGN_PARAM);
    const search = params.toString();
    navigate(
      { pathname: location.pathname, search: search ? `?${search}` : '', hash: location.hash },
      { replace: true, state: location.state },
    );
  }, [location, navigate]);
}
