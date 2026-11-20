import { useState } from 'react';

/** An anchor element held in state, so a story can open an overlay on first render. */
export function useAnchor(): [HTMLElement | null, (node: HTMLElement | null) => void] {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return [anchor, setAnchor];
}
