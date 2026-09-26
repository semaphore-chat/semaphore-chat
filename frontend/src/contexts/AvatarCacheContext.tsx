/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useRef, useCallback, useEffect, useMemo } from "react";
import { getApiUrl } from "../config/env";
import { getAccessToken } from "../utils/tokenService";
import { logger } from "../utils/logger";

// Maximum number of cached blob URLs to prevent memory leaks
const MAX_CACHE_SIZE = 100;

interface CacheEntry {
  blobUrl: string;
  lastAccessed: number;
}

interface FileCacheContextType {
  getBlob: (fileId: string) => string | null;
  setBlob: (fileId: string, blobUrl: string) => void;
  hasBlob: (fileId: string) => boolean;
  fetchBlob: (fileId: string) => Promise<string>;
  fetchThumbnail: (fileId: string) => Promise<string>;
}

const FileCacheContext = createContext<FileCacheContextType | null>(null);

export const useFileCache = () => {
  const context = useContext(FileCacheContext);
  if (!context) {
    throw new Error("useFileCache must be used within FileCacheProvider");
  }
  return context;
};

/** The file cache, or null outside a FileCacheProvider (e.g. in a hook test). */
export const useOptionalFileCache = (): FileCacheContextType | null => useContext(FileCacheContext);

// Keep old name for backward compatibility
export const useAvatarCache = useFileCache;

interface FileCacheProviderProps {
  children: React.ReactNode;
  maxCacheSize?: number;
}

export const FileCacheProvider: React.FC<FileCacheProviderProps> = ({
  children,
  maxCacheSize = MAX_CACHE_SIZE,
}) => {
  // Use ref to store cache so it doesn't trigger re-renders
  // Now stores CacheEntry with lastAccessed timestamp for LRU eviction
  const cacheRef = useRef<Map<string, CacheEntry>>(new Map());
  // Track in-flight requests to prevent duplicate fetches (race condition fix)
  const pendingRef = useRef<Map<string, Promise<string>>>(new Map());

  /**
   * Evict least recently used entries when cache exceeds max size.
   * Revokes blob URLs to free memory.
   */
  const evictIfNeeded = useCallback(() => {
    const cache = cacheRef.current;
    if (cache.size <= maxCacheSize) return;

    // Convert to array and sort by lastAccessed (oldest first)
    const entries = Array.from(cache.entries()).sort(
      ([, a], [, b]) => a.lastAccessed - b.lastAccessed
    );

    // Evict oldest entries until we're at 80% capacity
    const targetSize = Math.floor(maxCacheSize * 0.8);
    const entriesToRemove = entries.slice(0, cache.size - targetSize);

    for (const [fileId, entry] of entriesToRemove) {
      URL.revokeObjectURL(entry.blobUrl);
      cache.delete(fileId);
    }

    if (entriesToRemove.length > 0) {
      logger.debug(
        'FileCache',
        `Evicted ${entriesToRemove.length} entries, cache size: ${cache.size}`
      );
    }
  }, [maxCacheSize]);

  const getBlob = useCallback((fileId: string): string | null => {
    const entry = cacheRef.current.get(fileId);
    if (entry) {
      // Update lastAccessed time on access (LRU behavior)
      entry.lastAccessed = Date.now();
      return entry.blobUrl;
    }
    return null;
  }, []);

  const setBlob = useCallback((fileId: string, blobUrl: string) => {
    cacheRef.current.set(fileId, {
      blobUrl,
      lastAccessed: Date.now(),
    });
    evictIfNeeded();
  }, [evictIfNeeded]);

  const hasBlob = useCallback((fileId: string): boolean => {
    return cacheRef.current.has(fileId);
  }, []);

  /**
   * Fetch an authenticated file by URL, with cache + in-flight deduplication.
   * Used by both fetchBlob and fetchThumbnail.
   */
  const fetchWithCache = useCallback(async (cacheKey: string, url: string): Promise<string> => {
    // 1. Return cached blob URL if exists
    const cached = cacheRef.current.get(cacheKey);
    if (cached) {
      cached.lastAccessed = Date.now();
      return cached.blobUrl;
    }

    // 2. Return in-flight promise if already fetching (prevents duplicate fetches)
    const pending = pendingRef.current.get(cacheKey);
    if (pending) {
      return pending;
    }

    // 3. Start new fetch and track it
    const fetchPromise = (async () => {
      try {
        const token = getAccessToken();
        if (!token) {
          throw new Error("No authentication token found");
        }

        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch file: ${response.status}`);
        }

        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);

        cacheRef.current.set(cacheKey, {
          blobUrl,
          lastAccessed: Date.now(),
        });

        pendingRef.current.delete(cacheKey);
        evictIfNeeded();
        return blobUrl;
      } catch (error) {
        pendingRef.current.delete(cacheKey);
        throw error;
      }
    })();

    pendingRef.current.set(cacheKey, fetchPromise);
    return fetchPromise;
  }, [evictIfNeeded]);

  const fetchBlob = useCallback(
    (fileId: string) => fetchWithCache(fileId, getApiUrl(`/file/${fileId}`)),
    [fetchWithCache],
  );

  const fetchThumbnail = useCallback(
    (fileId: string) => fetchWithCache(`thumb:${fileId}`, getApiUrl(`/file/${fileId}/thumbnail`)),
    [fetchWithCache],
  );

  // Cleanup: Revoke all blob URLs when provider unmounts
  useEffect(() => {
    // Capture ref values for cleanup
    const cache = cacheRef.current;
    const pending = pendingRef.current;

    return () => {
      cache.forEach((entry) => {
        URL.revokeObjectURL(entry.blobUrl);
      });
      cache.clear();
      pending.clear();
    };
  }, []);

  // Stable identity: every useAuthenticatedFile effect depends on it, so a
  // new object per provider render would restart every file fetch effect.
  const value = useMemo<FileCacheContextType>(
    () => ({ getBlob, setBlob, hasBlob, fetchBlob, fetchThumbnail }),
    [getBlob, setBlob, hasBlob, fetchBlob, fetchThumbnail],
  );

  return (
    <FileCacheContext.Provider value={value}>
      {children}
    </FileCacheContext.Provider>
  );
};

// Keep old name for backward compatibility
export const AvatarCacheProvider = FileCacheProvider;
