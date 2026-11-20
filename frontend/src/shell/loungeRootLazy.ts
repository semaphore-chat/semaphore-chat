import { lazy } from 'react';
import { loadLoungeRoot } from './loungeRootChunk';

/**
 * The new design's shell as a lazy component. `React.lazy` remembers a failed load for good, so after
 * a failure (or a crash) `renewLoungeRoot()` hands out a fresh one and the next attempt loads again.
 */
let loungeRoot = lazy(loadLoungeRoot);

export function currentLoungeRoot(): typeof loungeRoot {
  return loungeRoot;
}

export function renewLoungeRoot(): typeof loungeRoot {
  loungeRoot = lazy(loadLoungeRoot);
  return loungeRoot;
}
