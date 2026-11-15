import { useEffect, useRef, type JSX } from 'react';
import { visuallyHidden } from '../../theme/a11y';
import { useBehaviourHost } from './hostContext';

export interface LiveRegionSlotProps {
  /** Where the slot sits: the page root or a layer. Only a marker for tests and styling hooks. */
  scope: 'root' | 'layer';
  /** While false the slot stays in the DOM but is not a place announcements go to. */
  active?: boolean;
}

/**
 * The live-region pair of one slot: a polite and an assertive region, both empty
 * until the announcer writes into them. They carry `aria-live` and no `role`:
 * `role="status"` and `role="alert"` would be found by every `getByRole` for a
 * kit Alert, Toast or Spinner on the page, and the explicit `aria-live` is what
 * makes a region that exists before its text is set be read.
 */
export function LiveRegionSlot({ scope, active = true }: LiveRegionSlotProps): JSX.Element {
  const { announcer } = useBehaviourHost();
  const polite = useRef<HTMLDivElement>(null);
  const assertive = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!active || polite.current === null || assertive.current === null) return undefined;
    return announcer.registerSlot({ polite: polite.current, assertive: assertive.current });
  }, [announcer, active]);
  return (
    <div data-kit-live-slot={scope} style={visuallyHidden}>
      <div ref={polite} aria-live="polite" aria-atomic="true" />
      <div ref={assertive} aria-live="assertive" aria-atomic="true" />
    </div>
  );
}
