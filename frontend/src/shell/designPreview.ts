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
import { useContext, useEffect, useSyncExternalStore } from 'react';
import { UNSAFE_NavigationContext, useLocation, useNavigate, type Location } from 'react-router-dom';

export type DesignPreview = 'lounge' | 'classic';
export type DesignParam = DesignPreview | 'reset';

export const DESIGN_PREVIEW_KEY = 'semaphore-design-preview';
export const DESIGN_PARAM = 'design';

const listeners = new Set<() => void>();
/** The override when sessionStorage cannot be used. */
let memory: DesignPreview | null = null;
/** Set once a write has failed (storage full, or reads work but writes throw): from then on `memory` is the truth. */
let storageBroken = false;

function parsePreview(value: string | null): DesignPreview | null {
  return value === 'lounge' || value === 'classic' ? value : null;
}

/** The `?design=` value in a location's search string, or null when it is absent or unknown. */
export function parseDesignParam(search: string): DesignParam | null {
  const value = new URLSearchParams(search).get(DESIGN_PARAM);
  return value === 'lounge' || value === 'classic' || value === 'reset' ? value : null;
}

export function readDesignPreview(): DesignPreview | null {
  if (storageBroken) {
    return memory;
  }
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
    storageBroken = false;
  } catch {
    // Storage unavailable: `memory` holds it for this page.
    storageBroken = true;
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
  // The router's history: its `location` is the current one when the effect runs, which can be
  // newer than the one this component rendered with (a child navigated in the same commit).
  const { navigator } = useContext(UNSAFE_NavigationContext);
  useEffect(() => {
    const value = parseDesignParam(location.search);
    if (!new URLSearchParams(location.search).has(DESIGN_PARAM)) {
      return;
    }
    if (value === 'reset') {
      clearDesignPreview();
    } else if (value !== null) {
      setDesignPreview(value);
    }
    // Remove the parameter from the location as it is now, not as it was rendered: never undo
    // another component's navigation. If the router has moved on, the parameter is gone already.
    const current = (navigator as unknown as { location?: Location }).location ?? location;
    const params = new URLSearchParams(current.search);
    if (!params.has(DESIGN_PARAM)) {
      return;
    }
    params.delete(DESIGN_PARAM);
    const search = params.toString();
    navigate(
      { pathname: current.pathname, search: search ? `?${search}` : '', hash: current.hash },
      { replace: true, state: current.state },
    );
  }, [location, navigate, navigator]);
}
