import { useState, useEffect } from "react";
import { useFileCache } from "../contexts/AvatarCacheContext";
import { getAccessToken } from "../utils/tokenService";
import { getApiUrl } from "../config/env";
import type { FileMetadata } from "../types/message.type";

interface FileState {
  /** Which request this state belongs to (see `requestKeyOf`). */
  key: string | null;
  blobUrl: string | null;
  metadata: FileMetadata | null;
  isLoadingBlob: boolean;
  isLoadingMetadata: boolean;
  error: Error | null;
}

const requestKeyOf = (
  fileId: string | null | undefined,
  fetchBlob: boolean,
  fetchMetadata: boolean,
): string | null => (fileId ? `${fileId}|${fetchBlob ? 1 : 0}|${fetchMetadata ? 1 : 0}` : null);

/**
 * Hook to fetch file metadata and/or blob URL with authentication
 * Uses global cache to prevent duplicate fetches for the same fileId
 * @param fileId - The file ID to fetch
 * @param options - Optional configuration
 * @returns Object with blobUrl, metadata, loading states, and errors
 *
 * The starting state for a file id (loading, or an already-cached blob) is
 * derived during render, not set from the effect: the effect only ever
 * updates state after an `await`. Setting state synchronously inside the
 * effect meant every avatar that got its file id during a burst of
 * store-driven (Sync-lane) commits — e.g. 60 `useUser` queries resolving
 * together on a long member list — left a Default-lane update pending after
 * each commit, and React threw "Maximum update depth exceeded" once more
 * than 50 commits in a row did that.
 */
export const useAuthenticatedFile = (
  fileId: string | null | undefined,
  options?: {
    fetchBlob?: boolean; // Default: true
    fetchMetadata?: boolean; // Default: false
  }
) => {
  const { fetchBlob = true, fetchMetadata = false } = options || {};
  const fileCache = useFileCache();
  const key = requestKeyOf(fileId, fetchBlob, fetchMetadata);

  const startState = (): FileState => {
    const cachedUrl = fileId && fetchBlob ? fileCache.getBlob(fileId) : null;
    return {
      key,
      blobUrl: cachedUrl,
      metadata: null,
      isLoadingBlob: !!fileId && fetchBlob && !cachedUrl,
      isLoadingMetadata: !!fileId && fetchMetadata,
      error: null,
    };
  };

  const [storedState, setState] = useState<FileState>(startState);

  // New request: reset during render ("adjusting state when a prop
  // changes"). React re-renders this component immediately, before
  // committing, so this schedules no separate update.
  let state = storedState;
  if (storedState.key !== key) {
    state = startState();
    setState(state);
  }

  useEffect(() => {
    if (!fileId) return;

    let isCancelled = false;
    // Only apply an update while this request is still the current one.
    const update = (patch: Partial<FileState>) => {
      if (isCancelled) return;
      setState(prev => {
        if (prev.key !== key) return prev;
        const changed = (Object.keys(patch) as (keyof FileState)[]).some(k => prev[k] !== patch[k]);
        return changed ? { ...prev, ...patch } : prev;
      });
    };

    const fetchData = async () => {
      try {
        // Fetch blob using centralized fetchBlob (handles caching and deduplication)
        if (fetchBlob) {
          const url = fileCache.getBlob(fileId) ?? (await fileCache.fetchBlob(fileId));
          update({ blobUrl: url, isLoadingBlob: false });
        }

        // Fetch metadata if requested
        if (fetchMetadata) {
          const token = getAccessToken();
          if (!token) {
            throw new Error("No authentication token found");
          }

          const metadataResponse = await fetch(getApiUrl(`/file/${fileId}/metadata`), {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          });

          if (!metadataResponse.ok) {
            throw new Error(`Failed to fetch metadata: ${metadataResponse.status}`);
          }

          const metadataData = await metadataResponse.json();
          update({ metadata: metadataData, isLoadingMetadata: false });
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error("Failed to fetch file");
        update({ blobUrl: null, metadata: null, isLoadingBlob: false, isLoadingMetadata: false, error });
      }
    };

    fetchData();

    return () => {
      isCancelled = true;
    };
  }, [key, fileId, fetchBlob, fetchMetadata, fileCache]);

  return {
    blobUrl: state.blobUrl,
    metadata: state.metadata,
    isLoading: state.isLoadingBlob || state.isLoadingMetadata,
    isLoadingBlob: state.isLoadingBlob,
    isLoadingMetadata: state.isLoadingMetadata,
    error: state.error,
  };
};

// Backward compatibility alias - delegates to useAuthenticatedFile with cache
export const useAuthenticatedImage = (fileId: string | null | undefined) => {
  return useAuthenticatedFile(fileId, { fetchBlob: true, fetchMetadata: false });
};
