/**
 * Community pictures for the dock and the "All communities" sheet. A community's avatar is an
 * authenticated file (`useAuthenticatedImage`, the classic rail's source and cache); that hook takes one
 * file, so `CommunityPictureProbes` renders one probe per picture that reports its address here. The
 * views then take a plain `src` (closed props).
 */
import { useCallback, useState } from 'react';

export interface CommunityPictures {
  pictures: ReadonlyMap<string, string>;
  /** For `CommunityPictureProbes`: a picture's address, or null when it has none (yet). Stable. */
  onUrl(id: string, url: string | null): void;
}

export function useCommunityPictures(): CommunityPictures {
  const [pictures, setPictures] = useState<ReadonlyMap<string, string>>(() => new Map());
  const onUrl = useCallback((id: string, url: string | null) => {
    setPictures((previous) => {
      if ((previous.get(id) ?? null) === url) return previous;
      const next = new Map(previous);
      if (url === null) next.delete(id);
      else next.set(id, url);
      return next;
    });
  }, []);
  return { pictures, onUrl };
}
