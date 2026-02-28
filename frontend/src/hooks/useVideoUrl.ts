import { useState, useEffect, useCallback, useRef } from 'react';
import { getApiUrl } from '../config/env';
import { getAccessToken } from '../utils/tokenService';
import { isElectron } from '../utils/platform';
import { logger } from '../utils/logger';

interface SignedUrlResponse {
  url: string;
  expiresAt: string;
}

interface VideoUrlResult {
  url: string | null;
  isLoading: boolean;
  refresh: () => void;
}

/**
 * Hook that provides an authenticated video URL.
 *
 * - Web: Returns a plain URL — the browser sends the httpOnly access_token
 *   cookie automatically for same-origin requests.
 * - Electron: Fetches an HMAC-signed URL from the backend. The signed URL
 *   is cached and transparently refreshed when it nears expiry.
 */
export function useVideoUrl(fileId: string | null): VideoUrlResult {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const expiresAtRef = useRef<number>(0);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const fetchSignedUrl = useCallback(async () => {
    if (!fileId) return;

    const token = getAccessToken();
    if (!token) {
      logger.warn('[useVideoUrl] No access token for signed URL request');
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch(getApiUrl(`/file/${fileId}/signed-url`), {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        throw new Error(`Signed URL request failed: ${response.status}`);
      }

      const data = (await response.json()) as SignedUrlResponse;

      // For Electron, the signed URL path is relative (/api/file/...) — prepend the base
      const baseUrl = getApiUrl('');
      const fullUrl = data.url.startsWith('/api/')
        ? `${baseUrl.replace(/\/api$/, '')}${data.url}`
        : data.url;

      setSignedUrl(fullUrl);
      expiresAtRef.current = new Date(data.expiresAt).getTime();

      // Schedule a refresh 5 minutes before expiry
      const msUntilRefresh = expiresAtRef.current - Date.now() - 5 * 60 * 1000;
      if (msUntilRefresh > 0) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = setTimeout(() => {
          fetchSignedUrl();
        }, msUntilRefresh);
      }
    } catch (error) {
      logger.error('[useVideoUrl] Failed to fetch signed URL:', error);
    } finally {
      setIsLoading(false);
    }
  }, [fileId]);

  useEffect(() => {
    if (!fileId || !isElectron()) return;

    fetchSignedUrl();

    return () => {
      clearTimeout(refreshTimerRef.current);
    };
  }, [fileId, fetchSignedUrl]);

  const refresh = useCallback(() => {
    if (isElectron()) {
      fetchSignedUrl();
    }
  }, [fetchSignedUrl]);

  // Web: just return the plain URL (cookie auth)
  if (!isElectron()) {
    return {
      url: fileId ? getApiUrl(`/file/${fileId}`) : null,
      isLoading: false,
      refresh: () => {},
    };
  }

  // Electron: return the signed URL
  return {
    url: signedUrl,
    isLoading,
    refresh,
  };
}
