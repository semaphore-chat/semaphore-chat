// Generic localStorage abstraction with optional expiration.
//
// Every access is wrapped in try/catch: the localStorage accessor itself can
// throw (private windows, blocked site data, sandboxed previews), and a
// quota-exceeded write must never break the UI. Reads fall back to null and
// writes are best-effort.
export function getCachedItem<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && parsed._expiresAt) {
      if (Date.now() > parsed._expiresAt) {
        localStorage.removeItem(key);
        return null;
      }
      return parsed.value as T;
    }
    return parsed as T;
  } catch {
    return null;
  }
}

export function setCachedItem<T>(key: string, value: T, ttlMs?: number) {
  try {
    if (ttlMs) {
      localStorage.setItem(
        key,
        JSON.stringify({ value, _expiresAt: Date.now() + ttlMs })
      );
    } else {
      localStorage.setItem(key, JSON.stringify(value));
    }
  } catch {
    // Best-effort: storage unavailable or full.
  }
}

export function removeCachedItem(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Best-effort: storage unavailable.
  }
}
